<?php

/**
 * Operación de paridad `estadoEnvio`: Certificacion\EstadoEnvio::desdeRespuesta().
 *
 * Entrada: `respuesta` (respuesta de QueryEstUp, anonimizada) y `trackId`.
 *
 * Salida: JSON con las propiedades del EstadoEnvio y lo que devuelven
 * enProceso(), procesado(), limpio() y resumen(); o `error` con la clase y el
 * mensaje de la excepción.
 */

declare(strict_types=1);

use Winex\Certificacion\Certificacion\EstadoEnvio;

return [
    'estadoEnvio' => static function (array $entrada, array $material): array {
        try {
            $estado = EstadoEnvio::desdeRespuesta((string) $entrada['respuesta'], (string) $entrada['trackId']);
            $salida = [
                'trackId' => $estado->trackId,
                'estado' => $estado->estado,
                'glosa' => $estado->glosa,
                'informados' => $estado->informados,
                'aceptados' => $estado->aceptados,
                'rechazados' => $estado->rechazados,
                'reparos' => $estado->reparos,
                'enProceso' => $estado->enProceso(),
                'procesado' => $estado->procesado(),
                'limpio' => $estado->limpio(),
                'resumen' => $estado->resumen(),
            ];
        } catch (RuntimeException $e) {
            $salida = ['error' => ['clase' => get_class($e), 'mensaje' => $e->getMessage()]];
        }

        return [
            json_encode($salida, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n",
            [],
        ];
    },
];
