---
title: "Esquema: despliegue"
description: "Cómo se aplican las migraciones en la única base (Supabase en la nube, producción), requisitos (Vault, Realtime, pg_cron, pg_net) y tareas programadas."
keywords: [migraciones, supabase db push, supabase link, producción, una sola base, Vault, pg_cron, pg_net, cron_token, Realtime, Storage, tipos, verificaciones]
related: ["02-guias/quickstart.md", "05-pruebas/probar-el-esquema.md", "08-esquema-supabase/vault-y-secretos.md"]
source: ["supabase_saas_sii.sql (cabecera, opcional pg_cron)", "PLAN-SAAS.md §4.4 §6"]
---

# Esquema: despliegue

> **Úsalo cuando:** vas a instalar el esquema, aplicar una migración o programar el seguimiento.

## Una sola base: Supabase en la nube, en producción

| Regla | Consecuencia |
|---|---|
| Existe **un solo** proyecto: `rbrntkztzijaxsnpgpqn` (`sa-east-1`, Postgres 17) | No hay base local (`supabase start`), ni ramas de Supabase, ni base de pruebas |
| Ese proyecto **es producción** desde el primer día | Cada migración se aplica directo sobre datos reales; no hay `db reset` ni `seed.sql` |
| Desarrollo local, *Preview* y *Production* de Vercel apuntan al mismo proyecto | Lo que se escribe desde un equipo o un deploy de preview queda en la base real |

**«Producción» de la base no es el ambiente del SII.** La base es una sola, pero guarda datos
de los dos ambientes del SII: `certificacion` (maullin/apicert/pangal, IDK 100) y
`produccion` (palena/api/rahue, IDK 300), separados por la columna `ambiente`. Certificar
una empresa ante el SII ocurre en esta misma base de producción, con filas
`ambiente = 'certificacion'`. Ver
[ambientes-y-credenciales](../01-fundamentos/ambientes-y-credenciales.md).

## Migraciones

Viven en `supabase/migrations/` con prefijo **secuencial de 4 dígitos** (no timestamps):

| Archivo | Contenido |
|---|---|
| `0001_esquema_inicial.sql` | `supabase_saas_sii.sql` **byte a byte** (19 secciones: tipos, tablas, RLS, Vault, Storage, Realtime). Nunca se edita |
| `0002_extensiones_cron.sql` | `pg_cron` (schema `pg_catalog`) y `pg_net` (schema `extensions`) |
| `0003_…` en adelante | las previstas en PLAN-SAAS §6 |

Reglas, todas derivadas de que la única base es producción:

- Todo cambio va en una migración nueva; nunca editar una ya aplicada ni cambiar el
  esquema desde el panel (el historial dejaría de reflejar la base).
- Crear el archivo a mano con el siguiente número (`supabase migration new` usa timestamps
  y desordenaría la secuencia).
- Las migraciones son **aditivas**: agregar columnas con `default` o nulas, tablas, índices
  y funciones. Borrar o renombrar una columna se hace en dos pasos (dejar de usarla en
  la app y desplegar; después, en otra migración, quitarla).
- Índices sobre tablas con datos: `create index concurrently` en una migración propia
  (no puede ir dentro de una transacción).
- La 0001 abre y cierra su propia transacción (`begin; … commit;`): Postgres solo avisa
  «there is already a transaction in progress», no es un error.
- Cada migración trae su verificación de solo lectura en `supabase/verificaciones/`
  (ver [probar-el-esquema](../05-pruebas/probar-el-esquema.md)).

## Aplicar una migración

Con la CLI (devDependency del repo), desde la raíz:

```sh
pnpm exec supabase login                                              # una vez por equipo
pnpm exec supabase link --project-ref rbrntkztzijaxsnpgpqn             # una vez
pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn --dry-run    # muestra qué se aplicaría
pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn              # aplica las pendientes (pide confirmar)
pnpm db:tipos                                                         # regenera y versiona tipos.ts
```

**Siempre con `--remote=rbrntkztzijaxsnpgpqn`.** La CLI 3.x apunta por defecto a una base
local (`127.0.0.1:54322`), que en este proyecto no existe: sin el flag, el comando falla
con `ECONNREFUSED 127.0.0.1:54322`. Se usa el ref explícito y no `--remote` a secas para
que nunca dependa de qué proyecto quedó enlazado. Si pide la contraseña de la base, es la
del proyecto (panel → *Project Settings → Database*); también se puede pasar con
`--password`.

