<?php

/**
 * Operación de paridad `httpRest`: las peticiones de SiiBoletaProduccion (API
 * REST de boleta) grabadas por el servidor de captura, para compararlas con las
 * de ClienteBoletaRest (packages/core/src/produccion/boleta-rest.ts).
 *
 * Entrada:
 *   accion     solicitarToken | enviarBoletaXml | enviarConsumoFolios | consultarEnvio
 *   token, rutEmisor, rutEnvia, trackId   según la acción
 *   xml        {esperado: "<caso>"} (bytes de paridad/esperados/<caso>.bin, p. ej. el
 *              sobre de set-completo) o {base64}
 *   esperaError  true si el cliente debe lanzar (camino de error): la salida termina
 *              en `error`. Sin él, una excepción hace fallar el caso.
 *   http       respuestas grabadas y normalización (ver http.php). Las subidas
 *              piden normalizar.nombresArchivo: el PHP manda el nombre de un
 *              temporal de tempnam().
 *
 * Material: llave y certificado base (FirmaElectronica, para firmar la semilla).
 * Autenticación (semilla, token, consulta) va al origen 'https'; el envío (boleta y
 * RCOF) a 'https2'.
 *
 * Salida: las peticiones normalizadas y, al final, lo que el cliente leyó de la
 * respuesta (token, trackid o estado), o `error` si lanzó. Así se compara también
 * el camino de error en el cable (el mensaje no: Node lo cambia a propósito).
 */

declare(strict_types=1);

use Winex\Certificacion\Core\FirmaElectronica;
use Winex\Certificacion\Produccion\SiiBoletaProduccion;

return [
    'httpRest' => static function (array $entrada, array $material): array {
        $firma = new FirmaElectronica($material['llave'], $material['certificado']);

        $xml = '';
        if (isset($entrada['xml']['esperado'])) {
            $nombre = (string) $entrada['xml']['esperado'];
            $ruta = dirname(PARIDAD_MATERIAL).'/esperados/'.$nombre.'.bin';
            if (str_contains($nombre, '/') || str_contains($nombre, '..') || ! is_file($ruta)) {
                throw new RuntimeException("Esperado desconocido: {$nombre}");
            }
            $xml = (string) file_get_contents($ruta);
        } elseif (isset($entrada['xml']['base64'])) {
            $xml = (string) base64_decode((string) $entrada['xml']['base64'], true);
        }

        [$peticiones, $resultado] = conCapturaHttp($entrada['http'] ?? [], static function () use ($entrada, $firma, $xml): string {
            $rest = new SiiBoletaProduccion($firma, false);
            apuntarBoletaProduccionACaptura($rest);
            try {
                $resultado = match ($entrada['accion']) {
                    'solicitarToken' => $rest->solicitarToken(),
                    'enviarBoletaXml' => (string) $rest->enviarBoletaXml(
                        $entrada['token'],
                        $entrada['rutEmisor'],
                        $entrada['rutEnvia'],
                        $xml,
                    )['trackid'],
                    'enviarConsumoFolios' => (string) $rest->enviarConsumoFolios(
                        $entrada['token'],
                        $entrada['rutEmisor'],
                        $entrada['rutEnvia'],
                        $xml,
                    )['trackid'],
                    'consultarEnvio' => (string) $rest->consultarEnvio(
                        $entrada['token'],
                        $entrada['rutEmisor'],
                        (string) $entrada['trackId'],
                    )['estado'],
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
