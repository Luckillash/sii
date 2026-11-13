---
title: "Esquema: Vault y secretos"
description: "Qué secretos hay, dónde van, cómo se guardan, leen y borran, y qué se cifra fuera de la base."
keywords: [Vault, vault.secrets, vault.decrypted_secrets, vault.create_secret, guardar_secreto, leer_secreto, registrar_certificado, tg_borrar_secretos, trg_borrar_secretos, pfx_secret_id, clave_secret_id, caf_secret_id, secreto_secret_id, cron_token, "certificado:<huella>:pfx", "certificado:<huella>:clave", depurar.ts, depurarEvento, beforeSend, beforeSendSpan, beforeBreadcrumb, server_action_form_data, "[Filtrado]", AES-256-GCM, SII_TOKENS_KEY, AAD, cifrado.ts]
related: ["01-fundamentos/ambientes-y-credenciales.md", "03-api-reference/rpc-backend.md", "04-objetos/objetos-empresas-y-credenciales.md", "02-guias/onboarding-organizacion.md"]
source: ["supabase_saas_sii.sql §6 §7 §14 §15", "supabase/migrations/0002_extensiones_cron.sql", "supabase/migrations/0005_certificados_resoluciones.sql", "apps/web/src/lib/sentry/depurar.ts", "apps/web/src/server/cifrado.ts", "PLAN-SAAS.md §2 §4.4 §4.8"]
---

# Esquema: Vault y secretos

> **Úsalo cuando:** manejas el .pfx, el CAF, tokens o secretos de webhook.

Regla general (PLAN-SAAS §2, principios 1 y 5): el navegador nunca recibe un .pfx, una
clave, un CAF ni un token, y ninguno de ellos aparece en mensajes, logs ni Sentry. Hay
dos lugares para guardar secretos, según quién tiene la llave:

| Dónde | Llave | Qué va |
|---|---|---|
| **Supabase Vault** (`vault.secrets`) | la administra Supabase | secretos que se guardan una vez y se leen al operar: .pfx, su clave, XML del CAF, secreto HMAC de webhooks, `cron_token` |
| **Columnas `bytea` cifradas en la app** | `SII_TOKENS_KEY` (variable de Vercel, *sensitive*), fuera de la base | credenciales de vida corta que se reescriben seguido: token del SII y cookies AUT2000 |

Lo que no se puede recuperar ni hace falta guardar (token de invitación, API keys) va
solo como hash sha256: `invitaciones.token_hash`, `api_keys.clave_hash`.

## Qué hay en Vault

| Secreto | Columna con el id | Cómo entra | Descripción en Vault | Fase |
|---|---|---|---|---|
| .pfx en base64 | `certificados.pfx_secret_id` | `registrar_certificado()` → `guardar_secreto()` | `certificado:<huella>:pfx` | 3 (0005 pendiente) |
| Clave del .pfx | `certificados.clave_secret_id` | ídem | `certificado:<huella>:clave` | 3 (0005 pendiente) |
| XML del CAF (con `RSASK`) | `cafs.caf_secret_id` | backend con `guardar_secreto()` | por definir | 6 |
| Secreto HMAC del webhook | `webhooks.secreto_secret_id` | `crear_webhook()` llama directo a `vault.create_secret` | `webhook <url>` | 11 |
| `cron_token` | ninguna (secreto con nombre) | a mano en el SQL Editor (`0002_extensiones_cron.sql`) | `Bearer para /api/cron/*` | 0 |

`<huella>` es `huella_sha256` del certificado (sha256 hex del DER de la hoja). Es
pública: identifica el certificado, no lo abre. Por eso puede ir en la descripción, y
sirve para encontrar los dos secretos de un certificado sin leer su contenido. Los
secretos de certificados se crean sin nombre (`name = null`).

## Cómo entra un certificado: `registrar_certificado` (atómico)

`guardar_secreto(p_secreto, p_descripcion)` es un envoltorio de
`vault.create_secret(p_secreto, null, p_descripcion)` que devuelve el id. Llamarlo dos
veces y después insertar la fila desde la app dejaría secretos huérfanos si el `insert`
fallara (huella repetida, RUT inválido). Por eso la Fase 3 lo hace todo en una función
(migración 0005, aplicada el 2026-11-13):

