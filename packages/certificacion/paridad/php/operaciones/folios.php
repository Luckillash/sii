<?php

/**
 * Operaciones de paridad de la fase 5 (folios), para compararlas con
 * packages/core/src/folios/ y packages/core/src/comun/{html,navegacion-sii}.ts:
 *
 *   formFolios   SolicitudFolios::form() (privado) sobre cada página de
 *                entrada.paginas: action y campos en orden, una línea JSON por
 *                página (o {"sinForm":true}). Es el parseo HTML de libxml
 *                (DOMDocument::loadHTML) que Node replica en comun/html.ts.
 *   resolverUrl  SolicitudFolios::resolverUrl() (privado) para cada par
 *                [desde, ref] de entrada.pares; verifica que
 *                NavegadorSii::resolverUrl() dé lo mismo (Node usa una sola).
 *   sesionSii    SesionSii: entrada.inicial (fromArray) y entrada.pasos, cada uno
 *                {recibir: url, setCookie: [...]}, {html: "..."},
 *                {cabeceraPara: url} o {valor: nombre}. Imprime cada consulta y
 *                al final toArray().
 *   httpFolios   SolicitudFolios contra el servidor de captura (PLAN §5.3):
 *                accion autenticar | solicitar | completo. El login
 *                (herculesr.sii.cl) va al origen 'https' y el asistente
 *                (maullin.sii.cl) a 'https2', por un transporte que solo cambia
 *                el destino de cada petición (la URL que ve SolicitudFolios, las
 *                cabeceras y el cuerpo son los reales). Material: el certificado de
 *                entrada.archivo (+ entrada.clave). Al final va lo que el cliente
 *                obtuvo: las cookies (autenticar), el sha256 del CAF (solicitar) o
 *                `error <categoria>` si lanzó (sesion-caduca, folios-sin-caf
 *                <desde>-<hasta>, solicitud). El mensaje no se compara.
 *
 * Las salidas JSON usan JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES |
 * JSON_UNESCAPED_LINE_TERMINATORS: así coinciden con JSON.stringify de Node.
 */

declare(strict_types=1);

use Winex\Certificacion\Core\Certificate;
use Winex\Certificacion\Folios\Ambiente;
use Winex\Certificacion\Folios\FoliosSinCafException;
use Winex\Certificacion\Folios\RespuestaHttp;
use Winex\Certificacion\Folios\SesionCaducaException;
use Winex\Certificacion\Folios\SesionSii;
use Winex\Certificacion\Folios\SolicitudFolios;
use Winex\Certificacion\Folios\SolicitudFoliosException;
use Winex\Certificacion\Folios\TransporteCurl;
use Winex\Certificacion\Folios\TransporteHttp;
use Winex\Certificacion\Postulacion\NavegadorSii;

const JSON_PARIDAD = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS | JSON_THROW_ON_ERROR;

/** Llama a un método privado de SolicitudFolios. */
function foliosPrivado(string $metodo, mixed ...$argumentos): mixed
{
    $reflejo = new ReflectionMethod(SolicitudFolios::class, $metodo);
    $reflejo->setAccessible(true);

    return $reflejo->invoke(new SolicitudFolios(Ambiente::Certificacion), ...$argumentos);
}

/**
 * Transporte que manda cada petición al origen del servidor de captura que
 * corresponde a su host, con la misma ruta y query. Lo demás pasa tal cual.
 */
final class TransporteHaciaCaptura implements TransporteHttp
{
    /** @param array<string, string> $origenes host => URL base del origen */
    public function __construct(private readonly TransporteHttp $real, private readonly array $origenes) {}

    public function enviar(string $metodo, string $url, array $cabeceras, ?array $formulario, ?array $tls, int $segundosRespuesta): RespuestaHttp
    {
        $partes = parse_url($url);
        $host = strtolower((string) ($partes['host'] ?? ''));
        $origen = $this->origenes[$host] ?? throw new RuntimeException("El caso pidió un host sin origen de captura: {$host}");
        $destino = $origen.($partes['path'] ?? '/').(isset($partes['query']) ? '?'.$partes['query'] : '');

        return $this->real->enviar($metodo, $destino, $cabeceras, $formulario, $tls, $segundosRespuesta);
    }
}

function foliosCategoria(Throwable $e): string
{
    return match (true) {
        $e instanceof SesionCaducaException => 'sesion-caduca',
        $e instanceof FoliosSinCafException => "folios-sin-caf {$e->folioDesde}-{$e->folioHasta}",
        $e instanceof SolicitudFoliosException => 'solicitud',
        default => throw $e,
    };
}

