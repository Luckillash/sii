// Tests de DeclaracionBoletas y EstadoDeclaracion (port de
// src/Postulacion/DeclaracionBoletas.php de winex/certificacion v1.9.1, que no tenía
// tests: pend. 6.1). Todo pasa por el TransporteFalso: ninguna petición sale a la
// red. Cubren el estado (P90, P91, nulo, `is_numeric` del paso), la declaración y
// la semántica de "incierta" en CADA falla desde el POST que declara, los candados
// (P90, trackId, usuario de la sesión), la revisión del set, la descarga del set,
// la verificación del portal, los códigos HTTP y la fecha en hora de Chile.
//
// Las respuestas GWT son sintéticas (las mismas de paridad/declaracion/armar-casos.mjs).

import { describe, expect, it } from 'vitest';
import {
  DeclaracionInciertaError,
  ErrorPostulacion,
  ErrorTransporte,
  ErrorValidacion,
  SesionCaducaError,
  SetSinDescargarError,
} from '../../../src/comun/errores.ts';
import { RespuestaHttp } from '../../../src/comun/http/respuesta.ts';
import {
  type PeticionRegistrada,
  TransporteFalso,
} from '../../../src/comun/http/transporte-falso.ts';
import { relojFijo } from '../../../src/comun/reloj.ts';
import { Rut } from '../../../src/comun/rut.ts';
import { type CookieSii, SesionSii } from '../../../src/folios/sesion-sii.ts';
import { DatosDeclaracion } from '../../../src/postulacion/datos-postulacion.ts';
import {
  BASE_DECLARACION,
  DeclaracionBoletas,
  ESQUEMAS_DECLARACION,
  FIRMAS_DECLARACION,
  fechaDmy,
  HOST_DECLARACION,
  MS_DECLARACION,
  PASO_DECLARACION,
  PERMUTACION_DECLARACION,
  POLICY_DECLARACION,
  pasoNumerico,
  SERVICIO_DECLARACION,
} from '../../../src/postulacion/declaracion-boletas.ts';
import { EstadoDeclaracion } from '../../../src/postulacion/estado-declaracion.ts';
import { GwtRpc } from '../../../src/postulacion/gwt-rpc.ts';

// --- respuestas sintéticas -----------------------------------------------------------

const F = FIRMAS_DECLARACION;
const INTEGER = GwtRpc.INTEGER;
const ARRAY_LIST = GwtRpc.ARRAY_LIST;

/** `//OK[...]` con los tokens en el orden en que se leen. */
function ok(lectura: readonly (number | string)[], tabla: readonly string[] = []): string {
  return `//OK[${[...[...lectura].reverse(), JSON.stringify(tabla)].join(',')},0,7]`;
}

const estadoGwt = (codigo: string, paso: string | null, glosa: string): string =>
  paso === null
    ? ok([1, 2, 0, 3], [F.estado, codigo, glosa])
    : ok([1, 2, 3, 4], [F.estado, codigo, paso, glosa]);
const P90 = estadoGwt('P90', '90', 'PENDIENTE DECLARACION DE CUMPLIMIENTO');
const P91 = estadoGwt('P91', null, 'DECLARACION EFECTUADA 11111111-1');
const NULO = ok([0]);
const NOMBRE = ok([1], ['SOCIEDAD DE PRUEBA ÑUÑOA SPA']);
const DOCUMENTOS = `//OK[15,'EAAAAA',4,18,13,0,'F',4,76123456,3,12,17,10,9,8,0,7,16,5,-4,41,3,2,15,'gAAAAAAAB',4,14,13,0,'F',4,76123456,3,12,11,10,9,8,0,7,6,5,'ZlFhXwA',4,39,3,2,2,1,["${ARRAY_LIST}","${F.documento}","${INTEGER}","java.lang.Long/4227064769","BVE","BOLETA ELECTRONICA","S","01-09-2026","AUTORIZADO","","39","N","java.lang.String/2004016611","Boleta afecta","FIN","BOLETA EXENTA ELECTRONICA","41","Boleta exenta"],0,7]`;
const AUTORIZAR_P91 = `//OK[19,0,-4,0,'A',18,17,0,0,16,0,10,10,15,22222222,4,11111111,4,76123456,4,14,13,12,11,10,10,10,9,8,7,5,3,0,6,0,5,0,0,0,0,90,4,3,0,2,1,["${F.postulacion}","P91","BVE","${INTEGER}","0","${F.empresaAutorizada}","1","2","SII","07-11-2026","contacto@proveedor-prueba.cl","Proveedor de Prueba SpA","19","S","https://proveedor-prueba.cl/consulta","${ARRAY_LIST}","EMPRESA DE PRUEBA SPA","java.lang.Long/4227064769","DECLARACION EFECTUADA"],0,7]`;
const POSTULACION_P90 = `//OK[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,1,["${F.postulacion}","P90"],0,7]`;
const EX = '//EX[2,1,["cl.sii.Negocio/1","No fue posible registrar la declaracion"],0,7]';
const INCOMPATIBLE =
  '//EX[2,1,["com.google.gwt.user.client.rpc.IncompatibleRemoteServiceException/3936916533","This application is out of date"],0,7]';
