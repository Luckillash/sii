<?php

/**
 * Generador de salidas esperadas de paridad.
 *
 * Ejecuta cada caso de paridad/casos/*.json con la librería PHP original
 * (winex/certificacion, en ../certificacion-core o en $CERTIFICACION_CORE) y
 * guarda en paridad/esperados/:
 *
 *   <caso>.bin        bytes exactos que produce el PHP
 *   <caso>.meta.json  operación, versión del core, sha256 y marcas de hora
 *                     extraídas de la salida (para inyectarlas en Node)
 *
 * Los esperados NO se editan a mano. Uso:
 *
 *   pnpm paridad:generar [caso ...] (desde la raíz de certificacion-node)
 *   php paridad/php/generar.php [caso ...]
 *
 * `pnpm paridad:generar` corre paridad/http/generar.mjs, que levanta el servidor
 * de captura y llama a este script; sin él, los casos HTTP fallan con un mensaje
 * claro (ver http.php) y el resto funciona igual.
 *
 * La salida es determinista: correrlo dos veces con el mismo core produce los
 * mismos archivos (el CI lo usa para detectar cambios en el PHP).
 */

declare(strict_types=1);

$raiz = dirname(__DIR__, 2);
$dirCasos = $raiz.'/paridad/casos';
$dirEsperados = $raiz.'/paridad/esperados';
$dirMaterial = $raiz.'/paridad/material';

$core = getenv('CERTIFICACION_CORE') ?: dirname($raiz).'/certificacion-core';
if (! is_dir($core)) {
    $core = $raiz.'/'.$core;
}
$autoload = $core.'/vendor/autoload.php';
if (! is_file($autoload)) {
    fwrite(STDERR, "No se encontró {$autoload}.\nEjecuta `composer install` en el core PHP o define CERTIFICACION_CORE.\n");
    exit(2);
}
require $autoload;

$composer = json_decode((string) file_get_contents($core.'/composer.json'), true, flags: JSON_THROW_ON_ERROR);
$versionCore = (string) ($composer['version'] ?? 'desconocida');

define('PARIDAD_MATERIAL', $dirMaterial);

// Antes que las operaciones: define date() en los namespaces del core (ver el archivo).
require __DIR__.'/hora-fija.php';
// Paridad de requests HTTP: conCapturaHttp(), origenCaptura(), hostCaptura()...
require __DIR__.'/http.php';

/**
 * Bytes de un archivo de paridad/material/ (p. ej. un .pfx o un CAF de prueba).
 * Para las operaciones que necesitan más material que la llave y el certificado base.
 */
function leerMaterial(string $archivo): string
{
    $ruta = PARIDAD_MATERIAL.'/'.$archivo;
    if (str_contains($archivo, '..') || ! is_file($ruta)) {
        throw new RuntimeException("Material desconocido: {$archivo}");
    }

    return (string) file_get_contents($ruta);
}

/** Material criptográfico de prueba (nunca real). */
function material(string $dir, string $nombre): array
{
    if ($nombre !== 'base') {
        throw new RuntimeException("Material desconocido: {$nombre}");
    }

    return [
        'llave' => (string) file_get_contents($dir.'/llave.pem'),
        'certificado' => (string) file_get_contents($dir.'/certificado.pem'),
    ];
}

/**
 * Operaciones conocidas: cada archivo de php/operaciones/ devuelve un mapa
 * operación => function (array $entrada, array $material): array{string, array}.
 *
 * @return array<string, callable>
 */
function operaciones(): array
{
    $todas = [];
    $archivos = glob(__DIR__.'/operaciones/*.php') ?: [];
    sort($archivos, SORT_STRING);
    foreach ($archivos as $archivo) {
        foreach (require $archivo as $nombre => $funcion) {
            if (isset($todas[$nombre])) {
                throw new RuntimeException("Operación duplicada: {$nombre} (".basename($archivo).')');
            }
            $todas[$nombre] = $funcion;
        }
    }

    return $todas;
}

/**
 * Ejecuta un caso y devuelve [bytes, marcas]. Las marcas son las horas que el
 * PHP estampa con date() y que Node debe recibir inyectadas.
 */
function ejecutar(array $caso, string $dirMaterial, array $operaciones): array
{
    $funcion = $operaciones[$caso['operacion']]
        ?? throw new RuntimeException("Operación desconocida: {$caso['operacion']}");

    // El material solo se carga si el caso lo pide (las operaciones XML no lo usan).
    $material = isset($caso['material']) ? material($dirMaterial, $caso['material']) : [];

    return $funcion($caso['entrada'] ?? [], $material);
}

$filtro = array_slice($argv, 1);
$archivos = glob($dirCasos.'/*.json') ?: [];
sort($archivos, SORT_STRING);

if (! is_dir($dirEsperados)) {
    mkdir($dirEsperados, 0777, true);
}

$operaciones = operaciones();
$generados = 0;
foreach ($archivos as $archivo) {
    $nombre = basename($archivo, '.json');
    if ($filtro !== [] && ! in_array($nombre, $filtro, true)) {
        continue;
    }

    $caso = json_decode((string) file_get_contents($archivo), true, flags: JSON_THROW_ON_ERROR);
    [$bytes, $marcas] = ejecutar($caso, $dirMaterial, $operaciones);

    file_put_contents("{$dirEsperados}/{$nombre}.bin", $bytes);

    $meta = [
        'caso' => $nombre,
        'operacion' => $caso['operacion'],
        'core' => $versionCore,
        'bytes' => strlen($bytes),
        'sha256' => hash('sha256', $bytes),
        'marcas' => (object) $marcas,
    ];
    file_put_contents(
        "{$dirEsperados}/{$nombre}.meta.json",
        json_encode($meta, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR)."\n",
    );

    echo "  {$nombre}: ".strlen($bytes)." bytes\n";
    $generados++;
}

echo "{$generados} caso(s) generado(s) con winex/certificacion {$versionCore}.\n";
