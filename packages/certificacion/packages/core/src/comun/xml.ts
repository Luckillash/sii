// Deriva de winex/certificacion v1.9.1 (src/Core/GeneradorBoleta.php,
// src/Certificacion/GeneradorConsumoFolios.php, src/Core/FirmaElectronica.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript.
//
// Utilidades XML compartidas: parseo, un constructor de árboles con la semántica
// de `DOMDocument` de PHP y un serializador que reproduce byte a byte
// `DOMDocument::saveXML()` (libxml2 2.10, PHP 8.3). C14N está en c14n.ts.
//
// Hay UN solo serializador, que recorre nodos @xmldom/xmldom, y sirve para los
// dos usos del core PHP:
//
// - Documentos construidos (GeneradorBoleta, GeneradorConsumoFolios):
//   `crearDocumento` + `crearElemento` + `fijarAtributo` + `appendChild` y
//   `serializarXml(doc, { formatear: true })`.
// - Documentos parseados y reserializados (FirmaElectronica::firmarDte):
//   `parsearDocumento` + `importNode`/`appendChild` + `serializarXml(doc)`.
//
// Comportamientos de libxml que se replican (verificados con los golden tests
// paridad/casos/xml-*):
//
// - Declaración: `<?xml version="1.0" encoding="ISO-8859-1"?>` con el encoding
//   tal como se escribió (respeta mayúsculas), o `<?xml version="1.0"?>` si el
//   documento no declara encoding; `standalone` se conserva. Siempre sigue `\n`,
//   y cada hijo del documento (comentarios, PIs, raíz) termina en `\n`. Los
//   blancos fuera de la raíz desaparecen.
// - Salida según el encoding del documento:
//   - ISO-8859-1: bytes ISO-8859-1; lo que no cabe sale como `&#N;` decimal, en
//     cualquier parte (texto, atributos, comentarios, CDATA, nombres).
//   - UTF-8: bytes UTF-8 tal cual.
//   - Sin encoding declarado: UTF-8, pero en texto y atributos todo lo que no es
//     ASCII sale como `&#xHEX;` (`é` → `&#xE9;`) y en texto `\r` → `&#xD;`.
// - Texto: escapa `&` `<` `>` y `\r` (`&#13;`). No escapa comillas, `\t` ni `\n`.
// - Atributos: escapa `&` `<` `>` `"` (`&quot;`), `\t` (`&#9;`), `\n` (`&#10;`) y
//   `\r` (`&#13;`). La comilla simple queda tal cual. Siempre entre comillas
//   dobles.
// - Declaraciones de namespace (`xmlns`, `xmlns:p`) van ANTES que los demás
//   atributos y NO se escapan: entre comillas dobles, o simples si el valor
//   tiene `"` (si tiene ambas, `"` → `&quot;`). `xmlns:xml` no se escribe.
// - Elemento sin hijos: `<X/>`. Con un hijo de texto vacío: `<X></X>`.
// - `formatear` (`formatOutput = true`): indenta con 2 espacios (máximo 60, o
//   sea 30 niveles) los hijos de un elemento solo si NINGUNO es texto, CDATA o
//   referencia de entidad; si alguno lo es, ese elemento y todo su subárbol
//   salen sin formato (contenido mixto). Comentarios y PIs se indentan como
//   elementos.
// - CDATA con `]]>` se parte en varias secciones. PI sin datos: `<?t?>`.

import { DOMImplementation, DOMParser, type Options } from '@xmldom/xmldom';
import { SiiError } from './errores.ts';

const XMLNS = 'http://www.w3.org/2000/xmlns/';

const NODO_ELEMENTO = 1;
const NODO_TEXTO = 3;
const NODO_CDATA = 4;
const NODO_REFERENCIA_ENTIDAD = 5;
const NODO_PI = 7;
const NODO_COMENTARIO = 8;
const NODO_DOCUMENTO = 9;
const NODO_DOCTYPE = 10;

/** Indentación máxima de libxml: 60 espacios (`MAX_INDENT`), o sea 30 niveles de 2. */
const NIVELES_MAXIMOS = 30;

// ---------------------------------------------------------------------------
// Parseo
// ---------------------------------------------------------------------------

/**
 * Opciones de @xmldom/xmldom 0.8 para parsear como libxml (XML 1.0). Por
 * defecto xmldom normaliza los fines de línea con las reglas de XML 1.1 y
 * convierte también U+0085 y U+2028 en salto de línea; libxml los conserva (un
 * byte 0x85 en un DTE ISO-8859-1 cambiaría el digest). En XML 1.0 solo CR LF y
 * CR son fin de línea. `normalizeLineEndings` existe en xmldom 0.8 pero no está
 * en sus tipos.
 *
 * Las advertencias de xmldom también son error: así reporta XML que libxml
 * rechaza (etiquetas sin cerrar o que no calzan, atributos sin comillas).
 */
function opcionesParser(errores: string[]): Options {
  const opciones = {
    normalizeLineEndings: (texto: string) => texto.replace(/\r\n?/g, '\n'),
    errorHandler: (_nivel: string, mensaje: unknown) => {
      errores.push(String(mensaje));
    },
  };
  return opciones;
}

/**
 * Parsea un documento XML y devuelve su elemento raíz. Mismas reglas que
 * {@link parsearDocumento}; lanza {@link SiiError} si el XML no es válido.
 */
