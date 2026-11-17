---
title: "Trampas conocidas"
description: "Comportamientos no obvios del SII, de la librería y del esquema."
keywords: [claves legadas, Legacy API keys are disabled, sesión revocada, getClaims, getUser, user_not_found, índice único parcial, predeterminado, vigente, fijar_certificado_predeterminado, registrar_resolucion, pfx_legacy, 3DES, RC2, otherName, 1.3.6.1.4.1.8321.1, serialNumber, RUT del titular, tokens_sii, huella, activa, desactivada, ISO-8859-1, comillas tipográficas, Word, server_action_form_data, "[Filtrado]", 42883, migración 0005, migración 0006, migración 0007, PGRST202, advisory lock, pg_try_advisory_xact_lock, arriendo, reentrante, BloqueoOcupadoError, ErrorBloqueo, maxDuration, en_curso, abandonada, marcarInciertaRevisada, ensayo, FolioInicialRequeridoError, SesionCaducaError, sanearTexto, token corto, content-type, charset, application/xml, caché por invocación, await using, crearCredenciales, huella_distinta, migración 0008, registrar_caf, guardar_set_pruebas, asistente de certificación, ensayo sin red, bloqueoEnvioSet, enviar_set, verificar_portal, P91, set ilegible, folios_anulados, Track ID, envio_set_id, consultas_envio, sanearTexto, set_con_reparos, set_rechazado, en_curso abandonada, operacionEnCurso, aceptado_con_reparos, resolución número 0, sin trámite, codigo null, autorizada fuera de Boletéame, migración 0009, tg_resolucion_autoriza_produccion, resolución de producción, empresa_autorizada, autorizacionExterna, ad_empresa1, ad_empresa2, Actualización de datos del contribuyente, representante legal, no está autorizado para operar en esta modalidad, verificar_autorizacion, ConsultaAutorizacion, situación tributaria de terceros, STC, stc/noauthz, getConsultaData, timbrajes, documentos autorizados, reCAPTCHA, SituacionTributaria, Fase 6, folios, migración 0011, anular_folios, cola completa, trg_20_caf_sin_traslape, 23P01, revisión con el SII, simulada, TransporteSinTimbrar, of_genera_folio, revisionId, folios.por_agotarse, Idempotency-Key, denominador, folio asignado sin documento, política alta, subirCaf, RSAPK, Fase 7, emisión, emitirDocumento, FABRICA_REST_EMISION, FABRICAS_SII.rest, documentoId, doble clic, borradorId, clave_idempotencia, sessionStorage, Ya la revisé, esFolioAnulado, INTENTOS_FOLIO, PDF417, bwip-js, bwip-js/node, binarytext, pdfkit, serverExternalPackages, AFM, ted_xml, latin1, instructivo de representación impresa, enlaceDocumento, uso_mensual.envios, Fase 8, seguimiento, ejecutarSeguimiento, consultarEnvio, consultar_envio, server/sii/clientes.ts, backoff, filtroPorConsultar, inconsistente, lista blanca, ESTADOS_CONOCIDOS, -11, RPR, ErrorTokenSoap, QueryEstUp, detalleIncompleto, orden de escritura, documento.aceptado falso, ya_final, cerrarAbandonadas, envio_sin_cerrar, Ya lo revisé, notificaciones, reclamar_notificacion, migración 0013, migración 0014, pg_cron, cron_token, CRON_SECRET, PRESUPUESTO_MS, LIMITE_MS]
related: ["08-esquema-supabase/solucion-de-problemas.md", "02-guias/certificacion-empresa.md", "02-guias/folios-caf.md", "01-fundamentos/ambientes-y-credenciales.md", "04-objetos/objetos-empresas-y-credenciales.md", "08-esquema-supabase/vault-y-secretos.md", "01-fundamentos/errores-y-resultados.md", "01-fundamentos/autenticacion-sii.md", "09-libreria/backend-service-role.md", "02-guias/emision-boletas.md", "02-guias/seguimiento-envios.md"]
source: ["supabase_saas_sii.sql", "certificacion-node/docs/solucion-de-problemas.md", "supabase/migrations/0005_certificados_resoluciones.sql", "apps/web/src/server/certificados/", "apps/web/src/lib/sentry/depurar.ts", "supabase/migrations/0006_realtime_operaciones.sql", "supabase/migrations/0007_bloqueos_sii.sql", "apps/web/src/server/sii/", "supabase/migrations/0008_certificacion.sql", "supabase/migrations/0009_autorizacion_externa.sql", "apps/web/src/server/certificacion/", "apps/web/src/app/[org]/certificacion/", "supabase/migrations/0011_folios.sql", "apps/web/src/server/folios/", "apps/web/src/app/[org]/folios/", "apps/web/src/server/emision/", "apps/web/src/server/pdf/", "apps/web/src/app/[org]/emitir/", "apps/web/next.config.ts", "apps/web/src/server/seguimiento/", "apps/web/src/server/alertas/", "apps/web/src/server/documentos/", "supabase/migrations/0013_notificaciones.sql", "supabase/migrations/0014_cron.sql"]
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
  La vista de folios (Fase 6) deshabilita los botones mientras hay una acción pendiente,
  pero eso no es lo que evita el doble timbraje.
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
  documento (`envios.incierto`; el documento queda `incierto` y no se puede reemitir con su
  `borradorId`) y, en la pantalla, por sesión del navegador
  ([Fase 7](#emisión-de-boletas-fase-7)). Solo `solicitar_folios`, `postular` y `declarar`
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
  la sugerencia `--folio-inicial`. No se timbró nada. La Fase 6 lo dejó en `rechazo_sii` y
  la solicitud en `rechazada`; lo que cambia la UI es que muestra el campo «Folio inicial»
  con el sugerido (`requiere.folioInicial`). Lo mismo pasa con `SesionCaducaError`
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

### Empresa autorizada fuera de Boletéame (migración 0009)

- **El SII responde «sin trámite» a una empresa ya autorizada.** A
  `obtenerEstadoAutorizaEmp` una empresa certificada fuera de Boletéame (con la CLI, otro
  proveedor o por su cuenta) no le responde P91 sino `codigo: null`, lo mismo que a una que
  nunca postuló (o cuyo titular del certificado no la representa). Comprobado el
  2026-11-13 con la única empresa de producción, certificada con la librería el
  2026-11-06. El asistente no lo puede distinguir solo: antes quedaba en `borrador`
  invitando a postular (lo que la devolvería a certificación), el candado «P91 no descarga
  set» no la protegía (mira P91) y `empresas.autorizada_produccion` seguía en `false`, así
  que no podía emitir en producción.
- **Cómo lo resuelve la app** (decisión del usuario 2026-11-13): registrar la resolución de
  **producción** vigente equivale a declarar que la empresa ya está autorizada. El trigger
  `tg_resolucion_autoriza_produccion` (after insert or update en `resoluciones`, `security
  definer`) marca `autorizada_produccion = true` y `autorizada_en = coalesce(…, now())`,
  filtrando por empresa y organización; nunca la desmarca. Si la resolución es falsa, el
  SII rechaza igual los envíos de producción. Un authenticated sigue sin poder poner la
  columna a mano (`tg_proteger_autorizacion`): pasa porque el trigger es de `postgres`.
- **Mientras la 0009 no esté aplicada**, registrar la resolución de producción **no**
  autoriza la empresa: el asistente sigue mostrando los pasos. El candado del backend y la
  vista sí están desplegados con el código y miran la columna, así que funcionan apenas la
  columna cambie ([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0009)).
- **El candado corre antes de todo.** Los seis pasos ⚠️ llaman a
  `cargarEmpresaPorCertificar` en la validación previa (también en el ensayo): con la
  empresa autorizada (por P91 o por resolución) responden `motivo: 'empresa_autorizada'`
  sin salir al SII ni dejar fila en `operaciones_sii`. Las consultas de solo lectura
  (`consultarEstadoDeclaracion`, `consultarEstadoSet`) no tienen candado.
- **`autorizacionExterna` se deduce, no se guarda.** Es «empresa autorizada y el proceso no
  está en `autorizada`». Si una empresa registró su resolución de producción y después
  consulta el estado y el SII responde P91, el proceso pasa a `autorizada` y la vista deja
  de mostrarla como externa (se ve como autorizada por P91, que también es cierto).
- **Consultar el estado puede crear el proceso.** La consulta está también en el paso 1 y
  funciona sin proceso (no depende de la 0009): lo crea en `borrador` con service_role solo después de que
  el SII respondió (una falla no deja fila). El proceso creado así no tiene datos de
  postulación: el paso 1 sigue pidiendo guardarlos antes de postular.

### Datos de la empresa autorizada en el SII (`ad_empresa`)

Validado en producción el 2026-11-13, en solo lectura y con el certificado del piloto. Lo
lee `ConsultaAutorizacion` de la librería y lo usa `verificarAutorizacion` de la app
([guía](../02-guias/certificacion-empresa.md#verificar-la-autorización-en-el-sii)).

- **Hay una página del SII que sí distingue «autorizada» de «nunca postuló».** El asistente
  «Actualización de datos del contribuyente» (`palena.sii.cl/cvc_cgi/dte/ad_empresa1`, con
  `RUT_EMP` y `DV_EMP` → `POST ad_empresa2`, misma sesión AUT2000 que los folios) muestra
  la fecha de autorización, la fecha y el número de la resolución (80 del 22-08-2014 para
  el piloto, autorizado el 06-11-2026), además del nombre del software, tres correos y la
  URL.
- **Solo responde si el titular del certificado es representante legal.** El SII revisa
  primero la representación y después la autorización. A un no representante le responde
  siempre «Usted no está registrado en la empresa Rut … como Representante Legal…», esté
  autorizada la empresa o no (comprobado con 90749000-9, que lo está, y con 11111111-1 y
  12345678-5, que no). No sirve para consultar cualquier RUT, y el representante
  electrónico de `empresa_certificados` no basta.
- **«No está autorizado para operar en esta modalidad»** salió solo con el RUT del titular y
  un DV erróneo (20630500-3). Falta comprobarlo con una empresa real, representada y sin
  autorizar.
- **«Esta modalidad» es software de mercado, no necesariamente boleta.** Falta comprobar
  qué responde para una empresa certificada solo para factura: podría darla por autorizada
  para boletas.
- **`ad_empresa2` trae un formulario que actualiza datos** (botones `MOD_EMP` / `MOD_USU`,
  campos ocultos `ORDEN`, `PAGINA`, `RUT_EMP`, `DV_EMP`). La consulta nunca lo envía: solo
  lee la página.
- **La página trae datos personales.** No se guardan correos, URL ni nombre del software, y
  el HTML no va a logs, Sentry ni `operaciones_sii.detalle`.
- **Es latin1 con entidades HTML** (`Raz&oacute;n Social`, `Fecha Autorizaci&oacute;n`):
  hay que decodificarla antes de comparar textos. Las fechas vienen como `dd-mm-aaaa`.
- **La resolución viene en una tabla de dos columnas, no en campos.** Filas «Rut», «Razón
  Social», «Fecha Autorización», «Fecha Resolución», «Resolución» y los campos editables con
  `(*)` (software, correos, URL). La librería lee solo las cinco primeras.
- **Fecha de autorización.** `registrar_resolucion` dispara el trigger de la 0009, que pone
  `autorizada_en = now()`; la app la corrige después a la fecha del SII a medianoche de Chile
  (como se fijó a mano la del piloto), solo si la empresa no estaba autorizada.
- **Otra sesión y otro bloqueo.** La consulta usa la sesión AUT2000 de producción del
  certificado (`sesiones_sii` con `ambiente = 'produccion'`) y el bloqueo de producción, no
  los de certificación: comparten el freno de re-login del SII, pero no la sesión.

### Situación tributaria de terceros (STC, fuente de apoyo)

Validado el 2026-11-13 con 2 consultas públicas. Lo lee `SituacionTributaria` de la
librería y lo usa `verificarAutorizacion` de la app como apoyo del mensaje.

- **«Documentos autorizados» no es lo que la empresa puede emitir.** La tabla sale del
  campo `timbrajes` de `POST www2.sii.cl/app/stc/recurso/v1/consulta/getConsultaData/`
  (`{ rut, dv, reAction: "consultaSTC", reToken }`): es el historial de timbraje. Hay una
  fila por tipo con folios timbrados alguna vez, incluidos los de papel. El piloto
  (20630500-2) solo muestra `0039 Boleta Electronica`, aunque también está autorizado para
  la 41: nunca timbró boletas exentas.
- **La certificación de boleta no habilita factura.** Es lo que se esperaba ver en el STC del
  piloto, pero la factura (33, 34, 56, 61…) tiene su propia certificación (H3 del plan,
  Fase 14), y además solo aparecería después de timbrar folios de ese tipo.
- **Evidencia en un solo sentido.** `0039`/`0041` prueban autorización para boletas, para
  cualquier RUT y sin certificado. Que falten no prueba nada (empresa recién certificada).
- **Formato crudo:** `codigo` con ceros a la izquierda (`"0039"`), `descripcion` con espacios
  de relleno, `fechaTimbraje` es **solo el año** del último timbraje, `folioFinal` es texto
  con espacios a la izquierda (`"         5"`) y `folionicial` (así, con la errata) viene
  `null`.
- **reCAPTCHA Enterprise v3 apagado, por ahora.** `GET /app/stc/recurso/v1/recaptcha/key`
  respondía `{ "enable": false, "key": … }` y con eso la SPA manda `reToken: " "`. Si el SII
  lo enciende, la consulta se omite (`stc = 'no_disponible'`): no se intenta resolver el
  captcha y nada depende de ella.
- **La respuesta trae datos de terceros** (nombre, giros, observaciones, actividades). Solo
  se usa `timbrajes`; el resto no se guarda ni se registra.

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

## Folios (CAF) (Fase 6)

### Migración 0011

- **Aplicada el 2026-11-15** (verificación 18/18, simulación 27/27; antes de aplicarla, la
  verificación daba 3/18). En una base sin ella, anular folios falla con `PGRST202` («No
  pudimos anular los folios») y un CAF **timbrado** que se cruza con otro entra (la carga
  manual igual lo rechaza en la app)
  ([despliegue](../08-esquema-supabase/despliegue.md#fase-6-migración-0011)).
- **`anular_folios` sí la ejecuta `authenticated`.** A diferencia de `registrar_caf`, la
  llama el administrador con su sesión y la función revisa el rol por dentro. *Advisors*
  la listará en `authenticated_security_definer_function_executable`: es esperado.
- **`folios_anulados` no se escribe con la sesión.** Hasta la 0011, la política `alta`
  (0001) dejaba a un administrador insertar directo, saltándose las validaciones de la RPC
  (rango, documentos usados, cola completa), el bloqueo del CAF y su cierre. La 0011 la
  borra y revoca a `authenticated` `insert`, `update`, `delete` y `truncate`: con la
  sesión, un `insert` da `42501 permission denied for table folios_anulados`. Se escribe
  solo con `anular_folios` o con `service_role` (el set de pruebas, `envio-set.ts`).
- **`cafs` y `folios_anulados` en Realtime (0011).** Una carga de CAF o una anulación hecha
  por otro administrador (o por el backend) llega en vivo, con el mismo RLS de lectura
  (`es_miembro`). `cafs` no expone el CAF: el XML con `<RSASK>` está en Vault y la fila
  solo trae `caf_secret_id`, un uuid que sin `service_role` no abre nada. Sin la 0011
  aplicada, la suscripción a esas dos tablas no recibe nada (sin error).

### Anulación

- **La cola se anula completa o nada.** `asignar_folio` avanza de uno en uno sin mirar
  `folios_anulados`: si se anularan folios sueltos por encima de `siguiente_folio`, después
  los entregaría igual. Por eso un rango que llega a `siguiente_folio` tiene que ir de
  `siguiente_folio` (o antes) hasta `folio_hasta`, y deja el CAF `anulado`. Folios sueltos
  solo bajo `siguiente_folio`.
- **Un CAF de otra organización da `P0002`, no `42501`.** Igual que uno inexistente: no se
  revela que existe. El `42501` es para un miembro emisor o lector.
- **Folio asignado sin documento todavía: se puede anular, pero el documento ya no entra
  (migración 0012, aplicada el 2026-11-15).** La RPC solo ve documentos insertados: si la
  emisión asigna el folio y el documento entra después, un administrador puede anularlo
  entre medio. Con la 0012, `tg_validar_documento` rechaza con `23514` («El folio N está
  anulado…», pista: pedir otro folio) el documento que fija un folio anulado, al
  insertarlo o al ponerle el folio a un borrador. La emisión de la Fase 7 trata ese `23514`
  pidiendo otro folio, hasta 3 intentos ([emisión](#emisión-de-boletas-fase-7)). El trigger lee el CAF con `for key share` **antes** de
  mirar `folios_anulados`, así se serializa con el `for update` de `anular_folios`: gane
  quien gane, la otra transacción ve lo que confirmó la primera (en READ COMMITTED cada
  sentencia toma su propia foto). Un `update` que no cambia folio ni CAF (el
  `estado = 'anulado'` de `envio-set.ts`) no se revisa. Sin la 0012 aplicada, el riesgo
  sigue abierto ([triggers](../08-esquema-supabase/triggers-y-logica.md#tg_validar_documento-migración-0012)).
- **Repetir no falla.** `on conflict do nothing` y devuelve 0; la UI lo muestra como «Esos
  folios ya estaban anulados» (`info`), no como error.

### Traslapes

- **Un traslape en el timbrado queda `incierto`, sin proponer subir el CAF.** Si el SII
  timbra un CAF que se cruza con uno ya cargado (lo normal es que el cargado esté mal),
  `registrar_caf` falla con `23P01` y la solicitud queda `incierta`. Subir ese CAF también
  fallaría («El CAF se cruza con otro ya cargado») mientras exista el otro, así que el
  mensaje es propio («Se timbraron los folios D a H, pero chocan con el CAF de los folios
  X a Y que ya estaba cargado… revisa los dos CAF… y escríbenos a soporte») y la operación
  guarda `detalle.incierto_motivo = 'traslape'` con `traslape_desde`/`traslape_hasta` (solo
  rangos). Con eso la vista no ofrece «Subir el CAF». Hay que aclarar cuál de los dos es el
  correcto antes de marcarla como revisada. Cualquier otro error de `registrar_caf` sigue
  con el mensaje de «súbelo en Folios (CAF)».
- **El trigger mira CAF en cualquier estado.** Un CAF `agotado` o `anulado` sigue
  ocupando su rango.

### Solicitud

- **La revisión con el SII sí sale al SII, con `confirmada = false`.** Es la primera
  operación de la app con `confirmada: false` que llega a la red (recorre el asistente
  `of_*` con la sesión AUT2000 y el bloqueo del certificado). `ejecutarOperacion` no vigila
  las no confirmadas (ni el índice único de la 0007 las cubre), así que `solicitarFolios`
  le aplica los candados ANTES de abrir la operación: `getUser()` (como las ⚠️) y
  `revisarOperacionPendiente`, el mismo control previo de `ejecutarOperacion` exportado (no
  una copia): con un `incierto` sin revisar o una confirmada `en_curso` reciente de
  `solicitar_folios` en la misma empresa y ambiente, no sale. Si se agrega otra operación
  no confirmada que llegue a la red, necesita lo mismo.
- **`TransporteSinTimbrar` es una lista permitida, no una lista negra.** En el host del
  portal del ambiente solo pasan `of_solicita_folios`, `of_solicita_folios_dcto` y
  `of_confirma_folio` bajo `/cvc_cgi/dte/`; todo lo demás de ese host se corta
  (`of_genera_folio`, `of_genera_archivo`, rutas nuevas). Los hosts de login no se tocan.
  La CLI solo corta `of_genera_folio`: si el SII renombrara ese paso, la CLI timbraría y la
  app no (la revisión falla). Si el SII agrega un paso intermedio nuevo antes de la
  confirmación, la revisión empieza a fallar y hay que agregarlo a `PASOS_REVISION`. Si
  llegara un CAF, la solicitud queda `incierta` («La revisión obtuvo un CAF…»).
- **La revisión obligatoria la exige el servidor, no solo la UI.** Un timbraje de
  producción sin `revisionId` válido (misma empresa, ambiente, tipo, cantidad y folio
  inicial; `simulada`; menos de 30 min; sin otra confirmada del mismo tipo después) se
  rechaza antes de abrir la operación. La revisión no reserva el rango: el SII puede
  asignar otro al timbrar (la app lo avisa).
- **El plan sale de una sola fuente: `plan_vigente()`.** El servidor y la vista usan
  `planPermiteProduccion` (`server/folios/plan.ts`). `authenticated` no puede ejecutar
  `plan_vigente()` (no está en sus grants de la 0001), así que `leerFolios` la llama con
  service_role filtrando por la organización de la membresía; el resto de la vista sigue
  con el cliente de sesión. Si la llamada falla, la vista no bloquea
  (`planPermiteProduccion: null`) y decide el servidor.
- **El mensaje de «CAF sin guardar» cambió también para el set.** Ahora dice «…súbelo en
  Folios (CAF)» en vez de «escríbenos a soporte», y la solicitud queda `incierta` con el
  rango del CAF (antes, sin rango).
- **La carga manual exige empresa activa**, con el mismo mensaje que pedir folios («La
  empresa está desactivada»). No es una operación del SII: no deja fila en
  `operaciones_sii`.

### Alerta `folios.por_agotarse`

- **Solo al cruzar.** Avisa al pasar de `sello` a `aviso` (15 %) o al llegar a cero, no
  mientras se está bajo el umbral. No usa la tabla `notificaciones` (Fase 8, migración
  0013, solo para rechazos, inciertos y certificados): repetir la misma alerta la frena la
  `Idempotency-Key` de Resend
  (`folios.por_agotarse/<empresa>/<ambiente>/<tipo>/<CAF>/<15|agotado>`), que dura 24 h.
  El webhook no tiene esa protección.
- **El denominador es el tamaño de los CAF activos con folios libres**, no el último CAF
  ni todos los históricos. Cargar un CAF nuevo sube la proporción; si después vuelve a
  bajar del 15 % es un cruce nuevo (con otro CAF en uso, otra clave).
- **Anular folios bajo `siguiente_folio` no cambia la disponibilidad**, así que no dispara
  la alerta; anular la cola sí.
- **La disparan la anulación de una cola y la emisión.** Desde la Fase 7, cada boleta
  emitida con `ok` llama a `alertaDespuesDeAsignar` con el folio usado (fuera de la
  operación: si falla, no cambia el `ok`). `enviarSet` (Fase 5) no la llama, y una emisión
  que termina en error tampoco, aunque haya consumido o anulado folios.

## Emisión de boletas (Fase 7)

Detalle en la [guía de emisión](../02-guias/emision-boletas.md).

### Decisiones

- **Cliente REST propio, con ambiente.** `deps.sii.rest` (`FABRICAS_SII.rest` de
  `server/certificacion/dependencias.ts`) crea el `ClienteBoletaRest` **siempre en
  certificación** (era para el set de pruebas). La emisión usa su propia fábrica,
  `FABRICA_REST_EMISION` (`server/emision/dependencias.ts`, inyectable como `rest`), que
  recibe el ambiente del borrador; desde la Fase 8 delega en `clienteBoletaRest` de
  `server/sii/clientes.ts`, compartido con el seguimiento. Si alguien la cambia por la de certificación, las
  boletas de producción saldrían a `apicert`/`pangal` con el certificado y los folios de
  producción.
- **`ejecutarOperacion` directo, no `ejecutar` de certificación.** El helper `ejecutar` de
  `server/certificacion/comun.ts` no pasa `documentoId`; la emisión llama a
  `ejecutarOperacion` con `documentoId`, `ambiente` y `canal: 'rest'` para que la fila de
  `operaciones_sii` quede enlazada a su documento (y a su envío con `enlazarOperacion`).
- **Token antes del folio.** `obtenerToken` va antes de `asignar_folio`: una falla del
  token no consume folios. Lo que falla después de asignar y antes de enviar anula el folio
  (`folios_anulados`) y deja el documento en `borrador`.
- **Un solo `update` a `firmado`.** Folio, `caf_id`, TED, rutas, montos del DTE,
  `envio_id` y `estado = 'firmado'` van en un solo `update` con `.eq('estado',
  'borrador')`: el documento nunca queda con folio a medias, y 0 filas significa que el
  borrador se borró o se emitió en paralelo (folio anulado, `uso`).
- **Los montos del documento salen del DTE**, no de `calcularTotales`: `leerDte` lee
  `<MntNeto>`, `<MntExe>`, `<IVA>` y `<MntTotal>` de lo que escribió la librería. Si la
  paridad de `calcularTotales` se rompiera, el borrador mostraría otra cifra, pero la boleta
  emitida queda con la de la librería (y `emision.test.ts` falla).
- **No usa `conBloqueoCertificado`.** El REST no abre sesiones AUT2000 y `asignar_folio` ya
  es atómico (`for update` sobre el CAF).

### Trampas

- **Doble clic sin `borradorId` emitiría dos boletas.** El panel no usa
  `documentos.clave_idempotencia` (es de la API, Fase 11): cada llamada a `emitir` sin
  `borradorId` inserta un documento nuevo y lo emite con otro folio. Lo único que lo evita
  es la pantalla (la referencia `corriendo` y el `Dialogo` en `cargando`). Con `borradorId`
  la segunda llamada choca con el borrador ya emitido («Este borrador ya se emitió» o
  «…cambió mientras lo emitíamos», con su folio anulado). Un cliente nuevo de
  `emitirDocumento` (API, script) tiene que traer su propia idempotencia.
- **El reintento después de una falla crea otro borrador.** La emisión guarda el borrador
  antes de la operación; si falla sin dejar documento con folio (token, falla antes de
  enviar, cuota…), el resultado `error` no trae el id del borrador recién creado, así que
  la pantalla sigue sin `borradorId` y el reintento inserta otro. El anterior queda en
  «Borradores» (se puede borrar).
- **El bloqueo de un incierto: en la UI por sesión del navegador, en el servidor por
  documento.** La pantalla bloquea emitir con `incierta` guardado en `sessionStorage` (por
  pestaña) hasta «Ya la revisé»; otra pestaña, otro navegador u otro usuario no lo ven. El
  servidor solo impide reemitir **ese** documento (ya no está en `borrador`):
  `ejecutarOperacion` no bloquea `emitir` por un `incierto` anterior
  (`OPERACIONES_EFECTO_GLOBAL` no la incluye), así que una boleta nueva por la misma venta
  sí sale. Desde la Fase 8 los inciertos aparecen en el Tablero, llegan por correo y se
  marcan con «Ya lo revisé» en la página del envío
  ([seguimiento](../02-guias/seguimiento-envios.md#envíos-inciertos-y-ya-lo-revisé)).
- **Un `23514` que no es de folio anulado es una falla genérica.** `esFolioAnulado` exige
  `23514` **y** «anulad» en el mensaje (el de `tg_validar_documento` de la 0012). Un
  `23514` de un `CHECK` de `documentos` (p. ej. `mnt_total = mnt_neto + iva + mnt_exe`) no
  se reintenta: el folio se anula y el usuario ve el mensaje genérico. Si se cambia el texto
  de la excepción en la base, el reintento deja de funcionar.
- **Cada intento deja su envío y sus XML.** Con un `23514` de folio anulado se arma de
  nuevo con otro folio: el intento anterior deja su fila en `envios` (con `error`, sin
  Track ID) y sus dos XML en Storage. Lo mismo cualquier falla antes de enviar: los
  archivos no se borran. Y como `trg_60_contar_uso` suma `uso_mensual.envios` al
  **insertar** el envío, ese contador cuenta también envíos que nunca salieron.
- **El PDF guardado no se regenera si cambia la empresa.** El PDF se genera al emitir con
  los datos de ese momento y se sobrescribe solo si falta. Si después cambia la razón
  social, el giro o la dirección, el PDF guardado sigue con los datos viejos (lo correcto:
  son los del DTE). Pero un PDF que se **regenera** porque faltaba (`enlaceDocumento`) usa
  los datos **actuales** de la empresa, que pueden no calzar con el XML firmado.
- **Los parámetros del timbre PDF417 no están contrastados con el documento oficial.**
  Nivel de seguridad 5, Y:X = 3, X ≥ 0,0067", área entre 2 × 5 y 4 × 9 cm y las leyendas
  salen del conocimiento del instructivo de representación impresa del SII, que **no está
  en el repositorio**. Conviene contrastarlos con el instructivo oficial antes de imprimir
  boletas reales. Lo que sí está probado es que el código decodifica a los bytes exactos del
  TED y que su `<FRMT>` verifica.
- **El TED va como texto `latin1`, no como Unicode.** `leerDte` toma el `<TED>` de
  `dte.toString('latin1')` y así se guarda en `documentos.ted_xml`; el PDF417 lo codifica
  con `binarytext: true`. Decodificarlo como UTF-8 o ISO-8859-1 «bien» antes de pasarlo
  cambia los bytes y el timbre deja de verificar (`validarTed` rechaza un carácter sobre
  U+00FF, pero no detecta una doble codificación que quede bajo U+00FF).
- **`pdfkit` y `bwip-js` van en `serverExternalPackages`** (`next.config.ts`). pdfkit lee
  sus fuentes AFM con `fs` desde su propia carpeta (`__dirname/data/*.afm`): empaquetado,
  esa ruta no existe y el PDF falla en Vercel aunque las pruebas pasen. bwip-js va aparte
  por tamaño y porque tiene su build propio para Node.
- **Se importa `bwip-js/node`, no `bwip-js`**, por los tipos (es la entrada de Node, con
  `toBuffer`). Las opciones propias del PDF417 (`eclevel`, `rowmult`, `columns`) no
  están en los tipos de bwip-js y se declaran a mano (`OpcionesBwipPdf417`).
- **Un borrador de producción no se guarda sin autorización.** `tg_validar_documento`
  revisa la autorización y el plan en **todo** `insert` de producción, también de un
  borrador sin folio (`P0001`). La UI lo anticipa (`bloqueoGuardado`) y el servidor lo
  traduce; con un `update` de un borrador ya guardado no se revisa.
- **La cuota se revisa dos veces.** `prepararEmision` compara `uso_mensual` con
  `max_boletas_mes` antes de asignar folio; si dos emisiones pasan juntas ese control, el
  trigger `tg_contar_uso_documento` rechaza la que se pasa (`P0001`) en el `update` a
  `firmado` y ese folio se anula.
- **Track ID con incierto: el `check` de `envios` manda.** `envios` no admite `incierto =
  true` con `track_id`: si el Track ID quedó guardado y falló el `update` del documento, el
  envío no se marca incierto (el documento puede quedar `firmado`) aunque la operación diga
  `incierto`.

## Seguimiento de envíos (Fase 8)

Detalle en la [guía de seguimiento](../02-guias/seguimiento-envios.md). La migración
`0013_notificaciones` y `0014_cron` están **aplicadas** (2026-11-17; la 0014 después del
deploy `3ade4c9`).

### Realtime en una carga completa (bug visto en Production, 2026-11-17)

- **Síntoma:** con `/servicio/envios/<id>` abierto, el cron dejó el envío en EPR y el
  documento `aceptado`, pero la página siguió en «Enviado» sin mostrar ningún aviso.
  `realtime.subscription` no tenía filas.
- **Causa:** en una carga completa, el `useEffect` suscribía el canal antes de que el cliente
  del navegador leyera la sesión de las cookies. El `phx_join` salía sin `access_token` y
  Realtime lo trataba como `anon`. Como `anon` no tiene SELECT sobre `envios`,
  `realtime.subscription_check_filters` no encontraba la columna (usa `has_column_privilege`
  con el rol de los claims) y rechazaba **toda** la suscripción del canal con
  «invalid column for filter id». Cuando el JWT llegaba después (`INITIAL_SESSION` →
  `realtime.setAuth`), los `postgres_changes` no se reintentaban. El error llega como
  mensaje `system` con `status: 'error'`, no como `CHANNEL_ERROR`, así que la UI no avisaba.
  Navegando dentro de la app sí funcionaba, porque la sesión ya estaba cargada.
- **Arreglo:** `lib/supabase/realtime.ts` (`suscribirEnVivo`) espera
  `supabase.realtime.setAuth()` (sin argumento usa el callback de supabase-js, que espera
  `auth.getSession()`) antes de crear el canal, y trata un `system` con error como
  desconexión. Lo usan los tres `EnVivo` (Certificación, Folios y Documentos/Envíos), que
  tenían el mismo defecto desde las Fases 5 y 6.
- **Cómo diagnosticarlo:** que `realtime.subscription` esté vacía con la página abierta es la
  señal. Para ver el `phx_join` de la carga inicial, abre la página en un iframe del mismo
  origen e intercepta su `WebSocket` antes de que hidrate (el registro de consola y red de
  la extensión no captura los frames).

### Decisiones

- **Una operación por grupo, no por consulta.** El cron abre una operación `seguimiento` por
  organización + empresa + ambiente + canal, con los conteos en `detalle`; el detalle de cada
  envío queda en `consultas_envio`. Una por consulta serían hasta 28.800 filas al día en
  `operaciones_sii`. La consulta del panel sí es una `consultar_envio` por envío, con
  `envio_id` y el usuario.
- **Un token por grupo, una renovación.** El canal separa los grupos porque el token REST y
  el DTEWS son distintos. Si el SII rechaza el token (401 en REST; HTTP 200 con un `ESTADO` de
  token en QueryEstUp), se pide otro **una vez**; otro rechazo posterga el resto del grupo.
- **Lotes de 100 y presupuesto de tiempo.** Hasta 100 envíos por corrida; antes de cada paso
  que sale al SII se exige que su peor caso (45 s por petición) termine antes del segundo
  280 de los 300 de `maxDuration`. Lo que no cabe queda en `postergados`.
- **Backoff sin migración**, por `envios.consultas` (que cuenta también los intentos
  fallidos): 4, 15 y 60 minutos y 6 horas por tramos (0–11, 12–23, 24–47, 48 o más), y una
  vez al día para los envíos con más de 7 días. Va como un `or()` de PostgREST en la
  consulta, no filtrando en JS después del `limit` (eso dejaba con hambre a los envíos
  nuevos).
- **`inconsistente` se sigue consultando** (el cron lo lee aparte de
  `v_envios_por_consultar`, que no lo trae, y el panel lo deja consultar): el SII puede
  corregir sus cifras y no hay otra forma de cerrarlo.
- **Lista blanca de estados.** Solo se guardan los 10 códigos de `estados_sii`. Un código
  desconocido es una falla de esa consulta y `estado_sii` no se toca.
- **Orden de escritura: estadísticas → rechazos → envío → bitácora.** Ver la trampa de
  abajo sobre webhooks falsos.
- **«Ya lo revisé» sin migración**: reutiliza `marcarInciertaRevisada` sobre las
  operaciones inciertas enlazadas al envío (`operaciones_sii.detalle.revisada_en`). El envío y
  sus documentos siguen `incierto`.
- **Alertas: candidatos en la base, no con `.limit()`**. Las funciones de la 0013 excluyen
  lo ya avisado y reparten por turnos entre organizaciones.
- **Los jobs leen el Bearer de Vault en cada corrida**; el secreto nunca queda en
  `cron.job.command`.

### Trampas

- **El orden inverso encola webhooks `documento.aceptado` falsos.** Si se guarda el envío
  (`EPR` con rechazos) antes que `envio_rechazos`, `trg_50_envio_actualizado` sincroniza los
  documentos sin rechazos que mirar, los deja **todos** `aceptado` y `tg_evento_documento`
  encola `documento.aceptado`; después el rechazo los pasa a `rechazado`. El estado final
  queda bien, pero el webhook ya salió. Se comprobó en PGlite. `guardarRespuesta` escribe
  los rechazos primero: el trigger de `envio_rechazos` sincroniza con el envío todavía en
  proceso (documentos `enviado`) y el `update` del envío hace la sincronización final.
- **Un EPR con rechazos sin detalle por documento dejaría aceptadas boletas rechazadas.**
  `sincronizar_documentos_envio` solo mira `envio_rechazos`. QueryEstUp (SOAP) nunca trae el
  detalle, y el REST podría traerlo incompleto. Por eso un `EPR` con más rechazos o reparos en
  los contadores que en el detalle no se guarda (`detalleIncompleto`): queda la consulta con
  la nota y el envío sigue como estaba, para revisarlo en el portal del SII. Un envío SOAP con
  rechazos **nunca** cierra solo: se consulta con *backoff* hasta los 7 días y después una vez
  al día.
- **`clasificar_envio` da `rechazado` a cualquier código desconocido.** QueryEstUp responde
  `-11` (sin glosa) a un envío que todavía no registra y a un Track ID de la API REST, `RPR`
  a un RCOF, y códigos de error con HTTP 200. Guardarlos dejaría el envío y sus documentos
  `rechazado`. La lista blanca (`ESTADOS_CONOCIDOS`) lo evita.
- **El token DTEWS vencido no da 401.** QueryEstUp contesta HTTP 200 con un `ESTADO` de
  error. `ErrorTokenSoap` lo reconoce por `001`–`003` o por «token» en la glosa: heurística
  sin contrastar con el SII. Si se equivoca hacia un lado, pide un token de más; hacia el
  otro, ese `ESTADO` cae fuera de la lista blanca y se reintenta con el *backoff*.
- **No pisar estados finales.** El cron y el panel pueden consultar el mismo envío a la vez.
  El `update` del envío lleva `clasificacion not in (aceptado, aceptado_con_reparos,
  rechazado)` y, si no devuelve fila, la respuesta solo va a la bitácora. Además, solo un
  `EPR` borra rechazos guardados: una respuesta en proceso que llegue tarde no borra el
  detalle de un `EPR`.
- **`consultas + 1` no es atómico.** Se calcula con el valor leído: dos consultas
  simultáneas pueden contar una. Solo afecta al *backoff*.
- **Las operaciones del seguimiento cortadas por Vercel quedan `en_curso`.** No bloquean nada
  (son de lectura), pero ensucian la auditoría. `cerrarAbandonadas` las cierra como `error`
  (`detalle = { abandonada: true }`, que reemplaza el `detalle` anterior) al empezar cada
  corrida, pasados 15 minutos.
- **El aviso `envio_sin_cerrar` no sale en producción.** `avisarSinCerrar` llama a
  `deps.operacion.registrar?.(…)`, pero `resolverDependenciasSeguimiento` no pone
  `registrar` (solo el reloj; el `registrarEnSentry` por defecto se resuelve dentro de
  `ejecutarOperacion`). Con las dependencias reales es `undefined` y el aviso se omite sin
  error; las pruebas lo ven porque inyectan el doble. Hallazgo de la documentación, sin
  corregir.
- **Un incierto sin operación enlazada no se puede marcar revisado.** «Ya lo revisé» busca
  las operaciones `incierto` o `en_curso` con ese `envio_id`. Si no hay (un envío incierto
  creado fuera de `emitirDocumento`), responde «No encontramos la operación…» y el envío
  sigue apareciendo en el Tablero.
- **«Ya lo revisé» no cambia el envío.** El documento sigue `incierto` en Documentos
  emitidos (filtro «Por verificar»); solo deja de salir en el Tablero. El correo de alerta ya
  salió y no se repite.
- **El Tablero muestra solo la empresa activa**, en los dos ambientes; los correos de
  inciertos cubren todas las empresas de la organización.
- **El cron también consulta el envío del set de pruebas.** `v_envios_por_consultar` no
  filtra por `proposito`, así que un envío `set_pruebas` en proceso se consulta y sus
  documentos se sincronizan solos. La etapa del proceso (`set_aceptado`) **no** avanza con
  eso: solo la mueve «Consultar estado» del asistente (`consultarEstadoSet`, que consulta
  aunque el envío ya esté final). Las alertas y el Tablero excluyen el set.
- **Cualquier miembro puede consultar el estado en el SII**, también un lector: es una
  lectura que no cambia la boleta, pero sí sale al SII y deja una operación
  `consultar_envio`. Lo frena la ventana de 30 s entre consultas del mismo envío.
- **Ventana de 48 h en las alertas.** Rechazos e inciertos se avisan solo si su
  `actualizado_en` es de las últimas 48 h: al estrenar las alertas no llegan correos viejos.
  Un envío incierto no se vuelve a tocar, así que si las alertas estuvieron caídas más de
  48 h ese aviso se pierde.
- **`notificaciones` la leen todos los miembros.** Solo lleva ids, empresa, ambiente, umbral
  y los correos de los administradores (que los miembros ya ven en `perfiles`). Nunca el
  cuerpo del correo ni la API key.
- **Sin la 0013, la ruta de alertas no envía nada.** Las funciones de candidatos y
  `reclamar_notificacion` no existen (`PGRST202`): cada categoría queda con error en el
  resumen y en Sentry. Aplicarla antes del deploy (se hizo el 2026-11-17).
- **`pnpm db:tipos` marca como no nulos los retornos de funciones.** Postgres no informa la
  nulabilidad de las columnas que devuelve una función (`returns table` o `setof`), así que
  el generador las tipa como `string` o `number` sin `null`. Con la 0013 eso dio 7 líneas
  distintas de lo agregado a mano en `server/supabase/tipos.ts`, en los retornos de
  `alertas_*` y `reclamar_notificacion`: `cn`, `dias_restantes`, `nombre_titular`,
  `rut_titular`, `envio_id`, `folio` y `grupo`. Se versionó lo generado (typecheck, pruebas de
  alertas y Biome en verde), pero esos campos pueden venir nulos en tiempo de ejecución:
  `server/alertas/` los sigue
  tratando como posiblemente nulos. No confiar en el tipo generado para esos campos ni
  «limpiar» esas comprobaciones.
- **La 0014 antes del deploy hace ruido.** Desde que se aplica, `pg_cron` llama a las rutas
  cada 5 y 10 minutos; sin el deploy responden 404. Sin `CRON_SECRET` en Vercel, 503, y
  también con uno de menos de 16 caracteres (`envCron()` lo trata como ausente, sin error).
  Con `cron_token` distinto de `CRON_SECRET`, 401. La 0014 se niega a correr sin `cron_token` en
  Vault (`55000`).
- **Horarios sincronizados a mano.** `HORARIO_SEGUIMIENTO` y `HORARIO_ALERTAS` tienen que
  coincidir con los jobs de la 0014 y con los *cron monitors* de Sentry, o el monitor avisará
  de corridas perdidas que no lo son.
- **El comentario de `maxDuration` en la ruta del seguimiento está desactualizado.** Dice
  «Ver `PRESUPUESTO_MS` en server/seguimiento/cron.ts: deja de empezar consultas a los
  240 s»; el código usa `LIMITE_MS` = 280 s y los peores casos de la
  [guía](../02-guias/seguimiento-envios.md#presupuesto-de-tiempo).
