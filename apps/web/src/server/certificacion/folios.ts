import 'server-only';
import type { ResultadoPaso } from '@/lib/certificacion';
import { formatearRut } from '@/lib/formatos';
import {
  foliosDisponibles as disponiblesDeClave,
  type FoliosDisponibles,
} from '../folios/disponibles';
import { type SalidaSolicitud, solicitarEnSii } from '../folios/sii';
import { ErrorUso } from '../sii/errores';
import type { ClienteServicio } from '../supabase/service';
import {
  AMBIENTE,
  cargarEmpresaPorCertificar,
  ejecutar,
  ensayar,
  errorDeEjecucion,
  etapaEntre,
  exigirProceso,
  fallaBase,
  ok,
  resumenCertificado,
  TIPO_BOLETA,
  validarAntes,
} from './comun';
import { type DependenciasCertificacion, resolverDependencias } from './dependencias';
import type { ContextoCertificacion } from './tipos';

// Paso 3 (primera mitad): folios (CAF) de boleta para el set, en certificación (maullin),
// con paridad con `sii certificacion solicitar-folios`:
//   - tipo 39, cantidad = número de casos del set (5 si todavía no se descarga);
//   - certificado de un representante electrónico (`representante: true`);
//   - fila en `solicitudes_folios` (en_curso → timbrada / incierta / rechazada / error);
//   - el CAF va a Vault y a `cafs` con la RPC `registrar_caf` (migración 0008), que
//     también deja la solicitud `timbrada`;
//   - `FolioInicialRequeridoError` (primer timbraje) → `requiere.folioInicial` con el
//     valor que sugiere el SII (no se timbró nada);
//   - si el CAF se timbró pero no se pudo guardar → `incierto` (código 6 de la CLI): no
//     volver a pedirlos, bajar el CAF desde «Folios ya autorizados» y subirlo.
// El ensayo no sale al SII (la CLI sin `--confirmar` recorre el asistente hasta antes de
// timbrar; aquí el ensayo nunca sale a la red, PLAN-SAAS principio 3). La revisión con el
// SII (el asistente sin timbrar) está en `/[org]/folios` (Fase 6).
//
// Lo genérico (la conversación con el SII, la lectura del CAF y la disponibilidad) vive
// en `server/folios/` desde la Fase 6; este módulo solo pone las reglas del set.
//
// El XML del CAF (con `<RSASK>`) nunca se registra: solo viaja a la RPC.

export { type DatosCaf, leerDatosCaf } from '../folios/caf';
export type { FoliosDisponibles } from '../folios/disponibles';

/** Folios libres de boleta en certificación, en los CAF activos (lo que usa `asignar_folio`). */
export function foliosDisponibles(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
): Promise<FoliosDisponibles> {
  return disponiblesDeClave(cliente, {
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
    ambiente: AMBIENTE,
    tipoDte: TIPO_BOLETA,
  });
}

/** Número de casos del set guardado (0 si todavía no se descarga). */
export async function contarCasos(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  procesoId: string,
) {
  const { count, error } = await cliente
    .from('set_pruebas_casos')
    .select('id', { count: 'exact', head: true })
    .eq('organizacion_id', ctx.organizacionId)
    .eq('proceso_id', procesoId);
  if (error) throw fallaBase('contar los casos del set', error);
  return count ?? 0;
}

async function preparar(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  credenciales: ReturnType<DependenciasCertificacion['credenciales']>,
  folioInicial: number | undefined,
) {
  if (folioInicial !== undefined && (!Number.isSafeInteger(folioInicial) || folioInicial < 1)) {
    throw new ErrorUso('El folio inicial tiene que ser un número entero mayor que 0.');
  }
  const empresa = await cargarEmpresaPorCertificar(cliente, ctx);
  const proceso = await exigirProceso(cliente, ctx);
  if (proceso.etapa === 'borrador') {
    throw new ErrorUso('Primero postula la empresa (paso 1).');
  }
  if (!etapaEntre(proceso.etapa, 'postulada', 'revision_solicitada')) {
    throw new ErrorUso(
      'La empresa ya está lista para declarar o autorizada: el set no necesita más folios.',
    );
  }
  const casos = await contarCasos(cliente, ctx, proceso.id);
  const cantidad = casos > 0 ? casos : 5;
  const disponibles = await foliosDisponibles(cliente, ctx);
  const certificado = await credenciales.certificadoDeEmpresa({
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
    representante: true,
  });
  return { empresa, proceso, cantidad, disponibles, certificado };
}

/** Pide folios de boleta (CAF) para el set en certificación (⚠️: timbra folios). */
export async function solicitarFoliosSet(
  ctx: ContextoCertificacion,
  opciones: { confirmada: boolean; folioInicial?: number },
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);
  const prep = () => preparar(cliente, ctx, credenciales, opciones.folioInicial);

  if (!opciones.confirmada) {
    return ensayar(async () => {
      const p = await prep();
      const avisos = [
        'Se timbran folios de certificación (IDK 100): sirven solo para el set, no en producción.',
        'El titular del certificado tiene que ser representante electrónico de la empresa.',
      ];
      if (p.disponibles.total >= p.cantidad && p.disponibles.primero) {
        avisos.unshift(
          `Ya tienes ${p.disponibles.total} folios de boleta disponibles en certificación (CAF del ${p.disponibles.primero.desde} al ${p.disponibles.primero.hasta}): alcanzan para el set y no hace falta pedir más.`,
        );
      }
      return {
        operacion: 'solicitar_folios',
        titulo: 'Pedir folios para el set de pruebas',
        ambiente: AMBIENTE,
        certificado: await resumenCertificado(cliente, ctx, p.certificado),
        filas: [
          {
            etiqueta: 'Empresa',
            valor: `${p.empresa.razon_social} (${formatearRut(p.empresa.rut)})`,
          },
          { etiqueta: 'Tipo de documento', valor: `Boleta electrónica (${TIPO_BOLETA})` },
          { etiqueta: 'Cantidad', valor: String(p.cantidad) },
          ...(opciones.folioInicial !== undefined
            ? [{ etiqueta: 'Folio inicial', valor: String(opciones.folioInicial) }]
            : []),
          { etiqueta: 'Folios disponibles hoy', valor: String(p.disponibles.total) },
        ],
        avisos,
        textoConfirmar: 'Pedir folios',
      };
    });
  }

  const previo = await validarAntes(prep);
  if (!previo.ok) return previo.resultado;

  const salida: SalidaSolicitud = {};
  const r = await ejecutar(
    deps,
    cliente,
    ctx,
    { operacion: 'solicitar_folios', confirmada: true },
    async (herramientas) => {
      const p = await prep();
      const desenlace = await solicitarEnSii(
        deps,
        cliente,
        ctx,
        {
          ambiente: AMBIENTE,
          tipoDte: TIPO_BOLETA,
          cantidad: p.cantidad,
          ...(opciones.folioInicial !== undefined ? { folioInicial: opciones.folioInicial } : {}),
          certificado: p.certificado,
          rutEmpresa: p.empresa.rut,
        },
        { simular: false },
        herramientas,
        salida,
      );
      return desenlace;
    },
  );
  if (!r.ok) {
    return errorDeEjecucion(
      r,
      salida.folioSugerido
        ? { requiere: { folioInicial: { sugerido: salida.folioSugerido } } }
        : {},
    );
  }
  return ok(
    {
      titulo: 'El SII timbró los folios',
      detalle: `Guardamos el CAF de boleta con los folios ${r.valor.desde} a ${r.valor.hasta}. El siguiente paso es enviar el set al SII.`,
    },
    r.operacionId,
  );
}
