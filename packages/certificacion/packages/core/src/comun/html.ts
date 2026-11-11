// Parser HTML que arma el mismo árbol de elementos que `DOMDocument::loadHTML()`
// de PHP (el parser HTML de libxml 2.10, no uno HTML5). Lo usan los asistentes
// web del SII (folios y postulación), que leen los <form> de cada página y
// reenvían sus campos: un campo de más o de menos cambia lo que se envía al SII.
//
// Reemplaza a `DOMDocument::loadHTML('<?xml encoding="UTF-8">' . $html,
// LIBXML_NOERROR | LIBXML_NOWARNING)` de winex/certificacion v1.9.1
// (src/Folios/SolicitudFolios.php y src/Postulacion/NavegadorSii.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript.
//
// Por qué no parse5: un parser HTML5 repara el HTML roto de otra forma que libxml
// (p. ej. un <form> dentro de <table> o un </form> dentro de una celda), y las
// páginas del SII son HTML antiguo. Las reglas de abajo se sacaron de libxml
// 2.10.4 probando cada caso con PHP; los casos `html-form-*` de paridad las
// comparan contra el PHP.
//
// Solo se arma el árbol de ELEMENTOS con sus atributos (lo único que leen los
// asistentes). El texto, los comentarios y las instrucciones de proceso se saltan.
//
// Reglas de libxml que se replican:
// - Nombres de etiqueta y de atributo en minúsculas (solo ASCII). Un atributo
//   repetido conserva el primero.
// - Elementos vacíos: area, base, basefont, br, col, frame, hr, img, input,
//   isindex, link, meta, param (`embed` no). `<x/>` cierra cualquier elemento.
// - <script> y <style> son texto crudo hasta `</` seguido de una letra. Esa
//   etiqueta de cierre se procesa como cualquier otra (un `</td>` dentro de un
//   script cierra la celda), y si el script sigue abierto, sigue el texto crudo.
//   <textarea> y <title> NO son texto crudo.
// - Cierre automático al abrir: una etiqueta nueva cierra el elemento actual
//   mientras este esté en su lista (`CIERRA_AL_ABRIR`, p. ej. <form> cierra un
//   <form>, <p> o <ul> abierto; <td> cierra <td>, <p>, <b>...). Solo mira el
//   elemento actual: un <form> dentro de un <td> no cierra el <form> de afuera.
// - Cierre explícito `</x>`: si `x` no está abierto, se ignora. Si está, cierra
//   todo lo que haya encima, salvo que encima haya un elemento de mayor prioridad
//   (div 150, td/th 160, tr 170, thead/tbody/tfoot 180, table 190, head/body 200,
//   html 220, el resto 100): entonces se ignora. Por eso un `</form>` dentro de
//   una celda no cierra el formulario, y un `</td>` sí.
// - <html>, <head> y <body> implícitos; un <html>/<head>/<body> repetido se
//   ignora, y también el cierre que le corresponde.
// - Atributos: valor entre comillas o sin comillas (termina en un blanco o `>`;
//   `/` es parte del valor). Un nombre de atributo inválido descarta todo hasta
//   el siguiente blanco o el fin de la etiqueta (así `<input name="x"<b>` se lee
//   como un solo input). Referencias: `&nombre;` de HTML 4 (más `&apos;`), `;`
//   obligatorio; `&#N;` / `&#xH;` con `;` opcional. Una referencia numérica a un
//   carácter que XML no permite (`&#0;`, `&#1;`, `&#xD800;`...) TRUNCA el valor
//   ahí: libxml escribe un byte NUL y el string de C termina.
// - <meta> con charset (`<meta charset="...">` o `http-equiv="Content-Type"` +
//   `content="...; charset=..."`): el PRIMERO que nombra una codificación la
//   fija, y todo lo que sigue a esa etiqueta se vuelve a decodificar con ella (una
//   desconocida no cambia nada, pero también deja la codificación fijada). El PHP
//   le entrega a libxml la página ya en UTF-8 (y antepone `<?xml
//   encoding="UTF-8">`, que no lo impide): con un `charset=iso-8859-1`, libxml lee
//   esos bytes UTF-8 como ISO-8859-1 y los valores con tildes salen doblemente
//   codificados (`Ñ` → `Ã‘`). Así los envía el PHP al SII, y Node los envía igual
//   (paridad; ver `#revisarMeta` y el caso html-form-codificacion).

