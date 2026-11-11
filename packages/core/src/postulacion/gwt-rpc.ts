// Lo mínimo de GWT-RPC (protocolo 7) para hablar con `certBolElectDteInternet`,
// el portal de la declaración de cumplimiento de boletas.
//
// Deriva de winex/certificacion v1.9.1 (src/Postulacion/GwtRpc.php y
// src/Postulacion/LectorGwt.php), © 2026 Meniaz (William Menares), Apache-2.0.
// Modificado: port a TypeScript, escritura, lectura y lector en un solo archivo.
//
// Lo que se envía al SII (el cuerpo de `llamada()`) es idéntico al PHP, rarezas
// incluidas; lo comparan los casos `gwt-llamada-*` (PLAN §5.1). En particular:
// - `long` usa `BigInt` (PLAN §2 y §9): en JS `<<`/`>>` son de 32 bits y el PHP
//   trabaja con enteros de 64 bits con signo.
// - Defecto del PHP replicado por paridad (cambiarlo cambia bytes enviados: decide
//   el usuario, PLAN §1 principio 3): `long()` con un valor negativo no escribe la
//   extensión de signo que espera GWT. -1 sale como un token vacío, -2 como `$`
//   (que GWT lee como 62), etc. Los positivos y Long.MIN_VALUE salen bien.
//
// Cambios respecto del PHP (solo con entradas que el SII real no produce o con
// errores de programación; no cambian bytes enviados con respuestas bien formadas):
// - Números de la respuesta sin truncar en silencio (PLAN §4): el PHP hace
//   `(int) "1.5"` → 1 y satura los enteros de más de 64 bits. Aquí un número
//   decimal o fuera del rango seguro de JS (2^53) que se lee como entero lanza
//   `ErrorPostulacion` "mal formada"; un Long numérico se conserva exacto con
//   `BigInt` hasta 64 bits y fuera de eso también lanza.
// - Un Long en base64 con caracteres fuera del alfabeto de GWT lanza (el PHP los
//   tomaba como 0). Uno de más de 11 caracteres se desborda como en el PHP (y en
//   Java): 64 bits envolventes.
// - Tokens del tipo equivocado (un texto donde va un número, una tabla de strings
//   que no es una lista, una referencia a un objeto que todavía se está leyendo)
//   lanzan "mal formada". El PHP seguía con valores a medias (`(int) "abc"` → 0,
//   `['@tipo' => ...]` sin campos) que después rompían `valor()`.
// - Un texto de la respuesta que no es UTF-8 válido lanza (el PHP lo reenviaba tal
//   cual en una petición declarada UTF-8).
// - En el detalle de un `//EX`, `\xHH` y los octales de `stripcslashes` dan el
//   carácter U+00HH (el PHP metía el byte suelto, UTF-8 inválido). Solo afecta al
//   mensaje de error. `\uXXXX` queda como `uXXXX`, igual que `stripcslashes`.
// - La escritura valida sus entradas (enteros seguros, Long de 64 bits, textos sin
//   surrogates sueltos, forma de los objetos de `valor()`) antes de escribir.

import { truncarCodePoints } from '../comun/codificacion.ts';
import { ErrorPostulacion } from '../comun/errores.ts';

const INTEGER = 'java.lang.Integer/3438268394';
const LONG = 'java.lang.Long/4227064769';
const STRING = 'java.lang.String/2004016611';
const ARRAY_LIST = 'java.util.ArrayList/4159755760';

const ALFABETO = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789$_';

const LONG_MIN = -(2n ** 63n);
const LONG_MAX = 2n ** 63n - 1n;
const SEGURO_MAX = BigInt(Number.MAX_SAFE_INTEGER);

const SURROGATE_SUELTO = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// --- Representación de los objetos ------------------------------------------------

/**
 * Campo de un DTO con esquema: `'S'` = declarado String, `'B'` = boolean (0/1),
 * `'O'` = objeto (o null).
 */
export type CampoGwt =
  | readonly ['S', string | null]
  | readonly ['B', number]
  | readonly ['O', ObjetoGwt | null];

export interface IntegerGwt {
  readonly '@tipo': typeof INTEGER;
  readonly valor: number;
}

/** java.lang.Long: el valor exacto, de 64 bits con signo. */
export interface LongGwt {
  readonly '@tipo': typeof LONG;
  readonly valor: bigint;
}

