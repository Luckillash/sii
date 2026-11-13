---
title: "Set de pruebas de boletas"
description: "Formato del .txt del SII, casos CASO-N y reglas de parseo, registro en set_pruebas_casos, folios del set, armado y envío por REST, consulta de estado y revisión, como lo hace el asistente de la Fase 5."
keywords: [set de pruebas, CASO-N, parsearSetPruebas, CasoSetPruebas, DetalleSetPruebas, OBSERVACION, exento, unidad de medida, set_pruebas_casos, set_pruebas_texto, guardar_set_pruebas, set ilegible, descargarSet, descargarSetPruebas, DownloadFileServlet, correo del proveedor, solicitarFoliosSet, folios del set, asignar_folio, enviarSet, ArmadorBoleta, EnvioBoleta, 66666666-6, Cliente General, CodRef SET, RazonRef, EnvioBOLETA, REST, Track ID, trackId, incierto, folios_anulados, consultarEstadoSet, EPR, limpio, reparos, rechazados, envio_rechazos, consultas_envio, solicitarRevision, SetSinDescargarError, resolución número 0]
related: ["02-guias/certificacion-empresa.md", "04-objetos/objetos-certificacion.md", "04-objetos/objetos-envios-y-rcof.md", "03-api-reference/rpc-backend.md", "02-guias/folios-caf.md", "07-referencia/trampas-conocidas.md"]
source: ["certificacion-node/docs/canales.md §parsearSetPruebas", "packages/certificacion/packages/core/src/certificacion/set-pruebas.ts", "supabase_saas_sii.sql §12", "supabase/migrations/0008_certificacion.sql", "apps/web/src/server/certificacion/set.ts", "apps/web/src/server/certificacion/folios.ts", "apps/web/src/server/certificacion/envio-set.ts", "apps/web/src/server/certificacion/declaracion.ts"]
---

# Set de pruebas de boletas

> **Úsalo cuando:** necesitas leer, cargar o emitir el set de pruebas.

El set de pruebas es la lista de boletas que el SII le pide emitir a la empresa en el
ambiente de certificación (pasos 2 a 4 del asistente). Recorrido completo y roles en
[certificación de la empresa](../02-guias/certificacion-empresa.md); columnas en
[objetos de certificación](../04-objetos/objetos-certificacion.md). Las dos RPC que usa
(`guardar_set_pruebas`, `registrar_caf`) vienen en la migración `0008`,
aplicada en producción el 2026-11-13 ([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0008)).

## 1. Descarga (`descargarSet`)

- Sale a `www4.sii.cl` con la sesión AUT2000 del certificado predeterminado:
  `DeclaracionBoletas.estado()` y luego `descargarSetPruebas(sesion, rut, correo)`, que
  llama al `DownloadFileServlet` con el RUT del representante (el usuario de la sesión) y
  el **correo del proveedor de software**.
- **El SII registra la descarga y entrega un set nuevo.** Los envíos hechos con un set
  anterior dejan de servir para la revisión. Por eso es ⚠️ (con ensayo) y el ensayo avisa
  si ya se había descargado uno.
- Correo: el que se escriba en el paso 2 o, si va en blanco, `correo_proveedor_set` del
  proceso. Se valida con `validarCorreo` de la librería (y antes, en la Server Action,
  con la regla de correo del SII). Sin ninguno: «Falta el correo del proveedor de
  software…».
- Etapas permitidas: de `postulada` a `revision_solicitada`. En `borrador` pide postular
  primero; en `por_declarar` o `autorizada` no descarga.
- Antes de descargar guarda el estado de la declaración que leyó (código, glosa, paso);
  el trigger puede mover la etapa. Si el SII muestra **P91**, la app **no descarga**
  (paridad con la CLI sin `--aunque-autorizada`) y responde «La empresa ya está autorizada
  en producción». En **P90** la librería no descarga (`ErrorPostulacion`, `rechazo_sii`):
  un set nuevo reiniciaría la certificación.

## 2. Formato del `.txt` y parseo (`parsearSetPruebas`)

La app no parsea por su cuenta: llama a `parsearSetPruebas(texto, '39')` de la librería
(principio 4). Reglas, resumidas del código de la librería:

