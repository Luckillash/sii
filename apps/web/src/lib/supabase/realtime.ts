import type { SupabaseClient } from '@supabase/supabase-js';

// Suscripción a `postgres_changes` compartida por los `EnVivo` de Certificación, Folios y
// Documentos/Envíos.
//
// Por qué existe (bug visto en Production el 2026-11-17, Fase 8): en una carga completa de
// la página el canal se unía ANTES de que el cliente leyera la sesión de las cookies. El
// `phx_join` salía sin `access_token`, Realtime lo trataba como `anon`, y como `anon` no
// tiene SELECT sobre esas tablas, `realtime.subscription_check_filters` rechazaba toda la
// suscripción («invalid column for filter id»). El JWT llegaba después (`INITIAL_SESSION`
// → `realtime.setAuth`), pero `postgres_changes` no se reintenta: el canal quedaba
// «suscrito» sin recibir nada, y el error llegaba como mensaje `system` que nadie
// escuchaba. Al navegar dentro de la app sí funcionaba, porque la sesión ya estaba cargada.
//
// Arreglo: esperar `realtime.setAuth()` (sin argumento usa el callback de supabase-js, que
// espera `auth.getSession()`) antes de crear el canal, y tratar un `system` con
// `status: 'error'` como desconexión para que la UI lo diga.

export interface CambioEnVivo {
  tabla: string;
  /** Filtro de Realtime, p. ej. `organizacion_id=eq.<uuid>`. */
  filtro: string;
  alCambiar: (carga: { eventType: string; new: unknown }) => void;
}

/** `conectado` la primera vez; `reconectado` al volver tras una caída; `desconectado` ante error. */
export type EstadoEnVivo = 'conectado' | 'reconectado' | 'desconectado';

type ClienteRealtime = Pick<SupabaseClient, 'channel' | 'removeChannel' | 'realtime'>;

/**
 * Suscribe `cambios` en un canal `nombre` cuando la sesión ya está en Realtime. Devuelve la
 * función de limpieza para el `useEffect` (segura aunque el canal aún no exista).
 */
export function suscribirEnVivo(
  supabase: ClienteRealtime,
  nombre: string,
  cambios: readonly CambioEnVivo[],
  alEstado: (estado: EstadoEnVivo) => void,
): () => void {
  let cancelado = false;
  let canal: ReturnType<ClienteRealtime['channel']> | null = null;
  let suscritoAntes = false;

  void supabase.realtime
    .setAuth()
    .then(() => {
      if (cancelado) return;
      let c = supabase.channel(nombre);
      for (const { tabla, filtro, alCambiar } of cambios) {
        c = c.on(
          'postgres_changes',
          { event: '*', schema: 'public', table: tabla, filter: filtro },
          (carga) => alCambiar(carga as { eventType: string; new: unknown }),
        );
      }
      // «Subscribed to PostgreSQL» llega con status 'ok'; un filtro rechazado, con 'error'.
      c = c.on('system', {}, (carga: { status?: string }) => {
        if (!cancelado && carga?.status === 'error') alEstado('desconectado');
      });
      canal = c.subscribe((estado) => {
        if (cancelado) return;
        if (estado === 'SUBSCRIBED') {
          alEstado(suscritoAntes ? 'reconectado' : 'conectado');
          suscritoAntes = true;
        } else if (estado === 'CHANNEL_ERROR' || estado === 'TIMED_OUT') {
          alEstado('desconectado');
        }
      });
    })
    .catch(() => {
      if (!cancelado) alEstado('desconectado');
    });

  return () => {
    cancelado = true;
    if (canal) void supabase.removeChannel(canal);
  };
}
