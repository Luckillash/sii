// Arma los casos `http-postulacion-*`, `html-form-postulacion-*` y `texto-html-*`
// (paridad/casos/) desde las páginas de prueba de paridad/postulacion/paginas/.
//
//   node paridad/postulacion/armar-casos.mjs
//
// Los casos quedan versionados; este script solo evita escribir a mano el HTML en
// base64 dentro del JSON. Después de cambiar una página o un flujo: correrlo,
// `pnpm format` (Biome reformatea los JSON), `pnpm paridad:generar <casos>` y los
// tests.
//
// Las páginas son SINTÉTICAS, con el estilo del asistente legacy del SII (HTML 4
// en mayúsculas, formularios dentro de tablas, scripts): no contienen datos
// reales (RUT de prueba 76123456-0 y 11111111-1, correos de empresa-prueba.cl).
// Se envían en ISO-8859-1, como el SII. Algunas son plantillas con `{{CAMPO}}`:
// la confirmación repite los datos enviados, como hace el SII.
//
// Hosts: el login (herculesr.sii.cl) va al origen `https` del servidor de captura
// y maullin al origen `https2` (ver operaciones/postulacion.php).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagina = (nombre) =>
  readFileSync(join(raiz, 'postulacion', 'paginas', `${nombre}.html`), 'utf8');

/** Respuesta HTML en ISO-8859-1 (el texto no puede traer caracteres fuera de ISO-8859-1). */
function html(texto, extra = {}) {
  if ([...texto].some((c) => c.codePointAt(0) > 0xff)) {
    throw new Error('La página tiene caracteres fuera de ISO-8859-1');
  }
  return {
    status: extra.status ?? 200,
    cabeceras: [['Content-Type', 'text/html; charset=ISO-8859-1'], ...(extra.cabeceras ?? [])],
    cuerpo: { base64: Buffer.from(texto, 'latin1').toString('base64') },
  };
}

function redireccion(location, extra = {}) {
  return {
    status: extra.status ?? 302,
    cabeceras: [['Location', location], ...(extra.cabeceras ?? [])],
    cuerpo: '',
  };
}

/**
 * Escapa un valor para un atributo o texto HTML. `crudo`: lo que cabe en
 * ISO-8859-1 va tal cual (bytes ISO-8859-1 en la página); si no, todo lo que no
 * es ASCII va como `&#N;`.
 */
function escapar(valor, crudo = false) {
  return [...valor]
    .map((c) => {
      if (c === '&') return '&amp;';
      if (c === '"') return '&quot;';
      if (c === '<') return '&lt;';
      if (c === '>') return '&gt;';
      const codigo = c.codePointAt(0);
      if (codigo < 0x80 || (crudo && codigo <= 0xff)) return c;
      return `&#${codigo};`;
    })
    .join('');
}

const META = '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=iso-8859-1">';

const datosBase = {
  rutEmpresa: '76123456-0',
  rutAdministrador: '11111111-1',
  correoAdministrador: 'admin@empresa-prueba.cl',
  correoContactoSii: 'contacto@empresa-prueba.cl',
  correoIntercambio: 'dte@empresa-prueba.cl',
  nombreSoftware: 'Software de Prueba',
  boletaExenta: true,
  url: 'www.empresa-prueba.cl',
};

function datosEmpresa({
  meta = false,
  razonSocial = 'COMERCIAL DE PRUEBA LIMITADA',
  extra = '',
} = {}) {
  return html(
    pagina('datos-empresa')
      .replace('{{META}}', meta ? META : '')
      .replaceAll('{{RAZON_SOCIAL}}', escapar(razonSocial, true))
      .replace('{{EXTRA}}', extra),
  );
}

/**
 * Confirmación del SII: repite los datos enviados (salvo `cambios`). `bolexen`:
 * valor del hidden BOLEXEN, o null para no ponerlo.
 */