export interface StringGwt {
  readonly '@tipo': typeof STRING;
  readonly valor: string | null;
}

export interface ListaGwt {
  readonly '@tipo': typeof ARRAY_LIST;
  readonly elementos: readonly (ObjetoGwt | null)[];
}

/** DTO con esquema conocido: sus campos en orden de serialización. */
export interface DtoGwt {
  readonly '@tipo': string;
  readonly campos: readonly CampoGwt[];
}

/**
 * Objeto leído de una respuesta, como en el PHP: `@tipo` (la firma) y `valor`
 * (Integer/Long/String), `elementos` (ArrayList) o `campos` (DTO). Se distingue
 * por la propiedad presente (`'campos' in o`, ver {@link esDtoGwt}) y, entre los
 * que tienen `valor`, por `@tipo`. Se vuelve a escribir tal cual con
 * `GwtRpc#valor()`.
 */
export type ObjetoGwt = IntegerGwt | LongGwt | StringGwt | ListaGwt | DtoGwt;

/** Por firma de tipo, la clase de cada campo en orden (`'S'`, `'B'` u `'O'`). */
export type EsquemasGwt = Readonly<Record<string, string>>;

export function esDtoGwt(objeto: ObjetoGwt | null): objeto is DtoGwt {
  return objeto !== null && 'campos' in objeto;
}

export function esListaGwt(objeto: ObjetoGwt | null): objeto is ListaGwt {
  return objeto !== null && objeto['@tipo'] === ARRAY_LIST && 'elementos' in objeto;
}

// --- Escritura ---------------------------------------------------------------------

/** Un parámetro de `llamada()`: su firma de tipo y quien escribe su valor. */
export type ParametroGwt = readonly [firma: string, escribir: (w: GwtRpc) => void];

/**
 * Petición: `7|0|<n>|<tabla de strings>|<base>|<policy>|<servicio>|<metodo>|<nParams>|<tipos>|<valores>|`.
 * Los strings van por índice (1-based, 0 = null); un objeto va como índice de su
 * firma de tipo seguido de sus campos. Solo los Long de -128..127 se escriben
 * como back-reference la segunda vez (como el navegador); el resto de los objetos
 * repetidos van como instancias nuevas.
 *
 * Respuesta: `//OK[<payload>,[<tabla de strings>],0,7]` (o `//EX` si el servidor
 * lanzó). El payload se lee de atrás hacia adelante con {@link LectorGwt}.
 *
 * @internal
 */
export class GwtRpc {
  static readonly INTEGER = INTEGER;
  static readonly LONG = LONG;
  static readonly STRING = STRING;
  static readonly ARRAY_LIST = ARRAY_LIST;

  readonly #tabla = new Map<string, number>();
  readonly #tokens: string[] = [];
  /** Objetos escritos (sus ids son 1..n, para las back-references). */
  #objetos = 0;
  /** Valor de Long cacheado → id del objeto. */
  readonly #longsCacheados = new Map<bigint, number>();

  private constructor() {}

