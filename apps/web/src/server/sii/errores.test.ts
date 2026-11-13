import {
  DeclaracionInciertaError,
  ErrorCertificado,
  ErrorFirma,
  ErrorPostulacion,
  ErrorRespuestaSii,
  ErrorSolicitudFolios,
  ErrorTimbre,
  ErrorTransporte,
  ErrorValidacion,
  exigirStatus,
  FolioInicialRequeridoError,
  FoliosSinCafError,
  SesionCaducaError,
  SetSinDescargarError,
  SiiError,
  TransporteFalso,
} from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import {
  CODIGO_DE_RESULTADO,
  detalleSeguro,
  ErrorConfig,
  ErrorIncierto,
  ErrorUso,
  ErrorVerificacion,
  MENSAJE_INESPERADO,
  mensajeParaUsuario,
  resultadoDeError,
  sanearDetalle,
  sanearTexto,
} from './errores';

function conNombre(nombre: string, mensaje = 'Mensaje del módulo.'): Error {
  const error = new Error(mensaje);
  error.name = nombre;
  return error;
}

/** Con la forma de ErrorCredenciales de credenciales.ts (sin importarlo). */
function credenciales(resultado: 'config' | 'error'): Error {
  return Object.assign(conNombre('ErrorCredenciales', 'El certificado está revocado'), {
    motivo: resultado === 'config' ? 'revocado' : 'base',
    resultado,
    mensaje: { titulo: 'El certificado está revocado', detalle: 'Sube un certificado vigente.' },
  });
}

/** Un ErrorTransporte real, lanzado por la librería con el transporte falso. */
async function errorTransporteReal(): Promise<ErrorTransporte> {
  const url = 'https://maullin.sii.cl/cgi_dte/UPL/DTEUpload?TOKEN=ABCDEF123456&x=1';
  const transporte = new TransporteFalso();
  const respuesta = await transporte.enviar({ metodo: 'GET', url });
  try {
    exigirStatus(respuesta, url);
  } catch (error) {
    return error as ErrorTransporte;
  }
  throw new Error('exigirStatus no lanzó');
}

describe('resultadoDeError: paridad con codigoDeError() de la CLI', () => {
  // Código esperado según packages/certificacion/apps/cli/src/errores.ts.
  const casos: [string, unknown, number][] = [
    ['ErrorCertificado', new ErrorCertificado('x'), 3],
    ['DeclaracionInciertaError', new DeclaracionInciertaError('76543210-3'), 6],
    ['FoliosSinCafError', new FoliosSinCafError(1, 10, 'certificacion', 'maullin.sii.cl'), 6],
    ['ErrorTransporte', new ErrorTransporte('x', 'https://maullin.sii.cl/', 503), 4],
    ['ErrorRespuestaSii', new ErrorRespuestaSii('x', { estado: 'RCH' }), 5],
    ['ErrorPostulacion', new ErrorPostulacion('x'), 5],
    ['SetSinDescargarError', new SetSinDescargarError('x'), 5],
    ['ErrorSolicitudFolios', new ErrorSolicitudFolios('x'), 5],
    ['SesionCaducaError', new SesionCaducaError('x'), 5],
    ['FolioInicialRequeridoError', new FolioInicialRequeridoError('certificacion', '1'), 5],
    ['ErrorValidacion', new ErrorValidacion('x'), 1],
    ['ErrorFirma', new ErrorFirma('x'), 1],
    ['ErrorTimbre', new ErrorTimbre('x'), 1],
    ['SiiError', new SiiError('x'), 1],
    ['Error', new Error('x'), 1],
    ['string', 'algo', 1],
    ['undefined', undefined, 1],
  ];

  it.each(casos)('%s', (_nombre, error, codigo) => {
    expect(CODIGO_DE_RESULTADO[resultadoDeError(error)]).toBe(codigo);
  });

  it('errores de la app', () => {
    expect(resultadoDeError(new ErrorUso('x'))).toBe('uso');
    expect(resultadoDeError(new ErrorConfig('x'))).toBe('config');
    expect(resultadoDeError(new ErrorVerificacion('x'))).toBe('verificacion_fallida');
    expect(resultadoDeError(new ErrorIncierto('x'))).toBe('incierto');
  });

  it('errores de otros módulos de la capa SII, por nombre y forma', () => {
    expect(resultadoDeError(conNombre('ErrorCredenciales'))).toBe('config');
    expect(resultadoDeError(credenciales('error'))).toBe('error');
    expect(resultadoDeError(credenciales('config'))).toBe('config');
    expect(
      resultadoDeError(Object.assign(conNombre('ErrorCredenciales'), { resultado: 'ok' })),
    ).toBe('config');
    expect(resultadoDeError(conNombre('BloqueoOcupadoError'))).toBe('transporte');
    for (const nombre of ['ErrorTokenStore', 'ErrorBloqueo', 'ErrorSesiones', 'ErrorAlmacen']) {
      expect(resultadoDeError(conNombre(nombre))).toBe('error');
    }
    expect(resultadoDeError(conNombre('toString'))).toBe('error');
  });

  it('un ErrorTransporte lanzado por la librería con TransporteFalso', async () => {
    const error = await errorTransporteReal();
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect(resultadoDeError(error)).toBe('transporte');
  });
});