function confirma(
  datos,
  { cambios = {}, meta = false, crudo = false, action = 'pe_graba_postulacion', bolexen } = {},
) {
  const [rutEmp, dvEmp] = datos.rutEmpresa.split('-');
  const [rutUsu, dvUsu] = datos.rutAdministrador.split('-');
  const valores = {
    RUT_EMP: rutEmp,
    DV_EMP: dvEmp,
    RUT_USU: rutUsu,
    DV_USU: dvUsu,
    MAIL_SUP: datos.correoAdministrador,
    MAIL_SII: datos.correoContactoSii,
    MAIL_DTE: datos.correoIntercambio,
    URL: datos.url,
    NOM_SW: datos.nombreSoftware,
    ESBOL: 'S',
    BOLELEC: 'S',
    ESFAC: 'N',
    RAZON_SOCIAL: 'COMERCIAL DE PRUEBA LIMITADA',
    ...cambios,
  };
  const valorBolexen = bolexen === undefined ? (datos.boletaExenta ? 'S' : 'N') : bolexen;
  let texto = pagina('confirma')
    .replace('{{META}}', meta ? META : '')
    .replace('{{ACTION}}', action)
    .replace(
      '{{BOLEXEN}}',
      valorBolexen === null
        ? ''
        : `<INPUT TYPE="hidden" NAME="BOLEXEN" VALUE="${escapar(valorBolexen)}">\n`,
    );
  for (const [campo, valor] of Object.entries(valores)) {
    texto = texto.replaceAll(`{{${campo}}}`, escapar(valor, crudo));
  }
  return html(texto);
}

const loginOk = html(readFileSync(join(raiz, 'folios', 'paginas', 'login-ok.html'), 'utf8'));
const peIngrut = html(pagina('pe-ingrut'), {
  cabeceras: [['Set-Cookie', 'JSESSIONID=MAULLINPE01; Path=/cvc_cgi; Secure']],
});
const avisoFacturador = html(pagina('aviso-facturador'));
const avisoDocumentos = html(pagina('aviso-documentos'));
const aceptada = html(pagina('aceptada'));

/** Sesión ya autenticada (como la guardaría quien llama). */
const sesion = [
  { name: 'TOKEN', value: 'TOKENDEPRUEBAAUT2000', domain: 'sii.cl', host_only: false },
  { name: 'NETSCAPE_LIVEWIRE.rut', value: '11111111', domain: 'sii.cl', host_only: false },
  { name: 'MAULLINSOLO', value: 'M1', domain: 'maullin.sii.cl', host_only: true },
  { name: 's_aut', value: 'HOSTONLY01', domain: 'herculesr.sii.cl', host_only: true },
];

/** Flujo sin avisos desde el paso 1 hasta la página final. */
const flujo = (
  datos,
  { datosPagina = datosEmpresa(), confirmacion = confirma(datos), final = aceptada } = {},
) => [peIngrut, datosPagina, confirmacion, final];

const postular = (datos, http, extra = {}) => ({
  accion: 'postular',
  sesion,
  datos,
  ...extra,
  http: { respuestas: http },
});
const conError = (datos, http) => postular(datos, http, { esperaError: true });

const sinExenta = { ...datosBase, boletaExenta: false };
const conTildes = {
  ...datosBase,
  nombreSoftware: 'Señal & Cía €',
  url: 'www.ñandú.cl/?a=1&b=2',
};

