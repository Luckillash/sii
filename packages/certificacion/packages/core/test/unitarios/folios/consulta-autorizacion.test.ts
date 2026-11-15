// Tests de ConsultaAutorizacion (nuevo en Node). Todo pasa por el TransporteFalso:
// ninguna petición sale a la red.
//
// Las páginas de paridad/autorizacion/paginas/ son las de palena grabadas el
// 2026-11-13 (solo lectura), con los datos de la empresa reemplazados: RUT
// 76123456-0, razón social, nombre del software, correos y URL de prueba.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ErrorTransporte,
  ErrorValidacion,
  ErrorVerificacion,
  SesionCaducaError,
} from '../../../src/comun/errores.ts';
import { RespuestaHttp } from '../../../src/comun/http/respuesta.ts';
import {
  type PeticionRegistrada,
  type RespuestaFalsa,
  TransporteFalso,
} from '../../../src/comun/http/transporte-falso.ts';
import { Rut } from '../../../src/comun/rut.ts';
import { Certificado } from '../../../src/core/certificado.ts';
import { ConsultaAutorizacion, leerAdEmpresa2 } from '../../../src/folios/consulta-autorizacion.ts';
import { SesionSii } from '../../../src/folios/sesion-sii.ts';

const PARIDAD = join(dirname(fileURLToPath(import.meta.url)), '../../../../../paridad');
const texto = (ruta: string): string => readFileSync(join(PARIDAD, ruta), 'utf8');
/** Las páginas del SII llegan en ISO-8859-1. */
const pagina = (nombre: string): Buffer =>
  Buffer.from(texto(`autorizacion/paginas/${nombre}.html`), 'latin1');
const certificado = (): Certificado =>
  Certificado.desdeContenido(readFileSync(join(PARIDAD, 'material/cert-cadena.pem')), '');

const AD1 = 'palena.sii.cl/cvc_cgi/dte/ad_empresa1';
const AD2 = 'palena.sii.cl/cvc_cgi/dte/ad_empresa2';

function sesion(): SesionSii {
  return SesionSii.desdeArreglo([
    { name: 'TOKEN', value: 'TOKENDEPRUEBA', domain: 'sii.cl', host_only: false },
  ]);
}

function transporte(
  respuesta2: RespuestaFalsa,
  respuesta1: RespuestaFalsa = pagina('ad-empresa1'),
) {
  return new TransporteFalso([
    [AD1, respuesta1],
    [AD2, respuesta2],
  ]);
}

const campos = (p: PeticionRegistrada | undefined): [string, string][] => {
  const cuerpo = p?.cuerpo;
  if (cuerpo?.tipo !== 'formulario') throw new Error('sin formulario');
  return [...(cuerpo.campos as Iterable<[string, string]>)];
};