| Regla | Detalle |
|---|---|
| Casos | cada caso empieza con una línea `CASO-N` (mayúsculas) y debajo una línea solo de `=` (puede haber líneas en blanco entre ambas; no blancos después de los `=`). Un encabezado `CASO-N` mal formado es error (el PHP lo perdía sin avisar). Una mención a `CASO-N` dentro de otra línea no cuenta |
| Ítems | líneas con **exactamente tres columnas** (nombre, cantidad, precio unitario con IVA) separadas por dos o más blancos. Se saltan las líneas en blanco, la cabecera de la tabla (`Item … Cantidad …`) y las que empiezan con `OBSERVACION` |
| Números | entero (`19900`), miles con un solo tipo de separador (`1.000`, `1,250,000`) o decimal con un solo punto o coma (`1.5`, `1,5`). Un número ambiguo (`1.000,50`, `1.5.0`, `1,`) en una fila de ítem es error |
| `OBSERVACION: "…"` (la primera del caso) | «item N … exento» marca ese ítem como exento (sin número de ítem, solo si el caso tiene un único ítem); «unidad de medida en X» pone la unidad X al ítem nombrado o a todos |
| Referencia | cada caso sale con `CodRef = 'SET'` y `RazonRef = 'CASO-N'` |
| Codificación | bytes en UTF-8 o ISO-8859-1; el set del SII es ASCII |

Lanza `ErrorValidacion` si no hay ningún `CASO-N`, si un encabezado no va seguido de su
línea de `=`, si un caso no trae ningún ítem legible o si un número es ambiguo.

## 3. Registro en `set_pruebas_casos`

