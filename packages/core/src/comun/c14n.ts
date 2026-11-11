// C14N 1.0 inclusivo, sin comentarios: equivale byte a byte a `DOMNode::C14N()`
// de PHP (libxml2) con los argumentos por defecto, incluido el caso de un
// subárbol (`<Documento>`, `<SetDTE>`, `<DocumentoConsumoFolios>`).
//
// Implementación propia y no `xml-crypto`: validada contra libxml con los golden
// tests `paridad/casos/c14n-*.json` (PLAN-MIGRACION.md §2, fila C14N). Al
// canonicalizar un elemento E, PHP evalúa el conjunto de nodos
// `(.//. | .//@* | .//namespace::*)` desde E, y libxml lo serializa así:
//
// - En el ápice E se emiten TODOS los namespaces en ámbito (heredados de los
//   ancestros, usados o no), salvo `xml` y salvo un `xmlns=""`.
// - En un descendiente solo se emite una declaración si su valor difiere del que
//   ya está en ámbito en el padre (las redeclaraciones redundantes desaparecen).
//   `xmlns=""` se emite solo si el padre tenía un namespace por defecto no vacío.
// - Los atributos `xml:*` de los ancestros (xml:lang, xml:space, xml:base) se
//   heredan al ápice si E no los tiene; gana el del ancestro más cercano.
// - Orden: namespaces con el por defecto primero y luego por prefijo; atributos
//   sin namespace primero y luego por URI del namespace y nombre local. Todo se
//   compara por bytes UTF-8 (`xmlStrcmp`), no por unidades UTF-16.
// - Comentarios: no se emiten. CDATA: como texto escapado. Elementos vacíos:
//   `<a></a>`. PIs dentro del subárbol: `<?destino datos?>`.
// - Si algún elemento del documento (aunque esté fuera del subárbol) declara un
//   namespace con URI relativa o inválida, libxml falla: aquí se lanza ErrorFirma.
//
// El árbol debe venir de parsear el XML (las declaraciones de namespace se leen
// de los atributos `xmlns`/`xmlns:p`, como los deja @xmldom/xmldom). El parser
// tiene que haber aplicado las reglas de XML 1.0: fin de línea `\r\n`/`\r` → `\n`
// (U+0085 y U+2028 NO son saltos de línea en XML 1.0) y blancos de atributos
// normalizados a espacio. Como libxml, cada `&` del valor de un `xmlns`/`xmlns:p`
// debe quedar como el texto `&#38;` (lo hace `parsearDocumento` de xml.ts).

import { ErrorFirma } from './errores.ts';

const NS_XML = 'http://www.w3.org/XML/1998/namespace';

// Tipos de nodo del DOM (en Node no existe la global `Node` en tiempo de ejecución).
const ELEMENTO = 1;
const TEXTO = 3;
const CDATA = 4;
const INSTRUCCION = 7;
const DOCUMENTO = 9;

/** Prefijo → URI de los namespaces en ámbito. El prefijo '' es el namespace por defecto. */
type Namespaces = ReadonlyMap<string, string>;

interface AtributoCanonico {
  nombre: string;
  valor: string;
  /** URI del namespace del atributo ('' si no tiene). */
  ns: string;
  local: string;
}

/**
 * Canonicaliza un elemento (y su subárbol) con C14N 1.0 inclusivo sin
 * comentarios, igual que `$elemento->C14N()` en PHP. Sirve tanto para la raíz
 * como para cualquier elemento interno: el ápice recibe los namespaces y los
 * atributos `xml:*` heredados de sus ancestros.
 */
export function c14n(elemento: Element): string {
  validarNamespacesDelDocumento(elemento);

  const ancestros: Element[] = [];
  for (let n = elemento.parentNode; n !== null && n.nodeType === ELEMENTO; n = n.parentNode) {
    ancestros.push(n as Element);
  }

  // Namespaces en ámbito en el padre del ápice: se acumulan desde la raíz.
  let enAmbitoPadre: Namespaces = new Map();
  for (let i = ancestros.length - 1; i >= 0; i--) {
    enAmbitoPadre = conDeclaraciones(ancestros[i] as Element, enAmbitoPadre);
  }

  const salida: string[] = [];
  // Ningún ancestro se emite, así que para el ápice no hay nada "ya renderizado".
  escribirElemento(elemento, enAmbitoPadre, new Map(), xmlHeredados(ancestros), salida);
  return salida.join('');
}

/**
 * Busca el elemento como `$dom->getElementsByTagName($etiqueta)->item($indice)`
 * de PHP 8.3: recorre el documento en orden (incluida la raíz) y compara el
 * nombre LOCAL, en cualquier namespace (`p:Documento` también calza con
 * `Documento`).
 */
export function elementoPorEtiqueta(
  nodo: Document | Element,
  etiqueta: string,
  indice = 0,
): Element | undefined {
  const doc = nodo.nodeType === DOCUMENTO ? (nodo as Document) : nodo.ownerDocument;
  let restantes = indice;
  let encontrado: Element | undefined;
  recorrerElementos(doc ?? nodo, (el) => {
    if (nombreLocal(el.nodeName) !== etiqueta) return true;
    if (restantes-- > 0) return true;
    encontrado = el;
    return false;
  });
  return encontrado;
}