export function parsearXml(xml: string): Element {
  const raiz = parsearDocumento(xml).documentElement;
  if (raiz === null) throw new SiiError('XML inválido: documento vacío');
  return raiz;
}

/** Datos de la declaración `<?xml ...?>` de un documento. */
export interface DeclaracionXml {
  version: string;
  /** Tal como se escribió (`ISO-8859-1`, `iso-8859-1`, `UTF-8`...). Sin declarar: `undefined`. */
  encoding?: string | undefined;
  standalone?: 'yes' | 'no' | undefined;
}

const declaraciones = new WeakMap<Document, DeclaracionXml>();

/** PIs parseadas como `<?t ?>`: libxml les guarda datos vacíos (no nulos) y las escribe así. */
const piConDatosVacios = new WeakSet<Node>();

const DECLARACION =
  /^<\?xml\s+version\s*=\s*(?:"([^"]*)"|'([^']*)')(?:\s+encoding\s*=\s*(?:"([^"]*)"|'([^']*)'))?(?:\s+standalone\s*=\s*(?:"(yes|no)"|'(yes|no)'))?\s*\?>/;

/**
 * Parsea un documento completo como `DOMDocument::loadXML()` con
 * `preserveWhiteSpace = true` (el default de PHP): conserva blancos,
 * comentarios, CDATA y PIs, y recuerda la declaración para que
 * {@link serializarXml} la reproduzca.
 *
 * - `Buffer`/`Uint8Array`: se decodifica según la declaración, como libxml
 *   (sin declaración o con `encoding="UTF-8"`: UTF-8 estricto; con
 *   `encoding="ISO-8859-1"`: ISO-8859-1). Un BOM UTF-8 se descarta.
 * - `string`: ya es Unicode; la declaración solo define cómo se serializará.
 *
 * Se aplican las reglas de XML 1.0 que aplica libxml: `\r\n` y `\r` → `\n`
 * (U+0085 y U+2028 se conservan: no son fin de línea en XML 1.0), y en
 * atributos `\t`, `\n` y `\r` literales → espacio (las referencias `&#9;`,
 * `&#10;`, `&#13;` se conservan).
 * Igual que libxml, el `&` dentro del valor de un `xmlns`/`xmlns:p` queda como
 * el texto literal `&#38;`.
 *
 * Lanza {@link SiiError} si el XML no es válido, si el encoding no es UTF-8 ni
 * ISO-8859-1, o si trae `<!DOCTYPE>` (el SII no lo usa; además evita
 * entidades externas). Lo que xmldom deja pasar y libxml rechaza se revisa
 * antes de parsear (ver {@link verificarLexico}): así un XML que el PHP no
 * habría podido firmar tampoco se firma en Node.
 */
export function parsearDocumento(entrada: string | Uint8Array): Document {
  const texto =
    typeof entrada === 'string' ? entrada.replace(/^\u{FEFF}/u, '') : decodificar(entrada);
  const declaracion = leerDeclaracion(texto);
  verificarLexico(texto);

  const errores: string[] = [];
  let doc: Document;
  try {
    doc = new DOMParser(opcionesParser(errores)).parseFromString(
      marcarCdataVacias(texto),
      'text/xml',
    );
  } catch (error) {
    throw new SiiError(`XML inválido: ${String(error)}`, { cause: error });
  }
  if (errores.length > 0) throw new SiiError(`XML inválido: ${errores.join('; ')}`);

  // Prólogo y epílogo: libxml no guarda la declaración como nodo ni los blancos.
  for (let nodo = doc.firstChild; nodo !== null; ) {
    const siguiente = nodo.nextSibling;
    if (nodo.nodeType === NODO_DOCTYPE) {
      throw new SiiError('XML no soportado: el documento trae <!DOCTYPE>');
    }
    if (nodo.nodeType === NODO_TEXTO) {
      if (/[^ \t\n]/.test(nodo.nodeValue ?? '')) {
        throw new SiiError('XML inválido: texto fuera del elemento raíz');
      }
      doc.removeChild(nodo);
    } else if (nodo.nodeType === NODO_PI && (nodo as ProcessingInstruction).target === 'xml') {
      if (declaracion === undefined || nodo !== doc.firstChild) {
        throw new SiiError('XML inválido: la declaración <?xml ...?> debe ir al inicio');
      }
      doc.removeChild(nodo);
    }
    nodo = siguiente;
  }
  if (doc.documentElement === null) throw new SiiError('XML inválido: documento vacío');
  rechazarPisXml(doc);

  marcarPisConDatosVacios(doc, texto, declaracion !== undefined);
  restaurarCdataVacias(doc);
  for (const elemento of elementos(doc.documentElement)) {
    const atributos = elemento.attributes;
    for (let i = 0; i < atributos.length; i++) {
      const atributo = atributos.item(i);
      if (atributo?.namespaceURI === XMLNS && atributo.value.includes('&')) {
        const valor = atributo.value.replaceAll('&', '&#38;');
        atributo.value = valor;
        atributo.nodeValue = valor;
      }
    }
  }

  declaraciones.set(doc, declaracion ?? { version: '1.0' });
  return doc;
}