describe('mensajeParaUsuario', () => {
  it('muestra el mensaje de la librería con título y cierre según el resultado', async () => {
    const m = mensajeParaUsuario('transporte', await errorTransporteReal());
    expect(m.titulo).toBe('No pudimos comunicarnos con el SII');
    expect(m.detalle).toContain('maullin.sii.cl respondió HTTP 404');
    expect(m.detalle).toMatch(/Puedes reintentar en unos minutos\.$/);
    expect(m.detalle).not.toContain('TOKEN');
  });

  it('no repite el cierre si el mensaje ya lo trae', () => {
    const m = mensajeParaUsuario('uso', new ErrorUso('Falta el RUT. No se envió nada al SII.'));
    expect(m.detalle).toBe('Falta el RUT. No se envió nada al SII.');
  });

  it('un error desconocido da un texto genérico, nunca su mensaje ni su cause', () => {
    const error = new Error('falló pg: password=hunter2', { cause: new Error('TOKEN=ABC') });
    expect(mensajeParaUsuario('error', error)).toEqual(MENSAJE_INESPERADO);
    const m = mensajeParaUsuario('config', error);
    expect(JSON.stringify(m)).not.toContain('hunter2');
    expect(m.detalle).toContain('No se envió nada al SII.');
  });

  it('el incierto de la librería se muestra tal cual, con su instrucción', () => {
    const m = mensajeParaUsuario(
      'incierto',
      new FoliosSinCafError(11, 20, 'certificacion', 'maullin.sii.cl'),
    );
    expect(m.titulo).toBe('No sabemos si el SII completó la operación');
    expect(m.detalle).toContain('Folios ya autorizados');
    expect(m.detalle).toContain('No la repitas hasta revisar en el SII si quedó hecha.');
  });

  it('usa el MensajeError propio de ErrorCredenciales y BloqueoOcupadoError', () => {
    expect(mensajeParaUsuario('config', credenciales('config'))).toEqual({
      titulo: 'El certificado está revocado',
      detalle: 'Sube un certificado vigente.',
    });
    const bloqueo = Object.assign(conNombre('BloqueoOcupadoError'), {
      mensajeUsuario: { titulo: 'Hay otra operación en curso', detalle: 'Espera y reintenta.' },
    });
    expect(mensajeParaUsuario('transporte', bloqueo)).toEqual({
      titulo: 'Hay otra operación en curso',
      detalle: 'Espera y reintenta.',
    });
  });

  it('un error desconocido con forma de MensajeError no se muestra', () => {
    const ajeno = Object.assign(new Error('x'), {
      mensaje: { titulo: 'clave=Hunter2', detalle: 'y' },
    });
    expect(mensajeParaUsuario('error', ajeno)).toEqual(MENSAJE_INESPERADO);
  });
});

