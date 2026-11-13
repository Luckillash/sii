import 'server-only';
import {
  ErrorTransporte,
  hostDe,
  type OpcionesTransporteUndici,
  type PeticionHttp,
  type RespuestaHttp,
  type TransporteHttp,
  TransporteUndici,
  urlSinQuery,
} from '@winex/certificacion';

// Un transporte HTTP por invocación (PLAN-SAAS Fase 4), cerrado con `await using`:
//
//   await using transporte = crearTransporte();
//   const folios = new SolicitudFolios({ ambiente, transporte });
//
// `TransporteUndici` de la librería ya implementa `Symbol.asyncDispose` (cierra sus
// `Agent` de undici, uno por certificado de cliente). Nunca se comparte entre
// peticiones: cada `Agent` guarda en memoria la llave privada del certificado con que
// se abrió la conexión TLS mutua, y en Vercel una instancia atiende a varios usuarios.
// Tampoco se deja abierto: las conexiones keep-alive mantendrían viva la función.
//
// En las pruebas se inyecta un `TransporteFalso` (nunca sale a la red). Quien lo
// inyecta es su dueño: al cerrar no se cierra el inyectado, solo se deja de usar.

/** Transporte que se cierra al salir del bloque `await using`. */
export type TransporteInvocacion = TransporteHttp & AsyncDisposable;

export interface OpcionesTransporte extends OpcionesTransporteUndici {
  /** Transporte ya creado (p. ej. `TransporteFalso` en pruebas). Ignora el resto de las opciones. */
  readonly transporte?: TransporteHttp;
}

/** Envuelve un transporte inyectado: después de cerrar rechaza peticiones, como `TransporteUndici`. */
class TransporteInyectado implements TransporteInvocacion {
  readonly #interno: TransporteHttp;
  #cerrado = false;

  constructor(interno: TransporteHttp) {
    this.#interno = interno;
  }

  async enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    if (this.#cerrado) {
      throw new ErrorTransporte(
        `El transporte HTTP ya se cerró (petición a ${hostDe(peticion.url)}).`,
        urlSinQuery(peticion.url),
      );
    }
    return this.#interno.enviar(peticion);
  }

  async [Symbol.asyncDispose](): Promise<void> {
    this.#cerrado = true;
  }
}

/**
 * Un `TransporteUndici` nuevo (TLS siempre verificado, solo https, conexión 10 s y
 * petición 45 s por defecto), o el transporte inyectado envuelto para `await using`.
 */
export function crearTransporte(opciones: OpcionesTransporte = {}): TransporteInvocacion {
  const { transporte, ...undici } = opciones;
  if (transporte !== undefined) return new TransporteInyectado(transporte);
  return new TransporteUndici(undici);
}
