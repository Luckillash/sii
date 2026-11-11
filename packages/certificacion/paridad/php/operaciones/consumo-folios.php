<?php

/**
 * Operación de paridad `consumoFolios`: GeneradorConsumoFolios::generar().
 *
 * Entrada del caso:
 *   ahora      hora de Chile (YYYY-MM-DDTHH:MM:SS) que se estampa en <TmstFirmaEnv>
 *   caratula   el array $caratula del PHP (rut_emisor, rut_envia, fch_resol, ...)
 *   resumenes  el array $resumenes del PHP (tipo, neto, iva, tasa_iva, ...)
 *   firmar     opcional: si es true, el RCOF se firma con firmarDte($rcof, '#RCOF'),
 *              como bin/certificacion/enviar-consumo-folios.php (requiere material)
 *
 * Marcas: TmstFirmaEnv, extraída de la salida (§5.1 punto 3); el test de Node la inyecta.
 */

declare(strict_types=1);

use Winex\Certificacion\Certificacion\GeneradorConsumoFolios;
use Winex\Certificacion\Core\FirmaElectronica;

return [
    'consumoFolios' => static function (array $entrada, array $material): array {
        $rcof = conHoraFija(
            (string) $entrada['ahora'],
            static fn (): string => (new GeneradorConsumoFolios)->generar($entrada['caratula'], $entrada['resumenes']),
        );

        if (($entrada['firmar'] ?? false) === true) {
            $rcof = (new FirmaElectronica($material['llave'], $material['certificado']))->firmarDte($rcof, '#RCOF');
        }

        if (! preg_match('/<TmstFirmaEnv>([^<]+)<\/TmstFirmaEnv>/', $rcof, $m)) {
            throw new RuntimeException('El RCOF no trae <TmstFirmaEnv>.');
        }

        return [$rcof, ['TmstFirmaEnv' => $m[1]]];
    },
];
