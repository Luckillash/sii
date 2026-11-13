---
title: "Ambientes del SII y credenciales"
description: "Certificación vs producción, hosts del SII, IDK del CAF, certificado digital, roles de Supabase y dónde vive cada secreto."
keywords: [ambiente, certificacion, produccion, maullin, palena, apicert, pangal, rahue, herculesr, zeusr, IDK, service_role, Vault, SII_TOKENS_KEY, variables de entorno, spike]
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
