---
title: "Ambientes del SII y credenciales"
description: "Certificación vs producción, hosts del SII, IDK del CAF, certificado digital, roles y claves API de Supabase, sesiones y su revocación, y dónde vive cada secreto."
keywords: [ambiente, certificacion, produccion, maullin, palena, apicert, pangal, rahue, herculesr, zeusr, IDK, service_role, Vault, SII_TOKENS_KEY, variables de entorno, spike, sb_publishable, sb_secret, claves legadas, JWKS, getClaims, getUser, revocación, jwt_expiry]
related: ["01-fundamentos/autenticacion-sii.md", "08-esquema-supabase/vault-y-secretos.md", "07-referencia/herramientas.md"]
source: ["supabase_saas_sii.sql §1 §6 §7", "certificacion-node/docs/canales.md", "PLAN-SAAS.md §4.4 §5"]
---

# Ambientes del SII y credenciales

> **Úsalo cuando:** necesitas saber a qué host apunta cada operación o dónde se guarda un secreto.

## Ambientes

El ambiente es un parámetro **obligatorio** en cada cliente de la librería y un enum en la
base (`ambiente_sii`: `certificacion` | `produccion`). Nunca es un string libre ni un valor
por defecto: timbrar en el ambiente equivocado gasta folios reales o deja un CAF inútil.

| Canal | Certificación | Producción |
|---|---|---|
| REST: semilla, token y consulta de envío | `apicert.sii.cl/recursos/v1` | `api.sii.cl/recursos/v1` |
| REST: envío de boletas | `pangal.sii.cl/recursos/v1` | `rahue.sii.cl/recursos/v1` |
| SOAP DTEWS / DTEUpload, timbraje de folios | `maullin.sii.cl` | `palena.sii.cl` |
| AUT2000: login con certificado (mTLS) | `herculesr.sii.cl` (compartido) | `herculesr.sii.cl` (compartido) |
| AUT2000: sesión | `zeusr.sii.cl` (compartido) | `zeusr.sii.cl` (compartido) |
| IDK del `<DA>` del CAF | `100` | `300` |

Constantes de la librería: `URLS_BOLETA_REST[ambiente]` y `datosAmbiente(ambiente)`
(`host`, `portal`, `idk`). El IDK sirve de candado: un CAF con otro IDK salió del ambiente
equivocado.

## Dónde corre lo que habla con el SII

- Solo en **funciones Node.js de Vercel** (`export const runtime = 'nodejs'`), región
  `gru1` (São Paulo, fijada en `apps/web/vercel.json`). Nunca en Edge runtime ni en Edge
  Functions de Supabase: la librería usa `node-forge`, `undici` y TLS mutuo.
- El SII exige **RSA-SHA1** (semilla, DTE, sobres). Node 24 con OpenSSL 3.5 lo permite;
  el spike lo verifica en cada ejecución (`entorno.rsaSha1`).
- Los hosts de certificación negocian TLS 1.2/1.3 con certificados de servidor válidos y
  **no requieren relajar OpenSSL**, con y sin certificado de cliente (mTLS).
- **Spike del 2026-11-11 desde Vercel `gru1`** (deploy de Production, OpenSSL 3.5.8): los
  5 hosts respondieron (handshake ~110–310 ms; GET ~170–225 ms) y `apicert` entregó un
  token en ~2 s, guardado cifrado en `tokens_sii`. El SII no bloquea las IP de Vercel:
  no hace falta el plan B (worker con IP fija).
- El runtime de Node lo fija `engines.node` de `apps/web/package.json` (`24.x`): Vercel
  lo prioriza sobre la configuración del proyecto, y con `>=22.19` elegía la versión más
  nueva (26).

## La base de datos: una sola, en producción

Hay **un solo** proyecto de Supabase (`rbrntkztzijaxsnpgpqn`, en la nube) y es producción.
No hay base local, ramas ni base de pruebas: el desarrollo local y los deploys de
*Production* de Vercel usan ese mismo proyecto (en Vercel no se usa *Preview*)
([despliegue](../08-esquema-supabase/despliegue.md)).

Son dos ejes distintos que no hay que confundir:

| Eje | Valores | Dónde se decide |
|---|---|---|
| Base de datos | una sola: producción | `NEXT_PUBLIC_SUPABASE_URL` (siempre el mismo proyecto) |
| Ambiente del SII | `certificacion` / `produccion` | columna `ambiente` de cada fila y parámetro de cada cliente de la librería |

Una empresa que se certifica ante el SII genera filas `ambiente = 'certificacion'` en la
base de producción; cuando el SII la autoriza (P91) empieza a emitir con filas
`ambiente = 'produccion'` en esa misma base.

## Roles de Supabase

