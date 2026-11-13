---
title: "Trampas conocidas"
description: "Comportamientos no obvios del SII, de la librería y del esquema."
keywords: [claves legadas, Legacy API keys are disabled, sesión revocada, getClaims, getUser, user_not_found, índice único parcial, predeterminado, vigente, fijar_certificado_predeterminado, registrar_resolucion, pfx_legacy, 3DES, RC2, otherName, 1.3.6.1.4.1.8321.1, serialNumber, RUT del titular, tokens_sii, huella, activa, desactivada, ISO-8859-1, comillas tipográficas, Word, server_action_form_data, "[Filtrado]", 42883, migración 0005, migración 0006, migración 0007, PGRST202, advisory lock, pg_try_advisory_xact_lock, arriendo, reentrante, BloqueoOcupadoError, ErrorBloqueo, maxDuration, en_curso, abandonada, marcarInciertaRevisada, ensayo, FolioInicialRequeridoError, SesionCaducaError, sanearTexto, token corto, content-type, charset, application/xml, caché por invocación, await using, crearCredenciales, huella_distinta, migración 0008, registrar_caf, guardar_set_pruebas, asistente de certificación, ensayo sin red, bloqueoEnvioSet, enviar_set, verificar_portal, P91, set ilegible, folios_anulados, Track ID, envio_set_id, consultas_envio, sanearTexto, set_con_reparos, set_rechazado, en_curso abandonada, operacionEnCurso, aceptado_con_reparos, resolución número 0]
related: ["08-esquema-supabase/solucion-de-problemas.md", "02-guias/certificacion-empresa.md", "01-fundamentos/ambientes-y-credenciales.md", "04-objetos/objetos-empresas-y-credenciales.md", "08-esquema-supabase/vault-y-secretos.md", "01-fundamentos/errores-y-resultados.md", "01-fundamentos/autenticacion-sii.md", "09-libreria/backend-service-role.md"]
source: ["supabase_saas_sii.sql", "certificacion-node/docs/solucion-de-problemas.md", "supabase/migrations/0005_certificados_resoluciones.sql", "apps/web/src/server/certificados/", "apps/web/src/lib/sentry/depurar.ts", "supabase/migrations/0006_realtime_operaciones.sql", "supabase/migrations/0007_bloqueos_sii.sql", "apps/web/src/server/sii/", "supabase/migrations/0008_certificacion.sql", "apps/web/src/server/certificacion/", "apps/web/src/app/[org]/certificacion/"]
---

# Trampas conocidas

> **Úsalo cuando:** algo no funciona como esperas, o antes de escribir código.

<!-- TODO: redactar las trampas del SII y de la librería -->

## Supabase

