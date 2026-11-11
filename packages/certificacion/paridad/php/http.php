<?php

/**
 * Paridad de requests HTTP (PLAN §5.3): lado PHP del servidor de captura.
 *
 * El servidor (paridad/http/servidor-captura.mjs) lo levanta
 * paridad/http/generar.mjs (`pnpm paridad:generar`), que pasa sus URLs en
 * PARIDAD_CAPTURA_HTTP / _HTTPS / _HTTPS2 y la CA de prueba en curl.cainfo y
 * openssl.cafile. Con `php paridad/php/generar.php` a secas no hay servidor: los
 * casos que no son HTTP funcionan igual, y los HTTP se detienen con un mensaje
 * que lo explica.
 *
 * Una operación HTTP hace:
 *
 *   [$peticiones, $resultado] = conCapturaHttp($entrada['http'], function () {
 *       $cliente = new SiiSoapClient($firma, hostCaptura('https'));
 *       return $cliente->consultarEstado(...);
 *   });
 *
 * y devuelve [$peticiones, []] (o agrega $resultado a los bytes si también
 * quiere comparar lo que el cliente hizo con la respuesta). $peticiones son las
 * peticiones grabadas, ya normalizadas por el servidor: son los bytes del
 * esperado. La normalización vive solo en el servidor, así que es la misma que
 * aplican los tests de Node.
 *
 * Orígenes: 'http' (http://127.0.0.1:P), 'https' y 'https2' (https://localhost:P,
 * con el certificado de prueba). Dos orígenes TLS para los clientes que hablan
 * con dos hosts (REST: autenticación y envío), así la salida muestra a cuál fue
 * cada petición.
 */

declare(strict_types=1);

/** URL base de un origen del servidor de captura, sin '/' final. */
function origenCaptura(string $origen = 'https'): string
{
    $variable = match ($origen) {
        'http' => 'PARIDAD_CAPTURA_HTTP',
        'https' => 'PARIDAD_CAPTURA_HTTPS',
        'https2' => 'PARIDAD_CAPTURA_HTTPS2',
        default => throw new InvalidArgumentException("Origen de captura desconocido: {$origen}"),
    };
    $url = getenv($variable);
    if ($url === false || $url === '') {
        throw new RuntimeException(
            "Este caso hace peticiones HTTP y no hay servidor de captura ({$variable} no está definida).\n"
            .'Genera con `pnpm paridad:generar` (o `node paridad/http/generar.mjs <caso>`), que lo levanta.'
        );
    }

    return rtrim($url, '/');
}

/** 'localhost:P' de un origen: el $host que reciben los clientes que arman https://{$host}/... (SOAP). */
function hostCaptura(string $origen = 'https'): string
{
    $url = origenCaptura($origen);

    return parse_url($url, PHP_URL_HOST).':'.parse_url($url, PHP_URL_PORT);
}

/** Cambia una propiedad privada (p. ej. las URLs base fijas de SiiBoletaProduccion). */
function fijarPropiedadPrivada(object $objeto, string $propiedad, mixed $valor): void
{
    $reflejo = new ReflectionProperty($objeto, $propiedad);
    $reflejo->setAccessible(true);
    $reflejo->setValue($objeto, $valor);
}

/**
 * Apunta un SiiBoletaProduccion al servidor de captura: autenticación
 * (baseUrlAuth, api/apicert) al origen 'https' y envío (baseUrlEnvio,
 * rahue/pangal) a 'https2'. Conserva la ruta /recursos/v1.
 */
function apuntarBoletaProduccionACaptura(object $cliente): void
{
    fijarPropiedadPrivada($cliente, 'baseUrlAuth', origenCaptura('https').'/recursos/v1');
    fijarPropiedadPrivada($cliente, 'baseUrlEnvio', origenCaptura('https2').'/recursos/v1');
}

/** Petición al protocolo de control del servidor (origen 'http', rutas /__captura/). */
function controlCaptura(string $metodo, string $ruta, ?string $cuerpo = null): string
{
    $contexto = stream_context_create(['http' => [
        'method' => $metodo,
        'header' => $cuerpo === null ? [] : ['Content-Type: application/json'],
        'content' => $cuerpo ?? '',
        'ignore_errors' => true,
        'timeout' => 10,
    ]]);
    $respuesta = @file_get_contents(origenCaptura('http').'/__captura/'.$ruta, false, $contexto);
    $status = isset($http_response_header[0]) && preg_match('#^HTTP/\S+ (\d{3})#', $http_response_header[0], $m)
        ? (int) $m[1]
        : 0;
    if ($respuesta === false || $status < 200 || $status > 299) {
        $detalle = $respuesta === false ? (error_get_last()['message'] ?? 'sin detalle') : $respuesta;
        throw new RuntimeException("El servidor de captura respondió {$status} a {$metodo} /__captura/{$ruta}: {$detalle}");
    }

    return $respuesta;
}

/**
 * Carga el caso HTTP ($entrada['http']: respuestas grabadas y opciones de
 * normalización) en el servidor, ejecuta $funcion y devuelve
 * [peticiones normalizadas, lo que devolvió $funcion].
 *
 * Si $funcion lanza, la excepción sigue de largo (el caso falla). Para comparar
 * un camino de error, la operación la captura ella misma dentro de $funcion.
 *
 * @template T
 * @param  callable(): T  $funcion
 * @return array{0: string, 1: T}
 */
function conCapturaHttp(array $http, callable $funcion): array
{
    origenCaptura('http'); // falla con un mensaje claro si no hay servidor
    foreach (['curl.cainfo', 'openssl.cafile'] as $ini) {
        if ((string) ini_get($ini) === '') {
            throw new RuntimeException("Falta {$ini} con la CA de prueba: genera con `pnpm paridad:generar`.");
        }
    }

    controlCaptura('POST', 'caso', json_encode((object) $http, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE));
    $resultado = $funcion();

    return [controlCaptura('GET', 'normalizado'), $resultado];
}