1. Valida huella, RUT, .pfx y clave **antes** de tocar Vault, y revisa si la huella ya
   está en la organización.
2. Crea los dos secretos (`:pfx` y `:clave`).
3. Inserta la fila con los dos ids.

Vault es una tabla de la misma base: si el paso 3 lanza, la transacción completa se
deshace y los secretos del paso 2 desaparecen con ella. La comprobación 23 de
`rls-fase3-empresas.sql` cuenta `vault.secrets` antes y después de un `23505` y exige
que no cambie. Contrato y errores en
[RPC del backend](../03-api-reference/rpc-backend.md#registrar_certificado-migración-0005).

Lo que hace la app antes (`subirCertificado`): abre el .pfx con la librería para
validarlo, confirma la sesión con `getUser()`, convierte los bytes a base64 solo para la
llamada y, al terminar, sobrescribe su copia con ceros (`bytes.fill(0)`). El archivo no
se escribe en disco ni en Storage, y ni el archivo ni la clave vuelven al navegador.

## Quién lee

`leer_secreto(p_id)` devuelve `decrypted_secret` de `vault.decrypted_secrets`. Solo la
ejecuta `service_role` (`revoke execute … from public, anon, authenticated` en la §17 de
`0001`). Hoy **ningún código la llama**: la primera será `server/sii/credenciales.ts` de
la Fase 4, que arma el `Certificado` / `FirmaElectronica` en memoria por invocación.

- El esquema `vault` no está expuesto por la Data API (`supabase/config.toml` expone
  solo `public` y `graphql_public`).
- Los miembros sí pueden leer `pfx_secret_id` y `clave_secret_id` por la API (la
  política `lectura` de `certificados` no restringe columnas), pero un id sin
  `leer_secreto` no abre nada. La app igual no los selecciona
  (`server/certificados/consultas.ts`).

## Borrado: `tg_borrar_secretos`

`tg_borrar_secretos()` es un trigger `after delete`, `security definer`, que recibe como
argumentos los nombres de las columnas `*_secret_id` y borra esos ids de
`vault.secrets`:

| Tabla | Trigger | Columnas |
|---|---|---|
| `certificados` | `trg_borrar_secretos` | `pfx_secret_id`, `clave_secret_id` |
| `cafs` | `trg_borrar_secretos` | `caf_secret_id` |
| `webhooks` | `trg_borrar_secretos` | `secreto_secret_id` |

- Corre por fila, también en cascada: borrar una organización borra sus certificados y,
  con ellos, sus secretos.
- **Revocar** un certificado (`revocado_en`) no borra nada: el .pfx y la clave siguen en
  Vault hasta que se elimina.
- No hay trigger de `update`: cambiar un `*_secret_id` dejaría el secreto anterior
  huérfano. `authenticated` no puede (no escribe `certificados` ni `cafs`, y en
  `webhooks` solo actualiza `url`, `eventos` y `activo`); el backend no debe hacerlo.

Verificado por las comprobaciones 11 de `0005_certificados_resoluciones.sql` (el trigger
existe con esas columnas) y 41 de `rls-fase3-empresas.sql` (borrar un certificado deja 0
de sus 2 secretos).

## Qué nunca se registra

### Logs de la app

- Server Actions de certificados: al log va solo `error.code` de Postgres
  (`Certificados: <operación> falló`, `{ codigo }`), porque el mensaje o el detalle de
  PostgREST podrían traer valores de la fila. Un error inesperado al leer un .pfx se
  registra sin el error original.
- `analizarCertificado()` lanza `ErrorAnalisisCertificado` con mensajes fijos y **sin
  `cause`**: el error de node-forge o de la librería no se propaga.
- `registrar_certificado()` nombra el dato que falla, nunca su valor (comprobación 27:
  ningún error contiene la clave ni el base64).
- Mensajes de error al usuario: nunca la clave, el contenido ni el **nombre del
  archivo** (los .pfx del SII suelen llevar el RUT en el nombre).
- Token de invitación y token del SII: tampoco a logs (`TokenStoreSupabase` solo informa
  el código de PostgREST).

### Sentry (`apps/web/src/lib/sentry/depurar.ts`)

`opcionesSentry()` (navegador, servidor y edge) aplica `depurarEvento` en `beforeSend` y
`beforeSendSpan` (con el SDK 11 las trazas salen como spans sueltos) y
`depurarBreadcrumb` en `beforeBreadcrumb`, con `sendDefaultPii: false`. El valor
filtrado se reemplaza por `[Filtrado]`.

| Qué | Regla |
|---|---|
| Cuerpo y cookies de la petición | `request.data` y `request.cookies` se borran del evento |
| Campos con nombre sensible | cualquier clave que contenga `authorization`, `cookie`, `token`, `clave`, `contrase`, `password`, `passwd`, `pfx`, `p12`, `secret`, `secreto`, `rsask`, `rsapk`, `api_key`/`apikey`, `llave`, `private_key`, `set-cookie` o `captcha` (sin distinguir mayúsculas) |
| **Formularios de Server Actions** | `server_action_form_data` y **todos** sus campos (`server_action_form_data.<campo>`, que agrega la instrumentación de Server Actions de Sentry), y claves `body`, `raw_body`, `request_body`, `form_data`. Se filtran por nombre de campo, sin importar el contenido: un campo `archivo` o `rut_titular` tampoco sale |
| Archivos | `Blob`, `File`, `FormData` o un `File` ya serializado (`{ name, size, type, lastModified }`): contenido y nombre |
| Textos libres (mensajes, URLs, breadcrumbs) | bloques PEM; `<RSASK>…</RSASK>`; `TOKEN=…` y `<TOKEN>…</TOKEN>`; `Bearer`/`Basic …`; JWT (`eyJ…`); query `token`, `clave`, `password`, `secret`, `secreto`, `api_key`, `apikey`, `key`, `invitacion`; `/invitacion/<token>` (también codificado); `filename=` de un multipart; nombres sueltos `*.pfx` / `*.p12`; y cualquier tira base64 de 120 caracteres o más que mezcle mayúsculas, minúsculas y dígitos (un .pfx, un CAF, una llave DER) |

`depurar.test.ts` prueba cada regla. Si agregas un formulario con un campo sensible de
nombre nuevo, igual queda cubierto por la regla de `server_action_form_data`; si lo
mandas a Sentry por otra vía (un `captureException` con contexto propio), revisa que el
nombre del campo calce con alguna regla.

## Tokens del SII y cookies AUT2000 (cifrado en la app)

`apps/web/src/server/cifrado.ts` (`server-only`):

- **Algoritmo:** AES-256-GCM, IV aleatorio de 12 bytes, tag de 16. Formato guardado:
  `iv (12) ‖ ciphertext ‖ tag (16)`, que es lo que esperan `tokens_sii.token_cifrado` y
  `sesiones_sii.cookies_cifradas` (`bytea`; por PostgREST viaja como `\x<hex>` con
  `aBytea` / `desdeBytea`).
- **Llave:** `SII_TOKENS_KEY`, 32 bytes en base64 (`leerLlave` exige el largo y no
  incluye la llave en sus mensajes). Nunca en la base.
- **AAD (datos autenticados):** el contexto de la fila. Para un token,
  `JSON.stringify([canal, ambiente, rutEmpresa, huellaCertificado])`, p. ej.
  `["rest","certificacion","76543210-3","<huella>"]` (`contextoToken`). Un token copiado
  a otra fila no descifra; `TokenStoreSupabase` lo trata como ausente y pide uno nuevo.
- **Rotar la llave** invalida todos los tokens y cookies guardados: se piden de nuevo,
  sin pérdida.

Los tokens los guarda y lee `TokenStoreSupabase` (`server/sii/token-store-supabase.ts`)
sobre `token_obtener` / `token_guardar` / `token_borrar`, solo con `service_role`. Las
cookies de `sesiones_sii` las manejará `sesiones.ts` de la Fase 4 (aún sin código).
Detalle de variables y del spike en
[ambientes y credenciales](../01-fundamentos/ambientes-y-credenciales.md#cifrado-de-tokens-y-cookies).

<!-- TODO (Fase 6): guardado y lectura del XML del CAF (descripción del secreto, quién lo lee al timbrar). -->
<!-- TODO (Fase 11): rotación del secreto HMAC de un webhook. -->