describe('detalleSeguro', () => {
  it('ErrorTransporte: nombre, status y host, sin ruta ni query', async () => {
    const error = await errorTransporteReal();
    expect(detalleSeguro(error)).toEqual({
      nombre: 'ErrorTransporte',
      status: 404,
      host: 'maullin.sii.cl',
    });
  });

  it('ErrorRespuestaSii: estado y glosa', () => {
    expect(
      detalleSeguro(new ErrorRespuestaSii('x', { estado: 'RCH', glosa: 'Firma inválida' })),
    ).toEqual({ nombre: 'ErrorRespuestaSii', estado: 'RCH', glosa: 'Firma inválida' });
    // Un «estado» que no es un código corto del SII no se guarda.
    expect(detalleSeguro(new ErrorRespuestaSii('x', { estado: 'XHS4TQ1FZBNVG' }))).toEqual({
      nombre: 'ErrorRespuestaSii',
      estado: '[Filtrado]',
    });
  });

  it('FoliosSinCafError y FolioInicialRequeridoError', () => {
    expect(detalleSeguro(new FoliosSinCafError(5, 9, 'produccion', 'palena.sii.cl'))).toEqual({
      nombre: 'FoliosSinCafError',
      folio_desde: 5,
      folio_hasta: 9,
      ambiente: 'produccion',
    });
    expect(detalleSeguro(new FolioInicialRequeridoError('certificacion', '1'))).toEqual({
      nombre: 'FolioInicialRequeridoError',
      folio_sugerido: '1',
      ambiente: 'certificacion',
    });
  });

  it('un error desconocido: solo el nombre, sin message, cause ni stack', () => {
    const error = new Error('secreto=abc', { cause: new Error('TOKEN=XYZ') });
    expect(detalleSeguro(error)).toEqual({ nombre: 'Error' });
    expect(detalleSeguro('texto')).toEqual({ nombre: 'string' });
  });
});

describe('sanearTexto y sanearDetalle', () => {
  const PEM =
    '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----';
  const JWT =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  it('quita PEM, JWT, TOKEN=, cookies, pares clave=valor y tokens largos', () => {
    const texto = sanearTexto(
      `pem ${PEM} jwt ${JWT} TOKEN=TKN99887766 Cookie: TOKEN=a; NETSCAPE_LIVEWIRE=b ` +
        'clave=MiClave123 password: "otra clave" largo a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
    );
    for (const secreto of [
      'MIIEvQIBADANBgkqhkiG9w0BAQEFAASC',
      JWT,
      'TKN99887766',
      'NETSCAPE_LIVEWIRE=b',
      'MiClave123',
      'otra clave',
      'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8',
    ]) {
      expect(texto).not.toContain(secreto);
    }
  });

  it('respeta textos normales, UUID y números de folio o trackId', () => {
    expect(sanearTexto('El SII respondió HTTP 503 en maullin.sii.cl.')).toBe(
      'El SII respondió HTTP 503 en maullin.sii.cl.',
    );
    expect(
      sanearDetalle({
        id: '0b8f2c1e-5a4d-4c3b-9e2f-1a2b3c4d5e6f',
        track_id: 1234567890123,
        folios: [1, 2, 3],
      }),
    ).toEqual({
      id: '0b8f2c1e-5a4d-4c3b-9e2f-1a2b3c4d5e6f',
      track_id: 1234567890123,
      folios: [1, 2, 3],
    });
  });

  it('filtra claves sospechosas aunque estén anidadas, y descarta lo no serializable', () => {
    const detalle = sanearDetalle({
      token: 'TKN',
      clave: 'x',
      pfx: 'y',
      cookies: ['TOKEN=a'],
      secreto: 's',
      RSASK: 'r',
      api_key: 'k',
      Authorization: 'Bearer zz',
      anidado: { tokenSii: 'abc', bien: 'visible', fecha: new Date('2026-11-13T12:00:00Z') },
      sesion: { cookies: 'x' },
      csrf: 'c',
      fn: () => 1,
    });
    expect(detalle).toEqual({
      token: '[Filtrado]',
      clave: '[Filtrado]',
      pfx: '[Filtrado]',
      cookies: '[Filtrado]',
      secreto: '[Filtrado]',
      RSASK: '[Filtrado]',
      api_key: '[Filtrado]',
      Authorization: '[Filtrado]',
      anidado: { tokenSii: '[Filtrado]', bien: 'visible', fecha: '2026-11-13T12:00:00.000Z' },
      sesion: '[Filtrado]',
      csrf: '[Filtrado]',
    });
  });

  it('un objeto con ciclos o BigInt queda vacío', () => {
    const ciclo: Record<string, unknown> = {};
    ciclo.yo = ciclo;
    expect(sanearDetalle(ciclo)).toEqual({});
    expect(sanearDetalle({ n: 1n })).toEqual({});
  });
});
