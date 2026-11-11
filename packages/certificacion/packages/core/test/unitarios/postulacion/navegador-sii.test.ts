// Tests de NavegadorSii (port de src/Postulacion/NavegadorSii.php de
// winex/certificacion v1.9.1, que no tenía tests: pend. 6.1). Todo pasa por el
// TransporteFalso: ninguna petición sale a la red. Cubren el candado del host
// (y los más estrictos que adoptó folios), las redirecciones, los cuerpos crudos
// que usará DeclaracionBoletas, el código HTTP de pagina() y las lecturas de HTML
// propias de la postulación (form() y texto()). La paridad con el PHP está en
// test/paridad/postulacion.test.ts.

import { describe, expect, it } from 'vitest';
import {
  ErrorPostulacion,
  ErrorTransporte,
  SesionCaducaError,
} from '../../../src/comun/errores.ts';
import { RespuestaHttp } from '../../../src/comun/http/respuesta.ts';
import { TransporteFalso } from '../../../src/comun/http/transporte-falso.ts';
import { SesionSii } from '../../../src/folios/sesion-sii.ts';
import {
  contieneSinMayusculas,
  formularioPostulacion,
  NavegadorSii,
  stripTagsPhp,
  textoPostulacion,
} from '../../../src/postulacion/navegador-sii.ts';

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

const MAULLIN = 'https://maullin.sii.cl/cvc_cgi/dte';
const navegador = (t: TransporteFalso): NavegadorSii => new NavegadorSii(t, 'maullin.sii.cl');

const get = (url: string) => ({ metodo: 'GET' as const, url, msRespuesta: 70_000 });

describe('NavegadorSii.pedir: candado del host', () => {
  it('rechaza, sin enviar nada, otro host, http, puerto, usuario o una URL inválida', async () => {
    for (const url of [
      'https://palena.sii.cl/cvc_cgi/dte/pe_ingrut',
      'https://maullin.sii.cl.example.com/x',
      'http://maullin.sii.cl/cvc_cgi/dte/pe_ingrut',
      'https://maullin.sii.cl:8443/cvc_cgi/dte/pe_ingrut',
      'https://usuario@maullin.sii.cl/cvc_cgi/dte/pe_ingrut',
      'https://u:clave@maullin.sii.cl/x',
      'no es una url',
    ]) {
      const t = secuencia(['ok']);
      await expect(navegador(t).pedir(sesion(), get(url))).rejects.toThrow(
        /fuera de maullin\.sii\.cl/,
      );
      expect(t.enviadas).toHaveLength(0);
    }
  });

  it('acepta el host en mayúsculas y el puerto 443 explícito (URL lo normaliza)', async () => {
    const t = secuencia(['a', 'b']);
    const n = navegador(t);
    await n.pedir(sesion(), get('https://MAULLIN.sii.cl/cvc_cgi/dte/x'));
    await n.pedir(sesion(), get('https://maullin.sii.cl:443/cvc_cgi/dte/x'));
    expect(t.enviadas).toHaveLength(2);
  });

  it('el host del constructor se compara en minúsculas', async () => {
    const t = secuencia(['a']);
    await new NavegadorSii(t, 'MAULLIN.SII.CL').pedir(sesion(), get(`${MAULLIN}/x`));
    expect(t.enviadas).toHaveLength(1);
  });

  it('no sigue una redirección fuera del host', async () => {
    for (const destino of [
      'https://palena.sii.cl/cvc_cgi/dte/pe_datos_empresa',
      'http://maullin.sii.cl/cvc_cgi/dte/pe_datos_empresa',
      '//www4.sii.cl/x',
      'https://maullin.sii.cl:444/x',
    ]) {
      const t = secuencia([redireccion(destino), 'no debería llegar']);
      await expect(navegador(t).pedir(sesion(), get(`${MAULLIN}/pe_ingrut`))).rejects.toThrow(
        ErrorPostulacion,
      );
      expect(t.enviadas).toHaveLength(1);
    }
  });

  it('una redirección al login lanza SesionCaducaError sin seguirla', async () => {
    const t = secuencia([
      redireccion(
        'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoCertificado.html?https://maullin.sii.cl/x',
      ),
    ]);
    await expect(navegador(t).pedir(sesion(), get(`${MAULLIN}/pe_ingrut`))).rejects.toThrow(
      SesionCaducaError,
    );
    expect(t.enviadas).toHaveLength(1);
  });

  it('una URL inicial con un marcador del login lanza SesionCaducaError sin enviar', async () => {
    const t = secuencia(['ok']);
    await expect(navegador(t).pedir(sesion(), get(`${MAULLIN}/CAutInicio.cgi?x`))).rejects.toThrow(
      SesionCaducaError,
    );
    expect(t.enviadas).toHaveLength(0);
  });

  it('se detiene después de 10 redirecciones (11 peticiones)', async () => {
    const t = secuencia(Array.from({ length: 12 }, (_, i) => redireccion(`pe_ingrut?v=${i}`)));
    await expect(navegador(t).pedir(sesion(), get(`${MAULLIN}/pe_ingrut`))).rejects.toThrow(
      /demasiadas veces/,
    );
    expect(t.enviadas).toHaveLength(11);
  });
});