- **`401 Legacy API keys are disabled`.** Las claves `anon` / `service_role` (JWT `eyJ…`)
  están desactivadas desde el 2026-11-13. Un ejemplo copiado de un tutorial o una
  integración que use `SUPABASE_ANON_KEY` o `SUPABASE_SERVICE_ROLE_KEY` falla así:
  usar `sb_publishable_…` o `sb_secret_…`
  ([claves API](../01-fundamentos/ambientes-y-credenciales.md#claves-api-de-supabase)).
- **Un usuario borrado o baneado sigue «iniciado» hasta una hora.** `getClaims()`
  verifica el JWT localmente (JWKS) y no se entera de la revocación hasta el `exp`.
  Quitar la membresía sí corta el acceso al instante. Las operaciones ⚠️ confirman la
  sesión con `getUser()`
  ([sesiones y revocación](../01-fundamentos/ambientes-y-credenciales.md#sesiones-de-usuario-y-revocación)).
- **«Cerrar sesión» con un usuario que ya no existe.** Auth responde
  `403 user_not_found` y `/auth/salir` lo registra en consola (`auth/salir: user_not_found`),
  pero borra las cookies y redirige igual. No es un error de la app.
- **Con `SUPABASE_SECRET_KEY`, Auth omite el captcha.** Los clientes de `clave-auth.ts`
  verifican Turnstile en la app (`siteverify`) antes de llamar a Auth. Nunca usarlos para
  datos: la Data API correría como `service_role`.

## Empresas, certificados y resoluciones (Fase 3)

- **`42883 function … does not exist` al subir un certificado, registrar una resolución
  o cambiar el predeterminado.** Las tres RPC vienen en la migración
  `0005_certificados_resoluciones` (aplicada en producción el 2026-11-13); si aparece, la
  base no tiene la 0005. La app lo muestra como «No pudimos completar la operación».
  Aplicar la 0005 y correr su verificación
  ([despliegue](../08-esquema-supabase/despliegue.md)).
- **Cambiar la resolución vigente o el certificado predeterminado con `update`/`insert`
  sueltos choca con el índice.** `resoluciones_vigente_unica` y
  `empresa_certificados_predeterminado_unico` son índices únicos **parciales**
  (`where vigente`, `where predeterminado`) y Postgres los revisa fila a fila, no al
  final de la sentencia. Encender la nueva antes de apagar la anterior, o hacerlo en un
  solo `update` (según el orden en que se recorran las filas), da `23505`; y dos
  sentencias desde la app pueden quedar a medias. Usar `registrar_resolucion()` y
  `fijar_certificado_predeterminado()`, que apagan primero, encienden después y se
  serializan con un candado sobre la empresa
  ([contratos](../03-api-reference/rpc-organizacion.md#empresa-resolución-y-certificado-predeterminado-migración-0005)).
  Apagar sin encender otra (`set predeterminado = false`) sí se puede directo.
- **Un .pfx con 3DES no es `pfx_legacy`.** El comentario de la columna en `0001` dice
  «cifrado legacy (RC2/3DES)», pero el código sigue a la librería
  (`PBE_NATIVOS` / `PBES2_NATIVOS` de `core/certificado.ts`): legacy es lo que OpenSSL 3
  solo descifra con el proveedor legacy (RC2-40 de los .pfx del SII, RC4, DES). 3DES
  (`pbeWithSHAAnd3-KeyTripleDES-CBC`, `des-EDE3-CBC`) lo lee sin él, así que cuenta como
  no legacy. Lo prueba `analizar.test.ts` contra la librería con `cert-3des-cadena.pfx`.
- **El RUT del titular no siempre viene en el certificado.** `analizarCertificado` lo
  busca en el subjectAltName (`otherName` con OID `1.3.6.1.4.1.8321.1`, como lo emiten
  E-Certchile y otras CA chilenas) y, si no está, en el `serialNumber` del sujeto, solo
  si tiene guion (`RUT:12.345.678-5` sirve; `123456785` no, para no confundir un número
  de serie con un RUT). El del subjectAltName manda sobre el `serialNumber`. Si no hay
  ninguno, el formulario pide el RUT con un aviso y hay que **volver a escribir la
  contraseña** (nunca vuelve del servidor). Si el certificado trae RUT y la persona
  escribe otro, se rechaza: «El RUT no coincide con el del certificado».
- **Eliminar un certificado no borra sus tokens del SII.** `tokens_sii` no tiene FK a
  `certificados`: su clave es `(canal, ambiente, rut_empresa, huella_certificado)`. La
  cascada borra `empresa_certificados` y `sesiones_sii` (y `trg_borrar_secretos`, los dos
  secretos de Vault), pero los tokens quedan hasta vencer (~50 min) y la limpieza
  periódica de tokens vencidos todavía no está programada. Tampoco tienen
  `organizacion_id`: dos organizaciones con la misma empresa y el mismo certificado
  comparten la fila del token.
- **Revocar no quita el certificado de las empresas.** `revocado_en` deja la asociación y
  el `predeterminado` como estaban. Al firmar (Fase 4), descartar los certificados
  revocados o vencidos (`v_certificados_estado.estado`).
- **`empresas.activa` todavía no la exige ninguna regla de la base.** Ni
  `tg_validar_documento` ni `asignar_folio` la miran: una empresa «desactivada» en la UI
  podría emitir si alguien llama al backend directo. El filtro tiene que llegar con la
  emisión y los folios (Fases 6 y 7). Además, `tg_limite_empresas` cuenta las
  desactivadas: desactivar no libera cupo del plan.
- **Comillas y guiones pegados desde Word se rechazan.** Razón social, giro, dirección y
  comuna solo aceptan ISO-8859-1, la codificación del DTE. Word y los correos cambian
  `"` por `“ ”`, `'` por `‘ ’` y `-` por `–`; esos caracteres (y los emoji, `€`, `…`)
  quedan fuera. El mensaje nombra los caracteres que sobran
  ([regla ISO-8859-1](../01-fundamentos/formatos-y-validaciones.md#regla-iso-8859-1)).
  La base no lo exige: un `insert` directo los aceptaría.
- **En Sentry no se ve ningún campo de un formulario de Server Action.**
  `depurar.ts` reemplaza por `[Filtrado]` `server_action_form_data` y todos sus campos,
  sean sensibles o no (también la razón social o el RUT). Es a propósito: un campo con
  otro nombre (`archivo`) podría traer el .pfx. Para depurar, reproduce en local o
  registra en el servidor solo códigos y datos que no sean secretos
  ([qué filtra](../08-esquema-supabase/vault-y-secretos.md#sentry-appswebsrclibsentrydepurarts)).
- **Un .pfx sin contraseña no se puede subir por la app.** `registrar_certificado` acepta
  una clave vacía (no nula), pero `subirCertificado` exige escribir una contraseña.
- **Los tipos generados declaran `string` en parámetros que aceptan `null`.**
  `registrar_certificado` acepta nulos en nombre, CN, emisor y vigencia; el cliente de
  Supabase tipado los marca como `string` y la app los pasa con un cast (`textoONulo`).

## Capa de servicio SII (Fase 4)

### Migraciones

- **Las migraciones 0006 y 0007 están aplicadas en producción** (2026-11-13). Síntomas si
  una base nueva (otro proyecto, un entorno recién creado) no las tiene: toda operación que
  use `conBloqueoCertificado` termina en `error` con mensaje genérico y en Sentry aparece
  `ErrorBloqueo` con el código de función inexistente (`PGRST202` por PostgREST; `42883` en
  SQL directo); una suscripción de Realtime a `operaciones_sii` o `solicitudes_folios` no
  recibe nada y **no da error**. `tipos.ts` tenía `bloqueos_sii` y las dos RPC agregados a
  mano; `pnpm db:tipos` dio un resultado idéntico, sin diferencias
  ([despliegue](../08-esquema-supabase/despliegue.md#fase-4-migraciones-0006-y-0007-aplicadas-el-2026-11-13)).

### Bloqueo del certificado

- **Un advisory lock «transaccional» no sirve a través de PostgREST.** Cada RPC es una
  transacción: `pg_try_advisory_xact_lock` se suelta al volver la llamada, mucho antes de
  que termine la operación con el SII. Uno de sesión (`pg_try_advisory_lock`) queda pegado
  a una conexión del pool que PostgREST y Supavisor reparten entre peticiones. Por eso la
  0007 usa una fila con arriendo (`bloqueos_sii`); no lo «simplifiques» volviendo a un
  advisory lock
  ([por qué](../01-fundamentos/autenticacion-sii.md#por-qué-un-arriendo-y-no-advisory-locks)).
- **El bloqueo no es reentrante.** `conBloqueoCertificado` usa un titular aleatorio por
  llamada: si una función que ya lo tiene vuelve a pedirlo para el mismo certificado y
  ambiente (p. ej. un helper que lo toma por su cuenta), espera 20 s y lanza
  `BloqueoOcupadoError`. Tómalo una sola vez, en el nivel más externo.
- **El arriendo (300 s) tiene que cubrir la función.** 300 s es el `maxDuration` más largo
  que se usa hoy. Si una ruta sube su `maxDuration` (Pro permite hasta 800 s) y la
  operación puede durar más, pasa `{ segundos }` acorde (máximo 900). Si el arriendo
  vence antes de terminar, otra petición puede tomar el bloqueo y abrir otra sesión; al
  soltar, la consola avisa `bloqueos: el arriendo del bloqueo venció antes de terminar la
  operación`.
- **La espera de 20 s corre dentro de la función.** Mientras espera el bloqueo, la función
  consume su tiempo de ejecución. Si se rinde, el resultado es `transporte` (código 4)
  aunque no hubo ninguna falla de red: en Sentry se distingue porque no lleva la etiqueta
  `host_sii` y `detalle.error.nombre` es `BloqueoOcupadoError`.

### Regla del incierto

- **Doble timbraje por carrera (resuelto con la migración 0007).** Antes, `ejecutarOperacion`
  consultaba la última fila y después insertaba la suya, sin atomicidad: dos
  `solicitar_folios` simultáneas (doble clic, dos pestañas) pasaban las dos la revisión, y
  el bloqueo del certificado solo las ponía en fila (la segunda timbraba otro rango al
  soltarse). Ahora: el índice único parcial `operaciones_sii_efecto_global_en_curso`
  admite una sola `solicitar_folios` / `postular` / `declarar` confirmada `en_curso` por
  empresa y ambiente (la segunda recibe 23505 → `motivo: 'en_curso'`, sin ejecutar), y
  después de insertar se vuelve a revisar, para el `incierto` que aparece entre el control
  previo y el insert (la fila propia se cierra como `uso` con `detalle.motivo`). Detalle en
  [errores y resultados](../01-fundamentos/errores-y-resultados.md#carrera-entre-dos-peticiones-iguales).
  La 0007 está aplicada en producción desde el 2026-11-13, así que el índice único ya está
  activo (en una base sin ella, el insert no choca y solo queda el control posterior).
  Deshabilitar el botón al enviar (Fase 6) sigue siendo buena idea, pero ya no es lo que
  evita el doble timbraje.
- **`OPERACIONES_EFECTO_GLOBAL` y el predicado del índice van juntos.** Si agregas o quitas
  una operación de la lista en `operacion.ts`, cambia el índice con una migración nueva y
  las comprobaciones 13–14 de `verificaciones/0007_bloqueos_sii.sql`; si no, la operación
  nueva queda sin protección contra la carrera (o una quitada sigue chocando).
- **Una operación de efecto global sin `empresaId` es `uso`.** En un índice único los NULL
  no chocan, así que `ejecutarOperacion` la rechaza antes de insertar (`motivo: 'uso'`,
  sin fila, excepción en Sentry: es un bug de quien llama).
- **Una `en_curso` abandonada no cambia sola y ocupa el índice.** Pasados 15 min se trata
  como `incierto` para bloquear, pero la fila sigue `en_curso` en la base (y en el índice
  único: ninguna otra igual puede entrar) hasta que alguien la marca como revisada. Un
  listado o un contador de «en curso» tiene que mirar también `iniciada_en`. Si falla el
  cierre de la fila propia que el control posterior bloqueó, también queda así, aunque no
  salió nada al SII.
- **Las filas `uso` y `config` no cuentan para el bloqueo.** El control mira la última
  fila confirmada que pudo llegar al SII; si contara las `uso`, la fila que el control
  posterior cierra taparía el `incierto` que la bloqueó.
- **`marcarInciertaRevisada` no verifica el rol.** Usa `service_role` y solo filtra por
  organización. Marcar como revisada desbloquea un reintento que puede quemar folios: la
  Server Action que la llame tiene que exigir membresía y rol antes.
- **`emitir` no se bloquea por incierto en `ejecutarOperacion`.** Su incierto es por
  documento (`envios.incierto`, Fase 7). Solo `solicitar_folios`, `postular` y `declarar`
  se bloquean aquí.
- **Un ensayo no es un ensayo si `fn` graba.** `confirmada: false` solo cambia la
  auditoría (no hay `getUser()` ni bloqueo por incierto). Que no salga nada irreversible
  al SII lo garantiza `fn`, no `ejecutarOperacion`.
- **`fn` tiene que lanzar para todo lo que no sea `ok`.** Si devuelve un objeto «fallido»,
  la fila queda `ok`. Un rechazo detectado por la app se lanza como `ErrorRespuestaSii`.
- **Cron y API pública no pasan por `getUser()`.** El paso 1 exige `usuarioId`; con
  `usuarioId: null` se salta. La API pública tiene que validar su clave antes de llamar.

### Errores y saneado

- **`FolioInicialRequeridoError` es `rechazo_sii` (5), aunque la CLI devuelve 3.** La capa
  sigue a `codigoDeError()`, donde hereda de `ErrorSolicitudFolios`. El comando
  `certificacion solicitar-folios` de la CLI lo atrapa aparte y devuelve `CONFIG` (3) con
  la sugerencia `--folio-inicial`. No se timbró nada; la Fase 6 puede envolverlo en
  `ErrorConfig` para mostrarlo como configuración. Lo mismo pasa con `SesionCaducaError`
  si llega a escapar de `conSesionReutilizada`: `rechazo_sii`.
- **Un token corto en texto libre no se puede detectar por patrón.** `sanearTexto()` quita
  PEM, JWT, `TOKEN=`, `clave=…`, cabeceras `Cookie:` y tiras de 32+ caracteres que mezclan
  letras y dígitos; un token del SII de 12 caracteres suelto en una frase pasa. Por eso
  **el `message` de un error desconocido nunca se guarda en `operaciones_sii` ni se muestra**
  (solo su `name`), `ErrorRespuestaSii.estado` solo se guarda si mide 10 caracteres o
  menos, y `agregarDetalle()` debe recibir solo campos acotados, nunca respuestas crudas
  del SII. A Sentry sí va el `message` saneado de un resultado `error`: es lo mejor que
  se puede hacer, no una garantía.
- **El `content-type` sin `; charset=` no está verificado contra el servidor de Storage.**
  `almacen.ts` sube `application/xml` exacto porque Storage compara el tipo con
  `allowed_mime_types`, y las pruebas solo lo comprueban contra un cliente falso. En la
  primera subida real (Fases 5 y 7) confirmar que el objeto queda con `application/xml` y
  que los bytes descargados son idénticos (ISO-8859-1 intacto). No agregar `charset` sin
  probarlo: podría no calzar con `allowed_mime_types` y Storage rechazaría la subida.

### Credenciales y recursos por invocación

- **El caché de credenciales es por invocación, nunca global.** `crearCredenciales()` se
  llama una vez por petición. Guardarlo (o el `Certificado`, la `FirmaElectronica` o un
  `TransporteUndici`) en una variable de módulo dejaría la llave privada de una
  organización en memoria al alcance de la petición de otra: en Vercel una instancia
  atiende a varios usuarios.
- **Sin `await using`, el transporte mantiene viva la función.** `crearTransporte()`
  devuelve un `TransporteUndici` con conexiones keep-alive; si no se cierra, la función
  sigue corriendo (y cobrando) hasta que expiran.
- **Un predeterminado revocado no se reemplaza solo.** `certificadoDeEmpresa()` sin
  `representante` lanza `ErrorCredenciales('revocado')` en vez de usar otro certificado:
  cambiar de firmante sin avisar no es aceptable. Con `representante: true` sí elige otro
  representante vigente (el que vence más tarde).
- **La vigencia que manda es la del certificado, no la de la fila.** Un certificado cuya
  fila dice vigente pero cuyo X.509 venció da `vencido`; y si la huella del .pfx de Vault
  no calza con la fila, `huella_distinta` («Vuelve a subir el archivo .pfx»).
- **Cargar las credenciales fuera de `ejecutarOperacion` pierde la auditoría.** Un
  `ErrorCredenciales` lanzado antes de entrar no deja fila en `operaciones_sii` ni pasa por
  la traducción de errores. Cárgalas dentro de `fn`.

## Certificación ante el SII (Fase 5)

### Migración 0008

- **La migración 0008 está aplicada en producción** (2026-11-13). Síntomas si una base
  nueva (otro proyecto, un entorno recién creado) no la tiene: las dos acciones que la usan
  fallan **después** de que el SII grabó algo. Pedir folios del set timbra en el SII, pero
  `registrar_caf` no existe (`PGRST202`) → la solicitud queda `incierta` y la operación
  `incierto` («Se timbraron los folios, pero no pudimos guardar el CAF…»); descargar el set
  registra la descarga en el SII, pero `guardar_set_pruebas` no existe → `error` y el
  proceso no pasa a `set_descargado`. `tipos.ts` tenía las dos RPC agregadas a mano;
  `pnpm db:tipos` dio un resultado idéntico, sin diferencias
  ([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0008)).

### Ensayo y confirmación

- **En el asistente, el ensayo no sale a la red ni deja filas.** Con `confirmada: false`
  las acciones de `server/certificacion` no llaman a `ejecutarOperacion`: validan en la
  base y devuelven el resumen, sin fila `confirmada = false` en `operaciones_sii` y sin
  `verificar_portal`. Es distinto de lo que hace `ejecutarOperacion` con un ensayo (inserta
  su fila) y de la CLI, cuyo `solicitar-folios` sin `--confirmar` recorre el asistente del
  SII hasta antes de timbrar. Consecuencia: el ensayo no puede anticipar lo que solo sabe
  el SII (que pida folio inicial, que el portal haya cambiado, un rechazo); eso aparece al
  confirmar.
- **El ensayo no revisa el incierto (salvo en `enviarSet`).** El bloqueo por incierto de
  `postular`, `solicitar_folios` y `declarar` lo aplica `ejecutarOperacion` solo a las
  confirmadas: el ensayo puede salir bien y la confirmación volver con
  `incierto_sin_revisar`. `enviarSet` consulta `bloqueoEnvioSet` antes del ensayo, así que
  ahí bloquea también el ensayo.
- **`verificar_portal` corre antes del control del incierto.** `postular` y `declarar`
  confirmadas llaman primero a `verificarPortalAntes` (su propia fila, `confirmada = true`,
  y un GET a www4) y recién después a `ejecutarOperacion`. Si la operación queda bloqueada
  (incierto, en curso, sesión), la fila de `verificar_portal` queda igual. `descargarSet` y
  `solicitarRevision` usan el mismo portal GWT pero no lo verifican antes.

### Envío del set

- **`enviar_set` tiene su propio bloqueo (`bloqueoEnvioSet`), no el de `ejecutarOperacion`.**
  No está en `OPERACIONES_EFECTO_GLOBAL` (que va junto con el índice de la 0007), así que
  `operaciones.ts` mira el último `enviar_set` confirmado de la empresa (sin `uso` ni
  `config`) y bloquea si quedó `incierto` o `en_curso` sin `detalle.revisada_en`. Como lo
  mira en `operaciones_sii`, «Marcar como revisada» lo desbloquea igual que a los demás.
  **La carrera la cierra el bloqueo del certificado:** sin índice único, dos `enviarSet`
  simultáneos pasarían los dos el control. Por eso el envío confirmado corre dentro de
  `conBloqueoCertificado` (certificado + certificación) y repite `bloqueoEnvioSet` ya
  adentro: el segundo no toma el bloqueo (`BloqueoOcupadoError` → `transporte`, «inténtalo
  de nuevo») o, si entra después, ve la fila del primero. No es reentrante: dentro de
  `enviarSet` no se abre sesión AUT2000 (va por REST). Prueba: «dos envíos simultáneos» en
  `envio-set.test.ts`.
- **Rechazo sin Track ID anula folios; una falla de red después de salir, no.** Si el set
  no llega a salir (folios, armado, Storage, base o el **token**, que se pide antes de
  marcar la salida) o el SII responde la subida con un error que no es de red, los folios
  asignados van a `folios_anulados`, las boletas a `anulado` y `envios.error` guarda el
  motivo. Con `ErrorTransporte` después de salir no se sabe si llegó: `envios.incierto`,
  boletas `incierto` (por el trigger), folios sin anular y resultado `incierto`. La
  anulación no borra los XML que ya se subieron a Storage, y si alguno de sus `update` o
  `insert` falla solo queda un aviso en consola.
- **Track ID sin guardar → incierto.** Si el SII devolvió Track ID pero la app no pudo
  guardarlo (base caída, el `check` `track_id ~ '^[0-9]+$'` de `envios`, el `update` del
  proceso), la operación queda `incierto` con el Track ID en el mensaje: «…anota el Track
  ID y escríbenos a soporte». No reenviar: el SII ya tiene el set.
- **Un envío incierto queda en `envio_set_id` sin cambiar la etapa.** Con `ErrorTransporte`
  después de salir, además de `envios.incierto`, el proceso pasa a apuntar a ese envío (la
  etapa sigue en `set_descargado`), así el paso 3 muestra «No sabemos si el set llegó al
  SII» y `consultarEstadoSet` responde con la rama «resultado incierto». Lo que bloquea el
  reenvío sigue siendo la fila `incierto` de `operaciones_sii` («Marcar como revisada»).
  Un envío rechazado sin Track ID no se enlaza (sus folios se anulan).
- **Un reenvío usa folios nuevos.** Los del envío anterior quedan usados aunque el SII
  rechace el set; la revisión se pide con el Track ID del envío aceptado.
- **`estado_sii` de la subida y `fecha_recepcion` se filtran.** De la respuesta de la
  subida solo se guarda `estado_sii` si es `REC`, `SOK`, `CRT`, `FOK`, `PRD` o `EPR`; de la
  consulta, `fecha_recepcion` solo si el SII la da con zona horaria (sin zona no se sabe el
  instante). El JSON completo queda en `respuesta_subida` / `respuesta_estado`.
- **`consultas_envio.error` va saneado.** Si la consulta del estado falla, se anota una fila
  con `error`: `nombre: mensaje` pasado por `sanearTexto()` si es un `SiiError`, o solo
  `<nombre> (sin detalle)` si no lo es (el mensaje de un error desconocido puede traer
  cualquier cosa). Nunca la respuesta cruda.

### Set y estados

- **P91 no descarga el set.** `descargarSet` lee el estado de la declaración antes (y lo
  guarda: el trigger puede dejar la empresa `autorizada`); con P91 no descarga, como la CLI
  sin `--aunque-autorizada`. En P90 frena la librería (`ErrorPostulacion`). La RPC
  `guardar_set_pruebas` y las validaciones previas además rechazan una etapa
  `por_declarar` o `autorizada`.
- **Set ilegible: no lo vuelvas a descargar.** El SII ya registró la descarga; la app guarda
  el texto, borra los casos, deja `envio_set_id` y `revision_solicitada_en` nulos y **no
  cambia la etapa**. Hasta una descarga legible, los pasos 3 y 4 no avanzan (sin casos ni
  envío). El mensaje pide escribir a soporte.
- **`ok` en `operaciones_sii` con `error` en la UI.** Set ilegible (`set_ilegible`), empresa
  en P91 al descargar (`autorizada`) y set rechazado o con reparos al consultar
  (`set_rechazado`, `set_con_reparos`) dejan la operación `ok`: la llamada al SII funcionó.
  Un contador de fallas no puede basarse solo en `resultado`.
- **Postulación en ASCII, declaración en UTF-8.** Los datos de la postulación van al
  asistente de maullin (`charset=iso-8859-1`): con tildes la confirmación no calza y la
  postulación no se graba, así que la app los rechaza. Los de la declaración van por
  GWT-RPC y admiten tildes.
- **La resolución de certificación la registra `postular`.** Número 0 y la fecha del día
  en Chile, solo si la empresa no tiene una vigente de certificación. Si falla, la
  postulación queda `ok` con un aviso, y `enviarSet` se niega hasta que la registres
  (`config`).

### UI del asistente

- **La UI bloquea más que el backend.** Una incierta sin revisar de cualquiera de las seis
  operaciones que graban (también `descargar_set` y `solicitar_revision`) deshabilita
  **todas** las acciones; el backend solo bloquea `postular`, `solicitar_folios`,
  `declarar` (por `ejecutarOperacion`) y `enviar_set` (por `bloqueoEnvioSet`).
- **Una `en_curso` de más de 15 min es incierta también en la UI.** `operacionEnCurso()` y
  `inciertasSinRevisar()` (`logica.ts`) usan `MINUTOS_EN_CURSO_ABANDONADA` (15, sincronizada
  a mano con la de `server/sii/operacion.ts`, que es `server-only`): una fila abandonada de
  una operación que graba deja de mostrarse «en curso» y aparece como «por verificar» con
  «Marcar como revisada» (`marcarInciertaRevisada` la pasa a `incierto`). Si una función
  muere a mitad de camino, el asistente se desbloquea a los 15 min.
- **Un set aceptado con reparos se reenvía.** `aceptado_con_reparos` no avanza a
  `set_aceptado` (el backend exige EPR limpio y responde `set_con_reparos`), así que el
  paso 3 lo trata como un rechazo: «El SII aceptó el set con reparos. Revisa los reparos,
  corrige y vuelve a enviarlo», con «Volver a enviar el set» y la consulta del estado.
- **La vista trae las últimas 20 operaciones.** Una incierta más antigua no aparece en la
  lista ni deshabilita botones; el backend igual la bloquea (las de efecto global y
  `enviar_set`) y devuelve `operacionPendienteId`, con lo que el aviso de error sí ofrece
  «Marcar como revisada».
- **El correo de etapa es por operación y solo si la etapa cambia.** `Idempotency-Key` =
  `certificacion/<operacionId>/<etapa>`: la misma operación no avisa dos veces la misma
  etapa. Una consulta que no cambia la etapa no manda nada. Sin `NEXT_PUBLIC_APP_URL` no
  se envía (aviso en consola).