/**
 * Canonicaliza el elemento `<etiqueta>` número `indice` del documento, como
 * hace `FirmaElectronica::firmarDte` para calcular el DigestValue
 * (`getElementsByTagName($tag)->item(0)->C14N()`).
 */
export function c14nPorEtiqueta(nodo: Document | Element, etiqueta: string, indice = 0): string {
  const elemento = elementoPorEtiqueta(nodo, etiqueta, indice);
  if (elemento === undefined) {
    throw new ErrorFirma(`No se encontró el nodo ${etiqueta} para aplicar la firma.`);
  }
  return c14n(elemento);
}

function escribirElemento(
  el: Element,
  enAmbitoPadre: Namespaces,
  renderizados: Namespaces,
  heredados: readonly AtributoCanonico[],
  salida: string[],
): void {
  const enAmbito = conDeclaraciones(el, enAmbitoPadre);
  const nombre = el.nodeName;
  salida.push('<', nombre);

  // Las URIs de namespace se escriben SIN escapar, como `xmlC14NPrintNamespaces`
  // (ya se validó que son URIs: no traen comillas, `<` ni blancos). libxml
  // guarda cada `&` de una URI como el texto `&#38;` al parsear, y así sale.
  //
  // Namespace por defecto: '' equivale a "sin namespace por defecto".
  const porDefecto = enAmbito.get('') ?? '';
  if (porDefecto !== (renderizados.get('') ?? '')) {
    salida.push(' xmlns="', porDefecto, '"');
  }

  const prefijos: string[] = [];
  for (const [prefijo, uri] of enAmbito) {
    if (prefijo === '' || prefijo === 'xml') continue;
    if (renderizados.get(prefijo) !== uri) prefijos.push(prefijo);
  }
  prefijos.sort(compararUtf8);
  for (const prefijo of prefijos) {
    salida.push(' xmlns:', prefijo, '="', enAmbito.get(prefijo) ?? '', '"');
  }

  const atributos: AtributoCanonico[] = [];
  for (const attr of Array.from(el.attributes)) {
    if (esDeclaracion(attr.name)) continue;
    atributos.push(atributoCanonico(attr.name, attr.value, enAmbito));
  }
  for (const h of heredados) {
    if (!atributos.some((a) => a.ns === h.ns && a.local === h.local)) atributos.push(h);
  }
  atributos.sort(compararAtributos);
  for (const a of atributos) {
    salida.push(' ', a.nombre, '="', escaparAtributo(a.valor), '"');
  }
  salida.push('>');

  for (let hijo = el.firstChild; hijo !== null; hijo = hijo.nextSibling) {
    switch (hijo.nodeType) {
      case ELEMENTO:
        escribirElemento(hijo as Element, enAmbito, enAmbito, [], salida);
        break;
      case TEXTO:
      case CDATA:
        salida.push(escaparTexto((hijo as CharacterData).data));
        break;
      case INSTRUCCION: {
        const pi = hijo as ProcessingInstruction;
        salida.push('<?', pi.target);
        if (pi.data !== '') salida.push(' ', pi.data.replaceAll('\r', '&#xD;'));
        salida.push('?>');
        break;
      }
      // Comentarios (C14N sin comentarios) y cualquier otro nodo: no se emiten.
    }
  }

  salida.push('</', nombre, '>');
}

/** Namespaces en ámbito tras aplicar las declaraciones `xmlns`/`xmlns:p` del elemento. */
function conDeclaraciones(el: Element, base: Namespaces): Namespaces {
  let resultado: Map<string, string> | undefined;
  for (const attr of Array.from(el.attributes)) {
    if (!esDeclaracion(attr.name)) continue;
    resultado ??= new Map(base);
    resultado.set(attr.name === 'xmlns' ? '' : attr.name.slice('xmlns:'.length), attr.value);
  }
  return resultado ?? base;
}

/**
 * Atributos `xml:*` de los ancestros que hereda el ápice (C14N 1.0, §2.4): el
 * más cercano gana; los que el ápice ya tiene se descartan al escribirlo.
 */
function xmlHeredados(ancestros: readonly Element[]): AtributoCanonico[] {
  const heredados: AtributoCanonico[] = [];
  for (const ancestro of ancestros) {
    for (const attr of Array.from(ancestro.attributes)) {
      if (!attr.name.startsWith('xml:')) continue;
      const local = attr.name.slice('xml:'.length);
      if (heredados.some((h) => h.local === local)) continue;
      heredados.push({ nombre: attr.name, valor: attr.value, ns: NS_XML, local });
    }
  }
  return heredados;
}