const LOGIN =
  '<html><script>window.location="https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoRutClave.html";</script></html>';
const texto = (s: string): string => ok([1], [s]);
const entero = (n: number): string => ok([1, n], [INTEGER]);

type Respuesta = string | Buffer | RespuestaHttp | (() => never);

/** Transporte falso que responde en orden, sin importar la URL. */
function secuencia(respuestas: readonly Respuesta[]): TransporteFalso {
  const pendientes = [...respuestas];
  return new TransporteFalso([
    [
      '*',
      () => {
        const r = pendientes.shift();
        if (r === undefined) return new RespuestaHttp(500, {}, 'sin respuesta configurada');
        return typeof r === 'function' ? r() : r;
      },
    ],
  ]);
}

const http = (status: number, cuerpo: string | Buffer = '', cabeceras = {}): RespuestaHttp =>
  new RespuestaHttp(status, cabeceras, cuerpo);
const falla = (): never => {
  throw new ErrorTransporte('Se agotó el tiempo de espera.', `${BASE_DECLARACION}facade`);
};

const COOKIES: Partial<CookieSii>[] = [
  { name: 'TOKEN', value: 'TOKENDEPRUEBA', domain: 'sii.cl', host_only: false },
  { name: 'RUT_NS', value: '11111111', domain: 'sii.cl', host_only: false },
  { name: 'DV_NS', value: '1', domain: 'sii.cl', host_only: false },
];
const sesion = (cookies = COOKIES): SesionSii => SesionSii.desdeArreglo(cookies);

const DATOS = new DatosDeclaracion({
  rutEmpresa: '76123456-0',
  linkConsulta: 'https://www.empresa-prueba.cl/boletas',
  rutProveedor: '22222222-2',
  nombreProveedor: 'Proveedor de Prueba SpA',
  correoProveedor: 'software@empresa-prueba.cl',
});

/** 2026-11-08 02:30 UTC = 2026-11-07 23:30 en Chile (UTC-3 en verano). */
const RELOJ = relojFijo('2026-11-08T02:30:00Z');

function declaracion(transporte: TransporteFalso): DeclaracionBoletas {
  return new DeclaracionBoletas({ transporte, reloj: RELOJ });
}

const cuerpoDe = (p: PeticionRegistrada | undefined): string => p?.bytes?.toString('utf8') ?? '';
const metodoGwt = (p: PeticionRegistrada | undefined): string => cuerpoDe(p).split('|')[6] ?? '';

async function error(promesa: Promise<unknown>): Promise<unknown> {
  try {
    await promesa;
  } catch (e) {
    return e;
  }
  throw new Error('Se esperaba que lanzara.');
}

// --- EstadoDeclaracion ------------------------------------------------------------------

describe('EstadoDeclaracion', () => {
  const empresa = Rut.de('76123456-0');

  it('porDeclarar() solo con P90 y autorizada() solo con P91', () => {
    expect(new EstadoDeclaracion(empresa, 'P90', '', 90).porDeclarar()).toBe(true);
    expect(new EstadoDeclaracion(empresa, 'P90', '', 90).autorizada()).toBe(false);
    expect(new EstadoDeclaracion(empresa, 'P91', '', null).autorizada()).toBe(true);
    expect(new EstadoDeclaracion(empresa, 'P91', '', null).porDeclarar()).toBe(false);
    expect(new EstadoDeclaracion(empresa, null, '', null).porDeclarar()).toBe(false);
    expect(new EstadoDeclaracion(empresa, 'p90', '', null).porDeclarar()).toBe(false);
  });
});

// --- constantes y utilidades ------------------------------------------------------------

describe('constantes del portal', () => {
  it('son las capturadas del PHP', () => {
    expect(HOST_DECLARACION).toBe('www4.sii.cl');
    expect(BASE_DECLARACION).toBe('https://www4.sii.cl/certBolElectDteInternet/');
    expect(POLICY_DECLARACION).toBe('082D0AC4BC4D75A5DF38F116C53877D4');
    expect(PERMUTACION_DECLARACION).toBe('0FC3D987613537E6E13E9BB93A406F13');
    expect(SERVICIO_DECLARACION).toBe('cl.sii.sdi.diii.certBolElectDte.web.client.service.Facade');
    expect(PASO_DECLARACION).toBe(90);
    expect(MS_DECLARACION).toBe(45_000);
    expect(ESQUEMAS_DECLARACION).toEqual({
      [F.estado]: 'SSS',
      [F.postulacion]: 'SOSOSSOSSSOSSSOSSOOOOS',
      [F.empresaAutorizada]: 'BSSSSSSSSSSSSOOOS',
      [F.documento]: 'OOSSSSSSSSSOOOOOS',
    });
  });
});

