<?php

/**
 * Valida contra los XSD del SII los esperados de paridad que se envían al SII.
 *
 * Lee paridad/xsd.json (patrón de caso → esquema de data/schemas/) y valida cada
 * paridad/esperados/<caso>.bin que calce con un patrón. Como Node produce esos
 * mismos bytes (los tests de paridad lo exigen), validar los esperados valida
 * también la salida de Node.
 *
 * Uso (desde la raíz de certificacion-node):
 *
 *   pnpm paridad:xsd                          (= php paridad/php/validar-xsd.php)
 *   php paridad/php/validar-xsd.php --xmllint --estricto      (lo que corre el CI)
 *
 * Opciones:
 *   --xmllint   valida con `xmllint --noout --schema` en vez de DOMDocument::schemaValidate
 *               (ambos usan libxml; el CI usa xmllint).
 *   --estricto  falla si un patrón con "obligatorio": true no calza con ningún esperado.
 *               Sin esta opción solo se avisa (útil en local mientras un caso no existe).
 *
 * Código de salida: 0 si todo valida, 1 si algo no valida o falta, 2 si hay un error
 * de uso o de configuración (manifiesto, esquema o xmllint ausentes).
 */

declare(strict_types=1);

$raiz = dirname(__DIR__, 2);
$dirEsperados = $raiz.'/paridad/esperados';
$dirEsquemas = $raiz.'/data/schemas';
$manifiesto = $raiz.'/paridad/xsd.json';

$opciones = array_slice($argv, 1);
$conXmllint = in_array('--xmllint', $opciones, true);
$estricto = in_array('--estricto', $opciones, true);
$desconocidas = array_diff($opciones, ['--xmllint', '--estricto']);
if ($desconocidas !== []) {
    fwrite(STDERR, 'Opción desconocida: '.implode(' ', $desconocidas)."\nUso: php paridad/php/validar-xsd.php [--xmllint] [--estricto]\n");
    exit(2);
}

/** Termina con código 2 (error de configuración, no de validación). */
function abortar(string $mensaje): never
{
    fwrite(STDERR, $mensaje."\n");
    exit(2);
}

try {
    $config = json_decode((string) file_get_contents($manifiesto), true, flags: JSON_THROW_ON_ERROR);
} catch (Throwable $e) {
    abortar("No se pudo leer {$manifiesto}: {$e->getMessage()}");
}
if (! is_array($config['esquemas'] ?? null)) {
    abortar("{$manifiesto}: falta la lista \"esquemas\".");
}

if ($conXmllint) {
    exec('xmllint --version 2>&1', $salida, $codigo);
    if ($codigo !== 0) {
        abortar('No se encontró xmllint (en Ubuntu: sudo apt-get install -y libxml2-utils).');
    }
    echo 'Motor: ', $salida[0] ?? 'xmllint', PHP_EOL;
} else {
    if (! extension_loaded('dom')) {
        abortar('Falta la extensión dom de PHP.');
    }
    echo 'Motor: DOMDocument::schemaValidate (libxml ', LIBXML_DOTTED_VERSION, ')', PHP_EOL;
}

$casos = array_map(
    fn (string $ruta): string => basename($ruta, '.bin'),
    glob($dirEsperados.'/*.bin') ?: [],
);
sort($casos, SORT_STRING);

/**
 * Valida con DOMDocument::schemaValidate.
 *
 * @return list<string> errores con el formato de xmllint (archivo:línea: mensaje)
 */
function validarConPhp(string $archivo, string $xsd, string $nombre): array
{
    $usoAnterior = libxml_use_internal_errors(true);
    libxml_clear_errors();
    $doc = new DOMDocument;
    $errores = [];
    // Sin red: los esquemas solo importan archivos locales de data/schemas/.
    if (! $doc->load($archivo, LIBXML_NONET)) {
        $errores[] = "{$nombre}: no es XML bien formado";
    } elseif (! $doc->schemaValidate($xsd)) {
        $errores[] = "{$nombre}: no valida";
    }
    foreach (libxml_get_errors() as $error) {
        $origen = $error->file !== '' && realpath($error->file) === realpath($xsd) ? basename($xsd) : $nombre;
        $errores[] = sprintf('%s:%d: %s', $origen, $error->line, trim($error->message));
    }
    libxml_clear_errors();
    libxml_use_internal_errors($usoAnterior);

    return $errores;
}