  /** Arma el cuerpo de una llamada (texto; se envía en UTF-8). */
  static llamada(
    base: string,
    policy: string,
    servicio: string,
    metodo: string,
    params: readonly ParametroGwt[],
  ): string {
    const w = new GwtRpc();

    for (const s of [base, policy, servicio, metodo]) {
      w.#tokens.push(String(w.#indice(s)));
    }

    w.#tokens.push(String(params.length));
    for (const [tipo] of params) {
      w.#tokens.push(String(w.#indice(tipo)));
    }
    for (const [, escribir] of params) {
      escribir(w);
    }

    const strings = [...w.#tabla.keys()].map(escapar);

    return `7|0|${strings.length}|${strings.join('|')}|${w.#tokens.join('|')}|`;
  }

  /** Campo/parámetro declarado String (va directo, sin firma de tipo). */
  string(valor: string | null): this {
    this.#tokens.push(valor === null ? '0' : String(this.#indice(valor)));
    return this;
  }

  int(valor: number): this {
    if (!Number.isSafeInteger(valor)) {
      throw new ErrorPostulacion(`GWT: ${String(valor)} no es un entero.`);
    }
    this.#tokens.push(String(valor));
    return this;
  }

  nulo(): this {
    this.#tokens.push('0');
    return this;
  }

  /** Campo declarado como objeto que lleva un java.lang.Integer. */
  integer(valor: number | null): this {
    if (valor === null) return this.nulo();
    if (!Number.isSafeInteger(valor)) {
      throw new ErrorPostulacion(`GWT: ${String(valor)} no es un entero.`);
    }
    return this.tipo(INTEGER).int(valor);
  }

  /**
   * Campo declarado como objeto que lleva un java.lang.Long (base64 de GWT).
   * Como Long.valueOf() en el cliente, -128..127 es la misma instancia: la
   * segunda vez va como back-reference (así lo manda el navegador).
   *
   * Ojo (defecto del PHP, replicado): los negativos no llevan la extensión de
   * signo; -1 sale como token vacío.
   */
  long(valor: bigint | number | null): this {
    if (valor === null) return this.nulo();

    const v = aLong(valor);
    const cacheado = this.#longsCacheados.get(v);
    if (cacheado !== undefined) {
      this.#tokens.push(String(-cacheado));
      return this;
    }

    this.tipo(LONG);
    this.#tokens.push(longBase64(v));

    if (v >= -128n && v <= 127n) {
      this.#longsCacheados.set(v, this.#objetos);
    }

    return this;
  }

  /** Inicio de un objeto: su firma de tipo. Los campos se escriben después, en orden. */
  tipo(firma: string): this {
    this.#objetos++;
    this.#tokens.push(String(this.#indice(firma)));
    return this;
  }

  /** Escribe un valor leído de una respuesta (ver {@link LectorGwt#objeto}) tal cual vino. */
  valor(valor: ObjetoGwt | null): this {
    this.#valor(valor);
    return this;
  }

  #valor(valor: unknown): void {
    if (valor === null) {
      this.nulo();
      return;
    }
    if (typeof valor !== 'object') throw noSeSabeEscribir();
    const objeto = valor as Record<string, unknown>;
    const tipo = objeto['@tipo'];
    if (typeof tipo !== 'string') throw noSeSabeEscribir();

    if (tipo === LONG) {
      const v = objeto.valor;
      if (typeof v !== 'bigint' && typeof v !== 'number') throw noSeSabeEscribir();
      this.long(v);
      return;
    }

    switch (tipo) {
      case INTEGER: {
        const v = objeto.valor;
        if (typeof v !== 'number') throw noSeSabeEscribir();
        this.tipo(tipo).int(v);
        return;
      }
      case STRING: {
        const v = objeto.valor;
        if (typeof v !== 'string' && v !== null) throw noSeSabeEscribir();
        this.tipo(tipo).string(v);
        return;
      }
      case ARRAY_LIST: {
        const elementos = objeto.elementos;
        if (!Array.isArray(elementos)) throw noSeSabeEscribir();
        this.tipo(tipo).int(elementos.length);
        for (const e of elementos) this.#valor(e);
        return;
      }
      default: {
        const campos = objeto.campos;
        if (!Array.isArray(campos)) throw noSeSabeEscribir();
        this.tipo(tipo);
        for (const campo of campos) {
          if (!Array.isArray(campo) || campo.length !== 2) throw noSeSabeEscribir();
          const [clase, v] = campo as [unknown, unknown];
          if (clase === 'S') {
            if (typeof v !== 'string' && v !== null) throw noSeSabeEscribir();
            this.string(v);
          } else if (clase === 'B') {
            if (typeof v !== 'number') throw noSeSabeEscribir();
            this.int(v);
          } else {
            this.#valor(v);
          }
        }
      }
    }
  }

