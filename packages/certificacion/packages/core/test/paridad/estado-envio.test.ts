// Golden tests de EstadoEnvio::desdeRespuesta(). Ver
// paridad/php/operaciones/estado-envio.php. Las respuestas son sintéticas y
// anonimizadas, con el formato de QueryEstUp (RUT 76123456-0 de prueba).

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { EstadoEnvio } from '../../src/certificacion/estado-envio.ts';
import { ErrorRespuestaSii } from '../../src/comun/errores.ts';
import { casos, esperado } from '../soporte/paridad.ts';

interface EntradaEstadoEnvio {
  respuesta: string;
  trackId: string;
}

const lista = casos<EntradaEstadoEnvio>('estadoEnvio');

function comoPhp(estado: EstadoEnvio) {
  return {
    trackId: estado.trackId,
    estado: estado.estado,
    glosa: estado.glosa,
    informados: estado.informados,
    aceptados: estado.aceptados,
    rechazados: estado.rechazados,
    reparos: estado.reparos,
    enProceso: estado.enProceso(),
    procesado: estado.procesado(),
    limpio: estado.limpio(),
    resumen: estado.resumen(),
  };
}

describe('paridad: EstadoEnvio::desdeRespuesta', () => {
  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    const { bytes, meta } = esperado(caso.nombre);
    const salida = JSON.parse(bytes.toString('utf8')) as
      | ReturnType<typeof comoPhp>
      | { error: { clase: string; mensaje: string } };
    const { respuesta, trackId } = caso.entrada;

    it('el esperado corresponde a su meta', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    });

    if ('error' in salida) {
      it('Node lanza el mismo error que el PHP', () => {
        expect(salida.error.clase).toBe('RuntimeException');
        let lanzado: unknown;
        try {
          EstadoEnvio.desdeRespuesta(respuesta, trackId);
        } catch (error) {
          lanzado = error;
        }
        expect(lanzado).toBeInstanceOf(ErrorRespuestaSii);
        expect((lanzado as Error).message).toBe(salida.error.mensaje);
      });
      return;
    }

    it('Node entrega el mismo estado que el PHP', () => {
      expect(comoPhp(EstadoEnvio.desdeRespuesta(respuesta, trackId))).toStrictEqual(salida);
    });
  });
});