/**
 * Valida con `xmllint --noout --schema`.
 *
 * @return list<string> líneas de error de xmllint (vacía si valida)
 */
function validarConXmllint(string $archivo, string $xsd, string $nombre): array
{
    $proceso = proc_open(
        ['xmllint', '--noout', '--nonet', '--schema', $xsd, $archivo],
        // stderr (donde xmllint escribe los errores) al mismo pipe: leer dos pipes
        // en serie puede trabarse si el segundo se llena.
        [1 => ['pipe', 'w'], 2 => ['redirect', 1]],
        $tuberias,
    );
    if (! is_resource($proceso)) {
        abortar('No se pudo ejecutar xmllint.');
    }
    $salida = (string) stream_get_contents($tuberias[1]);
    fclose($tuberias[1]);
    $codigo = proc_close($proceso);
    if ($codigo === 0) {
        return [];
    }
    $lineas = array_filter(array_map('trim', explode("\n", str_replace([$archivo, $xsd], [$nombre, basename($xsd)], $salida))));

    return [...array_values($lineas), "{$nombre}: xmllint terminó con código {$codigo}"];
}

$fallos = 0;
$validados = 0;
foreach ($config['esquemas'] as $i => $regla) {
    $patron = (string) ($regla['patron'] ?? '');
    $esquema = (string) ($regla['xsd'] ?? '');
    $obligatorio = (bool) ($regla['obligatorio'] ?? false);
    if ($patron === '' || $esquema === '' || str_contains($esquema, '..')) {
        abortar("{$manifiesto}: la regla {$i} necesita \"patron\" y \"xsd\" (un archivo de data/schemas/).");
    }
    $xsd = $dirEsquemas.'/'.$esquema;
    if (! is_file($xsd)) {
        abortar("No existe el esquema {$xsd} (regla \"{$patron}\").");
    }

    $calzan = array_values(array_filter($casos, fn (string $caso): bool => fnmatch($patron, $caso)));

    // Casos que calzan con el patrón pero no son algo que se envíe al SII (motivo en el manifiesto).
    $excluir = $regla['excluir'] ?? [];
    if (! is_array($excluir)) {
        abortar("{$manifiesto}: \"excluir\" de la regla \"{$patron}\" debe ser un objeto caso → motivo.");
    }
    foreach ($excluir as $globExcluido => $motivo) {
        $omitidos = array_filter($calzan, fn (string $caso): bool => fnmatch((string) $globExcluido, $caso));
        if ($omitidos === []) {
            echo "AVISO  {$globExcluido}: la exclusión ya no calza con ningún esperado (¿quitarla?)", PHP_EOL;
        }
        foreach ($omitidos as $caso) {
            echo "OMITE  paridad/esperados/{$caso}.bin: {$motivo}", PHP_EOL;
        }
        $calzan = array_values(array_diff($calzan, $omitidos));
    }

    if ($calzan === []) {
        if ($obligatorio && $estricto) {
            echo "FALTA  {$patron}: ningún esperado calza y la regla es obligatoria", PHP_EOL;
            $fallos++;
        } else {
            echo "AVISO  {$patron}: todavía no hay esperados que calcen (se omite)", PHP_EOL;
        }

        continue;
    }

    foreach ($calzan as $caso) {
        $nombre = "paridad/esperados/{$caso}.bin";
        $archivo = $dirEsperados.'/'.$caso.'.bin';
        $errores = $conXmllint
            ? validarConXmllint($archivo, $xsd, $nombre)
            : validarConPhp($archivo, $xsd, $nombre);
        $validados++;
        if ($errores === []) {
            echo "OK     {$nombre} ({$esquema})", PHP_EOL;

            continue;
        }
        $fallos++;
        echo "FALLA  {$nombre} ({$esquema})", PHP_EOL;
        foreach ($errores as $error) {
            echo '       ', $error, PHP_EOL;
        }
    }
}

echo PHP_EOL, "{$validados} archivo(s) validado(s), {$fallos} problema(s).", PHP_EOL;
exit($fallos === 0 ? 0 : 1);
