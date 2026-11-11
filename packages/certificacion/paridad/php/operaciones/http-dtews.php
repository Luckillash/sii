<?php

/**
 * Operación de paridad `httpDtews`: las peticiones de SiiSoapClient (canal SOAP
 * DTEWS) grabadas por el servidor de captura, para compararlas con las de
 * ClienteDtews (packages/core/src/certificacion/dtews-soap.ts). Todo va al
 * origen 'https' (el $host de SiiSoapClient es el del servidor de captura).
 *
 * Entrada:
 *   accion     getToken | enviarDte | estadoEnvio
 *   archivo, clave   certificado de paridad/material/ (por defecto cert-titular.pem).
 *              Como los scripts bin/, se carga con Certificate y getToken() recibe
 *              getPublicKey() (el PEM completo) como $publicKeyLimpia.
 *   token, rutEmisor, rutEnvia, rutEmpresa, trackId   según la acción
 *   xml        {base64}: bytes exactos del archivo que sube enviarDte()
 *   nombreArchivo   nombre del archivo que sube enviarDte() (el PHP manda
 *              basename() de la ruta: se escribe con ese nombre en una carpeta
 *              temporal propia, así no hace falta normalizarlo)
 *   esperaError  true si el cliente debe lanzar (camino de error): la salida termina
 *              en `error`. Sin él, una excepción hace fallar el caso.
 *   http       respuestas grabadas (ver http.php)
 *
 * Salida: las peticiones normalizadas y, al final, lo que el cliente leyó de la
 * respuesta (token, trackId o resumen() del estado), o `error` si lanzó.
 */

declare(strict_types=1);

use Winex\Certificacion\Certificacion\SiiSoapClient;
use Winex\Certificacion\Core\Certificate;
use Winex\Certificacion\Core\FirmaElectronica;

/** enviarDte() con el archivo escrito en una carpeta temporal propia, que se borra al terminar. */
function dtewsEnviarDte(SiiSoapClient $soap, array $entrada, string $xml): string
{
    $nombre = (string) $entrada['nombreArchivo'];
    if ($nombre === '' || basename($nombre) !== $nombre) {
        throw new InvalidArgumentException("Nombre de archivo inválido: {$nombre}");
    }
    $carpeta = sys_get_temp_dir().'/paridad-dtews-'.bin2hex(random_bytes(8));
    if (! mkdir($carpeta, 0700)) {
        throw new RuntimeException("No se pudo crear {$carpeta}");
    }
    $ruta = $carpeta.'/'.$nombre;
    try {
        file_put_contents($ruta, $xml);

        return $soap->enviarDte((string) $entrada['token'], (string) $entrada['rutEmisor'], (string) $entrada['rutEnvia'], $ruta);
    } finally {
        @unlink($ruta);
        @rmdir($carpeta);
    }
}

return [
    'httpDtews' => static function (array $entrada, array $material): array {
        $cert = Certificate::fromContents(
            leerMaterial((string) ($entrada['archivo'] ?? 'cert-titular.pem')),
            (string) ($entrada['clave'] ?? ''),
        );
        $xml = isset($entrada['xml']['base64'])
            ? (string) base64_decode((string) $entrada['xml']['base64'], true)
            : '';

        [$peticiones, $resultado] = conCapturaHttp($entrada['http'] ?? [], static function () use ($entrada, $cert, $xml): string {
            $soap = new SiiSoapClient(
                new FirmaElectronica($cert->getPrivateKey(), $cert->getPublicKey()),
                hostCaptura('https'),
            );
            try {
                $resultado = match ($entrada['accion']) {
                    'getToken' => $soap->getToken($cert->getPrivateKey(), $cert->getPublicKey()),
                    'enviarDte' => dtewsEnviarDte($soap, $entrada, $xml),
                    'estadoEnvio' => $soap->estadoEnvio(
                        (string) $entrada['token'],
                        (string) $entrada['rutEmpresa'],
                        (string) $entrada['trackId'],
                    )->resumen(),
                    default => throw new InvalidArgumentException("Acción desconocida: {$entrada['accion']}"),
                };
            } catch (Exception $e) {
                if (($entrada['esperaError'] ?? false) !== true || $e instanceof InvalidArgumentException) {
                    throw $e;
                }

                return 'error';
            }
            if (($entrada['esperaError'] ?? false) === true) {
                throw new RuntimeException('Se esperaba que el cliente lanzara y no lanzó.');
            }

            return $resultado;
        });

        return [$peticiones."=== resultado ===\n{$resultado}\n", []];
    },
];
