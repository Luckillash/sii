import { createStore } from 'zustand/vanilla';
import type { ClasificacionEnvio } from '@/lib/seguimiento';
import type { Database } from '@/server/supabase/tipos';

// `useEnVivoStore` (PLAN-SAAS §4.3): cambios de `documentos` y `envios` recibidos por
// Realtime, en memoria. No duplica los datos del servidor: guarda solo el estado más
// reciente de cada fila que cambió, con su `actualizado_en`, y los componentes muestran el
// más nuevo entre lo que trajo el RSC y lo que llegó en vivo. Así el badge cambia en
// cuanto llega el evento, aunque el `router.refresh()` que lo acompaña tarde o falle, y
// un refresh con datos más nuevos gana sobre un evento viejo. Un store por montaje
// (`ProveedorEnVivo`), nunca un singleton de módulo.

type EstadoDocumentoBd = Database['public']['Enums']['estado_documento'];

export interface CambioDocumento {
  estado: EstadoDocumentoBd;
  actualizadoEn: string;
}

export interface CambioEnvio {
  clasificacion: ClasificacionEnvio | null;
  incierto: boolean;
  trackId: string | null;
  estadoSii: string | null;
  glosaSii: string | null;
  actualizadoEn: string;
}

export interface EstadoEnVivo {
  documentos: Readonly<Record<string, CambioDocumento>>;
  envios: Readonly<Record<string, CambioEnvio>>;
  /** Fila nueva de `documentos` (payload `new` de Realtime). Ignora lo que no entiende. */
  aplicarDocumento: (fila: unknown) => boolean;
  /** Fila nueva de `envios`. */
  aplicarEnvio: (fila: unknown) => boolean;
}

const ESTADOS: readonly EstadoDocumentoBd[] = [
  'borrador',
  'firmado',
  'enviado',
  'incierto',
  'aceptado',
  'aceptado_con_reparos',
  'rechazado',
  'anulado',
];

const CLASIFICACIONES: readonly ClasificacionEnvio[] = [
  'pendiente',
  'incierto',
  'en_proceso',
  'aceptado',
  'aceptado_con_reparos',
  'rechazado',
  'inconsistente',
];

function objeto(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

const textoONulo = (v: unknown) => (typeof v === 'string' ? v : null);

/** Milisegundos de un ISO, o `NaN`. */
function ms(iso: string): number {
  return Date.parse(iso);
}

/** ¿`a` es estrictamente más nuevo que `b`? (Un empate se lo queda `b`.) */
export function esMasNuevo(a: string, b: string | null | undefined): boolean {
  if (!b) return Number.isFinite(ms(a));
  const x = ms(a);
  const y = ms(b);
  return Number.isFinite(x) && (!Number.isFinite(y) || x > y);
}

export function leerCambioDocumento(fila: unknown): (CambioDocumento & { id: string }) | null {
  const o = objeto(fila);
  if (!o || typeof o.id !== 'string' || typeof o.actualizado_en !== 'string') return null;
  const estado = o.estado;
  if (typeof estado !== 'string' || !(ESTADOS as readonly string[]).includes(estado)) return null;
  return { id: o.id, estado: estado as EstadoDocumentoBd, actualizadoEn: o.actualizado_en };
}

export function leerCambioEnvio(fila: unknown): (CambioEnvio & { id: string }) | null {
  const o = objeto(fila);
  if (!o || typeof o.id !== 'string' || typeof o.actualizado_en !== 'string') return null;
  const c = o.clasificacion;
  if (
    c !== null &&
    (typeof c !== 'string' || !(CLASIFICACIONES as readonly string[]).includes(c))
  ) {
    return null;
  }
  return {
    id: o.id,
    clasificacion: (c ?? null) as ClasificacionEnvio | null,
    incierto: o.incierto === true,
    trackId: textoONulo(o.track_id),
    estadoSii: textoONulo(o.estado_sii),
    glosaSii: textoONulo(o.glosa_sii),
    actualizadoEn: o.actualizado_en,
  };
}

export function crearStoreEnVivo() {
  return createStore<EstadoEnVivo>()((set, get) => ({
    documentos: {},
    envios: {},
    aplicarDocumento: (fila) => {
      const c = leerCambioDocumento(fila);
      if (!c) return false;
      const previo = get().documentos[c.id];
      if (previo && !esMasNuevo(c.actualizadoEn, previo.actualizadoEn)) return false;
      const { id, ...cambio } = c;
      set((s) => ({ documentos: { ...s.documentos, [id]: cambio } }));
      return true;
    },
    aplicarEnvio: (fila) => {
      const c = leerCambioEnvio(fila);
      if (!c) return false;
      const previo = get().envios[c.id];
      if (previo && !esMasNuevo(c.actualizadoEn, previo.actualizadoEn)) return false;
      const { id, ...cambio } = c;
      set((s) => ({ envios: { ...s.envios, [id]: cambio } }));
      return true;
    },
  }));
}

export type StoreEnVivo = ReturnType<typeof crearStoreEnVivo>;

/**
 * Filtros de Realtime (uno por tabla, como admite `postgres_changes`). En la lista, toda la
 * organización; en la página de un envío, solo ese envío y sus documentos, para no pedir
 * un `router.refresh()` por cualquier cambio de la organización.
 */
export function filtrosRealtime(
  organizacionId: string,
  envioId?: string,
): { documentos: string; envios: string } {
  if (envioId) return { documentos: `envio_id=eq.${envioId}`, envios: `id=eq.${envioId}` };
  const porOrganizacion = `organizacion_id=eq.${organizacionId}`;
  return { documentos: porOrganizacion, envios: porOrganizacion };
}

/** El estado vigente de un documento: el del servidor, salvo que llegara uno más nuevo en vivo. */
export function estadoVigente(
  servidor: { estado: EstadoDocumentoBd; actualizadoEn: string },
  enVivo: CambioDocumento | undefined,
): EstadoDocumentoBd {
  return enVivo && esMasNuevo(enVivo.actualizadoEn, servidor.actualizadoEn)
    ? enVivo.estado
    : servidor.estado;
}

/** Lo vigente de un envío (mismo criterio). */
export function envioVigente<
  T extends Omit<CambioEnvio, 'actualizadoEn'> & { actualizadoEn: string },
>(servidor: T, enVivo: CambioEnvio | undefined): T {
  return enVivo && esMasNuevo(enVivo.actualizadoEn, servidor.actualizadoEn)
    ? { ...servidor, ...enVivo }
    : servidor;
}
