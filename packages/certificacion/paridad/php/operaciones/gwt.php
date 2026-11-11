<?php

/**
 * Operaciones de paridad de GWT-RPC (GwtRpc / LectorGwt), las que usa
 * DeclaracionBoletas. No son HTTP: comparan el cuerpo que arma GwtRpc::llamada()
 * y lo que entrega el lector con una respuesta.
 *
 * - `gwtLlamada`: entrada `{base, policy, servicio, metodo, parametros}`, donde
 *   cada parámetro es `{tipo: <firma>, pasos: [<paso>, ...]}` y cada paso uno de:
 *     ["string", "x" | null]   ["int", 5]   ["nulo"]   ["integer", 5 | null]
 *     ["long", "<decimal>" | null]   ["tipo", "<firma>"]
 *     ["valor", <objeto>]      (objeto como lo entrega el lector; long como texto decimal)
 *     ["valorLeido", {respuesta | respuestaBase64, esquemas}]  (lee el objeto() de esa
 *                               respuesta y lo reescribe con valor(), como DeclaracionBoletas)
 *   Salida: el cuerpo exacto; si GwtRpc lanza PostulacionException, `#error <mensaje>`.
 *
 * - `gwtLeer`: entrada `{respuesta | respuestaBase64, esquemas, lecturas}`, con
 *   `lecturas` una lista de "objeto" | "string" | "esNulo". Salida: JSON
 *   `{lecturas: [{objeto: ...} | {string: ...} | {esNulo: ...}], error: null | {clase, mensaje}}`
 *   (las lecturas hechas antes del error). Los long van como texto decimal.
 *
 * Marcas (`meta.json`): valores que el PHP no puede representar y altera en
 * silencio, para separar los casos que Node trata distinto a propósito:
 *   longsSaturados    long del caso fuera de 64 bits ((int) satura)
 *   numerosInexactos  números de la respuesta decimales o fuera de 64 bits
 *                     ((int) trunca o satura)
 */

declare(strict_types=1);

use Winex\Certificacion\Postulacion\GwtRpc;
use Winex\Certificacion\Postulacion\PostulacionException;

$gwtMarcar = static function (array &$marcas, string $clave, string $valor): void {
    $marcas[$clave] = isset($marcas[$clave]) ? $marcas[$clave].', '.$valor : $valor;
};

// Texto decimal a int, marcando lo que (int) no conserva.
$gwtEntero = static function (string $s, array &$marcas) use ($gwtMarcar): int {
    $i = (int) $s;
    if ((string) $i !== $s) {
        $gwtMarcar($marcas, 'longsSaturados', $s);
    }

    return $i;
};

$gwtRespuesta = static function (array $e): string {
    if (isset($e['respuestaBase64'])) {
        $b = base64_decode((string) $e['respuestaBase64'], true);
        if ($b === false) {
            throw new InvalidArgumentException('respuestaBase64 inválido');
        }

        return $b;
    }

    return (string) $e['respuesta'];
};

// Números del payload que (int) truncaría o saturaría (fuera de los strings).
$gwtNumerosInexactos = static function (string $respuesta, array &$marcas) use ($gwtMarcar): void {
    $sinStrings = (string) preg_replace('/"(?:[^"\\\\]|\\\\.)*"|\'(?:[^\'\\\\]|\\\\.)*\'/s', '""', $respuesta);
    if (preg_match_all('/-?\d+(\.\d+)?/', $sinStrings, $m)) {
        foreach ($m[0] as $t) {
            $canonico = preg_replace('/^(-?)0+(?=\d)/', '$1', $t);
            if ($canonico === '-0') {
                $canonico = '0';
            }
            if (str_contains($t, '.') || (string) (int) $t !== $canonico) {
                $gwtMarcar($marcas, 'numerosInexactos', $t);
            }
        }
    }
};

