// Tests de PostulacionSii (port de src/Postulacion/PostulacionSii.php de
// winex/certificacion v1.9.1, que no tenía tests: pend. 6.1). Todo pasa por el
// TransporteFalso: ninguna petición sale a la red. Cubren los 4 pasos, los avisos,
// el filtrado y la combinación de campos (con la semántica de los arreglos de PHP),
// la conversión a ISO-8859-1, el chequeo de la confirmación antes de grabar, los
// marcadores de rechazo, la sesión caducada, los códigos HTTP y qué pasa desde el
// POST que graba.
//
// Las páginas son las sintéticas de paridad/postulacion/paginas/ (mismo estilo que
// el asistente del SII, sin datos reales).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ErrorPostulacion,
  ErrorSolicitudFolios,
  ErrorTransporte,
  SesionCaducaError,
} from '../../../src/comun/errores.ts';
import { RespuestaHttp } from '../../../src/comun/http/respuesta.ts';
import {
  type PeticionRegistrada,
  TransporteFalso,
} from '../../../src/comun/http/transporte-falso.ts';
import { relojFijo } from '../../../src/comun/reloj.ts';
import { Certificado } from '../../../src/core/certificado.ts';
import { SesionSii } from '../../../src/folios/sesion-sii.ts';
import {
  DatosPostulacion,
  type EntradaPostulacion,
} from '../../../src/postulacion/datos-postulacion.ts';
import {
  combinarComoArrayMerge,
  HOST_POSTULACION,
  MS_POSTULACION,
  PostulacionSii,
} from '../../../src/postulacion/postulacion-sii.ts';

const PARIDAD = join(dirname(fileURLToPath(import.meta.url)), '../../../../../paridad');
const texto = (nombre: string): string =>
  readFileSync(join(PARIDAD, 'postulacion/paginas', `${nombre}.html`), 'utf8');
const latin1 = (html: string): Buffer => Buffer.from(html, 'latin1');
const pagina = (nombre: string): Buffer => latin1(texto(nombre));

type Respuesta = Buffer | string | RespuestaHttp | (() => never);