describe('pasoNumerico (is_numeric + (int) de PHP 8)', () => {
  it.each([
    ['90', 90],
    [' 90', 90],
    ['90 ', 90],
    ['\t\n90\r\v\f', 90],
    ['+90', 90],
    ['-3', -3],
    ['9.0e1', 90],
    [' 9.0E+1 ', 90],
    ['90.9', 90],
    ['-90.9', -90],
    ['.5', 0],
    ['5.', 5],
    ['007', 7],
  ])('%j → %d', (entrada, salida) => {
    expect(pasoNumerico(entrada)).toBe(salida);
  });

  it.each([
    [null],
    [''],
    [' '],
    ['abc'],
    ['90abc'],
    ['0x5A'],
    ['9 0'],
    ['1e'],
    ['.'],
    [' 90'],
    ['٩٠'],
  ])('%j → null', (entrada) => {
    expect(pasoNumerico(entrada)).toBeNull();
  });

  it('un número que no cabe en un entero seguro lanza (el PHP saturaba)', () => {
    expect(() => pasoNumerico('1e400')).toThrow(ErrorPostulacion);
    expect(() => pasoNumerico('99999999999999999999')).toThrow(ErrorPostulacion);
  });
});

describe('fechaDmy (d-m-Y en America/Santiago)', () => {
  it.each([
    ['2026-11-08T02:30:00Z', '07-11-2026'], // 23:30 del 7 en Chile (UTC-3)
    ['2026-11-08T02:59:59Z', '07-11-2026'],
    ['2026-11-08T03:00:00Z', '08-11-2026'],
    ['2026-07-01T03:59:59Z', '30-06-2026'], // invierno: UTC-4
    ['2026-07-01T04:00:00Z', '01-07-2026'],
    ['2027-01-01T02:59:59Z', '31-12-2026'],
  ])('%s → %s', (instante, fecha) => {
    expect(fechaDmy(new Date(instante))).toBe(fecha);
  });
});

// --- estado() ---------------------------------------------------------------------------

describe('estado()', () => {
  it('P90: código, paso y glosa; POST GWT a facade con las cabeceras del portal', async () => {
    const t = secuencia([P90]);
    const e = await declaracion(t).estado(sesion(), '76.123.456-0');

    expect(e).toBeInstanceOf(EstadoDeclaracion);
    expect(e.empresa.toString()).toBe('76123456-0');
    expect(e.codigo).toBe('P90');
    expect(e.paso).toBe(90);
    expect(e.glosa).toBe('PENDIENTE DECLARACION DE CUMPLIMIENTO');
    expect(e.porDeclarar()).toBe(true);

    expect(t.enviadas).toHaveLength(1);
    const p = t.enviadas[0];
    expect(p?.metodo).toBe('POST');
    expect(p?.url).toBe('https://www4.sii.cl/certBolElectDteInternet/facade');
    expect(p?.conexionNueva).toBe(false);
    expect(p?.msRespuesta).toBe(45_000);
    expect(p?.cabeceras).toMatchObject({
      'Content-Type': 'text/x-gwt-rpc; charset=UTF-8',
      'X-GWT-Permutation': '0FC3D987613537E6E13E9BB93A406F13',
      'X-GWT-Module-Base': 'https://www4.sii.cl/certBolElectDteInternet/',
      Origin: 'https://www4.sii.cl',
      Referer: 'https://www4.sii.cl/certBolElectDteInternet/',
      Cookie: 'TOKEN=TOKENDEPRUEBA; RUT_NS=11111111; DV_NS=1',
    });
    expect(cuerpoDe(p)).toBe(
      GwtRpc.llamada(
        BASE_DECLARACION,
        POLICY_DECLARACION,
        SERVICIO_DECLARACION,
        'obtenerEstadoAutorizaEmp',
        [
          [INTEGER, (w) => w.integer(76123456)],
          [GwtRpc.STRING, (w) => w.string('0')],
          [INTEGER, (w) => w.integer(90)],
          [GwtRpc.STRING, (w) => w.string(null)],
        ],
      ),
    );
  });

  it('acepta un Rut ya validado', async () => {
    const e = await declaracion(secuencia([P90])).estado(sesion(), Rut.de('76123456-0'));
    expect(e.codigo).toBe('P90');
  });

  it('P91 con el paso nulo', async () => {
    const e = await declaracion(secuencia([P91])).estado(sesion(), '76123456-0');
    expect([e.codigo, e.paso, e.glosa, e.autorizada()]).toEqual([
      'P91',
      null,
      'DECLARACION EFECTUADA 11111111-1',
      true,
    ]);
  });

  it('respuesta nula: sin código, glosa vacía, sin paso', async () => {
    const e = await declaracion(secuencia([NULO])).estado(sesion(), '76123456-0');
    expect([e.codigo, e.glosa, e.paso, e.porDeclarar()]).toEqual([null, '', null, false]);
  });

  it('código y glosa nulos dentro del DTO', async () => {
    const e = await declaracion(secuencia([ok([1, 0, 2, 0], [F.estado, ' 9.0e1 '])])).estado(
      sesion(),
      '76123456-0',
    );
    expect([e.codigo, e.glosa, e.paso]).toEqual([null, '', 90]);
  });

  it('un paso no numérico queda null', async () => {
    const e = await declaracion(secuencia([estadoGwt('P90', 'NOVENTA', 'PENDIENTE')])).estado(
      sesion(),
      '76123456-0',
    );
    expect(e.paso).toBeNull();
  });

  it('un RUT inválido lanza ErrorValidacion sin enviar nada', async () => {
    const t = secuencia([P90]);
    expect(await error(declaracion(t).estado(sesion(), '76123456-1'))).toBeInstanceOf(
      ErrorValidacion,
    );
    expect(t.enviadas).toHaveLength(0);
  });

  it('un tipo distinto de EstadoAutorizaTo lanza ErrorPostulacion', async () => {
    for (const r of [entero(5), POSTULACION_P90, texto('P90')]) {
      expect(
        await error(declaracion(secuencia([r])).estado(sesion(), '76123456-0')),
      ).toBeInstanceOf(ErrorPostulacion);
    }
  });

  it('HTTP distinto de 200: ErrorTransporte con el código (reintentable)', async () => {
    const e = await error(
      declaracion(secuencia([http(503, 'caído')])).estado(sesion(), '76123456-0'),
    );
    expect(e).toBeInstanceOf(ErrorTransporte);
    expect((e as ErrorTransporte).status).toBe(503);
    expect((e as Error).message).toContain('HTTP 503');
  });

  it('la sesión se revisa antes que el código HTTP (como el PHP)', async () => {
    const e = await error(
      declaracion(secuencia([http(500, LOGIN)])).estado(sesion(), '76123456-0'),
    );
    expect(e).toBeInstanceOf(SesionCaducaError);
  });

  it('página de login con HTTP 200 o redirección al login: SesionCaducaError', async () => {
    expect(
      await error(declaracion(secuencia([LOGIN])).estado(sesion(), '76123456-0')),
    ).toBeInstanceOf(SesionCaducaError);
    const t = secuencia([
      http(302, '', { location: 'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/x.html' }),
    ]);
    expect(await error(declaracion(t).estado(sesion(), '76123456-0'))).toBeInstanceOf(
      SesionCaducaError,
    );
    expect(t.enviadas).toHaveLength(1);
  });

  it('una falla de red sale como ErrorTransporte (sin envolver)', async () => {
    expect(
      await error(declaracion(secuencia([falla])).estado(sesion(), '76123456-0')),
    ).toBeInstanceOf(ErrorTransporte);
  });

  it('IncompatibleRemoteServiceException: ErrorPostulacion que pide recapturar el portal', async () => {
    const e = await error(declaracion(secuencia([INCOMPATIBLE])).estado(sesion(), '76123456-0'));
    expect(e).toBeInstanceOf(ErrorPostulacion);
    expect((e as Error).message).toContain('actualizó el portal de boletas');
  });

  it('una redirección dentro de www4 sigue con GET conservando las cabeceras GWT', async () => {
    const t = secuencia([http(302, '', { location: '/certBolElectDteInternet/facade?x=1' }), P90]);
    const e = await declaracion(t).estado(sesion(), '76123456-0');
    expect(e.codigo).toBe('P90');
    expect(t.enviadas[1]?.metodo).toBe('GET');
    expect(t.enviadas[1]?.bytes).toBeUndefined();
    expect(t.enviadas[1]?.cabeceras).toMatchObject({
      'Content-Type': 'text/x-gwt-rpc; charset=UTF-8',
      'X-GWT-Permutation': PERMUTACION_DECLARACION,
      Referer: 'https://www4.sii.cl/certBolElectDteInternet/facade',
    });
  });

  it('una redirección fuera de www4 se detiene sin seguirla', async () => {
    const t = secuencia([http(302, '', { location: 'https://evil.example/facade' })]);
    expect(await error(declaracion(t).estado(sesion(), '76123456-0'))).toBeInstanceOf(
      ErrorPostulacion,
    );
    expect(t.enviadas).toHaveLength(1);
  });
});

