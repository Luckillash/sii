import { ErrorTransporte, TransporteFalso, TransporteUndici } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { crearTransporte } from './transporte';

describe('crearTransporte', () => {
  it('sin opciones crea un TransporteUndici, que se cierra con await using', async () => {
    let creado: TransporteUndici | undefined;
    {
      await using transporte = crearTransporte({ msConexion: 1_000 });
      expect(transporte).toBeInstanceOf(TransporteUndici);
      creado = transporte as TransporteUndici;
    }
    // Cerrado: rechaza antes de salir a la red.
    await expect(
      creado.enviar({
        metodo: 'GET',
        url: 'https://maullin.sii.cl/cvc_cgi/dte/of_solicita_folios',
      }),
    ).rejects.toThrow(/ya se cerró/);
  });

  it('cada llamada entrega un transporte nuevo (nada se comparte entre peticiones)', async () => {
    await using a = crearTransporte();
    await using b = crearTransporte();
    expect(a).not.toBe(b);
  });

  it('con un transporte inyectado delega en él y no sale a la red', async () => {
    const falso = new TransporteFalso({ 'maullin.sii.cl/*': '<html>ok</html>' });
    let envuelto: ReturnType<typeof crearTransporte> | undefined;
    {
      await using transporte = crearTransporte({ transporte: falso });
      envuelto = transporte;
      const respuesta = await transporte.enviar({
        metodo: 'GET',
        url: 'https://maullin.sii.cl/cvc_cgi/dte/of_solicita_folios?x=1',
      });
      expect(respuesta.status).toBe(200);
      expect(respuesta.cuerpo.toString()).toBe('<html>ok</html>');
    }
    expect(falso.enviadas).toHaveLength(1);

    // Después del bloque rechaza, sin el query en la URL del error.
    const error = await envuelto
      .enviar({ metodo: 'GET', url: 'https://maullin.sii.cl/ruta?token=SECRETO' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect((error as ErrorTransporte).url).toBe('https://maullin.sii.cl/ruta');
    expect((error as Error).message).not.toContain('SECRETO');
    expect(falso.enviadas).toHaveLength(1);

    // El inyectado sigue siendo de quien lo creó.
    await expect(
      falso.enviar({ metodo: 'GET', url: 'https://maullin.sii.cl/x' }),
    ).resolves.toBeDefined();
  });
});
