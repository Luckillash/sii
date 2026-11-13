---
title: "Trampas conocidas"
description: "Comportamientos no obvios del SII, de la librería y del esquema."
keywords: [claves legadas, Legacy API keys are disabled, sesión revocada, getClaims, getUser, user_not_found, índice único parcial, predeterminado, vigente, fijar_certificado_predeterminado, registrar_resolucion, pfx_legacy, 3DES, RC2, otherName, 1.3.6.1.4.1.8321.1, serialNumber, RUT del titular, tokens_sii, huella, activa, desactivada, ISO-8859-1, comillas tipográficas, Word, server_action_form_data, "[Filtrado]", 42883, migración 0005, migración 0006, migración 0007, PGRST202, advisory lock, pg_try_advisory_xact_lock, arriendo, reentrante, BloqueoOcupadoError, ErrorBloqueo, maxDuration, en_curso, abandonada, marcarInciertaRevisada, ensayo, FolioInicialRequeridoError, SesionCaducaError, sanearTexto, token corto, content-type, charset, application/xml, caché por invocación, await using, crearCredenciales, huella_distinta]
related: ["08-esquema-supabase/solucion-de-problemas.md", "01-fundamentos/ambientes-y-credenciales.md", "04-objetos/objetos-empresas-y-credenciales.md", "08-esquema-supabase/vault-y-secretos.md", "01-fundamentos/errores-y-resultados.md", "01-fundamentos/autenticacion-sii.md", "09-libreria/backend-service-role.md"]
source: ["supabase_saas_sii.sql", "certificacion-node/docs/solucion-de-problemas.md", "supabase/migrations/0005_certificados_resoluciones.sql", "apps/web/src/server/certificados/", "apps/web/src/lib/sentry/depurar.ts", "supabase/migrations/0006_realtime_operaciones.sql", "supabase/migrations/0007_bloqueos_sii.sql", "apps/web/src/server/sii/"]
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

- **Las migraciones 0006 y 0007 todavía no están aplicadas en producción** (2026-11-13).
  Síntomas mientras falten: toda operación que use `conBloqueoCertificado` termina en
  `error` con mensaje genérico y en Sentry aparece `ErrorBloqueo` con el código de función
  inexistente (`PGRST202` por PostgREST; `42883` en SQL directo); una suscripción de Realtime a
  `operaciones_sii` o `solicitudes_folios` no recibe nada y **no da error**. Además,
  `tipos.ts` tiene `bloqueos_sii` y las dos RPC agregados a mano: regenerar con
  `pnpm db:tipos` después de aplicar y comparar
  ([despliegue](../08-esquema-supabase/despliegue.md#fase-4-migraciones-0006-y-0007-pendientes)).

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
  Mientras la 0007 no esté aplicada, el insert no choca y solo queda el control posterior.
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
