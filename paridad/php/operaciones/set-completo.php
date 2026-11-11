<?php

/**
 * Operaciones de paridad del set de pruebas de punta a punta (criterio de
 * salida de la fase 3):
 *
 * - `set-completo`: bin/certificacion/enviar-set-boletas.php con el set real,
 *   sin el envío. Devuelve los bytes de EnvioBoleta::empaquetar(), NO los del
 *   archivo que escribe el bin (que además pasa por mb_convert_encoding: pend. 1.1).
 * - `rcof-set-completo`: bin/certificacion/enviar-consumo-folios.php, con los
 *   montos calculados con la fórmula del bin a partir de los montos del set, y
 *   firmado con firmarDte($rcof, '#RCOF').
 *
 * Entrada (la misma en los dos casos):
 *   ahora         hora de Chile (YYYY-MM-DDTHH:MM:SS) de todas las marcas
 *   archivo       set de pruebas, relativo a la raíz de certificacion-node
 *   caf           archivo de paridad/material/ (CAF de prueba de tipo 39)
 *   folioInicial  primer folio; los casos usan folios consecutivos desde él
 *   emisor        ['rut', 'razon_social', 'giro', 'direccion', 'comuna'] (RUT de prueba)
 *   receptor      ['rut', 'razon_social'] (el bin usa 66666666-6 / Cliente General)
 *   rutEnvia      RUT de quien firma (de prueba)
 *   nroResol      número de resolución
 *   fchResol      FchResol del sobre (el bin usa '2026-09-05')
 *   fchResolRcof  FchResol del RCOF (el bin usa '2026-09-04': distinta, ver pend. 5)
 *   secEnvio      SecEnvio del RCOF
 *
 * Marcas: TmstFirmaEnv (y en el set también FchEmis, TSTED y TmstFirma), cada
 * una con un único valor.
 */

declare(strict_types=1);

use Winex\Certificacion\Certificacion\GeneradorConsumoFolios;
use Winex\Certificacion\Certificacion\SetPruebasParser;
use Winex\Certificacion\Core\EnvioBoleta;
use Winex\Certificacion\Core\FirmaElectronica;
use Winex\Certificacion\Core\GeneradorBoleta;

/** Los casos del set (SetPruebasParser lee la ruta, como en el bin). */
function casosSetCompleto(array $entrada): array
{
    $relativa = (string) $entrada['archivo'];
    $ruta = dirname(PARIDAD_MATERIAL, 2).'/'.$relativa;
    if (str_contains($relativa, '..') || ! is_file($ruta)) {
        throw new RuntimeException("Archivo de entrada desconocido: {$relativa}");
    }

    return (new SetPruebasParser())->parsear($ruta, '39');
}

return [
    'set-completo' => static function (array $entrada, array $material): array {
        $firmador = new FirmaElectronica($material['llave'], $material['certificado']);
        $caf = leerMaterial((string) $entrada['caf']);
        $casos = casosSetCompleto($entrada);
        $emisor = $entrada['emisor'];
        $receptor = $entrada['receptor'];

        $sobre = conHoraFija((string) $entrada['ahora'], static function () use ($firmador, $caf, $casos, $emisor, $receptor, $entrada): string {
            $folio = (int) $entrada['folioInicial'];
            $generador = new GeneradorBoleta();
            $dtesFirmados = '';
            foreach ($casos as $caso) {
                $dtesFirmados .= armarBoletaComoBin(
                    $firmador,
                    $generador,
                    $caf,
                    $emisor,
                    $receptor,
                    (string) $folio,
                    $caso['det'],
                    $caso['tipo'],
                    $caso['ref'],
                )."\n";
                $folio++;
            }

            $empaquetador = new EnvioBoleta($firmador, $emisor['rut'], $entrada['rutEnvia'], $entrada['nroResol'], $entrada['fchResol']);

            return $empaquetador->empaquetar($dtesFirmados);
        });

        return [$sobre, marcasUnicas($sobre, ['FchEmis', 'TSTED', 'TmstFirma', 'TmstFirmaEnv'])];
    },

    'rcof-set-completo' => static function (array $entrada, array $material): array {
        $firmador = new FirmaElectronica($material['llave'], $material['certificado']);
        $casos = casosSetCompleto($entrada);

        // Montos brutos (IVA incluido) por caso y exento, desde el set: lo que
        // el bin escribe a mano en $montosBrutosPorCaso y $montoExento.
        $montosBrutosPorCaso = [];
        $montoExento = 0;
        foreach ($casos as $caso) {
            $bruto = 0;
            foreach ($caso['det'] as $item) {
                $monto = (int) round($item['cantidad'] * $item['precio']);
                if (($item['exento'] ?? false) === true) {
                    $montoExento += $monto;
                } else {
                    $bruto += $monto;
                }
            }
            $montosBrutosPorCaso[] = $bruto;
        }
        // Con el set de data/set_pruebas, son exactamente los del bin.
        if ($montosBrutosPorCaso !== [29800, 2040, 4100, 12720, 3500] || $montoExento !== 2000) {
            throw new RuntimeException('Los montos del set no son los del bin: '.json_encode([$montosBrutosPorCaso, $montoExento]));
        }

        $rcof = conHoraFija((string) $entrada['ahora'], static function () use ($entrada, $montosBrutosPorCaso, $montoExento): string {
            // Desde aquí, copiado de enviar-consumo-folios.php.
            $fechaBoletas = fechaParidad('Y-m-d', null);
            $folioInicial = (int) $entrada['folioInicial'];
            $folioFinal = $folioInicial + count($montosBrutosPorCaso) - 1;
            $secEnvio = (int) $entrada['secEnvio'];

            $mntNeto = 0;
            $mntIVA = 0;
            foreach ($montosBrutosPorCaso as $bruto) {
                $neto = (int) round($bruto / 1.19);
                $mntNeto += $neto;
                $mntIVA += $bruto - $neto;
            }
            $mntTotal = $mntNeto + $mntIVA + $montoExento;
            $cantidadDocs = count($montosBrutosPorCaso);

            $caratula = [
                'rut_emisor' => $entrada['emisor']['rut'],
                'rut_envia' => $entrada['rutEnvia'],
                'fch_resol' => $entrada['fchResolRcof'],
                'nro_resol' => $entrada['nroResol'],
                'fch_inicio' => $fechaBoletas,
                'fch_final' => $fechaBoletas,
                'sec_envio' => $secEnvio,
            ];

            $resumenes = [
                [
                    'tipo' => '39',
                    'neto' => $mntNeto,
                    'iva' => $mntIVA,
                    'tasa_iva' => '19.00',
                    'exento' => $montoExento,
                    'total' => $mntTotal,
                    'folios_emitidos' => $cantidadDocs,
                    'folios_anulados' => 0,
                    'folios_utilizados' => $cantidadDocs,
                    'rangos_utilizados' => [
                        ['inicial' => $folioInicial, 'final' => $folioFinal],
                    ],
                    'rangos_anulados' => [],
                ],
            ];

            return (new GeneradorConsumoFolios())->generar($caratula, $resumenes);
        });

        $firmado = $firmador->firmarDte($rcof, '#RCOF');

        return [$firmado, marcasUnicas($firmado, ['TmstFirmaEnv'])];
    },
];