  #indice(s: string): number {
    if (SURROGATE_SUELTO.test(s)) {
      throw new ErrorPostulacion(
        'GWT: texto con caracteres UTF-16 sueltos (no es Unicode válido).',
      );
    }
    let i = this.#tabla.get(s);
    if (i === undefined) {
      i = this.#tabla.size + 1;
      this.#tabla.set(s, i);
    }
    return i;
  }

  // --- Lectura -----------------------------------------------------------------------

  /**
   * Lee una respuesta. `esquemas`: por firma de tipo, la clase de cada campo en
   * orden de serialización. El valor de retorno se lee con `string()` si el
   * método declara String, o con `objeto()` en cualquier otro caso.
   *
   * @param respuesta el cuerpo tal como llegó (bytes UTF-8) o ya como texto.
   * @throws ErrorPostulacion si es un `//EX`, no es `//OK` o está mal formada.
   */
  static leer(respuesta: string | Uint8Array, esquemas: EsquemasGwt = {}): LectorGwt {
    for (const [firma, esquema] of Object.entries(esquemas)) {
      if (!/^[SBO]*$/.test(esquema)) {
        throw new ErrorPostulacion(
          `GWT: esquema inválido para ${firma} (${esquema}): solo se admiten S, B y O.`,
        );
      }
    }

    const bytes = trimBytes(
      typeof respuesta === 'string' ? Buffer.from(respuesta, 'utf8') : Buffer.from(respuesta),
    );
    const inicio = bytes.subarray(0, 4).toString('latin1');

    if (inicio === '//EX') {
      const detalle = detalleExcepcion(bytes.toString('utf8'));
      throw new ErrorPostulacion(
        `El servicio del SII respondió con un error.${detalle !== '' ? ` ${detalle}` : ''}`,
      );
    }
    if (inicio !== '//OK') {
      throw new ErrorPostulacion(
        `Respuesta inesperada del servicio del SII: ${truncarCodePoints(bytes.toString('utf8'), 200)}`,
      );
    }

    const datos = parsear(bytes.subarray(4));
    if (datos.tipo !== 'lista' || datos.elementos.length < 3) throw malFormada();

    const elementos = [...datos.elementos];
    elementos.pop(); // versión
    elementos.pop(); // flags
    const tabla = elementos.pop();
    if (tabla === undefined || tabla.tipo !== 'lista') throw malFormada();

    return new LectorGwt(elementos.reverse(), tabla.elementos, esquemas);
  }

  /**
   * Long en base64 de GWT a `bigint`: `(v << 6) | índice` con desborde envolvente
   * de 64 bits con signo, como el PHP y Java. Vacío → 0.
   *
   * @throws ErrorPostulacion con un carácter fuera del alfabeto (el PHP lo tomaba como 0).
   */
  static longDeBase64(s: string): bigint {
    let v = 0n;
    for (const ch of s) {
      const indice = ALFABETO.indexOf(ch);
      if (indice < 0) {
        throw new ErrorPostulacion('Respuesta GWT del SII mal formada (long).');
      }
      v = BigInt.asIntN(64, (v << 6n) | BigInt(indice));
    }
    return v;
  }

  /**
   * Long a base64 de GWT como lo escribe el PHP: dígitos de 6 bits con
   * desplazamiento aritmético hasta llegar a 0 o -1. Para los negativos no
   * escribe la extensión de signo (defecto del PHP, replicado por paridad):
   * -1 → `''`, -2 → `'$'`, -64 → `'A'`.
   */
  static longBase64(valor: bigint | number): string {
    let v = aLong(valor);
    if (v === 0n) return 'A';

    let s = '';
    while (v !== 0n && v !== -1n) {
      s = `${ALFABETO[Number(v & 63n)] as string}${s}`;
      v >>= 6n;
    }
    return s;
  }
}

function longBase64(v: bigint): string {
  return GwtRpc.longBase64(v);
}

function aLong(valor: bigint | number): bigint {
  if (typeof valor === 'number') {
    if (!Number.isSafeInteger(valor)) {
      throw new ErrorPostulacion(
        `GWT: ${String(valor)} no es un entero exacto (para un long grande usa bigint).`,
      );
    }
    return BigInt(valor);
  }
  if (typeof valor !== 'bigint' || valor < LONG_MIN || valor > LONG_MAX) {
    throw new ErrorPostulacion(`GWT: el long ${String(valor)} no cabe en 64 bits con signo.`);
  }
  return valor;
}

/** `strtr($s, ['\\' => '\\\\', '|' => '\\!', "\0" => '\\0'])`. */
function escapar(s: string): string {
  return s.replace(/[\\|\0]/g, (c) => (c === '\\' ? '\\\\' : c === '|' ? '\\!' : '\\0'));
}

function noSeSabeEscribir(): ErrorPostulacion {
  return new ErrorPostulacion('GWT: valor que no se sabe escribir.');
}