/**
 * libxml rechaza toda PI cuyo target sea `xml` en cualquier combinación de
 * mayúsculas (`<?XML ...?>`, `<?XmL?>`), en cualquier lugar, salvo la
 * declaración del inicio (ya quitada por quien llama). `<?xml-stylesheet?>` o
 * `<?xmlfoo?>` sí son válidas. Verificado contra `loadXML` de PHP 8.3.
 */
function rechazarPisXml(doc: Document): void {
  const pendientes: Node[] = [doc];
  for (let nodo = pendientes.pop(); nodo !== undefined; nodo = pendientes.pop()) {
    for (let hijo = nodo.firstChild; hijo !== null; hijo = hijo.nextSibling) {
      if (
        hijo.nodeType === NODO_PI &&
        (hijo as ProcessingInstruction).target.toLowerCase() === 'xml'
      ) {
        throw new SiiError('XML inválido: la declaración <?xml ...?> debe ir al inicio');
      }
      if (hijo.firstChild !== null) pendientes.push(hijo);
    }
  }
}

function decodificar(bytes: Uint8Array): string {
  let datos = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let conBom = false;
  if (datos[0] === 0xef && datos[1] === 0xbb && datos[2] === 0xbf) {
    datos = datos.subarray(3);
    conBom = true;
  } else if ((datos[0] === 0xfe && datos[1] === 0xff) || (datos[0] === 0xff && datos[1] === 0xfe)) {
    throw new SiiError('XML no soportado: UTF-16');
  }

  // La declaración es ASCII: se puede leer antes de saber el encoding.
  const encoding = leerDeclaracion(datos.subarray(0, 512).toString('latin1'))?.encoding;
  const modo = encoding === undefined || conBom ? 'utf-8' : modoDeEncoding(encoding);
  if (modo === 'iso-8859-1') return datos.toString('latin1');
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(datos);
  } catch (error) {
    throw new SiiError('XML inválido: el documento no es UTF-8 válido', { cause: error });
  }
}

function leerDeclaracion(texto: string): DeclaracionXml | undefined {
  if (!/^<\?xml[\s?]/.test(texto)) return undefined;
  const m = DECLARACION.exec(texto);
  if (m === null) throw new SiiError('XML inválido: declaración <?xml ...?> mal formada');
  const declaracion: DeclaracionXml = { version: m[1] ?? m[2] ?? '1.0' };
  const encoding = m[3] ?? m[4];
  if (encoding !== undefined) {
    modoDeEncoding(encoding); // valida
    declaracion.encoding = encoding;
  }
  const standalone = m[5] ?? m[6];
  if (standalone === 'yes' || standalone === 'no') declaracion.standalone = standalone;
  return declaracion;
}

