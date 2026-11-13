# Validaciones contra el SII

Según PLAN-MIGRACION §5.4, cada fase que habla con el SII se ejecuta contra el ambiente de
**certificación** (maullin / apicert / pangal) antes de darse por terminada, y el resultado
queda registrado aquí: fecha, flujo, resultado (trackId y estado devuelto cuando aplique).

Nunca se anotan RUTs, nombres de titulares, claves, tokens ni cookies.

## Fase 0 — prueba de humo TLS (2026-11-05)

**Resultado: OK.** Los cinco hosts aceptan TLS con verificación estricta y TLS mutuo con un
certificado real, sin relajar nada de OpenSSL 3.

- **Script:** `pnpm humo:tls` (`scripts/humo-tls.ts`).
- **Entorno:** Windows 11, Node v24.21.0, OpenSSL 3.5.8, verificación estricta del
  certificado del servidor (`rejectUnauthorized: true`, SNI).
- **RSA-SHA1:** disponible (firma y verificación OK con la configuración por defecto).
- **Certificado de cliente:** .pfx real emitido por una CA acreditada (IDOK Firma
  Electrónica V4), RSA 2048, con 2 intermedios. node-forge lo lee sin el binario openssl.
  El .pfx vive fuera del repo y se referencia desde `.env`.

| Host | Rol | Protocolo | Cifrado | Cert servidor | mTLS (handshake) | GET de prueba con cert | Relajación OpenSSL 3 |
|---|---|---|---|---|---|---|---|
| maullin.sii.cl | SOAP DTEWS | TLSv1.3 | TLS_AES_128_GCM_SHA256 | OK (GeoTrust TLS RSA CA G1, vence 2027-05-12) | OK | `/DTEWS/CrSeed.jws?WSDL` → 200 `text/xml` (WSDL) | ninguna |
| apicert.sii.cl | REST boleta semilla/token | TLSv1.2 | TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384 (ECDH secp521r1) | OK (GeoTrust TLS RSA CA G1, vence 2027-05-15) | OK | `/recursos/v1/boleta.electronica.semilla` → 200 `text/html`, pero el cuerpo es un error JBoss "HTTP Status 500" (ver notas) | ninguna |
| pangal.sii.cl | REST boleta envío | TLSv1.3 | TLS_AES_128_GCM_SHA256 | OK (GeoTrust TLS RSA CA G1, vence 2027-05-13) | OK | `/recursos/v1/boleta.electronica.semilla` → 404 (esperable: pangal solo recibe envíos) | ninguna |
| herculesr.sii.cl | AUT2000 login mTLS (compartido cert/prod) | TLSv1.3 | TLS_AES_256_GCM_SHA384 | OK (GeoTrust TLS RSA CA G1, vence 2026-12-03) | OK | `/` → 200 (sin cert: 302) | ninguna |
| zeusr.sii.cl | AUT2000 sesión (compartido cert/prod) | TLSv1.3 | TLS_AES_128_GCM_SHA256 | OK (GeoTrust TLS RSA CA G1, vence 2026-12-03) | OK | `/` → 200 | ninguna |

Notas:

- Ningún host necesitó relajar OpenSSL 3 (sin renegociación legacy, sin cifrados ni DH débiles).
- herculesr y zeusr son los hosts de AUT2000 que usa `SolicitudFolios.php`; los comparten
  certificación y producción (solo cambia la URL de vuelta a maullin o palena).
- **herculesr acepta la cadena real enviada por Node:** con el certificado responde 200 en `/`
  (sin certificado, 302). Con un .pfx autofirmado de prueba rechazaba con
  `tlsv1 alert unknown ca`. El login real (POST a `/cgi_AUT2000/CAutInicio.cgi`) no se probó
  aquí para no gatillar el límite de logins del SII; se valida en la fase 5.
- herculesr pide el certificado de cliente en el handshake inicial (no por renegociación), lo
  que evita el problema de renegociación de OpenSSL 3.
