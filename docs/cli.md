# CLI `sii`

Línea de comandos del proyecto, con 15 comandos. Reemplaza los 7 scripts de `bin/` del PHP
y agrega los pasos que faltaban para hacer **toda la certificación de boleta electrónica
solo con la CLI** (postular, descargar el set, pedir folios, enviar, pedir la revisión,
declarar), más el seguimiento de las boletas emitidas en producción.

Código: `apps/cli/src/` (`cli.ts` despacha, `comandos/` tiene un archivo por comando).
Configuración: [configuracion.md](configuracion.md).

## Cómo se ejecuta

```
pnpm sii <grupo> <comando> [opciones]           # desde el código fuente (sin compilar)
node apps/cli/dist/main.js <grupo> <comando>    # compilada (pnpm build)
```

- `pnpm` solo funciona desde **PowerShell** en este entorno (no desde Git Bash).
- En este documento, `sii` es cualquiera de las dos formas.
- La ayuda es `--ayuda` o `-h` (no `--help`):

```
pnpm sii --ayuda                              # lista de grupos y comandos
pnpm sii certificacion enviar-set --ayuda     # ayuda completa de un comando
```

La ayuda de cada comando es la referencia exacta: sintaxis, opciones, variables del
`.env`, qué sale al SII y qué archivos escribe. Este documento la resume y agrega el
contexto.

**Opciones globales** (todos los comandos):

| Opción | Qué hace |
|---|---|
| `--env <ruta>` | Archivo de configuración (por defecto `./.env`) |
| `-h`, `--ayuda` | Muestra la ayuda del comando y termina con 0 |

Una opción desconocida, un argumento de más o de menos, o un comando que no existe
termina con código 2 y muestra el uso.

## Reglas comunes

- **Todo se valida antes de la primera petición:** opciones, variables del `.env`,
  archivos (CAF, set, JSON de datos) y el certificado. Un error ahí termina con código 2
  o 3 y **no sale nada al SII**.
- **`--confirmar`:** lo exigen los comandos que graban algo en el SII o emiten en
  producción: `postular`, `descargar-set`, `solicitar-folios`, `solicitar-revision`,
  `declarar`, `produccion emitir` y `enviar-rcof` en producción. Sin `--confirmar`, el
  comando valida todo, muestra lo que haría y termina con 0 **sin enviar nada**
  ("ensayo"). Para hacerlo de verdad, se repite el mismo comando con `--confirmar`.
- **Excepción:** `certificacion enviar-set` envía directo, como el script del PHP. Para
  ensayar está `--solo-armar` (arma y guarda el sobre, sin red).
- **Archivos:** cada comando escribe en `data/output/` junto al `.env`, o en `--salida <dir>`.
  Los bytes se guardan tal cual los entrega la librería (ISO-8859-1 en los XML): no se
  reconvierten.
- **Mensajes:** nunca muestran valores del `.env`, la clave, tokens, cookies ni material
  PEM. Solo nombres de variables y rutas.
- **Ambiente:** los comandos del grupo `certificacion` hablan con certificación (maullin /
  apicert / pangal / www4), salvo `solicitar-folios` y `enviar-rcof`, que aceptan
  `--ambiente produccion`. `produccion emitir` y `produccion consultar` van a
  **producción por defecto**; `--ambiente certificacion` sirve para probar en apicert /
  pangal.

## Códigos de salida

Son estables: un script que llama a la CLI puede decidir con ellos si reintentar.

| Código | Significado | Qué hacer | Errores que lo producen |
|---|---|---|---|
| 0 | OK. También un ensayo sin `--confirmar` | — | — |
| 1 | Error no clasificado: datos que no cumplen las reglas del SII, firma, timbre, un bug | Leer el mensaje | `ErrorValidacion`, `ErrorFirma`, `ErrorTimbre`, otros |
| 2 | Uso incorrecto: comando u opción desconocida, falta un argumento | Corregir la llamada. Nada salió al SII | `ErrorUso` |
| 3 | Configuración o datos de entrada inválidos: `.env`, certificado ilegible o clave incorrecta, archivo que no existe, JSON inválido | Corregir la configuración. Nada salió al SII | `ErrorConfig`, `ErrorCertificado` |
| 4 | Red o HTTP inesperado | Reintentar más tarde (salvo que el comando avise que la subida pudo llegar) | `ErrorTransporte` |
| 5 | El SII respondió, pero rechazó la operación o devolvió algo que no se entiende | Leer el mensaje del SII | `ErrorRespuestaSii`, `ErrorPostulacion`, `ErrorSolicitudFolios` (incluye `SesionCaducaError` y `SetSinDescargarError`) |
| 6 | **Incierto:** la operación salió y no se sabe si quedó hecha | **No repetir a ciegas.** Revisar el estado en el SII | `FoliosSinCafError`, `DeclaracionInciertaError`, envío de `emitir` sin respuesta |
| 7 | Una verificación local falló | Revisar el CAF o el sobre | `util verificar-ted` |