// --- declarar() -------------------------------------------------------------------------

describe('declarar()', () => {
  it('P90 → razón social → documentos → autorizarEmpresaBolProd (conexión propia) → P91', async () => {
    const t = secuencia([P90, NOMBRE, DOCUMENTOS, AUTORIZAR_P91]);
    const e = await declaracion(t).declarar(sesion(), DATOS);

    expect(e.codigo).toBe('P91');
    expect(e.glosa).toBe('DECLARACION EFECTUADA 11111111-1');
    expect(e.paso).toBe(90);
    expect(e.empresa.toString()).toBe('76123456-0');
    expect(e.autorizada()).toBe(true);

    expect(t.enviadas.map(metodoGwt)).toEqual([
      'obtenerEstadoAutorizaEmp',
      'recuperarNombreContribuyente',
      'listarDocAutorizados',
      'autorizarEmpresaBolProd',
    ]);
    expect(t.enviadas.map((p) => p.conexionNueva)).toEqual([false, false, false, true]);

    const cuerpo = cuerpoDe(t.enviadas[3]);
    // Fecha de hoy en Chile (23:30 del 7), no la UTC (8).
    expect(cuerpo).toContain('|07-11-2026|');
    expect(cuerpo).not.toContain('08-11-2026');
    expect(cuerpo).toContain('|SOCIEDAD DE PRUEBA ÑUÑOA SPA|');
    expect(cuerpo).toContain('|software@empresa-prueba.cl|Proveedor de Prueba SpA|');
    expect(cuerpo).toContain('|https://www.empresa-prueba.cl/boletas|');
    // listarDocAutorizados con el paso del estado, en texto.
    expect(cuerpoDe(t.enviadas[2])).toMatch(/\|90\|1\|2\|3\|4\|3\|5\|6\|6\|5\|76123456\|7\|8\|$/);
  });

  it('el paso del estado se reenvía (y 90 si viene nulo)', async () => {
    const t1 = secuencia([estadoGwt('P90', '91', 'X'), NOMBRE, DOCUMENTOS, AUTORIZAR_P91]);
    expect((await declaracion(t1).declarar(sesion(), DATOS)).paso).toBe(91);
    expect(cuerpoDe(t1.enviadas[2]).split('|')).toContain('91');

    const t2 = secuencia([estadoGwt('P90', null, 'X'), NOMBRE, DOCUMENTOS, AUTORIZAR_P91]);
    expect((await declaracion(t2).declarar(sesion(), DATOS)).paso).toBeNull();
    expect(cuerpoDe(t2.enviadas[2]).split('|')).toContain('90');
  });

  it('sin RUT_NS o DV_NS: SesionCaducaError sin enviar nada', async () => {
    for (const quitar of ['RUT_NS', 'DV_NS']) {
      const t = secuencia([P90]);
      const e = await error(
        declaracion(t).declarar(sesion(COOKIES.filter((c) => c.name !== quitar)), DATOS),
      );
      expect(e).toBeInstanceOf(SesionCaducaError);
      expect(t.enviadas).toHaveLength(0);
    }
  });

  it('un RUT de usuario inválido en las cookies lanza ErrorValidacion sin enviar nada', async () => {
    const t = secuencia([P90]);
    const cookies = COOKIES.map((c) => (c.name === 'DV_NS' ? { ...c, value: '2' } : c));
    expect(await error(declaracion(t).declarar(sesion(cookies), DATOS))).toBeInstanceOf(
      ErrorValidacion,
    );
    expect(t.enviadas).toHaveLength(0);
  });

  it('sin P90 no declara: solo consulta el estado', async () => {
    const t = secuencia([P91]);
    const e = await error(declaracion(t).declarar(sesion(), DATOS));
    expect(e).toBeInstanceOf(ErrorPostulacion);
    expect(e).not.toBeInstanceOf(DeclaracionInciertaError);
    expect((e as Error).message).toContain('(estado P91 DECLARACION EFECTUADA 11111111-1)');
    expect(t.enviadas).toHaveLength(1);

    const t2 = secuencia([NULO]);
    const e2 = await error(declaracion(t2).declarar(sesion(), DATOS));
    expect((e2 as Error).message).toContain('sin trámite pendiente');
    expect(t2.enviadas).toHaveLength(1);
  });

  it('sin razón social o sin documentos no declara', async () => {
    for (const [nombre, documentos] of [
      [texto(''), DOCUMENTOS],
      [NULO, DOCUMENTOS],
      [NOMBRE, NULO],
      [NOMBRE, ok([1, 0], [ARRAY_LIST])],
      [NOMBRE, entero(3)],
    ] as const) {
      const t = secuencia([P90, nombre, documentos, AUTORIZAR_P91]);
      const e = await error(declaracion(t).declarar(sesion(), DATOS));
      expect(e).toBeInstanceOf(ErrorPostulacion);
      expect(e).not.toBeInstanceOf(DeclaracionInciertaError);
      expect(t.enviadas).toHaveLength(3);
    }
  });

  it('antes de la orden, HTTP ≠ 200 y la red siguen su categoría (no es incierta)', async () => {
    const e1 = await error(declaracion(secuencia([P90, http(500)])).declarar(sesion(), DATOS));
    expect(e1).toBeInstanceOf(ErrorTransporte);
    const e2 = await error(declaracion(secuencia([P90, NOMBRE, falla])).declarar(sesion(), DATOS));
    expect(e2).toBeInstanceOf(ErrorTransporte);
    const e3 = await error(declaracion(secuencia([P90, LOGIN])).declarar(sesion(), DATOS));
    expect(e3).toBeInstanceOf(SesionCaducaError);
  });

  describe('desde el POST de autorizarEmpresaBolProd, toda falla es DeclaracionInciertaError', () => {
    const casos: [string, Respuesta, (new (...args: never[]) => Error) | undefined][] = [
      ['falla de red', falla, ErrorTransporte],
      [
        'error inesperado del transporte',
        () => {
          throw new TypeError('algo raro');
        },
        TypeError,
      ],
      ['HTTP 500', http(500, 'The call failed on the server'), ErrorTransporte],
      [
        'HTTP 500 aunque traiga P91 (el PHP lo daba por declarada)',
        http(500, AUTORIZAR_P91),
        ErrorTransporte,
      ],
      ['HTTP 404', http(404), ErrorTransporte],
      ['página de login', LOGIN, SesionCaducaError],
      [
        'redirección al login',
        http(302, '', { location: 'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/x.html' }),
        SesionCaducaError,
      ],
      [
        'redirección fuera de www4',
        http(302, '', { location: 'https://evil.example/' }),
        ErrorPostulacion,
      ],
      ['respuesta GWT mal formada', '//OK[1,2', ErrorPostulacion],
      ['respuesta que no es GWT', '<html>error</html>', ErrorPostulacion],
      ['//EX', EX, ErrorPostulacion],
      ['IncompatibleRemoteServiceException', INCOMPATIBLE, ErrorPostulacion],
      ['respuesta nula', NULO, undefined],
      ['PostulSegHistInsUpdTo sin P91', POSTULACION_P90, undefined],
      ['otro tipo con P91', estadoGwt('P91', '90', 'X'), undefined],
      ['un Integer', entero(1), undefined],
    ];

    for (const [nombre, respuesta, causa] of casos) {
      it(nombre, async () => {
        const t = secuencia([P90, NOMBRE, DOCUMENTOS, respuesta]);
        const e = await error(declaracion(t).declarar(sesion(), DATOS));
        expect(e).toBeInstanceOf(DeclaracionInciertaError);
        expect((e as DeclaracionInciertaError).rutEmpresa).toBe('76123456-0');
        expect((e as Error).message).toContain('Consulta el estado antes de volver a declarar.');
        if (causa === undefined) {
          expect((e as Error).message).toContain('sin el estado P91');
        } else {
          expect((e as Error).cause).toBeInstanceOf(causa);
        }
        expect(t.enviadas[3]?.conexionNueva).toBe(true);
        expect(metodoGwt(t.enviadas[3])).toBe('autorizarEmpresaBolProd');
      });
    }

    it('una 307 repite el POST por una conexión propia', async () => {
      const t = secuencia([
        P90,
        NOMBRE,
        DOCUMENTOS,
        http(307, '', { location: '/certBolElectDteInternet/facade2' }),
        AUTORIZAR_P91,
      ]);
      expect((await declaracion(t).declarar(sesion(), DATOS)).codigo).toBe('P91');
      expect(t.enviadas[4]?.metodo).toBe('POST');
      expect(t.enviadas[4]?.conexionNueva).toBe(true);
      expect(cuerpoDe(t.enviadas[4])).toBe(cuerpoDe(t.enviadas[3]));
    });
  });
});

