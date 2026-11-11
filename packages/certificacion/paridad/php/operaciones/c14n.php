<?php

/**
 * Operación de paridad `c14n`: DOMNode::C14N() con los argumentos por defecto
 * (C14N 1.0 inclusivo, sin comentarios), tal como lo usa
 * FirmaElectronica::firmarDte() para calcular el DigestValue.
 *
 * Entrada:
 *   xml        XML de entrada como texto (se pasa en UTF-8), o bien
 *   xmlBase64  bytes exactos del XML en base64 (para entradas ISO-8859-1)
 *   etiqueta   nombre del elemento a canonicalizar (getElementsByTagName);
 *              si se omite, se usa el elemento raíz
 *   indice     posición dentro de getElementsByTagName (por defecto 0)
 *
 * Igual que firmarDte: loadXML con preserveWhiteSpace y, si el nodo tiene
 * atributo ID, setIdAttribute('ID', true) antes de C14N().
 */

declare(strict_types=1);

return [
    'c14n' => static function (array $entrada, array $material): array {
        $xml = isset($entrada['xmlBase64'])
            ? base64_decode((string) $entrada['xmlBase64'], true)
            : (string) $entrada['xml'];
        if ($xml === false) {
            throw new RuntimeException('xmlBase64 inválido');
        }

        $dom = new DOMDocument();
        $dom->preserveWhiteSpace = true;
        if (! $dom->loadXML($xml)) {
            throw new RuntimeException('loadXML falló');
        }

        if (isset($entrada['etiqueta'])) {
            $nodo = $dom->getElementsByTagName((string) $entrada['etiqueta'])
                ->item((int) ($entrada['indice'] ?? 0));
        } else {
            $nodo = $dom->documentElement;
        }
        if (! $nodo instanceof DOMElement) {
            throw new RuntimeException('No se encontró el elemento a canonicalizar');
        }

        if ($nodo->hasAttribute('ID')) {
            $nodo->setIdAttribute('ID', true);
        }

        $canonico = $nodo->C14N();
        if ($canonico === false) {
            throw new RuntimeException('C14N() falló');
        }

        return [$canonico, []];
    },
];
