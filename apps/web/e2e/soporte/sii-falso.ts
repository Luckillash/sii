// SII falso para la e2e del flujo crítico (PLAN-SAAS Fase 13, punto 2). Es un servidor
// HTTP en 127.0.0.1 que recibe, desde el `next dev` de la prueba, cada petición que la
// app haría al SII (ver `src/server/sii/sii-falso.ts`, activado con
// `E2E_SII_FALSO_URL`) y responde como el SII de CERTIFICACIÓN:
//
//   - login AUT2000 con certificado (herculesr) → página de ingreso con sus cookies;
//   - postulación (maullin, `cvc_cgi/dte/pe_*`) → repite los datos y la acepta;
//   - portal GWT de la declaración (www4) → versión vigente, estado, set de pruebas,
//     revisión (pasa a P90) y declaración (pasa a P91);
//   - solicitud de folios (maullin, `of_*`) → un CAF de MENTIRA (IDK 100) generado aquí;
//   - API REST de boletas (apicert / pangal) → semilla, token, Track ID y estado EPR.
//
// Cualquier host de PRODUCCIÓN (palena, api.sii.cl, rahue, www2…) y cualquier ruta que no
// conozca responden error y quedan registrados: la prueba exige que no haya ninguno.
// Nada de esto sale a la red. Las páginas salen de las sintéticas de la paridad de la
// librería (`packages/certificacion/paridad`) y las respuestas GWT son las de los tests
// de la CLI (`apps/cli/test/certificacion/portal/sii-falso.ts`).

import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PARIDAD = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/certificacion/paridad',
);
const leer = (ruta: string): string => readFileSync(join(PARIDAD, ruta), 'utf8');
const latin1 = (s: string): Buffer => Buffer.from(s, 'latin1');

/** Lo que manda `src/server/sii/sii-falso.ts` por cada petición. */
interface Peticion {
  metodo: string;
  url: string;
  cabeceras: Record<string, string>;
  cuerpo: string;
  tls: boolean;
  conexionNueva: boolean;
}

interface Respuesta {
  status: number;
  cabeceras?: Record<string, string | string[]>;
  cuerpo?: Buffer | string;
}

/** Una petición atendida, resumida (sin cuerpos: pueden traer XML firmados). */
export interface Registro {
  metodo: string;
  host: string;
  ruta: string;
  /** Método GWT, en el facade de la declaración. */
  gwt?: string;
  tls: boolean;
  status: number;
}

// --- Respuestas GWT (las de los tests de la CLI) ----------------------------------------

const F = {
  estado: 'cl.sii.sdi.diii.certBolElectDte.to.EstadoAutorizaTo/1011533792',
  postulacion: 'cl.sii.sdi.diii.certBolElectDte.to.PostulSegHistInsUpdTo/138688689',
  empresaAutorizada: 'cl.sii.sdi.diii.certBolElectDte.to.TdtEmpresaAutorizadaTo/2240026086',
  documento: 'cl.sii.sdi.diii.certBolElectDte.to.DocumentoAutorizadoTo/493967287',
};
const POLICY = '082D0AC4BC4D75A5DF38F116C53877D4';
const SERVICIO = 'cl.sii.sdi.diii.certBolElectDte.web.client.service.Facade';
const INTEGER = 'java.lang.Integer/3438268394';
const ARRAY_LIST = 'java.util.ArrayList/4159755760';

/** `//OK[...]` con los tokens en el orden en que se leen. */
function ok(lectura: readonly (number | string)[], tabla: readonly string[] = []): string {
  return `//OK[${[...[...lectura].reverse(), JSON.stringify(tabla)].join(',')},0,7]`;
}
const estadoGwt = (codigo: string, paso: string | null, glosa: string): string =>
  paso === null
    ? ok([1, 2, 0, 3], [F.estado, codigo, glosa])
    : ok([1, 2, 3, 4], [F.estado, codigo, paso, glosa]);

/** Las respuestas con el RUT de la empresa fijo (76.123.456-0) son las de la CLI. */
export const RUT_EMPRESA = '76123456-0';
export const RUT_TITULAR = '11111111-1';

