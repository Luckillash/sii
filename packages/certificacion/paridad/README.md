# Paridad con el core PHP

Golden tests que exigen que Node produzca **los mismos bytes** que
`winex/certificacion` v1.9.1 (ver `PLAN-MIGRACION.md` §5).

| Carpeta | Contenido |
|---|---|
| `casos/` | Entradas de cada caso (`<caso>.json`: `operacion`, `material`, `entrada`) |
| `php/generar.php` | Ejecuta cada caso con el core PHP y escribe los esperados |
| `esperados/` | `<caso>.bin` (bytes exactos del PHP) y `<caso>.meta.json`. **No se editan a mano** |
| `material/` | Llave RSA y certificado autofirmado **de prueba** (nunca reales) |
| `http/` | Servidor de captura de la paridad HTTP y el lanzador de `pnpm paridad:generar` |

## Comandos

```
pnpm test               # compara Node con los esperados versionados (no necesita PHP)
pnpm paridad:generar    # regenera los esperados (PHP 8.3 + composer install en ../certificacion-core)
pnpm paridad:generar firmar-semilla-normal          # solo algunos casos
php paridad/php/generar.php firmar-semilla-normal   # sin servidor de captura (casos que no son HTTP)
```

`pnpm paridad:generar` corre `node paridad/http/generar.mjs`, que levanta el
servidor de captura y llama a `generar.php` con los mismos argumentos (ver
[Paridad de requests HTTP](#paridad-de-requests-http)). Con `php
paridad/php/generar.php` a secas, los casos HTTP se detienen con un mensaje que
lo explica.

`generar.php` busca el core en `../certificacion-core`, o en la ruta de la
variable `CERTIFICACION_CORE`. La salida es determinista: el job
`paridad-php` del CI la regenera con el core en `v1.9.1` y falla si difiere
de lo versionado.

## Agregar un caso

1. Crear `casos/<caso>.json` con una `operacion` que `generar.php` conozca.
   Si es nueva, agregar `php/operaciones/<operacion>.php`, que devuelve un mapa
   `operación => function (array $entrada, array $material): array` con el
   resultado `[bytes, marcas]` (ver `operaciones/firmar-semilla.php`). `material`
   en el caso es opcional: solo lo usan las operaciones que firman.
2. `pnpm paridad:generar`.
3. Escribir o ampliar el test en `packages/core/test/paridad/`.

Si el PHP estampa la hora con `date()`, `generar.php` debe extraer esas marcas
de su salida y guardarlas en `marcas` del `meta.json`; el test de Node las
inyecta con el reloj (ver §5.1, punto 3). Para fijar la hora en el PHP, la
operación envuelve la llamada en `conHoraFija($entrada['ahora'], fn () => ...)`
(`php/hora-fija.php`, que `generar.php` carga antes que las operaciones).

## Material de prueba

Generado una vez con OpenSSL y versionado (no es secreto):

```
openssl req -x509 -newkey rsa:2048 -noenc -keyout llave.pem -out certificado.pem \
  -days 36500 -subj "/CN=Titular de Prueba/O=Material de prueba certificacion-node"
```

Si se regenera, también hay que regenerar todos los esperados.

`cert-*`: material de los casos `certificado-*` (clave/passphrase de todos:
`clave-de-prueba`). Una CA raíz y una CA intermedia emiten la hoja
`CN=Titular de Prueba Ñuñoa` (UTF8String), RSA 2048, 100 años de vigencia.
Generado una vez con OpenSSL 3.5 (el de Git for Windows):

| Archivo | Contenido | Cómo |
|---|---|---|
| `cert-moderno.pfx` | hoja + llave; PBES2 AES-256-CBC, MAC SHA-256 | `openssl pkcs12 -export -inkey titular.key -in titular.crt -name "Titular de Prueba"` |
| `cert-moderno-cadena.pfx` | lo mismo + intermedia + raíz | ídem con `-certfile cadena.crt` (intermedia, raíz) |
| `cert-legacy.pfx` | certificados RC2-40, llave 3DES, MAC SHA-1 (como los del SII) | ídem con `-legacy` |
| `cert-legacy-cadena.pfx` | lo mismo + intermedia + raíz | ídem con `-legacy -certfile cadena.crt` |
| `cert-3des-cadena.pfx` | todo 3DES, MAC SHA-1, con cadena | `-keypbe PBE-SHA1-3DES -certpbe PBE-SHA1-3DES -macalg sha1 -certfile cadena.crt` |
| `cert-titular.pem` | llave PKCS#8 sin cifrar + hoja | `cat titular.key titular.crt` |
| `cert-pkcs1.pem` | llave PKCS#1 + hoja | `openssl pkey -traditional` |
| `cert-cifrado.pem` | llave PKCS#8 cifrada (AES-256) + hoja | `openssl pkcs8 -topk8 -v2 aes-256-cbc` |
| `cert-cadena.pem` | hoja, llave, intermedia, intermedia (repetida), raíz | `cat` |
| `cert-openssl.cnf` | configuración mínima de OpenSSL (ver abajo) | a mano |

El sujeto de la hoja se pasa por un `-config` con `prompt=no`, `utf8=yes` y
`string_mask=utf8only`: en Windows `-subj` no llega en UTF-8. Si se regenera,
hay que regenerar los esperados `certificado-*`.

Para generar los esperados `certificado-*` en Windows hacen falta dos cosas que
el PHP de Windows no trae (en Linux/CI ya están): `OPENSSL_CONF` apuntando a
`cert-openssl.cnf` (sin openssl.cnf, `openssl_pkey_export` falla y el core
entrega la llave en otro formato) y el binario `openssl` en el PATH (el core lo
usa para los .pfx legacy). Desde PowerShell:

```
$env:OPENSSL_CONF = (Resolve-Path paridad/material/cert-openssl.cnf).Path
$env:Path += ';C:\Program Files\Git\mingw64\bin'
php paridad/php/generar.php
```

Sin eso, `operaciones/certificado.php` se detiene con un mensaje que lo explica.

`caf-*.xml`: CAF de prueba (los casos `timbre-*`), generados una vez con
`generateKeyPairSync` de `node:crypto` y el mismo formato que los del SII
(`<DA>` con `<RSAPK>`, `<FRMA>` de relleno, `<RSASK>` en PKCS#1, `<RSAPUBK>`).
`caf-39`, `caf-41-iso` y `caf-39-utf8-tildes` usan RSA de 512 bits con exponente 3,
como los CAF reales. `caf-41-iso` trae la razón social en ISO-8859-1 sin
declararlo. `caf-39-sangrado` usa CRLF, tabulaciones, `encoding="ISO-8859-1"` y RSA
de 2048 bits. Para regenerarlos basta con cualquier par RSA en ese formato (ver
`packages/core/test/soporte/caf.ts`), pero entonces hay que regenerar los
esperados `timbre-*`.

## Set de pruebas y estado de envío (`set-pruebas-*`, `estado-envio-*`)

No usan archivos de `material/`: las entradas van dentro de cada caso.

- `setPruebas` (`operaciones/set-pruebas.php`) lee el contenido de `archivo` (ruta
  relativa a la raíz, p. ej. `data/set_pruebas/Set Prueba BE.txt`), `texto` (UTF-8)
  o `base64` (bytes exactos, para los casos en ISO-8859-1), lo escribe en un
  temporal y llama a `SetPruebasParser::parsear()`. La salida es JSON: cada número
  con su valor (`2.0` es float en PHP), su `(string)` y su tipo; en los errores, la
  ruta del temporal queda como `<archivo>`. Si la entrada no es UTF-8 válido, las
  cadenas se pasan de ISO-8859-1 a UTF-8 solo para poder escribir el JSON. Node
  compara la estructura, y de cada número el valor y el texto (no el tipo).
  Divergencias intencionales (decisión del usuario, 2026-11-06): en
  `set-pruebas-bloques` (un `CASO-N` que el PHP pierde) y `set-pruebas-numeros`
  (`1.000,50`, que el PHP lee como 1) el esperado sigue siendo la salida del PHP,
  pero Node lanza `ErrorValidacion`; la lista está en `DIVERGENCIAS` de
  `packages/core/test/paridad/set-pruebas.test.ts`.
- `estadoEnvio` (`operaciones/estado-envio.php`) llama a
  `EstadoEnvio::desdeRespuesta()` y guarda las propiedades y lo que devuelven
  `enProceso()`, `procesado()`, `limpio()` y `resumen()`. Las respuestas son
  sintéticas, con el formato de `QueryEstUp` (el del docblock del PHP), y
  anonimizadas: RUT `76123456-0` de prueba y trackIds inventados.

Los casos se escribieron con un script de una vez; para agregar uno basta con
crear el JSON a mano y generar solo ese esperado.

## Armado de boletas y set completo (`armar-boleta-*`, `set-completo`, `rcof-set-completo`)

Los casos `rcof-*` comparan el RCOF por paridad con el PHP. El SII eliminó la obligación de
enviarlo desde el 1 de agosto de 2022 (sigue solo para períodos hasta julio de 2022): ver
`PLAN-MIGRACION.md` §1.

- `armar-boleta` (`operaciones/armar-boleta.php`): el cuerpo del bucle de
  `bin/certificacion/enviar-set-boletas.php` copiado tal cual en
  `armarBoletaComoBin()` (generar → `loadXML` + `MntTotal`/`NmbItem` → `Timbre` →
  TED + `TmstFirma` → `firmarDte`). Los `date()` del bin están en el namespace
  global, así que pasan por `fechaParidad()`. La salida es la de `firmarDte`, sin
  el `"\n"` que el bin agrega antes de empaquetar. Marcas: `FchEmis`, `TSTED` y
  `TmstFirma` (deben tener un único valor).
- `set-completo` (`operaciones/set-completo.php`): el bin completo con el set real,
  `caf-39.xml`, folios consecutivos desde `folioInicial` y RUT de prueba. Devuelve
  los bytes de `EnvioBoleta::empaquetar()`, no los del archivo del bin (pend. 1.1).
- `rcof-set-completo`: `bin/certificacion/enviar-consumo-folios.php` con los montos
  calculados con la fórmula del bin (`round(bruto / 1.19)` por caso) a partir del
  set, firmado con `firmarDte($rcof, '#RCOF')`. Comprueba que el set dé los montos
  que el bin trae escritos a mano. El sobre y el RCOF usan `fchResol` distintas,
  como el bin (`2026-09-05` y `2026-09-04`).

## Validación contra los XSD del SII (`paridad/xsd.json`)

Los esperados que representan algo que se envía al SII se validan contra los
esquemas de `data/schemas/` (procedencia en `data/schemas/README.md`). Como los
tests exigen que Node produzca los mismos bytes, validar los esperados valida
también la salida de Node.

`xsd.json` tiene una lista `esquemas` de reglas:

| Campo | Significado |
|---|---|
| `patron` | glob sobre el nombre del caso, sin `.bin` (`envio-boleta-*`, `set-completo`) |
| `xsd` | archivo de `data/schemas/` |
| `obligatorio` | con `--estricto`, falla si ningún esperado calza con el patrón |
| `excluir` | `{ "<glob de caso>": "<motivo>" }`: casos que calzan pero no son algo que se envíe (p. ej. DTE sin firmar a propósito) |

Reglas actuales: `envio-boleta-*` y `set-completo` → `EnvioBOLETA_v11.xsd`;
`rcof-firmado` y `rcof-set-completo` → `ConsumoFolio_v10.xsd`. Los `rcof-*` sin
firmar no se declaran: el XSD exige `ds:Signature`. Un caso nuevo que calce con un
patrón se valida solo; si no debe validar, va a `excluir` con su motivo.

```
pnpm paridad:xsd                                     # local (PowerShell): PHP + DOMDocument::schemaValidate
php paridad/php/validar-xsd.php --estricto           # además exige un esperado por regla obligatoria
php paridad/php/validar-xsd.php --xmllint --estricto # lo que corre el CI (xmllint --noout --schema)
```

Sin `--estricto`, un patrón obligatorio sin esperados solo da un `AVISO` (sirve
mientras un caso todavía no se genera); con `--estricto` es un `FALTA` y falla.
Salida: `OK`, `FALLA` (con archivo:línea: mensaje de libxml), `OMITE` (excluido, con
el motivo). Código de salida 0 si todo valida, 1 si algo falla o falta, 2 si hay un
error de configuración (manifiesto, esquema o xmllint ausentes).

En el CI corre en el job `paridad-php` (una sola vez, ya tiene PHP), con `xmllint`
de `libxml2-utils`, aunque falle la comparación de esperados.

## GWT-RPC (`gwt-*`)

`operaciones/gwt.php` tiene dos operaciones sin HTTP, que compara
`packages/core/test/paridad/gwt.test.ts`:

- `gwtLlamada` arma el cuerpo de `GwtRpc::llamada()` con `{base, policy, servicio,
  metodo, parametros}`. Cada parámetro es `{tipo: <firma>, pasos: [...]}`, con pasos
  `["string", "x"|null]`, `["int", n]`, `["nulo"]`, `["integer", n|null]`,
  `["long", "<decimal>"|null]`, `["tipo", firma]`, `["valor", <objeto como lo entrega
  el lector, long en texto decimal>]` y `["valorLeido", {respuesta|respuestaBase64,
  esquemas}]` (lee el `objeto()` de esa respuesta y lo reescribe con `valor()`, como
  `DeclaracionBoletas`). El esperado es el cuerpo exacto, o `#error <mensaje>` si el
  PHP lanza.
- `gwtLeer` recibe `{respuesta|respuestaBase64, esquemas, lecturas}`, con `lecturas`
  una lista de `objeto` / `string` / `esNulo`, y guarda un JSON `{lecturas, error}`
  con los long en texto decimal. Node compara la estructura y los mensajes salvo
  tildes.

Las marcas `longsSaturados` (un long del caso fuera de 64 bits, que `(int)` satura) y
`numerosInexactos` (números de la respuesta que `(int)` trunca o satura) separan las
divergencias intencionales: esos casos están en `DIVERGENCIAS` del test, el esperado
es la salida del PHP y Node lanza `ErrorPostulacion`. Cualquier otro caso debe quedar
sin marcas. Los casos usan los esquemas de `DeclaracionBoletas::ESQUEMAS` y datos
ficticios. Se generan con `php paridad/php/generar.php gwt-...`, sin el servidor de
captura (al generar `gwt-leer-escapes` el PHP imprime dos `Deprecated` de `hexdec`,
que no afectan al esperado).

## Paridad de requests HTTP

Los clientes del SII no producen archivos sino peticiones (PLAN §5.3). Para
compararlas, PHP y Node hablan con el mismo **servidor de captura**
(`http/servidor-captura.mjs`, Node sin dependencias), que graba cada petición
cruda y contesta con respuestas grabadas. Lo grabado se **normaliza** en el
servidor y esos bytes son el esperado: el PHP los recibe ya normalizados y los
tests de Node usan la misma función, así que las reglas son idénticas.

Orígenes (cada uno en su puerto aleatorio): `http` (`http://127.0.0.1:P`) y
`https`/`https2` (`https://localhost:P`, TLS con un certificado de prueba;
dos para los clientes que hablan con dos hosts, como REST: autenticación y
envío). Solo HTTP/1.1: el TLS no ofrece h2 por ALPN. `generar.mjs` le pasa al PHP
las URLs en `PARIDAD_CAPTURA_HTTP`/`_HTTPS`/`_HTTPS2` y la CA con `-d
curl.cainfo=` y `-d openssl.cafile=` (la verificación TLS del core queda
encendida). Usar `https` en ambos lados: el origen sale en la salida.

### Formato del esperado

```
=== peticion 1 de 1 (https2) ===
POST /recursos/v1/boleta.electronica.envio HTTP/1.1
accept: */*
content-length: 677
content-type: multipart/form-data; boundary=<boundary>
cookie: TOKEN=TOKENDEPRUEBA0002
host: <https2>
user-agent: Mozilla/4.0 ( compatible; PROG 1.0; Windows NT)

<cuerpo en bytes exactos>
=== fin de la peticion 1 ===
```

Reglas (detalle en `normalizarCapturas()`):

- Se comparan método, ruta con query, versión HTTP, **todas** las cabeceras y el
  cuerpo byte a byte. Las que el cliente HTTP agrega solo (`Accept: */*` de cURL,
  `Expect: 100-continue`, `User-Agent`) cuentan: en Node hay que ponerlas o
  quitarlas a mano.
- Nombres de cabecera en minúsculas y ordenados (las repetidas conservan su
  orden): undici escribe `host` y `content-length` en minúsculas y en posiciones
  fijas, y HTTP no les da significado.
- Única cabecera excluida: `connection` (cURL no la manda, `file_get_contents`
  manda `close`, undici `keep-alive` o `close` con `conexionNueva`; es manejo de
  la conexión, decidido en la fase 4).
- `host` del servidor → `<origen>` (el puerto es aleatorio).
- Boundary del multipart → `<boundary>` en Content-Type y cuerpo (es aleatorio;
  su formato lo prueban los unitarios de `multipart.ts`).
- `content-length` → largo del cuerpo normalizado (si no calza con lo recibido,
  queda el valor y una nota).
- `accept-encoding` → `<codificaciones>` (se compara que vaya, no la lista: cURL
  anuncia lo que trae su build y Node `gzip, deflate`, decisión de la fase 4).
- Si el cliente presentó un certificado TLS (los orígenes `https` lo piden sin
  exigirlo), después de la línea de la petición va `# tls cliente: sha256 <hoja>
  (<n> en la cadena)`. El servidor no reanuda sesiones TLS: cada conexión hace el
  handshake completo (undici reanuda sesiones y cURL no; en una sesión reanudada
  no se ve la cadena).
- Opcional por caso, `normalizar.camposFormulario` (lista de nombres): en los
  cuerpos urlencoded el valor de esos campos pasa a `<normalizado>`. Para valores
  que el PHP toma de la hora real sin pasar por `date()` (`FECHA` de la solicitud
  de folios). El nombre y la posición del campo se siguen comparando.
- Opcional por caso, `normalizar.nombresArchivo`: `filename="bolC7E.tmp.xml"` →
  `filename="<archivo>.xml"`. Para los temporales del PHP
  (`basename(tempnam(...)).'.xml'` en `enviarBoletaXml`/`enviarConsumoFolios`),
  que cambian en cada corrida y entre Windows (`bolC7E.tmp`) y Linux (`bol_AbC123`).
- Opcional por caso, `normalizar.fechasGwt`: en los cuerpos `text/x-gwt-rpc`, cada
  token (separado por `|`) con forma `dd-mm-aaaa` pasa a `<fecha>`. Para la fecha de
  hoy que `DeclaracionBoletas::declarar` toma de la hora real (ver
  [Declaración de cumplimiento](#declaración-de-cumplimiento-http-declaracion-)).

Lo que se vio en el cable (cURL 8.23 del PHP 8.3 de Windows): cURL manda
`Host`, `Accept: */*`, las cabeceras de `CURLOPT_HTTPHEADER` en orden,
`Content-Length` y `Content-Type`; agrega `Expect: 100-continue` solo con
cuerpos de más de 1 MiB (salvo `Expect:`); boundary de 24 guiones + 22
alfanuméricos. `file_get_contents` manda `Host`, `Connection: close`,
`Content-Length` y luego las del contexto, sin `Accept` ni `User-Agent`
(`generar.mjs` fija `-d user_agent=`), y no usa ALPN.

### Escribir un caso HTTP

1. **Caso** `casos/<caso>.json`: la entrada de la operación más `entrada.http`:

   ```json
   "http": {
     "respuestas": [
       { "status": 200, "cabeceras": [["Content-Type", "application/json"]], "cuerpo": "{\"trackid\":1}" },
       { "cuerpo": { "base64": "..." } }
     ],
     "normalizar": { "nombresArchivo": true }
   }
   ```

   La petición N recibe la respuesta N (`status` 200 por defecto; `cuerpo`
   texto UTF-8 o `{base64}`). Si llegan más peticiones que respuestas, se
   contesta 500 y la salida lo marca. Respuestas **anonimizadas**: RUT de prueba
   (`76123456-0`, `11111111-1`), tokens y trackIds inventados.
2. **Operación PHP** `php/operaciones/<op>.php`, con las funciones de
   `php/http.php`:

   ```php
   [$peticiones, $resultado] = conCapturaHttp($entrada['http'] ?? [], function () use (...) {
       $soap = new SiiSoapClient($firma, hostCaptura('https'));    // arma https://{$host}/...
       // o: $rest = new SiiBoletaProduccion($firma, false);
       //     apuntarBoletaProduccionACaptura($rest);               // auth → https, envío → https2
       return $soap->consultarEstado(...);
   });
   return [$peticiones, []];
   ```

   También: `origenCaptura('https')` (URL base) y `fijarPropiedadPrivada()`.
   Si el cliente lanza, el caso falla; para comparar un camino de error,
   capturarlo dentro de la función. Si interesa comparar también lo que el
   cliente devolvió, agregarlo a los bytes.
3. `pnpm paridad:generar <caso>`.
4. **Test de Node** en `packages/core/test/paridad/`, con
   `test/soporte/captura.ts`:

   ```ts
   const captura = usarServidorCaptura(); // levanta y cierra el servidor del archivo

   for (const caso of casos<Entrada>('miOperacion')) {
     it(caso.nombre, async () => {
       const { peticiones } = await captura.ejecutar(caso.entrada.http, ({ origenes, transporte }) =>
         new ClienteX({ transporte, url: origenes.https }).consultarEstado(...),
       );
       exigirIdentico(peticiones, esperado(caso.nombre).bytes, caso.nombre);
     });
   }
   ```

   `transporte` es un `TransporteUndici` nuevo por caso que confía en la CA de
   prueba. `cabecerasComoCurl([...])` traduce una lista `CURLOPT_HTTPHEADER`
   (con `Accept: */*` y `"Expect:"` que quita) para los casos que imitan cURL.

Ejemplo completo: `operaciones/http-multipart.php` y
`packages/core/test/paridad/http-multipart.test.ts` (casos `http-multipart-*`).

### Folios (`http-folios-*`, `html-form-*`, `resolver-url`, `sesion-sii-*`)

`operaciones/folios.php` tiene cuatro operaciones (detalle en su cabecera):

- `formFolios`: `SolicitudFolios::form()` (privado, por reflexión) sobre cada página
  de `entrada.paginas`. Compara el parser HTML de Node (`comun/html.ts`) con
  `DOMDocument::loadHTML` de libxml: formularios dentro de tablas, cierres
  automáticos, atributos raros, texto crudo de `<script>` y el `<meta charset>`
  que vuelve a decodificar la página (`html-form-codificacion`).
- `resolverUrl`: `SolicitudFolios::resolverUrl()` y `NavegadorSii::resolverUrl()`
  (deben dar lo mismo) contra `resolverUrl()` de Node.
- `sesionSii`: cookies (`Set-Cookie`, `document.cookie`, dominios, borrados).
- `httpFolios`: `SolicitudFolios` contra el servidor de captura. El login
  (`herculesr.sii.cl`) va al origen `https` y el asistente (`maullin.sii.cl`) a
  `https2`: un transporte (`TransporteHaciaCaptura`, en PHP y en el test de Node)
  cambia solo el destino de cada petición, así la URL que ve el cliente, sus
  candados, el `Referer` y las cookies son los reales.

Los casos `http-folios-*` se arman con `node paridad/folios/armar-casos.mjs` desde
las páginas **sintéticas** de `folios/paginas/` (estilo del asistente del SII,
sin datos reales, enviadas en ISO-8859-1); después, `pnpm format` y
`pnpm paridad:generar`. Las páginas están fuera de Biome (son HTML roto a
propósito).

Generarlos en Windows necesita lo mismo que los `certificado-*` (`OPENSSL_CONF` y
el `openssl` de Git en el PATH): `http-folios-completo` usa un .pfx legacy.

### Postulación (`http-postulacion-*`, `html-form-postulacion-*`, `texto-html-*`)

`operaciones/postulacion.php` tiene tres operaciones (detalle en su cabecera), que
compara `packages/core/test/paridad/postulacion.test.ts`:

- `formPostulacion`: `NavegadorSii::form()` sobre cada página de `entrada.paginas`.
  Es la regla de la postulación (sin `<select>`, sin botones, image ni disabled,
  checkbox/radio solo marcados, `trim`), que NO es la de folios (`formFolios`).
- `textoPostulacion`: `NavegadorSii::texto()` completo y recortado, `strip_tags()`,
  `html_entity_decode(ENT_QUOTES | ENT_HTML5)`, los marcadores de rechazo y
  "ha sido aceptada" con `mb_stripos`, y `PostulacionSii::aviso()` (privado, por
  reflexión). En la postulación ese texto decide el flujo, así que Node replica la
  máquina de estados de `strip_tags`, la tabla de HTML5 completa
  (`comun/entidades-html5.ts`), el `\s` de PCRE con `/u` (incluye `&nbsp;`, U+0085
  y U+180E) y el plegado de mayúsculas de `mb_stripos`.
- `httpPostulacion`: `PostulacionSii` contra el servidor de captura. El login
  (`herculesr.sii.cl`, solo en `accion: completo`) va al origen `https` y maullin a
  `https2`, con el mismo `TransporteHaciaCaptura` de folios. El resultado es `ok`
  (empresa, avisos, mensaje y cookies) o `error sesion-caduca` / `error postulacion`;
  si la confirmación no calzó, se agrega `[CAMPO=var_export]`, que compara el
  campo y el `var_export` del mensaje.

Los casos se arman con `node paridad/postulacion/armar-casos.mjs` desde las
páginas **sintéticas** de `postulacion/paginas/` (estilo del asistente del SII, RUT
de prueba y correos de `empresa-prueba.cl`, enviadas en ISO-8859-1; algunas son
plantillas: la confirmación repite los datos enviados, como el SII). Después,
`pnpm format` y `pnpm paridad:generar <casos>`. Las páginas están fuera de Biome.
Cubren: flujo completo con login, avisos (2, y 4 que detienen el flujo), con y sin
boleta exenta, tildes, `&` y `€` en los datos (ISO-8859-1, `€` → `?`), el `<meta
charset=iso-8859-1>` (un hidden con `Ñ` se reenvía doblemente codificado, y una
confirmación que repite un `NOM_SW` con tildes no calza y detiene la postulación),
confirmación distinta (sin el POST a `pe_graba_postulacion`), rechazo del SII,
sesión caducada (redirección y página), redirección y `action` fuera de maullin,
página final sin "ha sido aceptada", HTTP 500 y 307 en el POST que graba, y campos
con nombre numérico (`array_merge` los renumera desde 0). Solo `http-postulacion-completo`
usa material (`cert-cadena.pem`, un PEM: no necesita el `openssl` de Git).

Divergencia en la categoría (no en las peticiones), sin casos de paridad: antes de
grabar, Node exige HTTP 200 y lanza `ErrorTransporte` con otro código o una falla de
red; el PHP envolvía la red en `PostulacionException` y no miraba el código (lo
cubren los unitarios). En `http-postulacion-graba-500` los dos dan `postulacion`.

### Declaración de cumplimiento (`http-declaracion-*`)

`operaciones/declaracion.php` tiene una operación, `httpDeclaracion`, que compara
`packages/core/test/paridad/declaracion.test.ts`: `DeclaracionBoletas` contra el
servidor de captura, con `www4.sii.cl` en el origen `https`. Como
`DeclaracionBoletas` envía cuerpos crudos (GWT-RPC), el PHP usa
`TransporteCrudoHaciaCaptura` (implementa `TransporteCuerpoCrudo`; los GET pasan por
el `TransporteHaciaCaptura` de folios). `entrada.accion`: `estado`, `declarar`,
`solicitarRevisionSet`, `descargarSetPruebas` o `verificarPortal`, con la sesión de
`entrada.sesion` (cookies `RUT_NS`/`DV_NS` del usuario, más una host-only de maullin
que no debe llegar a www4). El resultado es `ok` + el `EstadoDeclaracion` en JSON
(estado, declarar), el texto del set (descarga) o la lista de problemas
(verificarPortal), o `error <categoria>` (`incierta`, `set-sin-descargar`,
`sesion-caduca`, `postulacion`; con `[respuesta=...]` cuando el mensaje trae el
`var_export` de `ingresarTrackId`).

La fecha de hoy de `declarar()` sale en el PHP de `new DateTimeImmutable('now',
America/Santiago)`, que `conHoraFija()` no puede fijar (no pasa por `date()`). Por
eso los casos de declarar usan la opción `normalizar.fechasGwt` del servidor de
captura: en los cuerpos `text/x-gwt-rpc`, cada token `dd-mm-aaaa` pasa a `<fecha>`
(también las fechas de los documentos que se reenvían). Se siguen comparando la
posición de la fecha en la tabla de strings y cada índice que la usa; el test de Node
fija el reloj en cualquier día, y la fecha en hora de Chile la cubren los unitarios.

Los casos se arman con `node paridad/declaracion/armar-casos.mjs` (respuestas GWT
**sintéticas**, varias iguales a las de `gwt-leer-*`; RUT de prueba, correos de
`empresa-prueba.cl`, cookies y trackIds inventados), después `pnpm exec biome check
--write paridad/casos` y `pnpm paridad:generar <casos>`. No necesitan material.
Cubren: estado P90 (con una cookie nueva del portal), P91 con paso nulo, nulo, paso
`' 9.0e1 '` (`is_numeric`), una 302 dentro de www4 (el GET conserva las cabeceras
GWT, incluido el `Content-Type`), sesión caducada e `IncompatibleRemoteServiceException`;
declarar completo (razón social con `Ñ`, nombre del proveedor con tildes, documentos
con Long > 2^53 reescritos con `valor()`), sin P90 (sin más peticiones), sin
`RUT_NS` (sin peticiones), sin documentos (sin la orden), y la orden respondida sin
P91, con `//EX`, con HTTP 500 o con el login (incierta); la revisión del set (`1` con
código 90, `errorEstado` con código 91, otra respuesta con comilla); la descarga
(set en ISO-8859-1, query de `http_build_query` con `%40`, Referer `?SET=1`), los dos
candados de P90 y una página sin el set; y `verificarPortal` vigente, 404 y con
faltantes.

Divergencias en la categoría (no en las peticiones), sin casos de paridad: con HTTP
distinto de 200 antes de la orden de declarar (y en la descarga y en
`verificarPortal`), Node lanza `ErrorTransporte` y el PHP `PostulacionException`; un
trackId o RUT inválido es `ErrorValidacion` en Node. Lo cubren los unitarios. En
`http-declaracion-declarar-500` los dos dan `incierta`.

### Material TLS del servidor

`material/captura-ca.pem` (CA de prueba), `captura-servidor.pem` y
`captura-servidor-llave.pem` (hoja `CN=localhost`, SAN `localhost`,
`127.0.0.1`, `::1`; RSA 2048, 100 años). Solo sirve para el servidor local. La
llave de la CA no se guardó: para regenerarlo, crear otra CA y otra hoja
(`openssl req -x509 ... -addext basicConstraints=critical,CA:TRUE`, `openssl x509
-req ... -extfile` con `subjectAltName` y `extendedKeyUsage = serverAuth`); los
esperados HTTP no cambian.
