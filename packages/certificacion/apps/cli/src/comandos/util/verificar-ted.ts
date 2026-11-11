// `sii util verificar-ted <sobre.xml>`: verifica criptográficamente el TED (timbre)
// de cada boleta de un sobre con la llave del CAF. Reemplaza bin/util/verificar-ted.php.
// Sin red.
//
// Bytes: la <FRMT> es una firma SHA1withRSA sobre los bytes EXACTOS del <DD> tal
// como van en el archivo (ISO-8859-1). Por eso el sobre se lee como bytes y el
// <DD> se recorta del texto `latin1` (un carácter por byte), sin decodificar ni
// reserializar nada: un sobre reconvertido a UTF-8 con tildes en el <DD> falla,
// igual que fallaría en el SII.

import { createPrivateKey, createPublicKey, type KeyObject, verify } from 'node:crypto';
import { decodificarUtf8OIso, parsearDocumento } from '@winex/certificacion';
import { leerArchivo, rutaArchivo, rutaDelArgumento } from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import { CODIGOS, type CodigoSalida, ErrorConfig } from '../../errores.ts';
import { type DefinicionComando, type EntradaComando, opcionTexto } from '../tipos.ts';

const AYUDA = `Uso: sii util verificar-ted <sobre.xml> [--caf <ruta>]

Verifica la firma <FRMT> del TED (timbre) de cada boleta del sobre con la llave
del CAF: la deriva de <RSASK>, como el PHP, y además revisa que coincida con la
<RSAPK> que publica el CAF (la que usa el SII). Imprime OK o FALLA por TED, con
su tipo y folio.

Opciones:
  --caf <ruta>   CAF con que se timbraron las boletas (reemplaza a SII_CAF_39).

Variables del .env:
  SII_CAF_39     CAF por defecto (si no viene --caf)

Qué sale al SII: nada (no hay red).
Archivos que escribe: ninguno.

Códigos de salida: 0 todos los TED OK · 3 sobre o CAF ilegibles ·
  7 algún TED falla, el sobre no trae ningún TED o <RSASK> y <RSAPK> no coinciden.`;

export const comando: DefinicionComando = {
  grupo: 'util',
  nombre: 'verificar-ted',
  resumen: 'Verifica los TED de un sobre contra la llave del CAF',
  ayuda: AYUDA,
  opciones: { caf: { type: 'string' } },
  posicionales: { min: 1, max: 1 },
  ejecutar: verificarTed,
};

/** Cada `<TED …>…</TED>` del sobre (también los que no tengan la forma esperada). */
const BLOQUE_TED = /<TED\b[^>]*>[\s\S]*?<\/TED>/g;
/** Forma de un TED del SII: el `<DD>` firmado, pegado a la `<FRMT>` (como `partesTed` del core). */
const PARTES_TED =
  /^<TED version="1\.0">(<DD>[\s\S]*<\/DD>)<FRMT algoritmo="SHA1withRSA">([^<]*)<\/FRMT><\/TED>$/;

async function verificarTed(ctx: Contexto, entrada: EntradaComando) {
  const config = entrada.config();
  const rutaSobre = rutaDelArgumento(config, entrada.posicionales[0] ?? '');
  const rutaCaf = rutaArchivo(config, 'SII_CAF_39', {
    valor: opcionTexto(entrada, 'caf'),
    opcion: '--caf',
  });
  const sobre = leerArchivo(rutaSobre, 'el sobre');
  const llaves = llavesDelCaf(decodificarUtf8OIso(leerArchivo(rutaCaf, 'el CAF')), rutaCaf);

  let codigo: CodigoSalida = CODIGOS.OK;
  if (llaves.aviso !== undefined) {
    ctx.imprimirError(`[AVISO] ${llaves.aviso}`);
    if (llaves.coinciden === false) codigo = CODIGOS.VERIFICACION;
  }

  const bloques = sobre.toString('latin1').match(BLOQUE_TED) ?? [];
  if (bloques.length === 0) {
    ctx.imprimir(`No se encontró ningún TED en ${rutaSobre}`);
    return CODIGOS.VERIFICACION;
  }

  let fallas = 0;
  for (const bloque of bloques) {
    const partes = PARTES_TED.exec(bloque);
    const dd = partes?.[1];
    const tipo = dd === undefined ? 'N/A' : (/<TD>([^<]*)<\/TD>/.exec(dd)?.[1] ?? 'N/A');
    const folio = dd === undefined ? 'N/A' : (/<F>([^<]*)<\/F>/.exec(dd)?.[1] ?? 'N/A');
    let ok = false;
    if (dd !== undefined && partes?.[2] !== undefined) {
      const firma = Buffer.from(partes[2].replace(/\s/g, ''), 'base64');
      ok = verify('sha1', Buffer.from(dd, 'latin1'), llaves.publica, firma);
    }
    if (!ok) fallas++;
    const nota = dd === undefined ? ' (estructura de TED inesperada)' : '';
    ctx.imprimir(`${ok ? 'OK   ' : 'FALLA'}  TED de TipoDTE: ${tipo} | Folio: ${folio}${nota}`);
  }

  ctx.imprimir('');
  ctx.imprimir(
    `${bloques.length} TED revisado(s): ${bloques.length - fallas} OK, ${fallas} con falla.`,
  );
  return fallas > 0 ? CODIGOS.VERIFICACION : codigo;
}

