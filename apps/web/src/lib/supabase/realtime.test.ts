import { describe, expect, it, vi } from 'vitest';
import { type EstadoEnVivo, suscribirEnVivo } from './realtime';

// Doble mínimo del cliente: registra el orden de llamadas para probar que el canal se
// crea DESPUÉS de que la sesión llegó a Realtime (bug de carga completa, Fase 8).

type Manejador = (carga: unknown) => void;

function clienteFalso(opciones: { setAuthFalla?: boolean } = {}) {
  const orden: string[] = [];
  const handlers: { tipo: string; filtro: unknown; fn: Manejador }[] = [];
  let alSuscribir: ((estado: string) => void) | null = null;
  let resolverAuth: () => void = () => {};
  const canal = {
    on(tipo: string, filtro: unknown, fn: Manejador) {
      handlers.push({ tipo, filtro, fn });
      return canal;
    },
    subscribe(fn: (estado: string) => void) {
      orden.push('subscribe');
      alSuscribir = fn;
      return canal;
    },
  };
  const cliente = {
    realtime: {
      setAuth: vi.fn(() => {
        orden.push('setAuth');
        return opciones.setAuthFalla
          ? Promise.reject(new Error('sin red'))
          : new Promise<void>((r) => {
              resolverAuth = r;
            });
      }),
    },
    channel: vi.fn((nombre: string) => {
      orden.push(`channel:${nombre}`);
      return canal;
    }),
    removeChannel: vi.fn(async () => 'ok'),
  };
  return {
    // biome-ignore lint/suspicious/noExplicitAny: doble de prueba del cliente de Supabase
    cliente: cliente as any,
    orden,
    handlers,
    autenticar: async () => {
      resolverAuth();
      await Promise.resolve();
      await Promise.resolve();
    },
    estado: (e: string) => alSuscribir?.(e),
    removeChannel: cliente.removeChannel,
    channel: cliente.channel,
  };
}

describe('suscribirEnVivo', () => {
  it('crea el canal solo después de que la sesión llegó a Realtime', async () => {
    const f = clienteFalso();
    suscribirEnVivo(
      f.cliente,
      'envio:1',
      [{ tabla: 'envios', filtro: 'id=eq.1', alCambiar: () => {} }],
      () => {},
    );
    expect(f.orden).toEqual(['setAuth']);
    expect(f.channel).not.toHaveBeenCalled();
    await f.autenticar();
    expect(f.orden).toEqual(['setAuth', 'channel:envio:1', 'subscribe']);
    expect(f.handlers.map((h) => h.tipo)).toEqual(['postgres_changes', 'system']);
    expect(f.handlers[0]?.filtro).toEqual({
      event: '*',
      schema: 'public',
      table: 'envios',
      filter: 'id=eq.1',
    });
  });

  it('informa conectado, reconectado y desconectado', async () => {
    const f = clienteFalso();
    const estados: EstadoEnVivo[] = [];
    suscribirEnVivo(f.cliente, 'c', [], (e) => estados.push(e));
    await f.autenticar();
    f.estado('SUBSCRIBED');
    f.estado('CHANNEL_ERROR');
    f.estado('SUBSCRIBED');
    f.estado('TIMED_OUT');
    expect(estados).toEqual(['conectado', 'desconectado', 'reconectado', 'desconectado']);
  });

  it('un mensaje system con error (filtro rechazado) se informa como desconectado', async () => {
    const f = clienteFalso();
    const estados: EstadoEnVivo[] = [];
    suscribirEnVivo(f.cliente, 'c', [], (e) => estados.push(e));
    await f.autenticar();
    const system = f.handlers.find((h) => h.tipo === 'system');
    system?.fn({ status: 'ok', message: 'Subscribed to PostgreSQL' });
    expect(estados).toEqual([]);
    system?.fn({ status: 'error', message: 'invalid column for filter id' });
    expect(estados).toEqual(['desconectado']);
  });

  it('entrega los cambios a su manejador', async () => {
    const f = clienteFalso();
    const alCambiar = vi.fn();
    suscribirEnVivo(
      f.cliente,
      'c',
      [{ tabla: 'documentos', filtro: 'x=eq.1', alCambiar }],
      () => {},
    );
    await f.autenticar();
    f.handlers[0]?.fn({ eventType: 'UPDATE', new: { estado: 'aceptado' } });
    expect(alCambiar).toHaveBeenCalledWith({ eventType: 'UPDATE', new: { estado: 'aceptado' } });
  });

  it('si se limpia antes de autenticar, no crea el canal', async () => {
    const f = clienteFalso();
    const limpiar = suscribirEnVivo(f.cliente, 'c', [], () => {});
    limpiar();
    await f.autenticar();
    expect(f.channel).not.toHaveBeenCalled();
    expect(f.removeChannel).not.toHaveBeenCalled();
  });

  it('al limpiar después de suscribir, quita el canal y deja de informar', async () => {
    const f = clienteFalso();
    const estados: EstadoEnVivo[] = [];
    const limpiar = suscribirEnVivo(f.cliente, 'c', [], (e) => estados.push(e));
    await f.autenticar();
    limpiar();
    expect(f.removeChannel).toHaveBeenCalledTimes(1);
    f.estado('SUBSCRIBED');
    expect(estados).toEqual([]);
  });

  it('si no puede preparar la sesión, informa desconectado', async () => {
    const f = clienteFalso({ setAuthFalla: true });
    const estados: EstadoEnVivo[] = [];
    suscribirEnVivo(f.cliente, 'c', [], (e) => estados.push(e));
    await new Promise((r) => setTimeout(r, 0));
    expect(estados).toEqual(['desconectado']);
    expect(f.channel).not.toHaveBeenCalled();
  });
});
