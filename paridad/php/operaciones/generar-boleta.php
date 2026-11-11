<?php

/**
 * Operación de paridad `generar-boleta`: GeneradorBoleta::generarBoleta().
 *
 * Entrada del caso (claves del PHP):
 *   ahora       hora de Chile (YYYY-MM-DDTHH:MM:SS) para <FchEmis>
 *   emisor      ['rut', 'razon_social', 'giro', 'direccion', 'comuna']
 *   receptor    ['rut', 'razon_social'?]
 *   folio       string o número (se pasa con (string), como bin/certificacion)
 *   detalles    [['nombre', 'cantidad', 'precio', 'exento'?, 'unidad'?], ...]
 *   tipo_dte    opcional ('39' por defecto, como el PHP)
 *   referencia  opcional ['codigo', 'razon']
 *   descuento   opcional ['tipo', 'valor', 'glosa']
 *
 * Los números llegan como los entrega json_decode: enteros como int y con
 * decimales como float (igual que el parser del set de pruebas).
 *
 * Marcas: FchEmis, extraída de la salida (§5.1 punto 3); el test de Node la inyecta.
 */

declare(strict_types=1);

use Winex\Certificacion\Core\GeneradorBoleta;

return [
    'generar-boleta' => static function (array $entrada, array $material): array {
        $xml = conHoraFija(
            (string) $entrada['ahora'],
            static fn (): string => (new GeneradorBoleta())->generarBoleta(
                $entrada['emisor'],
                $entrada['receptor'],
                (string) $entrada['folio'],
                $entrada['detalles'],
                // Sin tipo_dte se pasa el mismo valor por defecto del PHP.
                (string) ($entrada['tipo_dte'] ?? '39'),
                $entrada['referencia'] ?? null,
                $entrada['descuento'] ?? null,
            ),
        );

        if (! preg_match('/<FchEmis>([^<]+)<\/FchEmis>/', $xml, $m)) {
            throw new RuntimeException('La boleta no trae <FchEmis>.');
        }

        return [$xml, ['FchEmis' => $m[1]]];
    },
];
