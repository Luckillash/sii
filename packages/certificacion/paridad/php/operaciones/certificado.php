<?php

/**
 * Operación de paridad `certificado`: Core\Certificate cargado desde un .pfx o
 * un PEM de paridad/material/.
 *
 * Entrada: `archivo` (en paridad/material/), `clave` y `crlf` (opcional: pasa
 * el contenido a saltos de línea de Windows antes de cargarlo).
 *
 * Salida: JSON con lo que entrega el certificado (llave, certificado, cadena,
 * toPem e info). El test de Node compara campo por campo, byte a byte.
 *
 * Requisitos del entorno, para que el resultado no dependa del equipo:
 * - `openssl_pkey_export` debe funcionar. Sin openssl.cnf (PHP de Windows) falla
 *   y el core cae a otra ruta que entrega la llave con otro formato. Se resuelve
 *   con OPENSSL_CONF=paridad/material/cert-openssl.cnf.
 * - Los .pfx con cifrado legacy (RC2-40) se leen con el binario `openssl
 *   -legacy`, que debe estar en el PATH (en Windows, el de Git:
 *   C:\Program Files\Git\mingw64\bin).
 * - getInfo() formatea con date(): se fija America/Santiago durante la carga,
 *   la misma zona que usa Node (ZONA_SII).
 *
 * Diferencia de plataforma del core: en Windows, la ruta de la CLI (.pfx legacy)
 * arma la cadena con CRLF (las tuberías de proc_open) y, como la hoja ya no
 * coincide con su copia de la cadena, toPem() la repite. En Linux sale con LF y
 * sin repetir. Para que el esperado no dependa del SO, `cadena` se normaliza a
 * LF y los casos con `sinPem` no guardan toPem() (Node sigue a Linux; lo cubre
 * un test unitario).
 */

declare(strict_types=1);

use Winex\Certificacion\Core\Certificate;

return [
    'certificado' => static function (array $entrada, array $material): array {
        $contenido = leerMaterial((string) $entrada['archivo']);
        if (! empty($entrada['crlf'])) {
            $contenido = str_replace("\n", "\r\n", str_replace("\r\n", "\n", $contenido));
        }

        $prueba = openssl_pkey_get_private(leerMaterial('cert-titular.pem'));
        if ($prueba === false || ! @openssl_pkey_export($prueba, $pem)) {
            while (openssl_error_string() !== false);
            throw new RuntimeException(
                'openssl_pkey_export no funciona en este PHP (falta openssl.cnf). '
                .'Define OPENSSL_CONF con la ruta de paridad/material/cert-openssl.cnf y vuelve a generar.'
            );
        }

        $zona = date_default_timezone_get();
        date_default_timezone_set('America/Santiago');
        try {
            $cert = Certificate::fromContents($contenido, (string) ($entrada['clave'] ?? ''));
            $info = $cert->getInfo();
        } catch (Exception $e) {
            throw new RuntimeException(
                "No se pudo cargar {$entrada['archivo']}: ".$e->getMessage()
                .' (los .pfx legacy necesitan `openssl` con -legacy en el PATH)',
                previous: $e,
            );
        } finally {
            date_default_timezone_set($zona);
        }

        $salida = [
            'llave' => $cert->getPrivateKey(),
            'certificado' => $cert->getPublicKey(),
            'cadena' => str_replace("\r\n", "\n", $cert->getPublicKeyChain()),
            'pem' => $cert->toPem(),
            'info' => $info,
        ];
        if (! empty($entrada['sinPem'])) {
            unset($salida['pem']);
        }

        return [
            json_encode($salida, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n",
            [],
        ];
    },
];
