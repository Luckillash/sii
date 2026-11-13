---
title: "Trampas conocidas"
description: "Comportamientos no obvios del SII, de la librería y del esquema."
keywords: [claves legadas, Legacy API keys are disabled, sesión revocada, getClaims, getUser, user_not_found, índice único parcial, predeterminado, vigente, fijar_certificado_predeterminado, registrar_resolucion, pfx_legacy, 3DES, RC2, otherName, 1.3.6.1.4.1.8321.1, serialNumber, RUT del titular, tokens_sii, huella, activa, desactivada, ISO-8859-1, comillas tipográficas, Word, server_action_form_data, "[Filtrado]", 42883, migración 0005]
related: ["08-esquema-supabase/solucion-de-problemas.md", "01-fundamentos/ambientes-y-credenciales.md", "04-objetos/objetos-empresas-y-credenciales.md", "08-esquema-supabase/vault-y-secretos.md"]
source: ["supabase_saas_sii.sql", "certificacion-node/docs/solucion-de-problemas.md", "supabase/migrations/0005_certificados_resoluciones.sql", "apps/web/src/server/certificados/", "apps/web/src/lib/sentry/depurar.ts"]
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
