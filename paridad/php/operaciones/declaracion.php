<?php

/**
 * Operación de paridad de la fase 6 (declaración de cumplimiento), para compararla
 * con packages/core/src/postulacion/declaracion-boletas.ts:
 *
 *   httpDeclaracion  DeclaracionBoletas contra el servidor de captura (PLAN §5.3).
 *                    www4.sii.cl va al origen 'https', con un transporte que solo
 *                    cambia el destino de cada petición (la URL que ve el cliente,
 *                    las cabeceras y el cuerpo son los reales). Como
 *                    DeclaracionBoletas envía cuerpos crudos (GWT-RPC), el
 *                    transporte implementa TransporteCuerpoCrudo: los formularios
 *                    (y los GET) pasan por el TransporteHaciaCaptura de folios.php.
 *                    entrada.accion: estado | declarar | solicitarRevisionSet |
 *                    descargarSetPruebas | verificarPortal, con la sesión de
 *                    entrada.sesion (SesionSii::fromArray: cookies RUT_NS/DV_NS del
 *                    usuario). Al final va el resultado:
 *                      estado / declarar  `ok` + el EstadoDeclaracion en JSON
 *                      solicitarRevisionSet  `ok`
 *                      descargarSetPruebas  `ok` + el texto del set en JSON
 *                      verificarPortal  `ok` + la lista de problemas en JSON
 *                    o `error <categoria>` (incierta, set-sin-descargar,
 *                    sesion-caduca, postulacion; si el mensaje trae el var_export de
 *                    la respuesta de ingresarTrackId, se agrega `[respuesta=...]`).
 *                    El resto del mensaje no se compara.
 *
 * La fecha de hoy de declarar() sale de `new DateTimeImmutable('now')` (no de
 * date(), así que conHoraFija() no la fija): los casos de declarar usan
 * `normalizar.fechasGwt` del servidor de captura, que la marca como `<fecha>` en el
 * cuerpo GWT. Las respuestas GWT son sintéticas (paridad/declaracion/armar-casos.mjs).
 */

declare(strict_types=1);

use Winex\Certificacion\Folios\RespuestaHttp;
use Winex\Certificacion\Folios\SesionCaducaException;
use Winex\Certificacion\Folios\SesionSii;
use Winex\Certificacion\Folios\TransporteCuerpoCrudo;
use Winex\Certificacion\Folios\TransporteCurl;
use Winex\Certificacion\Postulacion\DatosDeclaracion;
use Winex\Certificacion\Postulacion\DeclaracionBoletas;
use Winex\Certificacion\Postulacion\DeclaracionInciertaException;
use Winex\Certificacion\Postulacion\EstadoDeclaracion;
use Winex\Certificacion\Postulacion\PostulacionException;
use Winex\Certificacion\Postulacion\SetSinDescargarException;

const JSON_PARIDAD_DECLARACION = JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS | JSON_THROW_ON_ERROR;

/**
 * TransporteHaciaCaptura (folios.php) que además sabe enviar cuerpos crudos, con el
 * mismo cambio de destino.
 */
final class TransporteCrudoHaciaCaptura implements TransporteCuerpoCrudo
{
    private readonly TransporteHaciaCaptura $formularios;

    /** @param array<string, string> $origenes host => URL base del origen */
    public function __construct(private readonly TransporteCurl $real, private readonly array $origenes)
    {
        $this->formularios = new TransporteHaciaCaptura($real, $origenes);
    }

    public function enviar(string $metodo, string $url, array $cabeceras, ?array $formulario, ?array $tls, int $segundosRespuesta): RespuestaHttp
    {
        return $this->formularios->enviar($metodo, $url, $cabeceras, $formulario, $tls, $segundosRespuesta);
    }

    public function enviarCrudo(string $metodo, string $url, array $cabeceras, string $cuerpo, int $segundosRespuesta): RespuestaHttp
    {
        $partes = parse_url($url);
        $host = strtolower((string) ($partes['host'] ?? ''));
        $origen = $this->origenes[$host] ?? throw new RuntimeException("El caso pidió un host sin origen de captura: {$host}");
        $destino = $origen.($partes['path'] ?? '/').(isset($partes['query']) ? '?'.$partes['query'] : '');

        return $this->real->enviarCrudo($metodo, $destino, $cabeceras, $cuerpo, $segundosRespuesta);
    }
}

function declaracionCategoria(Throwable $e): string
{
    return match (true) {
        $e instanceof DeclaracionInciertaException => 'incierta',
        $e instanceof SetSinDescargarException => 'set-sin-descargar',
        $e instanceof SesionCaducaException => 'sesion-caduca',
        $e instanceof PostulacionException => 'postulacion'
            .(preg_match('/\(respuesta: (.*)\)\. Intenta más tarde\.$/s', $e->getMessage(), $m) ? " [respuesta={$m[1]}]" : ''),
        default => throw $e,
    };
}

function declaracionEstado(EstadoDeclaracion $e): string
{
    return json_encode([
        'empresa' => (string) $e->empresa,
        'codigo' => $e->codigo,
        'glosa' => $e->glosa,
        'paso' => $e->paso,
        'porDeclarar' => $e->porDeclarar(),
        'autorizada' => $e->autorizada(),
    ], JSON_PARIDAD_DECLARACION);
}

return [
    'httpDeclaracion' => static function (array $entrada): array {
        [$peticiones, $resultado] = conCapturaHttp($entrada['http'] ?? [], static function () use ($entrada): string {
            $transporte = new TransporteCrudoHaciaCaptura(new TransporteCurl, [
                'www4.sii.cl' => origenCaptura('https'),
            ]);
            $declaracion = new DeclaracionBoletas($transporte);
            $accion = (string) $entrada['accion'];

            try {
                $sesion = SesionSii::fromArray($entrada['sesion'] ?? []);
                $resultado = match ($accion) {
                    'estado' => 'ok '.declaracionEstado($declaracion->estado($sesion, (string) $entrada['rutEmpresa'])),
                    'declarar' => 'ok '.declaracionEstado($declaracion->declarar($sesion, new DatosDeclaracion(
                        (string) $entrada['datos']['rutEmpresa'],
                        (string) $entrada['datos']['linkConsulta'],
                        (string) $entrada['datos']['rutProveedor'],
                        (string) $entrada['datos']['nombreProveedor'],
                        (string) $entrada['datos']['correoProveedor'],
                    ))),
                    'solicitarRevisionSet' => (static function () use ($declaracion, $sesion, $entrada): string {
                        $declaracion->solicitarRevisionSet($sesion, (string) $entrada['rutEmpresa'], (string) $entrada['trackId']);

                        return 'ok';
                    })(),
                    'descargarSetPruebas' => 'ok '.json_encode(
                        $declaracion->descargarSetPruebas($sesion, (string) $entrada['rutEmpresa'], (string) $entrada['correoProveedor']),
                        JSON_PARIDAD_DECLARACION,
                    ),
                    'verificarPortal' => 'ok '.json_encode($declaracion->verificarPortal(), JSON_PARIDAD_DECLARACION),
                    default => throw new InvalidArgumentException("Acción desconocida: {$accion}"),
                };
            } catch (PostulacionException|SesionCaducaException $e) {
                if (($entrada['esperaError'] ?? false) !== true) {
                    throw $e;
                }

                return 'error '.declaracionCategoria($e);
            }
            if (($entrada['esperaError'] ?? false) === true) {
                throw new RuntimeException('Se esperaba que el cliente lanzara y no lanzó.');
            }

            return $resultado;
        });

        return [$peticiones."=== resultado ===\n{$resultado}\n", []];
    },
];