- **apicert:** la semilla de boleta responde 200 con una página de error 500 de JBoss, con y
  sin certificado. Con `curl` (Schannel) pasa lo mismo, así que es del servidor del SII y no
  de Node/TLS. Revisar de nuevo en la fase 4 (canal REST).
- Vencimientos a vigilar: los certificados de servidor de herculesr y zeusr vencen el
  2026-12-03; si el SII los renueva con otra CA, repetir esta prueba.

## Fase 2 — certificado real: Node frente al PHP (2026-11-06)

**Resultado: OK.** Con el .pfx real del `.env`, `Certificado` y `firmarSemilla` de Node
dan los mismos bytes que el core PHP v1.9.1. No habla con el SII (es una comparación
local); deja validada la fase 2 con material real además del de prueba.

- **Cómo:** un script local, fuera del repo, carga el .pfx con ambas librerías y compara
  los hashes SHA-256 de cada campo. No se imprimió ni guardó material del certificado.
- **Entorno:** Windows 11, Node v24, PHP 8.3 (OpenSSL 3), `openssl` de Git en el PATH.
- **El .pfx es legacy:** `openssl_pkcs12_read` no lo lee y el PHP cae al binario
  `openssl -legacy`. Node lo lee con node-forge. La cadena tiene 3 certificados
  (hoja + 2 intermedios).

| Campo | Node = PHP |
|---|---|
| llave privada (`getPrivateKey`) | ✅ |
| certificado (`getPublicKey`) | ✅ |
| cadena TLS (`getPublicKeyChain`, normalizada a LF) | ✅ |
| `getInfo` (CN y vigencia, `America/Santiago`) | ✅ |
| `firmarSemilla` con el certificado real | ✅ |
| `toPem()` | ⚠️ distinto, esperado (ver notas) |
| `identidadTls()` aceptada por `node:tls` | ✅ |

Notas:

- **`toPem()`:** en Windows, el fallback legacy del PHP devuelve la cadena con CRLF, por lo
  que `toPem()` no deduplica la hoja y la repite. Node sigue el comportamiento de Linux.
  Se comprobó que el valor del PHP es exactamente el `toPem()` de Node con ese defecto
  reproducido. `toPem()` sirve para guardar el certificado ya convertido; no se envía al SII.
- **Orden de la cadena (PLAN §8):** el defecto hoja → raíz → intermedia solo afecta a .pfx
  no legacy. Con el .pfx real (legacy) la cadena conserva el orden del .pfx y coincide con
  la del PHP.
- El certificado está vigente; revisar la fecha de vencimiento antes del piloto (fase 8).

## Fase 4 — canales de envío (2026-11-06)

**Script:** `node scripts/validar-certificacion.ts <comando>` (`scripts/validar-certificacion.ts`).
Siempre ambiente de certificación. Configuración en `.env` (ver `.env.example`).

| Comando | Qué hace | Envía documentos |
|---|---|---|
| `token` | Token SOAP (maullin, `ClienteDtews`) y REST (apicert, `ClienteBoletaRest`) | No |
| `armar` | Arma el set (`ArmadorBoleta` + `EnvioBoleta`) y el RCOF y los guarda en `data/output/` | No |
| `enviar [--canal soap\|rest]` | Arma y envía el set y luego el RCOF (por defecto DTEUpload, como los bin del PHP) | Sí: consume folios |
| `estado <trackId>...` | Consulta cada envío por SOAP (`QueryEstUp`) y por REST (`boleta.electronica.envio`) | No |

Así era el script en la fase 4. Desde el 2026-11-07, `armar` y `enviar` ya no arman ni
envían el RCOF salvo con `--con-rcof` (el SII eliminó el RCOF desde el 2022-08-01).

### Paso 1: tokens con el certificado real (2026-11-06)

**Resultado: OK.** Con el .pfx real (legacy):

- **SOAP (maullin):** `CrSeed` → `GetTokenFromSeed` → token. Confirma en el SII real la
  firma de semilla propia del PHP que Node replica (`firma-semilla-dtews.ts`: SignedInfo
  sin C14N y el PEM completo en `<X509Certificate>`).