const GWT = {
  P80: estadoGwt('P80', '80', 'EN REVISION DEL SET'),
  P90: estadoGwt('P90', '90', 'PENDIENTE DECLARACION DE CUMPLIMIENTO'),
  P91: estadoGwt('P91', null, `DECLARACION EFECTUADA ${RUT_TITULAR}`),
  NULO: ok([0]),
  NOMBRE: ok([1], ['EMPRESA E2E SPA']),
  DOCUMENTOS: `//OK[15,'EAAAAA',4,18,13,0,'F',4,76123456,3,12,17,10,9,8,0,7,16,5,-4,41,3,2,15,'gAAAAAAAB',4,14,13,0,'F',4,76123456,3,12,11,10,9,8,0,7,6,5,'ZlFhXwA',4,39,3,2,2,1,["${ARRAY_LIST}","${F.documento}","${INTEGER}","java.lang.Long/4227064769","BVE","BOLETA ELECTRONICA","S","01-09-2026","AUTORIZADO","","39","N","java.lang.String/2004016611","Boleta afecta","FIN","BOLETA EXENTA ELECTRONICA","41","Boleta exenta"],0,7]`,
  AUTORIZAR_P91: `//OK[19,0,-4,0,'A',18,17,0,0,16,0,10,10,15,22222222,4,11111111,4,76123456,4,14,13,12,11,10,10,10,9,8,7,5,3,0,6,0,5,0,0,0,0,90,4,3,0,2,1,["${F.postulacion}","P91","BVE","${INTEGER}","0","${F.empresaAutorizada}","1","2","SII","07-11-2026","contacto@proveedor-prueba.cl","Proveedor de Prueba SpA","19","S","https://proveedor-prueba.cl/consulta","${ARRAY_LIST}","EMPRESA E2E SPA","java.lang.Long/4227064769","DECLARACION EFECTUADA"],0,7]`,
  texto: (s: string): string => ok([1], [s]),
  entero: (n: number): string => ok([1, n], [INTEGER]),
} as const;

/** El `.cache.html` del portal con todo lo que `verificarPortal` busca. */
const PORTAL_VIGENTE = [
  POLICY,
  SERVICIO,
  F.estado,
  F.postulacion,
  F.empresaAutorizada,
  F.documento,
  'DownloadFileServlet',
  ...[
    'obtenerEstadoAutorizaEmp',
    'recuperarNombreContribuyente',
    'listarDocAutorizados',
    'autorizarEmpresaBolProd',
    'recuperarNroActividadesVigAfecIva',
    'ingresarTrackId',
    'obtenerPostulacionSeg',
  ].map((m) => `'${m}'`),
].join(';');

/** Set de pruebas de boleta (tipo 39) con dos casos, en ISO-8859-1 como el SII. */
export const SET_PRUEBAS = latin1(
  [
    'SET DE PRUEBA BOLETA ELECTRÓNICA',
    '',
    'CASO-1',
    '==============',
    'Item                    Cantidad    Precio Unitario',
    'Cambio de aceite        1           19900',
    'Alineación y balanceo   1           9900',
    '',
    'CASO-2',
    '==============',
    'Item                    Cantidad    Precio Unitario',
    'Papel de regalo         17          120',
    '',
  ].join('\r\n'),
);
export const CASOS_SET = 2;

// --- Páginas ---------------------------------------------------------------------------

/** Login AUT2000 aceptado, con las cookies RUT_NS / DV_NS que usa el portal www4. */
const LOGIN_OK = leer('folios/paginas/login-ok.html').replace(
  'function sigue()',
  'document.cookie = "RUT_NS=11111111; path=/; domain=.sii.cl";\n' +
    'document.cookie = "DV_NS=1; path=/; domain=.sii.cl";\nfunction sigue()',
);
const POSTULACION = (nombre: string): string => leer(`postulacion/paginas/${nombre}.html`);

function escapar(s: string): string {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
}

function campos(p: Peticion): URLSearchParams {
  return new URLSearchParams(Buffer.from(p.cuerpo, 'base64').toString('latin1'));
}

function partirRut(rut: string): { numero: string; dv: string } {
  const [numero = '', dv = ''] = rut.split('-');
  return { numero, dv };
}

function hoyChile(): { fecha: string; dia: string; mes: string; ano: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Santiago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const [ano = '', mes = '', dia = ''] = partes.split('-');
  return { fecha: partes, dia, mes, ano };
}

// --- CAF de MENTIRA (como test/caf-prueba.ts) -------------------------------------------

