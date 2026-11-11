# Glosario

Términos del SII y del código, **tal como se usan en este proyecto**. Las definiciones
resumen lo que hace el código; para el detalle normativo, ver la documentación oficial del
SII. "Dónde" nombra la clase o el comando de Node (archivos en `packages/core/src/` y
`apps/cli/src/`).

## Documentos y XML

| Término | Qué es aquí | Dónde |
|---|---|---|
| **DTE** | Documento Tributario Electrónico. Aquí, el XML `<DTE><Documento ID="F{folio}T{tipo}">` de una boleta. | `GeneradorBoleta`, `ArmadorBoleta` |
| **Boleta 39 / 41** | `TipoDTE` de la boleta electrónica **afecta** (39) y **exenta** (41). | `GeneradorBoleta`, `sii produccion emitir` |
| **Folio** | Número correlativo de cada boleta. Solo se puede usar un folio que esté dentro de un CAF vigente, y una sola vez. | `ArmadorBoleta`, `SolicitudFolios` |
| **CAF** | Código de Autorización de Folios: XML firmado por el SII (`<AUTORIZACION><CAF><DA>…<FRMA>…</CAF><RSASK>…`) que autoriza un rango de folios. **Trae la llave privada del rango** (`RSASK`): no se versiona ni se comparte. | `Timbre`, `SolicitudFolios` |
| **DA** | Datos de autorización del CAF: `RE` (RUT emisor), `RS`, `TD` (tipo), `RNG` (`D`–`H`), `FA` (fecha), `RSAPK`, `IDK`. | `Timbre`, `ArmadorBoleta` |
| **IDK** | Identificador de la llave del SII dentro del CAF. Indica el ambiente: **100** = certificación, **300** = producción. Se usa como candado. | `datosAmbiente()`, `SolicitudFolios` |
| **RSASK / RSAPK** | Llave privada y pública RSA del CAF. Con la privada se firma el TED; con la pública el SII lo verifica. | `Timbre`, `sii util verificar-ted` |
| **TED** | Timbre Electrónico del DTE: `<TED><DD>…</DD><FRMT>…</FRMT></TED>`. Es lo que se imprime como código PDF417 en la boleta. | `Timbre` |
| **DD** | Datos del documento que se timbran: `RE`, `TD`, `F`, `FE`, `RR`, `RSR`, `MNT`, `IT1`, el `CAF` y `TSTED`. Se firma **aplanado** (sin espacios entre etiquetas) y **en ISO-8859-1**. | `Timbre` |
| **FRMT** | Firma SHA1withRSA del `DD`, hecha con la `RSASK`. | `Timbre` |
| **TSTED / TmstFirma / TmstFirmaEnv** | Marcas de tiempo del timbre, de la firma del DTE y de la firma del sobre. En Node salen de un reloj inyectable (hora de Chile); `ArmadorBoleta` usa una sola lectura por boleta. | `Timbre`, `ArmadorBoleta`, `EnvioBoleta` |
| **EnvioBOLETA** | Sobre que agrupa uno o más DTE firmados: `<EnvioBOLETA><SetDTE ID="SetDoc"><Caratula>…`. Se firma completo. | `EnvioBoleta` |
| **Carátula** | Encabezado del sobre: emisor, quien envía, receptor (`60803000-K` = el SII), resolución y `SubTotDTE`. | `EnvioBoleta` |
| **FchResol / NroResol** | Fecha y número de la resolución que autoriza al emisor. En certificación, `NroResol = 0` y `FchResol` = fecha de la postulación. En producción, los de la autorización de la empresa. | `EnvioBoleta`, `SII_FCH_RESOL`, `SII_PRODUCCION_*_RESOL` |
| **RCOF** | Resumen de Ventas Diarias, ex Reporte de Consumo de Folios (`<ConsumoFolios>`, ID `RCOF`). **El SII lo eliminó desde el 2022-08-01**; solo aplica a períodos hasta julio de 2022. Se mantiene por paridad. | `GeneradorConsumoFolios`, `resumirParaRcof`, `sii certificacion enviar-rcof` |
| **XML-DSig** | Firma XML estándar (`<Signature>`, RSA-SHA1, C14N 1.0 inclusivo) que el SII exige en DTE, sobres, RCOF y semilla. | `FirmaElectronica` |
| **C14N** | Canonicalización del XML antes de calcular el digest. Node usa una implementación propia que da los mismos bytes que libxml. | `comun/c14n.ts` |
| **ISO-8859-1** | Codificación que exige el SII. La firma se calcula sobre esos bytes; por eso la librería entrega `Buffer` y convertir el XML después invalida la firma. Un carácter fuera de ISO-8859-1 sale como `?` (texto) o `&#N;` (XML), como en el PHP. | `aIso88591()`, todo `core/` |