import { minusculasAscii } from './codificacion.ts';
import { decodificarEntidadesHtml, ENTIDADES_HTML401 } from './entidades-html.ts';

/** Elemento HTML del árbol (sin nodos de texto). */
export interface ElementoHtml {
  /** Nombre en minúsculas (`#documento` para la raíz). */
  readonly nombre: string;
  /** Atributos en orden, nombres en minúsculas. Un atributo sin valor vale `''`. */
  readonly atributos: ReadonlyMap<string, string>;
  readonly hijos: readonly ElementoHtml[];
}

interface Nodo extends ElementoHtml {
  readonly atributos: Map<string, string>;
  readonly hijos: Nodo[];
}

const VACIOS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'basefont',
  'br',
  'col',
  'frame',
  'hr',
  'img',
  'input',
  'isindex',
  'link',
  'meta',
  'param',
]);

const TEXTO_CRUDO: ReadonlySet<string> = new Set(['script', 'style']);

const H = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'];

/**
 * Etiqueta nueva → elementos que cierra si son el elemento actual. Medido con
 * libxml 2.10.4 (cada par `<viejo><nuevo>` probado con PHP); `head` se agrega
 * donde lo pone la tabla `htmlStartClose` de libxml (en el cuerpo no se puede medir).
 */
const CIERRA_AL_ABRIR: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  (
    [
      ['a', ['a', 'head']],
      ['address', ['p', 'ul', 'head']],
      ['blockquote', ['p', 'head']],
      ['body', ['head', 'style', 'script', 'title']],
      ['caption', ['p']],
      ['center', ['b', 'font', 'i', 'p', 'head']],
      ['col', ['caption', 'p']],
      ['colgroup', ['caption', 'colgroup', 'p']],
      ['dd', ['address', 'dir', 'dt', 'menu', 'p', 'pre', 'listing', 'xmp', 'head']],
      ['dir', ['p', 'head']],
      ['div', ['p', 'head']],
      ['dl', ['address', 'dir', 'dt', 'menu', 'p', 'pre', 'listing', 'xmp', 'head']],
      ['dt', ['address', 'dd', 'dir', 'menu', 'p', 'pre', 'listing', 'xmp', 'head']],
      ['fieldset', ['a', ...H, 'legend', 'p', 'pre', 'listing', 'xmp', 'head']],
      [
        'form',
        [
          'address',
          'dir',
          'dl',
          'form',
          ...H,
          'menu',
          'ol',
          'p',
          'pre',
          'ul',
          'listing',
          'xmp',
          'head',
        ],
      ],
      ['frameset', ['p', 'title', 'head', 'style', 'script']],
      ...H.map((h) => [h, ['p', 'head']] as [string, string[]]),
      ['head', ['p']],
      ['hr', ['p', 'head']],
      ['li', ['address', 'dl', ...H, 'li', 'p', 'pre', 'listing', 'xmp', 'head']],
      ['listing', ['p', 'head']],
      ['menu', ['p', 'ul', 'head']],
      ['noscript', ['script']],
      ['ol', ['p', 'ul', 'head']],
      ['optgroup', ['option']],
      ['option', ['option']],
      ['p', ['b', 'big', ...H, 'i', 'p', 's', 'small', 'strike', 'tt', 'u', 'head']],
      ['pre', ['p', 'ul', 'head']],
      ['table', ['a', ...H, 'p', 'pre', 'listing', 'xmp', 'head']],
      ['tbody', ['caption', 'colgroup', 'p', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr']],
      ['td', ['a', 'b', 'font', 'i', 'p', 'span', 'td', 'th', 'u']],
      ['tfoot', ['caption', 'colgroup', 'p', 'tbody', 'td', 'th', 'thead', 'tr']],
      ['th', ['a', 'b', 'font', 'i', 'p', 'span', 'td', 'th', 'u']],
      ['thead', ['caption', 'colgroup']],
      ['title', ['p']],
      ['tr', ['caption', 'colgroup', 'p', 'td', 'th', 'tr']],
      ['ul', ['address', 'dir', 'menu', 'ol', 'p', 'pre', 'listing', 'xmp', 'head']],
      ['xmp', ['p', 'head']],
      ...[
        'tt',
        'i',
        'b',
        'u',
        's',
        'strike',
        'big',
        'small',
        'em',
        'strong',
        'dfn',
        'code',
        'samp',
        'kbd',
        'var',
        'cite',
        'abbr',
        'acronym',
        'img',
        'font',
        'br',
        'map',
        'q',
        'sub',
        'sup',
        'span',
        'bdo',
        'iframe',
      ].map((t) => [t, ['head']] as [string, string[]]),
    ] as [string, string[]][]
  ).map(([nuevo, viejos]) => [nuevo, new Set(viejos)] as const),
);

const PRIORIDAD_CIERRE: ReadonlyMap<string, number> = new Map([
  ['div', 150],
  ['td', 160],
  ['th', 160],
  ['tr', 170],
  ['thead', 180],
  ['tbody', 180],
  ['tfoot', 180],
  ['table', 190],
  ['head', 200],
  ['body', 200],
  ['html', 220],
]);

function prioridad(nombre: string): number {
  return PRIORIDAD_CIERRE.get(nombre) ?? 100;
}

/** Elementos que libxml pone en un <head> implícito (si todavía no hay cuerpo). */
const DE_HEAD: ReadonlySet<string> = new Set(['script', 'style', 'meta', 'link', 'title', 'base']);

function esBlanco(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r';
}

function esLetra(c: string | undefined): boolean {
  return c !== undefined && ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'));
}

/** Primer carácter de un nombre HTML para libxml (`htmlParseHTMLName`). */
function iniciaNombre(c: string | undefined): boolean {
  return esLetra(c) || c === '_' || c === ':' || c === '.';
}

function sigueNombre(c: string | undefined): boolean {
  return iniciaNombre(c) || c === '-' || (c !== undefined && c >= '0' && c <= '9');
}

/** Carácter permitido por XML (`IS_CHAR` de libxml). */
function esCaracterXml(codigo: number): boolean {
  return (
    codigo === 0x9 ||
    codigo === 0xa ||
    codigo === 0xd ||
    (codigo >= 0x20 && codigo <= 0xd7ff) ||
    (codigo >= 0xe000 && codigo <= 0xfffd) ||
    (codigo >= 0x10000 && codigo <= 0x10ffff)
  );
}

/** Nombre de entidad para `htmlParseName` (reglas de nombre XML, simplificadas). */
const NOMBRE_ENTIDAD = /^[A-Za-z_:\u0080-￿][A-Za-z0-9._:\-\u0080-￿]*/;

class Parser {
  #s: string;
  /** Ya hubo un <meta> que fijó la codificación (los siguientes se ignoran). */
  #codificacionFijada = false;
  #i = 0;
  readonly raiz: Nodo = { nombre: '#documento', atributos: new Map(), hijos: [] };
  readonly #pila: Nodo[] = [];
  /** `ctxt->html` de libxml: 3 si ya hubo <head>, 10 si ya hubo <body>. */
  #visto = 0;
  /** `ctxt->depth`: cuántos <html>/<head>/<body> repetidos se ignoraron. */
  #ignorados = 0;

  constructor(html: string) {
    this.#s = html;
  }

  get #actual(): Nodo | undefined {
    return this.#pila.at(-1);
  }

  parsear(): Nodo {
    // Sin guardar this.#s en una constante: un <meta> con charset lo reemplaza a mitad de camino.
    for (;;) {
      const s = this.#s;
      if (this.#i >= s.length) break;
      const actual = this.#actual;
      if (actual !== undefined && TEXTO_CRUDO.has(actual.nombre)) {
        // Texto crudo hasta `</` + letra; esa etiqueta se procesa normalmente.
        const fin = this.#buscarFinCrudo();
        if (fin < 0) {
          this.#i = s.length;
          break;
        }
        this.#i = fin;
        this.#cierre();
        continue;
      }

      const lt = s.indexOf('<', this.#i);
      if (lt < 0) break;
      this.#i = lt;
      const sig = s[lt + 1];

      if (s.startsWith('<!--', lt)) {
        const fin = s.indexOf('-->', lt + 4);
        this.#i = fin < 0 ? s.length : fin + 3;
      } else if (sig === '!' || sig === '?') {
        // <!DOCTYPE ...>, <?xml ...?> y similares: hasta el siguiente `>`.
        const fin = s.indexOf('>', lt + 2);
        this.#i = fin < 0 ? s.length : fin + 1;
      } else if (sig === '/') {
        this.#cierre();
      } else if (esLetra(sig)) {
        this.#apertura();
      } else {
        // `<` suelto: es texto.
        this.#i = lt + 1;
      }
    }
    return this.raiz;
  }

  #buscarFinCrudo(): number {
    const s = this.#s;
    let desde = this.#i;
    for (;;) {
      const j = s.indexOf('</', desde);
      if (j < 0) return -1;
      if (esLetra(s[j + 2])) return j;
      desde = j + 2;
    }
  }

  #leerNombre(): string | null {
    const s = this.#s;
    if (!iniciaNombre(s[this.#i])) return null;
    const inicio = this.#i;
    while (this.#i < s.length && sigueNombre(s[this.#i])) this.#i++;
    return minusculasAscii(s.slice(inicio, this.#i));
  }

  #saltarBlancos(): void {
    while (esBlanco(this.#s[this.#i])) this.#i++;
  }

  #finDeEtiqueta(): boolean {
    const c = this.#s[this.#i];
    return c === undefined || c === '>' || (c === '/' && this.#s[this.#i + 1] === '>');
  }

  // --- etiqueta de apertura --------------------------------------------------

  #apertura(): void {
    const s = this.#s;
    this.#i++; // '<'
    const nombre = this.#leerNombre();
    if (nombre === null) return; // no pasa: se llamó con una letra

    const atributos = new Map<string, string>();
    this.#saltarBlancos();
    while (!this.#finDeEtiqueta()) {
      const atributo = this.#leerAtributo();
      if (atributo === null) {
        // Nombre inválido: se descarta hasta el siguiente blanco o el fin de la etiqueta.
        while (!this.#finDeEtiqueta() && !esBlanco(s[this.#i])) this.#i++;
      } else if (!atributos.has(atributo[0])) {
        atributos.set(atributo[0], atributo[1]);
      }
      this.#saltarBlancos();
    }

    let autocerrado = false;
    if (s[this.#i] === '/' && s[this.#i + 1] === '>') {
      autocerrado = true;
      this.#i += 2;
    } else if (s[this.#i] === '>') {
      this.#i++;
    } else {
      // Se acabó el documento dentro de la etiqueta: libxml crea el elemento con
      // lo que alcanzó a leer y lo cierra.
      autocerrado = true;
    }

    this.#abrir(nombre, atributos, autocerrado);
  }

  /** [nombre, valor] o null si no hay un nombre válido. */
  #leerAtributo(): [string, string] | null {
    const s = this.#s;
    const nombre = this.#leerNombre();
    if (nombre === null) return null;
    this.#saltarBlancos();
    if (s[this.#i] !== '=') return [nombre, ''];
    this.#i++;
    this.#saltarBlancos();

    const comilla = s[this.#i];
    if (comilla === '"' || comilla === "'") {
      this.#i++;
      const valor = this.#leerValor(comilla);
      if (s[this.#i] === comilla) this.#i++;
      return [nombre, valor];
    }
    return [nombre, this.#leerValor(null)];
  }

  /** `htmlParseHTMLAttribute`: hasta la comilla, o (sin comillas) hasta un blanco o `>`. */
  #leerValor(comilla: string | null): string {
    const s = this.#s;
    let salida = '';
    let truncado = false;
    const poner = (texto: string): void => {
      if (!truncado) salida += texto;
    };

    while (this.#i < s.length) {
      const c = s[this.#i] as string;
      if (comilla !== null ? c === comilla : c === '>' || esBlanco(c)) break;

      if (c !== '&') {
        poner(c);
        this.#i++;
        continue;
      }

      if (s[this.#i + 1] === '#') {
        const codigo = this.#leerReferenciaNumerica();
        if (esCaracterXml(codigo)) poner(String.fromCodePoint(codigo));
        else truncado = true; // libxml escribe un NUL: el valor termina aquí
        continue;
      }

      // &nombre; (el `;` es obligatorio y solo se consume si la entidad existe)
      this.#i++;
      const m = NOMBRE_ENTIDAD.exec(s.slice(this.#i, this.#i + 64));
      if (m === null) {
        poner('&');
        continue;
      }
      const nombre = m[0];
      this.#i += nombre.length;
      const valor = s[this.#i] === ';' ? ENTIDADES_HTML_LIBXML.get(nombre) : undefined;
      if (valor === undefined) {
        poner(`&${nombre}`);
      } else {
        poner(valor);
        this.#i++;
      }
    }
    return salida;
  }

  /** `htmlParseCharRef`: `&#N` / `&#xH` con `;` opcional. Devuelve 0 si no es válida. */
  #leerReferenciaNumerica(): number {
    const s = this.#s;
    const hex = s[this.#i + 2] === 'x' || s[this.#i + 2] === 'X';
    this.#i += hex ? 3 : 2;
    let valor = 0;
    const digitos = hex ? /[0-9a-fA-F]/ : /[0-9]/;
    while (this.#i < s.length && s[this.#i] !== ';') {
      const c = s[this.#i] as string;
      if (!digitos.test(c)) break; // falta el `;`: termina la referencia
      valor = Math.min(valor * (hex ? 16 : 10) + Number.parseInt(c, 16), 0x110000);
      this.#i++;
    }
    if (s[this.#i] === ';') this.#i++;
    return valor;
  }

  #abrir(nombre: string, atributos: Map<string, string>, autocerrado: boolean): void {
    // htmlAutoClose: la etiqueta nueva cierra el elemento actual mientras pueda.
    const cierra = CIERRA_AL_ABRIR.get(nombre);
    if (cierra !== undefined) {
      for (let actual = this.#actual; actual !== undefined && cierra.has(actual.nombre); ) {
        this.#pila.pop();
        actual = this.#actual;
      }
    }

    this.#implicitos(nombre);

    // <html>, <head> y <body> fuera de lugar se ignoran (y su cierre también).
    if (
      (nombre === 'html' && this.#pila.length > 0) ||
      (nombre === 'head' && this.#pila.length !== 1) ||
      (nombre === 'body' && this.#pila.some((n) => n.nombre === 'body'))
    ) {
      this.#ignorados++;
      return;
    }

    if (nombre === 'meta') this.#revisarMeta(atributos);

    const nodo: Nodo = { nombre, atributos, hijos: [] };
    (this.#actual ?? this.raiz).hijos.push(nodo);
    if (nombre === 'head' && this.#visto < 3) this.#visto = 3;
    if (nombre === 'body' && this.#visto < 10) this.#visto = 10;
    if (!autocerrado && !VACIOS.has(nombre)) this.#pila.push(nodo);
  }

  /** htmlCheckMeta: un <meta> con charset fija la codificación del resto del documento. */
  #revisarMeta(atributos: ReadonlyMap<string, string>): void {
    const candidatos: string[] = [];
    let httpEquiv = false;
    let content: string | undefined;
    for (const [nombre, valor] of atributos) {
      if (nombre === 'http-equiv' && minusculasAscii(valor) === 'content-type') httpEquiv = true;
      else if (nombre === 'charset') candidatos.push(valor);
      else if (nombre === 'content') content = valor;
    }
    if (httpEquiv && content !== undefined) {
      // htmlCheckEncoding: lo que sigue a "charset" (y a un "=") hasta el final.
      const i = minusculasAscii(content).indexOf('charset');
      if (i >= 0) {
        let resto = content.slice(i + 7);
        if (/^[ \t\n\r]/.test(resto)) {
          const igual = resto.indexOf('=');
          resto = igual < 0 ? '' : resto.slice(igual);
        }
        if (resto.startsWith('=')) candidatos.push(resto.slice(1));
      }
    }

    for (const candidato of candidatos) {
      if (this.#codificacionFijada) return;
      const nombre = candidato.replace(/^[ \t]+/, '');
      const decodificar = decodificador(nombre);
      // Una codificación desconocida no cambia nada, pero igual la deja fijada
      // (libxml ignora los <meta> siguientes; caso html-form-codificacion).
      this.#codificacionFijada = true;
      if (decodificar !== null && decodificar !== undefined) {
        this.#s =
          this.#s.slice(0, this.#i) + decodificar(Buffer.from(this.#s.slice(this.#i), 'utf8'));
      }
    }
  }

  /** htmlCheckImplied: <html>, <head> y <body> implícitos. */
  #implicitos(nombre: string): void {
    if (nombre === 'html') return;
    if (this.#pila.length === 0) this.#empujar('html');
    if (nombre === 'body' || nombre === 'head') return;
    if (this.#pila.length <= 1 && DE_HEAD.has(nombre)) {
      if (this.#visto >= 3) return;
      this.#empujar('head');
    } else if (nombre !== 'noframes' && nombre !== 'frame' && nombre !== 'frameset') {
      if (this.#visto >= 10) return;
      if (this.#pila.some((n) => n.nombre === 'body' || n.nombre === 'head')) return;
      this.#empujar('body');
    }
  }

  #empujar(nombre: string): void {
    const nodo: Nodo = { nombre, atributos: new Map(), hijos: [] };
    (this.#actual ?? this.raiz).hijos.push(nodo);
    this.#pila.push(nodo);
    if (nombre === 'head' && this.#visto < 3) this.#visto = 3;
    if (nombre === 'body' && this.#visto < 10) this.#visto = 10;
  }

  // --- etiqueta de cierre ------------------------------------------------------

  #cierre(): void {
    const s = this.#s;
    this.#i += 2; // '</'
    const nombre = this.#leerNombre();
    if (nombre === null) return; // `</` sin nombre: el resto es texto
    this.#saltarBlancos();
    if (s[this.#i] !== '>') {
      const fin = s.indexOf('>', this.#i);
      this.#i = fin < 0 ? s.length : fin;
    }
    if (s[this.#i] === '>') this.#i++;

    if (this.#ignorados > 0 && (nombre === 'html' || nombre === 'body' || nombre === 'head')) {
      this.#ignorados--;
      return;
    }

    // htmlAutoCloseOnClose: un cierre fuera de lugar solo cierra elementos de
    // prioridad menor o igual; si encuentra uno mayor antes, se ignora.
    const p = prioridad(nombre);
    let i = this.#pila.length - 1;
    for (; i >= 0; i--) {
      const abierto = (this.#pila[i] as Nodo).nombre;
      if (abierto === nombre) break;
      if (prioridad(abierto) > p) return;
    }
    if (i < 0) return;
    this.#pila.length = i;
  }
}

/**
 * Entidades con nombre que libxml reconoce en HTML: las 252 de HTML 4.01 más
 * `&apos;` (que `html_entity_decode` con ENT_HTML401 no decodifica, pero libxml sí).
 */
const ENTIDADES_HTML_LIBXML: ReadonlyMap<string, string> = new Map([
  ...ENTIDADES_HTML401,
  ['apos', "'"],
]);

const LATIN1: ReadonlySet<string> = new Set([
  'iso-8859-1',
  'iso8859-1',
  'iso_8859-1',
  'latin1',
  'latin-1',
  'l1',
  'cp819',
  'ibm819',
  'us-ascii',
  'ascii',
]);

/**
 * Cómo decodificar los bytes (UTF-8 del PHP) que siguen a un <meta> con esa
 * codificación: `null` = UTF-8 (no cambia nada); `undefined` =
 * desconocida (tampoco cambia nada). ISO-8859-1 y ASCII se leen byte a byte (no con
 * `TextDecoder`, que para esas etiquetas usa windows-1252); el resto, con las
 * etiquetas de `TextDecoder`, que cubren las de iconv que pueden aparecer
 * (windows-1252, iso-8859-15...).
 */
function decodificador(nombre: string): ((bytes: Buffer) => string) | null | undefined {
  const n = minusculasAscii(nombre);
  if (n === 'utf-8' || n === 'utf8') return null;
  if (LATIN1.has(n)) return (bytes) => bytes.toString('latin1');
  try {
    const decoder = new TextDecoder(n);
    if (decoder.encoding === 'utf-8') return null;
    return (bytes) => decoder.decode(bytes);
  } catch {
    return undefined;
  }
}

/** Arma el árbol de elementos de `html` como `DOMDocument::loadHTML()` (libxml 2.10). */
export function parsearHtml(html: string): ElementoHtml {
  return new Parser(html).parsear();
}

/** Descendientes con ese nombre, en orden de documento (`getElementsByTagName`). */
export function elementosPorNombre(raiz: ElementoHtml, nombre: string): ElementoHtml[] {
  const salida: ElementoHtml[] = [];
  const recorrer = (nodo: ElementoHtml): void => {
    for (const hijo of nodo.hijos) {
      if (hijo.nombre === nombre) salida.push(hijo);
      recorrer(hijo);
    }
  };
  recorrer(raiz);
  return salida;
}

/** `getAttribute()`: el valor, o `''` si no está. */
export function atributo(elemento: ElementoHtml, nombre: string): string {
  return elemento.atributos.get(nombre) ?? '';
}

/**
 * Texto visible de una página, para los mensajes de error: quita etiquetas y
 * comentarios (`strip_tags`), decodifica entidades, colapsa los blancos y recorta
 * a `max` caracteres. Con `sinScripts`, antes quita los <script> y <style> con su
 * contenido (como `NavegadorSii::texto()`; `SolicitudFolios::mensajeSii()` no lo hace).
 *
 * Solo para mensajes: nunca se envía al SII. Diferencias con el PHP, a propósito
 * y sin efecto en lo que se envía: decodifica las entidades de HTML 4.01 (más
 * `&apos;`) y no la tabla completa de HTML5 (`ENT_HTML5`), y quita las etiquetas
 * con una regla simple (el `strip_tags` de PHP tiene más casos borde).
 */
export function textoHtml(
  html: string,
  max = 300,
  opciones: { sinScripts?: boolean } = {},
): string {
  let texto = html;
  if (opciones.sinScripts === true) texto = texto.replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ');
  texto = texto.replace(/<!--[\s\S]*?(?:-->|$)/g, '').replace(/<[A-Za-z/!?][^>]*(?:>|$)/g, '');
  texto = decodificarEntidadesHtml(texto.replace(/&apos;/g, "'"));
  texto = texto.replace(/[ \t\n\r\v\f]+/g, ' ').replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, '');
  return [...texto].slice(0, max).join('');
}