- **REST (apicert):** `boleta.electronica.semilla` → `boleta.electronica.token` → token,
  con la semilla firmada por `FirmaElectronica.firmarSemilla`.
- El primer intento a apicert se cortó por el tope de conexión (10 s); curl conectó en
  1,1 s y el reintento del script funcionó. Falla pasajera de la red o del SII, no del
  cliente. Si se repite, conviene un reintento en la conexión de las peticiones
  repetibles (semilla, token, consulta).

Procedimiento paso a paso (para repetirlo): [certificacion.md](certificacion.md).

### Paso 2: revisión de la configuración y armado local (2026-11-06)

- `node scripts/revisar-env.ts` revisa el `.env` sin imprimir valores: RUTs válidos, el RUT
  que firma aparece en el certificado (es el titular), resolución `0` con fecha de
  certificación, CAF tipo 39 con IDK 100 (certificación) del mismo RUT empresa, y que los
  folios del set caben en el rango del CAF. Resultado: sin errores.
- `armar`: 5 casos del set → folios 26 a 30 (CAF de certificación con rango 26–30).
  Sobre `EnvioBOLETA` de 30 634 bytes y RCOF de 4 345 bytes (en `data/output/`, sin versionar).
- **Validación XSD** (PHP 8.3, libxml 2.10.4): el sobre valida contra `EnvioBOLETA_v11.xsd`
  y el RCOF contra `ConsumoFolio_v10.xsd`.

### Paso 3: envío al SII de certificación (2026-11-06)

`enviar --canal soap`, como los bin del PHP: un token SOAP y dos `DTEUpload` a maullin,
cada uno por una conexión nueva (`conexionNueva`).

| Envío | TrackID | Resultado de la subida |
|---|---|---|
| Set de pruebas (`EnvioBOLETA`, 5 boletas tipo 39, folios 26–30) | 0263913806 | aceptada, trackId recibido |
| RCOF (`ConsumoFolios`, mismo día, mismos folios y montos) | 0263913808 | aceptada, trackId recibido |

### Paso 4: estado de los envíos (2026-11-06)

`estado 0263913806 0263913808`: SOAP `QueryEstUp` y REST `boleta.electronica.envio`.

| TrackID | SOAP (`QueryEstUp`) | REST (`boleta.electronica.envio`) |
|---|---|---|
| 0263913806 (set) | **EPR — Envío Procesado**: 5 informados, **5 aceptados**, 0 rechazados, 0 reparos | `No existe recurso` |
| 0263913808 (RCOF) | **RPR — Aceptado con Reparos** (número de atención 395705) | `No existe recurso` |

Notas:

- **Set aceptado completo** por el SII: las 5 boletas armadas, timbradas y firmadas por Node
  (`ArmadorBoleta`, `Timbre`, `FirmaElectronica`, `EnvioBoleta`) pasaron la validación de
  firma, TED y esquema del SII sin reparos.
- **RCOF aceptado con reparos.** `QueryEstUp` no trae el detalle de los reparos: el SII lo
  informa por correo al contacto de la empresa y en el portal de certificación. **Nota
  (2026-11-07):** el SII eliminó la obligación de enviar el RCOF a partir del 1 de agosto de
  2022 (sigue solo para períodos hasta julio de 2022), así que estos reparos no requieren
  acción: el RCOF se envió solo porque los scripts del PHP lo hacían.
- **Código `-11` transitorio:** consultado apenas subido, el RCOF devolvió `ESTADO -11` sin
  glosa; minutos después, `RPR`. `EstadoEnvio.enProceso()` (igual que el PHP) no considera
  `-11` como "en proceso". Conviene tratarlo como reintentable en la CLI (fase 7); no
  cambia bytes enviados.
- **REST no conoce los envíos de DTEUpload:** `boleta.electronica.envio/{rut}-{dv}-{trackId}`
  responde "No existe recurso" para trackIds subidos por SOAP. La consulta REST solo sirve
  para envíos subidos por la API REST (pangal). El cliente REST respondió bien (HTTP 200 del
  token, error tipado `ErrorRespuestaSii` sin exponer el token).
