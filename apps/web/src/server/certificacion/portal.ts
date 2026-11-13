import 'server-only';
import type { ResultadoPaso } from '@/lib/certificacion';
import { ErrorVerificacion } from '../sii/errores';
import type { ClienteServicio } from '../supabase/service';
import { ejecutar, errorDeEjecucion } from './comun';
import type { DependenciasCertificacion } from './dependencias';
import type { ContextoCertificacion } from './tipos';

// `verificar_portal` antes de postular y de declarar (PLAN-SAAS Fase 5): un GET público,
// sin login, que revisa que el portal GWT de la declaración (www4) siga siendo la
// versión que conoce la librería (`DeclaracionBoletas.verificarPortal`). Si cambió, la
// operación queda en `verificacion_fallida` (código 7) y el paso se bloquea: con un
// portal distinto, las llamadas GWT-RPC fallarían a mitad de camino.
//
// No es ⚠️ (no graba nada en el SII): se registra en `operaciones_sii` con
// `confirmada = true` porque sí sale al SII. En el ensayo no se ejecuta.

export const MENSAJE_PORTAL_CAMBIADO =
  'El portal de certificación del SII cambió y la integración todavía no se adapta a la versión nueva. No se envió nada al SII. Ya quedó registrado; vuelve a intentarlo cuando actualicemos la integración.';

/** `null` si el portal está vigente; si no, el `ResultadoPaso` que bloquea el paso. */
export async function verificarPortalAntes(
  deps: DependenciasCertificacion,
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
): Promise<ResultadoPaso | null> {
  const r = await ejecutar(
    deps,
    cliente,
    ctx,
    { operacion: 'verificar_portal', confirmada: true },
    async ({ agregarDetalle }) => {
      await using transporte = deps.transporte();
      const problemas = await deps.sii
        .declaracion({ transporte, reloj: deps.reloj })
        .verificarPortal();
      agregarDetalle({ problemas: problemas.length });
      if (problemas.length > 0) {
        agregarDetalle({ faltantes: problemas });
        throw new ErrorVerificacion(MENSAJE_PORTAL_CAMBIADO);
      }
    },
  );
  return r.ok ? null : errorDeEjecucion(r);
}