let llaveCaf: { privada: string; publica: ReturnType<typeof generateKeyPairSync>['publicKey'] };
function cafPrueba(rut: string, tipo: number, desde: number, hasta: number): string {
  if (!llaveCaf) {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 512,
      publicExponent: 3,
    });
    llaveCaf = {
      privada: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(),
      publica: publicKey,
    };
  }
  const jwk = llaveCaf.publica.export({ format: 'jwk' });
  const b64 = (v: string | undefined) => Buffer.from(v ?? '', 'base64url').toString('base64');
  return (
    '<?xml version="1.0"?>\n<AUTORIZACION>\n<CAF version="1.0">\n<DA>\n' +
    `<RE>${rut}</RE>\n<RS>EMPRESA E2E SPA</RS>\n<TD>${tipo}</TD>\n` +
    `<RNG><D>${desde}</D><H>${hasta}</H></RNG>\n<FA>${hoyChile().fecha}</FA>\n` +
    `<RSAPK><M>${b64(jwk.n)}</M><E>${b64(jwk.e)}</E></RSAPK>\n<IDK>100</IDK>\n</DA>\n` +
    `<FRMA algoritmo="SHA1withRSA">${Buffer.alloc(64, 'x').toString('base64')}</FRMA>\n` +
    `</CAF>\n<RSASK>${llaveCaf.privada.trimEnd()}\n</RSASK>\n` +
    `<RSAPUBK>${llaveCaf.publica.export({ type: 'spki', format: 'pem' }).toString().trimEnd()}\n</RSAPUBK>\n` +
    '</AUTORIZACION>\n'
  );
}

function paginaConfirmaFolios(c: {
  rut: string;
  tipo: string;
  cantidad: number;
  desde: number;
  hasta: number;
}): string {
  const { numero, dv } = partirRut(c.rut);
  const h = hoyChile();
  return `<HTML><HEAD><TITLE>Confirmaci&oacute;n de Folios</TITLE></HEAD><BODY>
<FORM NAME="form4" METHOD="POST" ACTION="of_genera_folio">
<INPUT TYPE="hidden" NAME="NOMUSU" VALUE="TITULAR E2E">
<INPUT TYPE="hidden" NAME="CON_CREDITO" VALUE="0">
<INPUT TYPE="hidden" NAME="CON_AJUSTE" VALUE="0">
<INPUT TYPE="hidden" NAME="FOLIO_INI" VALUE="${c.desde}">
<INPUT TYPE="hidden" NAME="FOLIO_FIN" VALUE="${c.hasta}">
<INPUT TYPE="hidden" NAME="DIA" VALUE="${h.dia}">
<INPUT TYPE="hidden" NAME="MES" VALUE="${h.mes}">
<INPUT TYPE="hidden" NAME="ANO" VALUE="${h.ano}">
<INPUT TYPE="hidden" NAME="HORA" VALUE="12">
<INPUT TYPE="hidden" NAME="MINUTO" VALUE="00">
<INPUT TYPE="hidden" NAME="RUT_EMP" VALUE="${numero}">
<INPUT TYPE="hidden" NAME="DV_EMP" VALUE="${dv}">
<INPUT TYPE="hidden" NAME="COD_DOCTO" VALUE="${c.tipo}">
<INPUT TYPE="hidden" NAME="CANT_DOCTOS" VALUE="${c.cantidad}">
<INPUT TYPE="submit" NAME="ACEPTAR" VALUE="Obtener Folios">
</FORM></BODY></HTML>`;
}

function paginaGeneraFolios(c: { rut: string; tipo: string; desde: number; hasta: number }) {
  const { numero, dv } = partirRut(c.rut);
  return `<HTML><HEAD><TITLE>Folios Autorizados</TITLE></HEAD><BODY>
Se autorizaron los folios ${c.desde} al ${c.hasta}.
<FORM NAME="form5" METHOD="POST" ACTION="of_genera_archivo">
<INPUT TYPE="hidden" NAME="RUT_EMP" VALUE="${numero}">
<INPUT TYPE="hidden" NAME="DV_EMP" VALUE="${dv}">
<INPUT TYPE="hidden" NAME="COD_DOCTO" VALUE="${c.tipo}">
<INPUT TYPE="hidden" NAME="FOLIO_INI" VALUE="${c.desde}">
<INPUT TYPE="hidden" NAME="FOLIO_FIN" VALUE="${c.hasta}">
<INPUT TYPE="hidden" NAME="FECHA" VALUE="${hoyChile().fecha}">
<INPUT TYPE="submit" NAME="ACEPTAR" VALUE="AQUI">
</FORM></BODY></HTML>`;
}

// --- Simulador --------------------------------------------------------------------------

