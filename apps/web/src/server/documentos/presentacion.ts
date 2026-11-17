import type { EstadoDte, Tono } from '@/components/boleteame/tipos';
import { formatearFechaHora, formatearMiles } from '@/lib/formatos';
import type { ClasificacionEnvio, ResultadoConsultaEnvio } from '@/lib/seguimiento';
import type { MensajeError } from '../equipo-errores';
import type { Database, Json } from '../supabase/tipos';

// Presentación de documentos y envíos (PLAN-SAAS Fase 8) con el tono del design system.
// Puro y sin `server-only`: lo usan las páginas (servidor), los componentes cliente de
// `/[org]/documentos` y `/[org]/envios/[id]` y Vitest. Nada de datos de la base aquí: solo
// traducciones de estados, códigos y errores del SII a texto para el usuario.

export type EstadoDocumentoBd = Database['public']['Enums']['estado_documento'];
export type AmbienteSii = Database['public']['Enums']['ambiente_sii'];

/** Estado del documento en la base → estado de `EstadoDTE` (`aceptado_con_reparos` → `reparos`). */
export function estadoUi(estado: EstadoDocumentoBd | string): EstadoDte {
  switch (estado) {
    case 'aceptado_con_reparos':
      return 'reparos';
    case 'borrador':
    case 'firmado':
    case 'enviado':
    case 'aceptado':
    case 'rechazado':
    case 'anulado':
    case 'incierto':
      return estado;
    default:
      return 'borrador';
  }
}

/** Lo que hace falta de un envío para mostrar su estado. */
export interface EstadoEnvioMinimo {
  clasificacion: ClasificacionEnvio | null;
  incierto: boolean;
  trackId: string | null;
}

/**
 * Estado de un envío con las palabras de `EstadoDTE`. `pendiente` con Track ID es un
 * envío que el SII recibió y todavía no consultamos (`enviado`); sin Track ID, no salió
 * (`firmado`). `inconsistente` (EPR con cifras que no cuadran) se muestra `enviado`, como
 * deja a sus documentos `sincronizar_documentos_envio`.
 */
export function estadoDeEnvio(e: EstadoEnvioMinimo): EstadoDte {
  if (e.incierto || e.clasificacion === 'incierto') return 'incierto';
  switch (e.clasificacion) {
    case 'aceptado':
      return 'aceptado';
    case 'aceptado_con_reparos':
      return 'reparos';
    case 'rechazado':
      return 'rechazado';
    case 'en_proceso':
    case 'inconsistente':
      return 'enviado';
    default:
      return e.trackId ? 'enviado' : 'firmado';
  }
}

/** Glosas de `estados_sii` (0001), por si el envío no trae `glosa_sii`. */
export const GLOSAS_ESTADO_SII: Readonly<Record<string, string>> = {
  REC: 'Recibido',
  SOK: 'Esquema validado',
  CRT: 'Carátula validada',
  FOK: 'Firma validada',
  PRD: 'En proceso',
  EPR: 'Envío procesado',
  RCH: 'Rechazado',
  RCT: 'Rechazado por error en la carátula',
  RFR: 'Rechazado por error en la firma',
  RSC: 'Rechazado por error en el esquema',
};

/** «EPR · Envío procesado», o la glosa que trajo el SII. `null` sin estado. */
export function textoEstadoSii(codigo: string | null, glosa?: string | null): string | null {
  const c = codigo?.trim();
  if (!c) return null;
  const g = glosa?.trim() || GLOSAS_ESTADO_SII[c.toUpperCase()];
  return g ? `${c} · ${g}` : c;
}

export const TEXTO_CLASIFICACION: Readonly<Record<ClasificacionEnvio, string>> = {
  pendiente: 'Pendiente de consulta',
  incierto: 'Por verificar',
  en_proceso: 'En revisión del SII',
  aceptado: 'Aceptado',
  aceptado_con_reparos: 'Aceptado con reparos',
  rechazado: 'Rechazado',
  inconsistente: 'Respuesta que no cuadra',
};

export function textoClasificacion(c: ClasificacionEnvio | null): string {
  return c ? TEXTO_CLASIFICACION[c] : TEXTO_CLASIFICACION.pendiente;
}

/** «en certificación» / «en producción». */
export function enAmbiente(ambiente: AmbienteSii): string {
  return ambiente === 'produccion' ? 'en producción' : 'en certificación';
}

export function nombreAmbiente(ambiente: AmbienteSii): string {
  return ambiente === 'produccion' ? 'Producción' : 'Certificación';
}

// --- Errores del SII ---------------------------------------------------------------

/** Un error o reparo de `envio_rechazos.errores` (`{ seccion, linea, nivel, codigo, descripcion, detalle }`). */
export interface ErrorSii {
  seccion: string | null;
  linea: number | null;
  codigo: string | null;
  descripcion: string;
  detalle: string | null;
}

function textoODe(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function enteroODe(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) ? n : null;
}

