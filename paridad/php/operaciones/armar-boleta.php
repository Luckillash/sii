<?php

/**
 * Operación de paridad `armar-boleta`: el armado de un DTE de
 * bin/certificacion/enviar-set-boletas.php (generar → timbrar → TED +
 * TmstFirma → firmar), que en Node es ArmadorBoleta::armar().
 *
 * Entrada del caso (claves del PHP, como `generar-boleta`):
 *   ahora       hora de Chile (YYYY-MM-DDTHH:MM:SS) para FchEmis, FE, TSTED y TmstFirma
 *   caf         archivo de paridad/material/ (CAF de prueba, nunca real)
 *   emisor      ['rut', 'razon_social', 'giro', 'direccion', 'comuna']
 *   receptor    ['rut', 'razon_social']
 *   folio       string o número (se pasa con (string), como el bin)
 *   detalles    [['nombre', 'cantidad', 'precio', 'exento'?, 'unidad'?], ...]
 *   tipo_dte    opcional ('39' por defecto)
 *   referencia  opcional ['codigo', 'razon']
 *   descuento   opcional ['tipo', 'valor', 'glosa'] (el bin no lo usa; GeneradorBoleta sí)
 *
 * Salida: lo que devuelve firmarDte(), SIN el "\n" que el bin agrega antes de
 * empaquetar (ese "\n" lo pone EnvioBoleta::empaquetar con un arreglo en Node).
 *
 * Marcas: FchEmis, TSTED y TmstFirma, extraídas de la salida (§5.1 punto 3).
 */

declare(strict_types=1);

use Winex\Certificacion\Core\FirmaElectronica;
use Winex\Certificacion\Core\GeneradorBoleta;
use Winex\Certificacion\Core\Timbre;

/**
 * El cuerpo del bucle de enviar-set-boletas.php para un caso, copiado tal
 * cual salvo que los date() del bin (namespace global) pasan por
 * fechaParidad(), y que el CAF llega como contenido (Timbre acepta el XML
 * crudo). Lo usa también la operación `set-completo`.
 *
 * Debe llamarse dentro de conHoraFija().
 */
function armarBoletaComoBin(
    FirmaElectronica $firmador,
    GeneradorBoleta $generador,
    string $caf,
    array $emisor,
    array $receptor,
    string $folio,
    array $detalles,
    string $tipo,
    ?array $referencia,
    ?array $descuento = null,
): string {
    $xmlDte = $generador->generarBoleta($emisor, $receptor, $folio, $detalles, $tipo, $referencia, $descuento);

    $dom = new DOMDocument();
    $dom->loadXML($xmlDte);
    $montoTotal = $dom->getElementsByTagName('MntTotal')->item(0)->nodeValue;
    $item1 = $dom->getElementsByTagName('NmbItem')->item(0)->nodeValue;

    $datosDte = [
        'rut_emisor' => $emisor['rut'],
        'tipo_dte' => $tipo,
        'folio' => $folio,
        'fecha' => fechaParidad('Y-m-d', null),
        'rut_receptor' => $receptor['rut'],
        'razon_social_receptor' => $receptor['razon_social'],
        'monto_total' => $montoTotal,
        'nombre_item_1' => $item1,
    ];

    $timbre = new Timbre($caf);
    $stringTed = $timbre->generarTed($datosDte);
    $tmstFirma = '<TmstFirma>'.fechaParidad('Y-m-d\TH:i:s', null).'</TmstFirma>';

    $xmlDteConTed = str_replace('</Documento>', $stringTed."\n".$tmstFirma."\n</Documento>", $xmlDte);
    $referenciaUri = '#F'.$folio.'T'.$tipo;

    return $firmador->firmarDte($xmlDteConTed, $referenciaUri);
}

/**
 * Marcas de hora de la salida. Cada etiqueta debe aparecer al menos una vez y
 * con un único valor (un solo reloj para todo el armado).
 *
 * @param  list<string>  $etiquetas
 * @return array<string, string>
 */
function marcasUnicas(string $xml, array $etiquetas): array
{
    $marcas = [];
    foreach ($etiquetas as $etiqueta) {
        preg_match_all("/<{$etiqueta}>([^<]+)<\\/{$etiqueta}>/", $xml, $m);
        $valores = array_values(array_unique($m[1]));
        if (count($valores) !== 1) {
            throw new RuntimeException("<{$etiqueta}> debe tener un único valor (hay ".count($valores).').');
        }
        $marcas[$etiqueta] = $valores[0];
    }

    return $marcas;
}

return [
    'armar-boleta' => static function (array $entrada, array $material): array {
        $firmador = new FirmaElectronica($material['llave'], $material['certificado']);
        $caf = leerMaterial((string) $entrada['caf']);

        $dte = conHoraFija(
            (string) $entrada['ahora'],
            static fn (): string => armarBoletaComoBin(
                $firmador,
                new GeneradorBoleta(),
                $caf,
                $entrada['emisor'],
                $entrada['receptor'],
                (string) $entrada['folio'],
                $entrada['detalles'],
                (string) ($entrada['tipo_dte'] ?? '39'),
                $entrada['referencia'] ?? null,
                $entrada['descuento'] ?? null,
            ),
        );

        return [$dte, marcasUnicas($dte, ['FchEmis', 'TSTED', 'TmstFirma'])];
    },
];