function malFormada(que?: string): ErrorPostulacion {
  return new ErrorPostulacion(`Respuesta GWT del SII mal formada${que ? ` (${que})` : ''}.`);
}

// --- Parser del "JSON de GWT" ---------------------------------------------------------

/**
 * Token de la respuesta. Los números conservan su texto (se convierten al leerlos,
 * sin truncar); `long` es un texto entre comillas simples (base64 de GWT).
 *
 * @internal
 */
export type TokenGwt =
  | { readonly tipo: 'numero'; readonly texto: string }
  | { readonly tipo: 'texto'; readonly valor: string }
  | { readonly tipo: 'long'; readonly valor: string }
  | { readonly tipo: 'lista'; readonly elementos: readonly TokenGwt[] };

const BLANCOS_TRIM = new Set([0x20, 0x09, 0x0a, 0x0d, 0x00, 0x0b]);

/** `trim()` de PHP sobre bytes. */
function trimBytes(b: Buffer): Buffer {
  let inicio = 0;
  let fin = b.length;
  while (inicio < fin && BLANCOS_TRIM.has(b[inicio] as number)) inicio++;
  while (fin > inicio && BLANCOS_TRIM.has(b[fin - 1] as number)) fin--;
  return b.subarray(inicio, fin);
}

/** `ctype_space()` de un byte: espacio, \t, \n, \v, \f, \r. */
function esBlanco(c: number | undefined): boolean {
  return c === 0x20 || (c !== undefined && c >= 0x09 && c <= 0x0d);
}

function esDigito(c: number | undefined): boolean {
  return c !== undefined && c >= 0x30 && c <= 0x39;
}

/** `hexdec()` de PHP: ignora lo que no es hexadecimal; vacío → 0. */
function hexdec(b: Buffer): number {
  const hex = b.toString('latin1').replace(/[^0-9a-fA-F]/g, '');
  return hex === '' ? 0 : Number.parseInt(hex, 16);
}

/** `mb_chr($cp, 'UTF-8')` en bytes: los surrogates (inválidos) no producen nada. */
function mbChr(cp: number): number[] {
  if (cp >= 0xd800 && cp <= 0xdfff) return [];
  return [...Buffer.from(String.fromCodePoint(cp), 'utf8')];
}

const UTF8_ESTRICTO = new TextDecoder('utf-8', { fatal: true });

/**
 * JSON de GWT: como JSON, pero los long van entre comillas simples y los strings
 * pueden traer `\x`. Recorre bytes, como el PHP. Lee un solo valor (lo que sigue
 * se ignora).
 */
function parsear(texto: Buffer): TokenGwt {
  let i = 0;
  const n = texto.length;

  const saltarBlancos = (): void => {
    while (i < n && esBlanco(texto[i])) i++;
  };

  const valor = (): TokenGwt => {
    saltarBlancos();
    const c = texto[i];

    if (c === 0x5b /* [ */) {
      i++;
      const lista: TokenGwt[] = [];
      while (true) {
        saltarBlancos();
        if (texto[i] === 0x5d /* ] */) {
          i++;
          return { tipo: 'lista', elementos: lista };
        }
        lista.push(valor());
        saltarBlancos();
        if (texto[i] === 0x2c /* , */) i++;
        if (i >= n) throw new ErrorPostulacion('Respuesta GWT del SII cortada.');
      }
    }

    if (c === 0x22 /* " */ || c === 0x27 /* ' */) {
      const cierre = c;
      i++;
      const s: number[] = [];
      while (i < n && texto[i] !== cierre) {
        if (texto[i] === 0x5c /* \ */ && i + 1 < n) {
          const e = texto[++i] as number;
          if (e === 0x75 /* u */) {
            s.push(...mbChr(hexdec(texto.subarray(i + 1, i + 5))));
            i += 4;
          } else if (e === 0x78 /* x */) {
            s.push(...mbChr(hexdec(texto.subarray(i + 1, i + 3))));
            i += 2;
          } else {
            s.push(
              e === 0x6e ? 0x0a : e === 0x74 ? 0x09 : e === 0x72 ? 0x0d : e === 0x30 ? 0x00 : e,
            );
          }
        } else {
          s.push(texto[i] as number);
        }
        i++;
      }
      i++;

      let decodificado: string;
      try {
        decodificado = UTF8_ESTRICTO.decode(Uint8Array.from(s));
      } catch {
        throw malFormada('texto que no es UTF-8');
      }
      return cierre === 0x27
        ? { tipo: 'long', valor: decodificado }
        : { tipo: 'texto', valor: decodificado };
    }

    // /-?\d+(\.\d+)?/A
    let j = i;
    if (texto[j] === 0x2d /* - */) j++;
    if (esDigito(texto[j])) {
      while (esDigito(texto[j])) j++;
      if (texto[j] === 0x2e /* . */ && esDigito(texto[j + 1])) {
        j++;
        while (esDigito(texto[j])) j++;
      }
      const numero = texto.subarray(i, j).toString('latin1');
      i = j;
      return { tipo: 'numero', texto: numero };
    }

    throw malFormada();
  };

  return valor();
}

