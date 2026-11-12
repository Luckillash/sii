---
title: "Herramientas"
description: "Supabase CLI, CLI sii, XSD del SII y utilidades de verificación."
keywords: [pnpm, scripts, biome, vitest, supabase cli, vercel cli, humo:tls, sii, subtree, db:tipos]
related: ["09-libreria/cli-sii.md", "08-esquema-supabase/despliegue.md", "05-pruebas/probar-el-esquema.md"]
source: ["certificacion-node/docs/cli.md", "package.json"]
---

# Herramientas

> **Úsalo cuando:** necesitas una herramienta para probar o validar.

## Requisitos

| Herramienta | Versión | Nota |
|---|---|---|
| Node.js | 24 (`.node-version`; mínimo 22.19) | la librería exige ≥ 22.19 |
| pnpm | 12.18.0 (`packageManager`) | respeta `minimumReleaseAge`: no se instalan versiones recién publicadas |
| Supabase CLI | 3.1.0 (devDependency) | `pnpm exec supabase …`; solo `login`, `link`, `db push` y `gen types` contra el proyecto en la nube, **siempre con `--remote=rbrntkztzijaxsnpgpqn`** (sin el flag apunta a una base local que no existe) |
| Vercel CLI | instalada aparte | `vercel login`, `vercel link`, `vercel env` |

## Estructura del monorepo

| Ruta | Qué es |
|---|---|
| `apps/web` | Next.js (App Router), paquete `web` |
| `packages/certificacion` | **git subtree** de `certificacion-node` (monorepo completo, con `LICENSE` y `NOTICE`) |
| `packages/certificacion/packages/core` | la librería `@winex/certificacion` |
| `packages/certificacion/apps/cli` | la CLI `sii` |
| `supabase/` | `config.toml`, `migrations/` y `verificaciones/` (SQL de solo lectura) |

El workspace incluye los paquetes del subtree uno a uno y **no** su carpeta raíz: el
`package.json` de la raíz de la librería corre `pnpm -r`, que dentro de este workspace
recorrería también la app.

## Scripts (desde la raíz)

| Script | Qué hace |
|---|---|
| `pnpm dev` | compila la librería y levanta Next en modo desarrollo |
| `pnpm build` | compila la librería (`tsup`) y la app (`next build`) |
| `pnpm lint` | Biome en la app y, por separado, en la librería con su propia configuración |
| `pnpm format` | Biome con `--write` (solo la app) |
| `pnpm typecheck` | compila la librería y corre `tsc` en todos los paquetes |
| `pnpm test` | Vitest en todos los paquetes (~1.750 de la librería, ~200 de la CLI, los de la app) |
| `pnpm test:web` | solo las pruebas de la app |
| `pnpm humo:tls` | prueba de humo TLS contra los 5 hosts de certificación del SII (ver abajo) |
| `pnpm db:tipos` | regenera `apps/web/src/server/supabase/tipos.ts` desde el proyecto en la nube (requiere `supabase link`; alternativa: MCP `generate_typescript_types`) |

Antes de cerrar una tarea: `pnpm lint && pnpm typecheck && pnpm test`.

## Actualizar la librería

```sh
git subtree pull --prefix=packages/certificacion ../certificacion-node main --squash
pnpm install && pnpm typecheck && pnpm test
```

Nunca editar `packages/certificacion` directamente: los cambios van primero a
`certificacion-node` (con sus pruebas de paridad) y llegan aquí con `subtree pull`.

## Prueba de humo TLS

`pnpm humo:tls` ejecuta `packages/certificacion/scripts/humo-tls.ts`: handshake y GET a
`maullin`, `apicert`, `pangal`, `herculesr` y `zeusr`, con reintento relajado de OpenSSL
solo si hace falta. Para probar también TLS mutuo, crear `packages/certificacion/.env`
(ignorado por git) con `SII_CERT_PATH` y `SII_CERT_PASS`.

Resultado del 2026-11-10 desde una red local en Chile (sin certificado): los 5 hosts
responden con TLS 1.2/1.3, certificados de servidor válidos y **sin relajaciones**.

La misma prueba se hizo desde Vercel `gru1` en la Fase 0, con token incluido (ver
[ambientes-y-credenciales](../01-fundamentos/ambientes-y-credenciales.md#spike-de-conectividad-fase-0-retirado));
esa ruta ya se retiró.

## CLI `sii`

La CLI de la librería sirve de referencia: lo que hace el SaaS en cada operación debe
dejar el mismo resultado que el comando equivalente (criterio de la Fase 5). Se ejecuta
desde el subtree:

```sh
cd packages/certificacion && pnpm sii --help
```

Detalle de comandos y códigos de salida (0–7, equivalentes a `resultado_operacion`) en
[cli-sii](../09-libreria/cli-sii.md).

## Vercel

Proyecto `timbre` (`prj_XEe4L2I60TLJVAI6Ass5y3G6VlFu`, equipo «Lucas' projects»),
conectado a `Luckillash/sii`. **Solo se trabaja en *Production*:** no se usan deploys de
*Preview* ni ramas; cada push a `main` despliega directo a producción.

| Ajuste | Valor |
|---|---|
| Root Directory | `apps/web` (con archivos fuera de la raíz habilitados: la librería vive en `packages/`) |
| Framework / Node | Next.js / 24.x |
| Región de funciones | `gru1` (también en `apps/web/vercel.json`) |
| Install / Build | los de `apps/web/vercel.json`: `pnpm install --frozen-lockfile` y `pnpm --dir ../.. build` |
| Variables de sistema | expuestas (Sentry usa `NEXT_PUBLIC_VERCEL_ENV` y el SHA del commit) |

Variables cargadas: `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY` (clave
publicable `sb_publishable_…`), en *Production* y *Development*. El resto (Supabase
`service_role`, SII, cron y Sentry) va solo en *Production*; las secretas se cargan a mano en el
panel como *Sensitive* (ver
[ambientes-y-credenciales](../01-fundamentos/ambientes-y-credenciales.md)).

## Sentry

Proyecto `luckillash/timbre-web` (plataforma `javascript-nextjs`). La app lee
`NEXT_PUBLIC_SENTRY_DSN`; sin DSN, Sentry queda apagado. El build usa `SENTRY_ORG`,
`SENTRY_PROJECT` y `SENTRY_AUTH_TOKEN` para subir los source maps.

La depuración vive en `apps/web/src/lib/sentry/depurar.ts` (en `beforeSend`,
`beforeSendSpan` y `beforeBreadcrumb`) y tiene pruebas en `depurar.test.ts`. Se comprobó
el 2026-11-12 con un error real con secretos **falsos** (ruta `/api/spike/sentry`, ya
retirada): en Sentry todos aparecieron como `[Filtrado]`.