- **Conexiones:** dos veces el primer intento del día a un host (apicert, maullin) agotó el
  tope de conexión de 10 s y el reintento funcionó al tiro (curl conectaba en < 1,5 s;
  maullin también respondió un 503 suelto a curl). Falla de la red o del SII, no del
  cliente. Queda como mejora: reintentar la conexión en las peticiones repetibles
  (semilla, token, consulta), nunca en las subidas.

### Resultado de la fase 4: certificación aprobada (2026-11-06)

**Resultado: OK.** Con el set de pruebas y el RCOF armados, firmados y enviados por Node, el
SII aprobó la certificación de boleta electrónica y la empresa quedó **autorizada para el
ambiente de producción** (lo confirmó el usuario en el portal). Los reparos del RCOF no
bloquearon la aprobación.

Queda validado contra el SII real, de punta a punta: lectura del .pfx legacy, token SOAP
(firma de semilla propia del PHP), `ArmadorBoleta` (timbre TED con el CAF), firma de cada
DTE, sobre `EnvioBOLETA`, RCOF desde los DTE (`resumirParaRcof`), multipart de
`DTEUpload` y `QueryEstUp`.

**Pendiente anotado** (por decisión del usuario): subida por la API REST (pangal) y su
consulta. El canal REST se validó hasta el token (apicert) y la consulta; falta una subida
REST con un CAF de certificación nuevo (5 folios). Hacerlo antes de emitir en producción por
REST (fase 8).

## Fase 5 — solicitud de folios (2026-11-07)

Con `scripts/solicitar-folios.ts` (solo la librería Node, ambiente `certificacion`), el
certificado real (.pfx legacy) y el RUT de la empresa del `.env`. El script guarda las
respuestas del SII en `data/output/folios-<fecha>/` (no se versiona) y nunca imprime
cookies, la clave ni el CAF.

### Paso 1: recorrido sin timbrar (`revisar`)

Login AUT2000 con TLS mutuo en `herculesr.sii.cl` (HTTP 200, `TOKEN` y las
`NETSCAPE_LIVEWIRE.*` por `document.cookie` y `Set-Cookie`) y asistente de maullin:
`of_solicita_folios` → `of_solicita_folios_dcto` → `of_confirma_folio`. El script se
detuvo antes de `of_genera_folio` (esa petición no salió); la confirmación ofrecía los
folios 31–35.

**Páginas reales contra el PHP:** el formulario de las 3 páginas del asistente, leído con
`formularioFolios()` (Node) y con `SolicitudFolios::form()` (PHP, libxml), salió
**idéntico** (action, campos, orden y valores). Las páginas son ISO-8859-1 y declaran
`<meta http-equiv="Content-Type" ... charset=iso-8859-1>`, así que el defecto de doble
codificación (PLAN §8) aplica en la realidad. En este flujo no cambia lo enviado: el único
valor no ASCII es el `ACEPTAR` del paso 2, que se reemplaza por `Continuar`; el `NOMUSU`
de esta empresa no tiene tildes. Con un usuario con tildes en el nombre, el `NOMUSU` se
reenviaría doblemente codificado (igual que el PHP).

Notas: el paso 2 llegó directo a la confirmación (sin recargar `of_solicita_folios_dcto`);
el login trae una `Set-Cookie` cuyo nombre se lee como `path` (el PHP la lee igual).

### Paso 2: solicitud real (`solicitar`)

| Paso | Resultado |
|---|---|
| Login AUT2000 | HTTP 200, sesión OK |
| `of_solicita_folios` → `_dcto` → `of_confirma_folio` | HTTP 200 cada uno |
| `of_genera_folio` (timbra, conexión propia) | HTTP 200 |
| `of_genera_archivo` | HTTP 200, `application/octet-stream`, 1182 bytes |

