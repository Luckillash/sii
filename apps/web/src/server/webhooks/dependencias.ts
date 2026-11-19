import 'server-only';
import * as Sentry from '@sentry/nextjs';
import { type ClienteServicio, clienteServicio } from '../supabase/service';
import { MONITOR_WEBHOOKS } from './constantes';
import type { AvisoWebhooks, DependenciasWebhooks, EntregaReclamada } from './cron';
import { crearEnviarHttp } from './entregar';

// Dependencias reales de la corrida de webhooks: RPC de la 0018 con service_role (las
// tres son solo service_role), `leer_secreto` de la 0001 y el POST con `node:https`.

/** Error de una RPC sin el mensaje de PostgREST (puede traer datos de la fila). */
export class ErrorRpcWebhooks extends Error {
  override readonly name = 'ErrorRpcWebhooks';
  constructor(
    readonly rpc: string,
    readonly codigo: string | undefined,
  ) {
    super(`webhooks: falló ${rpc}${codigo ? ` (${codigo})` : ''}`);
  }
}

export function avisarEnSentry(aviso: AvisoWebhooks): void {
  Sentry.withScope((scope) => {
    scope.setTag('cron', MONITOR_WEBHOOKS);
    scope.setLevel('warning');
    if (aviso.extra) scope.setExtras(aviso.extra);
    if (aviso.error instanceof ErrorRpcWebhooks) {
      scope.setExtras({ rpc: aviso.error.rpc, codigo: aviso.error.codigo ?? '' });
    } else if (aviso.error instanceof Error) {
      scope.setExtra('tipo', aviso.error.name);
    }
    Sentry.captureMessage(aviso.mensaje);
  });
}

export function dependenciasConCliente(
  cliente: ClienteServicio,
): Omit<DependenciasWebhooks, 'enviar' | 'reloj' | 'avisar'> {
  return {
    async reclamar(limite, arriendoSegundos) {
      const { data, error } = await cliente.rpc('reclamar_entregas_webhook', {
        p_limite: limite,
        p_arriendo_segundos: arriendoSegundos,
      });
      if (error) throw new ErrorRpcWebhooks('reclamar_entregas_webhook', error.code);
      return (data ?? []) as EntregaReclamada[];
    },
    async leerSecreto(secretId) {
      const { data, error } = await cliente.rpc('leer_secreto', { p_id: secretId });
      if (error) throw new ErrorRpcWebhooks('leer_secreto', error.code);
      return data ?? '';
    },
    async cerrar(cierre) {
      const { data, error } = await cliente.rpc('cerrar_entrega_webhook', {
        p_id: cierre.id,
        p_intento: cierre.intento,
        p_entregada: cierre.entregada,
        ...(cierre.statusHttp === null ? {} : { p_status_http: cierre.statusHttp }),
        ...(cierre.respuesta === null ? {} : { p_respuesta: cierre.respuesta }),
        p_definitiva: cierre.definitiva,
      });
      if (error) throw new ErrorRpcWebhooks('cerrar_entrega_webhook', error.code);
      return data ?? null;
    },
  };
}

export function resolverDependenciasWebhooks(
  parciales: Partial<DependenciasWebhooks> = {},
): DependenciasWebhooks {
  const necesitaCliente = !parciales.reclamar || !parciales.leerSecreto || !parciales.cerrar;
  const base = necesitaCliente ? dependenciasConCliente(clienteServicio()) : null;
  return {
    reclamar: parciales.reclamar ?? (base as NonNullable<typeof base>).reclamar,
    leerSecreto: parciales.leerSecreto ?? (base as NonNullable<typeof base>).leerSecreto,
    cerrar: parciales.cerrar ?? (base as NonNullable<typeof base>).cerrar,
    enviar: parciales.enviar ?? crearEnviarHttp(),
    reloj: parciales.reloj ?? (() => new Date()),
    avisar: parciales.avisar ?? avisarEnSentry,
  };
}