return [
    'formFolios' => static function (array $entrada): array {
        $salida = '';
        foreach ($entrada['paginas'] as $html) {
            try {
                $form = foliosPrivado('form', (string) $html);
            } catch (SolicitudFoliosException) {
                $salida .= json_encode(['sinForm' => true], JSON_PARIDAD)."\n";

                continue;
            }
            $pares = [];
            foreach ($form['inputs'] as $nombre => $valor) {
                $pares[] = [(string) $nombre, (string) $valor];
            }
            $salida .= json_encode(['action' => $form['action'], 'inputs' => $pares], JSON_PARIDAD)."\n";
        }

        return [$salida, []];
    },

    'resolverUrl' => static function (array $entrada): array {
        $salida = '';
        foreach ($entrada['pares'] as [$desde, $ref]) {
            $resultado = foliosPrivado('resolverUrl', (string) $desde, (string) $ref);
            $navegador = NavegadorSii::resolverUrl((string) $desde, (string) $ref);
            if ($navegador !== $resultado) {
                throw new RuntimeException("SolicitudFolios y NavegadorSii resuelven distinto: {$desde} + {$ref}");
            }
            $salida .= json_encode([$desde, $ref, $resultado], JSON_PARIDAD)."\n";
        }

        return [$salida, []];
    },

    'sesionSii' => static function (array $entrada): array {
        $sesion = SesionSii::fromArray($entrada['inicial'] ?? []);
        $salida = '';
        foreach ($entrada['pasos'] as $paso) {
            if (isset($paso['recibir'])) {
                $sesion->recibir((string) $paso['recibir'], new RespuestaHttp(200, ['set-cookie' => $paso['setCookie'] ?? []], ''));
            } elseif (isset($paso['html'])) {
                $sesion->recibirDesdeHtml((string) $paso['html']);
            } elseif (isset($paso['cabeceraPara'])) {
                $salida .= json_encode(['cabeceraPara', $paso['cabeceraPara'], $sesion->cabeceraPara((string) $paso['cabeceraPara'])], JSON_PARIDAD)."\n";
            } elseif (isset($paso['valor'])) {
                $salida .= json_encode(['valor', $paso['valor'], $sesion->valor((string) $paso['valor'])], JSON_PARIDAD)."\n";
            } else {
                throw new InvalidArgumentException('Paso desconocido: '.json_encode($paso));
            }
        }
        $salida .= json_encode($sesion->toArray(), JSON_PARIDAD)."\n";

        return [$salida, []];
    },

    'httpFolios' => static function (array $entrada): array {
        $cert = isset($entrada['archivo'])
            ? Certificate::fromContents(leerMaterial((string) $entrada['archivo']), (string) ($entrada['clave'] ?? ''))
            : null;

        [$peticiones, $resultado] = conCapturaHttp($entrada['http'] ?? [], static function () use ($entrada, $cert): string {
            $transporte = new TransporteHaciaCaptura(new TransporteCurl, [
                'herculesr.sii.cl' => origenCaptura('https'),
                'maullin.sii.cl' => origenCaptura('https2'),
            ]);
            $folios = new SolicitudFolios(Ambiente::Certificacion, $transporte);
            $accion = (string) $entrada['accion'];

            try {
                $sesion = match ($accion) {
                    'autenticar', 'completo' => $folios->autenticar($cert ?? throw new InvalidArgumentException('Falta entrada.archivo')),
                    'solicitar' => SesionSii::fromArray($entrada['sesion'] ?? []),
                    default => throw new InvalidArgumentException("Acción desconocida: {$accion}"),
                };
                $resultado = '';
                if ($accion !== 'autenticar') {
                    $caf = $folios->solicitar($sesion, (string) $entrada['rutEmpresa'], (int) $entrada['tipoDte'], (int) $entrada['cantidad']);
                    $resultado .= 'caf sha256 '.hash('sha256', $caf).' ('.strlen($caf)." bytes)\n";
                }
                $resultado .= 'cookies '.json_encode($sesion->toArray(), JSON_PARIDAD);
            } catch (SolicitudFoliosException $e) {
                if (($entrada['esperaError'] ?? false) !== true) {
                    throw $e;
                }

                return 'error '.foliosCategoria($e);
            }
            if (($entrada['esperaError'] ?? false) === true) {
                throw new RuntimeException('Se esperaba que el cliente lanzara y no lanzó.');
            }

            return $resultado;
        });

        return [$peticiones."=== resultado ===\n{$resultado}\n", []];
    },
];