/** Mensaje entre paréntesis para un `//EX`, como `GwtRpc::detalleExcepcion()`. */
function detalleExcepcion(respuesta: string): string {
  if (respuesta.includes('IncompatibleRemoteServiceException')) {
    return '(el SII actualizó el portal de boletas: hay que volver a capturar la versión de GWT)';
  }

  // PCRE sin /s: `.` es cualquier byte salvo \n.
  for (const m of respuesta.matchAll(/"((?:[^"\\]|\\[^\n])*)"/g)) {
    const s = m[1] as string;
    if (!s.includes('/') && !s.startsWith('java.')) {
      return `(SII: ${truncarCodePoints(stripcslashes(s), 300)})`;
    }
  }

  return '';
}

const ESCAPES_C: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  a: '\x07',
  t: '\t',
  v: '\v',
  b: '\b',
  f: '\f',
  '\\': '\\',
};

/**
 * `stripcslashes()` de PHP. `\xHH` (1–2 dígitos) y los octales (1–3 dígitos, módulo
 * 256) dan el carácter U+00HH (el PHP da el byte suelto). Cualquier otro `\c` → `c`
 * (también `\u`); una `\` final queda.
 */
export function stripcslashes(s: string): string {
  let r = '';
  const n = s.length;
  for (let i = 0; i < n; i++) {
    const c = s[i] as string;
    if (c !== '\\' || i + 1 >= n) {
      r += c;
      continue;
    }
    i++;
    const e = s[i] as string;
    const simple = ESCAPES_C[e];
    if (simple !== undefined) {
      r += simple;
      continue;
    }
    if (e === 'x' && /^[0-9a-fA-F]$/.test(s[i + 1] ?? '')) {
      let hex = s[++i] as string;
      if (/^[0-9a-fA-F]$/.test(s[i + 1] ?? '')) hex += s[++i] as string;
      r += String.fromCharCode(Number.parseInt(hex, 16));
      continue;
    }
    let oct = '';
    while (i < n && oct.length < 3 && /^[0-7]$/.test(s[i] as string)) oct += s[i++] as string;
    if (oct !== '') {
      r += String.fromCharCode(Number.parseInt(oct, 8) & 0xff);
      i--;
    } else {
      r += e;
    }
  }
  return r;
}

// --- Lector ------------------------------------------------------------------------

const EN_LECTURA = Symbol('en lectura');

/**
 * Lee el payload (ya invertido) de una respuesta GWT-RPC.
 *
 * Un objeto se devuelve como {@link ObjetoGwt}: así se puede volver a escribir tal
 * cual con `GwtRpc#valor()`. Una back-reference devuelve una copia del objeto ya
 * leído (como los arreglos del PHP, que se copian por valor).
 *
 * @internal Se obtiene con `GwtRpc.leer()`.
 */
export class LectorGwt {
  #pos = 0;
  /** Objetos leídos, para las back-references. */
  readonly #objetos: (ObjetoGwt | typeof EN_LECTURA)[] = [];
  readonly #tokens: readonly TokenGwt[];
  readonly #tabla: readonly TokenGwt[];
  readonly #esquemas: EsquemasGwt;

  constructor(tokens: readonly TokenGwt[], tabla: readonly TokenGwt[], esquemas: EsquemasGwt) {
    this.#tokens = tokens;
    this.#tabla = tabla;
    this.#esquemas = esquemas;
  }

