// Deriva de winex/certificacion v1.9.1 (src/Folios/SesionSii.php), © 2026 Meniaz
// (William Menares), Apache-2.0. Modificado: port a TypeScript; reloj inyectable
// para `expires`; las cookies no se ven al inspeccionar ni al serializar el objeto.

import { inspect } from 'node:util';
import { minusculasAscii, trimPhp } from '../comun/codificacion.ts';
import type { RespuestaHttp } from '../comun/http/respuesta.ts';
import { type Reloj, relojSistema } from '../comun/reloj.ts';

/**
 * Cookie guardada. Los nombres de los campos son los del PHP (`toArray()`), así
 * una sesión guardada por el PHP se carga igual en Node y viceversa.
 */
export interface CookieSii {
  readonly name: string;
  readonly value: string;
  /** Dominio en minúsculas, sin punto inicial. */
  readonly domain: string;
  /** `true`: solo para ese host exacto (vino sin atributo `Domain`). */
  readonly host_only: boolean;
}

/** `is_numeric()` de PHP 8 sobre un string ya recortado. */
function esNumericoPhp(texto: string): boolean {
  return /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/.test(texto);
}

function hostDeUrl(url: string | URL): string {
  try {
    return (typeof url === 'string' ? new URL(url) : url).hostname;
  } catch {
    return '';
  }
}

/**
 * Cookies de la sesión AUT2000 del contribuyente en los hosts *.sii.cl.
 *
 * ES UNA CREDENCIAL: con estas cookies se timbran folios sin el certificado. Si
 * quien llama la guarda (`aArreglo` / `desdeArreglo`, para no volver a
 * autenticar en cada solicitud: el SII frena el re-login seguido), tiene que
 * guardarla cifrada. `console.log`, `util.inspect` y `JSON.stringify` no
 * muestran las cookies.
 */
export class SesionSii {
  readonly #cookies = new Map<string, CookieSii>();
  readonly #reloj: Reloj;

  constructor(opciones: { reloj?: Reloj } = {}) {
    this.#reloj = opciones.reloj ?? relojSistema;
  }

  /**
   * Sesión desde lo que entregó `aArreglo()` (o `toArray()` del PHP). Ignora las
   * entradas sin `name`, `value` o `domain`, como el PHP.
   */
  static desdeArreglo(
    cookies: readonly Partial<CookieSii>[],
    opciones: { reloj?: Reloj } = {},
  ): SesionSii {
    const sesion = new SesionSii(opciones);
    for (const c of cookies) {
      if (c === null || typeof c !== 'object') continue;
      const { name, value, domain } = c;
      if (name === undefined || name === null || value === undefined || value === null) continue;
      if (domain === undefined || domain === null) continue;
      sesion.#poner(String(name), String(value), String(domain), Boolean(c.host_only ?? false));
    }
    return sesion;
  }

  /** Las cookies, para guardarlas (cifradas). */
  aArreglo(): CookieSii[] {
    return [...this.#cookies.values()].map((c) => ({ ...c }));
  }

  /** Si hay una cookie con ese nombre y valor no vacío. */
  tiene(nombre: string): boolean {
    return this.valor(nombre) !== null;
  }

  /** Valor de la primera cookie con ese nombre (null si no está o está vacía). */
  valor(nombre: string): string | null {
    for (const c of this.#cookies.values()) {
      if (c.name === nombre && c.value !== '') return c.value;
    }
    return null;
  }

  /** Valor de la cabecera `Cookie` para una URL (null si no corresponde ninguna). */
  cabeceraPara(url: string | URL): string | null {
    const host = hostDeUrl(url);
    const pares: string[] = [];
    for (const c of this.#cookies.values()) {
      const aplica = c.host_only
        ? host === c.domain
        : host === c.domain || host.endsWith(`.${c.domain}`);
      if (aplica) pares.push(`${c.name}=${c.value}`);
    }
    return pares.length === 0 ? null : pares.join('; ');
  }

  /** Guarda las `Set-Cookie` de una respuesta de `url`. */
  recibir(url: string | URL, respuesta: RespuestaHttp): void {
    const host = hostDeUrl(url);
    for (const linea of respuesta.cabecera('set-cookie')) this.#aplicar(linea, host, false);
  }

  /**
   * El cuerpo de CAutInicio.cgi pone las NETSCAPE_LIVEWIRE.* por JavaScript
   * (`document.cookie = "..."`): se replican aquí, para el dominio sii.cl.
   *
   * @param html el cuerpo tal como llegó; para no alterar bytes, decodifícalo
   *   como latin1 (un byte = un carácter), igual que las cabeceras.
   */
  recibirDesdeHtml(html: string): void {
    for (const m of html.matchAll(/document\.cookie\s*=\s*["']([^"']+)["']/gi)) {
      this.#aplicar(m[1] as string, 'sii.cl', true);
    }
  }

  #aplicar(linea: string, host: string, dominioPorDefecto: boolean): void {
    const partes = linea.split(';').map(trimPhp);
    const par = partes.shift();
    if (par === undefined || !par.includes('=')) return;

    const igual = par.indexOf('=');
    const nombre = trimPhp(par.slice(0, igual));
    const valor = trimPhp(par.slice(igual + 1));
    if (nombre === '') return;

    let dominio: string | null = null;
    let borrar = false;

    for (const atributo of partes) {
      const i = atributo.indexOf('=');
      const clave = minusculasAscii(trimPhp(i < 0 ? atributo : atributo.slice(0, i)));
      const val = i < 0 ? '' : trimPhp(atributo.slice(i + 1));

      if (clave === 'domain' && val !== '') {
        dominio = minusculasAscii(val.replace(/^\.+/, ''));
      } else if (clave === 'max-age' && esNumericoPhp(val) && Math.trunc(Number(val.trim())) <= 0) {
        borrar = true;
      } else if (clave === 'expires') {
        const instante = Date.parse(val);
        if (!Number.isNaN(instante) && instante < this.#reloj.ahora().getTime()) borrar = true;
      }
    }

    // Una cookie solo puede fijarse para su propio host o un dominio padre, y
    // nunca fuera de sii.cl.
    if (dominio !== null && host !== dominio && !host.endsWith(`.${dominio}`)) return;
    if (dominio !== null && dominio !== 'sii.cl' && !dominio.endsWith('.sii.cl')) return;

    const hostOnly = dominio === null && !dominioPorDefecto;
    const dominioFinal = dominio ?? host;

    if (borrar || valor === '') {
      this.#cookies.delete(clave(nombre, dominioFinal, hostOnly));
      return;
    }
    this.#poner(nombre, valor, dominioFinal, hostOnly);
  }

  #poner(nombre: string, valor: string, dominio: string, hostOnly: boolean): void {
    // Map.set sobre una clave existente conserva su posición, como el arreglo de PHP.
    this.#cookies.set(clave(nombre, dominio, hostOnly), {
      name: nombre,
      value: valor,
      domain: dominio,
      host_only: hostOnly,
    });
  }

  /** Sin valores: es una credencial. */
  toJSON(): { cookies: number } {
    return { cookies: this.#cookies.size };
  }

  [inspect.custom](): string {
    const nombres = [...this.#cookies.values()].map((c) => `${c.name}@${c.domain}`);
    return `SesionSii { ${nombres.length} cookies: ${nombres.join(', ') || '—'} (valores ocultos) }`;
  }
}

function clave(nombre: string, dominio: string, hostOnly: boolean): string {
  return `${hostOnly ? 'h:' : 'd:'}${dominio}|${nombre}`;
}