**Resultado: OK.** CAF de boleta (tipo 39), folios **31–35**, IDK 100 (certificación), RE =
RUT de la empresa, `FA` = fecha del día en Chile (2026-11-07), con la llave `RSASK`.
`Timbre` lo carga. Guardado en `data/caf/caf-39-31-35.xml` (no se versiona).

Queda validado contra el SII real: login con certificado de cliente (cadena del .pfx
legacy), cookies de la sesión, navegación y candados del asistente, parser HTML, timbraje
y descarga del CAF, y la revisión del CAF (IDK, RUT, tipo).

Estos 5 folios sirven para el pendiente de la fase 4 (subida REST en pangal).

## Fase 4 (pendiente anotado) — subida por la API REST (2026-11-07)

Con `node scripts/validar-certificacion.ts enviar --canal rest`, el certificado real y el
CAF de certificación obtenido por Node en la fase 5 (folios 31–35). El set y el RCOF se
armaron igual que en la fase 4 (5 casos, folios 31–35).

| Envío | Subida (pangal) | Consulta REST | Consulta SOAP (`QueryEstUp`) |
|---|---|---|---|
| Set de pruebas, trackId 33887260 | HTTP 200, `REC` | **EPR — 5 informados, 5 aceptados, 0 rechazados, 0 reparos** | `-11` (no conoce los envíos REST) |
| RCOF | **HTTP 404** (`Error 404`) en `/recursos/v1/boleta.electronica.consumo` | — | — |

**Resultado: OK para la boleta.** Queda validado contra el SII real el canal REST completo:
semilla y token (apicert), multipart de la subida (pangal) y consulta del envío. Con la fase
4, los dos canales quedan probados: cada consulta solo conoce los envíos de su propio canal
(SOAP no ve los REST y REST no ve los de DTEUpload).

**RCOF por REST: el SII responde 404.** Node usa la misma URL que el PHP
(`SiiBoletaProduccion::enviarConsumoFolios`), así que el PHP recibiría lo mismo; no es un
defecto del port. Pangal no expone ese recurso, lo que calza con que **el SII eliminó la
obligación de enviar el RCOF a partir del 1 de agosto de 2022** (sigue solo para períodos
hasta julio de 2022 inclusive). En la fase 4 el RCOF sí se recibió por DTEUpload (RPR).
Decisión para la CLI (fase 7, ver PLAN §1): no se envía en el flujo normal; queda solo para
períodos antiguos pendientes, por DTEUpload.

## Fase 6 — portal de la declaración de cumplimiento (2026-11-07)

Con `node scripts/declaracion.ts`, el certificado real y la empresa ya autorizada en
producción (fase 4). Con el OK del usuario se ejecutaron solo las consultas que no cambian
nada en el SII: no se declaró, no se pidió la revisión del set ni se descargó un set nuevo.

| Subcomando | Qué envía | Resultado |
|---|---|---|
| `verificar-portal` | GET público (sin cookies) a `certBolElectDteInternet/0FC3D987613537E6E13E9BB93A406F13.cache.html` en www4 | **Portal vigente:** existe la permutación capturada y trae la POLICY, el servicio, las 4 firmas de tipo, los 7 métodos y `DownloadFileServlet` |
| `estado` | Login AUT2000 con TLS mutuo (herculesr → maullin, el mismo de folios) y `obtenerEstadoAutorizaEmp` por GWT-RPC en www4 | Sesión OK; el SII respondió **sin trámite** (`null`), lo esperado para una empresa ya autorizada |

**Resultado: OK.** Quedan validados contra el SII real el login reutilizado por la
postulación, el cuerpo GWT-RPC con la POLICY y la permutación capturadas (el SII no
respondió `IncompatibleRemoteServiceException`), las cabeceras `X-GWT-*` y la lectura de la
respuesta.

No se validó `descargarSetPruebas`: la empresa ya está autorizada (P91) y no se sabe si
registrar un set nuevo la afectaría en el SII. Tampoco la postulación completa ni la
declaración: no hay otro RUT disponible para hacerlas (PLAN, fase 6).

