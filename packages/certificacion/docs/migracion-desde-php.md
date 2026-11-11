# Migración desde el PHP

Guía para quien usaba `winex/certificacion` v1.9.1 (PHP) y pasa a `@winex/certificacion`
(Node/TypeScript). El detalle del plan, las fases y cada decisión están en
[PLAN-MIGRACION.md](../PLAN-MIGRACION.md); aquí va lo que cambia al escribir código.

**Lo que no cambia:** todo lo que se firma o se envía al SII sale **byte a byte igual** que
en el PHP (golden tests, ver [tests.md](tests.md)). Los cambios son de API, de tipos y de
errores. Los defectos del PHP que tocan bytes enviados se replicaron a propósito (ver
[Defectos replicados](#defectos-del-php-replicados-por-paridad)).

**Quién emite:** el PHP no emite en producción. Node es el único emisor (decisión del
usuario).

## Ideas generales

| PHP | Node |
|---|---|
| Strings de bytes "latin1" mezclados con UTF-8 | Strings Unicode adentro y `Buffer` en los bordes: lo que se firma o envía sale como `Buffer` ISO-8859-1. No se reconvierte (`mb_convert_encoding` sobre la salida rompe las tildes y la firma: pend. 1.1) |
| Arreglos asociativos con claves `snake_case` | Objetos tipados con `camelCase` (`razon_social` → `razonSocial`) |
| Argumentos posicionales | Un objeto de datos y otro de opciones |
| `date()` con la zona del proceso | `reloj` inyectable; siempre hora de Chile |
| `\Exception` genérica en `Core`, `Certificacion` y `Produccion` | Jerarquía única `SiiError` ([core.md](core.md#errores)) |
| Rutas de archivo (`new Timbre('/ruta/caf.xml')`, `enviarDte(..., $rutaXml)`) | Contenido en memoria (`Buffer`); quien llama lee y escribe los archivos |
| Caché de token en `data/output/` | `TokenStore` inyectable |
| cURL / `file_get_contents` directos | `TransporteHttp` inyectable en todos los clientes |
| Todo síncrono | Lo que habla con el SII es `async`; firma, timbre y armado siguen síncronos |
| Scripts de `bin/` | CLI `sii` |

## Tabla de equivalencias

### Core ([core.md](core.md))

| PHP | Node |
|---|---|
| `new Certificate($ruta, $clave)` | `await Certificado.desdeArchivo(ruta, clave)` |
| `Certificate::fromContents($bytes, $clave)` | `Certificado.desdeContenido(bytes, clave)` |
| `getPrivateKey()` / `getPublicKey()` / `getPublicKeyChain()` | `llavePrivada` / `certificado` / `cadena` (y `identidadTls()`) |
| `toPem()` | `aPem()` |
| `getInfo()` → `['cn', 'not_before', 'not_after']` | `info()` → `{ cn, vigenteDesde, vigenteHasta }` (hora de Chile) |
| `Certificate::sinMaterialPem()` | `Certificado.sinMaterialPem()` |
| `Certificate::comandoPkcs12()` | no existe (no hay CLI de openssl) |
| `new FirmaElectronica($priv, $pub)` | `new FirmaElectronica(llavePrivada, certificado)` |
| `firmarSemilla($semilla): string` | `firmarSemilla(semilla): string` |
| `firmarDte($xml, $uri): string` | `firmarDte(xml, uri): Buffer` |
| `new Timbre($rutaOXml)` / `Timbre::fromXml()` | `new Timbre(contenido, { reloj })` |
| `generarTed(['rut_emisor' => …]): string` | `generarTed({ rutEmisor, … }): Buffer` |
| `generarBoleta($emisor, $receptor, $folio, $detalles, $tipo, $ref, $desc)` | `new GeneradorBoleta({ reloj }).generarBoleta({ emisor, receptor, folio, detalles, tipoDte, referencia, descuento })` |
| el bucle de `enviar-set-boletas.php` (generar → TED → `str_replace` → firmar) | `new ArmadorBoleta(firmador).armar(datos, caf)` |
| `new EnvioBoleta($firma, $rutEmisor, $rutEnvia, $nroResol, $fchResol)` | `new EnvioBoleta(firmador, { rutEmisor, rutEnvia, nroResol, fchResol }, { reloj })` |
| `empaquetar($dtesConcatenados)` | `empaquetar([dte1, dte2])` (o un `Buffer`) |

### Canales y certificación ([canales.md](canales.md))

| PHP | Node |
|---|---|
| `new SiiSoapClient($firma, 'maullin.sii.cl')` | `new ClienteDtews(certificado, { ambiente: 'certificacion', transporte })` |
| `getToken($priv, $pubLimpia)` | `solicitarToken()` (sin caché) u `obtenerToken(rutEmpresa)` (con `TokenStore`) |
| `enviarDte($token, $rutEmisor, $rutEnvia, $ruta)` | `enviarDte(token, { rutEmisor, rutEnvia, xml, nombreArchivo })` |
| `estadoEnvio($token, $rut, $trackId)` | `estadoEnvio(token, rut, trackId)` |
| `new EstadoEnvio($trackId, $estado, $glosa, …)` | `new EstadoEnvio({ trackId, estado, glosa, … })`; `desdeRespuesta`, `enProceso`, `procesado`, `limpio`, `resumen` iguales |
| `new SiiBoletaProduccion($firma, $produccion)` | `new ClienteBoletaRest(certificado, { ambiente, transporte })` |
| `getSemilla()` | `obtenerSemilla()` |
| `solicitarToken()` / `getToken()` (caché en archivo) | `solicitarToken()` / `obtenerToken(rutEmpresa)` |
| `enviarBoleta($token, …, $ruta)` / `enviarBoletaXml($token, …, $xml)` | `enviarBoleta(token, rutEmisor, rutEnvia, xmlBytes, { nombreArchivo })` |
| `enviarConsumoFolios(…)` | `enviarConsumoFolios(…)` (hoy 404 en el SII; ver RCOF) |
| `consultarEnvio(…): array` | `consultarEnvio(…): EstadoEnvioRest` |
| `(new SetPruebasParser())->parsear($ruta, $tipo)` → `det` / `ref` | `parsearSetPruebas(contenido, tipo)` → `detalles` / `referencia` |
| `(new GeneradorConsumoFolios())->generar($caratula, $resumenes)` | `new GeneradorConsumoFolios({ reloj }).generar(caratula, resumenes)`, claves en `camelCase` |
| montos del RCOF escritos a mano en `bin/` | `resumirParaRcof(dtes)` |

### Folios ([folios.md](folios.md))

| PHP | Node |
|---|---|
| `Ambiente::Certificacion` / `::Produccion` | `'certificacion'` / `'produccion'` |
| `$ambiente->host()`, `->idk()`, `->portal()` | `datosAmbiente(ambiente).host`, `.idk`, `.portal` |
| `new SolicitudFolios($ambiente, $transporte)` | `new SolicitudFolios({ ambiente, transporte, reloj })` |
| `ambiente()` | propiedad `ambiente` |
| `autenticar($cert)` / `solicitar(…): string` | `autenticar(certificado)` / `solicitar(…): Promise<Buffer>` |
| `SesionSii::fromArray()` / `toArray()` | `SesionSii.desdeArreglo()` / `aArreglo()` (mismo formato: una sesión guardada por el PHP se carga en Node) |
| `TransporteHttp::enviar($metodo, $url, $cabeceras, $form, $tls, $seg)` + `TransporteCuerpoCrudo` | `TransporteHttp.enviar(peticion: PeticionHttp)` (una sola interfaz; formulario o cuerpo crudo) |
| `TransporteCurl` | `TransporteUndici` |
| `TransporteFalso` (closure `($url, $form)`) | `TransporteFalso` (función que recibe la `PeticionRegistrada`) |

### Postulación ([postulacion.md](postulacion.md))

| PHP | Node |
|---|---|
| `Postulacion\Rut` | `Rut` (en `comun/`; lo usan todos los módulos). Nuevo: `Rut.esValido()` |
| `new DatosPostulacion($rutEmpresa, $rutAdmin, …)` | `new DatosPostulacion({ rutEmpresa, rutAdministrador, … })` |
| `DatosPostulacion::correo()` | `validarCorreo()` |
| `new DatosDeclaracion(…)` | `new DatosDeclaracion({ rutEmpresa, linkConsulta, rutProveedor, nombreProveedor, correoProveedor })` |
| `new PostulacionSii($transporte)` | `new PostulacionSii({ transporte, reloj })` |
| `new DeclaracionBoletas($transporte)` | `new DeclaracionBoletas({ transporte, reloj })` |
| `ResultadoPostulacion` (clase) | `ResultadoPostulacion` (interfaz) |
| `NavegadorSii`, `GwtRpc`, `LectorGwt` (`@internal`) | internos, no se exportan |

### Excepciones

| PHP | Node |
|---|---|
| `\Exception` de `Certificate` | `ErrorCertificado` |
| `\Exception` de `FirmaElectronica` | `ErrorFirma` |
| `\Exception` de `Timbre` | `ErrorTimbre` (y `ErrorValidacion` para números inválidos) |
| `\Exception` de `SiiSoapClient` / `SiiBoletaProduccion` | `ErrorTransporte` (red o HTTP), `ErrorRespuestaSii` (respuesta del SII), `ErrorValidacion` (entradas) |
| `\RuntimeException` de `EstadoEnvio` | `ErrorRespuestaSii` |
| `SolicitudFoliosException` | `ErrorSolicitudFolios` (las fallas de red antes de timbrar: `ErrorTransporte`) |
| `SesionCaducaException` | `SesionCaducaError` |
| `FoliosSinCafException` | `FoliosSinCafError` |
| `PostulacionException` | `ErrorPostulacion` (datos inválidos: `ErrorValidacion`; red o HTTP antes de grabar: `ErrorTransporte`) |
| `DeclaracionInciertaException` | `DeclaracionInciertaError` |
| `SetSinDescargarException` | `SetSinDescargarError` |

### Scripts de `bin/`

| PHP | CLI |
|---|---|
| `bin/certificacion/enviar-set-boletas.php` | `sii certificacion enviar-set` |
| `bin/certificacion/enviar-consumo-folios.php` | `sii certificacion enviar-rcof` (solo períodos hasta julio de 2022) |
| `bin/certificacion/estado-declaracion.php` | `sii certificacion estado-declaracion` |
| `bin/produccion/emitir-boleta.php` | `sii produccion emitir` |
| `bin/produccion/consultar-envio.php` | `sii produccion consultar` |
| `bin/util/firmar-semilla.php` | `sii util firmar-semilla` |
| `bin/util/verificar-ted.php` | `sii util verificar-ted` |

La CLI agrega los pasos que en el PHP no tenían script (`postular`, `descargar-set`,
`solicitar-folios`, `estado-envio`, `solicitar-revision`, `verificar-portal`, `declarar`).
Config del `.env` validada con zod, `--confirmar` en todo lo que graba en el SII, y un solo
`fchResol` para el sobre y el RCOF (el bin usaba fechas distintas).

## Diferencias de comportamiento

Ninguna cambia bytes de una entrada válida: solo el camino de error, los tipos o el manejo
de la conexión.

**Entradas más estrictas** (decisiones del usuario, fase 3, y del port):

- `GeneradorBoleta` valida el formato y el DV de los RUT y rechaza cantidades o precios
  negativos, montos ≥ 1e15 y un `exento` no booleano (el PHP usaba `=== true` en los totales
  y `empty()` en el descuento: pend. 1.5).
- `ArmadorBoleta` exige la razón social del receptor y que el CAF sea del emisor, del tipo y
  del rango del folio.
- `EnvioBoleta` sin ningún DTE lanza (el PHP armaba un sobre que no valida contra el XSD).
- `parsearSetPruebas` lanza con un `CASO-N` que no se puede leer como bloque o con números
  ambiguos (`1.000,50`). Los sets en ISO-8859-1 con tildes salen bien (en el PHP, rotos).
- Los RUT pasan por `Rut` en todos los clientes: uno con puntos o `k` minúscula se normaliza
  (el PHP lo enviaba tal cual). `SolicitudFolios` valida el DV.
- Tokens, trackId, cantidades y tipos se validan antes de enviar. El trackId ya no acepta el
  `\n` final que dejaba pasar el `$` de PCRE.
- GWT: un número que el PHP truncaba o saturaba lanza `ErrorPostulacion`.

**Certificado:**

- Sin fallback a la CLI de `openssl`: node-forge lee los .pfx legacy (RC2-40, 3DES) en
  memoria. Desaparecen `$openSslPath`, `OPENSSL_MODULES_PATH`, los temporales y el paso de
  la clave por el entorno. No lee RC2-128, RC4 ni 3DES de 2 llaves (raros).
- Un `string` solo puede ser PEM; un .pfx va como `Buffer`. `desdeArchivo` es `async`.
- `aPem()` no repite la hoja en Windows (defecto de `toPem()` del PHP, solo en Windows).

**Firma y timbre:**

- `firmarDte` lanza `ErrorFirma` con las ramas `Libro` y URI vacía (no portadas) y si la
  firma falla. El PHP no revisaba `openssl_sign` (pend. 1.7) y dejaba la firma vacía.
- `Timbre` recibe el contenido del CAF, no una ruta.

**Red:**

- **Códigos HTTP revisados en todo** (pend. 1.9): REST exige 200; SOAP 200 o fault SOAP;
  folios y postulación 200 en cada paso. Antes de una orden irreversible, un código
  inesperado o una falla de red es `ErrorTransporte` (reintentable).
- **Órdenes irreversibles:** después de timbrar, un CAF que no cuadra es `FoliosSinCafError`
  (pend. 1.2). Después de la orden de declarar, cualquier falla, incluido HTTP ≠ 200, es
  `DeclaracionInciertaError`.
- **Mensajes sin secretos:** nunca llevan token, cookies, PEM, XML firmado ni rutas. El PHP
  ponía la respuesta cruda del SII (que en el canje puede traer el token).
- **`filename` del multipart REST:** `envio.xml` / `rcof.xml` (o `nombreArchivo`). El PHP
  mandaba el nombre del temporal + `.xml`, distinto en cada envío. El SII no lo valida.
- **Conexiones:** se reutilizan (`keep-alive`); los POST irreversibles (DTEUpload, envío
  REST, timbrar, grabar postulación y declaración) van con `conexionNueva`. undici no envía
  `Expect: 100-continue` con cuerpos de más de 1 MiB (cURL sí, en la subida REST).
- **`Accept-Encoding: gzip, deflate`** en folios y postulación (cURL anunciaba lo de su
  build). SOAP y REST, sin `Accept-Encoding`, como el PHP.
- **Timeouts unificados:** conexión 10 s y petición 45 s (antes 15 s en folios y 60 s en
  SOAP); los pasos de los asistentes de folios y postulación, 70 s como el PHP.
- TLS mutuo en memoria (el PHP escribía cert y llave en temporales 0600), siempre HTTP/1.1,
  TLS verificado siempre.
- Los candados de folios también rechazan URLs con puerto o usuario.

**Token:** `TokenStore` con clave canal + ambiente + empresa + huella del certificado, en vez
del archivo único del PHP para todas las empresas y ambientes (pend. 1.4). Nada se escribe
en `data/output` por su cuenta.

**RCOF:** el SII lo eliminó desde el 2022-08-01. Se conserva, pero la CLI no lo envía en el
flujo normal y por REST el SII responde 404 (PLAN §1).

## Defectos del PHP replicados por paridad

Se replican porque corregirlos cambia bytes enviados al SII (principio 3 del PLAN: requiere
decisión del usuario y validación en certificación).

| Defecto | Efecto hoy | Estado |
|---|---|---|
| Firma de la semilla SOAP propia y no canónica, con el PEM completo en `<X509Certificate>` (pend. 1.3 / 1.8 / 2.1) | el SII la acepta | pendiente unificar con `firmarSemilla()` |
| El `SignedInfo` firmado declara `xmlns:xsi` y el transmitido no | el SII lo acepta | se mantiene |
| Cadena TLS hoja → raíz → intermedia con un .pfx **no legacy** con intermedios | los .pfx del SII (legacy) no se ven afectados | por decidir |
| `<meta charset=iso-8859-1>` hace reenviar doblemente codificados los valores con tildes de los asistentes | con tildes en `NOM_SW` la postulación no se puede completar | **decidido: no se corrige; no usar tildes** en los datos de los asistentes ([postulacion.md](postulacion.md#sin-tildes-en-los-datos-de-los-asistentes)) |
| `array_merge` renumera los campos con nombre entero (postulación) | el SII no usa nombres numéricos; folios no lo replica (brecha sin efecto) | por decidir (sugerido: replicarlo en folios) |
| `long()` de GWT con negativos (-1 → token vacío) | `DeclaracionBoletas` solo envía positivos | por decidir |
| Datos de la carátula de `EnvioBoleta` sin escapar (un valor no ASCII sale con mojibake) | los RUT y fechas son ASCII | se mantiene |
| Valor por defecto `#F1T33` de `firmarDte` (factura) | `ArmadorBoleta` pasa siempre la URI | se mantiene |

También se replican rarezas que no cambian lo que se envía hoy: el `(string)` de los float de
PHP, `round()`, `html_entity_decode` con la tabla HTML 4.01 en los canales y la HTML5 en la
postulación, `strip_tags`, el `\s` de PCRE y los huecos conocidos del parser del set (un
`caso-2` en minúsculas).

## Decisiones pendientes

Resumen de PLAN §8 (fuente de verdad: el PLAN):

- Unificar la firma de la semilla SOAP con `firmarSemilla()` (cambia bytes; validar en
  maullin).
- Orden de la cadena TLS con .pfx no legacy (cambia lo enviado en el handshake).
- `array_merge` también en folios.
- `long()` de GWT con negativos.
- Truncar `RSR` en el TED (pend. 6.4): solo después de revisar el XSD, con decisión
  explícita.

Regla general del PLAN: todo lo que cambia bytes enviados al SII queda fuera de la paridad y
se hace después, en un cambio propio, con validación en certificación.
