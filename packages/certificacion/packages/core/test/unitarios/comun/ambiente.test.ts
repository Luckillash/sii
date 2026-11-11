// Port de tests/Folios/AmbienteTest.php (winex/certificacion v1.9.1).

import { describe, expect, it } from 'vitest';
import {
  AMBIENTES,
  type Ambiente,
  datosAmbiente,
  esAmbiente,
} from '../../../src/comun/ambiente.ts';

describe('Ambiente', () => {
  it('certificación apunta a maullin', () => {
    expect(datosAmbiente('certificacion')).toEqual({
      host: 'maullin.sii.cl',
      portal: 'https://maullin.sii.cl',
      idk: '100',
    });
  });

  it('producción apunta a palena', () => {
    expect(datosAmbiente('produccion')).toEqual({
      host: 'palena.sii.cl',
      portal: 'https://palena.sii.cl',
      idk: '300',
    });
  });

  it('los ambientes nunca comparten host ni IDK', () => {
    const cert = datosAmbiente('certificacion');
    const prod = datosAmbiente('produccion');
    expect(cert.host).not.toBe(prod.host);
    expect(cert.idk).not.toBe(prod.idk);
  });

  it('el portal es https + host', () => {
    for (const ambiente of AMBIENTES) {
      const { host, portal } = datosAmbiente(ambiente);
      expect(portal).toBe(`https://${host}`);
    }
  });

  it('rechaza un ambiente desconocido (llamadas desde JS sin tipos)', () => {
    expect(esAmbiente('certificacion')).toBe(true);
    expect(esAmbiente('Produccion')).toBe(false);
    expect(() => datosAmbiente('maullin' as Ambiente)).toThrow(TypeError);
  });

  it('los datos no se pueden modificar', () => {
    expect(Object.isFrozen(datosAmbiente('produccion'))).toBe(true);
  });
});