// --- solicitarRevisionSet() -------------------------------------------------------------

describe('solicitarRevisionSet()', () => {
  const TRACK = '123456789012';

  it('respuesta "1": listo; código 90 con actividades afectas', async () => {
    const t = secuencia([entero(3), texto('1')]);
    await declaracion(t).solicitarRevisionSet(sesion(), '76123456-0', TRACK);
    expect(t.enviadas.map(metodoGwt)).toEqual([
      'recuperarNroActividadesVigAfecIva',
      'ingresarTrackId',
    ]);
    expect(cuerpoDe(t.enviadas[1])).toBe(
      GwtRpc.llamada(
        BASE_DECLARACION,
        POLICY_DECLARACION,
        SERVICIO_DECLARACION,
        'ingresarTrackId',
        [
          [INTEGER, (w) => w.integer(76123456)],
          [GwtRpc.STRING, (w) => w.string('0')],
          [GwtRpc.STRING, (w) => w.string(null)],
          [GwtRpc.STRING, (w) => w.string('90')],
          [INTEGER, (w) => w.integer(null)],
          [GwtRpc.STRING, (w) => w.string(null)],
          [GwtRpc.STRING, (w) => w.string(TRACK)],
        ],
      ),
    );
  });

  it.each([
    ['Integer 0', entero(0), '91'],
    ['Integer negativo', entero(-1), '91'],
    ['nulo', NULO, '91'],
    ['Long positivo', `//OK['B',1,["java.lang.Long/4227064769"],0,7]`, '90'],
    ['String "5"', ok([1, 2], ['java.lang.String/2004016611', '5']), '90'],
    ['String " 2abc"', ok([1, 2], ['java.lang.String/2004016611', ' 2abc']), '90'],
    ['String "abc"', ok([1, 2], ['java.lang.String/2004016611', 'abc']), '91'],
    ['String "0.5"', ok([1, 2], ['java.lang.String/2004016611', '0.5']), '91'],
    ['lista', ok([1, 0], [ARRAY_LIST]), '91'],
  ])('actividades %s', async (_, actividades, codigo) => {
    const t = secuencia([actividades, texto('1')]);
    await declaracion(t).solicitarRevisionSet(sesion(), '76123456-0', TRACK);
    const tabla = cuerpoDe(t.enviadas[1]).split('|');
    expect(tabla[6]).toBe('ingresarTrackId');
    expect(tabla[9]).toBe('0'); // dv
    expect(tabla[10]).toBe(codigo);
  });

  it.each([['abc'], [''], ['1234567890123456'], ['123\n'], [' 123'], ['12.3'], ['-1']])(
    'trackId inválido %j: ErrorValidacion sin enviar nada',
    async (trackId) => {
      const t = secuencia([entero(1), texto('1')]);
      expect(
        await error(declaracion(t).solicitarRevisionSet(sesion(), '76123456-0', trackId)),
      ).toBeInstanceOf(ErrorValidacion);
      expect(t.enviadas).toHaveLength(0);
    },
  );

  it('"errorEstado": SetSinDescargarError', async () => {
    const e = await error(
      declaracion(secuencia([entero(1), texto('errorEstado')])).solicitarRevisionSet(
        sesion(),
        '76123456-0',
        TRACK,
      ),
    );
    expect(e).toBeInstanceOf(SetSinDescargarError);
    expect((e as Error).message).toContain('primero hay que descargar el set');
  });

  it.each([
    ['nula', NULO, '(respuesta: NULL)'],
    ['otra', texto('0'), "(respuesta: '0')"],
    ['con comilla y barra', texto("it's \\ down"), "(respuesta: 'it\\'s \\\\ down')"],
  ])('respuesta %s: ErrorPostulacion con el var_export', async (_, respuesta, detalle) => {
    const e = await error(
      declaracion(secuencia([entero(1), respuesta])).solicitarRevisionSet(
        sesion(),
        '76123456-0',
        TRACK,
      ),
    );
    expect(e).toBeInstanceOf(ErrorPostulacion);
    expect(e).not.toBeInstanceOf(SetSinDescargarError);
    expect((e as Error).message).toContain(`${detalle}. Intenta más tarde.`);
  });

  it('HTTP ≠ 200 es ErrorTransporte e IncompatibleRemoteService es ErrorPostulacion', async () => {
    expect(
      await error(
        declaracion(secuencia([entero(1), http(502)])).solicitarRevisionSet(
          sesion(),
          '76123456-0',
          TRACK,
        ),
      ),
    ).toBeInstanceOf(ErrorTransporte);
    expect(
      await error(
        declaracion(secuencia([INCOMPATIBLE])).solicitarRevisionSet(sesion(), '76123456-0', TRACK),
      ),
    ).toBeInstanceOf(ErrorPostulacion);
  });
});

