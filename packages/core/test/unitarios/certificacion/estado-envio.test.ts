// Port de tests/Certificacion/EstadoEnvioTest.php (winex/certificacion v1.9.1,
// Apache-2.0), más los casos propios del port (inmutabilidad, error tipado,
// entidades y blancos como el PHP).

import { describe, expect, it } from 'vitest';
import { decodificarEntidadesXml, EstadoEnvio } from '../../../src/certificacion/estado-envio.ts';
import { escaparXml } from '../../../src/comun/codificacion.ts';
import { ErrorRespuestaSii, SiiError } from '../../../src/comun/errores.ts';

/** [tipo, informados, aceptados, rechazados, reparos] */
type Tipo = [string, number, number, number, number];

function respuesta(estado: string, glosa: string, tipos: Tipo[] = []): string {
  const cuerpo = tipos
    .map(
      ([tipo, inf, ace, rec, rep]) =>
        `<TIPO_DOCTO>${tipo}</TIPO_DOCTO><INFORMADOS>${inf}</INFORMADOS><ACEPTADOS>${ace}</ACEPTADOS>` +
        `<RECHAZADOS>${rec}</RECHAZADOS><REPAROS>${rep}</REPAROS>`,
    )
    .join('');
  return (
    `<SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY>${cuerpo}</SII:RESP_BODY>` +
    `<SII:RESP_HDR><TRACKID>123</TRACKID><ESTADO>${estado}</ESTADO><GLOSA>${glosa}</GLOSA></SII:RESP_HDR></SII:RESPUESTA>`
  );
}

describe('EstadoEnvio (port de EstadoEnvioTest)', () => {
  it('envío procesado y limpio', () => {
    const estado = EstadoEnvio.desdeRespuesta(
      respuesta('EPR', 'Envio Procesado', [['39', 5, 5, 0, 0]]),
      '999',
    );

    expect(estado.trackId).toBe('123');
    expect(estado.procesado()).toBe(true);
    expect(estado.limpio()).toBe(true);
    expect(estado.enProceso()).toBe(false);
    expect(estado.resumen()).toContain('5 informados, 5 aceptados');
  });

  it('con rechazos no es limpio', () => {
    const estado = EstadoEnvio.desdeRespuesta(
      respuesta('EPR', 'Envio Procesado', [['39', 5, 4, 1, 0]]),
      '1',
    );
    expect(estado.procesado()).toBe(true);
    expect(estado.limpio()).toBe(false);
  });

  it('los rechazos anulan lo limpio aunque todo lo informado figure aceptado', () => {
    const estado = EstadoEnvio.desdeRespuesta(
      respuesta('EPR', 'Envio Procesado', [['39', 5, 5, 1, 0]]),
      '1',
    );
    expect(estado.limpio()).toBe(false);
  });

  it('con reparos no es limpio', () => {
    const estado = EstadoEnvio.desdeRespuesta(
      respuesta('EPR', 'Envio Procesado', [['39', 5, 5, 0, 2]]),
      '1',
    );
    expect(estado.limpio()).toBe(false);
  });

  it('sin documentos informados no es limpio', () => {
    expect(EstadoEnvio.desdeRespuesta(respuesta('EPR', 'Envio Procesado'), '1').limpio()).toBe(
      false,
    );
  });

  it('suma varios tipos de documento', () => {
    const estado = EstadoEnvio.desdeRespuesta(
      respuesta('EPR', 'ok', [
        ['39', 3, 3, 0, 0],
        ['41', 2, 2, 0, 0],
      ]),
      '1',
    );
    expect(estado.informados).toBe(5);
    expect(estado.aceptados).toBe(5);
    expect(estado.limpio()).toBe(true);
  });

  it.each(['REC', 'SOK', 'CRT', 'FOK', 'PRD'])(
    'el estado intermedio %s sigue en proceso',
    (codigo) => {
      const estado = EstadoEnvio.desdeRespuesta(respuesta(codigo, 'validando'), '1');
      expect(estado.enProceso()).toBe(true);
      expect(estado.procesado()).toBe(false);
      expect(estado.limpio()).toBe(false);
    },
  );

  it('acepta la respuesta con entidades HTML', () => {
    // htmlspecialchars() por defecto: escapa también las comillas.
    const escapada = escaparXml(respuesta('EPR', 'ok', [['39', 1, 1, 0, 0]]), 'defecto');
    expect(EstadoEnvio.desdeRespuesta(escapada, '1').limpio()).toBe(true);
  });

  it('sin estado lanza excepción', () => {
    expect(() => EstadoEnvio.desdeRespuesta('<SII:RESPUESTA></SII:RESPUESTA>', '777')).toThrow(
      ErrorRespuestaSii,
    );
    expect(() => EstadoEnvio.desdeRespuesta('<SII:RESPUESTA></SII:RESPUESTA>', '777')).toThrow(
      '777',
    );
  });
});