interface LlavesCaf {
  /** Llave con que se verifica: la derivada de `<RSASK>` (o la `<RSAPK>` si no hay `<RSASK>`). */
  readonly publica: KeyObject;
  /** `false` si `<RSASK>` y `<RSAPK>` no son del mismo par; `undefined` si falta alguna. */
  readonly coinciden: boolean | undefined;
  readonly aviso?: string;
}

/** Lee las llaves del CAF. Nunca muestra su contenido. */
function llavesDelCaf(contenido: string, ruta: string): LlavesCaf {
  let doc: Document;
  try {
    doc = parsearDocumento(contenido);
  } catch (error) {
    throw new ErrorConfig(`El CAF no es un XML válido: ${ruta}`, { cause: error });
  }
  const textoDe = (nombre: string, padre: Document | Element = doc) =>
    padre.getElementsByTagName(nombre).item(0)?.textContent ?? undefined;

  const rsask = textoDe('RSASK');
  const derivada = rsask === undefined ? undefined : publicaDeRsask(rsask, ruta);

  let rsapk: KeyObject | undefined;
  const nodoRsapk = doc.getElementsByTagName('RSAPK').item(0);
  if (nodoRsapk !== null) {
    const m = textoDe('M', nodoRsapk);
    const e = textoDe('E', nodoRsapk);
    try {
      const b64url = (v: string) =>
        Buffer.from(v.replace(/\s/g, ''), 'base64').toString('base64url');
      if (m === undefined || e === undefined) throw new Error('sin M o E');
      rsapk = createPublicKey({ key: { kty: 'RSA', n: b64url(m), e: b64url(e) }, format: 'jwk' });
    } catch (error) {
      if (derivada === undefined) {
        throw new ErrorConfig(`La <RSAPK> del CAF no se pudo leer: ${ruta}`, { cause: error });
      }
      return {
        publica: derivada,
        coinciden: undefined,
        aviso: 'La <RSAPK> del CAF no se pudo leer: se verifica solo con la llave de <RSASK>.',
      };
    }
  }

  if (derivada === undefined) {
    if (rsapk === undefined) {
      throw new ErrorConfig(`El CAF no trae <RSASK> ni <RSAPK>: ${ruta}`);
    }
    return {
      publica: rsapk,
      coinciden: undefined,
      aviso: 'El CAF no trae <RSASK>: se verifica con la llave de <RSAPK>.',
    };
  }
  if (rsapk === undefined) {
    return {
      publica: derivada,
      coinciden: undefined,
      aviso: 'El CAF no trae <RSAPK>: se verifica solo con la llave de <RSASK>.',
    };
  }
  const der = (k: KeyObject) => k.export({ type: 'spki', format: 'der' });
  if (der(derivada).equals(der(rsapk))) return { publica: derivada, coinciden: true };
  return {
    publica: derivada,
    coinciden: false,
    aviso:
      'La llave de <RSASK> no coincide con la <RSAPK> del CAF: el SII verifica con la <RSAPK>, ' +
      'así que rechazaría estos timbres aunque abajo salgan OK. Revisa que el CAF no esté alterado.',
  };
}

/** Llave pública del par de `<RSASK>`, reconstruyendo el PEM como el PHP (y `Timbre` del core). */
function publicaDeRsask(rsask: string, ruta: string): KeyObject {
  const cuerpo = rsask
    .replaceAll('-----BEGIN RSA PRIVATE KEY-----', '')
    .replaceAll('-----END RSA PRIVATE KEY-----', '')
    .replace(/[\r\n \t]/g, '');
  const lineas = cuerpo.match(/[\s\S]{1,64}/g) ?? [];
  const pem = `-----BEGIN RSA PRIVATE KEY-----\n${lineas.join('\n')}\n-----END RSA PRIVATE KEY-----`;
  try {
    return createPublicKey(createPrivateKey(pem));
  } catch (error) {
    // Sin el PEM en el mensaje.
    throw new ErrorConfig(`La llave <RSASK> del CAF no se pudo leer: ${ruta}`, { cause: error });
  }
}
