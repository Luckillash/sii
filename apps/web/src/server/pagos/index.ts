import 'server-only';
import { envAuth, envFlow } from '../env';
import { clienteServicio } from '../supabase/service';
import { pasarelaFlow } from './flow-pasarela';
import type { DependenciasPagos } from './suscripciones';

// Punto de entrada de `server/pagos/` (PLAN-SAAS Fase 10). La pasarela es Flow (D4).

export * from './suscripciones';

/**
 * Dependencias reales (cliente de servicio + Flow), o `null` si Flow no está
 * configurado. La URL de la app sale de NEXT_PUBLIC_APP_URL: Flow necesita una URL
 * pública fija para el retorno y para el callback de los planes.
 */
export function dependenciasPagos(): DependenciasPagos | null {
  const flow = envFlow();
  if (!flow) return null;
  const urlApp = envAuth().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  return {
    db: clienteServicio(),
    pasarela: pasarelaFlow({ urlApp, configuracion: flow }),
    urlApp,
  };
}

/** ¿Se puede contratar desde la app? (para mostrar u ocultar los botones). */
export function pasarelaConfigurada(): boolean {
  return envFlow() !== null;
}
