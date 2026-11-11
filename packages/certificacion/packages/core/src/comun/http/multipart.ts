// Cuerpo multipart/form-data armado a mano, con el mismo formato que cURL
// (`CURLOPT_POSTFIELDS` con un arreglo y `CURLFile`), que es lo que usa
// winex/certificacion v1.9.1 para subir DTE, boletas y RCOF
// (src/Certificacion/SiiSoapClient.php y src/Produccion/SiiBoletaProduccion.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript y
// helper compartido (pend. 2.4: el PHP repetía el multipart en tres lugares).
//
// Se arma a mano, y no con el `FormData` de undici, para controlar los bytes:
// orden de los campos, `filename`, `Content-Type` de cada parte y saltos CRLF.
//
// Formato real de cURL, comprobado con el servidor de captura (PLAN §5.3; casos
// `http-multipart-*` de paridad/, cURL 8.23 del PHP 8.3 de Windows):
//
//   --<boundary>\r\n
//   Content-Disposition: form-data; name="campo"\r\n
//   \r\n
//   valor\r\n
//   --<boundary>\r\n
//   Content-Disposition: form-data; name="archivo"; filename="x.xml"\r\n
//   Content-Type: text/xml\r\n
//   \r\n
//   <bytes>\r\n
//   --<boundary>--\r\n
//
// - Boundary: 24 guiones y 22 caracteres alfanuméricos aleatorios
//   (`[0-9A-Za-z]`), 46 en total (lib/mime.c: MIME_BOUNDARY_DASHES y
//   MIME_RAND_BOUNDARY_CHARS). Las versiones antiguas de cURL usaban 16 hexadecimales.
//   Cabecera: `Content-Type: multipart/form-data; boundary=<boundary>`.
// - Los campos de texto van sin `Content-Type` ni charset, con los bytes del string
//   PHP tal cual (UTF-8 en el core). Los archivos llevan el tipo del `CURLFile`;
//   sin tipo, PHP le pasa `application/octet-stream` (no se deduce de la extensión).
// - Los campos salen en el orden del arreglo de `CURLOPT_POSTFIELDS`.
// - Fuera del cuerpo, cURL agrega `Accept: */*` y, para cuerpos de más de 1 MiB,
//   `Expect: 100-continue` (salvo que se mande `Expect:` vacío, como `enviarDte()`).
//   Eso lo decide cada cliente con sus cabeceras; aquí solo se arma el cuerpo.

import { randomInt } from 'node:crypto';
import { ErrorValidacion } from '../errores.ts';

/** Un campo de texto o un archivo. Los campos salen en el orden de la lista. */
export type CampoMultipart =
  | { readonly nombre: string; readonly valor: string }
  | {
      readonly nombre: string;
      /** Bytes exactos del archivo (p. ej. un XML en ISO-8859-1). */
      readonly archivo: Uint8Array;
      /** Nombre con que lo recibe el servidor. */
      readonly nombreArchivo: string;
      /** Por defecto `application/octet-stream`, como cURL sin tipo. */
      readonly contentType?: string;
    };

export interface MultipartArmado {
  /** Valor de la cabecera `Content-Type`, con el boundary. */
  readonly contentType: string;
  readonly datos: Buffer;
  readonly boundary: string;
}

const ALFANUMERICOS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** Boundary como el de cURL: 24 guiones y 22 alfanuméricos aleatorios (46 caracteres). */
export function boundaryAleatorio(): string {
  let aleatorio = '';
  for (let i = 0; i < 22; i++) aleatorio += ALFANUMERICOS[randomInt(ALFANUMERICOS.length)];
  return `${'-'.repeat(24)}${aleatorio}`;
}

/** Comillas, CR y LF romperían la cabecera de la parte: se rechazan. */
function exigirSeguro(texto: string, que: string): void {
  if (/["\r\n]/.test(texto)) {
    throw new ErrorValidacion(
      `El ${que} de un campo multipart no puede tener comillas ni saltos de línea.`,
    );
  }
}

/**
 * Arma el cuerpo multipart/form-data. Los valores de texto se envían en UTF-8;
 * los archivos, tal cual.
 *
 * @param boundary fijo solo para tests; por defecto, uno aleatorio.
 */
export function armarMultipart(
  campos: readonly CampoMultipart[],
  boundary: string = boundaryAleatorio(),
): MultipartArmado {
  // RFC 2046: 1 a 70 caracteres de un conjunto acotado (sin espacios, por simpleza).
  if (!/^[0-9A-Za-z'()+_,./:=?-]{1,70}$/.test(boundary)) {
    throw new ErrorValidacion('El boundary del multipart no es válido (RFC 2046).');
  }
  const partes: Buffer[] = [];
  for (const campo of campos) {
    exigirSeguro(campo.nombre, 'nombre');
    let cabecera = `--${boundary}\r\nContent-Disposition: form-data; name="${campo.nombre}"`;
    let contenido: Buffer;
    if ('archivo' in campo) {
      exigirSeguro(campo.nombreArchivo, 'nombre de archivo');
      cabecera += `; filename="${campo.nombreArchivo}"\r\nContent-Type: ${campo.contentType ?? 'application/octet-stream'}`;
      contenido = Buffer.from(
        campo.archivo.buffer,
        campo.archivo.byteOffset,
        campo.archivo.byteLength,
      );
    } else {
      contenido = Buffer.from(campo.valor, 'utf8');
    }
    partes.push(
      Buffer.from(`${cabecera}\r\n\r\n`, 'utf8'),
      contenido,
      Buffer.from('\r\n', 'latin1'),
    );
  }
  partes.push(Buffer.from(`--${boundary}--\r\n`, 'latin1'));

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    datos: Buffer.concat(partes),
    boundary,
  };
}