## Fase 7 — CLI `sii` (2026-11-07)

Con la CLI compilada (`node apps/cli/dist/main.js`), el `.env` y el certificado reales.

**Primero, sin red:** `certificacion enviar-set --solo-armar` armó el set de 5 boletas
(folios 31–35 del CAF configurado; no se envió). Después, `util verificar-ted` verificó los
5 TED de ese sobre contra el CAF: **5 OK**.

**Después, contra el SII de certificación**, con el OK del usuario y solo con consultas
que no cambian nada en el SII:

| Comando | Qué envía | Resultado |
|---|---|---|
| `certificacion verificar-portal` | GET público a la permutación capturada en www4 | **Portal vigente** (código 0) |
| `certificacion estado-declaracion` | Login AUT2000 + `obtenerEstadoAutorizaEmp` (GWT) | Sesión OK; **sin trámite pendiente**, lo esperado para una empresa autorizada (código 0) |
| `certificacion estado-envio 33887260` (set subido por REST, fase 4) | Token SOAP + `QueryEstUp`; token REST + `boleta.electronica.envio` | REST: **EPR, 5 informados, 5 aceptados**; SOAP: `-11` (QueryEstUp no conoce los envíos REST). Código 0 |
| `certificacion estado-envio 0263913806` (set subido por DTEUpload, fase 4) | Igual | SOAP: **EPR Envio Procesado, 5 aceptados**; REST: "No existe recurso" (no conoce los envíos de DTEUpload). Código 0 |

**Resultado: OK.** La CLI lee la configuración real, hace el login y pide tokens por los dos
canales, y lee las respuestas reales igual que los scripts de las fases 4–6.

Ajuste hecho a partir de esta validación: `estado-envio` ahora explica el `-11` de SOAP (es
un envío REST, o uno recién subido por DTEUpload que hay que volver a consultar). Antes lo
mostraba sin glosa.

Quedan sin validar en el SII real, a propósito:
- `postular`, `descargar-set`, `solicitar-revision` y `declarar`: la empresa ya está
  autorizada (P91).
- `produccion emitir` / `consultar`: son de la fase 8, con aprobación explícita.
- `enviar-rcof`: el RCOF ya no es obligatorio.

### Fase 7: envío completo con la CLI (2026-11-10)

El usuario dio el OK para timbrar folios nuevos de certificación y enviar el set solo con
la CLI. Pasos:

1. `certificacion solicitar-folios --cantidad 5` (ensayo): login y recorrido del
   asistente; se detuvo antes de timbrar e informó los folios 36 a 40.
2. `certificacion solicitar-folios --cantidad 5 --confirmar`: **CAF obtenido**, tipo 39,
   folios 36–40. Quedó en `data/caf/caf-39-36-40.xml` (no se versiona).
3. `certificacion enviar-set --caf data/caf/caf-39-36-40.xml --folio-inicial 36`
   (canal por defecto: DTEUpload en maullin). Armó los 5 casos y la subida devolvió el
   **trackId 0263994364**.
4. `util verificar-ted` sobre el sobre enviado, con el CAF nuevo: **5 TED OK**.
5. `certificacion estado-envio --canal soap 0263994364`: **EPR Envio Procesado:
   5 informados, 5 aceptados, 0 rechazados, 0 con reparos**.

**Resultado: OK.** El flujo de envío de la certificación (folios → set → estado) funciona
solo con la CLI contra el SII real. Todos los comandos terminaron con código 0.

### Fase 8: folios de producción, recorrido sin timbrar (2026-11-10)

Con el OK del usuario, primer contacto con **producción** (palena), sin timbrar: la CLI
corta la orden de timbrar (`of_genera_folio`) antes de que salga.