Algunos comandos usan los códigos con un sentido propio (por ejemplo, `estado-envio`
termina con 0 aunque el envío esté rechazado; `descargar-set` termina con 1 si la empresa
ya está autorizada). Se indica en cada comando.

## Resumen

| Comando | Para qué | Sale al SII | Escribe | `--confirmar` |
|---|---|---|---|---|
| `certificacion postular` | Postular la empresa a boleta electrónica | maullin (login + asistente) | — | Sí |
| `certificacion descargar-set` | Descargar un set de pruebas **nuevo** | www4 (login + GWT + descarga) | `set-pruebas-AAAA-MM-DD.txt` | Sí |
| `certificacion solicitar-folios` | Pedir un CAF | maullin o palena (login + asistente) | `caf-...xml` | Sí |
| `certificacion enviar-set` | Armar y enviar el set de pruebas | maullin (DTEUpload) o pangal (REST) | `envio-set-boletas.xml` | No (`--solo-armar` para ensayar) |
| `certificacion estado-envio` | Estado de envíos por trackId | maullin y/o apicert | — | No (solo lectura) |
| `certificacion solicitar-revision` | Pedir la revisión del set | www4 (login + GWT) | — | Sí |
| `certificacion verificar-portal` | Ver si el portal de la declaración cambió | www4 (GET público) | — | No (solo lectura) |
| `certificacion estado-declaracion` | Estado de la certificación (P90 / P91) | www4 (login + GWT) | — | No (solo lectura) |
| `certificacion declarar` | Declarar cumplimiento (autoriza producción) | www4 (login + GWT) | — | Sí |
| `certificacion enviar-rcof` | RCOF de un período hasta julio de 2022 | maullin o palena (DTEUpload) | `rcof.xml` | Solo en producción |
| `produccion emitir` | Emitir una boleta por la API REST | api + rahue (o apicert + pangal) | `boleta-<amb>-<folio>.xml`, `.envio.json` | Sí |
| `produccion consultar` | Estado de un envío REST | api (o apicert) | — | No (solo lectura) |
| `produccion seguimiento` | Estado de todas las boletas emitidas (piloto) | api (o apicert) | solo con `--bitacora` | No (solo lectura) |
| `util firmar-semilla` | Firmar una semilla REST obtenida a mano | nada | — | No |
| `util verificar-ted` | Verificar los TED de un sobre contra el CAF | nada | — | No |

---

## Grupo `certificacion`

### `postular`

```
sii certificacion postular --datos <archivo.json> [--confirmar]
```

Postula la empresa a boleta electrónica en certificación (asistente de maullin). El usuario
del certificado tiene que ser representante legal. Se puede repetir: vuelve a dejar la
empresa en certificación con los datos nuevos. Factura no se postula desde aquí.

| Opción | Qué hace |
|---|---|
| `--datos <archivo>` | JSON con los datos de la postulación (obligatorio) |
| `--confirmar` | Postula de verdad. Sin ella solo valida y muestra el resumen |

Formato de `--datos`:

```json
{
  "rutEmpresa": "76123456-0",
  "rutAdministrador": "12345678-5",
  "correoAdministrador": "admin@empresa.cl",
  "correoContactoSii": "contacto@empresa.cl",
  "correoIntercambio": "dte@empresa.cl",
  "nombreSoftware": "Software Propio",
  "boletaExenta": true,
  "url": "www.empresa.cl"
}
```

- `rutEmpresa` y `rutAdministrador` son opcionales: por defecto `SII_RUT_EMPRESA` y
  `SII_RUT_FIRMA`. El administrador debe ser quien después se autentica para ver el avance
  y declarar (normalmente el titular del certificado).
- `nombreSoftware`: hasta 30 caracteres. `boletaExenta`: por defecto `true`. `url`:
  opcional, empieza con `www.`.
- Correos: sin `+` ni símbolos, un solo `@`, hasta 50 caracteres (regla del SII).
- **Solo ASCII imprimible:** sin tildes ni `ñ`. Se rechaza con código 3 antes de
  cualquier petición. El asistente declara `charset=iso-8859-1` y, con tildes, la
  confirmación del SII no calza y la postulación no se graba (decisión del 2026-11-07,
  PLAN §8). Escribe `Senal` en vez de `Señal`.