describe('ConsultaAutorizacion.consultar', () => {
  it('empresa autorizada: devuelve la resolución y la fecha de autorización', async () => {
    const t = transporte(pagina('ad-empresa2-autorizada'));
    const r = await new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '76.123.456-0');

    expect(r).toEqual({
      tipo: 'autorizada',
      rut: '76123456-0',
      razonSocial: 'EMPRESA DE PRUEBA SPA',
      fechaAutorizacion: '2026-11-06',
      resolucion: { numero: 80, fecha: '2014-08-22' },
    });
    // Nada de los datos de contacto (correos, URL, software) sale en el resultado.
    expect(JSON.stringify(r)).not.toMatch(/example|Software/);
  });

  it('solo GET ad_empresa1 y POST ad_empresa2 con RUT_EMP, DV_EMP y ACEPTAR, con la sesión', async () => {
    const t = transporte(pagina('ad-empresa2-autorizada'));
    await new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '76123456-0');

    expect(t.enviadas.map((p) => `${p.metodo} ${p.url}`)).toEqual([
      'GET https://palena.sii.cl/cvc_cgi/dte/ad_empresa1',
      'POST https://palena.sii.cl/cvc_cgi/dte/ad_empresa2',
    ]);
    expect(campos(t.enviadas[1])).toEqual([
      ['RUT_EMP', '76123456'],
      ['DV_EMP', '0'],
      ['ACEPTAR', 'Ingresar'],
    ]);
    expect(t.enviadas[1]?.cabeceras.Referer).toBe('https://palena.sii.cl/cvc_cgi/dte/ad_empresa1');
    expect(t.enviadas.every((p) => p.cabeceras.Cookie === 'TOKEN=TOKENDEPRUEBA')).toBe(true);
    expect(t.enviadas.every((p) => !p.tls && p.msRespuesta === 70_000)).toBe(true);
  });

  it('nunca envía el formulario de actualización de ad_empresa2 (MOD_EMP / MOD_USU)', async () => {
    const t = transporte(pagina('ad-empresa2-autorizada'));
    await new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '76123456-0');
    const enviados = t.enviadas.flatMap((p) => (p.cuerpo ? campos(p).map(([k]) => k) : []));
    for (const campo of ['MOD_EMP', 'MOD_USU', 'ORDEN', 'PAGINA']) {
      expect(enviados).not.toContain(campo);
    }
  });

  it('sin representación legal: no dice nada de la autorización', async () => {
    const t = transporte(pagina('ad-empresa2-sin-representacion'));
    const r = await new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '11111111-1');
    expect(r).toEqual({ tipo: 'sin_representacion' });
  });

  it('no autorizada para operar en la modalidad', async () => {
    const t = transporte(pagina('ad-empresa2-no-autorizada'));
    const r = await new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '76123456-0');
    expect(r).toEqual({ tipo: 'no_autorizada' });
  });

  it('lanza ErrorVerificacion si la página autorizada es de otro RUT', async () => {
    const t = transporte(pagina('ad-empresa2-autorizada'));
    const consulta = new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '11111111-1');
    await expect(consulta).rejects.toThrow(ErrorVerificacion);
    await expect(consulta).rejects.toThrow(/otro RUT \(se pidió 11111111-1\)/);
  });

  it('lanza ErrorVerificacion si «sin representación» nombra otro RUT', async () => {
    const t = transporte(pagina('ad-empresa2-sin-representacion'));
    await expect(
      new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '76123456-0'),
    ).rejects.toThrow(/otro RUT/);
  });

  it('una página desconocida lanza ErrorVerificacion sin copiar el HTML', async () => {
    const html = '<html><body>Mantención programada del sistema: vuelva más tarde.</body></html>';
    const t = transporte(Buffer.from(html, 'latin1'));
    const error = await new ConsultaAutorizacion({ transporte: t })
      .consultar(sesion(), '76123456-0')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorVerificacion);
    expect((error as Error).message).not.toMatch(/Mantenci/);
  });

  it('ad_empresa1 sin el formulario del RUT: ErrorVerificacion y no hace el POST', async () => {
    const t = transporte(
      pagina('ad-empresa2-autorizada'),
      Buffer.from('<html><body>Hola</body></html>'),
    );
    await expect(
      new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '76123456-0'),
    ).rejects.toThrow(ErrorVerificacion);
    expect(t.enviadas).toHaveLength(1);
  });

  it('sesión caducada (redirige al login): SesionCaducaError sin ir al login', async () => {
    const t = transporte(
      pagina('ad-empresa2-autorizada'),
      new RespuestaHttp(302, {
        location:
          'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoCertificado.html?https://palena.sii.cl/cvc_cgi/dte/ad_empresa1',
      }),
    );
    await expect(
      new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '76123456-0'),
    ).rejects.toThrow(SesionCaducaError);
    expect(t.enviadas).toHaveLength(1);
  });

  it('no sigue una redirección fuera de las dos páginas de la consulta', async () => {
    for (const destino of [
      'https://palena.sii.cl/cvc_cgi/dte/ad_empresa3',
      'https://maullin.sii.cl/cvc_cgi/dte/ad_empresa2',
      'http://palena.sii.cl/cvc_cgi/dte/ad_empresa2',
    ]) {
      const t = transporte(new RespuestaHttp(302, { location: destino }));
      await expect(
        new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '76123456-0'),
      ).rejects.toThrow(ErrorVerificacion);
      expect(t.enviadas).toHaveLength(2);
    }
  });

  it('RUT inválido: ErrorValidacion sin salir al SII', async () => {
    const t = transporte(pagina('ad-empresa2-autorizada'));
    await expect(
      new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '76123456-1'),
    ).rejects.toThrow(ErrorValidacion);
    expect(t.enviadas).toHaveLength(0);
  });

  it('HTTP distinto de 200: ErrorTransporte', async () => {
    const t = transporte(new RespuestaHttp(500, {}, 'error'));
    await expect(
      new ConsultaAutorizacion({ transporte: t }).consultar(sesion(), '76123456-0'),
    ).rejects.toThrow(ErrorTransporte);
  });
});

describe('ConsultaAutorizacion.autenticar', () => {
  it('es el login AUT2000 de producción (vuelta a palena)', async () => {
    const t = new TransporteFalso({
      'herculesr.sii.cl/*': Buffer.from(texto('folios/paginas/login-ok.html'), 'latin1'),
    });
    const s = await new ConsultaAutorizacion({ transporte: t }).autenticar(certificado());
    expect(s.tiene('TOKEN')).toBe(true);
    expect(t.urls()[0]).toBe(
      'https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?https://palena.sii.cl/cvc_cgi/dte/of_solicita_folios',
    );
    expect(t.enviadas[0]?.tls).toBe(true);
  });
});

describe('leerAdEmpresa2', () => {
  const rut = Rut.de('76123456-0');
  const autorizada = texto('autorizacion/paginas/ad-empresa2-autorizada.html');

  it('le falta un dato (la resolución): ErrorVerificacion', () => {
    const sinResolucion = autorizada.replace(
      /Resoluci&oacute;n<\/font><\/td>\s*<td[^>]*>\s*<font[^>]*>&nbsp;80/,
      'Otra cosa</font></td><td><font>&nbsp;80',
    );
    expect(sinResolucion).not.toBe(autorizada);
    expect(() => leerAdEmpresa2(sinResolucion, rut)).toThrow(ErrorVerificacion);
  });

  it('fecha que no existe o resolución que no es un número: ErrorVerificacion', () => {
    expect(() => leerAdEmpresa2(autorizada.replace('22-08-2014', '31-02-2014'), rut)).toThrow(
      ErrorVerificacion,
    );
    expect(() => leerAdEmpresa2(autorizada.replace('&nbsp;80<', '&nbsp;ochenta<'), rut)).toThrow(
      ErrorVerificacion,
    );
  });

  it('dos marcas a la vez (autorizada y no autorizada): ErrorVerificacion', () => {
    const doble = autorizada.replace(
      '</body>',
      'el Contribuyente no est&aacute; autorizado para operar en esta modalidad</body>',
    );
    expect(() => leerAdEmpresa2(doble, rut)).toThrow(ErrorVerificacion);
  });
});
