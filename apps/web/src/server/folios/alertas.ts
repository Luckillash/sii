import 'server-only';
import { correoFoliosPorAgotarse } from '@sii/correos';
import { UMBRAL_AVISO_FOLIOS } from '@/components/boleteame/folios';
import {
  type AmbienteSii,
  type DecisionAlerta,
  type Disponibilidad,
  decidirAlerta,
  disponibilidadDe,
  nombreTipoFolio,
} from '@/lib/folios';
import { formatearMiles, formatearRut } from '@/lib/formatos';
import type { DependenciasCertificacion } from '../certificacion/dependencias';
import type { ClienteServicio } from '../supabase/service';
import { leerCafs } from './disponibles';
import type { ClaveFolios } from './tipos';

// Alerta `folios.por_agotarse` (PLAN-SAAS Fase 6, punto 6; §4.6): webhook + correo a los
// propietarios y administradores cuando los folios de una empresa, en un ambiente y para
// un tipo, CRUZAN el umbral del 15 % del `MedidorFolios` o se agotan.
//
//   - La decisión es pura (`decidirAlerta` de `@/lib/folios`): compara la disponibilidad
//     antes y después de lo que la consumió (asignar un folio, anular la cola de un CAF).
//     El DENOMINADOR es el tamaño de los CAF activos que aún tienen folios libres (ver
//     `disponibilidadDe`); con un solo CAF es exactamente el `MedidorFolios`.
//   - Deduplicación: descansa en que el cruce ocurre una sola vez (la tabla
//     `notificaciones` es de la Fase 8). Además, `Idempotency-Key` determinista por
//     empresa + ambiente + tipo + CAF en uso + umbral (Resend no repite en 24 h).
//   - Webhook con `encolar_evento(org, 'folios.por_agotarse', payload)` (service_role). El
//     payload no lleva secretos: ids, RUT, tipo, ambiente y cifras.
//   - Nunca lanza ni frena a quien la llama (la emisión o la anulación ya ocurrieron):
//     cualquier falla queda en un aviso de consola sin datos.
//
// Puntos de enganche: `alertarSiCruza` (después de anular la cola, aquí) y
// `alertaDespuesDeAsignar` (Fase 7, después de `asignar_folio`).

export const EVENTO_FOLIOS_POR_AGOTARSE = 'folios.por_agotarse';

/** `Idempotency-Key` de Resend: determinista, sin datos sensibles. */
export function claveIdempotenciaAlerta(datos: {
  empresaId: string;
  ambiente: AmbienteSii;
  tipoDte: number;
  cafId: string | null;
  decision: DecisionAlerta;
}): string {
  const umbral = datos.decision === 'agotado' ? 'agotado' : String(UMBRAL_AVISO_FOLIOS * 100);
  return [
    EVENTO_FOLIOS_POR_AGOTARSE,
    datos.empresaId,
    datos.ambiente,
    datos.tipoDte,
    datos.cafId ?? 'sin-caf',
    umbral,
  ].join('/');
}

/** Payload del webhook (`datos` del evento). Sin secretos. */
export function payloadAlerta(datos: {
  clave: ClaveFolios;
  rutEmpresa: string;
  decision: DecisionAlerta;
  despues: Disponibilidad;
  cafId: string | null;
}) {
  return {
    empresa_id: datos.clave.empresaId,
    rut_empresa: datos.rutEmpresa,
    ambiente: datos.clave.ambiente,
    tipo_dte: datos.clave.tipoDte,
    folios_disponibles: datos.despues.restante,
    folios_total: datos.despues.total,
    umbral: UMBRAL_AVISO_FOLIOS,
    agotado: datos.decision === 'agotado',
    caf_id: datos.cafId,
  };
}

async function correosAdministradores(
  cliente: ClienteServicio,
  organizacionId: string,
): Promise<string[] | null> {
  const miembros = await cliente
    .from('miembros_organizacion')
    .select('usuario_id')
    .eq('organizacion_id', organizacionId)
    .in('rol', ['propietario', 'administrador']);
  if (miembros.error) return null;
  if (miembros.data.length === 0) return [];
  const perfiles = await cliente
    .from('perfiles')
    .select('correo')
    .in(
      'id',
      miembros.data.map((m) => m.usuario_id),
    );
  if (perfiles.error) return null;
  return [
    ...new Set(
      perfiles.data
        .map((p) => p.correo?.trim().toLowerCase() ?? '')
        .filter((correo) => correo.includes('@')),
    ),
  ];
}