Antes de cada `db push`:

1. Leer la migración completa y confirmar que es aditiva.
2. Revisar que el respaldo del proyecto esté al día (panel → *Database → Backups*; con PITR
   activo, anotar la hora para poder restaurar a ese punto).
3. Desplegar primero el código que tolera el esquema nuevo y el viejo, si aplica.

Después: ejecutar su archivo de `supabase/verificaciones/` y revisar los avisos de
seguridad y rendimiento del proyecto (panel → *Advisors*, o MCP `get_advisors`).

La CLI registra cada archivo con su número (`0001`, `0002`…) en
`supabase_migrations.schema_migrations`. Evitar aplicar migraciones con el MCP
`apply_migration`: las registra con un timestamp propio y el historial deja de calzar con
los archivos (habría que repararlo con `supabase migration repair`).

## Estado actual y avisos conocidos

Aplicadas el 2026-11-10 con `db push`: `0001_esquema_inicial` y `0002_extensiones_cron`
(`supabase_migrations.schema_migrations` = `0001`, `0002`). La verificación
`supabase/verificaciones/0001_esquema.sql` dio las 13 comprobaciones en `ok`.

Avisos de *Advisors* que son **esperados** y no se corrigen:

| Aviso | Por qué es correcto |
|---|---|
| `rls_enabled_no_policy` en `tokens_sii` y `sesiones_sii` (INFO) | Diseño: RLS activo y sin políticas = solo `service_role` |
| `authenticated_security_definer_function_executable` (WARN, 10 funciones) | Son las RPC pensadas para el panel (`crear_organizacion`, `crear_invitacion`, `aceptar_invitacion`, `crear_api_key`, `crear_webhook`) y las funciones de acceso que usan las políticas (`es_miembro`, `tiene_rol`, `es_admin`, `puede_emitir`, `comparte_organizacion`). Validan `auth.uid()` adentro; las de acceso solo responden sobre el propio usuario |
| `unused_index` (INFO) | La base está vacía; se revisa con datos reales |

Pendiente (rendimiento, antes de tener volumen): `unindexed_foreign_keys` (INFO, 52 FK sin
índice, la mayoría `organizacion_id`, que filtran todas las políticas RLS). Se resuelve con
una migración aditiva de índices `concurrently` (prevista en PLAN-SAAS §6).

## Requisitos del proyecto

- Postgres 17 (`supabase/config.toml` declara `major_version = 17`).
- Región `sa-east-1` (São Paulo), junto a las funciones de Vercel en `gru1`.
- **Vault** (`supabase_vault`): viene instalado en todo proyecto de Supabase.
- **Realtime**: la publicación `supabase_realtime` existe por defecto; la 0001 le agrega
  `documentos`, `envios` y `procesos_certificacion` (la Fase 4 suma `operaciones_sii` y
  `solicitudes_folios`).
- **Storage**: la 0001 crea el bucket privado `documentos-xml` (10 MB, XML y PDF).

## Pasos manuales después de la 0002

**`cron_token` en Vault**, con el mismo valor que `CRON_SECRET` en Vercel (no va en una
migración porque es un secreto). SQL Editor:

```sql
select vault.create_secret('<valor>', 'cron_token', 'Bearer para /api/cron/*');
```

## Tareas programadas

`pg_cron` + `pg_net` llaman a rutas Node.js de Vercel, no a Edge Functions (la librería es
solo Node). Siempre a la URL de **Production** de Vercel: un deploy de preview no debe
recibir los cron. Cada `cron.schedule` se agrega en una migración de la fase que crea su
ruta:

```sql
select cron.schedule(
  'seguimiento-envios', '*/5 * * * *',
  $$ select net.http_post(
       url     := 'https://<dominio>/api/cron/seguimiento',
       headers := jsonb_build_object('Authorization', 'Bearer ' ||
                    (select decrypted_secret from vault.decrypted_secrets where name = 'cron_token'))
     ); $$
);
select cron.schedule('limpiar-tokens', '0 * * * *',
  $$ delete from public.tokens_sii where vence_en < now() - interval '1 day' $$);
```

| Tarea | Frecuencia | Fase |
|---|---|---|
| limpieza de `tokens_sii` | cada hora | 4 |
| `/api/cron/seguimiento` | cada 5 min | 8 |
| alertas (certificado por vencer, folios) | diaria | 8 |
| `/api/cron/webhooks` | cada minuto | 11 |
