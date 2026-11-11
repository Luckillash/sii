// Piezas compartidas por los comandos que arman y envían documentos al SII
// (`enviar-set`, `enviar-rcof`, `estado-envio`, `solicitar-folios`).

import { isAbsolute, relative } from 'node:path';
import {
  type Ambiente,
  type Certificado,
  ClienteBoletaRest,
  ClienteDtews,
  decodificarUtf8OIso,
  ErrorRespuestaSii,
  ErrorTransporte,
  FirmaElectronica,
  parsearDocumento,
  Rut,
  type TokenStore,
} from '@winex/certificacion';
import type { Config } from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import { ErrorConfig } from '../../errores.ts';

/** Receptor de las boletas del set de pruebas (anónimo, como el bin del PHP). */
export const RECEPTOR_SET = Object.freeze({ rut: '66666666-6', razonSocial: 'Cliente General' });

/** Firmador XML-DSig con la llave y el certificado del .pfx. */
export function firmadorDe(certificado: Certificado): FirmaElectronica {
  return new FirmaElectronica(certificado.llavePrivada, certificado.certificado);
}

/** Lo que se lee del `<DA>` de un CAF. Nunca se imprime la llave. */
export interface DatosCaf {
  readonly rutEmisor: string;
  readonly tipoDte: number;
  readonly desde: number;
  readonly hasta: number;
}

/**
 * Lee el `<DA>` de un CAF (UTF-8 o ISO-8859-1). Lanza `ErrorConfig` si no es un
 * CAF legible; el mensaje nombra `origen` (ruta u opción), nunca el contenido.
 */
export function leerCaf(bytes: Uint8Array, origen: string): DatosCaf {
  const invalido = (motivo: string, causa?: unknown) =>
    new ErrorConfig(
      `El CAF de ${origen} no sirve: ${motivo}.`,
      causa === undefined ? undefined : { cause: causa },
    );
  let doc: Document;
  try {
    doc = parsearDocumento(decodificarUtf8OIso(bytes));
  } catch (error) {
    throw invalido('no es un XML válido', error);
  }
  const da = doc.getElementsByTagName('DA').item(0);
  const rng = da?.getElementsByTagName('RNG').item(0) ?? null;
  if (da === null || rng === null) throw invalido('no trae <DA> con <RNG>');
  const campo = (padre: Element, nombre: string) =>
    (padre.getElementsByTagName(nombre).item(0)?.textContent ?? '').trim();
  const numero = (padre: Element, nombre: string) => {
    const valor = campo(padre, nombre);
    if (!/^[0-9]+$/.test(valor)) throw invalido(`<${nombre}> no es un entero`);
    return Number(valor);
  };
  return {
    rutEmisor: campo(da, 'RE'),
    tipoDte: numero(da, 'TD'),
    desde: numero(rng, 'D'),
    hasta: numero(rng, 'H'),
  };
}

/** `true` si los dos RUT son el mismo (con o sin puntos, DV en cualquier caja). */
export function mismoRut(a: string, b: string): boolean {
  return Rut.esValido(a) && Rut.esValido(b) && Rut.de(a).equals(Rut.de(b));
}

/** Cliente DTEWS (maullin/palena) con el transporte, el reloj y el caché de la CLI. */
export function clienteDtews(
  ctx: Contexto,
  certificado: Certificado,
  ambiente: Ambiente,
  tokenStore: TokenStore | undefined,
): ClienteDtews {
  return new ClienteDtews(certificado, {
    ambiente,
    transporte: ctx.transporte(),
    reloj: ctx.reloj,
    ...(tokenStore !== undefined ? { tokenStore } : {}),
  });
}

/** Cliente de la API REST de boletas con el transporte, el reloj y el caché de la CLI. */
export function clienteRest(
  ctx: Contexto,
  certificado: Certificado,
  ambiente: Ambiente,
  tokenStore: TokenStore | undefined,
): ClienteBoletaRest {
  return new ClienteBoletaRest(certificado, {
    ambiente,
    transporte: ctx.transporte(),
    reloj: ctx.reloj,
    ...(tokenStore !== undefined ? { tokenStore } : {}),
  });
}

/**
 * Sube un archivo firmado por DTEUpload y devuelve el TrackID. Pide (o reutiliza)
 * el token antes; un error ahí no subió nada. Si la subida falla:
 * - `ErrorTransporte`: no se sabe si llegó; se avisa por la salida de errores que
 *   hay que revisar antes de repetir (`queRevisar`).
 * - STATUS 5 (token inválido o vencido): se borra el token del caché para que la
 *   próxima ejecución pida otro.
 */
export async function subirPorDteUpload(
  ctx: Contexto,
  cliente: ClienteDtews,
  archivo: { rutEmisor: string; rutEnvia: string; xml: Uint8Array; nombreArchivo: string },
  queRevisar: string,
): Promise<string> {
  const token = await cliente.obtenerToken(archivo.rutEmisor);
  try {
    return await cliente.enviarDte(token, archivo);
  } catch (error) {
    if (error instanceof ErrorRespuestaSii && error.estado === '5') {
      await cliente.olvidarToken(archivo.rutEmisor);
    }
    if (error instanceof ErrorTransporte) avisarSubidaIncierta(ctx, queRevisar);
    throw error;
  }
}

/** Aviso para una subida que falló después de salir: el SII pudo haberla recibido. */
export function avisarSubidaIncierta(ctx: Contexto, queRevisar: string): void {
  ctx.imprimirError(
    `[ATENCIÓN] La subida falló después de enviarse: el SII pudo haberla recibido. ` +
      `Antes de repetir, revisa los envíos de la empresa en el SII (${queRevisar}).`,
  );
}

/** Ruta para sugerir en el `.env`: relativa a su carpeta si queda dentro, si no absoluta. */
export function rutaParaEnv(config: Config, ruta: string): string {
  const rel = relative(config.base, ruta);
  return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? ruta : rel.replaceAll('\\', '/');
}