// --- descargarSetPruebas() --------------------------------------------------------------

describe('descargarSetPruebas()', () => {
  const CORREO = 'software@empresa-prueba.cl';
  const SET = 'SET DE PRUEBA BOLETA ELECTRÓNICA\r\nCASO-1\r\nAlineación 1 9900\r\n';

  it('sin P90: GET DownloadFileServlet (query de http_build_query, Referer ?SET=1), set en ISO-8859-1', async () => {
    const t = secuencia([NULO, NULO, http(200, Buffer.from(SET, 'latin1'))]);
    const set = await declaracion(t).descargarSetPruebas(sesion(), '76123456-0', CORREO);
    expect(set).toBe(SET);

    expect(t.enviadas.map(metodoGwt).slice(0, 2)).toEqual([
      'obtenerPostulacionSeg',
      'obtenerEstadoAutorizaEmp',
    ]);
    const get = t.enviadas[2];
    expect(get?.metodo).toBe('GET');
    expect(get?.url).toBe(
      'https://www4.sii.cl/certBolElectDteInternet/DownloadFileServlet?rutEmpresa=76123456&dvEmpresa=0&rutRepre=11111111&dvRepre=1&mailProvSw=software%40empresa-prueba.cl',
    );
    expect(get?.bytes).toBeUndefined();
    expect(get?.conexionNueva).toBe(false);
    expect(get?.cabeceras.Referer).toBe('https://www4.sii.cl/certBolElectDteInternet/?SET=1');
    expect(get?.cabeceras['Content-Type']).toBeUndefined();
    expect(get?.cabeceras['X-GWT-Permutation']).toBeUndefined();
  });

  it('un set en UTF-8 se devuelve tal cual', async () => {
    const t = secuencia([NULO, NULO, http(200, Buffer.from(SET, 'utf8'))]);
    expect(await declaracion(t).descargarSetPruebas(sesion(), '76123456-0', CORREO)).toBe(SET);
  });

  it('candado: obtenerPostulacionSeg no nulo (P90) → no descarga ni consulta el estado', async () => {
    const t = secuencia([POSTULACION_P90, NULO, http(200, SET)]);
    const e = await error(declaracion(t).descargarSetPruebas(sesion(), '76123456-0', CORREO));
    expect(e).toBeInstanceOf(ErrorPostulacion);
    expect((e as Error).message).toContain('reiniciaría su certificación');
    expect(t.enviadas).toHaveLength(1);
  });

  it('candado: obtenerPostulacionSeg nulo pero estado P90 → no descarga', async () => {
    const t = secuencia([NULO, P90, http(200, SET)]);
    expect(
      await error(declaracion(t).descargarSetPruebas(sesion(), '76123456-0', CORREO)),
    ).toBeInstanceOf(ErrorPostulacion);
    expect(t.enviadas).toHaveLength(2);
  });

  it('con P91 sí descarga', async () => {
    const t = secuencia([NULO, P91, http(200, SET)]);
    expect(await declaracion(t).descargarSetPruebas(sesion(), '76123456-0', CORREO)).toBe(SET);
  });

  it('HTTP 200 sin "SET DE PRUEBA" o sin "CASO-": ErrorPostulacion con el texto del SII', async () => {
    for (const cuerpo of [
      '<html><body><h3>No fue posible generar el set.</h3></body></html>',
      'SET DE PRUEBA sin casos',
      'CASO-1 sin título',
    ]) {
      const e = await error(
        declaracion(secuencia([NULO, NULO, http(200, cuerpo)])).descargarSetPruebas(
          sesion(),
          '76123456-0',
          CORREO,
        ),
      );
      expect(e).toBeInstanceOf(ErrorPostulacion);
      expect((e as Error).message).toContain('(HTTP 200)');
    }
    const e = await error(
      declaracion(
        secuencia([NULO, NULO, http(200, '<html><body><h3>No fue posible.</h3></body></html>')]),
      ).descargarSetPruebas(sesion(), '76123456-0', CORREO),
    );
    expect((e as Error).message).toBe(
      'El SII no entregó el set de pruebas de 76123456-0 (HTTP 200). No fue posible.',
    );
  });

  it('HTTP ≠ 200 (aunque traiga el set): ErrorTransporte con el código y el texto', async () => {
    const e = await error(
      declaracion(secuencia([NULO, NULO, http(500, SET)])).descargarSetPruebas(
        sesion(),
        '76123456-0',
        CORREO,
      ),
    );
    expect(e).toBeInstanceOf(ErrorTransporte);
    expect((e as ErrorTransporte).status).toBe(500);
    expect((e as ErrorTransporte).url).toBe(
      'https://www4.sii.cl/certBolElectDteInternet/DownloadFileServlet',
    );
    expect((e as Error).message).toContain('(HTTP 500)');
  });

  it('el login en la descarga es SesionCaducaError, antes que el código', async () => {
    expect(
      await error(
        declaracion(secuencia([NULO, NULO, http(500, LOGIN)])).descargarSetPruebas(
          sesion(),
          '76123456-0',
          CORREO,
        ),
      ),
    ).toBeInstanceOf(SesionCaducaError);
  });

  it('valida RUT, usuario y correo antes de enviar nada', async () => {
    const t = secuencia([NULO, NULO, http(200, SET)]);
    const d = declaracion(t);
    expect(await error(d.descargarSetPruebas(sesion(), '76123456-1', CORREO))).toBeInstanceOf(
      ErrorValidacion,
    );
    expect(
      await error(d.descargarSetPruebas(sesion(COOKIES.slice(0, 1)), '76123456-0', CORREO)),
    ).toBeInstanceOf(SesionCaducaError);
    expect(
      await error(d.descargarSetPruebas(sesion(), '76123456-0', 'soft+ware@empresa-prueba.cl')),
    ).toBeInstanceOf(ErrorValidacion);
    expect(t.enviadas).toHaveLength(0);
  });
});