const CARACTER_PROHIBIDO = /[^\t\n\r\x20-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/u;
const REFERENCIA = /&(?:#([0-9]+)|#x([0-9a-fA-F]+)|[^\s&;<>"'#][^\s&;<>"']*);/y;

/**
 * Reglas de buena formación de XML 1.0 que libxml exige y xmldom 0.8 no revisa
 * (verificado contra `DOMDocument::loadXML` de PHP 8.3):
 *
 * - caracteres fuera de `Char` (controles C0, U+FFFE, surrogates sueltos);
 * - `&` que no forma una referencia, y referencias numéricas a caracteres no
 *   permitidos (`&#0;`, `&#1;`);
 * - `]]>` en un texto, fuera de una sección CDATA;
 * - `<` dentro del valor de un atributo.
 *
 * Comentarios, CDATA y PIs se saltan (su contenido es literal). Lo que queda
 * sin cerrar lo reporta después xmldom.
 */
function verificarLexico(texto: string): void {
  const prohibido = CARACTER_PROHIBIDO.exec(texto);
  if (prohibido !== null) {
    const codigo = (prohibido[0].codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
    throw new SiiError(
      `XML inválido: carácter no permitido U+${codigo} en la posición ${prohibido.index}`,
    );
  }

  const largo = texto.length;
  let i = 0;
  while (i < largo) {
    const menor = texto.indexOf('<', i);
    const finTexto = menor === -1 ? largo : menor;
    const segmento = texto.slice(i, finTexto);
    const cierreCdata = segmento.indexOf(']]>');
    if (cierreCdata !== -1) {
      throw new SiiError(`XML inválido: "]]>" en un texto, posición ${i + cierreCdata}`);
    }
    verificarReferencias(texto, i, finTexto);
    if (menor === -1) break;

    if (texto.startsWith('<!--', menor)) i = saltarHasta(texto, menor + 4, '-->');
    else if (texto.startsWith('<![CDATA[', menor)) i = saltarHasta(texto, menor + 9, ']]>');
    else if (texto.startsWith('<?', menor)) i = saltarHasta(texto, menor + 2, '?>');
    else if (texto.startsWith('<!', menor)) {
      throw new SiiError('XML no soportado: el documento trae <!DOCTYPE>');
    } else i = verificarEtiqueta(texto, menor + 1);
  }
}

function saltarHasta(texto: string, desde: number, cierre: string): number {
  const fin = texto.indexOf(cierre, desde);
  return fin === -1 ? texto.length : fin + cierre.length;
}

/** Recorre una etiqueta hasta su `>` y revisa los valores de sus atributos. */
function verificarEtiqueta(texto: string, desde: number): number {
  let j = desde;
  while (j < texto.length) {
    const c = texto[j];
    if (c === '>') return j + 1;
    if (c === '"' || c === "'") {
      const cierre = texto.indexOf(c, j + 1);
      if (cierre === -1) return texto.length;
      const menor = texto.indexOf('<', j + 1);
      if (menor !== -1 && menor < cierre) {
        throw new SiiError(`XML inválido: "<" dentro de un atributo, posición ${menor}`);
      }
      verificarReferencias(texto, j + 1, cierre);
      j = cierre + 1;
    } else {
      j++;
    }
  }
  return j;
}

function verificarReferencias(texto: string, desde: number, hasta: number): void {
  for (let k = texto.indexOf('&', desde); k !== -1 && k < hasta; k = texto.indexOf('&', k + 1)) {
    REFERENCIA.lastIndex = k;
    const m = REFERENCIA.exec(texto);
    if (m === null || REFERENCIA.lastIndex > hasta) {
      throw new SiiError(`XML inválido: "&" que no forma una referencia, posición ${k}`);
    }
    const numero = m[1] ?? m[2];
    if (numero !== undefined) {
      const valor = numero.length > 8 ? -1 : Number.parseInt(numero, m[1] === undefined ? 16 : 10);
      if (!esCaracterXml(valor)) {
        throw new SiiError(`XML inválido: referencia a un carácter no permitido (${m[0]})`);
      }
    }
  }
}

/**
 * xmldom no crea nodo para una sección `<![CDATA[]]>` vacía, pero libxml sí (y
 * la escribe). Antes de parsear se le pone un contenido centinela, que después
 * se vacía. Comentarios y PIs se saltan: son lo único, junto con otra CDATA,
 * que puede contener el texto `<![CDATA[` (en atributos no puede ir `<`).
 */
const CDATA_CENTINELA = '\u{F8FF}cdata-vacia-certificacion\u{F8FF}';

function marcarCdataVacias(texto: string): string {
  if (!texto.includes('<![CDATA[]]>') || texto.includes(CDATA_CENTINELA)) return texto;
  return texto.replace(
    /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>/g,
    (seccion, cdata: string | undefined) =>
      cdata === '' ? `<![CDATA[${CDATA_CENTINELA}]]>` : seccion,
  );
}

function restaurarCdataVacias(nodo: Node): void {
  for (let hijo = nodo.firstChild; hijo !== null; hijo = hijo.nextSibling) {
    if (hijo.nodeType === NODO_ELEMENTO) {
      restaurarCdataVacias(hijo);
    } else if (hijo.nodeType === NODO_CDATA && (hijo as CDATASection).data === CDATA_CENTINELA) {
      // xmldom guarda el contenido en propiedades simples.
      Object.assign(hijo, { data: '', nodeValue: '', length: 0 });
    }
  }
}

/**
 * xmldom entrega `''` tanto para `<?t?>` como para `<?t ?>`, pero libxml las
 * distingue (datos nulos o vacíos) y las escribe distinto. Se recorre el texto
 * fuente: fuera de comentarios y CDATA, `<?` solo puede abrir una PI, y las PIs
 * aparecen en el mismo orden que en el árbol.
 */
function marcarPisConDatosVacios(doc: Document, texto: string, conDeclaracion: boolean): void {
  const pis: ProcessingInstruction[] = [];
  const recorrer = (nodo: Node) => {
    for (let hijo = nodo.firstChild; hijo !== null; hijo = hijo.nextSibling) {
      if (hijo.nodeType === NODO_PI) pis.push(hijo as ProcessingInstruction);
      else if (hijo.nodeType === NODO_ELEMENTO) recorrer(hijo);
    }
  };
  recorrer(doc);
  if (!pis.some((pi) => pi.data === '')) return;

  const fuente = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?([\s\S]*?)\?>/g;
  let i = conDeclaracion ? -1 : 0;
  for (const m of texto.matchAll(fuente)) {
    if (m[1] === undefined) continue;
    if (i >= 0) {
      const pi = pis[i];
      if (pi?.data === '' && /^\S*\s/.test(m[1])) piConDatosVacios.add(pi);
    }
    i++;
  }
}

function* elementos(raiz: Element): Generator<Element> {
  yield raiz;
  for (let hijo = raiz.firstChild; hijo !== null; hijo = hijo.nextSibling) {
    if (hijo.nodeType === NODO_ELEMENTO) yield* elementos(hijo as Element);
  }
}

// ---------------------------------------------------------------------------
// Construcción (semántica de DOMDocument de PHP)
// ---------------------------------------------------------------------------

/**
 * `new DOMDocument($version, $encoding)`. Sin `encoding` equivale a
 * `new DOMDocument()`: la salida declara `<?xml version="1.0"?>` y escapa todo
 * lo que no es ASCII como `&#xHEX;`.
 */
export function crearDocumento(version = '1.0', encoding?: string): Document {
  const doc = new DOMImplementation().createDocument(null, '', null);
  const declaracion: DeclaracionXml = { version };
  if (encoding !== undefined) {
    modoDeEncoding(encoding); // valida
    declaracion.encoding = encoding;
  }
  declaraciones.set(doc, declaracion);
  return doc;
}

/** Declaración del documento (la de {@link crearDocumento} o {@link parsearDocumento}). */
export function declaracionXml(doc: Document): DeclaracionXml {
  return declaraciones.get(doc) ?? { version: '1.0' };
}

/**
 * `$doc->createElement($nombre, $valor)`.
 *
 * Igual que libxml (`xmlStringGetNodeList`), `valor` NO es texto literal: se
 * interpretan las referencias. Por eso el PHP pasa los textos libres por
 * `htmlspecialchars` antes (ver `escaparXml` en codificacion.ts). Reglas:
 *
 * - `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` → el carácter.
 * - `&#233;` / `&#xE9;` → el carácter (la `x` tiene que ser minúscula; `&#0;`
 *   o un valor mayor que 0x10FFFF no producen nada). Si hay un carácter que no
 *   es dígito antes del `;`, se descarta lo leído y el texto sigue desde ese
 *   carácter (`&#12a;b` → `a;b`).
 * - `&nombre;` (cualquier otro, incluso `& b;`) → nodo referencia de entidad,
 *   que se serializa como `&nombre;` sin escapar. `&;` desaparece.
 * - `&` sin `;` posterior: se pierde TODO el texto pendiente, desde el último
 *   nodo referencia de entidad (`'a & b'` → elemento vacío; `'x&e;y&z'` →
 *   `x&e;`).
 * - Un `\0` corta el valor (en C es el fin del string).
 *
 * Valor vacío → elemento sin hijos (`<X/>`).
 */
export function crearElemento(doc: Document, nombre: string, valor = ''): Element {
  validarNombre(nombre);
  const elemento = doc.createElement(nombre);
  for (const nodo of nodosDeValor(doc, cortarEnNulo(valor))) elemento.appendChild(nodo);
  return elemento;
}

/**
 * `$elemento->setAttribute($nombre, $valor)`. El valor es literal (sin
 * interpretar referencias). Como en PHP 8.3:
 *
 * - `xmlns` crea una declaración de namespace (se serializa antes que los
 *   atributos). Si el elemento ya tiene una, no hace nada y devuelve `false`.
 * - Cualquier otro nombre, incluidos `xmlns:xsi` y `xsi:schemaLocation`, es un
 *   atributo común y conserva su posición; repetirlo reemplaza el valor en su
 *   lugar.
 */
export function fijarAtributo(elemento: Element, nombre: string, valor: string): boolean {
  const literal = cortarEnNulo(valor);
  if (nombre === 'xmlns') {
    if (elemento.getAttributeNodeNS(XMLNS, 'xmlns') !== null) return false;
    elemento.setAttributeNS(XMLNS, 'xmlns', literal);
    return true;
  }
  validarNombre(nombre);
  elemento.setAttribute(nombre, literal);
  return true;
}

const ENTIDADES_PREDEFINIDAS = new Map([
  ['lt', '<'],
  ['gt', '>'],
  ['amp', '&'],
  ['apos', "'"],
  ['quot', '"'],
]);

/** Port de `xmlStringGetNodeList` (libxml2 2.10, tree.c). */
function nodosDeValor(doc: Document, valor: string): Node[] {
  const nodos: Node[] = [];
  let pendiente = '';
  const vaciar = () => {
    if (pendiente !== '') nodos.push(doc.createTextNode(pendiente));
    pendiente = '';
  };

  const largo = valor.length;
  let cur = 0;
  let q = 0;
  while (cur < largo) {
    if (valor[cur] !== '&') {
      cur++;
      continue;
    }
    if (cur !== q) pendiente += valor.slice(q, cur);
    q = cur;

    let codigo = 0;
    if (valor[cur + 1] === '#') {
      const hexadecimal = valor[cur + 2] === 'x';
      cur += hexadecimal ? 3 : 2;
      let c = valor[cur];
      while (c !== ';') {
        const digito = c === undefined ? -1 : Number.parseInt(c, hexadecimal ? 16 : 10);
        if (Number.isNaN(digito) || digito < 0) {
          codigo = 0;
          break;
        }
        // Aritmética de `int` de C (32 bits con signo).
        codigo = (codigo * (hexadecimal ? 16 : 10) + digito) | 0;
        cur++;
        c = valor[cur];
      }
      if (c === ';') cur++;
      q = cur;
    } else {
      cur++;
      q = cur;
      while (cur < largo && valor[cur] !== ';') cur++;
      if (cur >= largo) return nodos; // `&` sin `;`: libxml descarta el texto pendiente
      if (cur !== q) {
        const nombre = valor.slice(q, cur);
        const predefinida = ENTIDADES_PREDEFINIDAS.get(nombre);
        if (predefinida !== undefined) {
          pendiente += predefinida;
        } else {
          vaciar();
          nodos.push(referenciaEntidad(doc, nombre));
        }
      }
      cur++;
      q = cur;
    }
    if (codigo > 0 && codigo < 0x110000) pendiente += caracter(codigo);
  }
  if (cur !== q || nodos.length === 0) pendiente += valor.slice(q, cur);
  vaciar();
  return nodos;
}

/** Un code point como string; los surrogates (0xD800–0xDFFF) quedan sueltos, como en libxml. */
function caracter(codigo: number): string {
  return codigo < 0x10000 ? String.fromCharCode(codigo) : String.fromCodePoint(codigo);
}

/**
 * Nodo referencia de entidad. xmldom valida el nombre, pero libxml acepta
 * cualquier cosa entre `&` y `;` (incluso espacios): se crea con un nombre
 * válido y luego se le pone el real.
 */
function referenciaEntidad(doc: Document, nombre: string): Node {
  const nodo = (doc as unknown as { createEntityReference(n: string): Node }).createEntityReference(
    'e',
  );
  (nodo as unknown as { nodeName: string }).nodeName = nombre;
  return nodo;
}

function cortarEnNulo(texto: string): string {
  const i = texto.indexOf('\0');
  return i === -1 ? texto : texto.slice(0, i);
}

/** NameStartChar de XML 1.0 (5.ª edición), como pares [desde, hasta]. */
const INICIO_NOMBRE: readonly (readonly [number, number])[] = [
  [0x3a, 0x3a], // :
  [0x41, 0x5a],
  [0x5f, 0x5f], // _
  [0x61, 0x7a],
  [0xc0, 0xd6],
  [0xd8, 0xf6],
  [0xf8, 0x2ff],
  [0x370, 0x37d],
  [0x37f, 0x1fff],
  [0x200c, 0x200d],
  [0x2070, 0x218f],
  [0x2c00, 0x2fef],
  [0x3001, 0xd7ff],
  [0xf900, 0xfdcf],
  [0xfdf0, 0xfffd],
  [0x10000, 0xeffff],
];

/** NameChar además de NameStartChar. */
const RESTO_NOMBRE: readonly (readonly [number, number])[] = [
  [0x2d, 0x2e], // - .
  [0x30, 0x39],
  [0xb7, 0xb7],
  [0x300, 0x36f],
  [0x203f, 0x2040],
];

const enRangos = (c: number, rangos: readonly (readonly [number, number])[]) =>
  rangos.some(([desde, hasta]) => c >= desde && c <= hasta);

/** PHP lanza `DOMException` (INVALID_CHARACTER_ERR) con un nombre que no es un Name de XML. */
function validarNombre(nombre: string): void {
  let primero = true;
  let valido = nombre !== '';
  for (const caracter of nombre) {
    const c = caracter.codePointAt(0) ?? 0;
    valido &&= enRangos(c, INICIO_NOMBRE) || (!primero && enRangos(c, RESTO_NOMBRE));
    primero = false;
  }
  if (!valido) throw new SiiError(`Nombre XML inválido: ${JSON.stringify(nombre)}`);
}

// ---------------------------------------------------------------------------
// Serialización (DOMDocument::saveXML)
// ---------------------------------------------------------------------------

type ModoSalida = 'iso-8859-1' | 'utf-8' | 'sin-declarar';

function modoDeEncoding(encoding: string): Exclude<ModoSalida, 'sin-declarar'> {
  const nombre = encoding.toUpperCase();
  if (nombre === 'UTF-8' || nombre === 'UTF8') return 'utf-8';
  if (['ISO-8859-1', 'ISO_8859-1', 'ISO-LATIN-1', 'LATIN1', 'L1'].includes(nombre)) {
    return 'iso-8859-1';
  }
  throw new SiiError(`Encoding XML no soportado: ${encoding} (solo UTF-8 e ISO-8859-1)`);
}

export interface OpcionesSerializacion {
  /** `$doc->formatOutput = true`. Por defecto `false`, como en PHP. */
  formatear?: boolean;
}

/**
 * `$doc->saveXML()`: bytes exactos en la codificación del documento, con la
 * declaración y el salto de línea final (ver el encabezado del archivo para las
 * reglas de escape y formato).
 *
 * Lanza {@link SiiError} si un documento sin encoding declarado tiene en un
 * texto un carácter que XML 1.0 no admite (control C0 distinto de `\t` `\n`
 * `\r`, U+FFFE, U+FFFF o un surrogate suelto): libxml lo reporta y descarta el
 * texto entero en silencio, cosa que aquí no se replica.
 */
export function serializarXml(doc: Document, opciones: OpcionesSerializacion = {}): Buffer {
  if (doc.nodeType !== NODO_DOCUMENTO) throw new SiiError('serializarXml espera un Document');
  const declaracion = declaracionXml(doc);
  const modo =
    declaracion.encoding === undefined ? 'sin-declarar' : modoDeEncoding(declaracion.encoding);

  let salida = `<?xml version=${entreComillas(bytesWtf8(declaracion.version))}`;
  if (declaracion.encoding !== undefined) {
    salida += ` encoding=${entreComillas(bytesWtf8(declaracion.encoding))}`;
  }
  if (declaracion.standalone !== undefined) salida += ` standalone="${declaracion.standalone}"`;
  salida += '?>\n';

  const serializador = new Serializador(modo);
  for (let hijo = doc.firstChild; hijo !== null; hijo = hijo.nextSibling) {
    if (hijo.nodeType === NODO_TEXTO || hijo.nodeType === NODO_DOCTYPE) continue;
    if (hijo.nodeType === NODO_PI && (hijo as ProcessingInstruction).target === 'xml') continue;
    serializador.nodo(hijo, 0, opciones.formatear === true);
    serializador.partes.push('\n');
  }
  salida += serializador.partes.join('');

  return modo === 'iso-8859-1' ? wtf8AIso(salida) : Buffer.from(salida, 'latin1');
}

/**
 * Recorre el árbol. Igual que libxml, trabaja sobre el UTF-8 del contenido:
 * cada `string` de `partes` es "binario" (un carácter por byte, 0–255) y el
 * paso final lo convierte a la codificación de salida.
 */
class Serializador {
  readonly partes: string[] = [];
  readonly #modo: ModoSalida;

  constructor(modo: ModoSalida) {
    this.#modo = modo;
  }

  nodo(nodo: Node, nivel: number, formato: boolean): void {
    switch (nodo.nodeType) {
      case NODO_ELEMENTO:
        this.#elemento(nodo as Element, nivel, formato);
        return;
      case NODO_TEXTO:
        this.partes.push(this.#texto(bytesWtf8((nodo as Text).data)));
        return;
      case NODO_CDATA:
        this.#cdata(bytesWtf8((nodo as CDATASection).data));
        return;
      case NODO_REFERENCIA_ENTIDAD:
        this.partes.push(`&${bytesWtf8(nodo.nodeName)};`);
        return;
      case NODO_PI: {
        const pi = nodo as ProcessingInstruction;
        const datos = pi.data === '' && !piConDatosVacios.has(pi) ? '' : ` ${pi.data}`;
        this.partes.push(bytesWtf8(`<?${pi.target}${datos}?>`));
        return;
      }
      case NODO_COMENTARIO:
        this.partes.push(bytesWtf8(`<!--${(nodo as Comment).data}-->`));
        return;
      default:
        throw new SiiError(`serializarXml: tipo de nodo no soportado (${nodo.nodeType})`);
    }
  }

  #elemento(elemento: Element, nivel: number, formato: boolean): void {
    const nombre = bytesWtf8(elemento.nodeName);
    let apertura = `<${nombre}`;

    // libxml guarda las declaraciones de namespace aparte (nsDef) y las escribe primero.
    const atributos = elemento.attributes;
    for (let i = 0; i < atributos.length; i++) {
      const atributo = atributos.item(i);
      if (atributo?.namespaceURI !== XMLNS || atributo.name === 'xmlns:xml') continue;
      apertura += ` ${bytesWtf8(atributo.name)}=${entreComillas(bytesWtf8(atributo.value))}`;
    }
    for (let i = 0; i < atributos.length; i++) {
      const atributo = atributos.item(i);
      if (atributo === null || atributo.namespaceURI === XMLNS) continue;
      apertura += ` ${bytesWtf8(atributo.name)}="${this.#atributo(bytesWtf8(atributo.value))}"`;
    }

    if (elemento.firstChild === null) {
      this.partes.push(`${apertura}/>`);
      return;
    }

    let formatoHijos = formato;
    for (
      let hijo: ChildNode | null = elemento.firstChild;
      formatoHijos && hijo !== null;
      hijo = hijo.nextSibling
    ) {
      const tipo = hijo.nodeType;
      if (tipo === NODO_TEXTO || tipo === NODO_CDATA || tipo === NODO_REFERENCIA_ENTIDAD) {
        formatoHijos = false;
      }
    }

    this.partes.push(formatoHijos ? `${apertura}>\n` : `${apertura}>`);
    for (let hijo: ChildNode | null = elemento.firstChild; hijo !== null; hijo = hijo.nextSibling) {
      if (formatoHijos) this.partes.push(sangria(nivel + 1));
      this.nodo(hijo, nivel + 1, formatoHijos);
      if (formatoHijos) this.partes.push('\n');
    }
    if (formatoHijos) this.partes.push(sangria(nivel));
    this.partes.push(`</${nombre}>`);
  }

  #cdata(datos: string): void {
    // Igual que xmlsave.c: cada `]]>` cierra una sección y abre otra.
    if (datos === '') {
      this.partes.push('<![CDATA[]]>');
      return;
    }
    let inicio = 0;
    let fin = 0;
    while (fin < datos.length) {
      if (datos.startsWith(']]>', fin)) {
        fin += 2;
        this.partes.push(`<![CDATA[${datos.slice(inicio, fin)}]]>`);
        inicio = fin;
      }
      fin++;
    }
    if (inicio !== fin) this.partes.push(`<![CDATA[${datos.slice(inicio)}]]>`);
  }

  /** Texto: `xmlEscapeContent` con encoding declarado, `xmlEscapeEntities` sin él. */
  #texto(b: string): string {
    if (this.#modo !== 'sin-declarar') {
      return b
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('\r', '&#13;');
    }

    let salida = '';
    for (let i = 0; i < b.length; ) {
      const c = b.charCodeAt(i);
      if (c === 0x3c) salida += '&lt;';
      else if (c === 0x3e) salida += '&gt;';
      else if (c === 0x26) salida += '&amp;';
      else if ((c >= 0x20 && c < 0x80) || c === 0x0a || c === 0x09) salida += b[i];
      else if (c === 0x0d) salida += '&#xD;';
      else if (c >= 0x80) {
        const { codigo, largo } = leerUtf8(b, i);
        if (!esCaracterXml(codigo)) throw caracterNoSerializable(codigo);
        salida += referenciaHex(codigo);
        i += largo;
        continue;
      } else throw caracterNoSerializable(c);
      i++;
    }
    return salida;
  }

  /** Valor de atributo: `xmlBufAttrSerializeTxtContent`. */
  #atributo(b: string): string {
    let salida = '';
    const n = b.length;
    for (let i = 0; i < n; ) {
      const c = b.charCodeAt(i);
      if (c === 0x0a) salida += '&#10;';
      else if (c === 0x0d) salida += '&#13;';
      else if (c === 0x09) salida += '&#9;';
      else if (c === 0x22) salida += '&quot;';
      else if (c === 0x3c) salida += '&lt;';
      else if (c === 0x3e) salida += '&gt;';
      else if (c === 0x26) salida += '&amp;';
      else if (c >= 0x80 && i + 1 < n && this.#modo === 'sin-declarar') {
        // Copia fiel de libxml, incluido cómo trata lo que no es UTF-8 válido:
        // cada byte suelto sale como `&#xHH;`.
        let codigo = 0;
        let largo = 1;
        const b1 = b.charCodeAt(i + 1) & 0x3f;
        if (c < 0xc0) {
          largo = 1;
        } else if (c < 0xe0) {
          codigo = ((c & 0x1f) << 6) | b1;
          largo = 2;
        } else if (c < 0xf0 && i + 2 < n) {
          codigo = ((c & 0x0f) << 12) | (b1 << 6) | (b.charCodeAt(i + 2) & 0x3f);
          largo = 3;
        } else if (c < 0xf8 && i + 3 < n) {
          codigo =
            ((c & 0x07) << 18) |
            (b1 << 12) |
            ((b.charCodeAt(i + 2) & 0x3f) << 6) |
            (b.charCodeAt(i + 3) & 0x3f);
          largo = 4;
        }
        if (largo === 1 || !esCaracterXml(codigo)) {
          salida += referenciaHex(c);
          i++;
          continue;
        }
        salida += referenciaHex(codigo);
        i += largo;
        continue;
      } else salida += b[i];
      i++;
    }
    return salida;
  }
}