## Certificación y envío

| Término | Qué es aquí | Dónde |
|---|---|---|
| **Certificación** | Etapa de pruebas ante el SII: postular, descargar el set, enviarlo, pedir la revisión y declarar cumplimiento. Hosts: maullin, apicert, pangal, www4. | grupo `sii certificacion` |
| **Set de pruebas** | Casos (`CASO-N`) que el SII entrega en un `.txt` y que hay que emitir y enviar. Se referencian con `CodRef` `SET`. Cada descarga entrega un set nuevo. | `parsearSetPruebas`, `data/set_pruebas/` |
| **Semilla / token** | Canje de autenticación: se pide una semilla, se firma con el certificado y se recibe un token. Va en la cookie `TOKEN`. Se reutiliza hasta 3000 s. | `ClienteDtews`, `ClienteBoletaRest` |
| **DTEWS** | Servicios SOAP del SII: `CrSeed`, `GetTokenFromSeed` y `QueryEstUp`. La subida usa el CGI `DTEUpload`. | `ClienteDtews` |
| **API REST de boleta** | `boleta.electronica.semilla`, `.token`, `.envio` (subida y consulta). Host de autenticación (api / apicert) y de subida (rahue / pangal). | `ClienteBoletaRest` |
| **TrackID** | Número que entrega el SII al recibir un envío. Sirve para consultar el estado y para pedir la revisión del set. Cada canal solo conoce sus propios trackId. | `ClienteDtews`, `ClienteBoletaRest` |
| **Estados del envío** | `REC`, `SOK`, `CRT`, `FOK`, `PRD` = en proceso. `EPR` = envío procesado (después hay que mirar aceptados, rechazados y reparos). Cualquier otro estado es final. | `EstadoEnvio`, `EstadoEnvioRest` |
| **-11** | Estado sin glosa de `QueryEstUp` para un envío que no conoce: subido por REST, o recién subido por DTEUpload. | `sii certificacion estado-envio` |
| **RPR** | Envío aceptado **con reparos**. | `EstadoEnvio` |
| **RFR, RCH, RCT, RSC** | Envío rechazado (con distintas causas). | `EstadoEnvio` |
| **Reparo** | Observación del SII sobre un documento aceptado (p. ej. 260, 510, TED-1-646). Un envío "limpio" no tiene rechazos ni reparos. | `limpio()` |
| **STATUS de DTEUpload** | Código de la respuesta de la subida SOAP: 0 OK; 5 token inválido; 7 esquema inválido; 8 firma inválida; etc. | `ClienteDtews.enviarDte` |
| **`TokenStore`** | Caché de tokens con clave canal + ambiente + empresa + huella del certificado. En memoria (`TokenStoreMemoria`) o en archivo (`TokenStoreArchivo`, `SII_CACHE_TOKENS`). | `comun/token-store.ts` |

## Folios y sesión

| Término | Qué es aquí | Dónde |
|---|---|---|
| **AUT2000** | Login del SII con certificado de cliente TLS (TLS mutuo, `herculesr.sii.cl/cgi_AUT2000/…`). Deja cookies de sesión. Lo comparten folios, postulación y declaración. | `SolicitudFolios.autenticar`, `PostulacionSii.autenticar` |
| **Cookies AUT2000** | `TOKEN`, `NETSCAPE_LIVEWIRE.*`, `RUT_NS`, `DV_NS`, etc. Valen como una sesión iniciada a nombre del titular del certificado: si se guardan, hay que cifrarlas. `SesionSii` no las muestra al inspeccionarla. | `SesionSii` |
| **Re-login frenado** | El SII bloquea logins seguidos (unos 5 ciclos). Por eso conviene reutilizar la sesión. | `SesionSii.aArreglo()` / `desdeArreglo()` |
| **Asistente `of_*`** | Formularios web `cvc_cgi/dte/of_*` para pedir folios. La librería los recorre paso a paso con un parser HTML que reproduce a libxml. | `SolicitudFolios` |
| **Timbrar folios** | Paso del asistente (`of_genera_folio`) en que el SII asigna el rango. Es irreversible: después de esto no se reintenta a ciegas. | `FoliosSinCafError`, `solicitar-folios --confirmar` |
| **Folios ya autorizados** | Opción del portal del SII para volver a descargar un CAF que ya se timbró. | `FoliosSinCafError` |
| **Ambiente** | `'certificacion'` (maullin, IDK 100) o `'produccion'` (palena, IDK 300). Obligatorio en cada cliente; no hay valor por defecto en la librería. | `Ambiente`, `datosAmbiente()` |
| **`<meta charset>`** | Las páginas de los asistentes declaran `charset=iso-8859-1`; con eso los valores con tildes se reenvían doblemente codificados (defecto del PHP, replicado por paridad). Por eso los datos de los asistentes van sin tildes. | `comun/html.ts`, `sii certificacion postular` |

