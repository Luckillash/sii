<?php

/**
 * Operaciones de paridad de codificación de texto (mbstring), como las usan
 * Timbre, SolicitudFolios, NavegadorSii y los validadores de postulación.
 *
 * Cada texto produce una línea terminada en "\n":
 *
 * - `convertirIso`: mb_convert_encoding($t, 'ISO-8859-1', 'UTF-8').
 * - `truncarTexto`: mb_strlen($t) . '|' . mb_substr($t, 0, $largo).
 * - `decodificarTexto`: para bytes en base64, '1|' . $b si mb_check_encoding
 *   los acepta como UTF-8, o '0|' . mb_convert_encoding($b, 'UTF-8', 'ISO-8859-1').
 */

declare(strict_types=1);

return [
    'convertirIso' => static function (array $entrada, array $material): array {
        $salida = '';
        foreach ($entrada['textos'] as $texto) {
            $salida .= mb_convert_encoding((string) $texto, 'ISO-8859-1', 'UTF-8')."\n";
        }

        return [$salida, []];
    },

    'truncarTexto' => static function (array $entrada, array $material): array {
        $largo = (int) $entrada['largo'];
        $salida = '';
        foreach ($entrada['textos'] as $texto) {
            $salida .= mb_strlen((string) $texto, 'UTF-8').'|'.mb_substr((string) $texto, 0, $largo, 'UTF-8')."\n";
        }

        return [$salida, []];
    },

    'decodificarTexto' => static function (array $entrada, array $material): array {
        $salida = '';
        foreach ($entrada['bytes_base64'] as $base64) {
            $bytes = base64_decode((string) $base64, true);
            if ($bytes === false) {
                throw new InvalidArgumentException("base64 inválido: {$base64}");
            }
            $salida .= mb_check_encoding($bytes, 'UTF-8')
                ? '1|'.$bytes."\n"
                : '0|'.mb_convert_encoding($bytes, 'UTF-8', 'ISO-8859-1')."\n";
        }

        return [$salida, []];
    },
];
