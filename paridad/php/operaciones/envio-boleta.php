<?php

/**
 * Operación de paridad `envioBoleta`: EnvioBoleta::empaquetar().
 *
 * Entrada del caso:
 *   ahora      hora de Chile (YYYY-MM-DDTHH:MM:SS) que se estampa en <TmstFirmaEnv>
 *   rutEmisor, rutEnvia, nroResol, fchResol   argumentos del constructor (nroResol
 *              puede ser número o string, como en el PHP)
 *   dtes       lista de DTE; cada uno aporta sus bytes seguidos de "\n", como el bin
 *              enviar-set-boletas.php (`$dtesFirmados .= firmarDte(...) . "\n"`):
 *                {xml, uri}       XML (texto) que se pasa a ISO-8859-1 y se firma con
 *                                 FirmaElectronica::firmarDte($xml, $uri)
 *                {crudo}          bytes ya listos (texto que se pasa a ISO-8859-1),
 *                                 sin firmar: para declaraciones que firmarDte no
 *                                 produce (ausente, en mayúsculas, con \r...)
 *                {crudo_base64}   bytes exactos
 *
 * Marcas: TmstFirmaEnv, extraída de la salida (§5.1 punto 3); el test de Node la inyecta.
 */

declare(strict_types=1);

use Winex\Certificacion\Core\EnvioBoleta;
use Winex\Certificacion\Core\FirmaElectronica;

/** Texto UTF-8 del caso → bytes ISO-8859-1 (sin pérdidas). */
function envioBoletaIso(string $texto): string
{
    $iso = mb_convert_encoding($texto, 'ISO-8859-1', 'UTF-8');
    if (mb_convert_encoding($iso, 'UTF-8', 'ISO-8859-1') !== $texto) {
        throw new InvalidArgumentException('El texto tiene caracteres fuera de ISO-8859-1');
    }

    return $iso;
}

return [
    'envioBoleta' => static function (array $entrada, array $material): array {
        $firmador = new FirmaElectronica($material['llave'], $material['certificado']);

        $dtesFirmados = '';
        foreach ($entrada['dtes'] as $dte) {
            if (isset($dte['xml'])) {
                $bytes = $firmador->firmarDte(envioBoletaIso((string) $dte['xml']), (string) $dte['uri']);
            } elseif (isset($dte['crudo'])) {
                $bytes = envioBoletaIso((string) $dte['crudo']);
            } else {
                $bytes = base64_decode((string) $dte['crudo_base64'], true)
                    ?: throw new InvalidArgumentException('crudo_base64 inválido');
            }
            $dtesFirmados .= $bytes."\n";
        }

        $envio = new EnvioBoleta(
            $firmador,
            $entrada['rutEmisor'],
            $entrada['rutEnvia'],
            $entrada['nroResol'],
            $entrada['fchResol'],
        );
        $sobre = conHoraFija((string) $entrada['ahora'], static fn (): string => $envio->empaquetar($dtesFirmados));

        if (! preg_match('/<TmstFirmaEnv>([^<]+)<\/TmstFirmaEnv>/', $sobre, $m)) {
            throw new RuntimeException('El sobre no trae <TmstFirmaEnv>.');
        }

        return [$sobre, ['TmstFirmaEnv' => $m[1]]];
    },
];