// --- verificarPortal() ------------------------------------------------------------------

describe('verificarPortal()', () => {
  const METODOS = [
    'obtenerEstadoAutorizaEmp',
    'recuperarNombreContribuyente',
    'listarDocAutorizados',
    'autorizarEmpresaBolProd',
    'recuperarNroActividadesVigAfecIva',
    'ingresarTrackId',
    'obtenerPostulacionSeg',
  ];
  const completo = [
    POLICY_DECLARACION,
    SERVICIO_DECLARACION,
    F.estado,
    F.postulacion,
    F.empresaAutorizada,
    F.documento,
    'DownloadFileServlet',
    ...METODOS.map((m) => `'${m}'`),
  ].join(';');

  it('vigente: GET del .cache.html sin cookies → sin problemas', async () => {
    const t = secuencia([completo]);
    expect(await declaracion(t).verificarPortal()).toEqual([]);
    expect(t.enviadas).toHaveLength(1);
    expect(t.enviadas[0]?.metodo).toBe('GET');
    expect(t.enviadas[0]?.url).toBe(
      'https://www4.sii.cl/certBolElectDteInternet/0FC3D987613537E6E13E9BB93A406F13.cache.html',
    );
    expect(t.enviadas[0]?.cabeceras.Cookie).toBeUndefined();
    expect(t.enviadas[0]?.cabeceras.Referer).toBeUndefined();
  });

  it('404: el SII publicó otra versión (se devuelve como problema)', async () => {
    expect(await declaracion(secuencia([http(404)])).verificarPortal()).toEqual([
      'El SII publicó otra versión del portal de boletas: ya no existe la versión capturada (0FC3D987613537E6E13E9BB93A406F13).',
    ]);
  });

  it('con faltantes: uno por cada texto que no está, en orden', async () => {
    const cuerpo = completo
      .replace(F.documento, '')
      .replace(POLICY_DECLARACION, '')
      .replace("'ingresarTrackId'", 'ingresarTrackId');
    expect(await declaracion(secuencia([cuerpo])).verificarPortal()).toEqual([
      'El portal de boletas del SII cambió: falta POLICY 082D0AC4BC4D75A5DF38F116C53877D4.',
      'El portal de boletas del SII cambió: falta tipo DocumentoAutorizadoTo.',
      'El portal de boletas del SII cambió: falta método ingresarTrackId.',
    ]);
  });

  it('500 o falla de red: ErrorTransporte', async () => {
    const e = await error(declaracion(secuencia([http(500)])).verificarPortal());
    expect(e).toBeInstanceOf(ErrorTransporte);
    expect((e as ErrorTransporte).status).toBe(500);
    expect((e as Error).message).toBe(
      'No se pudo verificar el portal de boletas del SII (HTTP 500).',
    );
    expect(await error(declaracion(secuencia([falla])).verificarPortal())).toBeInstanceOf(
      ErrorTransporte,
    );
  });
});
