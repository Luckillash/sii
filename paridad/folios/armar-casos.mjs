// Arma los casos `http-folios-*` (paridad/casos/) desde las páginas de prueba de
// paridad/folios/paginas/ y el CAF de prueba de paridad/material/.
//
//   node paridad/folios/armar-casos.mjs
//
// Los casos quedan versionados; este script solo evita escribir a mano el HTML
// en base64 dentro del JSON. Después de cambiar una página o un flujo: correrlo,
// `pnpm format` (Biome reformatea los JSON),
// `pnpm paridad:generar http-folios-...` y los tests.
//
// Las páginas son SINTÉTICAS, con el estilo del asistente legacy del SII (HTML
// 4 en mayúsculas, formularios dentro de tablas, scripts): no contienen datos
// reales. Se envían en ISO-8859-1, como el SII.
//
// Hosts: el login (herculesr.sii.cl) va al origen `https` del servidor de captura
// y el asistente (maullin.sii.cl) al origen `https2` (ver operaciones/folios.php).

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagina = (nombre) => readFileSync(join(raiz, 'folios', 'paginas', `${nombre}.html`), 'utf8');

/** Respuesta HTML en ISO-8859-1. */
function html(texto, extra = {}) {
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

const cafBase = readFileSync(join(raiz, 'material', 'caf-39.xml'));
function caf(bytes = cafBase) {
  return {
    cabeceras: [
      ['Content-Type', 'application/octet-stream'],
      ['Content-Disposition', 'attachment; filename=FoliosSII7612345639101202611061015.xml'],
    ],
    cuerpo: { base64: bytes.toString('base64') },
  };
}

const MAULLIN = 'https://maullin.sii.cl';
const REFERENCIA = `${MAULLIN}/cvc_cgi/dte/of_solicita_folios`;

// --- respuestas reutilizables ---------------------------------------------------

const loginRedireccion = redireccion(`/cgi_AUT2000/CAutValida.cgi?${REFERENCIA}`, {
  cabeceras: [
    ['Set-Cookie', 's_aut=HOSTONLY01; path=/'],
    ['Set-Cookie', 'NETSCAPE_LIVEWIRE.exp=EXPDEPRUEBA; Domain=.sii.cl; Path=/'],
    ['Set-Cookie', 'VIEJA=borrar; Domain=.sii.cl; expires=Thu, 01 Jan 1970 00:00:00 GMT'],
    ['Set-Cookie', 'AJENA=no; Domain=.example.com; Path=/'],
  ],
});
const loginOk = html(pagina('login-ok'), {
  cabeceras: [['Set-Cookie', 'NETSCAPE_LIVEWIRE.exp=EXPRENOVADA; Domain=sii.cl; Path=/']],
});
const paso1 = html(pagina('paso1-rut'), {
  cabeceras: [['Set-Cookie', 'JSESSIONID=MAULLIN0001; Path=/cvc_cgi; Secure']],
});
const paso2Tipo = html(pagina('paso2-tipo'), {
  cabeceras: [['Set-Cookie', 'JSESSIONID=MAULLIN0002; Path=/cvc_cgi; Secure']],
});
const paso2Cantidad = html(pagina('paso2-cantidad'));
const paso3 = html(pagina('paso3-confirma'));
const paso4 = html(pagina('paso4-genera'));
const errorNoAutorizado = html(pagina('error-no-autorizado'));

/** Sesión ya autenticada (como la guardaría quien llama). */
const sesion = [
  { name: 'TOKEN', value: 'TOKENDEPRUEBAAUT2000', domain: 'sii.cl', host_only: false },
  { name: 'NETSCAPE_LIVEWIRE.rut', value: '11111111', domain: 'sii.cl', host_only: false },
  { name: 'MAULLINSOLO', value: 'M1', domain: 'maullin.sii.cl', host_only: true },
  { name: 's_aut', value: 'HOSTONLY01', domain: 'herculesr.sii.cl', host_only: true },
];

const solicitud = { rutEmpresa: '76123456-0', tipoDte: 39, cantidad: 5 };
const normalizar = { camposFormulario: ['FECHA'] };

/** Pasos del asistente desde la página 1 hasta el CAF. */
const asistenteCompleto = [paso1, paso2Tipo, paso2Cantidad, paso3, paso4, caf()];

const casos = {
  'http-folios-autenticar': {
    descripcion:
      'autenticar(): POST a CAutInicio.cgi con TLS mutuo (PEM con cadena), 302 con Set-Cookie (host-only, Domain, borrado y dominio ajeno) y página con document.cookie',
    entrada: {
      accion: 'autenticar',
      archivo: 'cert-cadena.pem',
      http: { respuestas: [loginRedireccion, loginOk] },
    },
  },
  'http-folios-autenticar-rechazado': {
    descripcion: 'autenticar(): el SII no entrega TOKEN (certificado rechazado): los dos lanzan',
    entrada: {
      accion: 'autenticar',
      archivo: 'cert-titular.pem',
      esperaError: true,
      http: { respuestas: [html(pagina('login-rechazado'))] },
    },
  },
  'http-folios-autenticar-fuera-de-sii': {
    descripcion:
      'autenticar(): el login redirige fuera de sii.cl: se detiene sin seguir la redirección',
    entrada: {
      accion: 'autenticar',
      archivo: 'cert-titular.pem',
      esperaError: true,
      http: { respuestas: [redireccion('https://sii.cl.example.com/robar')] },
    },
  },
  'http-folios-solicitar': {
    descripcion:
      'solicitar() con una sesión guardada: redirección absoluta en el paso 1, recarga de of_solicita_folios_dcto, confirmación con tildes (ISO-8859-1), timbraje y descarga del CAF',
    entrada: {
      accion: 'solicitar',
      sesion,
      ...solicitud,
      http: {
        respuestas: [
          redireccion(`${REFERENCIA}?inicio=1`, {
            cabeceras: [['Set-Cookie', 'JSESSIONID=MAULLIN0000; Path=/cvc_cgi; Secure']],
          }),
          ...asistenteCompleto,
        ],
        normalizar,
      },
    },
  },
  'http-folios-completo': {
    descripcion:
      'autenticar() con un .pfx legacy con cadena y solicitar() con esa sesión: las cookies del login (Set-Cookie y document.cookie) llegan al asistente',
    entrada: {
      accion: 'completo',
      archivo: 'cert-legacy-cadena.pfx',
      clave: 'clave-de-prueba',
      ...solicitud,
      http: { respuestas: [loginRedireccion, loginOk, ...asistenteCompleto], normalizar },
    },
  },
  'http-folios-307': {
    descripcion: 'solicitar(): un 307 tras el POST del paso 2 repite el POST con el mismo cuerpo',
    entrada: {
      accion: 'solicitar',
      sesion,
      ...solicitud,
      http: {
        respuestas: [
          paso1,
          redireccion('of_solicita_folios_dcto2', { status: 307 }),
          paso2Cantidad,
          paso3,
          paso4,
          caf(),
        ],
        normalizar,
      },
    },
  },
  'http-folios-sesion-caducada': {
    descripcion:
      'solicitar(): el paso 1 redirige al login: SesionCaduca sin seguir la redirección (reintentar no gasta folios)',
    entrada: {
      accion: 'solicitar',
      sesion,
      ...solicitud,
      esperaError: true,
      http: {
        respuestas: [
          redireccion(
            `https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoCertificado.html?${REFERENCIA}`,
          ),
        ],
      },
    },
  },
  'http-folios-sesion-caducada-pagina': {
    descripcion: 'solicitar(): el paso 1 devuelve una página que manda al login: SesionCaduca',
    entrada: {
      accion: 'solicitar',
      sesion,
      ...solicitud,
      esperaError: true,
      http: { respuestas: [html(pagina('login-caducado'))] },
    },
  },
  'http-folios-no-autorizado': {
    descripcion:
      'solicitar(): el SII rechaza en el paso 2 ("no está autorizado"): error antes de timbrar',
    entrada: {
      accion: 'solicitar',
      sesion,
      ...solicitud,
      esperaError: true,
      http: { respuestas: [paso1, errorNoAutorizado] },
    },
  },
  'http-folios-action-fuera': {
    descripcion:
      'solicitar(): la confirmación apunta a palena (otro ambiente): se detiene ANTES del POST que timbra',
    entrada: {
      accion: 'solicitar',
      sesion,
      ...solicitud,
      esperaError: true,
      http: {
        respuestas: [
          paso1,
          paso2Cantidad,
          html(
            pagina('paso3-confirma').replace(
              'ACTION="of_genera_folio"',
              'ACTION="https://palena.sii.cl/cvc_cgi/dte/of_genera_folio"',
            ),
          ),
        ],
      },
    },
  },
  'http-folios-sin-nomusu': {
    descripcion: 'solicitar(): la confirmación no trae NOMUSU: error antes de timbrar',
    entrada: {
      accion: 'solicitar',
      sesion,
      ...solicitud,
      esperaError: true,
      http: {
        respuestas: [
          paso1,
          paso2Cantidad,
          html(pagina('paso3-confirma').replace(/<INPUT TYPE="hidden" NAME="NOMUSU"[^>]*>\n/, '')),
        ],
      },
    },
  },
  'http-folios-sin-caf': {
    descripcion:
      'solicitar(): se timbró pero la descarga devuelve HTML en vez del CAF: FoliosSinCaf con el rango 101-105',
    entrada: {
      accion: 'solicitar',
      sesion,
      ...solicitud,
      esperaError: true,
      http: {
        respuestas: [
          paso1,
          paso2Cantidad,
          paso3,
          paso4,
          html('<HTML><BODY>No fue posible generar el archivo.</BODY></HTML>'),
        ],
        normalizar,
      },
    },
  },
  'http-folios-genera-500': {
    descripcion:
      'solicitar(): el POST que timbra responde HTTP 500: FoliosSinCaf (el PHP falla al buscar el formulario; Node, por el código HTTP)',
    entrada: {
      accion: 'solicitar',
      sesion,
      ...solicitud,
      esperaError: true,
      http: {
        respuestas: [
          paso1,
          paso2Cantidad,
          paso3,
          html('<HTML><BODY>Error interno</BODY></HTML>', { status: 500 }),
        ],
      },
    },
  },
  'http-folios-caf-otro-ambiente': {
    descripcion:
      'solicitar(): el CAF descargado trae IDK 300 (producción) pedido en certificación. Divergencia a propósito (pend. 1.2): el PHP lanza un error común y Node FoliosSinCaf; las peticiones son iguales',
    entrada: {
      accion: 'solicitar',
      sesion,
      ...solicitud,
      esperaError: true,
      http: {
        respuestas: [
          paso1,
          paso2Cantidad,
          paso3,
          paso4,
          caf(
            Buffer.from(
              cafBase.toString('latin1').replace('<IDK>100</IDK>', '<IDK>300</IDK>'),
              'latin1',
            ),
          ),
        ],
        normalizar,
      },
    },
  },
  'http-folios-redirecciones': {
    descripcion:
      'solicitar(): el paso 1 redirige sin fin: se detiene después de 10 redirecciones (11 peticiones)',
    entrada: {
      accion: 'solicitar',
      sesion,
      ...solicitud,
      esperaError: true,
      http: {
        respuestas: Array.from({ length: 11 }, (_, i) =>
          redireccion(`of_solicita_folios?vuelta=${i + 1}`),
        ),
      },
    },
  },
};

for (const [nombre, caso] of Object.entries(casos)) {
  const json = { descripcion: caso.descripcion, operacion: 'httpFolios', entrada: caso.entrada };
  writeFileSync(join(raiz, 'casos', `${nombre}.json`), `${JSON.stringify(json, null, 2)}\n`);
}
console.log(`${Object.keys(casos).length} casos http-folios-* escritos en paridad/casos/.`);
