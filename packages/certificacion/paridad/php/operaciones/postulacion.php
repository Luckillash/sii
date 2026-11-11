<?php

/**
 * Operaciones de paridad de la fase 6 (postulación), para compararlas con
 * packages/core/src/postulacion/{navegador-sii,postulacion-sii}.ts:
 *
 *   formPostulacion  NavegadorSii::form() sobre cada página de entrada.paginas:
 *                    action y campos en orden, una línea JSON por página (o
 *                    {"sinForm":true}). La regla de la postulación (sin select, sin
 *                    botones ni disabled, checkbox/radio solo marcados, trim), que
 *                    NO es la de folios (formFolios).
 *   textoPostulacion Para cada texto de entrada.textos, una línea JSON con
 *                    NavegadorSii::texto() completo (PHP_INT_MAX) y recortado
 *                    (entrada.max, 300 por defecto), strip_tags(),
 *                    html_entity_decode(ENT_QUOTES | ENT_HTML5), qué marcadores de
 *                    PostulacionSii encuentra mb_stripos (más "ha sido aceptada") y
 *                    lo que devuelve PostulacionSii::aviso() (privado).
 *   httpPostulacion  PostulacionSii contra el servidor de captura (PLAN §5.3):
 *                    accion postular (con la sesión de entrada.sesion) o completo
 *                    (autenticar con el certificado de entrada.archivo y postular).
 *                    El login (herculesr.sii.cl) va al origen 'https' y maullin a
 *                    'https2', con el TransporteHaciaCaptura de folios.php. Al final
 *                    va el resultado (`ok` + empresa, avisos y mensaje, y las
 *                    cookies) o `error <categoria>` (sesion-caduca, postulacion; si
 *                    el mensaje dice qué campo de la confirmación no calzó, se
 *                    agrega `[CAMPO=var_export]`). El resto del mensaje no se compara.
 */

declare(strict_types=1);

use Winex\Certificacion\Core\Certificate;
use Winex\Certificacion\Folios\SesionCaducaException;
use Winex\Certificacion\Folios\SesionSii;
use Winex\Certificacion\Folios\TransporteCurl;
use Winex\Certificacion\Postulacion\DatosPostulacion;
use Winex\Certificacion\Postulacion\NavegadorSii;
use Winex\Certificacion\Postulacion\PostulacionException;
use Winex\Certificacion\Postulacion\PostulacionSii;

const JSON_PARIDAD_POSTULACION = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS | JSON_THROW_ON_ERROR;

/** Los MARCADORES_ERROR de PostulacionSii (privados) y el texto de éxito, en ese orden. */
const MARCADORES_POSTULACION = [
    'El código de este mensaje es',
    'no está autorizado',
    'no es representante',
    'No ha sido posible completar su solicitud',
    'Usted no tiene',
    'ha sido aceptada',
];

function postulacionCategoria(Throwable $e): string
{
    return match (true) {
        $e instanceof SesionCaducaException => 'sesion-caduca',
        $e instanceof PostulacionException => 'postulacion'
            .(preg_match('/trae (\w+)=(.*), distinto de lo enviado/s', $e->getMessage(), $m) ? " [{$m[1]}={$m[2]}]" : ''),
        default => throw $e,
    };
}

return [
    'formPostulacion' => static function (array $entrada): array {
        $salida = '';
        foreach ($entrada['paginas'] as $html) {
            $form = NavegadorSii::form((string) $html);
            if ($form === null) {
                $salida .= json_encode(['sinForm' => true], JSON_PARIDAD_POSTULACION)."\n";

                continue;
            }
            $pares = [];
            foreach ($form['inputs'] as $nombre => $valor) {
                $pares[] = [(string) $nombre, (string) $valor];
            }
            $salida .= json_encode(['action' => $form['action'], 'inputs' => $pares], JSON_PARIDAD_POSTULACION)."\n";
        }

        return [$salida, []];
    },

    'textoPostulacion' => static function (array $entrada): array {
        $aviso = new ReflectionMethod(PostulacionSii::class, 'aviso');
        $aviso->setAccessible(true);
        $postulacion = new PostulacionSii;
        $max = (int) ($entrada['max'] ?? 300);

        $salida = '';
        foreach ($entrada['textos'] as $html) {
            $html = (string) $html;
            $completo = NavegadorSii::texto($html, PHP_INT_MAX);
            $marcadores = [];
            foreach (MARCADORES_POSTULACION as $marcador) {
                if (mb_stripos($completo, $marcador) !== false) {
                    $marcadores[] = $marcador;
                }
            }
            $salida .= json_encode([
                'texto' => $completo,
                'recortado' => NavegadorSii::texto($html, $max),
                'stripTags' => strip_tags($html),
                'entidades' => html_entity_decode($html, ENT_QUOTES | ENT_HTML5),
                'marcadores' => $marcadores,
                'aviso' => $aviso->invoke($postulacion, $html),
            ], JSON_PARIDAD_POSTULACION)."\n";
        }

        return [$salida, []];
    },

    'httpPostulacion' => static function (array $entrada): array {
        $cert = isset($entrada['archivo'])
            ? Certificate::fromContents(leerMaterial((string) $entrada['archivo']), (string) ($entrada['clave'] ?? ''))
            : null;
        $d = $entrada['datos'];

        [$peticiones, $resultado] = conCapturaHttp($entrada['http'] ?? [], static function () use ($entrada, $cert, $d): string {
            $transporte = new TransporteHaciaCaptura(new TransporteCurl, [
                'herculesr.sii.cl' => origenCaptura('https'),
                'maullin.sii.cl' => origenCaptura('https2'),
            ]);
            $postulacion = new PostulacionSii($transporte);
            $accion = (string) $entrada['accion'];

            try {
                $datos = new DatosPostulacion(
                    (string) $d['rutEmpresa'],
                    (string) $d['rutAdministrador'],
                    (string) $d['correoAdministrador'],
                    (string) $d['correoContactoSii'],
                    (string) $d['correoIntercambio'],
                    (string) $d['nombreSoftware'],
                    (bool) ($d['boletaExenta'] ?? true),
                    (string) ($d['url'] ?? ''),
                );
                $sesion = match ($accion) {
                    'completo' => $postulacion->autenticar($cert ?? throw new InvalidArgumentException('Falta entrada.archivo')),
                    'postular' => SesionSii::fromArray($entrada['sesion'] ?? []),
                    default => throw new InvalidArgumentException("Acción desconocida: {$accion}"),
                };
                $r = $postulacion->postular($sesion, $datos);
                $resultado = 'ok '.json_encode(['empresa' => (string) $r->empresa, 'avisos' => $r->avisos, 'mensaje' => $r->mensaje], JSON_PARIDAD_POSTULACION)
                    ."\ncookies ".json_encode($sesion->toArray(), JSON_PARIDAD_POSTULACION);
            } catch (PostulacionException|SesionCaducaException $e) {
                if (($entrada['esperaError'] ?? false) !== true) {
                    throw $e;
                }

                return 'error '.postulacionCategoria($e);
            }
            if (($entrada['esperaError'] ?? false) === true) {
                throw new RuntimeException('Se esperaba que el cliente lanzara y no lanzó.');
            }

            return $resultado;
        });

        return [$peticiones."=== resultado ===\n{$resultado}\n", []];
    },
];
