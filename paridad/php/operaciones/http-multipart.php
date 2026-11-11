<?php

/**
 * Operación de paridad `httpMultipart`: un POST multipart/form-data con cURL
 * armado igual que en el core (SiiSoapClient::enviarDte(),
 * SiiBoletaProduccion::subirBoleta() y enviarConsumoFolios()): CURLOPT_POSTFIELDS
 * con un arreglo de campos de texto y un CURLFile. Compara el multipart de cURL
 * con el de `armarMultipart()` (packages/core/src/comun/http/multipart.ts).
 *
 * Entrada:
 *   origen     origen del servidor de captura ('https' por defecto; ver http.php)
 *   ruta       ruta con query, p. ej. "/cgi_dte/UPL/DTEUpload"
 *   cabeceras  CURLOPT_HTTPHEADER tal cual ("Nombre: valor"; "Nombre:" quita una
 *              cabecera que cURL pondría, como el "Expect:" de enviarDte())
 *   campos     lista ordenada; cada uno:
 *                {nombre, valor}                         campo de texto (UTF-8)
 *                {nombre, archivo: {base64} | {texto},   archivo (bytes exactos o texto UTF-8)
 *                 nombreArchivo?, contentType?,
 *                 prefijoTemporal?}
 *              Con prefijoTemporal el nombre es basename(tempnam(..., prefijo)).'.xml',
 *              como enviarBoletaXml() (el caso debe pedir normalizar.nombresArchivo).
 *              Sin contentType, CURLFile manda application/octet-stream.
 *   http       respuestas grabadas y normalización (ver http.php)
 */

declare(strict_types=1);

return [
    'httpMultipart' => static function (array $entrada, array $material): array {
        $temporales = [];
        try {
            $campos = [];
            foreach ($entrada['campos'] as $campo) {
                if (! isset($campo['archivo'])) {
                    $campos[$campo['nombre']] = (string) $campo['valor'];

                    continue;
                }

                $archivo = $campo['archivo'];
                $bytes = isset($archivo['base64'])
                    ? (string) base64_decode((string) $archivo['base64'], true)
                    : (string) $archivo['texto'];
                // Como enviarBoletaXml(): se escribe en el archivo que crea tempnam().
                $ruta = tempnam(sys_get_temp_dir(), (string) ($campo['prefijoTemporal'] ?? 'par'));
                $temporales[] = $ruta;
                file_put_contents($ruta, $bytes);
                $nombre = isset($campo['prefijoTemporal'])
                    ? basename($ruta).'.xml'
                    : (string) $campo['nombreArchivo'];
                $campos[$campo['nombre']] = new CURLFile($ruta, (string) ($campo['contentType'] ?? ''), $nombre);
            }

            [$peticiones] = conCapturaHttp($entrada['http'] ?? [], static function () use ($entrada, $campos): void {
                $ch = curl_init(origenCaptura($entrada['origen'] ?? 'https').$entrada['ruta']);
                curl_setopt_array($ch, [
                    CURLOPT_POST => true,
                    CURLOPT_POSTFIELDS => $campos,
                    CURLOPT_HTTPHEADER => $entrada['cabeceras'] ?? [],
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_SSL_VERIFYPEER => true,
                    CURLOPT_SSL_VERIFYHOST => 2,
                    CURLOPT_CONNECTTIMEOUT => 10,
                    CURLOPT_TIMEOUT => 45,
                ]);
                $respuesta = curl_exec($ch);
                if ($respuesta === false) {
                    throw new RuntimeException('cURL falló: '.curl_error($ch));
                }
            });

            return [$peticiones, []];
        } finally {
            foreach ($temporales as $ruta) {
                @unlink($ruta);
            }
        }
    },
];
