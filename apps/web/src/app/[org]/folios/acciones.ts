'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { MENSAJE_GENERICO, type MensajeError } from '@/lib/equipo-errores';
import {
  erroresPorCampo,
  esquemaAmbienteCaf,
  esquemaAnulacion,
  esquemaSolicitud,
  type ResultadoFolios,
  TAMANO_MAXIMO_CAF,
} from '@/lib/folios';
import { puedeAdministrar } from '@/lib/permisos';
import { marcarRevisada as marcarRevisadaCertificacion } from '@/server/certificacion';
import { obtenerEmpresa } from '@/server/empresas';
import * as folios from '@/server/folios';
import { exigirMembresia } from '@/server/sesion';

// Server Actions de `/[org]/folios` (PLAN-SAAS Fase 6). Finas: verifican la membresía y
// el rol (folios = `es_admin`: propietario o administrador), validan con zod y llaman a
// `server/folios`, que valida de nuevo, sale al SII (solo la solicitud) y persiste. La
// autoridad final es RLS / las RPC. `maxDuration = 300` lo fija `page.tsx`: en Next 16
// el valor de la página aplica a todas las Server Actions que se usan en ella.
//
// La solicitud tiene tres niveles (`nivel`): `ensayo` (sin red ni filas), `revision` (el
// asistente del SII sin timbrar) y `timbrar`. La UI muestra el ensayo en un `Dialogo` y,
// en producción, solo ofrece timbrar después de una revisión correcta.

const esquemaId = z.uuid();

const SIN_PERMISO: MensajeError = {
  titulo: 'No tienes permiso para gestionar folios',
  detalle: 'Solo un propietario o un administrador puede pedir, subir o anular folios.',
};

const EMPRESA_NO_ENCONTRADA: MensajeError = {
  titulo: 'No encontramos la empresa',
  detalle: 'Puede que la hayan quitado de la organización. Recarga la página y elige otra.',
};

const DATOS_INVALIDOS: MensajeError = {
  titulo: 'Revisa los datos',
  detalle: 'Hay campos con errores. Corrígelos y vuelve a intentarlo.',
};

function fallo(mensaje: MensajeError, errores?: Record<string, string>): ResultadoFolios {
  return {
    tipo: 'error',
    mensaje,
    operacionId: null,
    motivo: 'no_ejecutada',
    ...(errores ? { errores } : {}),
  };
}

type Previo = { ok: true; ctx: folios.ContextoFolios } | { ok: false; resultado: ResultadoFolios };

async function preparar(slug: string, empresaId: string): Promise<Previo> {
  const { organizacion, usuario, rol } = await exigirMembresia(slug);
  if (!puedeAdministrar(rol)) return { ok: false, resultado: fallo(SIN_PERMISO) };
  if (!esquemaId.safeParse(empresaId).success) {
    return { ok: false, resultado: fallo(EMPRESA_NO_ENCONTRADA) };
  }
  // La empresa tiene que ser de esta organización (RLS además oculta las de otras).
  const empresa = await obtenerEmpresa(organizacion.id, empresaId);
  if (!empresa) return { ok: false, resultado: fallo(EMPRESA_NO_ENCONTRADA) };
  return {
    ok: true,
    ctx: { organizacionId: organizacion.id, empresaId: empresa.id, usuarioId: usuario.id },
  };
}

/** Llama al backend; un error inesperado vuelve como mensaje (sin detalles técnicos). */
async function ejecutar(
  slug: string,
  nombre: string,
  llamada: () => Promise<ResultadoFolios>,
): Promise<ResultadoFolios> {
  let r: ResultadoFolios;
  try {
    r = await llamada();
  } catch (e) {
    // Solo el tipo de error: el mensaje podría traer datos de la petición.
    console.error(`Folios: falló ${nombre}`, { tipo: e instanceof Error ? e.name : null });
    revalidatePath(`/${slug}/folios`);
    return fallo(MENSAJE_GENERICO);
  }
  // El ensayo no cambia nada; lo demás puede haber dejado filas nuevas.
  if (r.tipo !== 'ensayo') revalidatePath(`/${slug}/folios`);
  return r;
}

/** Ensayo, revisión con el SII o timbraje de folios (⚠️ en `timbrar`). */
export async function solicitarFolios(
  slug: string,
  empresaId: string,
  entrada: unknown,
): Promise<ResultadoFolios> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  const v = esquemaSolicitud.safeParse(entrada);
  if (!v.success) return fallo(DATOS_INVALIDOS, erroresPorCampo(v.error));
  return ejecutar(slug, `solicitarFolios(${v.data.nivel})`, () =>
    folios.solicitarFolios(previo.ctx, {
      nivel: v.data.nivel,
      tipoDte: v.data.tipoDte,
      ambiente: v.data.ambiente,
      cantidad: v.data.cantidad,
      ...(v.data.folioInicial !== undefined ? { folioInicial: v.data.folioInicial } : {}),
      ...(v.data.revisionId ? { revisionId: v.data.revisionId } : {}),
    }),
  );
}

/**
 * Sube un CAF existente (XML). El archivo solo vive en esta petición: se valida y va a
 * Vault por `registrar_caf`. Nunca a disco, logs, Sentry ni de vuelta al navegador
 * (tampoco su nombre).
 */
export async function subirCaf(
  slug: string,
  empresaId: string,
  _anterior: ResultadoFolios | null,
  formulario: FormData,
): Promise<ResultadoFolios> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  const ambiente = esquemaAmbienteCaf.safeParse(formulario.get('ambiente'));
  const archivo = formulario.get('caf');
  const errores: Record<string, string> = {};
  if (!ambiente.success) errores.ambiente = 'Elige el ambiente del CAF.';
  if (!(archivo instanceof File) || archivo.size === 0) {
    errores.caf = 'Elige el archivo XML del CAF.';
  } else if (archivo.size > TAMANO_MAXIMO_CAF) {
    errores.caf =
      'El archivo pasa de 64 KB y un CAF pesa unos pocos KB. Revisa que sea el archivo correcto.';
  }
  if (Object.keys(errores).length > 0 || !ambiente.success || !(archivo instanceof File)) {
    return fallo(DATOS_INVALIDOS, errores);
  }
  const contenido = new Uint8Array(await archivo.arrayBuffer());
  return ejecutar(slug, 'subirCaf', () =>
    folios.subirCaf(previo.ctx, { ambiente: ambiente.data, contenido }),
  );
}

/** Anula folios no usados de un CAF (con la sesión del usuario: la base verifica el rol). */
export async function anularFolios(
  slug: string,
  empresaId: string,
  entrada: unknown,
): Promise<ResultadoFolios> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  const v = esquemaAnulacion.safeParse(entrada);
  if (!v.success) return fallo(DATOS_INVALIDOS, erroresPorCampo(v.error));
  return ejecutar(slug, 'anularFolios', () => folios.anularFolios(previo.ctx, v.data));
}

/** Marca como revisada una solicitud de folios incierta (después de revisar en el SII). */
export async function marcarRevisada(
  slug: string,
  empresaId: string,
  operacionId: string,
): Promise<ResultadoFolios> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  if (!esquemaId.safeParse(operacionId).success) return fallo(DATOS_INVALIDOS);
  return ejecutar(
    slug,
    'marcarRevisada',
    async () => (await marcarRevisadaCertificacion(previo.ctx, operacionId)) as ResultadoFolios,
  );
}