// Objeto JSON del caso → arreglo de GwtRpc (long de texto a int).
$gwtObjeto = static function (mixed $o, array &$marcas) use (&$gwtObjeto, $gwtEntero): mixed {
    if (! is_array($o) || ! isset($o['@tipo'])) {
        return $o;
    }
    if ($o['@tipo'] === GwtRpc::LONG && is_string($o['valor'] ?? null)) {
        $o['valor'] = $gwtEntero($o['valor'], $marcas);
    }
    if (isset($o['elementos'])) {
        foreach ($o['elementos'] as $k => $e) {
            $o['elementos'][$k] = $gwtObjeto($e, $marcas);
        }
    }
    if (isset($o['campos'])) {
        foreach ($o['campos'] as $k => $c) {
            if (! in_array($c[0], ['S', 'B'], true)) {
                $o['campos'][$k][1] = $gwtObjeto($c[1], $marcas);
            }
        }
    }

    return $o;
};

// Objeto del lector → JSON (long a texto decimal).
$gwtJson = static function (mixed $o) use (&$gwtJson): mixed {
    if (! is_array($o) || ! isset($o['@tipo'])) {
        return $o;
    }
    if ($o['@tipo'] === GwtRpc::LONG && array_key_exists('valor', $o)) {
        $o['valor'] = (string) $o['valor'];
    }
    if (isset($o['elementos'])) {
        $o['elementos'] = array_map($gwtJson, $o['elementos']);
    }
    if (isset($o['campos'])) {
        $o['campos'] = array_map(
            fn ($c) => [$c[0], in_array($c[0], ['S', 'B'], true) ? $c[1] : $gwtJson($c[1])],
            $o['campos'],
        );
    }

    return $o;
};

$gwtPaso = static function (GwtRpc $w, array $paso, array &$marcas) use ($gwtEntero, $gwtObjeto, $gwtRespuesta, $gwtNumerosInexactos): void {
    $arg = $paso[1] ?? null;
    match ($paso[0]) {
        'string' => $w->string($arg),
        'int' => $w->int($arg),
        'nulo' => $w->nulo(),
        'integer' => $w->integer($arg),
        'long' => $w->long($arg === null ? null : $gwtEntero((string) $arg, $marcas)),
        'tipo' => $w->tipo($arg),
        'valor' => $w->valor($gwtObjeto($arg, $marcas)),
        'valorLeido' => (static function () use ($w, $arg, &$marcas, $gwtRespuesta, $gwtNumerosInexactos): void {
            $respuesta = $gwtRespuesta($arg);
            $gwtNumerosInexactos($respuesta, $marcas);
            $w->valor(GwtRpc::leer($respuesta, $arg['esquemas'] ?? [])->objeto());
        })(),
        default => throw new InvalidArgumentException("Paso GWT desconocido: {$paso[0]}"),
    };
};

return [
    'gwtLlamada' => static function (array $entrada, array $material) use ($gwtPaso): array {
        $marcas = [];
        $params = [];
        foreach ($entrada['parametros'] as $p) {
            $params[] = [$p['tipo'], static function (GwtRpc $w) use ($p, &$marcas, $gwtPaso): void {
                foreach ($p['pasos'] as $paso) {
                    $gwtPaso($w, $paso, $marcas);
                }
            }];
        }

        try {
            $bytes = GwtRpc::llamada($entrada['base'], $entrada['policy'], $entrada['servicio'], $entrada['metodo'], $params);
        } catch (PostulacionException $e) {
            $bytes = '#error '.$e->getMessage();
        }

        return [$bytes, $marcas];
    },

    'gwtLeer' => static function (array $entrada, array $material) use ($gwtRespuesta, $gwtNumerosInexactos, $gwtJson): array {
        $marcas = [];
        $respuesta = $gwtRespuesta($entrada);
        $gwtNumerosInexactos($respuesta, $marcas);

        $salida = ['lecturas' => [], 'error' => null];
        try {
            $lector = GwtRpc::leer($respuesta, $entrada['esquemas'] ?? []);
            foreach ($entrada['lecturas'] as $lectura) {
                $salida['lecturas'][] = match ($lectura) {
                    'objeto' => ['objeto' => $gwtJson($lector->objeto())],
                    'string' => ['string' => $lector->string()],
                    'esNulo' => ['esNulo' => $lector->esNulo()],
                };
            }
        } catch (Throwable $e) {
            $clase = (new ReflectionClass($e))->getShortName();
            $salida['error'] = ['clase' => $clase, 'mensaje' => $e->getMessage()];
        }

        $json = json_encode($salida, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n";

        return [$json, $marcas];
    },
];
