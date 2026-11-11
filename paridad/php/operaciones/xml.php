<?php

/**
 * Operaciones de paridad del XML: el serializador estilo libxml y el escape.
 *
 * - `serializarXml`: arma un árbol con DOMDocument (createElement con valor,
 *   setAttribute, appendChild...) a partir de su descripción en JSON y devuelve
 *   saveXML(). Es lo que hacen GeneradorBoleta y GeneradorConsumoFolios.
 * - `reserializarXml`: loadXML (preserveWhiteSpace) + saveXML(), opcionalmente
 *   con un nodo importado al final de la raíz. Es lo que hace firmarDte.
 * - `escaparXml`: las tres variantes de htmlspecialchars que usa el core.
 *
 * Descripción de un nodo (`documento` es la lista de hijos del documento):
 *
 *   {"elemento": "Nombre", "valor": "...", "escapar": "<modo>",
 *    "atributos": [["nombre", "valor"], ...], "hijos": [...]}
 *   {"texto": "..."}   {"comentario": "..."}   {"cdata": "..."}
 *   {"pi": "destino"}  {"pi": "destino", "datos": "..."}
 *
 * `escapar` pasa `valor` por htmlspecialchars (modo de `escaparXml`) antes de
 * createElement, como hace GeneradorBoleta.
 *
 * El XML de `reserializarXml` va en `xml` (texto; con `"bytes": "iso-8859-1"`
 * se convierte a ISO-8859-1 antes de cargarlo) o en `xml_base64` (bytes
 * crudos). El nodo a agregar, en `agregar` (texto UTF-8).
 */

declare(strict_types=1);

$escapar = static fn (string $texto, string $modo): string => match ($modo) {
    'xml1-iso-8859-1' => htmlspecialchars($texto, ENT_XML1, 'ISO-8859-1'),
    'xml1-sustituir' => htmlspecialchars($texto, ENT_XML1 | ENT_SUBSTITUTE, 'UTF-8'),
    'defecto' => htmlspecialchars($texto),
    default => throw new InvalidArgumentException("Modo de escape desconocido: {$modo}"),
};

$bytesXml = static function (array $entrada): string {
    if (isset($entrada['xml_base64'])) {
        return base64_decode((string) $entrada['xml_base64'], true)
            ?: throw new InvalidArgumentException('xml_base64 inválido');
    }
    $xml = (string) $entrada['xml'];
    if (($entrada['bytes'] ?? 'utf-8') === 'iso-8859-1') {
        $iso = mb_convert_encoding($xml, 'ISO-8859-1', 'UTF-8');
        if (mb_convert_encoding($iso, 'UTF-8', 'ISO-8859-1') !== $xml) {
            throw new InvalidArgumentException('xml tiene caracteres fuera de ISO-8859-1');
        }

        return $iso;
    }

    return $xml;
};

$crear = static function (DOMDocument $dom, array $nodo) use (&$crear, $escapar): DOMNode {
    if (isset($nodo['elemento'])) {
        $valor = (string) ($nodo['valor'] ?? '');
        if (isset($nodo['escapar'])) {
            $valor = $escapar($valor, (string) $nodo['escapar']);
        }
        $elemento = $dom->createElement((string) $nodo['elemento'], $valor);
        foreach ($nodo['atributos'] ?? [] as [$nombre, $valorAtributo]) {
            $elemento->setAttribute((string) $nombre, (string) $valorAtributo);
        }
        foreach ($nodo['hijos'] ?? [] as $hijo) {
            $elemento->appendChild($crear($dom, $hijo));
        }

        return $elemento;
    }
    if (array_key_exists('texto', $nodo)) {
        return $dom->createTextNode((string) $nodo['texto']);
    }
    if (array_key_exists('comentario', $nodo)) {
        return $dom->createComment((string) $nodo['comentario']);
    }
    if (array_key_exists('cdata', $nodo)) {
        return $dom->createCDATASection((string) $nodo['cdata']);
    }
    if (isset($nodo['pi'])) {
        return isset($nodo['datos'])
            ? $dom->createProcessingInstruction((string) $nodo['pi'], (string) $nodo['datos'])
            : $dom->createProcessingInstruction((string) $nodo['pi']);
    }
    throw new InvalidArgumentException('Nodo desconocido: '.json_encode($nodo));
};

$cargar = static function (string $bytes): DOMDocument {
    $dom = new DOMDocument();
    $dom->preserveWhiteSpace = true;
    if (! $dom->loadXML($bytes)) {
        $errores = array_map(static fn ($e) => trim($e->message), libxml_get_errors());
        throw new RuntimeException('loadXML falló: '.json_encode($errores, JSON_UNESCAPED_UNICODE));
    }

    return $dom;
};

/** Ejecuta $funcion con los errores de libxml capturados (createElement avisa de `&` sin `;`). */
$silenciarLibxml = static function (callable $funcion): string {
    $previo = libxml_use_internal_errors(true);
    try {
        return $funcion();
    } finally {
        libxml_clear_errors();
        libxml_use_internal_errors($previo);
    }
};

return [
    'serializarXml' => static function (array $entrada, array $material) use ($crear, $silenciarLibxml): array {
        $xml = $silenciarLibxml(static function () use ($entrada, $crear): string {
            $version = (string) ($entrada['version'] ?? '1.0');
            $dom = isset($entrada['encoding'])
                ? new DOMDocument($version, (string) $entrada['encoding'])
                : new DOMDocument($version);
            $dom->formatOutput = (bool) ($entrada['formatOutput'] ?? false);
            foreach ($entrada['documento'] as $nodo) {
                $dom->appendChild($crear($dom, $nodo));
            }

            return $dom->saveXML();
        });

        return [$xml, []];
    },

    'reserializarXml' => static function (array $entrada, array $material) use ($bytesXml, $cargar, $silenciarLibxml): array {
        $xml = $silenciarLibxml(static function () use ($entrada, $bytesXml, $cargar): string {
            $dom = $cargar($bytesXml($entrada));
            if (isset($entrada['agregar'])) {
                // Como firmarDte: el nodo se parsea aparte y se importa al final de la raíz.
                $fragmento = $cargar((string) $entrada['agregar']);
                $dom->documentElement->appendChild($dom->importNode($fragmento->documentElement, true));
            }

            return $dom->saveXML();
        });

        return [$xml, []];
    },

    'escaparXml' => static function (array $entrada, array $material) use ($escapar): array {
        $salida = '';
        foreach ($entrada['textos'] as $texto) {
            $salida .= $escapar((string) $texto, (string) $entrada['modo'])."\n";
        }

        return [$salida, []];
    },
];