1. `certificacion solicitar-folios --ambiente produccion --tipo 39 --cantidad 5`: login
   AUT2000 OK y recorrido del asistente de palena, pero **no llegó a la confirmación**
   (código 5). Diagnóstico con las páginas guardadas fuera del repo (no se versionan): es
   el **primer timbraje** de boletas de la empresa en producción ("No registra timbraje
   anterior"), y el SII pide **"Ingrese Folio Inicial"** (propone 1) con el botón
   "Confirmar Folio Inicial". El PHP, y Node por paridad, mandaban siempre
   `FOLIO_INICIAL=0`, y el SII repetía la página. En certificación no aparecía porque la
   empresa ya tenía timbrajes. La página muestra "Disponible 0" y "Máximo Autorizado 0".
2. Corrección (decisión del usuario): opción `folioInicial` en `SolicitudFolios.solicitar`
   y `--folio-inicial` en la CLI. Solo se envía en esa página (con su propio botón); sin
   ella, esa página lanza `FolioInicialRequeridoError` sin enviarse. Lo demás no cambia
   (paridad intacta: 320 casos idénticos).
3. `certificacion solicitar-folios --ambiente produccion --tipo 39 --cantidad 5
   --folio-inicial 1`: llegó a la confirmación; **el SII asignaría los folios 1 a 5** de
   tipo 39. No se timbraron (código 0).

**Resultado: OK.** Login con el certificado real y parser HTML correctos con las páginas
reales de producción. "Máximo Autorizado 0" no impidió llegar a la confirmación.
Siguiente paso, con OK del usuario: el mismo comando con `--confirmar` (folios reales).

### Fase 8: CAF de producción (2026-11-10)

Con el OK del usuario:
`certificacion solicitar-folios --ambiente produccion --tipo 39 --cantidad 5 --folio-inicial 1 --confirmar`.

- Login, folio inicial confirmado, orden de timbrar y descarga: **CAF obtenido**, tipo 39,
  **folios 1–5**, IDK 300 (producción), `FA` 2026-11-10 (fecha de Chile), emisor = la
  empresa del `.env`. Código 0.
- Quedó en `data/caf/caf-produccion-39-1-5.xml` (ignorado por git) y en el `.env` como
  `SII_PRODUCCION_CAF_39`.

**Resultado: OK.** Primer timbraje de producción hecho solo con Node; el PHP no habría
podido hacerlo (manda `FOLIO_INICIAL=0`, ver §8 del plan).

### Fase 8: ensayo de emisión en producción, sin red (2026-11-10)

- Resolución de producción tomada del portal del SII ("datos de la empresa autorizada"):
  **N° 80 del 2014-08-22**, igual a los valores que el PHP traía fijos. Quedó en el `.env`
  (`SII_PRODUCCION_NRO_RESOL`, `SII_PRODUCCION_FCH_RESOL`).
- `produccion emitir --boleta data/piloto/boleta-1.json --folio 1` (sin `--confirmar`):
  boleta 39 armada, timbrada y firmada con el CAF de producción (folio 1, 1 ítem, total
  $1.190, receptor genérico). **Ninguna petición de red**; no dejó registro de envío.
- `util verificar-ted ... --caf data/caf/caf-produccion-39-1-5.xml`: **1 TED OK**.
- El sobre `EnvioBOLETA` valida contra `EnvioBOLETA_v11.xsd` (PHP/libxml en local).

**Resultado: OK.** Lista para la primera emisión real (paso 4), con el OK del usuario y con
los ítems de una venta real.

### Fase 8: primera boleta real en producción (2026-11-10)

Con el OK del usuario, una venta real de bajo riesgo: 1 × "Cable USB" a $1.190 (IVA
incluido), receptor genérico, folio 1 del CAF de producción.

1. Ensayo sin `--confirmar` con el ítem real + `util verificar-ted --caf ...`: TED OK.
2. `produccion emitir --boleta data/piloto/boleta-1.json --folio 1 --confirmar`: token REST
   en api.sii.cl y subida a rahue.sii.cl → **trackId 24566880452**, estado REC. Dejó el
   registro `data/output/boleta-produccion-1.envio.json` (bloquea el folio 1).
3. `produccion consultar 24566880452`: **EPR, 1 informado, 1 aceptado, 0 rechazados,
   0 reparos**.
4. `produccion seguimiento --bitacora data/piloto/bitacora.jsonl`: misma respuesta;
   primera línea de la bitácora del período de observación. Código 0.

**Resultado: OK.** Primera boleta electrónica real emitida solo con Node, aceptada sin
reparos. Empieza el período de observación (1–2 semanas): `seguimiento` una vez al día.

### Fase 8: boletas 2 a 5 del piloto (2026-11-10)

Con el OK del usuario, 4 ventas más, iguales a la primera: 1 × "Cable USB" a $1.190,
receptor genérico, folios 2–5 (`data/piloto/boleta-<folio>.json`).

1. Ensayo sin `--confirmar` + `util verificar-ted` de cada una: 4 TED OK.
2. `produccion emitir ... --confirmar`, una a una (deteniéndose ante cualquier código ≠ 0):

   | Folio | TrackID | Estado al enviar |
   |---|---|---|
   | 2 | 24567048084 | REC |
   | 3 | 24567048323 | REC |
   | 4 | 24567048640 | REC |
   | 5 | 24567048966 | REC |

3. `produccion seguimiento --bitacora data/piloto/bitacora.jsonl`: **los 5 envíos del
   piloto (folios 1–5) en EPR, aceptados, 0 rechazos, 0 reparos**. Código 0.

**Resultado: OK.** El CAF de producción 1–5 quedó usado completo. El seguimiento diario
automático sigue hasta el 2026-11-24.

### Datos de la empresa autorizada: `ad_empresa` (2026-11-13)

Consulta de solo lectura a la página «Actualización de datos del contribuyente» de
producción, con el certificado del `.env` y un script de prueba (no es un comando de la
CLI). El script hace `SolicitudFolios.autenticar` en producción, `GET
palena.sii.cl/cvc_cgi/dte/ad_empresa1` y `POST ad_empresa2` con `RUT_EMP`, `DV_EMP` y
`ACEPTAR`. Hubo 3 logins y nunca se envió el formulario de actualización que muestra
`ad_empresa2`.

| RUT | Respuesta |
|---|---|
| 20630500-2 (la empresa del `.env`) | Antecedentes registrados: autorización 06-11-2026, resolución **80 del 22-08-2014** (igual a `SII_PRODUCCION_NRO_RESOL` / `SII_PRODUCCION_FCH_RESOL`), nombre del software, correos y URL |
| 90749000-9, 11111111-1, 12345678-5 | «Usted no está registrado en la empresa Rut … como Representante Legal…» |
| 20630500-3 (DV erróneo) | «… el Contribuyente no está autorizado para operar en esta modalidad.» |

**Resultado: OK.** La página confirma la autorización y la resolución de producción, pero
solo cuando el titular del certificado es representante legal. Sin representación, la
respuesta no dice nada de la autorización. Su uso en el SaaS está en
`PLAN-SAAS.md` (Fase 5, «Verificar autorización en el SII»).

### Situación tributaria de terceros: timbrajes (2026-11-13)

Consulta pública, sin certificado, con `curl`. Primero `GET
www2.sii.cl/app/stc/recurso/v1/recaptcha/key`, que respondió `enable: false`. Después
`POST /app/stc/recurso/v1/consulta/getConsultaData/` con
`{ rut, dv, reAction: "consultaSTC", reToken: " " }`, que respondió 200 con
`captchaInvalido: false`.

| RUT | `timbrajes` |
|---|---|
| 20630500-2 (la empresa del `.env`) | solo `0039 Boleta Electronica`, año 2026, `folioFinal` 5 (el CAF de producción 1–5) |
| 90749000-9 | 25 tipos, de papel y electrónicos (33, 34, 46, 52, 56, 61, 110–112) |

**Resultado: OK.** «Documentos autorizados» es el historial de timbraje, no la lista de
autorizaciones: la empresa del `.env` está certificada solo en boleta, y la 41 no aparece
porque nunca se timbró. Su uso en el SaaS está en `PLAN-SAAS.md` (Fase 5, «Fuente de
apoyo: situación tributaria de terceros»).