describe('NavegadorSii.pedir: peticiones', () => {
  it('envía un cuerpo crudo con su Content-Type y las cabeceras propias (GWT-RPC)', async () => {
    const t = secuencia(['//OK[1,["x"],0,7]']);
    const n = new NavegadorSii(t, 'www4.sii.cl');
    const r = await n.pedir(sesion(), {
      metodo: 'POST',
      url: 'https://www4.sii.cl/certBolElectDteInternet/facade',
      cuerpo: { tipo: 'crudo', datos: '7|0|4|ñ|', contentType: 'text/x-gwt-rpc; charset=UTF-8' },
      cabeceras: {
        'X-GWT-Permutation': 'PERMUTACION',
        Origin: 'https://www4.sii.cl',
        Referer: 'https://www4.sii.cl/certBolElectDteInternet/',
      },
      msRespuesta: 45_000,
    });
    expect(r.status).toBe(200);
    const [p] = t.enviadas;
    expect(p?.metodo).toBe('POST');
    expect(p?.cabeceras['Content-Type']).toBe('text/x-gwt-rpc; charset=UTF-8');
    expect(p?.cabeceras['X-GWT-Permutation']).toBe('PERMUTACION');
    expect(p?.cabeceras.Cookie).toBe('TOKEN=TOKENDEPRUEBA');
    expect(p?.cabeceras['User-Agent']).toMatch(/^Mozilla\/5\.0 /);
    expect(p?.cabeceras.Accept).toBe('*/*');
    expect(p?.bytes?.toString('utf8')).toBe('7|0|4|ñ|');
    expect(p?.msRespuesta).toBe(45_000);
  });

  it('una 307 repite el POST crudo; una 302 sigue con GET sin cuerpo y actualiza Referer', async () => {
    const t = secuencia([redireccion('facade2', 307), redireccion('/fin', 302), 'listo']);
    const n = new NavegadorSii(t, 'www4.sii.cl');
    await n.pedir(sesion(), {
      metodo: 'POST',
      url: 'https://www4.sii.cl/app/facade',
      cuerpo: { tipo: 'crudo', datos: 'cuerpo', contentType: 'text/plain' },
      cabeceras: { Referer: 'https://www4.sii.cl/app/' },
      msRespuesta: 45_000,
      conexionNueva: true,
    });
    const [a, b, c] = t.enviadas;
    expect(b?.metodo).toBe('POST');
    expect(b?.url).toBe('https://www4.sii.cl/app/facade2');
    expect(b?.bytes?.toString()).toBe('cuerpo');
    expect(b?.cabeceras.Referer).toBe(a?.url);
    expect(b?.conexionNueva).toBe(true);
    expect(c?.metodo).toBe('GET');
    expect(c?.bytes).toBeUndefined();
    expect(c?.conexionNueva).toBe(false);
    expect(c?.cabeceras.Referer).toBe(b?.url);
  });

  it('devuelve cualquier código HTTP sin revisarlo', async () => {
    const t = secuencia([new RespuestaHttp(404, {}, 'no')]);
    const r = await new NavegadorSii(t, 'www4.sii.cl').pedir(
      new SesionSii(),
      get('https://www4.sii.cl/app/X.cache.html'),
    );
    expect(r.status).toBe(404);
    expect(t.enviadas[0]?.cabeceras.Cookie).toBeUndefined();
  });

  it('una falla de red sale como ErrorTransporte', async () => {
    const t = secuencia([
      () => {
        throw new ErrorTransporte('No se pudo conectar.', 'https://maullin.sii.cl/');
      },
    ]);
    await expect(navegador(t).pedir(sesion(), get(`${MAULLIN}/x`))).rejects.toThrow(
      ErrorTransporte,
    );
  });

  it('guarda las cookies de cada respuesta, también de las redirecciones', async () => {
    const t = secuencia([
      new RespuestaHttp(302, { location: 'b', 'set-cookie': 'A=1; Path=/' }),
      'fin',
    ]);
    const s = sesion();
    await navegador(t).pedir(s, get(`${MAULLIN}/a`));
    expect(t.enviadas[1]?.cabeceras.Cookie).toBe('TOKEN=TOKENDEPRUEBA; A=1');
    expect(s.valor('A')).toBe('1');
  });
});

