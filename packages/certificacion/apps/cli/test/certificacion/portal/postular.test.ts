// `sii certificacion postular`: postulación a boleta electrónica en maullin.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RespuestaHttp } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../../src/errores.ts';
import { correr, proyecto } from '../../soporte/cli.ts';
import { LOGIN_OK, LOGIN_RECHAZADO, resumen, siiFalso } from './sii-falso.ts';

const PAGINAS = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../paridad/postulacion/paginas',
);
const html = (nombre: string): string => readFileSync(join(PAGINAS, `${nombre}.html`), 'utf8');
const latin1 = (s: string): Buffer => Buffer.from(s, 'latin1');

const DATOS = {
  correoAdministrador: 'admin@empresa-prueba.cl',
  correoContactoSii: 'contacto@empresa-prueba.cl',
  correoIntercambio: 'dte@empresa-prueba.cl',
  nombreSoftware: 'Software de Prueba',
  url: 'www.empresa-prueba.cl',
};

/** Confirmación del SII que repite exactamente los datos (como el test del core). */
function confirma(datos: { nombreSoftware: string; url?: string } = DATOS, bolexen = 'S'): Buffer {
  const valores: Record<string, string> = {
    RUT_EMP: '76123456',
    DV_EMP: '0',
    RUT_USU: '11111111',
    DV_USU: '1',
    MAIL_SUP: DATOS.correoAdministrador,
    MAIL_SII: DATOS.correoContactoSii,
    MAIL_DTE: DATOS.correoIntercambio,
    URL: datos.url ?? '',
    NOM_SW: datos.nombreSoftware,
    ESBOL: 'S',
    BOLELEC: 'S',
    ESFAC: 'N',
    RAZON_SOCIAL: 'COMERCIAL DE PRUEBA LIMITADA',
  };
  let pagina = html('confirma')
    .replace('{{META}}', '')
    .replace('{{ACTION}}', 'pe_graba_postulacion')
    .replace('{{BOLEXEN}}', `<INPUT TYPE="hidden" NAME="BOLEXEN" VALUE="${bolexen}">\n`);
  for (const [campo, valor] of Object.entries(valores)) {
    pagina = pagina.replaceAll(`{{${campo}}}`, valor);
  }
  return latin1(pagina);
}

const datosEmpresa = (): Buffer =>
  latin1(
    html('datos-empresa')
      .replace('{{META}}', '')
      .replaceAll('{{RAZON_SOCIAL}}', 'COMERCIAL DE PRUEBA LIMITADA')
      .replace('{{EXTRA}}', ''),
  );

const BASE = 'maullin.sii.cl/cvc_cgi/dte';
const transporte = (
  opciones: { final?: Buffer | RespuestaHttp; datos?: Buffer | RespuestaHttp; conf?: Buffer } = {},
) =>
  siiFalso({
    login: LOGIN_OK,
    rutas: {
      [`${BASE}/pe_ingrut`]: latin1(html('pe-ingrut')),
      [`${BASE}/pe_datos_empresa`]: opciones.datos ?? datosEmpresa(),
      [`${BASE}/pe_confirma`]: opciones.conf ?? confirma(),
      [`${BASE}/pe_graba_postulacion`]: opciones.final ?? latin1(html('aceptada')),
    },
  });

function conDatos(datos: unknown = DATOS) {
  const p = proyecto();
  p.escribir('postulacion.json', typeof datos === 'string' ? datos : JSON.stringify(datos));
  return p;
}

const ARGS = ['certificacion', 'postular', '--datos', 'postulacion.json'];