| Rol | Quién | Qué puede |
|---|---|---|
| `anon` | visitantes sin sesión | solo catálogos (`tipos_dte`, `estados_sii`, `planes`) |
| `authenticated` | usuarios del panel | sus organizaciones, según RLS |
| `service_role` | capa SII, cron y API pública | todo, saltando RLS; **siempre** filtrar por `organizacion_id` |

El cliente `service_role` vive solo en `apps/web/src/server/supabase/service.ts`, marcado
`import 'server-only'`: importarlo desde un componente cliente rompe el build.

## Claves API de Supabase

Solo se usan las claves nuevas (*Settings → API Keys*):

| Clave | Variable | Rol con el que entra |
|---|---|---|
| `sb_publishable_…` | `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `anon`, o `authenticated` si la petición lleva el JWT de sesión |
| `sb_secret_…` | `SUPABASE_SECRET_KEY` | `service_role` |

`src/server/env.ts` y el cliente del navegador rechazan cualquier valor sin esos prefijos.

**Las claves legadas `anon` y `service_role` (JWT `eyJ…`) están desactivadas desde el
2026-11-13 (01:12:30 UTC).** Cualquier petición con una de ellas recibe
`401 {"message":"Legacy API keys are disabled"}`, vaya en la cabecera `apikey` o como
`Authorization: Bearer`. Consecuencias para el desarrollo:

- Los ejemplos de la documentación de Supabase, de tutoriales o de un LLM que usen
  `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` o un JWT `eyJ…` como clave **no
  funcionan** aquí: cambiar por la clave nueva equivalente.
- Una integración nueva (Marketplace de Vercel, una herramienta externa, un webhook de
  base de datos, un job de `pg_cron` con `pg_net`, una Edge Function) que pida o
  inyecte la clave legada fallará con ese 401. Configúrala con `sb_publishable_` o
  `sb_secret_`.
- Si algo se rompe por esto: *Settings → API Keys → Re-enable JWT-based API keys*
  vuelve a activarlas al instante. Para buscar quién las usa, filtra los logs del
  gateway (`edge_logs`) por `request.sb.apikey.apikey.prefix` (las legadas no tienen
  prefijo `sb_`).
- **Retiro definitivo (pendiente, 2027):** en *Settings → JWT Keys* sigue la clave
  HS256 legada como *Previously used* (verifica tokens antiguos). Revocarla es el paso
  final. A diferencia del interruptor de *API Keys*, revocar una clave de firma no es
  un cambio de un clic que se deshace: hazlo solo cuando las legadas lleven tiempo
  desactivadas sin incidentes.

## Sesiones de usuario y revocación

Los JWT de sesión se firman con la clave asimétrica actual del proyecto (ECC P-256,
ES256). `getClaims()` (en `src/proxy.ts`, `src/server/sesion.ts` y las Server Actions)
verifica la firma **localmente** con el JWKS público y no le pregunta nada a Auth.
PostgREST y RLS hacen lo mismo: aceptan cualquier JWT con firma válida que no haya
expirado.

Consecuencia: **revocar una sesión no corta el token de acceso ya emitido**. Sigue
siendo válido hasta su `exp` (`jwt_expiry`, 3600 s por omisión). Revocar solo impide
renovarlo. Pasa con:

| Evento | Qué corta al instante | Qué sigue vivo hasta `exp` (≤ 1 h) |
|---|---|---|
| «Cerrar sesión» (`/auth/salir`, `signOut({ scope: 'local' })`) | las cookies de ese navegador y el *refresh token* de esa sesión | una copia del token de acceso, si alguien la tenía |
| Borrar el usuario en Auth | refresco y nuevos ingresos; la cascada borra `perfiles` y `miembros_organizacion` | el token: la app muestra la sesión («Ingresaste como…» en `/bienvenida`), pero RLS ya no encuentra membresías y las altas fallan por FK |
| Banear al usuario (`ban_duration`) | refresco y nuevos ingresos | el token **con sus membresías intactas**: puede seguir leyendo y escribiendo según su rol |
| Quitar a un miembro o que salga de la organización | **todo** el acceso a esa organización: `es_miembro()` se evalúa en cada consulta | nada de esa organización (sí sus otras organizaciones) |

Observado el 2026-11-13: una cookie de la cuenta temporal `e2e-ingreso-…`, borrada
minutos antes, todavía abría `/bienvenida` con «Ingresaste como…». Al cerrar sesión,
Auth respondió `403 user_not_found`, pero `/auth/salir` borró las cookies igual (es lo
esperado: ver el comentario del route handler).

Reglas para el desarrollo:

1. **Para quitarle el acceso a alguien de inmediato, se quita su membresía** (o la
   organización le quita el rol). Borrar o banear en Auth es complementario, no
   suficiente.
2. **Operaciones irreversibles o con costo** (las ⚠️: emitir, enviar al SII, pedir o
   anular folios, postular o declarar, subir un certificado, crear API keys o
   webhooks) deben confirmar la sesión contra Auth antes de ejecutar, con
   `supabase.auth.getUser()`: le pregunta a Auth, así que falla si la sesión se revocó
   o el usuario ya no existe. `getClaims()` basta para leer y para el resto de las
   acciones.
3. En pruebas e2e que borran usuarios, cerrar también la sesión del navegador. Si no,
   la cookie vieja sigue «iniciada» hasta una hora y confunde la siguiente prueba.

## Dónde vive cada secreto

| Secreto | Dónde | Cómo se lee |
|---|---|---|
| `.pfx` (base64) y su clave | Supabase Vault (`certificados.pfx_secret_id`, `clave_secret_id`) | `leer_secreto()` con `service_role` |
| XML del CAF (con la llave `RSASK`) | Supabase Vault (`cafs.caf_secret_id`) | `leer_secreto()` con `service_role` |
| Secreto HMAC de cada webhook | Supabase Vault (`webhooks.secreto_secret_id`) | `leer_secreto()` con `service_role` |
| Token del SII (REST/SOAP) | `tokens_sii.token_cifrado` | AES-256-GCM en la app con `SII_TOKENS_KEY` |
| Cookies AUT2000 | `sesiones_sii.cookies_cifradas` | AES-256-GCM en la app con `SII_TOKENS_KEY` |
| `SII_TOKENS_KEY`, `SUPABASE_SECRET_KEY`, `CRON_SECRET` | variables de entorno de Vercel (*sensitive*) | `process.env`, validadas en `src/server/env.ts` |
| `TURNSTILE_SECRET_KEY` | variable de entorno de Vercel (*sensitive*) **y** Supabase Auth → *Attack Protection* | `siteverify` en `src/server/turnstile.ts` (invitación, contacto, y los formularios de acceso cuando hay `SUPABASE_SECRET_KEY`); Supabase la usa para validar `captchaToken` en Auth |
| `SUPABASE_SECRET_KEY` (`sb_secret_…`), segundo uso | la misma variable | `src/server/supabase/clave-auth.ts`: llamadas a `supabase.auth.*` en nombre de la persona con `sb-forwarded-for` (su IP real), para que los límites por IP de Auth no vean solo la IP de Vercel. Con esta clave Auth omite el captcha (la app verifica Turnstile) y la Data API correría como service_role: nunca usar esos clientes para datos |
| `cron_token` | Supabase Vault | `pg_cron` lo envía como Bearer a `/api/cron/*` (igual a `CRON_SECRET`) |

### Cifrado de tokens y cookies

`apps/web/src/server/cifrado.ts`: AES-256-GCM, formato `iv (12) || ciphertext || tag (16)`.
El **contexto de la fila** va como datos autenticados (AAD): para un token,
`["rest","certificacion","76543210-3","<huella>"]`. Un token copiado a otra empresa,
ambiente o certificado no descifra; el `TokenStoreSupabase` lo trata como ausente y pide
uno nuevo. `SII_TOKENS_KEY` son 32 bytes en base64:

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Rotar la llave invalida todos los tokens guardados (se piden de nuevo, sin pérdida). Las
cookies AUT2000 también se invalidan: la siguiente operación vuelve a hacer login.

## Variables de entorno

La lista completa está en `apps/web/.env.example` y en PLAN-SAAS §5. En el SaaS **no hay**
`SII_CERT_*` ni `SII_CAF_*` como en la CLI: certificados y CAF son de cada empresa y viven
en Vault.

## Spike de conectividad (Fase 0, retirado)

Durante la Fase 0 existió la ruta `GET /api/spike/sii`: desde la función de Vercel hacía
handshake TLS (con y sin certificado de cliente) y un GET a los 5 hosts de certificación,
y pedía un token a `apicert` que guardaba cifrado en `tokens_sii` con
`TokenStoreSupabase`. Cumplió el criterio de aceptación el 2026-11-11 (resultados arriba,
en «Dónde corre lo que habla con el SII») y se retiró del código junto con
`src/server/spike/conectividad.ts` y las variables `SPIKE_CERT_PFX_BASE64`,
`SPIKE_CERT_PASS` y `SPIKE_RUT_EMPRESA`.

Lo que quedó de él y sí se usa: `src/server/cifrado.ts` (AES-256-GCM),
`src/server/sii/token-store-supabase.ts` y el cliente tipado
`src/server/supabase/service.ts`, que la capa SII de la Fase 4 reutiliza. Para repetir la
prueba de red desde un equipo: `pnpm humo:tls`.

La ruta `/api/spike/sentry` (Bearer `SPIKE_TOKEN`) se usó para probar la depuración de
Sentry y se retiró el 2026-11-12, junto con `src/server/spike/autorizar.ts` y `SPIKE_TOKEN`.