const casosHttp = {
  'http-postulacion-completo': {
    descripcion:
      'autenticar() (PEM con cadena) y postular() sin avisos: redirección relativa en el paso 1, el formulario de datos con la regla de form() (sin select, botones ni disabled; checkbox/radio marcados; trim), ESFAC/FACT/SET*/BOLEXEN filtrados, y la confirmación con MAIL_SUP en mayúsculas (strcasecmp)',
    entrada: {
      accion: 'completo',
      archivo: 'cert-cadena.pem',
      datos: datosBase,
      http: {
        respuestas: [
          loginOk,
          redireccion('pe_ingrut?paso=2', {
            cabeceras: [['Set-Cookie', 'JSESSIONID=MAULLINPE00; Path=/cvc_cgi; Secure']],
          }),
          ...flujo(datosBase, {
            confirmacion: confirma(datosBase, {
              cambios: { MAIL_SUP: datosBase.correoAdministrador.toUpperCase() },
            }),
          }),
        ],
      },
    },
  },
  'http-postulacion-avisos': {
    descripcion:
      'postular(): dos páginas de aviso ("Sr. Contribuyente:") pasadas con Continuar; la segunda con action absoluto y &nbsp; en el texto',
    entrada: postular(datosBase, [
      peIngrut,
      avisoFacturador,
      avisoDocumentos,
      datosEmpresa(),
      confirma(datosBase),
      aceptada,
    ]),
  },
  'http-postulacion-avisos-demasiados': {
    descripcion:
      'postular(): cuatro páginas de aviso seguidas: se pasan tres con Continuar y se detiene en la cuarta',
    entrada: conError(datosBase, [
      peIngrut,
      avisoFacturador,
      avisoDocumentos,
      avisoFacturador,
      avisoDocumentos,
    ]),
  },
  'http-postulacion-sin-exenta': {
    descripcion:
      'postular() sin boleta exenta: no se envía BOLEXEN y la confirmación trae BOLEXEN=N',
    entrada: postular(sinExenta, flujo(sinExenta)),
  },
  'http-postulacion-confirma-bolexen': {
    descripcion:
      'postular() sin boleta exenta, pero la confirmación trae BOLEXEN=S: se detiene sin grabar',
    entrada: conError(sinExenta, [peIngrut, datosEmpresa(), confirma(sinExenta, { bolexen: 'S' })]),
  },
  'http-postulacion-confirma-distinta': {
    descripcion:
      'postular(): la confirmación trae otro MAIL_DTE: se detiene SIN el POST a pe_graba_postulacion',
    entrada: conError(datosBase, [
      peIngrut,
      datosEmpresa(),
      confirma(datosBase, { cambios: { MAIL_DTE: "otro'correo@empresa-prueba.cl" } }),
    ]),
  },
  'http-postulacion-tildes': {
    descripcion:
      'postular() con tildes, & y € en el nombre del software y la URL: se envían en ISO-8859-1 (€ → ?), y la confirmación los repite como entidades',
    entrada: postular(conTildes, flujo(conTildes)),
  },
  'http-postulacion-meta-charset': {
    descripcion:
      'postular(): el formulario de datos declara charset=iso-8859-1 en un <meta> y trae un hidden con Ñ: se reenvía doblemente codificado (defecto del PHP, replicado por paridad)',
    entrada: postular(
      datosBase,
      flujo(datosBase, {
        datosPagina: datosEmpresa({ meta: true, razonSocial: 'COMERCIAL ÑUÑOA LIMITADA' }),
      }),
    ),
  },
  'http-postulacion-meta-charset-confirma': {
    descripcion:
      'postular() con Ñ en el nombre del software y una confirmación con <meta charset=iso-8859-1> que lo repite tal cual: el PHP lo lee doblemente codificado, no calza y se detiene sin grabar (Node igual)',
    entrada: conError({ ...datosBase, nombreSoftware: 'Señal Ñuñoa' }, [
      peIngrut,
      datosEmpresa(),
      confirma({ ...datosBase, nombreSoftware: 'Señal Ñuñoa' }, { meta: true, crudo: true }),
    ]),
  },
  'http-postulacion-rechazo': {
    descripcion:
      'postular(): el SII rechaza el RUT ("NO ES REPRESENTANTE", "EL C&Oacute;DIGO DE ESTE MENSAJE ES"): marcadores con mb_stripos sobre el texto decodificado',
    entrada: conError(datosBase, [peIngrut, html(pagina('rechazo'))]),
  },
  'http-postulacion-sesion-caducada': {
    descripcion:
      'postular(): el POST a pe_confirma redirige al login: SesionCaduca sin seguir la redirección',
    entrada: conError(datosBase, [
      peIngrut,
      datosEmpresa(),
      redireccion(
        'https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoCertificado.html?https://maullin.sii.cl/cvc_cgi/dte/pe_ingrut',
      ),
    ]),
  },
  'http-postulacion-sesion-caducada-pagina': {
    descripcion: 'postular(): el paso 1 devuelve una página que manda al login: SesionCaduca',
    entrada: conError(datosBase, [html(pagina('login-caducado'))]),
  },
  'http-postulacion-fuera-de-host': {
    descripcion:
      'postular(): el POST del RUT redirige a palena: se detiene sin seguir la redirección',
    entrada: conError(datosBase, [
      peIngrut,
      redireccion('https://palena.sii.cl/cvc_cgi/dte/pe_datos_empresa'),
    ]),
  },
  'http-postulacion-action-fuera': {
    descripcion:
      'postular(): la confirmación apunta a otro host: se detiene ANTES del POST que graba',
    entrada: conError(datosBase, [
      peIngrut,
      datosEmpresa(),
      confirma(datosBase, { action: 'https://www4.sii.cl/cvc_cgi/dte/pe_graba_postulacion' }),
    ]),
  },
  'http-postulacion-sin-aceptada': {
    descripcion: 'postular(): la página final no dice "ha sido aceptada": error después de grabar',
    entrada: conError(datosBase, flujo(datosBase, { final: html(pagina('sin-aceptada')) })),
  },
  'http-postulacion-graba-500': {
    descripcion:
      'postular(): el POST que graba responde HTTP 500: error de postulación (el PHP no encuentra "ha sido aceptada"; Node, por el código HTTP)',
    entrada: conError(
      datosBase,
      flujo(datosBase, { final: html('<HTML><BODY>Error interno</BODY></HTML>', { status: 500 }) }),
    ),
  },
  'http-postulacion-graba-307': {
    descripcion:
      'postular(): el POST que graba recibe un 307: se repite el POST con el mismo cuerpo',
    entrada: postular(datosBase, [
      ...flujo(datosBase).slice(0, 3),
      redireccion('pe_graba_postulacion?r=1', { status: 307 }),
      aceptada,
    ]),
  },
  'http-postulacion-nombres-numericos': {
    descripcion:
      'postular(): el formulario de datos trae campos con nombre numérico ("7", "-3", "07"): array_merge renumera las claves enteras desde 0',
    entrada: postular(
      datosBase,
      flujo(datosBase, {
        datosPagina: datosEmpresa({
          extra:
            '<INPUT TYPE="hidden" NAME="7" VALUE="siete"><INPUT TYPE="hidden" NAME="07" VALUE="cero siete"><INPUT TYPE="hidden" NAME="-3" VALUE="menos tres">\n',
        }),
      }),
    ),
  },
};