describe('certificacion postular', () => {
  it('con --confirmar: login y los 4 pasos del asistente; RUTs por defecto del .env', async () => {
    const t = transporte();
    const r = await correr(conDatos(), [...ARGS, '--confirmar'], { transporte: t });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(resumen(t.enviadas)).toEqual([
      'POST herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi',
      `POST ${BASE}/pe_ingrut`,
      `POST ${BASE}/pe_datos_empresa`,
      `POST ${BASE}/pe_confirma`,
      `POST ${BASE}/pe_graba_postulacion`,
    ]);
    const conf = t.enviadas[3]?.bytes?.toString('latin1') ?? '';
    // SII_RUT_EMPRESA en pe_datos_empresa; SII_RUT_FIRMA como administrador.
    expect(t.enviadas[2]?.bytes?.toString('latin1')).toContain('RUT_EMP=76123456&DV_EMP=0');
    expect(conf).toContain('RUT_USU=11111111&DV_USU=1');
    expect(conf).toContain('NOM_SW=Software+de+Prueba');
    expect(r.stdout).toContain('Postulación de 76123456-0 aceptada por el SII');
    expect(r.stdout).toMatch(/HA SIDO ACEPTADA/);
  });

  it('sin --confirmar: solo valida y muestra el resumen, sin peticiones', async () => {
    const r = await correr(conDatos(), ARGS, { transporte: transporte() });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(r.stdout).toContain('Nombre del software:     Software de Prueba');
    expect(r.stdout).toContain('Usuario administrador:   11111111-1');
    expect(r.stdout).toContain('Boleta exenta:           sí');
    expect(r.stdout).toContain('NO se envió nada');
  });

  it('rechaza tildes y ñ antes de cualquier petición (código 3) y explica por qué', async () => {
    const r = await correr(
      conDatos({ ...DATOS, nombreSoftware: 'Señal Cía', url: 'www.ñandú.cl' }),
      [...ARGS, '--confirmar'],
      { transporte: transporte() },
    );
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(r.stderr).toContain(
      'nombreSoftware: tiene caracteres fuera de ASCII imprimible ("ñ" U+00F1)',
    );
    expect(r.stderr).toContain('url: tiene caracteres fuera de ASCII imprimible');
    expect(r.stderr).toContain('charset=iso-8859-1');
    expect(r.stderr).toContain('PLAN-MIGRACION §8');
  });

  it('también rechaza caracteres de control (tabulador)', async () => {
    const r = await correr(conDatos({ ...DATOS, nombreSoftware: 'Soft\tware' }), ARGS);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('(U+0009)');
  });

  it('sin --datos: código 2', async () => {
    const r = await correr(proyecto(), ['certificacion', 'postular', '--confirmar']);
    expect(r.codigo).toBe(CODIGOS.USO);
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it.each([
    ['no es JSON', 'nada', 'no es JSON válido'],
    ['falta el nombre', { ...DATOS, nombreSoftware: undefined }, 'nombreSoftware: debe ser texto'],
    [
      'boletaExenta no booleana',
      { ...DATOS, boletaExenta: 'si' },
      'boletaExenta: debe ser true o false',
    ],
    [
      'RUT inválido',
      { ...DATOS, rutAdministrador: '11111111-2' },
      'rutAdministrador: no es un RUT válido',
    ],
    ['campo desconocido', { ...DATOS, nombreSofware: 'x' }, 'campo desconocido: nombreSofware'],
    ['URL sin www.', { ...DATOS, url: 'empresa.cl' }, 'tiene que empezar con "www."'],
    ['nombre largo', { ...DATOS, nombreSoftware: 'x'.repeat(31) }, 'como máximo 30 caracteres'],
    ['correo con +', { ...DATOS, correoIntercambio: 'dte+1@x.cl' }, 'no lo acepta el SII'],
  ])('datos inválidos (%s): código 3 sin peticiones', async (_, datos, mensaje) => {
    const r = await correr(conDatos(datos), [...ARGS, '--confirmar'], { transporte: transporte() });
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain(mensaje);
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it('boletaExenta false: no envía BOLEXEN', async () => {
    const t = transporte({ conf: confirma(DATOS, 'N') });
    const r = await correr(conDatos({ ...DATOS, boletaExenta: false }), [...ARGS, '--confirmar'], {
      transporte: t,
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(t.enviadas[3]?.bytes?.toString('latin1')).not.toContain('BOLEXEN');
  });

  it('el SII rechaza (no es representante): código 5, sin grabar', async () => {
    const t = transporte({ datos: latin1(html('rechazo')) });
    const r = await correr(conDatos(), [...ARGS, '--confirmar'], { transporte: t });
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(t.urls().some((u) => u.includes('pe_graba_postulacion'))).toBe(false);
  });

  it('certificado rechazado: código 5; HTTP 502 antes de grabar: código 4', async () => {
    const login = await correr(conDatos(), [...ARGS, '--confirmar'], {
      transporte: siiFalso({ login: LOGIN_RECHAZADO }),
    });
    expect(login.codigo).toBe(CODIGOS.SII);
    const http = await correr(conDatos(), [...ARGS, '--confirmar'], {
      transporte: transporte({ datos: new RespuestaHttp(502) }),
    });
    expect(http.codigo).toBe(CODIGOS.TRANSPORTE);
  });

  it('falla después de grabar: código 5 con el aviso de la librería', async () => {
    const r = await correr(conDatos(), [...ARGS, '--confirmar'], {
      transporte: transporte({ final: new RespuestaHttp(500) }),
    });
    expect(r.codigo).toBe(CODIGOS.SII);
  });
});
