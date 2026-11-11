<?php

/**
 * Operación de paridad `firmarSemilla`: FirmaElectronica::firmarSemilla().
 *
 * Cada archivo de operaciones/ devuelve un mapa operación => función. La función
 * recibe la `entrada` del caso y el material de prueba, y devuelve
 * [bytes, marcas] (ver generar.php).
 */

declare(strict_types=1);

return [
    'firmarSemilla' => static function (array $entrada, array $material): array {
        $firma = new Winex\Certificacion\Core\FirmaElectronica($material['llave'], $material['certificado']);

        return [$firma->firmarSemilla((string) $entrada['semilla']), []];
    },
];