// --- form() de la postulación (NavegadorSii::form) -----------------------------------

const casosForm = {
  'html-form-postulacion-reglas': {
    descripcion:
      'NavegadorSii::form(): tipos (mayúsculas, sin type), checked/disabled sin valor, botones, image, select y textarea ignorados, trim (no quita &nbsp;), nombres repetidos y numéricos, sin form',
    entrada: {
      paginas: [
        pagina('datos-empresa')
          .replace('{{META}}', '')
          .replaceAll('{{RAZON_SOCIAL}}', 'X')
          .replace('{{EXTRA}}', ''),
        '<form action="a"><input name="t1" value=" uno "><input type="TEXT" name="t2" value="\tdos\n"><input type="Checkbox" name="c1" value="S" checked="false"><input type="checkbox" name="c2" value="S"><input type="RADIO" name="r" value="1"><input type="radio" name="r" value="2" checked></form>',
        '<form action="b"><input type="SUBMIT" name="s" value="x"><input type="Image" name="i" value="y"><input type="button" name="b" value="z"><input type="reset" name="re" value="w"><button name="bt" value="v">B</button><input type="hidden" name="h" value="&nbsp;h&nbsp;"><input name="d" value="d" disabled><input name="" value="sin nombre"><input value="sin name"></form>',
        '<form action="c"><select name="sel"><option value="1" selected>1</option></select><textarea name="ta">texto</textarea><input name="dup" value="1"><input name="otro" value="2"><input name="dup" value="3"><input name="5" value="cinco"><input name="05" value="cero cinco"></form>',
        '<p>sin formulario</p><input name="suelto" value="1">',
        '<table><tr><td><form action="d" method="post"><input type="hidden" name="A" value="1"></td></tr><tr><td><input type="hidden" name="B" value="2"></form></td></tr></table><form action="e"><input name="C"></form>',
      ],
    },
  },
  'html-form-postulacion-codificacion': {
    descripcion:
      'NavegadorSii::form() con <meta charset=iso-8859-1>: los valores con tildes salen doblemente codificados (como en html-form-codificacion de folios); las entidades no',
    entrada: {
      paginas: [
        `<html><head>${META}</head><body><form action="pe_confirma"><input type="hidden" name="RAZON" value="ÑUÑOA"><input type="hidden" name="ENT" value="&Ntilde;U&Ntilde;OA"><input type="hidden" name="NOMBRE_Ñ" value="á"></form></body></html>`,
        '<html><body><form action="pe_confirma"><input type="hidden" name="RAZON" value="ÑUÑOA"><input type="hidden" name="ENT" value="&Ntilde;U&Ntilde;OA"></form></body></html>',
      ],
    },
  },
};

// --- texto() de la postulación (NavegadorSii::texto, mb_stripos, aviso) ----------------

