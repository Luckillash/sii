<?php

/**
 * Operación de paridad `bienFormado`: qué XML acepta `DOMDocument::loadXML()`.
 *
 * Entrada: `xml` (mapa nombre => XML). Salida: una línea `nombre: ok|error` por
 * entrada, en orden. Node exige el mismo veredicto en parsearDocumento, para no
 * firmar un XML que el PHP habría rechazado.
 */

declare(strict_types=1);

return [
    'bienFormado' => static function (array $entrada, array $material): array {
        $anterior = libxml_use_internal_errors(true);
        $lineas = [];
        try {
            foreach ($entrada['xml'] as $nombre => $xml) {
                $dom = new DOMDocument();
                $lineas[] = $nombre.': '.($dom->loadXML((string) $xml) ? 'ok' : 'error');
                libxml_clear_errors();
            }
        } finally {
            libxml_use_internal_errors($anterior);
        }

        return [implode("\n", $lineas)."\n", []];
    },
];
