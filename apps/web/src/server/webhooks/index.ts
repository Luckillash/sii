import 'server-only';
import {
  type DependenciasWebhooks,
  ejecutarEntregas as ejecutarConDependencias,
  type ResumenWebhooks,
} from './cron';
import { resolverDependenciasWebhooks } from './dependencias';

// Entrega de webhooks (PLAN-SAAS Fase 11). La usa `/api/cron/webhooks` (pg_cron, cada
// minuto, job `entregar-webhooks` de la 0019).
//
//   constantes.ts   horario, monitor, límites y presupuesto de la corrida
//   firma.ts        firmar / verificarFirma (cabecera Boleteame-Firma)
//   ssrf.ts         lookup que rechaza IPs privadas, loopback, link-local, etc.
//   entregar.ts     el POST con node:https (sin redirecciones, 10 s, 64 KB)
//   cron.ts         reclamar → firmar → enviar → cerrar, 8 en paralelo
//   dependencias.ts RPC de la 0018 con service_role y el aviso a Sentry

export type { CierreEntrega, EntregaReclamada, ResumenWebhooks } from './cron';
export { cabeceraFirma, firmar, verificarFirma } from './firma';

/** Una corrida con las dependencias reales (o las que se pasen, en las pruebas). */
export function ejecutarEntregas(
  dependencias: Partial<DependenciasWebhooks> = {},
): Promise<ResumenWebhooks> {
  return ejecutarConDependencias(resolverDependenciasWebhooks(dependencias));
}