**Sale al SII** (solo con `--confirmar`): login AUT2000; `pe_ingrut`, `pe_datos_empresa`
(y las páginas de aviso) y `pe_confirma`; antes de grabar se revisa que la confirmación
traiga exactamente los datos enviados; `pe_graba_postulacion` **graba**.
**Escribe:** nada.

### `descargar-set`

```
sii certificacion descargar-set [--correo <correo>] [--rut <rut>] [--salida <dir>]
                                [--aunque-autorizada] [--confirmar]
```

Descarga el set de pruebas en el portal de la declaración ("Generación de nuevo set de
pruebas"). **El SII registra la descarga y entrega un set nuevo:** los envíos hechos con un
set anterior dejan de servir para la revisión.

| Opción | Qué hace |
|---|---|
| `--correo <correo>` | Correo del proveedor de software (en vez de `SII_CORREO_PROVEEDOR`) |
| `--rut <rut>` | RUT de la empresa (en vez de `SII_RUT_EMPRESA`) |
| `--salida <dir>` | Carpeta de destino (por defecto `data/set_pruebas` junto al `.env`) |
| `--aunque-autorizada` | Descarga aunque la empresa ya esté autorizada (P91) |
| `--confirmar` | Descarga de verdad |

Candados:
- En **P90** (lista para declarar) la librería no descarga: un set nuevo reiniciaría la
  certificación. Código 5.
- En **P91** (ya autorizada) el comando se detiene con código 1: no se sabe si un set nuevo
  la afecta. Para hacerlo igual, `--aunque-autorizada`.

**Sale al SII** (solo con `--confirmar`): login AUT2000; `obtenerEstadoAutorizaEmp` y
`obtenerPostulacionSeg` (GWT-RPC, www4); `GET DownloadFileServlet` con el RUT de la
empresa, el del usuario y el correo: aquí el SII registra la descarga.
**Escribe:** `<salida>/set-pruebas-AAAA-MM-DD.txt` (UTF-8, fecha de Chile). Nunca reemplaza
un archivo: agrega `-2`, `-3`... Al final sugiere la línea `SII_SET_PRUEBAS=...` (no edita
el `.env`).

### `solicitar-folios`

```
sii certificacion solicitar-folios [--ambiente certificacion|produccion] [--tipo <n>]
                                   [--cantidad <n>] [--folio-inicial <n>] [--salida <dir>]
                                   [--confirmar]
```

Pide un CAF: login con el certificado y recorrido del asistente de folios del SII.

| Opción | Qué hace |
|---|---|
| `--ambiente <amb>` | `certificacion` (por defecto, maullin) o `produccion` (palena, **folios reales**) |
| `--tipo <n>` | Tipo de documento. Por defecto 39 (boleta afecta) |
| `--cantidad <n>` | Cantidad de folios. En certificación, por defecto 5 (uno por caso del set); en producción es obligatoria |
| `--folio-inicial <n>` | Solo si el SII lo pide: primer timbraje de ese tipo de documento en el ambiente (página "Ingrese Folio Inicial"; normalmente 1). Se envía únicamente en esa página, también en la revisión. Si el SII lo pide y falta, termina con 3 sin timbrar y muestra el comando a repetir |
| `--salida <dir>` | Carpeta del CAF (por defecto `data/caf` junto al `.env`) |
| `--confirmar` | Timbra los folios y guarda el CAF |

- **Sin `--confirmar`:** recorre el asistente hasta la confirmación y se detiene **antes**
  de la orden de timbrar (esa petición no sale). Informa el rango que el SII asignaría. No
  gasta folios ni escribe archivos.
- **Con `--confirmar`:** timbra (irreversible), descarga el CAF y lo revisa (IDK del
  ambiente, RUT de la empresa y tipo pedido). Al final sugiere las líneas del `.env`.
- El titular del certificado tiene que ser representante electrónico de la empresa.
- El SII frena los inicios de sesión seguidos (unos 5 ciclos): no lo corras en bucle.

**Sale al SII:** login AUT2000 (herculesr) y los pasos del asistente en maullin (o palena);
con `--confirmar`, además la orden de timbrar y la descarga del CAF.
**Escribe** (solo con `--confirmar`): `<salida>/caf-<tipo>-<desde>-<hasta>.xml` en
certificación y `<salida>/caf-produccion-<tipo>-<desde>-<hasta>.xml` en producción. El CAF
trae la llave para timbrar: no lo versiones.

**Código 6:** la orden de timbrar salió y no se obtuvo el CAF. **No repitas la solicitud:**
baja el CAF desde "Folios ya autorizados" en el portal del SII.

### `enviar-set`

```
sii certificacion enviar-set [--canal soap|rest] [--caf <ruta>] [--folio-inicial <n>]
                             [--set <ruta>] [--fch-resol <fecha>] [--nro-resol <n>]
                             [--salida <dir>] [--solo-armar]
```

Arma el set de pruebas (boletas tipo 39), un folio por caso, consecutivos desde el folio
inicial; lo firma y lo envía a certificación. No arma RCOF.

| Opción | Qué hace |
|---|---|
| `--canal soap\|rest` | `soap` (por defecto): DTEUpload en maullin, como el PHP. `rest`: API REST (apicert / pangal) |
| `--caf <ruta>` | CAF de boletas (en vez de `SII_CAF_39`) |
| `--folio-inicial <n>` | Primer folio (en vez de `SII_FOLIO_INICIAL`) |
| `--set <ruta>` | Set de pruebas `.txt` (en vez de `SII_SET_PRUEBAS`) |
| `--fch-resol <fecha>` | Fecha de resolución `AAAA-MM-DD` (en vez de `SII_FCH_RESOL`) |
| `--nro-resol <n>` | Número de resolución (en vez de `SII_NRO_RESOL`; por defecto 0) |
| `--salida <dir>` | Carpeta del sobre (por defecto `data/output` junto al `.env`) |
| `--solo-armar` | Arma y guarda el sobre sin enviarlo: sin red, sin token, los folios siguen libres |

- Imprime los casos leídos del set: revisa que coincidan con tu set del portal.
- Antes de enviar comprueba que el CAF es de tipo 39, de la empresa, y que todos los
  folios caben en su rango (si no, código 3).
- **Consume los folios:** al terminar sugiere el `SII_FOLIO_INICIAL` siguiente.
- Si la subida falla después de salir (corte de red), avisa que el SII pudo haberla
  recibido: revisa los envíos antes de repetir.

**Sale al SII** (salvo `--solo-armar`): el pedido de token y el sobre `EnvioBOLETA` firmado.
**Escribe:** `<salida>/envio-set-boletas.xml` (trae RUT y razón social: no lo versiones).
**Después:** `sii certificacion estado-envio <trackId>`, en unos minutos.

### `estado-envio`

```
sii certificacion estado-envio <trackId> [<trackId> ...] [--canal soap|rest|ambos] [--json]
```

Consulta el estado de 1 a 20 envíos (trackId, solo dígitos) en certificación. Solo
lectura: se puede repetir.

| Opción | Qué hace |
|---|---|
| `--canal soap\|rest\|ambos` | `soap`: QueryEstUp (maullin), para lo subido por DTEUpload. `rest`: API REST (apicert), para lo subido por REST. `ambos` (por defecto) |
| `--json` | Un objeto JSON en la salida estándar en vez de texto (formato en `--ayuda`) |

- **Cada canal solo conoce sus envíos:** un trackId de DTEUpload responde "No existe
  recurso" por REST, y uno de REST responde `-11` por SOAP. Con `ambos`, si un canal falla
  se informa y se sigue con el otro.
- El texto explica el `-11` (envío REST, o recién subido por DTEUpload: vuelve a consultar)
  y los estados en proceso (`REC`, `SOK`, `CRT`, `FOK`, `PRD`).
- **Código de salida:** 0 si por cada trackId respondió al menos un canal, **aunque el
  envío esté rechazado** (mira el estado). Si no, el del primer error de ese trackId (4
  red, 5 error del SII...).

**Sale al SII:** un pedido de token por canal y una consulta por trackId y canal.
**Escribe:** nada.

Cómo leer el estado: [certificacion.md](certificacion.md#cómo-leer-el-estado).

### `solicitar-revision`

```
sii certificacion solicitar-revision <trackId> [--rut <rut>] [--confirmar]
```

Pide al SII que revise el set enviado con ese trackId ("Solicitar validación" en el portal
de la declaración). El resultado **no es inmediato**: llega por correo y, si aprueba,
`estado-declaracion` muestra P90.

| Opción | Qué hace |
|---|---|
| `<trackId>` | Envío de las boletas (solo dígitos, hasta 15) |
| `--rut <rut>` | RUT de la empresa (en vez de `SII_RUT_EMPRESA`) |
| `--confirmar` | Envía la solicitud |

- Antes, revisa con `estado-envio` que el envío no tenga rechazos ni reparos.
- Si el SII responde que falta descargar el set (`SetSinDescargarError`, código 5): usa
  `descargar-set`, envía las boletas de ese set nuevo y pide la revisión con el trackId
  nuevo.

**Sale al SII** (solo con `--confirmar`): login AUT2000; `recuperarNroActividadesVigAfecIva`
e `ingresarTrackId` (GWT-RPC, www4): aquí el SII registra la solicitud.
**Escribe:** nada.

### `verificar-portal`

```
sii certificacion verificar-portal
```

Revisa que el portal de la declaración (www4, app GWT `certBolElectDteInternet`) siga en la
versión que conoce la librería: el archivo público de la app tiene que existir y traer la
POLICY, el servicio, los métodos y las firmas de tipo que se usan. Si el SII publicó otra
versión, fallarían `estado-declaracion`, `descargar-set`, `solicitar-revision` y `declarar`.

Sin opciones propias. **No lee el `.env` ni el certificado.**

**Sale al SII:** un GET público, sin cookies ni login, a
`https://www4.sii.cl/certBolElectDteInternet/0FC3D987613537E6E13E9BB93A406F13.cache.html`.
**Escribe:** nada.
**Códigos:** 0 portal vigente · 5 el portal cambió (muestra lo que falta; hay que
actualizar la librería) · 4 no se pudo consultar.

### `estado-declaracion`

```
sii certificacion estado-declaracion [rut]
```

Estado de la certificación de boletas de la empresa en el portal de la declaración. Solo
lectura.

| Estado | Significado |
|---|---|
| `P90` | Set aprobado: falta declarar cumplimiento (`sii certificacion declarar`) |
| `P91` | Declaración efectuada: autorizada en producción |
| Sin código | Sin trámite pendiente: ya autorizada, sin postular, o el usuario del certificado no la representa |

`rut`: por defecto `SII_RUT_EMPRESA`.

**Sale al SII:** login AUT2000; `obtenerEstadoAutorizaEmp` (GWT-RPC, www4).
**Escribe:** nada.

### `declarar`

```
sii certificacion declarar --datos <archivo.json> [--confirmar]
```

Declara el cumplimiento de requisitos de boleta electrónica. **Deja a la empresa
AUTORIZADA EN PRODUCCIÓN.** El usuario del certificado firma como representante legal.

Solo se declara en **P90**: la librería consulta el estado antes y se detiene sin grabar si
no lo está (código 5).

| Opción | Qué hace |
|---|---|
| `--datos <archivo>` | JSON con los datos de la declaración (obligatorio) |
| `--confirmar` | Declara de verdad |

Formato de `--datos` (el proveedor de software es quien desarrolla o vende el sistema; si es
la propia empresa, ella misma):

```json
{
  "rutEmpresa": "76123456-0",
  "linkConsulta": "https://www.empresa.cl/boletas",
  "rutProveedor": "76543210-3",
  "nombreProveedor": "Proveedor SpA",
  "correoProveedor": "sw@proveedor.cl"
}
```

`rutEmpresa` y `correoProveedor` son opcionales (por defecto `SII_RUT_EMPRESA` y
`SII_CORREO_PROVEEDOR`). `linkConsulta`: hasta 100 caracteres. `nombreProveedor`: hasta 30.
Estos datos van por GWT-RPC (UTF-8): **admiten tildes**, a diferencia de `postular`.

**Sale al SII** (solo con `--confirmar`): login AUT2000; `obtenerEstadoAutorizaEmp`,
`recuperarNombreContribuyente` y `listarDocAutorizados` (solo lectura);
`autorizarEmpresaBolProd` **graba** la declaración (P91).
**Escribe:** nada.
**Código 6:** la orden salió y no se pudo confirmar. **No repitas a ciegas:** consulta
`estado-declaracion` (P91 = quedó autorizada; P90 = se puede volver a declarar).

### `enviar-rcof`

```
sii certificacion enviar-rcof --sobre <ruta> [--sec-envio <n>] [--fch-resol <fecha>]
                              [--nro-resol <n>] [--ambiente certificacion|produccion]
                              [--confirmar] [--aunque-no-obligatorio] [--salida <dir>]
                              [--solo-armar]
```

Arma el RCOF con los DTE de un sobre `EnvioBOLETA` ya armado (p. ej. el que deja
`enviar-set`): montos, folios y fechas salen de las boletas del sobre. Lo firma y lo envía
por DTEUpload.

> **El SII eliminó el RCOF desde el 2022-08-01.** Solo se usa para períodos hasta julio de
> 2022. Si el período del sobre termina el 2022-08-01 o después, el comando se niega
> (código 2) salvo con `--aunque-no-obligatorio`. Solo va por DTEUpload: por REST el SII
> responde 404. Ningún otro comando lo llama.

| Opción | Qué hace |
|---|---|
| `--sobre <ruta>` | Sobre `EnvioBOLETA` del que salen los DTE (obligatorio) |
| `--sec-envio <n>` | Secuencia del RCOF del período (en vez de `SII_RCOF_SEC_ENVIO`; por defecto 1). Súbela si ya enviaste uno ese día |
| `--fch-resol <fecha>` | En vez de `SII_FCH_RESOL` o `SII_PRODUCCION_FCH_RESOL` |
| `--nro-resol <n>` | En vez de `SII_NRO_RESOL` o `SII_PRODUCCION_NRO_RESOL` |
| `--ambiente <a>` | `certificacion` (por defecto, maullin) o `produccion` (palena) |
| `--confirmar` | Obligatorio para enviar en producción. Sin él, en producción arma y guarda el RCOF y se detiene antes de pedir token |
| `--aunque-no-obligatorio` | Arma y envía aunque el período sea desde el 2022-08-01 |
| `--salida <dir>` | Carpeta del RCOF (por defecto `data/output` junto al `.env`) |
| `--solo-armar` | Arma y guarda sin enviar (sin red) |

En certificación envía sin `--confirmar` (como el script del PHP).

**Sale al SII** (salvo `--solo-armar`): el pedido de token DTEWS y el RCOF firmado por
DTEUpload.
**Escribe:** `<salida>/rcof.xml`.

---

## Grupo `produccion`

### `emitir`

```
sii produccion emitir --boleta <archivo.json> --folio <N> [--ambiente produccion|certificacion]
                      [--caf <ruta>] [--nro-resol <N>] [--fch-resol <AAAA-MM-DD>]
                      [--salida <dir>] [--confirmar]
```

Arma una boleta (DTE 39 o 41), la timbra con el CAF, la firma, la empaqueta en un
`EnvioBOLETA` y, solo con `--confirmar`, la envía por la API REST.

> **En producción (el ambiente por defecto) la boleta es un documento tributario real y
> consume el folio.** Prueba primero sin `--confirmar` y revisa el resumen.

| Opción | Qué hace |
|---|---|
| `--boleta <archivo.json>` | Obligatorio. Ítems, receptor y descuento |
| `--folio <N>` | Obligatorio. Debe estar en el rango del CAF |
| `--ambiente <amb>` | `produccion` (por defecto: api.sii.cl / rahue.sii.cl) o `certificacion` (apicert.sii.cl / pangal.sii.cl) |
| `--caf <ruta>` | CAF del tipo de documento (en vez de la variable del `.env`) |
| `--nro-resol <N>` | Número de resolución de la carátula |
| `--fch-resol <AAAA-MM-DD>` | Fecha de resolución de la carátula |
| `--salida <dir>` | Carpeta de salida (por defecto `data/output` junto al `.env`) |
| `--confirmar` | Envía la boleta. Sin ella no hay ninguna petición de red |

Formato de `--boleta` (JSON estricto: un campo desconocido es error):

```json
{
  "tipoDte": 39,
  "receptor": { "rut": "66666666-6", "razonSocial": "Cliente General" },
  "detalles": [
    { "nombre": "Producto", "cantidad": 1, "precio": 1190 },
    { "nombre": "Servicio exento", "cantidad": 2, "precio": 500, "exento": true, "unidad": "Hr" }
  ],
  "descuento": { "tipo": "porcentaje", "valor": 10 }
}
```

- `tipoDte`: 39 boleta afecta (por defecto) o 41 exenta. Elige la variable del CAF.
- `receptor`: opcional; por defecto `66666666-6` "Cliente General".
- `precio`: unitario **bruto** (IVA incluido), en pesos.
- `exento`: el ítem va en `<MntExe>` y no recibe descuento.
- `descuento`: opcional; `tipo` `"monto"` (pesos, por defecto) o `"porcentaje"`; solo sobre
  lo afecto.
- El folio **no** va en el JSON: se pasa con `--folio`.

Resolución y CAF según el ambiente: ver [configuracion.md](configuracion.md#resolución-y-caf-según-el-ambiente).
En producción no hay resolución por defecto (el PHP tenía 80 / 2014-08-22 fijos).

**Registro por folio.** Cada envío deja `boleta-<ambiente>-<folio>.envio.json` con el
trackId y el estado. **Mientras ese archivo exista, ese folio no se vuelve a armar ni a
enviar** (código 3). Si el envío queda en duda (corte de red, HTTP 5xx), el registro queda
marcado como incierto y el comando termina con 6: revisa en el SII si el folio quedó
emitido y borra el registro solo si confirmas que la boleta no llegó.

**Sale al SII** (solo con `--confirmar`): semilla y token (si no hay uno vigente en
`SII_CACHE_TOKENS`) y `POST boleta.electronica.envio` con el sobre.
**Escribe:** `boleta-<ambiente>-<folio>.xml` (sobre firmado, ISO-8859-1; también sin
`--confirmar`) y `boleta-<ambiente>-<folio>.envio.json` (solo al enviar).
**Códigos propios:** 1 boleta inválida (p. ej. folio fuera del CAF) · 3 configuración, JSON
inválido o folio ya enviado · 4 la boleta no llegó (falla al pedir el token, o HTTP 4xx al
enviar) · 6 incierto (corte de red, HTTP 5xx o respuesta sin trackId al enviar).
**Después:** `sii produccion consultar <trackId>`, en unos minutos.

### `consultar`

```
sii produccion consultar <trackId> [--ambiente produccion|certificacion] [--json]
```

Estado de un envío hecho por la API REST (el trackId lo imprime `emitir --confirmar`).
Solo lectura.

| Opción | Qué hace |
|---|---|
| `--ambiente <amb>` | `produccion` (por defecto: api.sii.cl) o `certificacion` (apicert.sii.cl) |
| `--json` | Imprime el JSON completo del SII en vez del resumen |

Solo sirve para envíos REST: un trackId de DTEUpload responde "No existe recurso".

**Sale al SII:** semilla y token (si no hay uno vigente en `SII_CACHE_TOKENS`) y
`GET boleta.electronica.envio/<rut>-<dv>-<trackId>`.
**Escribe:** nada (salvo el caché de tokens, si está configurado).

### `seguimiento`

```
sii produccion seguimiento [--ambiente produccion|certificacion] [--salida <dir>]
                           [--desde <AAAA-MM-DD>] [--bitacora <archivo>] [--json]
```

Revisa en el SII el estado de todas las boletas emitidas con `emitir --confirmar`: lee los
registros `boleta-<ambiente>-<folio>.envio.json` de la carpeta de salida y consulta cada
trackId por la API REST, con un solo token. Solo lectura. Los envíos inciertos (sin
trackId) no se consultan: se listan aparte, para revisarlos en el portal del SII.

| Opción | Qué hace |
|---|---|
| `--ambiente <amb>` | `produccion` (por defecto: api.sii.cl) o `certificacion` (apicert.sii.cl). Solo lee los registros de ese ambiente |
| `--salida <dir>` | Carpeta con los registros (por defecto `data/output` junto al `.env`, la misma de `emitir`) |
| `--desde <AAAA-MM-DD>` | Solo los envíos hechos desde ese día (hora de Chile) |
| `--bitacora <archivo>` | Agrega al archivo una línea JSON por envío revisado (fecha, trackId, folios, estado, conteos). La carpeta tiene que existir |
| `--json` | Resultado completo en JSON en vez de la tabla |

Clasifica cada envío como en proceso (`REC`, `SOK`, `CRT`, `FOK`, `PRD`), aceptado, con
reparos o rechazado. Solo pide el certificado y `SII_RUT_EMPRESA` si hay algo que consultar.

**Sale al SII:** semilla y token (si no hay uno vigente en `SII_CACHE_TOKENS`) y un
`GET boleta.electronica.envio/...` por cada trackId distinto.
**Escribe:** nada por defecto; con `--bitacora`, agrega líneas al final (nunca reescribe).
**Códigos propios** (gana el primero): 5 algún envío rechazado, conteos que no cuadran o
respuesta que no se entiende · 6 envíos inciertos o registros ilegibles · 4 alguna consulta
falló por red · 0 todo aceptado (con o sin reparos), en proceso, o sin registros.

Uso en el piloto: [piloto-produccion.md](piloto-produccion.md).

---

## Grupo `util`

### `firmar-semilla`

```
sii util firmar-semilla <semilla>
```

Firma una semilla de la API REST obtenida a mano (p. ej. con el "Try it out" del Swagger del
SII o con Postman) e imprime el XML `getToken` firmado, listo como cuerpo de
`POST boleta.electronica.token`. La semilla es el número de `<SEMILLA>...</SEMILLA>`.

**Sale al SII:** nada. **Escribe:** nada. El XML va a la salida estándar entre
`===== COPIA DESDE AQUI =====` y `===== HASTA AQUI =====` (incluye el certificado público,
no la llave privada).

### `verificar-ted`

```
sii util verificar-ted <sobre.xml> [--caf <ruta>]
```

Verifica la firma `<FRMT>` del TED de cada boleta del sobre con la llave del CAF: la deriva
de `<RSASK>` (como el PHP) y además revisa que coincida con la `<RSAPK>` que publica el CAF
(la que usa el SII). Imprime `OK` o `FALLA` por TED, con tipo y folio.

| Opción | Qué hace |
|---|---|
| `--caf <ruta>` | CAF con que se timbraron las boletas (en vez de `SII_CAF_39`) |

**Sale al SII:** nada. **Escribe:** nada.
**Códigos:** 0 todos los TED OK · 3 sobre o CAF ilegibles · 7 algún TED falla, el sobre no
trae ningún TED, o `<RSASK>` y `<RSAPK>` no coinciden.

---

## Equivalencias con `bin/` del PHP

| Script PHP | Comando Node | Diferencias |
|---|---|---|
| `bin/certificacion/enviar-set-boletas.php` | `sii certificacion enviar-set` | CAF, folios y `FchResol` vienen del `.env` u opciones (en el PHP, fijos en el código). `--canal rest` y `--solo-armar` nuevos. Sin la doble conversión a ISO-8859-1. Archivo: `envio-set-boletas.xml` (PHP: `envio_set_boletas.xml`) |
| `bin/certificacion/enviar-consumo-folios.php` | `sii certificacion enviar-rcof --sobre <ruta>` | Montos, folios y fechas salen del sobre (en el PHP, escritos a mano). Se niega a períodos desde 2022-08-01. Archivo: `rcof.xml` (PHP: `consumo_folios.xml`). Una sola `FchResol` para sobre y RCOF (el PHP usaba fechas distintas) |
| `bin/certificacion/estado-declaracion.php` | `sii certificacion estado-declaracion [rut]` | El RUT es opcional (por defecto `SII_RUT_EMPRESA`). Errores con código de salida, no `PHP Fatal error` |
| `bin/produccion/emitir-boleta.php` | `sii produccion emitir --boleta <json> --folio <N>` | La boleta viene de un JSON (en el PHP, fija en el código). Sin `--confirmar` arma y guarda el XML **sin red**; el modo "solo token" del PHP no tiene equivalente directo. Sin resolución por defecto. Registro por folio contra envíos dobles. `--ambiente certificacion` para probar |
| `bin/produccion/consultar-envio.php` | `sii produccion consultar <trackId>` | Imprime un resumen (`--json` para el JSON completo). `--ambiente certificacion` nuevo. Solo exige `SII_RUT_EMPRESA` y el certificado (el PHP exigía los seis datos del emisor) |
| `bin/util/firmar-semilla.php` | `sii util firmar-semilla <semilla>` | Igual |
| `bin/util/verificar-ted.php` | `sii util verificar-ted <sobre.xml> [--caf <ruta>]` | El sobre es obligatorio (el PHP tenía rutas por defecto). Además compara `<RSASK>` con `<RSAPK>`. No necesita `.env` si viene `--caf` |

Comandos nuevos, sin equivalente en `bin/`: `postular`, `descargar-set`,
`solicitar-folios`, `estado-envio`, `solicitar-revision`, `verificar-portal`, `declarar` y
`produccion seguimiento`.

Diferencias comunes con los scripts del PHP:

- **Configuración:** sin `SII_OPENSSL_PATH` ni `OPENSSL_MODULES_PATH`: Node lee los .pfx
  legacy sin el binario `openssl`. Cada comando exige solo lo que usa.
- **Errores:** el PHP imprimía `[ERROR]` y salía con 0, o moría con código 255. Node usa los
  [códigos de salida](#códigos-de-salida) 0–7 y escribe los errores en la salida de errores.
- **Bytes:** el PHP reconvertía a ISO-8859-1 un XML que ya lo estaba (rompía tildes y eñes).
  Node escribe los bytes tal cual.
- **Carpeta de salida:** la CLI crea `data/output/` si falta (el PHP no).
- **Tokens:** sin el caché global en `data/output/token_cache_boleta_produccion.txt`. Caché
  opcional por empresa, ambiente y certificado con `SII_CACHE_TOKENS`.

## Seguimiento del piloto

Cómo usar `sii produccion seguimiento` día a día durante el piloto en producción (junto con
`emitir` y `consultar`) se documenta en [piloto-produccion.md](piloto-produccion.md).