/**
 * Si entre `antes` y `despues` se cruzó el umbral (o se agotaron), encola el webhook y
 * manda el correo. Devuelve la decisión (`null` si no cruzó). Nunca lanza.
 */
export async function alertarSiCruza(
  deps: Pick<DependenciasCertificacion, 'correo'>,
  cliente: ClienteServicio,
  clave: ClaveFolios,
  antes: Disponibilidad,
  despues: Disponibilidad,
): Promise<DecisionAlerta | null> {
  const decision = decidirAlerta(antes, despues);
  if (!decision) return null;
  const cafId = despues.cafEnUso ?? antes.cafEnUso;
  try {
    const [organizacion, empresa] = await Promise.all([
      cliente
        .from('organizaciones')
        .select('nombre, slug')
        .eq('id', clave.organizacionId)
        .maybeSingle(),
      cliente
        .from('empresas')
        .select('razon_social, rut')
        .eq('organizacion_id', clave.organizacionId)
        .eq('id', clave.empresaId)
        .maybeSingle(),
    ]);
    if (organizacion.error || empresa.error || !organizacion.data || !empresa.data) {
      console.warn('folios: no se pudieron leer los datos de la alerta');
      return decision;
    }

    const evento = await cliente.rpc('encolar_evento', {
      p_organizacion: clave.organizacionId,
      p_evento: EVENTO_FOLIOS_POR_AGOTARSE,
      p_payload: payloadAlerta({
        clave,
        rutEmpresa: empresa.data.rut,
        decision,
        despues,
        cafId,
      }),
    });
    if (evento.error) {
      console.warn(`folios: no se pudo encolar el webhook (código ${evento.error.code})`);
    }

    const urlApp = deps.correo.urlApp();
    if (!urlApp) {
      console.warn('folios: sin NEXT_PUBLIC_APP_URL, no se envía la alerta por correo');
      return decision;
    }
    const para = await correosAdministradores(cliente, clave.organizacionId);
    if (para === null) {
      console.warn('folios: no se pudieron leer los correos de la alerta');
      return decision;
    }
    if (para.length === 0) return decision;

    const correo = correoFoliosPorAgotarse({
      organizacion: organizacion.data.nombre,
      empresa: empresa.data.razon_social,
      rut: formatearRut(empresa.data.rut),
      tipo: nombreTipoFolio(clave.tipoDte),
      ambiente: clave.ambiente === 'produccion' ? 'producción' : 'certificación',
      disponibles: formatearMiles(despues.restante),
      total: formatearMiles(despues.total > 0 ? despues.total : antes.total),
      agotado: decision === 'agotado',
      enlace: `${urlApp}/${encodeURIComponent(organizacion.data.slug)}/folios?empresa=${encodeURIComponent(clave.empresaId)}`,
    });
    const envio = await deps.correo.enviar({
      para,
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      claveIdempotencia: claveIdempotenciaAlerta({
        empresaId: clave.empresaId,
        ambiente: clave.ambiente,
        tipoDte: clave.tipoDte,
        cafId,
        decision,
      }),
    });
    if (!envio.ok) console.warn(`folios: la alerta por correo no salió (${envio.motivo})`);
  } catch (error) {
    console.warn('folios: falló la alerta de folios', {
      tipo: error instanceof Error ? error.name : typeof error,
    });
  }
  return decision;
}

/**
 * Punto de enganche de la Fase 7: llamar después de `asignar_folio` con lo que devolvió
 * (`caf_id`, `folio`). Reconstruye la disponibilidad de antes sin otra lectura: un folio
 * más y, si ese era el último del CAF (que quedó `agotado` y salió del conjunto), su
 * tamaño en el denominador. Nunca lanza.
 */
export async function alertaDespuesDeAsignar(
  deps: Pick<DependenciasCertificacion, 'correo'>,
  cliente: ClienteServicio,
  clave: ClaveFolios,
  asignado: { cafId: string; folio: number },
): Promise<DecisionAlerta | null> {
  try {
    const cafs = await leerCafs(cliente, clave);
    const despues = disponibilidadDe(cafs);
    const caf = cafs.find((c) => c.id === asignado.cafId);
    if (!caf) return null;
    const agotoElCaf = asignado.folio >= caf.hasta;
    const antes: Disponibilidad = {
      restante: despues.restante + 1,
      total: despues.total + (agotoElCaf ? caf.hasta - caf.desde + 1 : 0),
      cafEnUso: caf.id,
    };
    return await alertarSiCruza(deps, cliente, clave, antes, despues);
  } catch (error) {
    console.warn('folios: falló la alerta después de asignar un folio', {
      tipo: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}