describe('NavegadorSii.pagina', () => {
  it('envía el formulario urlencoded con Referer y decodifica ISO-8859-1', async () => {
    const t = secuencia([Buffer.from('<p>Postulación</p>', 'latin1')]);
    const html = await navegador(t).pagina(sesion(), {
      metodo: 'POST',
      url: `${MAULLIN}/pe_ingrut`,
      formulario: [['ACEPTAR', 'Aceptar Condiciones']],
      referer: 'https://maullin.sii.cl/cvc/dte/pe_condiciones.html',
      msRespuesta: 70_000,
    });
    expect(html).toBe('<p>Postulación</p>');
    const [p] = t.enviadas;
    expect(p?.bytes?.toString()).toBe('ACEPTAR=Aceptar+Condiciones');
    expect(p?.cabeceras['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(p?.cabeceras.Referer).toBe('https://maullin.sii.cl/cvc/dte/pe_condiciones.html');
    expect(p?.conexionNueva).toBe(false);
  });

  it('deja tal cual una página UTF-8 válida', async () => {
    const t = secuencia([Buffer.from('<p>Postulación</p>', 'utf8')]);
    const html = await navegador(t).pagina(sesion(), {
      metodo: 'GET',
      url: `${MAULLIN}/x`,
      formulario: null,
      referer: `${MAULLIN}/x`,
      msRespuesta: 70_000,
    });
    expect(html).toBe('<p>Postulación</p>');
    expect(t.enviadas[0]?.bytes).toBeUndefined();
  });

  it('una página que manda al login lanza SesionCaducaError', async () => {
    const t = secuencia([
      '<script>location="https://zeusr.sii.cl/AUT2000/InicioAutenticacion/autInicioDTE.html"</script>',
    ]);
    await expect(
      navegador(t).pagina(sesion(), {
        metodo: 'GET',
        url: `${MAULLIN}/x`,
        formulario: null,
        referer: '',
        msRespuesta: 70_000,
      }),
    ).rejects.toThrow(SesionCaducaError);
  });

  it('exige HTTP 200 (pend. 1.9)', async () => {
    const t = secuencia([new RespuestaHttp(500, {}, '<p>Error interno</p>')]);
    const error = await navegador(t)
      .pagina(sesion(), {
        metodo: 'GET',
        url: `${MAULLIN}/x?rut=1`,
        formulario: null,
        referer: '',
        msRespuesta: 70_000,
      })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorTransporte);
    expect((error as ErrorTransporte).status).toBe(500);
    expect((error as ErrorTransporte).url).toBe(`${MAULLIN}/x`);
  });

  it('pasa conexionNueva al POST', async () => {
    const t = secuencia(['ok']);
    await navegador(t).pagina(sesion(), {
      metodo: 'POST',
      url: `${MAULLIN}/pe_graba_postulacion`,
      formulario: [['CONF', 'x']],
      referer: '',
      msRespuesta: 70_000,
      conexionNueva: true,
    });
    expect(t.enviadas[0]?.conexionNueva).toBe(true);
  });

  it('sesionVigente revisa los marcadores del login', () => {
    const n = navegador(secuencia([]));
    expect(() => n.sesionVigente('<a href="/cgi_AUT2000/CAutInicio.cgi">')).toThrow(
      SesionCaducaError,
    );
    expect(() => n.sesionVigente('<p>todo bien</p>')).not.toThrow();
  });
});

describe('NavegadorSii.form (regla de la postulación)', () => {
  it('toma el primer form, sin botones, image, disabled ni select, con trim', () => {
    const form = NavegadorSii.form(
      '<FORM ACTION="pe_confirma"><INPUT NAME="A" VALUE="  uno \t"><INPUT TYPE="Submit" NAME="S" VALUE="x">' +
        '<INPUT TYPE="image" NAME="I"><INPUT TYPE="BUTTON" NAME="B" VALUE="b"><INPUT TYPE="reset" NAME="R">' +
        '<INPUT NAME="D" VALUE="d" DISABLED><SELECT NAME="SEL"><OPTION VALUE="1" SELECTED></SELECT>' +
        '<INPUT TYPE="hidden" NAME="H" VALUE="h"></FORM><FORM ACTION="otro"><INPUT NAME="Z"></FORM>',
    );
    expect(form?.action).toBe('pe_confirma');
    expect([...(form?.inputs ?? [])]).toEqual([
      ['A', 'uno'],
      ['H', 'h'],
    ]);
  });

  it('checkbox y radio solo si vienen marcados (checked sin valor, o con cualquier valor)', () => {
    const form = formularioPostulacion(
      '<form action="a"><input type="checkbox" name="c1" value="S"><input type="CHECKBOX" name="c2" value="S" checked>' +
        '<input type="checkbox" name="c3" value="S" checked="false"><input type="radio" name="r" value="1">' +
        '<input type="radio" name="r" value="2" CHECKED></form>',
    );
    expect([...(form?.inputs ?? [])]).toEqual([
      ['c2', 'S'],
      ['c3', 'S'],
      ['r', '2'],
    ]);
  });

  it('sin name no cuenta; un nombre repetido conserva su lugar con el último valor', () => {
    const form = formularioPostulacion(
      '<form action="a"><input value="x"><input name="" value="y"><input name="n" value="1"><input name="m"><input name="n" value="2"></form>',
    );
    expect([...(form?.inputs ?? [])]).toEqual([
      ['n', '2'],
      ['m', ''],
    ]);
  });

  it('trim de PHP: no quita el espacio duro', () => {
    const nbsp = String.fromCharCode(0xa0);
    const form = formularioPostulacion(`<form><input name="n" value="&nbsp;x&nbsp; "></form>`);
    expect(form?.inputs.get('n')).toBe(`${nbsp}x${nbsp}`);
    expect(form?.action).toBe('');
  });

  it('devuelve null sin <form>', () => {
    expect(formularioPostulacion('<p><input name="a"></p>')).toBeNull();
  });
});

describe('NavegadorSii.texto', () => {
  it('quita scripts y estilos con su contenido, etiquetas y comentarios', () => {
    expect(
      NavegadorSii.texto(
        '<HEAD><SCRIPT>var x = "<b>no</b>";</SCRIPT><style>p{}</STYLE></HEAD><BODY><!-- c --><B>Hola</B>\n  mundo</BODY>',
      ),
    ).toBe('Hola mundo');
  });

  it('decodifica las entidades de HTML5 (no solo las de HTML 4.01)', () => {
    // &#12; (form feed) sí se decodifica en HTML5, y es un blanco: se colapsa y el trim lo quita.
    expect(textoPostulacion('&apos;a&apos; &colon; &NotEqualTilde; &AMP; &Amp; &#13; &#12;')).toBe(
      `'a' : ${String.fromCodePoint(0x2242, 0x338)} & &Amp; &#13;`,
    );
  });

  it('colapsa los blancos de \\s con /u (incluido &nbsp;) y aplica trim', () => {
    const raros = [0x85, 0xa0, 0x1680, 0x180e, 0x2003, 0x2028, 0x3000]
      .map((c) => String.fromCharCode(c))
      .join('');
    expect(textoPostulacion(`  ha&nbsp;sido${raros}aceptada\t\n`)).toBe('ha sido aceptada');
    const zwsp = String.fromCharCode(0x200b);
    expect(textoPostulacion(`a${zwsp}b`)).toBe(`a${zwsp}b`);
  });

  it('recorta por code points; Infinity no recorta', () => {
    const emoji = String.fromCodePoint(0x1f600);
    expect(textoPostulacion(`${emoji}${emoji}abc`, 3)).toBe(`${emoji}${emoji}a`);
    expect(textoPostulacion('x'.repeat(400))).toHaveLength(300);
    expect(textoPostulacion('x'.repeat(400), Number.POSITIVE_INFINITY)).toHaveLength(400);
    expect(textoPostulacion('abc', 0)).toBe('');
  });

  it('un surrogate suelto (UTF-8 inválido para PHP) deja el texto vacío, como el preg_replace del PHP', () => {
    expect(textoPostulacion(`a${String.fromCharCode(0xd800)}b`)).toBe('');
  });
});

describe('stripTagsPhp (strip_tags de PHP 8.3)', () => {
  it.each([
    ['a < b', 'a < b'],
    ['a <b> c', 'a  c'],
    ['<a title="x>y">t</a>', 't'],
    // El `<` dentro de la etiqueta anida: todo hasta el `>` que la cierra se pierde (PHP: ' fin').
    ['<p <b>x</b>> fin', ' fin'],
    ['a<!-- x > y -->b', 'ab'],
    ['a<!DOCTYPE html>b', 'ab'],
    ['a<?php echo "?>"; ?>b', 'ab'],
    ['fin <abierta', 'fin '],
    ['a > b', 'a > b'],
    [`a${String.fromCharCode(0)}b`, 'ab'],
  ])('%j → %j', (entrada, salida) => {
    expect(stripTagsPhp(entrada)).toBe(salida);
  });
});

describe('contieneSinMayusculas (mb_stripos)', () => {
  it('pliega mayúsculas Unicode simples, como el PHP', () => {
    expect(
      contieneSinMayusculas('EL CÓDIGO DE ESTE MENSAJE ES', 'El código de este mensaje es'),
    ).toBe(true);
    expect(contieneSinMayusculas('HA ſIDO ACEPTADA', 'ha sido aceptada')).toBe(true);
    expect(contieneSinMayusculas('Usted no tıene', 'Usted no tiene')).toBe(false);
    expect(contieneSinMayusculas('no esta autorizado', 'no está autorizado')).toBe(false);
  });
});

describe('NavegadorSii.resolverUrl', () => {
  it('es el resolverUrl compartido con folios', () => {
    expect(NavegadorSii.resolverUrl(`${MAULLIN}/`, 'pe_confirma')).toBe(`${MAULLIN}/pe_confirma`);
    expect(NavegadorSii.resolverUrl(`${MAULLIN}/`, '/cvc_cgi/dte/x')).toBe(`${MAULLIN}/x`);
  });
});