Con el texto legible, `casosJson()` convierte cada `CasoSetPruebas` y la RPC
`guardar_set_pruebas` (🔒) hace todo en una transacción
([contrato](../03-api-reference/rpc-backend.md#guardar_set_pruebas-migración-0008)):

| Del caso | Columna |
|---|---|
| `N` de `CASO-N` en `referencia.razon` (o el orden en el archivo, si no calza) | `numero_caso` |
| `tipo` (`'39'`) | `tipo_dte` (39) |
| `detalles[]` | `detalles` (`{ nombre, cantidad, precio }`, más `exento: true` y `unidad` solo si vienen) |
| `referencia.codigo` / `.razon` | `referencia_codigo` (`SET`) / `referencia_razon` (`CASO-N`) |

Reemplaza **todos** los casos del proceso, guarda el texto (`set_pruebas_texto`), el
correo y la fecha, deja la etapa en `set_descargado` y borra `envio_set_id` y
`revision_solicitada_en`. Respuesta: «Descargamos el set de pruebas. El set trae N
casos…».

### Set ilegible

Si `parsearSetPruebas` lanza, **el SII ya registró la descarga**: la app no llama a la RPC,
y con `service_role`:

1. borra los casos del proceso (los del set anterior ya no sirven);
2. guarda `set_pruebas_texto`, `correo_proveedor_set`, `set_descargado_en` y deja nulos
   `envio_set_id` y `revision_solicitada_en`. **No cambia la etapa.**

La operación queda `ok` en `operaciones_sii` (con `detalle.set_ilegible = true`), pero la
acción devuelve `error` con `motivo: 'set_ilegible'`: «El SII entregó el set, pero no
pudimos leer sus casos. <motivo de la librería, saneado> El set quedó guardado y el SII
registró la descarga: no lo vuelvas a descargar todavía y escríbenos a soporte.» El texto
queda en la base para revisarlo. Mientras tanto el asistente queda sin casos y sin envío
del set: los pasos 3 y 4 no avanzan hasta una descarga legible.

## 4. Folios para el set (`solicitarFoliosSet`)

- Tipo 39, en certificación (IDK 100). **Cantidad = número de casos guardados**, o 5 si
  todavía no hay casos.
- Certificado de un **representante electrónico** (`certificadoDeEmpresa({ representante: true })`):
  el SII solo timbra a un representante. La UI avisa si el predeterminado no lo es.
- El ensayo dice cuántos folios hay disponibles; si ya alcanzan para el set, lo dice
  primero («…alcanzan para el set y no hace falta pedir más»). La UI solo ofrece pedir
  folios si faltan.
- Primer timbraje del tipo: el SII puede exigir un folio inicial
  (`FolioInicialRequeridoError`). No se timbró nada; la acción devuelve
  `requiere.folioInicial.sugerido` (el que sugiere el SII, o `1` si no es un número) y la
  UI muestra el campo «Folio inicial» para repetir.
- El CAF timbrado va a Vault y a `cafs` con `registrar_caf`, que también deja la
  solicitud `timbrada`. Detalle en [folios](../02-guias/folios-caf.md#folios-del-set-de-pruebas-fase-5).

## 5. Armado y envío por REST (`enviarSet`)

Canal REST de boletas (decisión D7): token en `apicert.sii.cl`, subida a `pangal.sii.cl`.

**Antes de abrir la operación** (también en el ensayo):

- `bloqueoEnvioSet`: si el último `enviar_set` confirmado quedó `incierto` (o `en_curso`
  de más de 15 min) y nadie lo marcó como revisado, no se envía ni se ensaya
  (`motivo: 'incierto_sin_revisar'`, con `operacionPendienteId`); si hay uno en curso,
  `motivo: 'en_curso'`.
- Etapa `set_descargado` o `set_enviado` (reenvío); casos guardados; **resolución de
  certificación vigente** (la registra `postular`: número 0 y la fecha de la postulación);
  folios disponibles ≥ casos; certificado predeterminado vigente.

**Dentro de la operación**, en este orden:

1. **Un folio por caso** con `asignar_folio(empresa, 'certificacion', tipo)` (atómico,
   bloquea el CAF). Sin folios: «Se acabaron los folios del CAF…» (`config`).
2. **Las boletas** con `ArmadorBoleta` (firma del certificado; XML del CAF leído de Vault con
   `leer_secreto`): emisor desde `empresas` (RUT, razón social, giro, dirección,
   comuna), receptor **`66666666-6` «Cliente General»**, los detalles del caso y la
   referencia `SET` / `CASO-N`. El sobre con `EnvioBoleta.empaquetar` y la carátula
   (`RutEmisor`, `RutEnvia` = titular del certificado, `NroResol`/`FchResol` de la
   resolución de certificación).
3. **Registro local, antes de salir:** fila en `envios` (`proposito = 'set_pruebas'`,
   `canal = 'rest'`), cada DTE a Storage (`<org>/<empresa>/certificacion/DTE-39-F<folio>.xml`),
   fila en `documentos` por boleta (`origen = 'set_pruebas'`, `caso_set = N`,
   `estado = 'firmado'`, montos y TED leídos del DTE armado), el sobre a Storage
   (`EnvioBOLETA-set-<envío>.xml`, en `envios.xml_path`), las líneas en
   `documento_detalles` (informativas: si fallan, sigue) y `set_pruebas_casos.documento_id`.
4. **Salida al SII:** `obtenerToken(rut)` y `enviarBoleta(token, rut, rutEnvia, sobre)`.
5. **Con Track ID:** `envios.track_id`, `enviado_en`, `respuesta_subida` y `estado_sii` (solo
   si es `REC`, `SOK`, `CRT`, `FOK`, `PRD` o `EPR`); boletas `firmado` → `enviado`;
   proceso en `set_enviado` con `envio_set_id`. «Enviamos el set de pruebas al SII… Consulta
   el estado del envío en unos minutos.»

**Cuando algo falla:**

| Qué pasó | Qué hace | Resultado |
|---|---|---|
| Falla antes de salir (folios, armado, Storage, base, **token**) con folios ya asignados | `folios_anulados` (un registro por folio, motivo «El set no se alcanzó a enviar al SII.»), documentos `anulado`, `envios.error` | el del error (`config`, `error`…) |
| El SII responde la subida con un error que no es de red (sin Track ID) | lo mismo, con motivo «El SII rechazó la subida del set sin entregar un Track ID.» | `rechazo_sii` u otro |
| `ErrorTransporte` **después** de salir | `envios.incierto = true` y `envios.error` (el trigger deja las boletas `incierto`); **los folios no se anulan** | `incierto`: «…el SII pudo haberla recibido (los folios X a Y). No reenvíes el set hasta revisar los envíos de la empresa en el portal del SII; después márcalo como revisado.» |
| Llegó el Track ID pero no se pudo guardar (base, `check` del `track_id`, proceso) | nada más | `incierto`: «El SII recibió el set (Track ID N), pero no pudimos guardarlo. No reenvíes el set: anota el Track ID y escríbenos a soporte.» |

Un envío **incierto** queda en `envio_set_id` (sin cambiar la etapa) para que el paso 3
avise «No sabemos si el set llegó al SII»; uno **rechazado** sin Track ID no se enlaza (el
proceso sigue apuntando al último envío con Track ID, o a ninguno). El bloqueo del reenvío
sale de `operaciones_sii`, no del envío. La anulación no borra los XML ya subidos a Storage.

El envío confirmado corre dentro del bloqueo del certificado en certificación
(`conBloqueoCertificado`) y repite `bloqueoEnvioSet` adentro: dos envíos simultáneos no
salen los dos.

Un reenvío (después de un rechazo) usa **folios nuevos**: los del envío anterior quedan
usados aunque el SII rechace el set. El ensayo lo advierte.

## 6. Consulta de estado (`consultarEstadoSet`)

Sin ensayo (solo lectura). Necesita `envio_set_id` con Track ID. Sale a `apicert.sii.cl`
(`obtenerToken` + `consultarEnvio(token, rut, trackId)`) y guarda:

- `envios`: `estado_sii`, `informados`, `aceptados`, `rechazados`, `reparos`,
  `fecha_recepcion` (solo si el SII la da con zona horaria), `respuesta_estado`,
  `ultima_consulta_en`, `consultas + 1`. La columna generada `clasificacion` se recalcula
  sola (`clasificar_envio`) y el trigger sincroniza el estado de las boletas.
- `envio_estadisticas` (upsert por tipo), `envio_rechazos` (se borran y se reinsertan;
  `reparo` si el estado es `RPR`, `REP` o `RLV`, si no `rechazo`) y una fila en
  `consultas_envio`.
- Si la consulta falla, igual queda una fila en `consultas_envio` con `error`: el
  `nombre: mensaje` saneado si es un error de la librería, o solo `<nombre> (sin detalle)`
  si no lo es.

| Estado | Respuesta | Etapa |
|---|---|---|
| en proceso (`REC`, `SOK`, `CRT`, `FOK`, `PRD`) | `ok`: «El SII todavía está validando el set» | sin cambio |
| `EPR` limpio (todos aceptados, sin reparos) | `ok`: «El SII aceptó el set de pruebas» | `set_enviado` → `set_aceptado` |
| `EPR` sin rechazos y con reparos | `error`, `motivo: 'set_con_reparos'`: corregir y reenviar (folios nuevos) | sin cambio |
| rechazo (`EPR` con rechazos u otro estado) | `error`, `motivo: 'set_rechazado'`: revisar el detalle y reenviar | sin cambio |

En todos esos casos la operación queda `ok` en `operaciones_sii`: la consulta funcionó; el
`error` es del set. Todavía no hay seguimiento automático (cron, Fase 8): el estado se
consulta con el botón del paso 3.

## 7. Revisión (`solicitarRevision`)

- Requiere etapa `set_aceptado` o `revision_solicitada` y que el envío de `envio_set_id`
  tenga Track ID y `clasificacion = 'aceptado'` (sin reparos).
- `DeclaracionBoletas.solicitarRevisionSet(sesion, rut, trackId)` en `www4.sii.cl`.
- OK: etapa `revision_solicitada` y `revision_solicitada_en`. El resultado no es inmediato:
  el SII responde por correo; cuando aprueba, el estado de la declaración pasa a **P90**
  (se ve con «Consultar el estado en el SII»).
- `SetSinDescargarError` (`rechazo_sii`): la app agrega «Qué hacer: descarga un set de
  pruebas nuevo (paso 2), envía las boletas de ESE set y pide la revisión con el Track ID
  de ese envío.»