function atributoCanonico(nombre: string, valor: string, enAmbito: Namespaces): AtributoCanonico {
  const dosPuntos = nombre.indexOf(':');
  if (dosPuntos < 0) return { nombre, valor, ns: '', local: nombre };
  const prefijo = nombre.slice(0, dosPuntos);
  const ns = prefijo === 'xml' ? NS_XML : enAmbito.get(prefijo);
  // Prefijo no declarado: libxml deja el atributo sin namespace con el nombre completo.
  if (ns === undefined || ns === '') return { nombre, valor, ns: '', local: nombre };
  return { nombre, valor, ns, local: nombre.slice(dosPuntos + 1) };
}

/** Orden de `xmlC14NAttrsCompare`: sin namespace primero; luego URI y nombre local. */
function compararAtributos(a: AtributoCanonico, b: AtributoCanonico): number {
  if (a.ns === b.ns) return compararUtf8(a.local, b.local);
  if (a.ns === '') return -1;
  if (b.ns === '') return 1;
  return compararUtf8(a.ns, b.ns) || compararUtf8(a.local, b.local);
}

/** Compara como `xmlStrcmp` sobre UTF-8, es decir, por punto de código. */
function compararUtf8(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const ca = a.codePointAt(i) ?? 0;
    const cb = b.codePointAt(j) ?? 0;
    if (ca !== cb) return ca - cb;
    i += ca > 0xffff ? 2 : 1;
    j += cb > 0xffff ? 2 : 1;
  }
  return a.length - i - (b.length - j);
}

function esDeclaracion(nombre: string): boolean {
  return nombre === 'xmlns' || nombre.startsWith('xmlns:');
}

function nombreLocal(nombre: string): string {
  return nombre.slice(nombre.indexOf(':') + 1);
}

/** Recorre los elementos en orden de documento; `visitar` devuelve false para detenerse. */
function recorrerElementos(raiz: Node, visitar: (el: Element) => boolean): boolean {
  for (let n = raiz.firstChild; n !== null; n = n.nextSibling) {
    if (n.nodeType !== ELEMENTO) continue;
    if (!visitar(n as Element) || !recorrerElementos(n, visitar)) return false;
  }
  return true;
}

// URI absoluta según RFC 3986 (aproximación de `xmlParseURI` con esquema
// obligatorio): `esquema:` seguido de `//autoridad` y ruta, o de una ruta
// (puede ser vacía); luego `?consulta` y `#fragmento` opcionales.
const PCT = '%[0-9A-Fa-f]{2}';
const PCHAR = `(?:[A-Za-z0-9\\-._~!$&'()*+,;=:@]|${PCT})`;
const AUTORIDAD =
  `(?:(?:[A-Za-z0-9\\-._~!$&'()*+,;=:]|${PCT})*@)?` +
  `(?:\\[[A-Za-z0-9\\-._~!$&'()*+,;=:]+\\]|(?:[A-Za-z0-9\\-._~!$&'()*+,;=]|${PCT})*)(?::[0-9]*)?`;
const URI_ABSOLUTA = new RegExp(
  `^[A-Za-z][A-Za-z0-9+.-]*:(?://${AUTORIDAD}(?:/${PCHAR}*)*|(?!//)(?:${PCHAR}|/)*)` +
    `(?:\\?(?:${PCHAR}|[/?])*)?(?:#(?:${PCHAR}|[/?])*)?$`,
);

/**
 * libxml revisa las declaraciones de namespace de TODOS los elementos del
 * documento (no solo del subárbol) y falla si alguna URI no vacía es relativa o
 * no es una URI válida (`xmlC14NCheckForRelativeNamespaces`).
 */
function validarNamespacesDelDocumento(elemento: Element): void {
  const raiz: Node = elemento.ownerDocument ?? raizDe(elemento);
  const revisar = (el: Element): boolean => {
    for (const attr of Array.from(el.attributes)) {
      if (!esDeclaracion(attr.name) || attr.value === '') continue;
      if (!URI_ABSOLUTA.test(attr.value)) {
        throw new ErrorFirma(
          `No se puede canonicalizar el XML: el namespace "${attr.value}" no es una URI absoluta.`,
        );
      }
    }
    return true;
  };
  if (raiz.nodeType === ELEMENTO) revisar(raiz as Element);
  recorrerElementos(raiz, revisar);
}

function raizDe(nodo: Node): Node {
  let n = nodo;
  while (n.parentNode !== null) n = n.parentNode;
  return n;
}

/** Escape de texto de C14N: `&`, `<`, `>` y `\r`. */
function escaparTexto(texto: string): string {
  return texto.replace(/[&<>\r]/g, (c) => ESCAPES_TEXTO[c] ?? c);
}

/** Escape de atributos de C14N: `&`, `<`, `"`, tab, `\n` y `\r` (`>` queda tal cual). */
function escaparAtributo(valor: string): string {
  return valor.replace(/[&<"\t\n\r]/g, (c) => ESCAPES_ATRIBUTO[c] ?? c);
}

const ESCAPES_TEXTO: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '\r': '&#xD;',
};

const ESCAPES_ATRIBUTO: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '"': '&quot;',
  '\t': '&#x9;',
  '\n': '&#xA;',
  '\r': '&#xD;',
};