/** Lee `errores` (jsonb) sin confiar en su forma: lo que no es un objeto se descarta. */
export function leerErroresSii(errores: Json | unknown): ErrorSii[] {
  if (!Array.isArray(errores)) return [];
  const salida: ErrorSii[] = [];
  for (const e of errores) {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) continue;
    const o = e as Record<string, unknown>;
    const descripcion = textoODe(o.descripcion) ?? textoODe(o.detalle);
    if (!descripcion) continue;
    const detalle = textoODe(o.detalle);
    salida.push({
      seccion: textoODe(o.seccion),
      linea: enteroODe(o.linea),
      codigo: textoODe(o.codigo),
      descripcion,
      detalle: detalle && detalle !== descripcion ? detalle : null,
    });
  }
  return salida;
}

/** «Sección Encabezado, línea 3» (o `null` si el SII no dijo dónde). */
export function ubicacionError(e: Pick<ErrorSii, 'seccion' | 'linea'>): string | null {
  const partes = [
    e.seccion ? `Sección ${e.seccion}` : null,
    e.linea !== null ? `línea ${formatearMiles(e.linea)}` : null,
  ].filter((x): x is string => x !== null);
  if (partes.length === 0) return null;
  const texto = partes.join(', ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Texto de un error: la descripción del SII con punto final, y el detalle si agrega algo. */
export function textoError(e: Pick<ErrorSii, 'descripcion' | 'detalle'>): string {
  const punto = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);
  return e.detalle ? `${punto(e.descripcion)} ${punto(e.detalle)}` : punto(e.descripcion);
}

/** Qué hacer después de un rechazo o reparo de un documento (design system: qué pasó y qué hacer). */
export function guiaObservacion(tipo: 'rechazo' | 'reparo'): string {
  return tipo === 'rechazo'
    ? 'La boleta no es válida para el SII. Corrige lo que indica y emite una boleta nueva: el folio rechazado no se vuelve a usar.'
    : 'La boleta es válida. Corrige lo que indica el SII en las próximas emisiones.';
}

/**
 * Qué pasó y qué hacer con un rechazo sin detalle por documento. Con `EPR` el SII procesó
 * el envío y rechazó solo algunas boletas (sin decir cuáles, p. ej. por SOAP): se emiten de
 * nuevo las rechazadas. Con otro código se rechazó el sobre completo (carátula, firma,
 * esquema) y se emiten de nuevo todas.
 */
export function mensajeRechazoEnvio(estadoSii: string | null, glosa: string | null): MensajeError {
  const codigo = estadoSii?.trim().toUpperCase() ?? '';
  if (codigo === 'EPR') {
    return {
      titulo: 'El SII rechazó boletas de este envío',
      detalle:
        'El SII procesó el envío, pero no entregó el detalle de cada boleta. Revisa en el sitio del SII cuáles rechazó y por qué, y emite de nuevo solo las rechazadas.',
    };
  }
  const que = textoEstadoSii(codigo, glosa) ?? 'Rechazado';
  const guias: Record<string, string> = {
    RCT: 'Revisa el RUT de quien envía y la resolución de la empresa en Configuración, y emite las boletas de nuevo.',
    RFR: 'Revisa que el certificado digital de la empresa esté vigente y sea de una persona autorizada ante el SII, y emite las boletas de nuevo.',
    RSC: 'El XML no cumple el esquema del SII. Escríbenos a soporte con el Track ID para revisarlo.',
  };
  return {
    titulo: 'El SII rechazó el envío completo',
    detalle: `${que}. ${guias[codigo] ?? 'Revisa el detalle del SII y emite las boletas de nuevo.'}`,
  };
}

// --- Estado incierto -----------------------------------------------------------------

/** Guía de un envío o documento `incierto` (D3): revisar en el SII, nunca reintentar a ciegas. */
export function guiaIncierto(folio?: number | null): MensajeError {
  const cual = folio ? `la boleta N.º ${formatearMiles(folio)}` : 'las boletas de este envío';
  return {
    titulo: 'No sabemos si el SII recibió este envío',
    detalle: `La conexión con el SII se cortó antes de recibir el Track ID. No emitas de nuevo ${cual} hasta revisar en el sitio del SII (Boleta electrónica, consulta de boletas emitidas) si el folio quedó recibido: si ya había llegado, quedaría duplicada.`,
  };
}

// --- «Consultar estado en el SII» -------------------------------------------------

/** Estados del documento que ya no cambian con una consulta al SII. */
const ESTADOS_FINALES: readonly EstadoDocumentoBd[] = [
  'aceptado',
  'aceptado_con_reparos',
  'rechazado',
  'anulado',
];

/**
 * Clasificaciones finales de un envío (EPR con cifras que cuadran, o rechazo). No incluye
 * `inconsistente`: sus cifras no calzan y otra consulta puede traer la respuesta completa,
 * así que el botón queda habilitado (el backend tampoco lo trata como final).
 */
const CLASIFICACIONES_FINALES: readonly ClasificacionEnvio[] = [
  'aceptado',
  'aceptado_con_reparos',
  'rechazado',
];

export type MotivoSinConsulta = 'sin_envio' | 'incierto' | 'final' | 'sin_track_id';

/**
 * Por qué no se ofrece «Consultar estado en el SII», o `null` si se puede. El servidor
 * vuelve a decidir (`consultarEnvio`); esto solo deshabilita el botón con su explicación.
 */
export function motivoSinConsulta(d: {
  estado?: EstadoDocumentoBd | null;
  envio: (EstadoEnvioMinimo & { id: string }) | null;
}): MotivoSinConsulta | null {
  if (d.estado === 'incierto' || d.envio?.incierto || d.envio?.clasificacion === 'incierto') {
    return 'incierto';
  }
  if (d.estado && ESTADOS_FINALES.includes(d.estado)) return 'final';
  if (!d.envio) return 'sin_envio';
  if (d.envio.clasificacion && CLASIFICACIONES_FINALES.includes(d.envio.clasificacion)) {
    return 'final';
  }
  if (!d.envio.trackId) return 'sin_track_id';
  return null;
}

export function textoSinConsulta(motivo: MotivoSinConsulta): string {
  switch (motivo) {
    case 'incierto':
      return 'No hay Track ID que consultar: revisa en el sitio del SII si la boleta llegó.';
    case 'final':
      return 'El SII ya dio su respuesta final: no cambia con otra consulta.';
    case 'sin_envio':
      return 'La boleta todavía no se envía al SII.';
    case 'sin_track_id':
      return 'El envío no tiene Track ID: no llegó al SII.';
  }
}

export interface AvisoUi {
  tono: Tono;
  titulo: string;
  detalle: string;
}

/** El resultado de «Consultar estado en el SII», con el tono del design system. */
export function avisoConsulta(r: ResultadoConsultaEnvio): AvisoUi {
  switch (r.tipo) {
    case 'sin_track_id':
      return { tono: 'aviso', ...r.mensaje };
    case 'error':
      return { tono: 'error', ...r.mensaje };
    case 'final':
      return {
        tono: 'info',
        titulo: 'El envío ya tiene su respuesta final',
        detalle: `Estado: ${textoClasificacion(r.clasificacion)}. No hace falta volver a consultarlo.`,
      };
    case 'consultado': {
      const estado = textoEstadoSii(r.estadoSii, r.glosaSii);
      const sufijo = estado ? ` Estado en el SII: ${estado}.` : '';
      switch (r.clasificacion) {
        case 'aceptado':
          return {
            tono: 'exito',
            titulo: 'El SII aceptó el envío',
            detalle: `Las boletas quedaron aceptadas.${sufijo}`,
          };
        case 'aceptado_con_reparos':
          return {
            tono: 'aviso',
            titulo: 'El SII aceptó el envío con reparos',
            detalle: `Las boletas son válidas; revisa los reparos para corregirlos en las próximas emisiones.${sufijo}`,
          };
        case 'rechazado':
          return {
            tono: 'error',
            titulo: 'El SII rechazó boletas del envío',
            detalle: `Revisa los errores del SII y emite de nuevo las rechazadas.${sufijo}`,
          };
        case 'inconsistente':
          return {
            tono: 'aviso',
            titulo: 'La respuesta del SII no cuadra',
            detalle: `El SII procesó el envío, pero sus cifras no calzan con lo enviado. Vuelve a consultarlo en unos minutos o revísalo en el sitio del SII.${sufijo}`,
          };
        case 'incierto':
          return { tono: 'aviso', ...guiaIncierto() };
        default:
          return {
            tono: 'info',
            titulo: r.cambio
              ? 'El estado del envío cambió'
              : 'El SII todavía está revisando el envío',
            detalle: `Lo seguimos consultando cada 5 minutos; no tienes que hacer nada.${sufijo}`,
          };
      }
    }
  }
}

/** «Consultado el 16-11-2026 19:20» para la bitácora. */
export function textoConsultadoEn(iso: string | null): string | null {
  return iso ? `Consultado el ${formatearFechaHora(iso)}` : null;
}

/**
 * Una fila de la bitácora (`consultas_envio`). El seguimiento guarda `error` en dos casos
 * (`server/seguimiento/persistencia.ts`): una falla sin respuesta (red, token, HTTP: sin
 * `estado_sii`) y una nota sobre una respuesta que sí llegó (p. ej. EPR con rechazos sin
 * detalle por documento: con `estado_sii`). Solo el primero es «no respondió».
 */
export function textoBitacora(c: {
  estadoSii: string | null;
  glosaSii: string | null;
  error: string | null;
}): { respuesta: string; nota: string | null; fallo: boolean } {
  const estado = textoEstadoSii(c.estadoSii, c.glosaSii);
  const error = c.error?.trim() || null;
  if (estado) return { respuesta: estado, nota: error, fallo: false };
  if (error) return { respuesta: `No respondió: ${error}`, nota: null, fallo: true };
  return { respuesta: 'Sin estado', nota: null, fallo: false };
}

/** «Revisado el 17-11-2026 10:05» de un envío incierto marcado como revisado. */
export function textoRevisado(iso: string): string {
  return `Revisado el ${formatearFechaHora(iso)}`;
}
