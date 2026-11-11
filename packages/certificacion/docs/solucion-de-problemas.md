# Solución de problemas

Errores frecuentes, su causa y qué hacer. Los mensajes entre comillas son los que muestra
el código; en la CLI salen como `[ERROR] <Clase>: <mensaje>` en la salida de errores. Para
los términos, ver el [glosario](glosario.md). Los resultados reales contra el SII están en
[validaciones.md](validaciones.md).

> **Regla general:** ante cualquier duda sobre si algo **ya llegó al SII** (folios
> timbrados, boleta enviada, declaración), consulta el estado antes de reintentar. Repetir a
> ciegas puede timbrar otro rango de folios, emitir dos veces o declarar dos veces. La CLI
> marca estos casos con el **código de salida 6**.

## Cómo leer un error

**Códigos de salida de la CLI** (detalle en [cli.md](cli.md#códigos-de-salida)):

| Código | Qué pasó | ¿Salió algo al SII? |
|---|---|---|
| 1 | Error no clasificado (datos que no cumplen las reglas, firma, timbre) | Normalmente no |
| 2 | Uso incorrecto de la CLI | No |
| 3 | Configuración o datos de entrada inválidos, certificado ilegible | No |
| 4 | Red o HTTP inesperado | Depende: en consultas, reintenta; en subidas, lee el aviso |
| 5 | El SII rechazó la operación o respondió algo que no se entiende | Sí, y la rechazó |
| 6 | Incierto | Sí, y no se sabe el resultado: **revisar antes de repetir** |
| 7 | Verificación local fallida (`verificar-ted`) | No |

**Jerarquía de errores de la librería** (todos heredan de `SiiError`):

```
SiiError
├── ErrorValidacion          dato de entrada inválido; no salió nada
├── ErrorCertificado         .pfx / PEM ilegible o clave incorrecta
├── ErrorFirma               falla al firmar (p. ej. SHA1 bloqueado)
├── ErrorTimbre              falla al timbrar con el CAF
├── ErrorTransporte          red, timeout o HTTP ≠ 200 (campo status)
├── ErrorRespuestaSii        el SII respondió con error (campos estado, glosa)
├── ErrorSolicitudFolios
│   ├── SesionCaducaError    la sesión AUT2000 venció
│   ├── FolioInicialRequeridoError  primer timbraje: falta --folio-inicial
│   └── FoliosSinCafError    se timbró y no se obtuvo el CAF
└── ErrorPostulacion
    ├── DeclaracionInciertaError
    └── SetSinDescargarError
```

Los mensajes nunca incluyen PEM, claves, tokens ni cookies. La CLI tampoco muestra la causa
interna (`cause`), porque puede nombrar rutas con datos sensibles.

## Instalación y entorno

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `pnpm` no responde o falla en Git Bash | En este entorno Windows, pnpm solo funciona desde PowerShell | Usa PowerShell para `pnpm install`, `pnpm sii`, `pnpm test`... |
| Error de versión o de sintaxis al ejecutar `pnpm sii` | Node anterior a 22.19 | Instala Node ≥ 22.19 (se desarrolla con 24 LTS) |
| `pnpm sii --help` termina con código 2 y "Unknown option '--help'" | La ayuda es `--ayuda` o `-h` | `pnpm sii <grupo> <comando> --ayuda` |
| `Cannot find module .../dist/main.js` | La CLI no está compilada | `pnpm build`, o usa `pnpm sii ...` (corre el código fuente) |

## Configuración (`.env`)

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `Configuración inválida en ...: - SII_FCH_RESOL: falta` (y otras) | Faltan variables o están vacías. El mensaje las nombra todas, sin valores | Completa las que nombra. Qué usa cada comando: [configuracion.md](configuracion.md#qué-variables-usa-cada-comando) |
| `Configuración inválida en el entorno (no se encontró un .env)` | No hay `.env` en la carpeta actual | Crea el `.env` o usa `--env <ruta>`. Con `pnpm sii`, el `.env` por defecto es el de la raíz del repo |
| `No existe el archivo de configuración ...` (código 3) | `--env` apunta a un archivo que no existe | Revisa la ruta (relativa a la carpeta actual) |
| `No existe el archivo indicado en SII_CAF_39: ...` | La ruta del `.env` se resuelve contra la **carpeta del `.env`**, no contra la carpeta actual | Corrige la ruta o usa una absoluta |
| `... no es un RUT válido` | DV incorrecto | Revisa el RUT. Se aceptan puntos y `k` minúscula |
| Una variable del `.env` "no hace caso" | El entorno del proceso gana sobre el `.env` (incluso una variable vacía) | Revisa las variables de entorno de la sesión |
| `No existe la carpeta de SII_CACHE_TOKENS: ...` | La carpeta del caché de tokens no existe | Créala, o deja `SII_CACHE_TOKENS` vacía |
| `El folio N ya se envió al SII según ...envio.json` | `produccion emitir` encontró el registro de un envío anterior de ese folio | Usa otro folio. Borra el registro solo si confirmas en el SII que la boleta no quedó emitida |

## Certificado

| Síntoma | Causa | Qué hacer |
|---|---|---|
| "No se pudo abrir el .pfx: la contraseña es incorrecta." (código 3) | `SII_CERT_PASS` no corresponde | Revisa la clave. Si tiene `#`, espacios o comillas, ponla entre comillas en el `.env` |
| "No se pudo leer el .pfx: el archivo está dañado o usa un cifrado no soportado." | El .pfx usa un cifrado que node-forge no lee (RC2-128, RC4 o 3DES de 2 llaves; raros). Los .pfx del SII (RC2-40, 3DES) sí se leen | Reexpórtalo con `openssl` a un .pfx moderno (AES), o conviértelo a PEM con la llave y apunta `SII_CERT_PATH` al `.pem` |
| "No se pudo leer el archivo del certificado: no existe o no es accesible." | Ruta mal escrita. El mensaje no muestra la ruta (suele llevar el RUT del titular) | Revisa `SII_CERT_PATH` (relativa a la carpeta del `.env`) |
| "El PEM no tiene una llave privada legible (¿falta la passphrase o es incorrecta?)." | PEM con llave cifrada y clave incorrecta o vacía | Pon la passphrase en `SII_CERT_PASS` |
| "El .pfx no trae la llave privada." / "...el certificado del titular." | El archivo no es el certificado completo | Exporta de nuevo el certificado **con** la llave privada |
| "No se pudo firmar con RSA-SHA1. Si el OpenSSL del sistema bloquea SHA1, use el binario oficial de Node." | Node de una distro con OpenSSL del sistema que bloquea SHA1 (p. ej. RHEL 9). El SII exige SHA1 | Usa el binario oficial de Node o la imagen Docker oficial |

Node **no usa el binario `openssl`**: `SII_OPENSSL_PATH` y `OPENSSL_MODULES_PATH` del PHP no
existen aquí.

## TLS y red

| Síntoma | Causa | Qué hacer |
|---|---|---|
| "No se pudo conectar con `<host>`: se agotó el tiempo de conexión (10 s)." | Pasó con apicert y maullin en el primer intento del día; el reintento funcionó | Reintenta. En una subida, revisa antes si llegó |
| "`<host>` no respondió dentro de 45 s." | El SII tardó más que el tope de respuesta | Igual que arriba |
| "No se pudo verificar el certificado TLS de `<host>`; se cortó la conexión por seguridad." | Faltan CA raíz, o un proxy corporativo inspecciona TLS | Agrega la CA con `NODE_EXTRA_CA_CERTS`. La verificación no se puede apagar: `NODE_TLS_REJECT_UNAUTHORIZED=0` no tiene efecto |
| "`<host>` rechazó la conexión TLS. Revisa que el certificado digital esté vigente y que se envíe su cadena completa." | En el login AUT2000 (TLS mutuo), el SII no aceptó el certificado de cliente | Revisa la vigencia y que el .pfx traiga los intermedios |
| HTTP 503 de maullin en `estado-envio` | Maullin saturado o en mantención | Vuelve a consultar más tarde |
| `[ATENCIÓN] La subida falló después de enviarse: el SII pudo haberla recibido.` | Corte de red durante una subida por DTEUpload o REST | **No repitas el envío** sin revisar: consulta los envíos de la empresa o el estado de los folios |

## Token y envío

| Síntoma | Causa | Qué hacer |
|---|---|---|
| `STATUS 5` en DTEUpload (no está autenticado) | Token inválido o vencido | La CLI lo borra del caché; vuelve a ejecutar. Con la librería, `olvidarToken(rut)` y pedir otro |
| `STATUS 1` / `6` en DTEUpload | El titular no puede enviar por la empresa, o la empresa no está autorizada | Revisa los permisos del titular en el SII |
| `STATUS 7` / `8` en DTEUpload | Esquema inválido o firma del documento inválida | No conviertas el XML después de armarlo. Valida contra los XSD de `data/schemas/` |
| `ESTADO -11` sin glosa (SOAP, `QueryEstUp`) | Dos casos: el envío se subió por **REST** (QueryEstUp no lo conoce), o se subió por DTEUpload hace muy poco | Si fue por REST, consúltalo por REST (`--canal rest` o `produccion consultar`). Si no, vuelve a consultar en unos minutos |
| "No existe recurso" por REST | El trackId es de un envío por **DTEUpload**: la API REST solo conoce los envíos REST | Consúltalo por SOAP (`estado-envio --canal soap`) |
| Estados `REC`, `SOK`, `CRT`, `FOK`, `PRD` | El SII todavía valida | Vuelve a consultar en unos minutos |
| `RPR` (aceptado con reparos) | El SII aceptó con observaciones | El detalle llega por correo y al portal; `QueryEstUp` no lo trae |
| RCOF por REST: HTTP 404 en `boleta.electronica.consumo` | Pangal no expone ese recurso. **El SII eliminó el RCOF desde el 2022-08-01** | No lo envíes en el flujo normal. Para un período hasta julio de 2022, `sii certificacion enviar-rcof` (DTEUpload) |
| `enviar-rcof` se niega: "el SII eliminó el RCOF desde el 2022-08-01" (código 2) | El período del sobre es desde esa fecha | No hace falta enviarlo. Solo si de verdad lo necesitas: `--aunque-no-obligatorio` |
| `emitir` termina con 6 y deja el registro marcado como incierto | Corte de red o HTTP 5xx al enviar la boleta | Revisa en el SII si el folio quedó emitido. Si no llegó, borra el `.envio.json` y vuelve a emitir |

## Rechazos y reparos del SII

Estos rechazos ocurrieron con el PHP y el código actual los evita (Node produce los mismos
bytes):

| Código | Causa | Estado |
|---|---|---|
| Reparo **260** "Monto Total No Cuadra con Parciales" | El descuento global iba en `<DscRcgGlobal>` | Corregido: el descuento se reparte en las líneas afectas. Marca los exentos con `exento: true` |
| Reparo **510** "Firma Timbre Electrónico Incorrecta" | El `DD` se firmaba con espacios entre etiquetas | Corregido: `Timbre` aplana el `DD` antes de firmar |
| **RFR** con razón social con tilde | El TED se firmaba sobre bytes UTF-8 | Corregido: se firma en ISO-8859-1. **No conviertas el XML después de generarlo** |
| Reparo **TED-1-646** | La `FA` del CAF quedaba con la fecha de mañana (servidor en UTC de noche) | Corregido: la solicitud de folios envía `FECHA` en hora de Chile |
| Firma inválida con tildes o eñes | Se reconvirtió a ISO-8859-1 un XML que ya lo estaba (defecto de los scripts del PHP) | La librería entrega `Buffer` y la CLI los escribe tal cual |
| Set rechazado | Giro con abreviaciones o datos del emisor distintos a los del SII, o set de otra empresa | Usa el giro y la razón social exactos del SII y el set que te entregó a ti |

## Folios (CAF)

| Error / mensaje | Causa | Qué hacer |
|---|---|---|
| `SesionCaducaError` | La sesión AUT2000 venció **antes** de timbrar | Autentica de nuevo y reintenta: no se gastaron folios |
| El login falla después de varios intentos seguidos | El SII frena los logins repetidos (unos 5 ciclos) | Espera. Con la librería, reutiliza la sesión (`aArreglo()` / `desdeArreglo()`, guardada cifrada) |
| "El SII no aceptó el certificado..." / login rechazado | Certificado vencido o titular sin permisos sobre la empresa | Revisa la vigencia y que el titular sea representante electrónico |
| `FolioInicialRequeridoError` (código 3): "El SII pide el folio inicial" | Primer timbraje de ese tipo de documento en el ambiente: el SII intercala "Ingrese Folio Inicial". No se timbró nada | Repite con `--folio-inicial 1` (o el valor que sugiere el mensaje) |
| `FoliosSinCafError` (código 6) | La orden de timbrar salió y no se pudo bajar un CAF válido (incluye un CAF que no cuadra con lo pedido) | **No reintentes.** Descarga el CAF desde "Folios ya autorizados" en el portal del SII |
| `ErrorSolicitudFolios` con el mensaje del SII (código 5) | El asistente rechazó la solicitud (p. ej. folios pendientes de usar, empresa no autorizada) | Lee el mensaje del SII |
| Redirección fuera de `sii.cl` / demasiadas redirecciones | Los candados cortaron antes de seguir | Revisa a mano en el portal: puede ser un cambio del SII |
| El CAF no sirve en `enviar-set`: "es del tipo de documento N" o folios fuera de rango (código 3) | CAF de otro tipo, de otra empresa, o sin folios suficientes | Pide un CAF de tipo 39 con un folio por caso del set |

## Postulación y declaración

| Error / mensaje | Causa | Qué hacer |
|---|---|---|
| `postular`: "tiene caracteres fuera de ASCII imprimible" (código 3) | Tildes o `ñ` en los datos. El asistente declara `charset=iso-8859-1` en un `<meta>`: los valores con tildes vuelven doblemente codificados, la confirmación no calza y no se graba | Escribe sin tildes (`Senal`, no `Señal`). Decisión del 2026-11-07, PLAN §8. `declarar` sí admite tildes (va por GWT en UTF-8) |
| `ErrorValidacion` al crear `DatosPostulacion` | Un dato no cumple las reglas del formulario (RUT, largo, correo con `+` o de más de 50 caracteres) | Corrige el dato. Reglas en [postulacion.md](postulacion.md) |
| "Postulación detenida antes de grabar" | La confirmación del SII no repite los datos enviados | No se grabó nada. Revisa los datos (sin tildes) y vuelve a postular |
| `SetSinDescargarError` (código 5) | El SII exige descargar el set antes de pedir la revisión | `descargar-set --confirmar`, envía ese set y pide la revisión con el trackId nuevo. Nunca en P90 |
| `descargar-set` termina con 1 en P91 | La empresa ya está autorizada; no se sabe si un set nuevo la afecta | No lo descargues. Solo si de verdad hace falta: `--aunque-autorizada` |
| `descargar-set` termina con 5 en P90 | Un set nuevo reiniciaría la certificación | Corresponde declarar, no bajar otro set |
| `declarar` termina con 5: la empresa no está en P90 | La revisión aún no se aprueba, ya está autorizada, o el usuario no la representa | `sii certificacion estado-declaracion` |
| `DeclaracionInciertaError` (código 6) | La orden de declarar salió y no llegó la confirmación | Consulta `estado-declaracion`: P91 = ya quedó; P90 = se puede declarar de nuevo |
| `verificar-portal` termina con 5, o las llamadas al portal fallan con un tipo inesperado | El SII publicó otra versión del portal GWT | Hay que actualizar la POLICY y la permutación de la librería (ver [postulacion.md](postulacion.md)) |

Diagnóstico sin modificar nada en el SII:

```
pnpm sii certificacion verificar-portal
pnpm sii certificacion estado-declaracion
pnpm sii certificacion estado-envio <trackId>
```
