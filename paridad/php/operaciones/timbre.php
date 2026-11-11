<?php

/**
 * Operación de paridad `timbre`: Timbre::generarTed().
 *
 * Entrada del caso:
 *   caf    archivo de paridad/material/ (CAF de prueba, nunca real)
 *   datos  el array que recibe generarTed() (claves del PHP: rut_emisor, folio...)
 *   ahora  hora de Chile (YYYY-MM-DDTHH:MM:SS) que se estampa en <TSTED>
 *
 * Marcas: TSTED, extraída de la salida (§5.1 punto 3); el test de Node la inyecta.
 * La hora se fija con conHoraFija() (paridad/php/hora-fija.php).
 */

declare(strict_types=1);

use Winex\Certificacion\Core\Timbre;

return [
    'timbre' => static function (array $entrada, array $material): array {
        $ted = conHoraFija(
            (string) $entrada['ahora'],
            static fn (): string => (new Timbre(leerMaterial((string) $entrada['caf'])))->generarTed($entrada['datos']),
        );

        if (! preg_match('/<TSTED>([^<]+)<\/TSTED>/', $ted, $m)) {
            throw new RuntimeException('El TED no trae <TSTED>.');
        }

        return [$ted, ['TSTED' => $m[1]]];
    },
];