describe('EstadoEnvio: casos propios del port', () => {
  it('el error es un SiiError con el mensaje del PHP', () => {
    let lanzado: unknown;
    try {
      EstadoEnvio.desdeRespuesta('<ESTADO></ESTADO>', '42');
    } catch (error) {
      lanzado = error;
    }
    expect(lanzado).toBeInstanceOf(SiiError);
    expect((lanzado as Error).message).toBe('El SII no devolvió el estado del envío 42.');
  });

  it('resumen de un envío procesado y de uno que no lo está', () => {
    expect(
      EstadoEnvio.desdeRespuesta(
        respuesta('EPR', 'Envio Procesado', [['39', 5, 4, 1, 2]]),
        '1',
      ).resumen(),
    ).toBe('EPR Envio Procesado: 5 informados, 4 aceptados, 1 rechazados, 2 con reparos');
    expect(EstadoEnvio.desdeRespuesta(respuesta('RCH', 'Rechazado'), '1').resumen()).toBe(
      'RCH Rechazado',
    );
    expect(EstadoEnvio.desdeRespuesta('<ESTADO>REC</ESTADO>', '1').resumen()).toBe('REC');
  });

  it('sin TRACKID, vacío o "0" usa el trackId recibido', () => {
    expect(EstadoEnvio.desdeRespuesta('<ESTADO>EPR</ESTADO>', '9').trackId).toBe('9');
    expect(EstadoEnvio.desdeRespuesta('<TRACKID></TRACKID><ESTADO>EPR</ESTADO>', '9').trackId).toBe(
      '9',
    );
    expect(
      EstadoEnvio.desdeRespuesta('<TRACKID>0</TRACKID><ESTADO>EPR</ESTADO>', '9').trackId,
    ).toBe('9');
    expect(
      EstadoEnvio.desdeRespuesta('<TRACKID>00</TRACKID><ESTADO>EPR</ESTADO>', '9').trackId,
    ).toBe('00');
  });

  it('quita los blancos ASCII alrededor de los valores, pero no el NBSP', () => {
    const ascii = EstadoEnvio.desdeRespuesta('<ESTADO>\n\t\v\fEPR \r</ESTADO>', '1');
    const nbsp = EstadoEnvio.desdeRespuesta('<ESTADO>EPR </ESTADO>', '1');
    expect(ascii.procesado()).toBe(true);
    expect(nbsp.estado).toBe('EPR ');
    expect(nbsp.procesado()).toBe(false);
  });

  it('un estado desconocido se conserva y es final', () => {
    const estado = EstadoEnvio.desdeRespuesta(
      '<ESTADO>RPR</ESTADO><GLOSA>Con reparos</GLOSA>',
      '1',
    );
    expect(estado.estado).toBe('RPR');
    expect(estado.enProceso()).toBe(false);
    expect(estado.procesado()).toBe(false);
  });

  it('es inmutable', () => {
    const estado = new EstadoEnvio({ trackId: '1', estado: 'EPR', glosa: 'ok', informados: 1 });
    expect(Object.isFrozen(estado)).toBe(true);
    expect(() => {
      (estado as { estado: string }).estado = 'REC';
    }).toThrow(TypeError);
    expect(estado).toMatchObject({ aceptados: 0, rechazados: 0, reparos: 0 });
  });
});

describe('decodificarEntidadesXml (html_entity_decode con ENT_QUOTES | ENT_XML1)', () => {
  it.each([
    ['&amp;&lt;&gt;&quot;&apos;', '&<>"\''],
    ['&amp;lt;', '&lt;'],
    ['&#233;&#xE9;&#XE9;&#00065;', 'éééA'],
    ['&#x0x41;&#x0X41;', 'AA'],
    ['&#128512;', '😀'],
    ['&#9;&#10;&#13;', '\t\n\r'],
    ['&nbsp;&eacute;&AMP;&Amp;', '&nbsp;&eacute;&AMP;&Amp;'],
    ['&#0;&#xD800;&#xFFFE;&#xFFFF;&#1114112;', '&#0;&#xD800;&#xFFFE;&#xFFFF;&#1114112;'],
    ['&#65 &#x; &#x0x; &#99999999999999999999;', '&#65 &#x; &#x0x; &#99999999999999999999;'],
    ['&constructor;&toString;&__proto__;', '&constructor;&toString;&__proto__;'],
  ])('%s', (entrada, salida) => {
    expect(decodificarEntidadesXml(entrada)).toBe(salida);
  });
});