/** Transporte falso que responde en orden, sin importar la URL. */
function secuencia(respuestas: Respuesta[]): TransporteFalso {
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

const redireccion = (location: string, status = 302): RespuestaHttp =>
  new RespuestaHttp(status, { location });

const sesion = (): SesionSii =>
  SesionSii.desdeArreglo([
    { name: 'TOKEN', value: 'TOKENDEPRUEBA', domain: 'sii.cl', host_only: false },
  ]);

const ENTRADA: EntradaPostulacion = {
  rutEmpresa: '76123456-0',
  rutAdministrador: '11111111-1',
  correoAdministrador: 'admin@empresa-prueba.cl',
  correoContactoSii: 'contacto@empresa-prueba.cl',
  correoIntercambio: 'dte@empresa-prueba.cl',
  nombreSoftware: 'Software de Prueba',
  boletaExenta: true,
  url: 'www.empresa-prueba.cl',
};
const datos = (cambios: Partial<EntradaPostulacion> = {}): DatosPostulacion =>
  new DatosPostulacion({ ...ENTRADA, ...cambios });

const escapar = (v: string): string =>
  [...v]
    .map((c) => {
      if (c === '&') return '&amp;';
      if (c === '"') return '&quot;';
      if (c === '<') return '&lt;';
      if (c === '>') return '&gt;';
      const n = c.codePointAt(0) ?? 0;
      return n < 0x80 ? c : `&#${n};`;
    })
    .join('');

function datosEmpresa(extra = '', meta = '', razonSocial = 'COMERCIAL DE PRUEBA LIMITADA'): Buffer {
  return latin1(
    texto('datos-empresa')
      .replace('{{META}}', meta)
      .replaceAll('{{RAZON_SOCIAL}}', razonSocial)
      .replace('{{EXTRA}}', extra),
  );
}

/** Confirmación que repite `entrada`, con `cambios` por campo; `bolexen: null` lo omite. */
function confirma(
  entrada: EntradaPostulacion = ENTRADA,
  cambios: Record<string, string> = {},
  opciones: { bolexen?: string | null; action?: string } = {},
): Buffer {
  const [rutEmp, dvEmp] = entrada.rutEmpresa.split('-') as [string, string];
  const [rutUsu, dvUsu] = entrada.rutAdministrador.split('-') as [string, string];
  const valores: Record<string, string> = {
    RUT_EMP: rutEmp,
    DV_EMP: dvEmp,
    RUT_USU: rutUsu,
    DV_USU: dvUsu,
    MAIL_SUP: entrada.correoAdministrador,
    MAIL_SII: entrada.correoContactoSii,
    MAIL_DTE: entrada.correoIntercambio,
    URL: entrada.url ?? '',
    NOM_SW: entrada.nombreSoftware,
    ESBOL: 'S',
    BOLELEC: 'S',
    ESFAC: 'N',
    RAZON_SOCIAL: 'COMERCIAL DE PRUEBA LIMITADA',
    ...cambios,
  };
  const bolexen =
    opciones.bolexen === undefined
      ? entrada.boletaExenta === false
        ? 'N'
        : 'S'
      : opciones.bolexen;
  let html = texto('confirma')
    .replace('{{META}}', '')
    .replace('{{ACTION}}', opciones.action ?? 'pe_graba_postulacion')
    .replace(
      '{{BOLEXEN}}',
      bolexen === null ? '' : `<INPUT TYPE="hidden" NAME="BOLEXEN" VALUE="${escapar(bolexen)}">\n`,
    );
  for (const [campo, valor] of Object.entries(valores)) {
    html = html.replaceAll(`{{${campo}}}`, escapar(valor));
  }
  return latin1(html);
}

const flujo = (final: Respuesta = pagina('aceptada'), conf: Buffer = confirma()): Respuesta[] => [
  pagina('pe-ingrut'),
  datosEmpresa(),
  conf,
  final,
];

const postulacion = (t: TransporteFalso): PostulacionSii =>
  new PostulacionSii({ transporte: t, reloj: relojFijo('2026-11-07T15:00:00Z') });

/** Campos de un POST como pares [nombre, valor latin1]. */
const campos = (p: PeticionRegistrada | undefined): [string, string][] => {
  const cuerpo = p?.cuerpo;
  if (cuerpo?.tipo !== 'formulario') throw new Error('sin formulario');
  return [...(cuerpo.campos as Iterable<[string, Uint8Array | string]>)].map(([k, v]) => [
    k,
    typeof v === 'string' ? v : Buffer.from(v).toString('latin1'),
  ]);
};
const nombres = (p: PeticionRegistrada | undefined): string[] => campos(p).map(([k]) => k);
const BASE = `https://${HOST_POSTULACION}/cvc_cgi/dte`;

describe('PostulacionSii.postular: flujo completo', () => {
  it('recorre los 4 pasos con las URLs, Referer, campos y codificación del PHP', async () => {
    const t = secuencia(flujo());
    const r = await postulacion(t).postular(sesion(), datos());

    expect(t.urls()).toEqual([
      `${BASE}/pe_ingrut`,
      `${BASE}/pe_datos_empresa`,
      `${BASE}/pe_confirma`,
      `${BASE}/pe_graba_postulacion`,
    ]);
    const [ingrut, rut, conf, graba] = t.enviadas;
    expect(t.enviadas.every((p) => p.metodo === 'POST' && p.msRespuesta === MS_POSTULACION)).toBe(
      true,
    );
    expect(ingrut?.cabeceras.Referer).toBe(
      `https://${HOST_POSTULACION}/cvc/dte/pe_condiciones.html`,
    );
    expect(rut?.cabeceras.Referer).toBe(`${BASE}/pe_ingrut`);
    expect(conf?.cabeceras.Referer).toBe(`${BASE}/pe_datos_empresa`);
    expect(graba?.cabeceras.Referer).toBe(`${BASE}/pe_confirma`);

    expect(campos(ingrut)).toEqual([['ACEPTAR', 'Aceptar Condiciones']]);
    // array_merge: RUT_EMP/DV_EMP reemplazan en su lugar; OPCION (hidden) sigue.
    expect(campos(rut)).toEqual([
      ['RUT_EMP', '76123456'],
      ['DV_EMP', '0'],
      ['OPCION', 'BOL'],
    ]);
    // Filtrados ESFAC, FACT, ND, SET03 y BOLEXEN del formulario; sin select, disabled,
    // botones ni image; ESBOL y BOLEXEN (no venían marcados / se quitaron) y GRABAR al final.
    expect(campos(conf)).toEqual([
      ['RUT_EMP', '76123456'],
      ['DV_EMP', '0'],
      ['RAZON_SOCIAL', 'COMERCIAL DE PRUEBA LIMITADA'],
      ['RUT_USU', '11111111'],
      ['DV_USU', '1'],
      ['MAIL_SUP', 'admin@empresa-prueba.cl'],
      ['MAIL_SII', 'contacto@empresa-prueba.cl'],
      ['MAIL_DTE', 'dte@empresa-prueba.cl'],
      ['URL', 'www.empresa-prueba.cl'],
      ['NOM_SW', 'Software de Prueba'],
      ['TIPO_SW', 'M'],
      ['BOLELEC', 'S'],
      ['ESBOL', 'S'],
      ['BOLEXEN', 'S'],
      ['GRABAR', 'Confirmar Datos'],
    ]);
    // "Confirmar Postulación" en ISO-8859-1 (ó = 0xF3).
    expect(graba?.bytes?.toString('latin1')).toMatch(/&CONF=Confirmar\+Postulaci%F3n$/);
    expect(nombres(graba)).toEqual([
      'RUT_EMP',
      'DV_EMP',
      'RUT_USU',
      'DV_USU',
      'MAIL_SUP',
      'MAIL_SII',
      'MAIL_DTE',
      'URL',
      'NOM_SW',
      'ESBOL',
      'BOLELEC',
      'BOLEXEN',
      'ESFAC',
      'RAZON_SOCIAL',
      'CONF',
    ]);
    // Solo el POST que graba va por una conexión propia.
    expect(t.enviadas.map((p) => p.conexionNueva)).toEqual([false, false, false, true]);

    expect(r.empresa.toString()).toBe('76123456-0');
    expect(r.avisos).toEqual([]);
    expect(r.mensaje).toMatch(/HA SIDO ACEPTADA/);
    expect(r.mensaje).not.toMatch(/código/); // el script de la página no cuenta
  });

  it('sin boleta exenta no envía BOLEXEN', async () => {
    const entrada = { ...ENTRADA, boletaExenta: false };
    const t = secuencia(flujo(pagina('aceptada'), confirma(entrada)));
    await postulacion(t).postular(sesion(), datos({ boletaExenta: false }));
    expect(nombres(t.enviadas[2])).not.toContain('BOLEXEN');
  });

  it('convierte cada valor a ISO-8859-1 (lo que no cabe → ?) y deja los nombres en UTF-8', async () => {
    const entrada = { ...ENTRADA, nombreSoftware: 'Señal & Cía €', url: 'www.ñandú.cl/?a=1&b=2' };
    const t = secuencia(flujo(pagina('aceptada'), confirma(entrada)));
    await postulacion(t).postular(sesion(), datos(entrada));
    const cuerpo = t.enviadas[2]?.bytes?.toString('latin1') ?? '';
    expect(cuerpo).toContain('&URL=www.%F1and%FA.cl%2F%3Fa%3D1%26b%3D2&');
    expect(cuerpo).toContain('&NOM_SW=Se%F1al+%26+C%EDa+%3F&');
  });

  it('el <meta charset=iso-8859-1> reenvía doblemente codificados los valores con tildes (defecto del PHP, por paridad)', async () => {
    const meta = '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=iso-8859-1">';
    const t = secuencia([
      pagina('pe-ingrut'),
      datosEmpresa('', meta, 'ÑUÑOA'),
      confirma(),
      pagina('aceptada'),
    ]);
    await postulacion(t).postular(sesion(), datos());
    // Ñ (0xD1) llega como los bytes UTF-8 C3 91: "Ã‘" leído en ISO-8859-1.
    expect(t.enviadas[2]?.bytes?.toString('latin1')).toContain('&RAZON_SOCIAL=%C3%91U%C3%91OA&');
  });

  it('renumera desde 0 los campos con nombre entero, como array_merge', async () => {
    const extra =
      '<INPUT TYPE="hidden" NAME="7" VALUE="a"><INPUT TYPE="hidden" NAME="07" VALUE="b"><INPUT TYPE="hidden" NAME="-3" VALUE="c">';
    const t = secuencia([pagina('pe-ingrut'), datosEmpresa(extra), confirma(), pagina('aceptada')]);
    await postulacion(t).postular(sesion(), datos());
    const pares = campos(t.enviadas[2]);
    expect(pares.slice(3, 6)).toEqual([
      ['0', 'a'],
      ['07', 'b'],
      ['1', 'c'],
    ]);
  });

  it('la página final tiene que decir "ha sido aceptada" (sin distinguir mayúsculas ni &nbsp;)', async () => {
    const t = secuencia(flujo(pagina('sin-aceptada')));
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(
      /no confirmó la postulación/,
    );
    expect(t.enviadas).toHaveLength(4);
  });
});

describe('PostulacionSii.postular: avisos', () => {
  const avisos = (n: number): Respuesta[] =>
    Array.from({ length: n }, (_, i) =>
      pagina(i % 2 === 0 ? 'aviso-facturador' : 'aviso-documentos'),
    );

  it.each([0, 1, 2, 3])('pasa %i página(s) de aviso con Continuar', async (n) => {
    const t = secuencia([
      pagina('pe-ingrut'),
      ...avisos(n),
      datosEmpresa(),
      confirma(),
      pagina('aceptada'),
    ]);
    const r = await postulacion(t).postular(sesion(), datos());
    expect(r.avisos).toHaveLength(n);
    expect(t.enviadas).toHaveLength(4 + n);
    for (let i = 0; i < n; i++) {
      const p = t.enviadas[2 + i];
      expect(campos(p).at(-1)).toEqual(['ACEPTAR', 'Continuar']);
      expect(p?.cabeceras.Referer).toBe(`${BASE}/pe_datos_empresa`);
    }
    if (n >= 2) {
      expect(r.avisos[0]).toMatch(
        /^La empresa es usuaria .* perderá su calidad de usuaria de ese sistema\. Presione$/,
      );
      expect(r.avisos[1]).toBe(
        'la empresa ya tiene una postulación «en curso»; al continuar se reemplaza por esta.',
      );
    }
  });

  it('con 4 avisos seguidos se detiene después de 3 vueltas', async () => {
    const t = secuencia([pagina('pe-ingrut'), ...avisos(4)]);
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(
      /no llegó al formulario de postulación/,
    );
    expect(t.enviadas).toHaveLength(5);
  });

  it('una página sin formulario ni aviso detiene el flujo', async () => {
    const t = secuencia([pagina('pe-ingrut'), '<p>Mantención</p>']);
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(
      /no llegó al formulario de postulación\. \(SII: Mantención\)/,
    );
  });

  it('el paso 1 tiene que mostrar el formulario del RUT', async () => {
    const t = secuencia(['<form action="otra"></form>']);
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(/formulario del RUT/);
  });
});

describe('PostulacionSii.postular: confirmación antes de grabar', () => {
  const CAMPOS: [string, string][] = [
    ['RUT_EMP', '76123457'],
    ['DV_EMP', 'K'],
    ['RUT_USU', '22222222'],
    ['DV_USU', '2'],
    ['MAIL_SUP', 'otro@empresa-prueba.cl'],
    ['MAIL_SII', 'otro@empresa-prueba.cl'],
    ['MAIL_DTE', "o'tro\\@empresa-prueba.cl"],
    ['NOM_SW', 'Otro Software'],
    ['ESBOL', 'N'],
    ['BOLELEC', ''],
    ['ESFAC', 'S'],
  ];

  it.each(CAMPOS)('si %s no calza, se detiene SIN el POST que graba', async (campo, valor) => {
    const t = secuencia([
      pagina('pe-ingrut'),
      datosEmpresa(),
      confirma(ENTRADA, { [campo]: valor }),
    ]);
    const error = await postulacion(t)
      .postular(sesion(), datos())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorPostulacion);
    const exportado = `'${valor.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    expect((error as Error).message).toBe(
      `Postulación detenida antes de grabar: la confirmación del SII trae ${campo}=${exportado}, distinto de lo enviado.`,
    );
    expect(t.urls()).not.toContain(`${BASE}/pe_graba_postulacion`);
  });

  it('la URL no se revisa (el PHP tampoco la mira)', async () => {
    const t = secuencia(flujo(pagina('aceptada'), confirma(ENTRADA, { URL: 'www.otra.cl' })));
    await postulacion(t).postular(sesion(), datos());
    expect(t.enviadas).toHaveLength(4);
  });

  it('compara sin distinguir mayúsculas solo en ASCII (strcasecmp)', async () => {
    const t = secuencia(
      flujo(pagina('aceptada'), confirma(ENTRADA, { MAIL_SUP: 'ADMIN@EMPRESA-PRUEBA.CL' })),
    );
    await postulacion(t).postular(sesion(), datos());

    const entrada = { ...ENTRADA, nombreSoftware: 'Señal' };
    const t2 = secuencia([
      pagina('pe-ingrut'),
      datosEmpresa(),
      confirma(entrada, { NOM_SW: 'SEÑAL' }),
    ]);
    await expect(postulacion(t2).postular(sesion(), datos(entrada))).rejects.toThrow(
      /NOM_SW='SEÑAL'/,
    );
  });

  it('un campo ausente se informa como NULL', async () => {
    const t = secuencia([
      pagina('pe-ingrut'),
      datosEmpresa(),
      confirma(ENTRADA, {}, { bolexen: null }),
    ]);
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(/trae BOLEXEN=NULL,/);
  });

  it.each([
    ['ausente', null],
    ['vacío', ''],
    ['N', 'N'],
  ])('sin boleta exenta acepta BOLEXEN %s', async (_, bolexen) => {
    const entrada = { ...ENTRADA, boletaExenta: false };
    const t = secuencia(flujo(pagina('aceptada'), confirma(entrada, {}, { bolexen })));
    await postulacion(t).postular(sesion(), datos(entrada));
    expect(t.enviadas).toHaveLength(4);
  });

  it('sin boleta exenta acepta BOLEXEN con blancos (form() aplica trim: llega vacío)', async () => {
    const entrada = { ...ENTRADA, boletaExenta: false };
    const t = secuencia(flujo(pagina('aceptada'), confirma(entrada, {}, { bolexen: '  ' })));
    await postulacion(t).postular(sesion(), datos(entrada));
    expect(t.enviadas).toHaveLength(4);
  });

  it.each(['S', 'n'])(
    'sin boleta exenta rechaza BOLEXEN=%j (comparación estricta)',
    async (bolexen) => {
      const entrada = { ...ENTRADA, boletaExenta: false };
      const t = secuencia([
        pagina('pe-ingrut'),
        datosEmpresa(),
        confirma(entrada, {}, { bolexen }),
      ]);
      await expect(postulacion(t).postular(sesion(), datos(entrada))).rejects.toThrow(
        `trae BOLEXEN='${bolexen}',`,
      );
    },
  );

  it('la confirmación tiene que apuntar a pe_graba_postulacion', async () => {
    const t = secuencia([
      pagina('pe-ingrut'),
      datosEmpresa(),
      confirma(ENTRADA, {}, { action: 'pe_otro' }),
    ]);
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(
      /no mostró la confirmación/,
    );
  });

  it('una confirmación que apunta a otro host se detiene antes de grabar', async () => {
    const t = secuencia([
      pagina('pe-ingrut'),
      datosEmpresa(),
      confirma(ENTRADA, {}, { action: 'https://www4.sii.cl/cvc_cgi/dte/pe_graba_postulacion' }),
    ]);
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(
      /fuera de maullin\.sii\.cl/,
    );
    expect(t.enviadas).toHaveLength(3);
  });
});

describe('PostulacionSii.postular: rechazos y sesión', () => {
  it.each([
    ['no est&aacute; autorizado', 'El usuario NO EST&Aacute; AUTORIZADO para postular.'],
    ['el código', 'EL C&Oacute;DIGO DE ESTE MENSAJE ES 01.01'],
    ['no es representante', 'Usted no es representante de la empresa'],
    ['No ha sido posible', 'No&nbsp;ha sido posible completar su solicitud'],
    ['Usted no tiene', 'usted NO TIENE permisos'],
  ])('un marcador de rechazo (%s) detiene el flujo', async (_, mensaje) => {
    const t = secuencia([pagina('pe-ingrut'), `<html><body><p>${mensaje}</p></body></html>`]);
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(
      /El SII rechazó la postulación\. \(SII: /,
    );
    expect(t.enviadas).toHaveLength(2);
  });

  it('un marcador dentro de un <script> no cuenta', async () => {
    const t = secuencia([
      pagina('pe-ingrut'),
      Buffer.concat([
        latin1('<script>var e = "no est&aacute; autorizado";</script>'),
        datosEmpresa(),
      ]),
      confirma(),
      pagina('aceptada'),
    ]);
    await postulacion(t).postular(sesion(), datos());
  });

  it('el paso 1 no revisa marcadores (como el PHP): solo busca el formulario', async () => {
    const t = secuencia([
      latin1(texto('pe-ingrut').replace('</BODY>', '<P>Usted no tiene avisos</P></BODY>')),
      datosEmpresa(),
      confirma(),
      pagina('aceptada'),
    ]);
    await postulacion(t).postular(sesion(), datos());
  });

  it('una redirección al login a mitad del flujo lanza SesionCaducaError sin seguirla', async () => {
    const t = secuencia([
      pagina('pe-ingrut'),
      datosEmpresa(),
      redireccion('https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoCertificado.html?x'),
    ]);
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(SesionCaducaError);
    expect(t.enviadas).toHaveLength(3);
  });

  it('una página que manda al login lanza SesionCaducaError', async () => {
    const t = secuencia([pagina('login-caducado')]);
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(SesionCaducaError);
  });

  it('una redirección fuera de maullin se detiene sin seguirla', async () => {
    const t = secuencia([pagina('pe-ingrut'), redireccion('https://palena.sii.cl/cvc_cgi/dte/x')]);
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(ErrorPostulacion);
    expect(t.enviadas).toHaveLength(2);
  });
});

describe('PostulacionSii.postular: códigos HTTP y red', () => {
  const caida = (): never => {
    throw new ErrorTransporte('No se pudo conectar con el SII.', `${BASE}/`);
  };

  it('antes de grabar, un código distinto de 200 lanza ErrorTransporte (reintentable)', async () => {
    const t = secuencia([
      pagina('pe-ingrut'),
      new RespuestaHttp(503, {}, '<p>Servicio no disponible</p>'),
    ]);
    const error = await postulacion(t)
      .postular(sesion(), datos())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect((error as ErrorTransporte).status).toBe(503);
  });

  it('antes de grabar, una falla de red lanza ErrorTransporte', async () => {
    const t = secuencia([pagina('pe-ingrut'), datosEmpresa(), caida]);
    await expect(postulacion(t).postular(sesion(), datos())).rejects.toThrow(ErrorTransporte);
  });

  it.each([
    ['HTTP 500', new RespuestaHttp(500, {}, '<p>Error interno</p>') as Respuesta],
    ['falla de red', caida as Respuesta],
  ])('desde el POST que graba, %s lanza ErrorPostulacion con la causa', async (_, final) => {
    const t = secuencia(flujo(final));
    const error = await postulacion(t)
      .postular(sesion(), datos())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorPostulacion);
    expect((error as Error).message).toMatch(/no se sabe si quedó grabada/);
    expect((error as Error).message).toMatch(/repetir la postulación es seguro/);
    expect((error as Error).cause).toBeInstanceOf(ErrorTransporte);
  });

  it('un 307 en el POST que graba repite el POST por una conexión propia', async () => {
    const t = secuencia([
      ...flujo().slice(0, 3),
      redireccion('pe_graba_postulacion?r=1', 307),
      pagina('aceptada'),
    ]);
    await postulacion(t).postular(sesion(), datos());
    const [, , , a, b] = t.enviadas;
    expect(b?.metodo).toBe('POST');
    expect(b?.bytes?.equals(a?.bytes ?? Buffer.alloc(0))).toBe(true);
    expect(b?.conexionNueva).toBe(true);
  });
});

describe('PostulacionSii.autenticar', () => {
  const certificado = (): Certificado =>
    Certificado.desdeContenido(readFileSync(join(PARIDAD, 'material/cert-cadena.pem')), '');
  const loginOk = readFileSync(join(PARIDAD, 'folios/paginas/login-ok.html'), 'utf8');

  it('usa el login de SolicitudFolios (certificación, TLS mutuo) y devuelve la sesión', async () => {
    const t = secuencia([loginOk]);
    const s = await postulacion(t).autenticar(certificado());
    expect(s.valor('TOKEN')).toBe('TOKENDEPRUEBAAUT2000');
    expect(t.enviadas[0]?.url).toBe(
      'https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?https://maullin.sii.cl/cvc_cgi/dte/of_solicita_folios',
    );
    expect(t.enviadas[0]?.tls).toBe(true);
  });

  it('un certificado rechazado sale como ErrorPostulacion (con la causa)', async () => {
    const t = secuencia(['<html><body>Certificado no válido</body></html>']);
    const error = await postulacion(t)
      .autenticar(certificado())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorPostulacion);
    expect((error as Error).cause).toBeInstanceOf(ErrorSolicitudFolios);
  });

  it('un código HTTP inesperado sale como ErrorTransporte', async () => {
    const t = secuencia([new RespuestaHttp(502, {}, '')]);
    await expect(postulacion(t).autenticar(certificado())).rejects.toThrow(ErrorTransporte);
  });
});

describe('combinarComoArrayMerge', () => {
  it('las claves de texto de la derecha reemplazan en su lugar; las enteras se renumeran', () => {
    const r = combinarComoArrayMerge(
      [
        ['a', '1'],
        ['5', 'x'],
        ['b', '2'],
        ['05', 'y'],
        ['-0', 'z'],
        ['9223372036854775808', 'grande'],
      ],
      [
        ['b', '3'],
        ['2', 'w'],
        ['c', '4'],
      ],
    );
    expect([...r]).toEqual([
      ['a', '1'],
      ['0', 'x'],
      ['b', '3'],
      ['05', 'y'],
      ['-0', 'z'],
      ['9223372036854775808', 'grande'],
      ['1', 'w'],
      ['c', '4'],
    ]);
  });
});