const SEMILLA = '012345678901';
const TOKEN = 'TOKENE2EFALSO0123456789';
const xmlSii = (cuerpo: string, glosa = '') =>
  `<?xml version="1.0" encoding="UTF-8"?><SII:RESPUESTA xmlns:SII="http://www.sii.cl/XMLSchema"><SII:RESP_BODY>${cuerpo}</SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO>${glosa}</SII:RESP_HDR></SII:RESPUESTA>`;

/** Hosts del SII de certificación que el simulador conoce. */
const HOSTS_CERTIFICACION = new Set([
  'herculesr.sii.cl',
  'maullin.sii.cl',
  'www4.sii.cl',
  'apicert.sii.cl',
  'pangal.sii.cl',
]);

export class SiiFalso {
  readonly registro: Registro[] = [];
  /** Peticiones que no supo responder (o a hosts de producción). */
  readonly desconocidas: string[] = [];
  /** Estado de la declaración en el portal: null (sin trámite), P80, P90 o P91. */
  declaracion: null | 'P80' | 'P90' | 'P91' = null;
  readonly envios = new Map<string, { rut: string; documentos: number; tipo: number }>();
  #siguienteFolio = new Map<string, number>();
  #pendiente: { rut: string; tipo: string; cantidad: number; desde: number; hasta: number } | null =
    null;
  #trackId = 7_000_000_000;
  #servidor: Server | null = null;

