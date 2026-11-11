<?php

/**
 * Hora fija para los esperados de paridad (PLAN §5.1, punto 3).
 *
 * El core PHP llama a date() sin calificar desde sus namespaces, así que PHP
 * busca primero <namespace>\date() y solo si no existe usa la global. Este
 * archivo define ese date() en cada namespace del core que estampa hora
 * (Core: FchEmis, TSTED, TmstFirmaEnv del EnvioBOLETA; Certificacion:
 * TmstFirmaEnv del RCOF). Si hay una hora fijada con conHoraFija() y no se pasa
 * un timestamp explícito, formatea esa hora en America/Santiago; si no, delega
 * en \date(). Sin esto las marcas cambiarían en cada corrida y los esperados no
 * serían deterministas (el job paridad-php del CI fallaría siempre). El core no
 * se toca.
 *
 * generar.php lo carga ANTES que las operaciones: PHP cachea a qué función
 * resuelve cada llamada la primera vez que se ejecuta, así que el date() del
 * namespace tiene que existir antes de la primera llamada del core.
 *
 * Las operaciones usan:
 *
 *   [$resultado, $timestamp] = conHoraFija($entrada['ahora'], fn () => ...);
 */

declare(strict_types=1);

namespace Winex\Certificacion\Core {
    if (! function_exists('Winex\Certificacion\Core\date')) {
        function date(string $formato, ?int $timestamp = null): string
        {
            return \fechaParidad($formato, $timestamp);
        }
    }
}

namespace Winex\Certificacion\Certificacion {
    if (! function_exists('Winex\Certificacion\Certificacion\date')) {
        function date(string $formato, ?int $timestamp = null): string
        {
            return \fechaParidad($formato, $timestamp);
        }
    }
}

namespace {
    /** date() con la hora fijada por conHoraFija(), si la hay. */
    function fechaParidad(string $formato, ?int $timestamp): string
    {
        $fijo = $GLOBALS['PARIDAD_AHORA'] ?? null;
        if ($timestamp !== null || $fijo === null) {
            return \date($formato, $timestamp);
        }

        return (new \DateTimeImmutable('@'.$fijo))
            ->setTimezone(new \DateTimeZone('America/Santiago'))
            ->format($formato);
    }

    /**
     * Ejecuta $funcion con la hora de Chile $ahora (YYYY-MM-DDTHH:MM:SS) fijada
     * para todos los date() del core. Devuelve lo que devuelva $funcion.
     *
     * @template T
     * @param  callable(): T  $funcion
     * @return T
     */
    function conHoraFija(string $ahora, callable $funcion): mixed
    {
        $instante = \DateTimeImmutable::createFromFormat(
            '!Y-m-d\TH:i:s',
            $ahora,
            new \DateTimeZone('America/Santiago'),
        ) ?: throw new \RuntimeException("Hora inválida: {$ahora}");

        $GLOBALS['PARIDAD_AHORA'] = $instante->getTimestamp();
        try {
            return $funcion();
        } finally {
            unset($GLOBALS['PARIDAD_AHORA']);
        }
    }
}
