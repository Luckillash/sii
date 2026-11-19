import { describe, expect, it, vi } from 'vitest';
import type { ClienteServicio } from '../supabase/service';
import { dependenciasConCliente, ErrorRpcWebhooks } from './dependencias';

// Cómo se llaman las RPC de la 0018 (y `leer_secreto`) con el cliente de servicio.

function clienteFalso(respuestas: Record<string, { data: unknown; error: unknown }>) {
  const rpc = vi.fn(async (nombre: string) => respuestas[nombre] ?? { data: null, error: null });
  return { cliente: { rpc } as unknown as ClienteServicio, rpc };
}

describe('dependenciasConCliente', () => {
  it('reclamar pasa límite y arriendo; sin filas devuelve []', async () => {
    const { cliente, rpc } = clienteFalso({
      reclamar_entregas_webhook: { data: null, error: null },
    });
    expect(await dependenciasConCliente(cliente).reclamar(32, 120)).toEqual([]);
    expect(rpc).toHaveBeenCalledWith('reclamar_entregas_webhook', {
      p_limite: 32,
      p_arriendo_segundos: 120,
    });
  });

  it('cerrar omite status y respuesta nulos (la RPC los toma como null por defecto)', async () => {
    const { cliente, rpc } = clienteFalso({
      cerrar_entrega_webhook: { data: 'fallido', error: null },
    });
    const deps = dependenciasConCliente(cliente);
    expect(
      await deps.cerrar({
        id: 5,
        intento: 2,
        entregada: false,
        statusHttp: null,
        respuesta: null,
        definitiva: false,
      }),
    ).toBe('fallido');
    expect(rpc).toHaveBeenLastCalledWith('cerrar_entrega_webhook', {
      p_id: 5,
      p_intento: 2,
      p_entregada: false,
      p_definitiva: false,
    });
    await deps.cerrar({
      id: 6,
      intento: 1,
      entregada: true,
      statusHttp: 200,
      respuesta: 'ok',
      definitiva: false,
    });
    expect(rpc).toHaveBeenLastCalledWith('cerrar_entrega_webhook', {
      p_id: 6,
      p_intento: 1,
      p_entregada: true,
      p_status_http: 200,
      p_respuesta: 'ok',
      p_definitiva: false,
    });
  });

  it('un error de PostgREST se vuelve ErrorRpcWebhooks sin el mensaje original', async () => {
    const { cliente } = clienteFalso({
      leer_secreto: { data: null, error: { code: '42501', message: 'detalle con datos' } },
    });
    const error = await dependenciasConCliente(cliente)
      .leerSecreto('sec-1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorRpcWebhooks);
    expect((error as Error).message).toBe('webhooks: falló leer_secreto (42501)');
  });
});