/** `xmlBufWriteQuotedString`: sin escapar; comillas simples si el valor trae `"`. */
function entreComillas(valor: string): string {
  if (!valor.includes('"')) return `"${valor}"`;
  if (!valor.includes("'")) return `'${valor}'`;
  return `"${valor.replaceAll('"', '&quot;')}"`;
}

function sangria(nivel: number): string {
  return '  '.repeat(Math.min(nivel, NIVELES_MAXIMOS));
}

function referenciaHex(codigo: number): string {
  return `&#x${codigo.toString(16).toUpperCase()};`;
}

/** Production `Char` de XML 1.0 (`IS_CHAR` de libxml). */
function esCaracterXml(c: number): boolean {
  return (
    c === 0x09 ||
    c === 0x0a ||
    c === 0x0d ||
    (c >= 0x20 && c <= 0xd7ff) ||
    (c >= 0xe000 && c <= 0xfffd) ||
    (c >= 0x10000 && c <= 0x10ffff)
  );
}

function caracterNoSerializable(codigo: number): SiiError {
  const hex = codigo.toString(16).toUpperCase().padStart(4, '0');
  return new SiiError(
    `serializarXml: el carácter U+${hex} no es válido en XML 1.0 (libxml descartaría el texto)`,
  );
}

/**
 * UTF-8 del texto como string "binario" (un carácter por byte). Un surrogate
 * suelto se codifica con sus 3 bytes (WTF-8), igual que libxml guarda un
 * `&#xD800;` leído por `createElement`.
 */
