<?php

/**
 * Operación de paridad `firmarDte`: FirmaElectronica::firmarDte().
 *
 * Entrada: el XML a firmar en `xml` (texto; con `"bytes": "iso-8859-1"` se
 * convierte a ISO-8859-1 antes de firmar, como llega un DTE de GeneradorBoleta)
 * o en `xml_base64` (bytes crudos), y la `referenciaUri` (`#F1T39`, `#SetDoc`,
 * `#RCOF`...).
 *
 * firmarDte no estampa hora: no hay marcas.
 */

declare(strict_types=1);

return [
    'firmarDte' => static function (array $entrada, array $material): array {
        if (isset($entrada['xml_base64'])) {
            $xml = base64_decode((string) $entrada['xml_base64'], true)
                ?: throw new InvalidArgumentException('xml_base64 inválido');
        } else {
            $xml = (string) $entrada['xml'];
            if (($entrada['bytes'] ?? 'utf-8') === 'iso-8859-1') {
                $iso = mb_convert_encoding($xml, 'ISO-8859-1', 'UTF-8');
                if (mb_convert_encoding($iso, 'UTF-8', 'ISO-8859-1') !== $xml) {
                    throw new InvalidArgumentException('xml tiene caracteres fuera de ISO-8859-1');
                }
                $xml = $iso;
            }
        }

        $firma = new Winex\Certificacion\Core\FirmaElectronica($material['llave'], $material['certificado']);

        return [$firma->firmarDte($xml, (string) $entrada['referenciaUri']), []];
    },
];