  /** Levanta el servidor en 127.0.0.1:`puerto`. */
  async iniciar(puerto: number): Promise<void> {
    const servidor = createServer((req, res) => {
      const trozos: Buffer[] = [];
      req.on('data', (c: Buffer) => trozos.push(c));
      req.on('end', () => {
        let respuesta: Respuesta;
        try {
          respuesta = this.atender(JSON.parse(Buffer.concat(trozos).toString('utf8')) as Peticion);
        } catch (error) {
          this.desconocidas.push(`excepción del simulador: ${String(error)}`);
          respuesta = { status: 500, cuerpo: 'error del simulador' };
        }
        const cuerpo =
          typeof respuesta.cuerpo === 'string'
            ? Buffer.from(respuesta.cuerpo, 'utf8')
            : (respuesta.cuerpo ?? Buffer.alloc(0));
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            status: respuesta.status,
            cabeceras: respuesta.cabeceras ?? {},
            cuerpo: cuerpo.toString('base64'),
          }),
        );
      });
    });
    await new Promise<void>((listo, fallo) => {
      servidor.once('error', fallo);
      servidor.listen(puerto, '127.0.0.1', () => listo());
    });
    this.#servidor = servidor;
  }

  async cerrar(): Promise<void> {
    const s = this.#servidor;
    this.#servidor = null;
    if (s) await new Promise<void>((listo) => s.close(() => listo()));
  }

  /** Resumen legible de lo atendido (para los mensajes de error de la prueba). */
  resumen(): string[] {
    return this.registro.map(
      (r) => `${r.status} ${r.metodo} ${r.host}${r.ruta}${r.gwt ? ` ${r.gwt}` : ''}`,
    );
  }

  /** Atendidas hacia `host` cuya ruta contiene `parte`. */
  hacia(host: string, parte = ''): Registro[] {
    return this.registro.filter((r) => r.host === host && r.ruta.includes(parte));
  }

  atender(p: Peticion): Respuesta {
    const url = new URL(p.url);
    const gwt = url.pathname.endsWith('/facade')
      ? (Buffer.from(p.cuerpo, 'base64').toString('utf8').split('|')[6] ?? '')
      : undefined;
    let r: Respuesta;
    if (url.protocol !== 'https:' || !HOSTS_CERTIFICACION.has(url.hostname)) {
      this.desconocidas.push(`host fuera de certificación: ${p.metodo} ${url.host}${url.pathname}`);
      r = { status: 599, cuerpo: 'host fuera del SII de certificación' };
    } else {
      r = this.#responder(p, url, gwt) ?? this.#desconocida(p, url, gwt);
    }
    this.registro.push({
      metodo: p.metodo,
      host: url.hostname,
      ruta: url.pathname,
      ...(gwt !== undefined ? { gwt } : {}),
      tls: p.tls,
      status: r.status,
    });
    return r;
  }

  #desconocida(p: Peticion, url: URL, gwt: string | undefined): Respuesta {
    this.desconocidas.push(`${p.metodo} ${url.host}${url.pathname}${gwt ? ` ${gwt}` : ''}`);
    return { status: 404, cuerpo: '' };
  }

  #responder(p: Peticion, url: URL, gwt: string | undefined): Respuesta | null {
    const ruta = url.pathname;
    const html = (s: string): Respuesta => ({
      status: 200,
      cabeceras: { 'content-type': 'text/html; charset=ISO-8859-1' },
      cuerpo: latin1(s),
    });

    switch (url.hostname) {
      case 'herculesr.sii.cl':
        if (ruta === '/cgi_AUT2000/CAutInicio.cgi' && p.tls) return html(LOGIN_OK);
        return null;

      case 'maullin.sii.cl':
        return this.#maullin(p, ruta, html);

      case 'www4.sii.cl':
        if (/^\/certBolElectDteInternet\/[0-9A-F]{32}\.cache\.html$/.test(ruta)) {
          return html(PORTAL_VIGENTE);
        }
        if (ruta === '/certBolElectDteInternet/DownloadFileServlet') {
          return { status: 200, cuerpo: SET_PRUEBAS };
        }
        if (ruta === '/certBolElectDteInternet/facade' && gwt !== undefined) {
          const cuerpo = this.#gwt(gwt);
          return cuerpo === null ? null : { status: 200, cuerpo };
        }
        return null;

      case 'apicert.sii.cl':
      case 'pangal.sii.cl':
        return this.#rest(p, ruta);
    }
    return null;
  }

  #maullin(p: Peticion, ruta: string, html: (s: string) => Respuesta): Respuesta | null {
    const c = campos(p);
    switch (ruta) {
      // Postulación.
      case '/cvc_cgi/dte/pe_ingrut':
        return html(POSTULACION('pe-ingrut'));
      case '/cvc_cgi/dte/pe_datos_empresa': {
        const rut = `${c.get('RUT_EMP') ?? ''}-${c.get('DV_EMP') ?? ''}`;
        return html(
          POSTULACION('datos-empresa')
            .replace('{{META}}', '')
            .replace('VALUE="76123456"', `VALUE="${escapar(c.get('RUT_EMP') ?? '')}"`)
            .replace(
              'NAME="DV_EMP" VALUE="0"',
              `NAME="DV_EMP" VALUE="${escapar(c.get('DV_EMP') ?? '')}"`,
            )
            .replace('76.123.456-0', rut)
            .replaceAll('{{RAZON_SOCIAL}}', 'EMPRESA E2E SPA')
            .replace('{{EXTRA}}', ''),
        );
      }
      case '/cvc_cgi/dte/pe_confirma': {
        let pagina = POSTULACION('confirma')
          .replace('{{META}}', '')
          .replace('{{ACTION}}', 'pe_graba_postulacion')
          .replace(
            '{{BOLEXEN}}',
            c.get('BOLEXEN') ? '<INPUT TYPE="hidden" NAME="BOLEXEN" VALUE="S">\n' : '',
          );
        for (const campo of [
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
          'ESFAC',
          'RAZON_SOCIAL',
        ]) {
          const porDefecto =
            campo === 'ESFAC' ? 'N' : campo === 'RAZON_SOCIAL' ? 'EMPRESA E2E SPA' : '';
          pagina = pagina.replaceAll(`{{${campo}}}`, escapar(c.get(campo) || porDefecto));
        }
        return html(pagina);
      }
      case '/cvc_cgi/dte/pe_graba_postulacion':
        return html(POSTULACION('aceptada'));

      // Solicitud de folios (certificación).
      case '/cvc_cgi/dte/of_solicita_folios':
        return html(leer('folios/paginas/paso1-rut.html'));
      case '/cvc_cgi/dte/of_solicita_folios_dcto':
      case '/cvc_cgi/dte/of_confirma_folio': {
        const rut = `${c.get('RUT_EMP') ?? ''}-${c.get('DV_EMP') ?? ''}`;
        const tipo = c.get('COD_DOCTO') ?? '';
        const cantidad = Number(c.get('CANT_DOCTOS') ?? '0');
        if (!/^\d+-[\dkK]$/.test(rut) || !/^\d+$/.test(tipo) || !(cantidad > 0)) return null;
        const clave = `${rut}:${tipo}`;
        const desde = this.#siguienteFolio.get(clave) ?? 1;
        this.#pendiente = { rut, tipo, cantidad, desde, hasta: desde + cantidad - 1 };
        return html(paginaConfirmaFolios(this.#pendiente));
      }
      case '/cvc_cgi/dte/of_genera_folio': {
        const pend = this.#pendiente;
        if (!pend || c.get('FOLIO_INI') !== String(pend.desde)) return null;
        this.#siguienteFolio.set(`${pend.rut}:${pend.tipo}`, pend.hasta + 1);
        return html(paginaGeneraFolios(pend));
      }
      case '/cvc_cgi/dte/of_genera_archivo': {
        const pend = this.#pendiente;
        if (!pend) return null;
        this.#pendiente = null;
        return {
          status: 200,
          cabeceras: { 'content-type': 'text/xml' },
          cuerpo: latin1(cafPrueba(pend.rut, Number(pend.tipo), pend.desde, pend.hasta)),
        };
      }
    }
    return null;
  }

  #gwt(metodo: string): string | null {
    switch (metodo) {
      case 'obtenerEstadoAutorizaEmp':
        return this.declaracion === null ? GWT.NULO : GWT[this.declaracion];
      case 'obtenerPostulacionSeg':
        return GWT.NULO;
      case 'recuperarNroActividadesVigAfecIva':
        return GWT.entero(3);
      case 'ingresarTrackId':
        // El SII revisa el set y, en este simulador, lo aprueba al tiro: P90.
        this.declaracion = 'P90';
        return GWT.texto('1');
      case 'recuperarNombreContribuyente':
        return GWT.NOMBRE;
      case 'listarDocAutorizados':
        return GWT.DOCUMENTOS;
      case 'autorizarEmpresaBolProd':
        if (this.declaracion !== 'P90') return null;
        this.declaracion = 'P91';
        return GWT.AUTORIZAR_P91;
    }
    return null;
  }

  #rest(p: Peticion, ruta: string): Respuesta | null {
    const base = '/recursos/v1/';
    if (!ruta.startsWith(base)) return null;
    const recurso = ruta.slice(base.length);
    if (recurso === 'boleta.electronica.semilla' && p.metodo === 'GET') {
      return { status: 200, cuerpo: xmlSii(`<SEMILLA>${SEMILLA}</SEMILLA>`) };
    }
    if (recurso === 'boleta.electronica.token' && p.metodo === 'POST') {
      return {
        status: 200,
        cuerpo: xmlSii(`<TOKEN>${TOKEN}</TOKEN>`, '<GLOSA>Token Creado</GLOSA>'),
      };
    }
    const conToken = (p.cabeceras.Cookie ?? p.cabeceras.cookie ?? '').includes(`TOKEN=${TOKEN}`);
    if (recurso === 'boleta.electronica.envio' && p.metodo === 'POST') {
      if (!conToken) return { status: 401, cuerpo: 'sin token' };
      const cuerpo = Buffer.from(p.cuerpo, 'base64').toString('latin1');
      const rut = /<RutEmisor>([^<]+)<\/RutEmisor>/.exec(cuerpo)?.[1] ?? RUT_EMPRESA;
      const documentos = (cuerpo.match(/<DTE\b/g) ?? []).length;
      const tipo = Number(/<TipoDTE>(\d+)<\/TipoDTE>/.exec(cuerpo)?.[1] ?? '39');
      const trackId = String(++this.#trackId);
      this.envios.set(trackId, { rut, documentos, tipo });
      return {
        status: 200,
        cabeceras: { 'content-type': 'application/json' },
        cuerpo: JSON.stringify({
          rut_emisor: rut,
          rut_envia: RUT_TITULAR,
          trackid: Number(trackId),
          fecha_recepcion: new Date().toISOString().replace('T', ' ').slice(0, 19),
          estado: 'REC',
          file: 'envio.xml',
        }),
      };
    }
    const estado = /^boleta\.electronica\.envio\/(\d+)-([\dkK])-(\d+)$/.exec(recurso);
    if (estado && p.metodo === 'GET') {
      if (!conToken) return { status: 401, cuerpo: 'sin token' };
      const envio = this.envios.get(estado[3] ?? '');
      if (!envio) return null;
      return {
        status: 200,
        cabeceras: { 'content-type': 'application/json' },
        cuerpo: JSON.stringify({
          rut_emisor: envio.rut,
          rut_envia: RUT_TITULAR,
          trackid: Number(estado[3]),
          fecha_recepcion: new Date().toISOString().replace('T', ' ').slice(0, 19),
          estado: 'EPR',
          estadistica: [
            {
              tipo: envio.tipo,
              informados: envio.documentos,
              aceptados: envio.documentos,
              rechazados: 0,
              reparos: 0,
            },
          ],
          detalle_rep_rech: [],
        }),
      };
    }
    return null;
  }
}