function bytesWtf8(texto: string): string {
  if (!/[\uD800-\uDFFF]/.test(texto)) return Buffer.from(texto, 'utf8').toString('latin1');
  let salida = '';
  for (const caracter of texto) {
    const c = caracter.codePointAt(0) ?? 0;
    if (c >= 0xd800 && c <= 0xdfff) {
      salida += String.fromCharCode(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    } else {
      salida += Buffer.from(caracter, 'utf8').toString('latin1');
    }
  }
  return salida;
}

function leerUtf8(b: string, i: number): { codigo: number; largo: number } {
  const c = b.charCodeAt(i);
  const continuacion = (k: number) => b.charCodeAt(i + k) & 0x3f;
  if (c >= 0xf0) {
    return {
      codigo:
        ((c & 0x07) << 18) | (continuacion(1) << 12) | (continuacion(2) << 6) | continuacion(3),
      largo: 4,
    };
  }
  if (c >= 0xe0) {
    return { codigo: ((c & 0x0f) << 12) | (continuacion(1) << 6) | continuacion(2), largo: 3 };
  }
  if (c >= 0xc0) return { codigo: ((c & 0x1f) << 6) | continuacion(1), largo: 2 };
  return { codigo: c, largo: 1 };
}

/**
 * Paso final del encoder ISO-8859-1 de libxml: lo que cabe en un byte sale tal
 * cual; el resto, como referencia decimal `&#N;`.
 */
function wtf8AIso(b: string): Buffer {
  const bytes: number[] = [];
  for (let i = 0; i < b.length; ) {
    const { codigo, largo } = leerUtf8(b, i);
    if (codigo <= 0xff) {
      bytes.push(codigo);
    } else {
      for (const digito of `&#${codigo};`) bytes.push(digito.charCodeAt(0));
    }
    i += largo;
  }
  return Buffer.from(bytes);
}
