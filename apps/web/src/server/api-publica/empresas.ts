import 'server-only';
import type { EmpresaRef } from '@/lib/api-publica';
import { rutSii, validarRut } from '@/lib/formatos';
import type { ClaveAutenticada, FilaEmpresaApi, RepositorioApi } from './repositorio';
import { ErrorApi } from './respuestas';

// La empresa de una petición (§2.1 del diseño). Si la clave tiene empresa, es la única
// permitida: pedir otra da 403 `empresa_no_permitida`. Si la clave sirve para todas, una
// emisión o una solicitud de folios exige `empresa` (RUT `76354771-K`, con o sin puntos, o
// su id) y responde 422 `empresa_requerida` si falta; en los listados es un filtro.
// Una empresa de otra organización no existe para la clave (404, sin revelar nada).

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function empresaRef(e: Pick<FilaEmpresaApi, 'id' | 'rut' | 'razon_social'>): EmpresaRef {
  return { id: e.id, rut: e.rut, razon_social: e.razon_social };
}

async function buscar(
  repo: Pick<RepositorioApi, 'empresaPorId' | 'empresaPorRut'>,
  organizacionId: string,
  valor: string,
): Promise<FilaEmpresaApi | null> {
  const v = valor.trim();
  if (PATRON_UUID.test(v)) return repo.empresaPorId(organizacionId, v.toLowerCase());
  if (!validarRut(v)) {
    throw new ErrorApi('datos_invalidos', {
      campos: { empresa: 'Usa el RUT de la empresa (76354771-K) o su id.' },
    });
  }
  return repo.empresaPorRut(organizacionId, rutSii(v));
}

const NO_ENCONTRADA = () =>
  new ErrorApi('no_encontrado', {
    mensaje:
      'No encontramos esa empresa en tu organización. Revisa el RUT o el id que enviaste en empresa.',
  });

/**
 * La empresa con que se opera: la de la clave, o la pedida en `valor`. Con
 * `requerida: false` y sin empresa en la clave ni en `valor`, devuelve `null` (todas).
 */
export async function resolverEmpresa(
  repo: Pick<RepositorioApi, 'empresaPorId' | 'empresaPorRut'>,
  clave: ClaveAutenticada,
  valor: string | null | undefined,
  opciones: { requerida: true },
): Promise<FilaEmpresaApi>;
export async function resolverEmpresa(
  repo: Pick<RepositorioApi, 'empresaPorId' | 'empresaPorRut'>,
  clave: ClaveAutenticada,
  valor: string | null | undefined,
  opciones: { requerida: false },
): Promise<FilaEmpresaApi | null>;
export async function resolverEmpresa(
  repo: Pick<RepositorioApi, 'empresaPorId' | 'empresaPorRut'>,
  clave: ClaveAutenticada,
  valor: string | null | undefined,
  opciones: { requerida: boolean },
): Promise<FilaEmpresaApi | null> {
  const pedida = valor?.trim() ? valor.trim() : null;
  if (clave.empresaId) {
    const propia = await repo.empresaPorId(clave.organizacionId, clave.empresaId);
    if (!propia) throw NO_ENCONTRADA();
    if (pedida !== null) {
      const otra = PATRON_UUID.test(pedida)
        ? pedida.toLowerCase() !== propia.id.toLowerCase()
        : !validarRut(pedida) || rutSii(pedida) !== propia.rut;
      if (otra) throw new ErrorApi('empresa_no_permitida');
    }
    return propia;
  }
  if (pedida === null) {
    if (opciones.requerida) throw new ErrorApi('empresa_requerida');
    return null;
  }
  const empresa = await buscar(repo, clave.organizacionId, pedida);
  if (!empresa) throw NO_ENCONTRADA();
  return empresa;
}

/** Para emitir o pedir folios la empresa tiene que estar activa. */
export function exigirActiva(empresa: FilaEmpresaApi): void {
  if (!empresa.activa) throw new ErrorApi('empresa_inactiva');
}
