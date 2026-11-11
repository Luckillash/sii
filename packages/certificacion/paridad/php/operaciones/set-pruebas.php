<?php

/**
 * Operación de paridad `setPruebas`: Certificacion\SetPruebasParser::parsear().
 *
 * Entrada (una de las tres fuentes, más `tipoDte` opcional):
 * - `archivo`: ruta relativa a la raíz de certificacion-node (p. ej.
 *   `data/set_pruebas/Set Prueba BE.txt`), leída tal cual.
 * - `texto`: contenido como texto (llega en UTF-8 desde el JSON).
 * - `base64`: bytes exactos (p. ej. ISO-8859-1).
 *
 * El contenido se escribe en un temporal y se le pasa la ruta al parser.
 *
 * Salida: JSON con `codificacion` y los `casos` (o `error` con la clase y el
 * mensaje de la excepción, con la ruta del temporal reemplazada por `<archivo>`).
 * De cada número se guarda el valor (JSON_PRESERVE_ZERO_FRACTION: `2.0` es float
 * y `2` es int), su `(string)` (lo que escribe GeneradorBoleta en QtyItem y
 * PrcItem) y su tipo PHP.
 *
 * El parser entrega a GeneradorBoleta los bytes del archivo. Si el archivo no es
 * UTF-8 válido (ISO-8859-1), las cadenas se pasan de ISO-8859-1 a UTF-8 solo
 * para poder escribirlas en JSON (`codificacion` lo indica). Los cortes del
 * parser caen siempre en bytes ASCII, así que cada cadena se convierte igual
 * que el archivo completo.
 */

declare(strict_types=1);

use Winex\Certificacion\Certificacion\SetPruebasParser;

return [
    'setPruebas' => static function (array $entrada, array $material): array {
        if (isset($entrada['archivo'])) {
            $relativa = (string) $entrada['archivo'];
            $ruta = dirname(PARIDAD_MATERIAL, 2).'/'.$relativa;
            if (str_contains($relativa, '..') || ! is_file($ruta)) {
                throw new RuntimeException("Archivo de entrada desconocido: {$relativa}");
            }
            $contenido = (string) file_get_contents($ruta);
        } elseif (isset($entrada['base64'])) {
            $contenido = base64_decode((string) $entrada['base64'], true);
            if ($contenido === false) {
                throw new InvalidArgumentException('base64 inválido');
            }
        } else {
            $contenido = (string) $entrada['texto'];
        }

        $utf8 = mb_check_encoding($contenido, 'UTF-8');
        $texto = static fn (string $s): string => $utf8 ? $s : mb_convert_encoding($s, 'UTF-8', 'ISO-8859-1');
        $numero = static fn (int|float $n): array => [$n, (string) $n, get_debug_type($n)];

        $temporal = tempnam(sys_get_temp_dir(), 'set_');
        try {
            file_put_contents($temporal, $contenido);
            try {
                $casos = (new SetPruebasParser)->parsear($temporal, (string) ($entrada['tipoDte'] ?? '39'));
            } catch (Exception $e) {
                $salida = ['error' => [
                    'clase' => get_class($e),
                    'mensaje' => str_replace($temporal, '<archivo>', $e->getMessage()),
                ]];
            }
        } finally {
            @unlink($temporal);
        }

        if (! isset($salida)) {
            $salida = ['codificacion' => $utf8 ? 'UTF-8' : 'ISO-8859-1', 'casos' => []];
            foreach ($casos as $caso) {
                $detalles = [];
                foreach ($caso['det'] as $det) {
                    [$cantidad, $cantidadTexto, $cantidadTipo] = $numero($det['cantidad']);
                    [$precio, $precioTexto, $precioTipo] = $numero($det['precio']);
                    $detalle = [
                        'nombre' => $texto($det['nombre']),
                        'cantidad' => $cantidad,
                        'cantidadTexto' => $cantidadTexto,
                        'cantidadTipo' => $cantidadTipo,
                        'precio' => $precio,
                        'precioTexto' => $precioTexto,
                        'precioTipo' => $precioTipo,
                    ];
                    if (array_key_exists('exento', $det)) {
                        $detalle['exento'] = $det['exento'];
                    }
                    if (array_key_exists('unidad', $det)) {
                        $detalle['unidad'] = $texto($det['unidad']);
                    }
                    $extra = array_diff(array_keys($det), ['nombre', 'cantidad', 'precio', 'exento', 'unidad']);
                    if ($extra !== []) {
                        throw new RuntimeException('Clave inesperada en el detalle: '.implode(', ', $extra));
                    }
                    $detalles[] = $detalle;
                }
                $salida['casos'][] = [
                    'tipo' => $caso['tipo'],
                    'detalles' => $detalles,
                    'referencia' => ['codigo' => $caso['ref']['codigo'], 'razon' => $texto($caso['ref']['razon'])],
                ];
            }
        }

        return [
            json_encode(
                $salida,
                JSON_PRETTY_PRINT | JSON_PRESERVE_ZERO_FRACTION | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR,
            )."\n",
            [],
        ];
    },
];