## Postulación y declaración

| Término | Qué es aquí | Dónde |
|---|---|---|
| **Postulación** | Alta de la empresa en certificación de boleta electrónica (asistente `cvc_cgi/dte/pe_*` en maullin). Se puede repetir. | `PostulacionSii`, `sii certificacion postular` |
| **Facturador gratuito** | Sistema de facturación gratuito del SII. Al postular, el SII puede avisar que la empresa deja de usarlo. | `ResultadoPostulacion.avisos` |
| **Revisión del set** | Solicitud (`ingresarTrackId`) para que el SII revise el envío del set de pruebas. El resultado llega por correo. | `DeclaracionBoletas.solicitarRevisionSet`, `sii certificacion solicitar-revision` |
| **Declaración de cumplimiento** | Último paso: la empresa declara que cumple y queda **autorizada en producción** (`autorizarEmpresaBolProd`). | `DeclaracionBoletas.declarar`, `sii certificacion declarar` |
| **P90 / P91** | Estados de la certificación. `P90` = set aprobado, falta declarar cumplimiento. `P91` = declaración efectuada (autorizada). | `EstadoDeclaracion`, `sii certificacion estado-declaracion` |
| **BVE** | Código de sistema de boleta electrónica en las llamadas del portal. | `DeclaracionBoletas` |
| **Proveedor de software** | Quien desarrolla o vende el software de emisión (puede ser la propia empresa). Su RUT, nombre y correo van en la declaración. | `DatosDeclaracion` |
| **GWT-RPC** | Protocolo de Google Web Toolkit que usa el portal `www4.sii.cl/certBolElectDteInternet/`. Se implementa lo mínimo; los `long` se manejan con `BigInt`. | `postulacion/gwt-rpc.ts` (interno) |
| **POLICY / PERMUTACION** | Hashes de la versión compilada del portal GWT. Si el SII publica otra versión, hay que actualizarlos. | `POLICY_DECLARACION`, `sii certificacion verificar-portal` |

## CLI

| Término | Qué es aquí |
|---|---|
| **`--confirmar`** | Opción que exigen los comandos que graban algo en el SII o emiten en producción. Sin ella, el comando valida todo, muestra lo que haría y termina con 0 sin enviar nada. |
| **Ensayo** | Ejecución sin `--confirmar` (o con `--solo-armar` en `enviar-set` / `enviar-rcof`): no sale nada que grabe en el SII. |
| **Código de salida 6 (incierto)** | La operación salió y no se sabe si quedó hecha. No se repite sin revisar el SII. |
| **Registro de envío** | `boleta-<ambiente>-<folio>.envio.json`, que deja `produccion emitir`. Mientras exista, ese folio no se vuelve a emitir. Lo lee `produccion seguimiento`. |

## Hosts del SII

| Host | Uso |
|---|---|
| `maullin.sii.cl` | Certificación: DTEWS (SOAP, DTEUpload), asistentes `of_*` y `pe_*`. |
| `palena.sii.cl` | Producción: DTEWS y asistente de folios. |
| `herculesr.sii.cl`, `zeusr.sii.cl` | Login AUT2000 por certificado (igual en ambos ambientes). |
| `www4.sii.cl` | Portal GWT de descarga del set, revisión y declaración de cumplimiento. |
| `apicert.sii.cl` / `pangal.sii.cl` | API REST de boleta, certificación: autenticación y consulta / subida. |
| `api.sii.cl` / `rahue.sii.cl` | API REST de boleta, producción: autenticación y consulta / subida. |

## Criptografía y entorno

| Término | Qué es aquí |
|---|---|
| **.pfx / PKCS#12** | Archivo del certificado digital con la llave privada, protegido con clave. Node lo lee con `node-forge`, incluidos los cifrados legacy de los .pfx del SII (RC2-40, 3DES), sin el binario `openssl`. No lee RC2-128, RC4 ni 3DES de 2 llaves. |
| **PEM** | Formato de texto del certificado y la llave. `Certificado` también los carga; `SII_CERT_PATH` puede apuntar a un `.pem`. |
| **SHA1** | Algoritmo que exige el SII en firmas y digests. Algunas builds de Node con el OpenSSL del sistema lo bloquean: usar el binario oficial. |
| **TLS mutuo** | Conexión en que el cliente presenta su certificado (login AUT2000). Node envía la hoja y los intermedios del .pfx. |
| **Paridad** | Garantía de que Node produce los mismos bytes que el PHP v1.9.1 en todo lo que se firma o se envía al SII. Se comprueba con golden tests ([tests.md](tests.md)). |