const casosTexto = {
  'texto-html-strip-tags': {
    descripcion:
      'NavegadorSii::texto() y strip_tags(): "<" + blanco, comillas dentro de etiquetas, "<" anidado, comentarios, <!DOCTYPE>, <? ?>, <?xml, etiqueta sin cerrar, ">" suelto, script/style con y sin cierre',
    entrada: {
      max: 20,
      textos: [
        'a < b y c > d',
        '<a href="x>y">enlace</a> <b title=\'1>2\'>negrita</b>',
        '<p <b>anidado</b>> fin',
        'antes<!-- comentario > con > --> despues <!-- sin cerrar',
        '<!DOCTYPE html PUBLIC "-//W3C//DTD HTML 4.01//EN">texto <!x> y <!-- a --b> c -->d',
        '<?php echo "?>"; if (a(b)) { ?> codigo ?> fin',
        'x<?xml version="1.0"?><raiz>contenido</raiz> <?xml al comienzo ?>',
        'texto <sin cerrar',
        'uno<script type="text/javascript">alert("<b>hola</b>")</script>dos<STYLE>p{}</style>tres<script>sin cierre',
        '<SCRIPT>a</Script >b</sCrIpT>c',
        `\u0000nul<\u0000b>x`,
        '<a\n href="1">salto</a><br/>linea',
      ],
    },
  },
  'texto-html-entidades': {
    descripcion:
      'NavegadorSii::texto(): entidades de HTML5 (apos, NewLine, Tab, colon, NotEqualTilde, AMP, nombres sin ";"), numéricas permitidas y no (&#12; &#13; &#xFFFE; &#x0x41;), blancos Unicode de \\s con /u (nbsp, U+2003, U+0085, U+180E; no U+200B), y los marcadores con mayúsculas, tildes como entidades, ſ e ı',
    entrada: {
      textos: [
        '&apos;uno&apos; &quot;dos&quot; &NewLine;tres&Tab;cuatro &colon; &NotEqualTilde; &AMP; &Amp; &amp &lt;b&gt; &amp;lt;',
        '&#12;ff &#13;cr &#xFFFE; &#x0x41; &#65 &#0; &#128; &#x1F600; &#xD800; &#1114112;',
        'a&nbsp;b\u00a0c\u2003d\u0085e\u180ef\u200bg\u3000h \t\n i',
        'La postulaci&oacute;n HA&nbsp;SIDO ACEPTADA',
        'El c&Oacute;digo de este mensaje es 1 / USTED NO TIENE permisos / no est&aacute; AUTORIZADO',
        'ha ſido aceptada / Usted no tıene / No ha sido posible completar su solicitud',
        'No es&#32;representante &mdash; &hellip; &euro; &ntilde;',
      ],
    },
  },
  'texto-html-avisos': {
    descripcion:
      'PostulacionSii::aviso(): texto desde "Sr. Contribuyente:" hasta Continuar/Salir o el final, recorte a 2000 y a 400 si no hay aviso; el texto que va en el mensaje (300) y el recortado a 30',
    entrada: {
      max: 30,
      textos: [
        pagina('aviso-facturador'),
        pagina('aviso-documentos'),
        '<p>Sr. Contribuyente:   sin botones al final</p>',
        '<p>Sr. Contribuyente: hay que Salir ahora, o Continuar</p>',
        '<p>Sr. Contribuyente:Continuar</p><p>x</p>',
        `<p>${'relleno '.repeat(300)}</p><p>Sr. Contribuyente: despues de 2000</p>`,
        `<p>${'sin aviso '.repeat(60)}</p>`,
        `<script>var t = "Sr. Contribuyente: en script";</script><p>${'ñ'.repeat(450)}</p>`,
      ],
    },
  },
};

const escribir = (casos, operacion) => {
  for (const [nombre, caso] of Object.entries(casos)) {
    const json = { descripcion: caso.descripcion, operacion, entrada: caso.entrada };
    writeFileSync(join(raiz, 'casos', `${nombre}.json`), `${JSON.stringify(json, null, 2)}\n`);
  }
};
escribir(casosHttp, 'httpPostulacion');
escribir(casosForm, 'formPostulacion');
escribir(casosTexto, 'textoPostulacion');
const total =
  Object.keys(casosHttp).length + Object.keys(casosForm).length + Object.keys(casosTexto).length;
console.log(`${total} casos de la postulación escritos en paridad/casos/.`);
console.log(
  [...Object.keys(casosHttp), ...Object.keys(casosForm), ...Object.keys(casosTexto)].join(' '),
);
