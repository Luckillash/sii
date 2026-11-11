// Deriva de winex/certificacion v1.9.1 (src/Certificacion/SiiSoapClient.php,
// getToken), © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a
// TypeScript.
//
// Firma de la semilla del canal SOAP DTEWS, byte a byte igual a la del PHP
// (paridad/casos/http-dtews-token-*). NO es la misma firma que
// `FirmaElectronica.firmarSemilla()` (la de la API REST): el PHP la arma con
// código propio y no canónico (pend. 1.3 / 1.8 / 2.1). Decisión del plan:
// "Paridad primero. Unificar con firmarSemilla() en una tarea posterior",
// validada en maullin, porque unificarla cambia los bytes que se envían al SII.
//
// Diferencias con `firmarSemilla()`:
//
// 1. El SignatureValue se calcula sobre el `<SignedInfo>` tal como está escrito
//    (con los elementos vacíos cerrados con `/>`), no sobre su forma C14N
//    (`<X></X>`). Un verificador XML-DSig estricto no lo valida; el SII sí.
// 2. El XML firmado lleva un salto de línea (`\n`) entre elementos y el
//    `<SignedInfo>` en una sola línea; `firmarSemilla()` lo entrega todo en una.
// 3. `<X509Certificate>` lleva el certificado TAL CUAL lo recibe (ver
//    `CredencialesDtews.certificado`): los scripts del PHP le pasan
//    `Certificate::getPublicKey()`, que es el PEM completo con
//    `-----BEGIN CERTIFICATE-----`, saltos de línea y, según cómo se cargó el
//    .pfx, un `\n` final. `firmarSemilla()` lo limpia.
// 4. El DigestValue es el SHA1 del string literal
//    `<getToken><item><Semilla>…</Semilla></item></getToken>`, no de su C14N.
//    Con una semilla numérica (lo único que acepta) son los mismos bytes.
// 5. El resultado no se envía tal cual: va escapado con `htmlspecialchars()`
//    dentro de `<pszXml>` (ver `sobreGetToken`).

import { createHash, createPrivateKey, type KeyObject, sign } from 'node:crypto';
import { escaparXml } from '../comun/codificacion.ts';
import { ErrorFirma, ErrorValidacion } from '../comun/errores.ts';

const DSIG = 'http://www.w3.org/2000/09/xmldsig#';
const C14N_ALG = 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315';

/** Abre la llave privada una sola vez (falla rápido si no es un PEM legible). */
export function llaveDtews(llavePrivadaPem: string): KeyObject {
  try {
    return createPrivateKey(llavePrivadaPem);
  } catch (error) {
    // Sin el PEM en el mensaje: termina en logs.
    throw new ErrorFirma('La llave privada no es un PEM legible.', { cause: error });
  }
}

/**
 * Firma la semilla como `SiiSoapClient::getToken()` del PHP y devuelve el XML
 * `<getToken>` firmado (sin escapar), con sus saltos de línea.
 *
 * @param semilla la semilla de `CrSeed` (solo dígitos)
 * @param llave llave privada RSA (PEM o `KeyObject`)
 * @param certificado va tal cual a `<X509Certificate>` (ver la diferencia 3 arriba)
 * @throws ErrorValidacion si la semilla no son solo dígitos
 * @throws ErrorFirma si la llave no es RSA o la firma falla
 */
export function firmarSemillaDtews(
  semilla: string,
  llave: string | KeyObject,
  certificado: string,
): string {
  // El PHP solo llega aquí con lo que calzó con <SEMILLA>([0-9]+)</SEMILLA>.
  if (!/^[0-9]+$/.test(semilla)) {
    throw new ErrorValidacion('La semilla del SII debe tener solo dígitos.');
  }
  const llavePrivada = typeof llave === 'string' ? llaveDtews(llave) : llave;

  const cuerpo = `<getToken><item><Semilla>${semilla}</Semilla></item></getToken>`;
  const digest = createHash('sha1').update(cuerpo, 'utf8').digest('base64');
  const signedInfo =
    `<SignedInfo xmlns="${DSIG}">` +
    `<CanonicalizationMethod Algorithm="${C14N_ALG}"/>` +
    `<SignatureMethod Algorithm="${DSIG}rsa-sha1"/>` +
    '<Reference URI="">' +
    `<Transforms><Transform Algorithm="${DSIG}enveloped-signature"/></Transforms>` +
    `<DigestMethod Algorithm="${DSIG}sha1"/>` +
    `<DigestValue>${digest}</DigestValue>` +
    '</Reference></SignedInfo>';

  let firma: Buffer;
  try {
    // openssl_sign($signedInfo, ...) sobre el string tal cual, sin C14N (diferencia 1).
    firma = sign('sha1', Buffer.from(signedInfo, 'utf8'), llavePrivada);
  } catch (error) {
    // PHP ignoraba el resultado de openssl_sign (pend. 1.7); aquí se reporta.
    throw new ErrorFirma(
      'No se pudo firmar la semilla con RSA-SHA1. Si el OpenSSL del sistema bloquea SHA1, use el binario oficial de Node.',
      { cause: error },
    );
  }
  const { modulus, exponent } = rsaKeyValue(llavePrivada);

  // Mismo layout que el literal multilínea del PHP (LF; el core se versiona sin
  // conversión de fin de línea).
  return `<?xml version="1.0"?>
<getToken>
<item>
<Semilla>${semilla}</Semilla>
</item>
<Signature xmlns="${DSIG}">
${signedInfo}
<SignatureValue>${firma.toString('base64')}</SignatureValue>
<KeyInfo>
<KeyValue>
<RSAKeyValue>
<Modulus>${modulus}</Modulus>
<Exponent>${exponent}</Exponent>
</RSAKeyValue>
</KeyValue>
<X509Data>
<X509Certificate>${certificado}</X509Certificate>
</X509Data>
</KeyInfo>
</Signature>
</getToken>`;
}

/**
 * Sobre SOAP de `GetTokenFromSeed.getToken`: el XML firmado va escapado con
 * `htmlspecialchars()` con las opciones por defecto de PHP 8.3
 * (`ENT_QUOTES | ENT_SUBSTITUTE | ENT_HTML401`: `"` → `&quot;`, `'` → `&#039;`).
 */
export function sobreGetToken(xmlFirmado: string): string {
  return (
    '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Header/>' +
    `<soapenv:Body><getToken><pszXml>${escaparXml(xmlFirmado, 'defecto')}</pszXml></getToken>` +
    '</soapenv:Body></soapenv:Envelope>'
  );
}

/** Módulo y exponente en base64 (big-endian sin cero inicial, como openssl_pkey_get_details). */
function rsaKeyValue(llave: KeyObject): { modulus: string; exponent: string } {
  let jwk: JsonWebKey;
  try {
    jwk = llave.export({ format: 'jwk' });
  } catch (error) {
    throw new ErrorFirma('La llave privada no es RSA.', { cause: error });
  }
  if (jwk.kty !== 'RSA' || jwk.n === undefined || jwk.e === undefined) {
    throw new ErrorFirma('La llave privada no es RSA.');
  }
  return {
    modulus: Buffer.from(jwk.n, 'base64url').toString('base64'),
    exponent: Buffer.from(jwk.e, 'base64url').toString('base64'),
  };
}