  /** El valor de retorno es null (sin leerlo: sirve para DTO sin esquema conocido). */
  esNulo(): boolean {
    const t = this.#tokens[this.#pos];
    return t !== undefined && t.tipo === 'numero' && /^-?0+$/.test(t.texto);
  }

  string(): string | null {
    const i = this.#entero(this.#token(), 'string');

    if (i < 0 || i > this.#tabla.length) throw malFormada('string');
    if (i === 0) return null;

    const s = this.#tabla[i - 1];
    if (s === undefined || s.tipo !== 'texto') throw malFormada('string');
    return s.valor;
  }

  objeto(): ObjetoGwt | null {
    const token = this.#token();
    if (token.tipo === 'numero' && /^-?0+$/.test(token.texto)) return null;

    const t = this.#entero(token, 'objeto');
    if (t > this.#tabla.length) throw malFormada('objeto');
    if (t < 0) {
      const previo = this.#objetos[-t - 1];
      if (previo === undefined) throw malFormada('referencia');
      if (previo === EN_LECTURA) throw malFormada('referencia circular');
      return structuredClone(previo);
    }

    const entrada = this.#tabla[t - 1];
    if (entrada === undefined || entrada.tipo !== 'texto') throw malFormada('objeto');
    const firma = entrada.valor;

    const id = this.#objetos.length;
    this.#objetos.push(EN_LECTURA);

    let objeto: ObjetoGwt;
    switch (firma) {
      case INTEGER:
        objeto = { '@tipo': INTEGER, valor: this.#int() };
        break;

      case LONG:
        objeto = { '@tipo': LONG, valor: this.#long() };
        break;

      case STRING:
        objeto = { '@tipo': STRING, valor: this.string() };
        break;

      case ARRAY_LIST: {
        const elementos: (ObjetoGwt | null)[] = [];
        for (let n = this.#int(), k = 0; k < n; k++) elementos.push(this.objeto());
        objeto = { '@tipo': ARRAY_LIST, elementos };
        break;
      }

      default: {
        if (!Object.hasOwn(this.#esquemas, firma)) {
          throw new ErrorPostulacion(
            `El SII respondió un tipo no esperado (${firma}); pudo haber cambiado el portal.`,
          );
        }
        const campos: CampoGwt[] = [];
        for (const clase of this.#esquemas[firma] as string) {
          if (clase === 'S') campos.push(['S', this.string()]);
          else if (clase === 'B') campos.push(['B', this.#int()]);
          else campos.push(['O', this.objeto()]);
        }
        objeto = { '@tipo': firma, campos };
      }
    }

    this.#objetos[id] = objeto;
    return objeto;
  }

  #int(): number {
    return this.#entero(this.#token(), 'entero');
  }

  #long(): bigint {
    const l = this.#token();
    if (l.tipo === 'long') return GwtRpc.longDeBase64(l.valor);
    if (l.tipo === 'numero') {
      if (!/^-?\d+$/.test(l.texto)) throw noEntero('long', l.texto);
      const v = BigInt(l.texto);
      if (v < LONG_MIN || v > LONG_MAX) throw fueraDeRango('long', l.texto);
      return v;
    }
    throw malFormada('long');
  }

  /** Un token numérico entero y exacto (sin truncar decimales ni pasar de 2^53). */
  #entero(token: TokenGwt, que: string): number {
    if (token.tipo !== 'numero') throw malFormada(que);
    if (!/^-?\d+$/.test(token.texto)) throw noEntero(que, token.texto);
    const v = BigInt(token.texto);
    if (v > SEGURO_MAX || v < -SEGURO_MAX) throw fueraDeRango(que, token.texto);
    return Number(v);
  }

  #token(): TokenGwt {
    const t = this.#tokens[this.#pos];
    if (t === undefined) throw new ErrorPostulacion('Respuesta GWT del SII cortada.');
    this.#pos++;
    return t;
  }
}

function noEntero(que: string, texto: string): ErrorPostulacion {
  return new ErrorPostulacion(
    `Respuesta GWT del SII mal formada (${que}: ${texto} no es un número entero).`,
  );
}

function fueraDeRango(que: string, texto: string): ErrorPostulacion {
  return new ErrorPostulacion(
    `Respuesta GWT del SII mal formada (${que}: ${texto} fuera de rango).`,
  );
}
