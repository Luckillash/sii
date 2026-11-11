import { describe, expect, it } from 'vitest';
import {
  DeclaracionInciertaError,
  ErrorPostulacion,
  ErrorRespuestaSii,
  ErrorSolicitudFolios,
  ErrorTransporte,
  FoliosSinCafError,
  SesionCaducaError,
  SiiError,
} from '../../../src/comun/errores.ts';

describe('errores', () => {
  it('todos derivan de SiiError y de Error, con su nombre de clase', () => {
    const error = new SesionCaducaError('caducó');
    expect(error).toBeInstanceOf(ErrorSolicitudFolios);
    expect(error).toBeInstanceOf(SiiError);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('SesionCaducaError');
  });

  it('conserva la causa técnica aparte del mensaje', () => {
    const causa = new Error('ECONNRESET /tmp/sii_123');
    const error = new ErrorTransporte(
      'No se pudo conectar con el SII (maullin.sii.cl).',
      'https://maullin.sii.cl/x',
      undefined,
      { cause: causa },
    );
    expect(error.message).not.toContain('/tmp');
    expect(error.cause).toBe(causa);
    expect(error.status).toBeUndefined();
    expect(error.url).toBe('https://maullin.sii.cl/x');
  });

  it('ErrorTransporte lleva el código HTTP cuando hubo respuesta', () => {
    expect(new ErrorTransporte('falló', 'https://x', 503).status).toBe(503);
  });

  it('ErrorRespuestaSii lleva estado y glosa', () => {
    const error = new ErrorRespuestaSii('rechazado', {
      estado: 'RCT',
      glosa: 'Rechazado por error en carátula',
    });
    expect(error.estado).toBe('RCT');
    expect(error.glosa).toBe('Rechazado por error en carátula');
  });

  it('FoliosSinCafError explica qué revisar y guarda el rango', () => {
    const error = new FoliosSinCafError(11, 20, 'certificacion', 'maullin.sii.cl', 'Timeout.');
    expect(error.message).toContain('folios 11 al 20');
    expect(error.message).toContain('maullin.sii.cl');
    expect(error.message).toContain('Folios ya autorizados');
    expect(error.message.endsWith(' Timeout.')).toBe(true);
    expect([error.folioDesde, error.folioHasta, error.ambiente]).toEqual([11, 20, 'certificacion']);
  });

  it('DeclaracionInciertaError es un ErrorPostulacion con el RUT', () => {
    const error = new DeclaracionInciertaError('76123456-0');
    expect(error).toBeInstanceOf(ErrorPostulacion);
    expect(error.rutEmpresa).toBe('76123456-0');
    expect(error.message).toContain('Consulta el estado');
  });
});
