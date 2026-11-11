// Deriva de winex/certificacion v1.9.1 (src/Folios/TransporteFalso.php), © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript.

import { RespuestaHttp } from './respuesta.ts';
import {
  type CuerpoHttp,
  type MetodoHttp,
  type PeticionHttp,
  prepararPeticion,
  type TransporteHttp,
} from './transporte.ts';

/** Una petición que pasó por el transporte falso. Nunca guarda la llave TLS. */
export interface PeticionRegistrada {
  readonly metodo: MetodoHttp;
  readonly url: string;
  /** Cabeceras finales, las mismas que enviaría el transporte real (sin `Host` ni `Content-Length`). */
  readonly cabeceras: Readonly<Record<string, string>>;
  /** El cuerpo tal como se entregó (campos del formulario o datos crudos). */
  readonly cuerpo: CuerpoHttp | undefined;
  /** Los bytes que se habrían enviado. */
  readonly bytes: Buffer | undefined;
  /** Si llevó certificado de cliente. */
  readonly tls: boolean;
  readonly msRespuesta: number | undefined;
  /** Si pidió una conexión propia (`conexionNueva`). */
  readonly conexionNueva: boolean;
}

/**
 * Respuesta configurada: un texto o bytes (status 200), una `RespuestaHttp`, o una
 * función que recibe la petición y devuelve cualquiera de esas (o lanza, para
 * simular una falla de red).
 */
export type RespuestaFalsa =
  | string
  | Uint8Array
  | RespuestaHttp
  | ((peticion: PeticionRegistrada) => RespuestaFija | Promise<RespuestaFija>);

type RespuestaFija = string | Uint8Array | RespuestaHttp;

/**
 * Transporte para tests: responde según la URL y registra lo que se envió. Nunca
 * sale a la red.
 *
 * ```ts
 * const falso = new TransporteFalso({
 *   'herculesr.sii.cl/cgi_AUT2000/*': '<script>document.cookie="TOKEN=X"</script>',
 *   'maullin.sii.cl/cvc_cgi/dte/of_solicita_folios': html,
 * });
 * ```
 *
 * Los patrones se comparan contra host+ruta (sin esquema, puerto ni query), sin
 * distinguir mayúsculas; `*` es comodín. Gana el primer patrón que calce. Una URL
 * sin patrón responde 404 con cuerpo vacío.
 */
export class TransporteFalso implements TransporteHttp {
  readonly enviadas: PeticionRegistrada[] = [];
  private readonly reglas: ReadonlyArray<readonly [RegExp, RespuestaFalsa]>;

  /** Un objeto o una lista de pares `[patrón, respuesta]`, en orden de prioridad. */
  constructor(
    respuestas:
      | Readonly<Record<string, RespuestaFalsa>>
      | Iterable<readonly [string, RespuestaFalsa]> = {},
  ) {
    const pares =
      typeof (respuestas as Partial<Iterable<unknown>>)[Symbol.iterator] === 'function'
        ? [...(respuestas as Iterable<readonly [string, RespuestaFalsa]>)]
        : Object.entries(respuestas as Readonly<Record<string, RespuestaFalsa>>);
    this.reglas = pares.map(([patron, respuesta]) => [aRegex(patron), respuesta] as const);
  }

  async enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    const preparada = prepararPeticion(peticion);
    const registrada: PeticionRegistrada = {
      metodo: preparada.metodo,
      url: preparada.url.href,
      cabeceras: preparada.cabeceras,
      cuerpo: peticion.cuerpo,
      bytes: preparada.cuerpo,
      tls: peticion.tls !== undefined,
      msRespuesta: peticion.msRespuesta,
      conexionNueva: peticion.conexionNueva ?? false,
    };
    this.enviadas.push(registrada);

    const clave = preparada.url.hostname + preparada.url.pathname;
    for (const [regex, respuesta] of this.reglas) {
      if (!regex.test(clave)) continue;
      const fija = typeof respuesta === 'function' ? await respuesta(registrada) : respuesta;
      return fija instanceof RespuestaHttp ? fija : new RespuestaHttp(200, {}, fija);
    }

    return new RespuestaHttp(404);
  }

  /** URLs enviadas, en orden. */
  urls(): string[] {
    return this.enviadas.map((p) => p.url);
  }
}

function aRegex(patron: string): RegExp {
  const escapado = patron
    .split('*')
    .map((parte) => parte.replace(/[.+?^${}()|[\]\\/]/g, '\\$&'))
    .join('.*');
  return new RegExp(`^${escapado}$`, 'i');
}
