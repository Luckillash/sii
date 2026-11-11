<?php

/**
 * Operación de paridad `httpBuildQuery`: el cuerpo x-www-form-urlencoded que
 * arma el core PHP con http_build_query() (Folios/TransporteCurl::enviar() y la
 * query de Postulacion/DeclaracionBoletas).
 *
 * Entrada:
 *   campos     lista de pares [clave, valor]; cada uno es un string UTF-8 o
 *              {"base64": "..."} para bytes arbitrarios.
 *   iso88591   si es true, los valores se convierten antes a ISO-8859-1 con
 *              mb_convert_encoding(), igual que PostulacionSii::enviar().
 */

declare(strict_types=1);

return [
    'httpBuildQuery' => static function (array $entrada, array $material): array {
        $bytes = static fn (string|array $v): string => is_array($v)
            ? (string) base64_decode((string) $v['base64'], true)
            : $v;

        $datos = [];
        foreach ($entrada['campos'] ?? [] as [$clave, $valor]) {
            $datos[$bytes($clave)] = $bytes($valor);
        }

        if (($entrada['iso88591'] ?? false) === true) {
            $datos = array_map(
                static fn (string $v): string => mb_convert_encoding($v, 'ISO-8859-1', 'UTF-8'),
                $datos,
            );
        }

        return [http_build_query($datos), []];
    },
];
