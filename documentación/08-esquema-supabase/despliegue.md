---
title: "Esquema: despliegue"
description: "Cómo se aplican las migraciones en la única base (Supabase en la nube, producción), requisitos (Vault, Realtime, pg_cron, pg_net) y tareas programadas."
keywords: [migraciones, supabase db push, supabase link, producción, una sola base, Vault, pg_cron, pg_net, cron_token, Realtime, Storage, tipos, verificaciones, 0006_realtime_operaciones, 0007_bloqueos_sii, bloqueos_sii, aplicadas, 0008_certificacion, registrar_caf, guardar_set_pruebas, rls-fase5-certificacion]
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
| Desarrollo local y *Production* de Vercel apuntan al mismo proyecto (no se usa *Preview*) | Lo que se escribe desde un equipo queda en la base real |

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
| `0003_…` en adelante | las previstas en PLAN-SAAS §6 (la `0008_certificacion` es de la Fase 5: ver [abajo](#fase-5-migración-0008)) |

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

### Fase 4: migraciones 0006 y 0007 (aplicadas el 2026-11-13)

Probadas antes en PGlite y **aplicadas en producción el 2026-11-13** con
`supabase db push --remote`. El código de la capa SII ya las usa:

| Migración | Contenido | Qué falla si falta |
|---|---|---|
| `0006_realtime_operaciones` | agrega `operaciones_sii` y `solicitudes_folios` a `supabase_realtime` (idempotente, *replica identity* por defecto) | las suscripciones de Realtime a esas dos tablas no reciben nada, sin error ([Realtime](../06-integraciones/realtime-y-storage.md#realtime)) |
| `0007_bloqueos_sii` | tabla `bloqueos_sii` y RPC `tomar_bloqueo_certificado` / `liberar_bloqueo_certificado` (solo `service_role`); índice único parcial `operaciones_sii_efecto_global_en_curso` (una sola `solicitar_folios` / `postular` / `declarar` confirmada en curso por empresa y ambiente) | `conBloqueoCertificado` lanza `ErrorBloqueo` y toda operación con sesión AUT2000 termina en `error` ([RPC](../03-api-reference/rpc-backend.md#tomar_bloqueo_certificado-y-liberar_bloqueo_certificado-migración-0007)); sin el índice, dos operaciones de efecto global simultáneas no chocan al insertar (queda solo el control posterior de `ejecutarOperacion`) |

Las dos son aditivas y no requerían desplegar código antes (el código tolera el esquema
viejo: falla de forma controlada, sin salir al SII). Registro de lo hecho:

1. Consulta de duplicados del encabezado de la 0007 (duplicados `en_curso` de efecto global)
   antes de aplicar: 0 filas (si no, el `create unique index` falla y la transacción entera
   se descarta). El `--dry-run` de `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn`
   debe listar solo `0006` y `0007`.
2. `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn`.
3. Verificaciones, todas `ok = true`: `supabase/verificaciones/0006_realtime_operaciones.sql`
   9/9, `0007_bloqueos_sii.sql` 14/14 y la simulación `rls-fase4-bloqueos.sql` 21/21 (con
   `rollback`); después del `rollback`, su consulta de limpieza del encabezado dio todo en 0
   (organizaciones, certificados, empresas, bloqueos y operaciones)
   ([cómo](../05-pruebas/probar-el-esquema.md)). Antes de migrar habían dado lo esperado: 0006
   7/9 y 0007 todo `false`. En PGlite, la 0007 sin el índice da `false` justo en 13–14 de la
   verificación y 17–18 de la simulación.
4. `pnpm db:tipos`: el resultado es idéntico a lo agregado a mano a
   `apps/web/src/server/supabase/tipos.ts` (`bloqueos_sii` y las dos RPC), sin diferencias.
5. *Advisors*: `rls_enabled_no_policy` en `bloqueos_sii` (INFO) es **esperado**, igual que en
   `tokens_sii` y `sesiones_sii`. Las dos RPC nuevas no deberían aparecer en
   `authenticated_security_definer_function_executable`: `authenticated` no las ejecuta.

### Fase 5: migración 0008

**Estado: aplicada en producción el 2026-11-13** (19:59 UTC) con
`supabase db push --remote`. El código del asistente de certificación
(`apps/web/src/server/certificacion/`) la usa. No hay prueba en PGlite: el comportamiento
de las RPC se cubre con la simulación `rls-fase5-certificacion.sql` (paso 4) y el de la
app, con Vitest contra un cliente falso (`apps/web/test/supabase-falso.ts`).

| Migración | Contenido | Qué falla si falta |
|---|---|---|
| `0008_certificacion` | RPC `registrar_caf` (XML del CAF a Vault + fila de `cafs` + solicitud `timbrada`, en una transacción) y `guardar_set_pruebas` (reemplaza los casos del set y deja el proceso en `set_descargado`), las dos solo `service_role` ([contratos](../03-api-reference/rpc-backend.md#registrar_caf-migración-0008)). Solo funciones: sin tablas, columnas, políticas ni grants de tablas | **Pedir folios del set:** el SII timbra, pero `registrar_caf` no existe → el CAF no se guarda, la solicitud queda `incierta` y la operación `incierto` («Se timbraron los folios, pero no pudimos guardar el CAF…»). **Descargar el set:** el SII registra la descarga, pero `guardar_set_pruebas` no existe → la operación termina en `error` y el proceso no queda en `set_descargado`. Postular, consultar estados, pedir la revisión y declarar no la usan. Las dos fallas ocurren **después** de que el SII grabó algo |

El número: el plan reservaba `0008` para `notificaciones` (Fase 8); la numeración es por
orden de creación (PLAN-SAAS §6), así que las migraciones de las fases siguientes se
corren un número.

Es aditiva y el código que la usa no estaba desplegado, así que no había orden que cuidar
con Vercel. Registro de lo hecho:

1. Lectura de la migración completa (`supabase/migrations/0008_certificacion.sql`) y
   revisión del respaldo (panel → *Database → Backups*).
2. `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn --dry-run`: listó solo `0008`.
3. `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn`: aplicada a las 19:59 UTC.
4. Verificaciones, todas `ok = true`
   ([cómo](../05-pruebas/probar-el-esquema.md#6-simulación-de-las-rpc-de-la-fase-5-rls-fase5-certificacionsql)):
   - `supabase/verificaciones/0008_certificacion.sql` (solo lectura): **10/10**, con la
     migración registrada como `0008`. Antes de migrar da todo `false` (las 10
     comprobaciones miran las dos funciones o la migración registrada).
   - La simulación `supabase/verificaciones/rls-fase5-certificacion.sql`: **16/16**, con
     `rollback` (sin la 0008 se detiene con `42883` y no deja resultados). Después, su
     consulta de limpieza del encabezado (organizaciones `zz-prueba-certificacion-fase5%`,
     empresas `Empresa de prueba fase 5%` y secretos de Vault con descripción
     `caf:11111111-1:%`) dio todo en 0.
5. `pnpm db:tipos`: el resultado es idéntico a lo agregado a mano a
   `apps/web/src/server/supabase/tipos.ts` (`registrar_caf` y `guardar_set_pruebas` en
   `Functions`), sin diferencias.
6. *Advisors* de seguridad: sin avisos nuevos. Las dos RPC no aparecen en
   `authenticated_security_definer_function_executable`: no las ejecutan `anon` ni
   `authenticated`.

## Requisitos del proyecto

- Postgres 17 (`supabase/config.toml` declara `major_version = 17`).
- Región `sa-east-1` (São Paulo), junto a las funciones de Vercel en `gru1`.
- **Vault** (`supabase_vault`): viene instalado en todo proyecto de Supabase.
- **Realtime**: la publicación `supabase_realtime` existe por defecto; la 0001 le agrega
  `documentos`, `envios` y `procesos_certificacion` (la Fase 4 suma `operaciones_sii` y
  `solicitudes_folios` con la `0006`, aplicada el 2026-11-13).
- **Storage**: la 0001 crea el bucket privado `documentos-xml` (10 MB, XML y PDF).

## Pasos manuales después de la 0002

**`cron_token` en Vault**, con el mismo valor que `CRON_SECRET` en Vercel (no va en una
migración porque es un secreto). SQL Editor:

```sql
select vault.create_secret('<valor>', 'cron_token', 'Bearer para /api/cron/*');
```

## Tareas programadas

`pg_cron` + `pg_net` llaman a rutas Node.js de Vercel, no a Edge Functions (la librería es
solo Node). Siempre a la URL de **Production** de Vercel, el único entorno que se usa. Cada `cron.schedule` se agrega en una migración de la fase que crea su
ruta:

```sql
select cron.schedule(
  'seguimiento-envios', '*/5 * * * *',
  $$ select net.http_post(
       url     := 'https://boleteame.dev/api/cron/seguimiento',
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
