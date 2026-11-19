---
title: "Esquema: despliegue"
description: "Cómo se aplican las migraciones en la única base (Supabase en la nube, producción), requisitos (Vault, Realtime, pg_cron, pg_net) y tareas programadas."
keywords: [migraciones, supabase db push, supabase link, producción, una sola base, Vault, pg_cron, pg_net, cron_token, Realtime, Storage, tipos, verificaciones, 0006_realtime_operaciones, 0007_bloqueos_sii, bloqueos_sii, aplicadas, 0008_certificacion, registrar_caf, guardar_set_pruebas, rls-fase5-certificacion, 0009_autorizacion_externa, tg_resolucion_autoriza_produccion, rls-fase5-autorizacion-externa, 0010_verificar_autorizacion, verificar_autorizacion, operacion_sii, rls-fase5-verificar-autorizacion, 0011_folios, anular_folios, trg_20_caf_sin_traslape, tg_caf_sin_traslape, rls-fase6-folios, Fase 6, 0012_folio_anulado, Fase 8, 0013_notificaciones, notificaciones, reclamar_notificacion, rls-fase8-notificaciones, 0014_cron, cron.schedule, seguimiento-envios, alertas, limpiar-tokens-sii, limpiar-historial-cron, net._http_response, cron.job_run_details, CRON_SECRET, execute_sql, 42501, _crypto_aead_det_decrypt, db:tipos, nulabilidad, retornos de funciones, Fase 10, 0015_planes_comerciales, 0016_pagos, 0017_cron_suscripciones, sincronizar-suscripciones, activar_suscripcion, rls-fase10-pagos, migración 0018, migración 0019, entregar-webhooks, limpiar-webhook-entregas, limpiar-api-idempotencia, trg_10_api_key_sin_reactivar, Fase 12, sin migraciones, /estado, índice operaciones_sii]
related: ["02-guias/quickstart.md", "05-pruebas/probar-el-esquema.md", "08-esquema-supabase/vault-y-secretos.md", "02-guias/planes-y-pagos.md", "02-guias/sitio-publico.md"]
source: ["supabase_saas_sii.sql (cabecera, opcional pg_cron)", "PLAN-SAAS.md §4.4 §6", "supabase/migrations/0013_notificaciones.sql", "supabase/migrations/0014_cron.sql", "supabase/migrations/0015_planes_comerciales.sql", "supabase/migrations/0016_pagos.sql", "supabase/migrations/0017_cron_suscripciones.sql", "supabase/migrations/0018_api_webhooks.sql", "supabase/migrations/0019_cron_webhooks.sql"]
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
| `0003_…` en adelante | las previstas en PLAN-SAAS §6 (la `0008_certificacion` y la `0009_autorizacion_externa`, aplicadas el 2026-11-13, y la `0010_verificar_autorizacion`, aplicada el 2026-11-14, son de la Fase 5: ver [abajo](#fase-5-migración-0008); la `0011_folios`, de la Fase 6, se aplicó el 2026-11-15: ver [abajo](#fase-6-migración-0011); la `0012_folio_anulado`, de la Fase 7, se aplicó el 2026-11-15: ver [abajo](#fase-7-migración-0012); la `0013_notificaciones` y la `0014_cron`, de la Fase 8, se aplicaron el 2026-11-17 (la 0014 después del deploy): ver [abajo](#fase-8-migraciones-0013-y-0014); la `0015_planes_comerciales` y la `0016_pagos`, de la Fase 10, se aplicaron el 2026-11-18 (antes del deploy) y la `0017_cron_suscripciones` después del deploy, el mismo día: ver [abajo](#fase-10-migraciones-0015-0016-y-0017); la `0018_api_webhooks` y la `0019_cron_webhooks`, de la Fase 11: la 0018 se aplicó el 2026-11-19, antes del deploy, y la 0019 el mismo día, después del deploy: ver [abajo](#fase-11-migraciones-0018-y-0019)) |

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

### Fase 5: migración 0009

**Estado: aplicada en producción el 2026-11-13 (21:05 UTC).** Registro: el `--dry-run`
listó solo `0009`; antes de migrar, el `update` del final no tenía filas que marcar (0
resoluciones de producción vigentes); verificación 9/9 `ok`; simulación 12/12 `ok` y su
consulta de limpieza en 0 (usuarios, organizaciones, empresas); `pnpm db:tipos` sin
diferencias; *Advisors* de seguridad sin avisos nuevos (la función no aparece). Paso 8
hecho el mismo día: resolución de producción n.º 80 del 22-08-2014 de la empresa del piloto
(20630500-2), que quedó autorizada (`autorizada_en` fijado a mano como `postgres` en la fecha
real de autorización, 06-11-2026, porque el trigger pone `now()`); el asistente la muestra
«Autorizada fuera de Boletéame». Antes,
escrita y probada en PGlite (esquema 0001 y 0003–0008 más
la 0009, con stubs de `auth`, `storage`, `vault` y `supabase_migrations`): verificación 9/9
y simulación 12/12; sin la 0009, la verificación da 2/9 (solo las comprobaciones 7 y 8, que
no dependen de ella) y la simulación 6/12 (fallan 4, 5, 6, 7, 9 y 11). La regresión de la
Fase 3 (`rls-fase3-empresas.sql`, 43/43) y la de la 0008 (16/16) siguen en verde con la 0009
aplicada.

| Migración | Contenido | Qué falla si falta |
|---|---|---|
| `0009_autorizacion_externa` | Función `tg_resolucion_autoriza_produccion()` (`security definer`, `search_path = ''`, sin `EXECUTE` para PUBLIC, `anon` ni `authenticated`) y trigger `trg_50_resolucion_autoriza_produccion` (`after insert or update` en `resoluciones`, `when (new.ambiente = 'produccion' and new.vigente)`): marca `empresas.autorizada_produccion = true` y `autorizada_en = coalesce(…, now())`; nunca desmarca. Más un `update` idempotente de las empresas que ya tengan una resolución de producción vigente (al escribirla, ninguna). Sin tablas, columnas, políticas ni grants de tablas ([trigger](triggers-y-logica.md#tg_resolucion_autoriza_produccion-migración-0009)) | **Empresas certificadas fuera de Boletéame:** registrar la resolución de producción no las autoriza; el asistente sigue mostrando los pasos (con la nota y «Consultar el estado en el SII», que responde «sin trámite»), y no pueden emitir en producción (`tg_validar_documento` exige `autorizada_produccion`). Nada falla con error: el código desplegado tolera el esquema viejo |

Es aditiva y el código que la usa tolera el esquema con y sin la 0009 (el candado y la vista
miran `empresas.autorizada_produccion`, que ya existe), así que no hay orden que cuidar con
Vercel. Pasos, **con autorización del usuario**:

1. Leer la migración completa (`supabase/migrations/0009_autorizacion_externa.sql`) y
   revisar el respaldo (panel → *Database → Backups*).
2. Antes de migrar, mirar qué marcaría el `update` del final (lo esperado: 0 filas):
   `select e.id, e.razon_social from public.empresas e join public.resoluciones r on r.empresa_id = e.id and r.organizacion_id = e.organizacion_id where r.ambiente = 'produccion' and r.vigente and (not e.autorizada_produccion or e.autorizada_en is null);`
3. `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn --dry-run`: debe listar solo
   `0009`.
4. `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn`.
5. Verificaciones, todas `ok = true`
   ([cómo](../05-pruebas/probar-el-esquema.md#7-simulación-de-la-autorización-externa-rls-fase5-autorizacion-externasql)):
   - `supabase/verificaciones/0009_autorizacion_externa.sql` (solo lectura): **9/9**, con la
     migración registrada como `0009`. Antes de migrar da 2/9.
   - La simulación `supabase/verificaciones/rls-fase5-autorizacion-externa.sql`: **12/12**,
     con `rollback`. Después, su consulta de limpieza del encabezado (usuarios
     `autext-%@ejemplo.invalid`, organizaciones `zz-prueba-autorizacion-externa%` y empresas
     `Empresa autorizacion externa%`) tiene que dar todo en 0.
6. `pnpm db:tipos`: no debería cambiar `apps/web/src/server/supabase/tipos.ts` (solo es un
   trigger; las funciones de trigger no aparecen en `Functions`).
7. *Advisors* de seguridad: la función no debería aparecer en
   `authenticated_security_definer_function_executable` (no la ejecutan `anon` ni
   `authenticated`).
8. Para la empresa de producción ya certificada con la librería: un administrador registra
   su resolución de producción en *Configuración → Empresas*; la empresa queda autorizada y
   el asistente muestra «Autorizada fuera de Boletéame».

### Fase 5: migración 0010

**Estado: aplicada en producción el 2026-11-14 (00:59 UTC; 21:59 del 13 en Chile).**
Registro: el `--dry-run` listó solo `0010`; `db push` con la confirmación del usuario;
verificación 6/6 `ok`; simulación 7/7 `ok` y su consulta de limpieza en 0 (usuarios,
organizaciones, empresas y filas `verificar_autorizacion`); `pnpm db:tipos` idéntico a lo
agregado a mano (el valor nuevo en `operacion_sii` y en `Constants`); *Advisors* de
seguridad sin avisos nuevos (los que salen son anteriores y no tocan la 0010). Antes, en
PGlite (esquema 0001 y 0003–0010 con stubs): verificación 6/6 y simulación 7/7; sin la
0010, 2/6 (fallan 1, 2, 3 y 6) y 3/7 (fallan 2, 3, 5 y 6). Las regresiones de las Fases 3,
4 y 5 (`rls-fase3-empresas.sql` 43/43, verificación 0007 14/14, `rls-fase4-bloqueos.sql`
21/21, verificación 0009 9/9, `rls-fase5-autorizacion-externa.sql` 12/12 y
`rls-fase5-certificacion.sql` 16/16) siguen en verde con la 0010.

| Migración | Contenido | Qué falla si falta |
|---|---|---|
| `0010_verificar_autorizacion` | Valor `verificar_autorizacion` al final del enum `operacion_sii` (`add value if not exists … after 'seguimiento'`) y un `comment on type`. Es de lectura: no entra en `OPERACIONES_EFECTO_GLOBAL`, así que el índice `operaciones_sii_efecto_global_en_curso` de la 0007 no cambia. Sin tablas, columnas, funciones, políticas ni grants. No se puede deshacer con un `drop` (Postgres no quita valores de un enum) | La Server Action `verificarAutorizacion` (por escribir) no podría registrar su fila en `operaciones_sii` (`22P02`). Nada del código desplegado usa el valor |

Pasos (los mismos de la 0009, con autorización del usuario): leer la migración, revisar el
respaldo, `--dry-run` (solo `0010`), `db push`, las verificaciones
([cómo](../05-pruebas/probar-el-esquema.md#8-simulación-de-verificar_autorizacion-rls-fase5-verificar-autorizacionsql)):
`supabase/verificaciones/0010_verificar_autorizacion.sql` (**6/6**; antes de migrar 2/6) y
`supabase/verificaciones/rls-fase5-verificar-autorizacion.sql` (**7/7** con `rollback`, y la
consulta de limpieza del encabezado en 0), `pnpm db:tipos` y *Advisors*.

### Fase 6: migración 0011

**Estado: aplicada el 2026-11-15**, con autorización del usuario (el código de la Fase 6
todavía no está desplegado). Antes de migrar: migraciones `0001`–`0010`, 0 CAF, 0 folios
anulados y la verificación en 3/18 (12, 16 y 17, lo esperado). Después:
`supabase/verificaciones/0011_folios.sql` **18/18** y la simulación
`rls-fase6-folios.sql` **27/27**; tras su `rollback`, la limpieza dio todo en 0 (usuarios,
perfiles, organizaciones, empresas, CAF, folios anulados, documentos y secretos
`caf:11111111-1:%`) y `vault.secrets` quedó con los mismos 3 secretos que antes.

| Migración | Contenido | Qué falla si falta |
|---|---|---|
| `0011_folios` | RPC `anular_folios(p_caf, p_desde, p_hasta, p_motivo) → integer` (`security definer`, `search_path = ''`; `authenticated` y `service_role`, no `anon` ni PUBLIC; service_role o administrador de la organización del CAF) y trigger `trg_20_caf_sin_traslape` en `cafs` (función `tg_caf_sin_traslape()`, `security definer`, sin `EXECUTE` para PUBLIC, `anon` ni `authenticated`). Borra la política `alta` de `folios_anulados` (0001) y revoca a `authenticated` `insert`, `update`, `delete` y `truncate` en esa tabla (solo se escribe con `anular_folios` o `service_role`; nada de la app insertaba con la sesión). Agrega `cafs` y `folios_anulados` a `supabase_realtime` (idempotente, como la 0006). Sin tablas ni columnas ([contratos](../03-api-reference/rpc-backend.md#anular_folios-migración-0011)) | **Anular folios** desde `/folios`: `PGRST202`, el usuario ve «No pudimos anular los folios» y no se anula nada. **Traslapes:** un CAF timbrado que se cruza con otro entra (la carga manual igual lo rechaza en la app). Un administrador puede seguir insertando directo en `folios_anulados` con su sesión. Las suscripciones de Realtime a `cafs` y `folios_anulados` no reciben nada (sin error). Lo demás de la Fase 6 funciona |

El número: el plan reservaba `0011` para `notificaciones` (Fase 8); por orden de creación
(PLAN-SAAS §6) las de las fases siguientes se corren un número (`0012_notificaciones`…).

Resultados en PGlite (esquema 0001 y 0003–0011 con stubs de `auth`, `storage`, `vault`,
`supabase_migrations` y la publicación `supabase_realtime`; nada toca la base real):

| Prueba | Con la 0011 | Sin la 0011 |
|---|---|---|
| `supabase/verificaciones/0011_folios.sql` (solo lectura) | 18/18 | 3/18 (12, 16 y 17: sin traslapes, RLS de lectura y `cafs` sin XML, ciertos desde la 0001) |
| `supabase/verificaciones/rls-fase6-folios.sql` (con `rollback`) | 27/27 | 1/27 (solo la preparación) |
| Regresiones: `rls-fase3-empresas.sql`, `rls-fase4-bloqueos.sql`, `rls-fase5-certificacion.sql`, `rls-fase5-autorizacion-externa.sql`, `rls-fase5-verificar-autorizacion.sql`, verificaciones `0008` y `0006` | 43/43, 21/21, 16/16, 12/12, 7/7, 10/10, 9/9 | — |

Salvo lo de `folios_anulados` (quita una política y privilegios que la app no usa: el set
de pruebas escribe con `service_role`), es aditiva, y el código de la Fase 6 tolera el
esquema con y sin ella (falla de forma controlada), así que el orden con Vercel no importa.
Pasos, **con autorización del usuario** (los que se siguieron el 2026-11-15; los resultados,
en el estado de arriba):

1. Leer la migración completa (`supabase/migrations/0011_folios.sql`) y revisar el respaldo
   (panel → *Database → Backups*).
2. Antes de migrar, la verificación tiene que dar **3/18** (12, «ningún par de CAF se
   traslapa», 16 y 17 en `true`; así dio el 2026-11-15). Si la 12 sale `false`, hay CAF traslapados: el trigger no los
   borra, pero cualquier `update` de rango sobre ellos fallará; revisarlos antes.
3. `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn --dry-run`: debe listar **solo
   `0011`**.
4. `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn`.
5. Verificaciones, todas `ok = true`
   ([cómo](../05-pruebas/probar-el-esquema.md#9-simulación-de-folios-de-la-fase-6-rls-fase6-foliossql)):
   - `supabase/verificaciones/0011_folios.sql`: **18/18**, con la migración registrada como
     `0011`.
   - `supabase/verificaciones/0006_realtime_operaciones.sql`: sigue **9/9** (la publicación
     conserva sus tablas).
   - La simulación `supabase/verificaciones/rls-fase6-folios.sql`: **27/27**, con
     `rollback`. Después, su consulta de limpieza del encabezado (usuarios
     `folios-%@ejemplo.invalid`, organizaciones `zz-prueba-folios-fase6%`, empresas
     `Empresa folios fase 6%` y secretos `caf:11111111-1:%`) tiene que dar 0 (los secretos,
     el mismo número que antes de correrla).
6. `pnpm db:tipos`: el resultado debería ser idéntico a lo agregado a mano a
   `apps/web/src/server/supabase/tipos.ts` (`anular_folios` en `Functions`; el trigger no
   aparece).
7. *Advisors* de seguridad: `anular_folios` **sí** aparecerá en
   `authenticated_security_definer_function_executable` (WARN), y es **esperado**: la
   llama el administrador con su sesión y valida `auth.uid()` adentro, como
   `crear_invitacion`. `tg_caf_sin_traslape` no debería aparecer.
8. Actualizar la documentación: cambiar «pendiente de aplicar» (y «PENDIENTE DE APLICAR»,
   «sin aplicar») por «aplicada el AAAA-MM-DD», con los resultados reales, en estos
   archivos; quitar también `pendiente de aplicar` de sus `keywords`
   (`grep -rni "pendiente de aplicar" documentación/` tiene que quedar vacío, salvo las
   menciones de migraciones de otras fases):

   | Archivo | Dónde |
   |---|---|
   | `08-esquema-supabase/despliegue.md` | esta sección (estado, pasos ya hechos), la tabla de Migraciones |
   | `08-esquema-supabase/arquitectura.md` | tabla «Migraciones posteriores» y la línea de aplicadas |
   | `08-esquema-supabase/rls-y-privilegios.md` | «Funciones de la migración 0011» |
   | `08-esquema-supabase/triggers-y-logica.md` | fila de `trg_20_caf_sin_traslape` |
   | `08-esquema-supabase/vault-y-secretos.md` | «CAF de producción y carga manual (Fase 6)» |
   | `03-api-reference/rpc-backend.md` | intro, fila `23P01` de `registrar_caf`, `anular_folios` (estado y verificación), `trg_20_caf_sin_traslape` |
   | `03-api-reference/indice-operaciones.md` | «Folios (Fase 6)»: fila de `anularFolios` y párrafo final |
   | `03-api-reference/acceso-por-tabla.md` | nota 19 y «Verificación» |
   | `02-guias/folios-caf.md` | «Estado (2026-11-15)» (y la tabla «Sin la 0011») y «Anular folios» |
   | `04-objetos/objetos-folios.md` | intro |
   | `04-objetos/codigos-y-enumeraciones.md` | fila de `estado_caf` |
   | `05-pruebas/probar-el-esquema.md` | fila `0011_folios.sql` de §1 y §9 (agregar la corrida en producción) |
   | `06-integraciones/realtime-y-storage.md` | filas de `cafs` y `folios_anulados` en la tabla de publicadas |
   | `07-referencia/trampas-conocidas.md` | «Folios (CAF) (Fase 6)» → «Migración 0011» |
   | `01-fundamentos/errores-y-resultados.md` | «Errores de la base» → «Folios (Fase 6)» |
   | `01-fundamentos/tenancy-y-roles.md` | fila «Pedir folios (CAF), subir un CAF y anular folios» |
   | `README.md` | invariante «Folios», «Fuentes y vigencia» y la nota de actualización |

   Y en `PLAN-SAAS.md`, el estado de la Fase 6 y la fila de `0011_folios` en §6.

### Fase 7: migración 0012

**Estado: aplicada el 2026-11-15**, con autorización del usuario. Antes de migrar:
migraciones `0001`–`0011`, 1 CAF (el de certificación 41–45 de la empresa del piloto), 0
folios anulados y 0 documentos con folio; `tg_validar_documento` era la de la 0001 (mismo
md5 del cuerpo) y la verificación 0012 daba 5/7 (lo esperado). Después:
`supabase/verificaciones/0012_folio_anulado.sql` **7/7**, la simulación
`rls-fase7-folio-anulado.sql` **9/9** y `0011_folios.sql` sigue **18/18**; tras el
`rollback` de la simulación, la limpieza dio todo en 0 (usuarios, perfiles, organización,
empresa, folios anulados, documentos y secretos `caf:11111111-1:%`), `vault.secrets` quedó con
los mismos 4 secretos y el CAF real siguió intacto (`activo`, `siguiente_folio = 41`, 0
anulados).

| Migración | Contenido | Qué falla si falta |
|---|---|---|
| `0012_folio_anulado` | `create or replace function public.tg_validar_documento()` con el cuerpo de la 0001 más: la lectura del CAF con `for key share` (antes de mirar `folios_anulados`, para serializarse con el `for update` de `anular_folios`) y, si el documento fija su folio (INSERT con folio o UPDATE que cambia `folio` o `caf_id`), `23514` si `(caf_id, folio)` está en `folios_anulados`. Mismo trigger (`trg_10_validar_documento`), dueño, `security definer`, `search_path` y privilegios ([triggers](triggers-y-logica.md#tg_validar_documento-migración-0012)) | Un folio asignado y anulado antes de que exista su documento se puede usar igual: el documento entra con un folio que el RCOF informa como anulado |

El número: el plan reservaba `0012` para `notificaciones` (Fase 8); por orden de creación
las siguientes se corren un número (`0013_notificaciones`…).

Resultados en PGlite (esquema 0001 y 0003–0012 con los mismos stubs):

| Prueba | Con la 0012 | Sin la 0012 |
|---|---|---|
| `supabase/verificaciones/0012_folio_anulado.sql` (solo lectura) | 7/7 | 5/7 (2: cuerpo nuevo; 7: migración registrada) |
| `supabase/verificaciones/rls-fase7-folio-anulado.sql` (con `rollback`) | 9/9 | 5/9 (2: el documento entra con el folio anulado; 6, 7 y 9 por lo mismo) |
| Regresiones: `0011_folios.sql`, `rls-fase6-folios.sql`, `rls-fase3-empresas.sql`, `rls-fase4-bloqueos.sql`, `rls-fase5-certificacion.sql`, `rls-fase5-autorizacion-externa.sql`, `rls-fase5-verificar-autorizacion.sql`, verificaciones `0008` y `0006` | 18/18, 27/27, 43/43, 21/21, 16/16, 12/12, 7/7, 10/10, 9/9 | — |

La concurrencia no se puede probar en PGlite (una conexión); el razonamiento del candado
está en el encabezado de la migración y en
[triggers](triggers-y-logica.md#tg_validar_documento-migración-0012). El código de la app
no cambia: el set de pruebas (`envio-set.ts`) inserta los documentos antes de anular sus
folios y después solo cambia `estado`.

Pasos, **con autorización del usuario** (los que se siguieron el 2026-11-15; los resultados,
en el estado de arriba):

1. Leer la migración completa (`supabase/migrations/0012_folio_anulado.sql`).
2. Antes de migrar, la verificación tiene que dar **5/7** (2 y 7 en `false`). Si la 6 sale
   `false`, hay documentos vivos con un folio anulado: revisarlos antes (la 0012 no los
   toca, pero un cambio de folio sobre ellos fallaría).
3. `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn --dry-run`: debe listar **solo
   `0012`**.
4. `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn`.
5. Verificaciones: `supabase/verificaciones/0012_folio_anulado.sql` **7/7**; la simulación
   `rls-fase7-folio-anulado.sql` **9/9** y su consulta de limpieza del encabezado en 0
   (usuarios `folan-%@ejemplo.invalid`, organizaciones `zz-prueba-folio-anulado%`, empresas
   `Empresa folio anulado%`, secretos `caf:11111111-1:%` iguales que antes); de nuevo
   `0011_folios.sql` 18/18.
6. `pnpm db:tipos`: sin diferencias (no cambia firmas).
7. Actualizar la documentación («pendiente de aplicar» → «aplicada el AAAA-MM-DD»):
   esta sección, `08-esquema-supabase/triggers-y-logica.md` (fila de
   `trg_10_validar_documento` y su sección), `03-api-reference/rpc-backend.md`
   («Folio asignado sin documento todavía»), `07-referencia/trampas-conocidas.md` («Folios
   (CAF) (Fase 6)» → «Anulación»), `02-guias/folios-caf.md` («Puntos de enganche para la
   Fase 7»), `05-pruebas/probar-el-esquema.md` (fila `0012_folio_anulado.sql` de §1 y
   §10) y `08-esquema-supabase/arquitectura.md`; en `PLAN-SAAS.md`, la fila de
   `0012_folio_anulado` en §6.

### Fase 8: migraciones 0013 y 0014

**Estado: las dos aplicadas el 2026-11-17, con autorización del usuario: la 0013 antes del
deploy de la Fase 8 y la 0014 después, a las 18:31 UTC.** Antes de migrar: migraciones `0001`–`0012`, sin la tabla `notificaciones`, **0 jobs** en `cron.job`,
el secreto `cron_token` presente en Vault (una fila) y `pg_net.ttl` en 6 horas (consultado
el 2026-11-17). Para aplicar solo la 0013, la 0014 se sacó de `supabase/migrations/`
durante el push (y se devolvió después): `db push --remote=rbrntkztzijaxsnpgpqn --dry-run`
listó solo `0013`, y `db push --yes` la aplicó; `schema_migrations` llega a `0013`.
Después, en producción: `supabase/verificaciones/0013_notificaciones.sql` **18/18** (con
`supabase db query --remote --read-only -f`) y la simulación
`rls-fase8-notificaciones.sql` **26/26**, con la consulta de limpieza del encabezado en 0
antes y después, `vault.secrets` con los mismos 4 secretos antes y después y
`notificaciones` sin filas. `pnpm db:tipos` difiere en 7 líneas de lo agregado a mano (los
retornos de funciones salen no nulos; ver la nota de abajo); se versionó lo generado.

Después, `CRON_SECRET` en Vercel *Production* y el deploy de la Fase 8 (`3ade4c9`, READY,
humo y pantallas con sesión verificados en *Production*). Luego la **0014**: `db push
--remote=rbrntkztzijaxsnpgpqn --dry-run` listó solo `0014` y `db push --yes` la aplicó a
las 18:31 UTC. `supabase/verificaciones/0014_cron.sql` **12/12**, corrida con el MCP
`execute_sql` (rol `postgres`). **Con `supabase db query --remote --read-only` no se puede
correr**: la comprobación 9 (ningún comando con el secreto) descifra `cron_token` para
compararlo y ese rol no tiene permiso, así que falla con `42501` en
`_crypto_aead_det_decrypt`; no es un error de la migración. Cron verificado en producción:
`seguimiento-envios` corrió 3 veces y `alertas` 1, todas `succeeded` en
`cron.job_run_details`, y `net._http_response` con 200 en las dos rutas. La primera corrida
de seguimiento (18:35 UTC) consultó el envío 34015200: el SII respondió EPR (1 informado,
1 aceptado), el documento pasó a `aceptado` y la operación `seguimiento` quedó `ok`.
Alertas: `correo: "configurado"`, 0 correos. Monitores de Sentry `cron-seguimiento` y
`cron-alertas` en `ok`. El criterio de aceptación de la Fase 8 quedó **cumplido el
2026-11-17**, después de desplegar el arreglo de un bug de Realtime en las cargas completas
(`b84a5b2`, deploy `326be87`): la boleta folio 42 (Track ID 34017110) pasó de «Enviado» a
«Aceptado» sin recargar con la corrida de las 19:05 UTC
([guía](../02-guias/seguimiento-envios.md#criterio-de-aceptación-cumplido-el-2026-11-17)).

| Migración | Contenido | Qué falla si falta |
|---|---|---|
| `0013_notificaciones` | Tabla `notificaciones` (una fila por aviso, `clave` única de deduplicación con formato `<tipo>:<id>[:<umbral>]`, `tipo` con formato de evento, `estado` `pendiente`/`enviada`/`fallida`, `intentos` 1–100, `grupo` = `Idempotency-Key` del correo, `datos`, `destinatarios`, `resend_id`, `error` ≤ 500; FK a `organizaciones` en cascada; índice `notificaciones_organizacion`; trigger `trg_90_actualizado_en`). RPC `reclamar_notificacion` (`security definer`), `notificacion_cerrada` y las tres de candidatos `alertas_documentos_rechazados`, `alertas_envios_inciertos`, `alertas_certificados_por_vencer` (`stable`, invoker), todas solo `service_role`. RLS: `lectura` con `es_miembro`; `authenticated` solo `select`; `anon` nada. Sin Realtime ([contratos](../03-api-reference/rpc-backend.md#notificaciones-migración-0013)) | `/api/cron/alertas` no envía ningún correo: no puede leer candidatos ni reclamar (`PGRST202`); cada categoría queda con `error` en el resumen y un aviso en Sentry. El seguimiento y la UI funcionan igual |
| `0014_cron` | Los 4 jobs de `pg_cron`: `seguimiento-envios` (`*/5`, `net.http_post` a `/api/cron/seguimiento`, timeout 300 s), `alertas` (`*/10`, `/api/cron/alertas`, 60 s), `limpiar-tokens-sii` (`17 * * * *`) y `limpiar-historial-cron` (`23 3 * * *`). Bearer leído de `vault.decrypted_secrets` (`cron_token`) en cada corrida; se niega a correr (`55000`) sin `cron_token`; idempotente (desagenda y vuelve a agendar) | No hay seguimiento automático: los envíos solo se actualizan con «Consultar estado en el SII»; no salen alertas; `tokens_sii` y `cron.job_run_details` crecen sin limpieza |

El número: el plan reservaba `0014` para los planes comerciales (Fase 10); por orden de
creación quedaron `0015_planes_comerciales`, `0016_pagos` y `0017_cron_suscripciones`
([Fase 10](#fase-10-migraciones-0015-0016-y-0017)); los índices de FK van en la
`0018_indices_fk` (Fase 13).

**Orden: la 0013 antes del deploy, la 0014 después.** La 0013 es aditiva y el código
anterior no la usa. La 0014 empieza a llamar a las rutas apenas se aplica: antes del deploy
responderían 404 cada 5 minutos (sin daño, pero ruido en `net._http_response` y en los
monitores de Sentry).

Resultados en PGlite (con stubs de `auth`, `vault`, `supabase_migrations`, `cron` y la
publicación; nada toca la base real):

| Prueba | Con la migración | Sin ella |
|---|---|---|
| `supabase/verificaciones/0013_notificaciones.sql` (solo lectura, 18) | 18/18 | 0/18 |
| `supabase/verificaciones/rls-fase8-notificaciones.sql` (con `rollback`, 26) | 26/26 | 1/26 (solo la preparación) |
| `supabase/verificaciones/0014_cron.sql` (solo lectura, 12) | 11/12 (la 1, extensiones `pg_cron` y `pg_net`, no aplica en PGlite) | — |

En producción (2026-11-17): `0013_notificaciones.sql` 18/18,
`rls-fase8-notificaciones.sql` 26/26 y `0014_cron.sql` 12/12 (con `execute_sql` como
`postgres`; con `db query --read-only` la 9 da `42501`).

**Tipos generados y retornos de funciones.** `pnpm db:tipos` marca como no nulas (`string`,
`number`) todas las columnas que devuelven `alertas_documentos_rechazados`,
`alertas_envios_inciertos`, `alertas_certificados_por_vencer` y `reclamar_notificacion`,
porque Postgres no informa la nulabilidad de los retornos de funciones (`returns table` o
`setof`). Con la 0013 eso dio 7 líneas distintas de lo agregado a mano: `cn`,
`dias_restantes`, `nombre_titular`, `rut_titular`, `envio_id`, `folio` y `grupo`. Se versionó
lo generado (typecheck, pruebas de alertas y Biome en verde) y el código de
`server/alertas/` sigue tratando esos campos como posiblemente nulos en tiempo de ejecución.
Al comparar los tipos después de una migración con funciones nuevas, esa diferencia es
esperable y no indica un error de la migración.

Pasos, **con autorización del usuario** (todos se siguieron el 2026-11-17; los resultados,
en el estado de arriba):

1. Leer las dos migraciones completas y revisar el respaldo (panel → *Database → Backups*).
2. Antes de migrar, `0013_notificaciones.sql` tiene que dar **todo `false`** y
   `0014_cron.sql` true solo en 1, 2, 9, 10 y 11 (extensiones, `cron_token`, ningún comando
   con el secreto, nada más llama a `/api/cron`, sin corridas fallidas).
3. **0013**: `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn --dry-run` debe
   listar **solo `0013`**. Para eso la 0014 no puede estar todavía en
   `supabase/migrations/` al hacer el push, o hay que aplicar la 0013 sola (`db push` aplica
   todas las pendientes): moverla fuera de la carpeta antes del push y devolverla después.
   `db push --remote=…`; luego `0013_notificaciones.sql` **18/18**,
   `rls-fase8-notificaciones.sql` **26/26** y su consulta de limpieza del encabezado en 0
   (usuarios `notif-%@ejemplo.invalid`, organizaciones `zz-prueba-notif-fase8%`, empresas
   `Empresa notificaciones fase 8%`, certificados de prueba, notificaciones de prueba;
   secretos `caf:11111111-1:%` iguales que antes); `pnpm db:tipos` comparado con lo
   agregado a mano en `apps/web/src/server/supabase/tipos.ts` (solo puede diferir la
   nulabilidad de los retornos de funciones, ver arriba); *Advisors* (2026-11-17: sin avisos nuevos).
4. **`CRON_SECRET`** en Vercel (*Production*, *Sensitive*), con el mismo valor que
   `cron_token` en Vault (16 caracteres o más; `envCron()` lo exige).
5. **Deploy** de la Fase 8 y humo: `POST /api/cron/seguimiento` y `/api/cron/alertas` sin
   Bearer → 401. Con el Bearer (a mano, sin mostrar el secreto) → 200 con el resumen, pero
   eso ya es una corrida real: consulta el SII (solo lectura) y puede enviar alertas.
6. **0014**: `db push --remote=… --dry-run` debe listar **solo `0014`**; `db push`; luego
   `0014_cron.sql` **12/12** (la 11 solo dice algo pasados unos minutos). Correrla como
   `postgres` (MCP `execute_sql` o SQL Editor), no con `supabase db query --read-only`: la
   comprobación 9 descifra `cron_token` y ese rol da `42501` en `_crypto_aead_det_decrypt`.
7. Después de 10–15 minutos: `net._http_response` con `status_code` 200 en las dos rutas,
   `cron.job_run_details` sin fallas, los monitores `cron-seguimiento` y `cron-alertas` en
   verde en Sentry, y una operación `seguimiento` `ok` en `operaciones_sii`
   ([diagnóstico](../02-guias/seguimiento-envios.md#cómo-diagnosticar)).
8. Actualizar la documentación («pendiente de aplicar» → «aplicada el AAAA-MM-DD», con
   los resultados reales; hecho para las dos el 2026-11-17): esta sección y la tabla de Migraciones,
   `08-esquema-supabase/arquitectura.md`, `rls-y-privilegios.md`, `triggers-y-logica.md`,
   `03-api-reference/rpc-backend.md`, `acceso-por-tabla.md`, `indice-operaciones.md`,
   `02-guias/seguimiento-envios.md` (estado, pg_cron), `05-pruebas/probar-el-esquema.md`
   (§1 y §11), `07-referencia/trampas-conocidas.md` («Seguimiento de envíos (Fase 8)»),
   `07-referencia/checklist-produccion.md`, `README.md` («Fuentes y vigencia»); en
   `PLAN-SAAS.md`, el estado de la Fase 8 y las filas de `0013_notificaciones` y `0014_cron`
   en §6 (`grep -rn "pendientes\? de aplicar" documentación/`).

### Fase 10: migraciones 0015, 0016 y 0017

**Estado: la 0015 y la 0016 aplicadas en producción el 2026-11-18, con autorización del
usuario, antes del deploy de la Fase 10 (`9d2fd8b`); la 0017 aplicada el mismo día, después
del deploy. Criterio de aceptación cumplido el 2026-11-18.** Orden: **`0015` y `0016` antes
del deploy; `0017` después.**

Registro del 2026-11-18:

- Hora antes de migrar, para PITR: **2026-11-18 17:01:47 UTC**.
- Antes de migrar: `0015_planes_comerciales.sql` **1/10** (solo la 7; la 9 salía `false`
  porque la suscripción de `servicio` todavía tenía `periodo_fin`, que la `0015` limpia) y
  `0016_pagos.sql` **0/20**.
- La `0017` se sacó de `supabase/migrations/` durante el push y se devolvió después:
  `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn --dry-run` listó solo `0015` y
  `0016`, y `db push` las aplicó.
- Después: `0015_planes_comerciales.sql` **10/10**, `0016_pagos.sql` **20/20**, y siguen
  `0004_cupo_sin_suscripcion.sql` 3/3 y `0013_notificaciones.sql` 18/18. Simulaciones:
  `rls-fase10-pagos.sql` **30/30** y `rls-fase2-tenancy.sql` (ajustada) **52/52**, con la
  consulta de limpieza en 0 antes y después y los totales de la base iguales
  (`vault.secrets` 4, suscripciones 1, usuarios 2, organizaciones 1, miembros 1).
- La suscripción real de `servicio` quedó en `certificacion`/`prueba` sin `periodo_fin`.
- `pnpm db:tipos` regeneró `apps/web/src/server/supabase/tipos.ts`; solo difiere de lo
  agregado a mano en el orden de `estados_sii` y `eventos_pasarela`.
- *Advisors*: lo nuevo es esperado. `rls_enabled_no_policy` en `eventos_pasarela` (como
  `tokens_sii`) y `unindexed_foreign_keys` en `clientes_pago.plan_pendiente_id`,
  `clientes_pago.plan_pendiente_por`, `eventos_pasarela.organizacion_id` y
  `pagos.suscripcion_id` (van en la `0018_indices_fk` de la Fase 13). `activar_suscripcion`
  no aparece como ejecutable por `anon` ni `authenticated`.

| Migración | Contenido | Qué falla si falta |
|---|---|---|
| `0015_planes_comerciales` | Columnas `planes.autoservicio` y `planes.orden`; grilla D5 con `on conflict (codigo) do update` (`certificacion`, `pyme`, `contador`, `api`, `empresa`; `emprendedor` con `activo = false`); `create or replace` de `crear_organizacion()` sin el `periodo_fin = now() + 30 days` (mismos privilegios); `update` que quita `periodo_fin` a las suscripciones `certificacion`/`prueba` ([grilla](../04-objetos/objetos-tenancy.md#planes)) | La página de plan no puede leer `autoservicio`/`orden` (la consulta de `leerVistaPlan` falla) y siguen los planes de ejemplo de la `0001` |
| `0016_pagos` | Tablas `clientes_pago`, `pagos` y `eventos_pasarela` (RLS, `trg_90_actualizado_en`); columnas `suscripciones.cancelar_al_fin_periodo` y `sincronizada_en`; índice único parcial `suscripciones_externa_unica`; RPC `activar_suscripcion` (solo `service_role`). Sin Realtime ([contrato](../03-api-reference/rpc-backend.md#activar_suscripcion-migración-0016)) | Contratar falla al guardar el cliente (`clientes_pago` no existe) y el retorno de Flow no puede activar el plan (`PGRST202`) |
| `0017_cron_suscripciones` | Job `sincronizar-suscripciones` (`41 * * * *`, `net.http_post` a `https://boleteame.dev/api/cron/suscripciones`, Bearer de `cron_token` leído en cada corrida, timeout 120 s = `maxDuration` de la ruta). Idempotente; se niega a correr (`55000`) sin `cron_token` | La mora, la vuelta a Certificación al terminar una cancelación y los correos de mora no se aplican solos: solo los adelanta el callback de pago |

**Por qué este orden.** La `0015` y la `0016` son aditivas: el código desplegado no lee
las columnas ni las tablas nuevas, y el de la Fase 10 las necesita desde la primera
petición a Configuración → Plan. La `0017` llama a la ruta apenas se aplica: antes del
deploy, `pg_cron` recibiría 404 cada hora (mismo criterio que la `0014`). Con las `FLOW_*`
sin cargar, la ruta responde 503 (después de validar el Bearer): ruido, pero sin efectos.
El horario (`41 * * * *`) también vive en `HORARIO_SUSCRIPCIONES`
(`apps/web/src/server/pagos/constantes.ts`) y en el *cron monitor* `cron-suscripciones` de
Sentry: se cambian juntos.

Resultados en PGlite, antes de aplicar (esquema 0001 y 0003–0016 con stubs; nada toca la
base real). En producción, sin la 0015, la verificación dio 1/10 y no 2/10 por la
`periodo_fin` de `servicio` (arriba):

| Prueba | Con las migraciones | Sin ellas |
|---|---|---|
| `supabase/verificaciones/0015_planes_comerciales.sql` (solo lectura, 10) | 10/10 | 2/10 (7 y 9, que ya se cumplían) |
| `supabase/verificaciones/0016_pagos.sql` (solo lectura, 20) | 20/20 | 0/20 |
| `supabase/verificaciones/rls-fase10-pagos.sql` (con `rollback`, 30) | 30/30 | 2/30 sin ninguna; 3/30 solo con la 0015 |
| Regresiones con la 0015 y la 0016: `rls-fase2-tenancy.sql` (ajustada, ver abajo), `rls-fase3-empresas.sql`, verificación `0004`, `rls-fase8-notificaciones.sql` | 52/52, 43/43, 3/3, 26/26 | — |

La consulta de limpieza de `rls-fase10-pagos.sql` dio todo en 0 en PGlite. Lo que PGlite no
puede probar: que el `for no key update` de `activar_suscripcion` sobre la organización no
frene un insert concurrente en una tabla hija (hace falta una segunda conexión); la
verificación 0016 (19) solo revisa que el cuerpo use ese modo. La `0017` no tiene archivo de
verificación propio.

`rls-fase2-tenancy.sql` cambió en esta fase: su sección 2 sube a la organización de prueba al
plan `empresa` (sin tope) en vez de `pyme`, porque con la grilla de la 0015 Pyme admite 3
usuarios y el lector, cuarto miembro, ya no cabría. Sirve con y sin la 0015. En
`rls-fase3-empresas.sql` solo cambió la cabecera (el alta directa como `postgres` no revisa
el cupo, así que Pyme con 1 empresa no la afecta).

Pasos, **con autorización del usuario** (todos hechos el 2026-11-18; los resultados de 1 a 6,
en el registro de arriba, y los de 7 a 10, en el registro del deploy, la 0017 y el criterio
que sigue a la lista):

1. Leer las tres migraciones completas y revisar el respaldo (panel → *Database → Backups*).
2. Antes de migrar: `0015_planes_comerciales.sql` en **1/10 o 2/10** (la 7; la 9 solo si
   ninguna suscripción de Certificación tiene `periodo_fin`) y `0016_pagos.sql` **0/20**.
   Confirmar que la única suscripción es `certificacion`/`prueba` de `servicio` y que nadie
   está en `emprendedor` (la 0015 no mueve a nadie de plan):
   `select o.slug, p.codigo, s.estado, s.periodo_fin from public.suscripciones s join public.planes p on p.id = s.plan_id join public.organizaciones o on o.id = s.organizacion_id where s.estado in ('prueba','activa','morosa');`
3. Sacar la `0017` de `supabase/migrations/` durante el push (como se hizo con la 0014), para
   que `pnpm exec supabase db push --remote=rbrntkztzijaxsnpgpqn --dry-run` liste **solo
   `0015` y `0016`**; `db push`; devolver la 0017 a la carpeta.
4. Verificaciones, todas `ok = true`: `0015_planes_comerciales.sql` **10/10**,
   `0016_pagos.sql` **20/20**, la simulación `rls-fase10-pagos.sql` **30/30** y su consulta de
   limpieza en 0 ([cómo](../05-pruebas/probar-el-esquema.md#13-simulación-de-planes-y-pagos-de-la-fase-10-rls-fase10-pagossql));
   de nuevo `rls-fase2-tenancy.sql` 52/52.
5. `pnpm db:tipos` y comparar con lo agregado a mano en
   `apps/web/src/server/supabase/tipos.ts` (columnas nuevas de `planes` y `suscripciones`, las
   tres tablas y `activar_suscripcion`); se versiona lo generado.
6. *Advisors*: `rls_enabled_no_policy` en `eventos_pasarela` (INFO) y las 4 FK sin índice de
   las tablas nuevas son **esperados** (índices en la `0018_indices_fk`, Fase 13).
   `activar_suscripcion` no debe aparecer en
   `authenticated_security_definer_function_executable`.
7. `FLOW_API_KEY`, `FLOW_SECRET_KEY` y `FLOW_API_URL=https://sandbox.flow.cl/api` en
   `.env.local` y en Vercel *Production* ([variables](../01-fundamentos/ambientes-y-credenciales.md#pasarela-de-pagos-flow_-fase-10)).
8. **Deploy** de la Fase 10 y humo: `POST /api/cron/suscripciones` sin Bearer → 401;
   `/api/pagos/flow/confirmacion` sin `token` → 400; la página de plan con sesión.
9. **0017**: `db push --remote=… --dry-run` debe listar **solo `0017`**; `db push`. No hay
   verificación SQL propia: comprobar a mano que `cron.job` tiene `sincronizar-suscripciones`
   con `41 * * * *`, activo, como `postgres`, y que su comando no contiene el valor de
   `cron_token`. Después del minuto 41: `cron.job_run_details` `succeeded`,
   `net._http_response` con 200 y el monitor `cron-suscripciones` en verde en Sentry.
   **Ojo:** desde la 0017, la comprobación 10 de `0014_cron.sql` («ningún otro job llama a
   `/api/cron`») sale `false` con detalle `sincronizar-suscripciones`; es esperado (esa
   verificación se escribió para los jobs de la Fase 8).
10. Criterio de aceptación en sandbox ([cómo probar](../02-guias/planes-y-pagos.md#probar-en-el-sandbox-de-flow)).
11. Actualizar la documentación con los resultados reales (hecho el 2026-11-18 para la 0015
    y la 0016 y el 2026-11-19 para el deploy, la 0017 y el criterio): esta sección y la tabla de Migraciones, `rls-y-privilegios.md`,
    `03-api-reference/rpc-backend.md`, `acceso-por-tabla.md`, `indice-operaciones.md`,
    `04-objetos/objetos-tenancy.md`, `01-fundamentos/tenancy-y-roles.md`,
    `ambientes-y-credenciales.md`, `02-guias/planes-y-pagos.md`, `onboarding-organizacion.md`,
    `05-pruebas/probar-el-esquema.md` (§1 y §13), `07-referencia/trampas-conocidas.md`,
    `checklist-produccion.md` y `README.md` (`grep -rn "pendientes\? de aplicar" documentación/`).

Registro del deploy, la 0017 y el criterio (2026-11-18, todo en producción):

- Variables (paso 7): credenciales de Flow **sandbox** en `.env.local` y en Vercel
  *Production* (las cargó el usuario; `FLOW_API_KEY` y `FLOW_SECRET_KEY` *sensitive*,
  `FLOW_API_URL=https://sandbox.flow.cl/api`).
- Deploy (paso 8): `9d2fd8b` `READY`, creado después de las variables `FLOW_*`. Humo sin
  sesión: `/` 200, `/servicio/configuracion/plan` 307 a `/ingresar?siguiente=…`,
  `/api/pagos/flow/registro` sin token 303 a `/bienvenida`, `/api/pagos/flow/confirmacion` sin
  token 400 y `/api/cron/suscripciones` sin Bearer 401. Con sesión, la página de plan muestra
  la grilla con los botones de contratar.
- `0017` (paso 9), aplicada después del deploy (`--dry-run` con solo la 0017): job
  `sincronizar-suscripciones` activo, `41 * * * *`, URL de producción, Bearer leído de Vault,
  timeout 120 s. Corridas de las 17:41, 18:41, 19:41 y 20:41 UTC en `succeeded`; la ruta
  respondió 200 `{revisadas: 0, …, avisos: {candidatas: 0, correoConfigurado: true}}` (aún no
  había suscripciones de Flow). Sin errores de runtime salvo el rechazo de Flow del criterio.
- Criterio (paso 10): cumplido, con el primer intento fallido, los hallazgos corregidos en
  `a1f74eb` y la suscripción de Flow sandbox que queda a propósito en `servicio`
  ([registro](../02-guias/planes-y-pagos.md#criterio-de-aceptación-2026-11-18)).

### Fase 11: migraciones 0018 y 0019

**Estado: la 0018 aplicada en producción el 2026-11-19, antes del deploy de la Fase 11 (`169e2e5`); la 0019 aplicada el mismo día a las 03:54 UTC, después del deploy. Criterio de aceptación cumplido el 2026-11-19.** Orden: **`0018` antes del
deploy de la Fase 11** (la API pública y el cron de webhooks la necesitan); **`0019`
después** (si no, `pg_cron` llamaría cada minuto a una ruta que responde 404).

- `0018_api_webhooks`: tabla `api_idempotencia` (solo `service_role`); RPC
  `autenticar_api_key`, `reclamar_idempotencia`, `terminar_idempotencia`,
  `soltar_idempotencia`, `reclamar_entregas_webhook` y `cerrar_entrega_webhook` (solo
  `service_role`) y `reenviar_entrega_webhook`, `probar_webhook` y `rotar_secreto_webhook`
  (también `authenticated`, verifican `es_admin`); `webhook_entregas.reenviada_en` /
  `reenviada_por` e índices; `encolar_evento` filtra por `plan_vigente().incluye_webhooks`;
  `tg_evento_documento` agrega `estado`, `origen` y `clave_idempotencia`; check
  `webhooks_url_permitida` (`not valid` + `validate`); en `api_keys`, `expira_en` fuera del
  grant de `authenticated` y trigger `trg_10_api_key_sin_reactivar` (revocar es definitivo,
  la expiración no se alarga); `cerrar_entrega_webhook` solo cierra en el intento
  reclamado (`p_intento`); índices `api_keys_organizacion`,
  `webhooks_organizacion`, `operaciones_sii_api_key` y `documentos_api_listado` (sin
  `concurrently`: las tablas son chicas hoy). Contratos en
  [RPC de integraciones](../03-api-reference/rpc-integraciones.md).
- `0019_cron_webhooks`: jobs `entregar-webhooks` (`* * * * *`, Bearer de Vault en cada
  corrida, timeout 60 s), `limpiar-webhook-entregas` (`37 4 * * *`) y
  `limpiar-api-idempotencia` (`47 4 * * *`: claves `terminada` de más de 30 días y
  `en_curso` abandonadas de más de 7). Idempotente; `55000`
  sin `cron_token`. Aplicada el 2026-11-19 (registro abajo).

Pruebas en PGlite (esquema 0001 y 0003–0019 con stubs de `pg_cron` y `pg_net`, en el
scratchpad, sin tocar la base real): `0018_api_webhooks.sql` **23/23** (2/23 sin la 0018),
`rls-fase11-api.sql` **39/39** (3/39 sin la 0018, limpieza en 0), `0019_cron_webhooks.sql`
**8/9** (la 1, extensiones, no aplica en PGlite; 2/9 sin la 0019), y en verde las
simulaciones de las Fases 2 a 10 y las verificaciones 0004, 0011, 0012, 0013, 0015 y 0016.

Comprobado en producción el 2026-11-18 (solo lectura): `webhooks`, `webhook_entregas` y
`api_keys` vacías (el `validate` del check de la URL no puede fallar) y ninguna boleta con
`clave_idempotencia`.

Registro del 2026-11-19 (todo en producción):

- Antes de migrar (03:38 UTC): `0018_api_webhooks.sql` **2/23** (la 20 y la 21), como se
  esperaba; `webhooks`, `webhook_entregas` y `api_keys` vacías; última migración registrada,
  la 0017.
- La `0019` se sacó de `supabase/migrations/` durante el push y se devolvió después. Los dos
  primeros `db push --dry-run` fallaron por red del CLI (`DbConnectError` con *connection
  timed out* y `DbConfigLoginRoleNetworkError`); el tercero listó solo `0018_api_webhooks.sql`.
- `db push --yes` aplicó la `0018` a las 03:40:29 UTC.
- Después: `0018_api_webhooks.sql` **23/23** (con `supabase db query --remote --read-only -f`)
  y la simulación `rls-fase11-api.sql` **39/39** (con `supabase db query --remote --yes -f`:
  el CLI exige `--yes` en modo agente aunque el script termine en *rollback*), con la
  consulta de limpieza en 0 antes y después.
- Regresiones: `rls-fase8-notificaciones.sql` **26/26**, `rls-fase10-pagos.sql` **30/30** y
  las verificaciones `0013_notificaciones.sql` **18/18** y `0016_pagos.sql` **20/20**.
- `pnpm db:tipos` solo difiere de lo agregado a mano en 9 líneas de nulabilidad: el
  generador marca no nulas las columnas de retorno de `autenticar_api_key` y
  `status_http`, `respuesta` y `recurso_id` de `reclamar_idempotencia` (Postgres no informa
  la nulabilidad de los retornos de funciones). Se versionó lo generado; `typecheck` y
  Vitest de la app (1597) en verde; el código trata esos campos como posiblemente nulos.
- *Advisors*: solo lo esperado y nuevo: `rls_enabled_no_policy` en `api_idempotencia` y
  `authenticated_security_definer_function_executable` en `probar_webhook`,
  `reenviar_entrega_webhook` y `rotar_secreto_webhook`. Ninguna de las seis RPC solo
  `service_role` aparece.
- **Deploy** `169e2e5` en `READY` (después de la 0018). Humo: `/api/v1/documentos` sin clave →
  401 `no_autenticado`; con una clave bien formada inexistente → 401 `clave_invalida`;
  `/api/v1/openapi.json` y `/docs/api` → 200; `POST /api/cron/webhooks` sin Bearer → 401;
  `/servicio/configuracion/api` y `/webhooks` sin sesión → 307 a `/ingresar?siguiente=…`. Sin
  errores de runtime.
- **0019 aplicada a las 03:54 UTC**, después del deploy: el `--dry-run` listó solo la
  `0019_cron_webhooks`; `db push --yes`. Verificación `0019_cron_webhooks.sql` **9/9** con el
  MCP `execute_sql` como `postgres`. Primera corrida de `entregar-webhooks` a las 03:55:
  `succeeded`, `net._http_response` 200 con `{reclamadas:0,…,errores:0}`, y el monitor
  `cron-webhooks` de Sentry en `ok` (Production). La comprobación 10 de `0014_cron.sql` queda
  en `false` (esperado, ahora también con `entregar-webhooks`).
- **Firewall de Vercel:** el proyecto no tenía configuración de Firewall (el MCP de Vercel
  responde 404 «Seawall Config not found» y no puede crear la primera regla), así que se creó
  con el CLI: `vercel firewall rules add` y `vercel firewall publish --confirm-name sii
  --effects-digest …`. Regla «API pública: límite por IP»: ruta que empieza con `/api/v1/`,
  `fixed_window` de 60 s, 120 peticiones por IP, acción `rate_limit` (429). Firewall
  `Enabled`, 1 regla activa. El 429 lo responde Vercel, sin cuerpo JSON garantizado
  ([trampa](../07-referencia/trampas-conocidas.md#api-pública-y-webhooks-fase-11)).
- **Criterio de aceptación cumplido** (con el OK del usuario): `servicio` pasó de Contador a
  API con Flow sandbox; clave `sk_test_` de prueba; `webhook.prueba` con firma válida; boleta
  39 folio 43 (Track ID 34120364) emitida por la API y repetida con la misma clave
  (`Idempotent-Replayed: true`); `documento.aceptado` entregado con firma válida. Detalle en la
  [guía](../02-guias/api-publica.md#criterio-de-aceptación-2026-11-19).

Pasos (con el OK del usuario; 1 a 7 hechos el 2026-11-19, los resultados en el registro de
arriba):

1. Anotar la hora para PITR. Correr `0018_api_webhooks.sql` antes de migrar: debe dar
   **2/23** (la 20 y la 21, lo de la 0001).
2. Sacar la `0019` de `supabase/migrations/` durante el push (como la 0014 y la 0017):
   `db push --remote=rbrntkztzijaxsnpgpqn --dry-run` debe listar **solo `0018`**; `db push`.
3. `0018_api_webhooks.sql` **23/23**; `rls-fase11-api.sql` **39/39** con la consulta de
   limpieza en 0 antes y después; regresiones `rls-fase8-notificaciones.sql` y
   `rls-fase10-pagos.sql`; `pnpm db:tipos` y comparar con lo agregado a mano (el generador
   marcará `p_api_key` de `reclamar_idempotencia` como opcional y las columnas de los
   retornos como no nulas).
4. *Advisors*: esperado `authenticated_security_definer_function_executable` para
   `reenviar_entrega_webhook`, `probar_webhook` y `rotar_secreto_webhook` (las llama el
   administrador con su sesión y revisan `es_admin` adentro) y `rls_enabled_no_policy` para
   `api_idempotencia` (diseño). Ninguna de las otras seis debe aparecer.
5. **Deploy** de la Fase 11 y humo: `/api/v1/documentos` sin clave → 401;
   `POST /api/cron/webhooks` sin Bearer → 401.
6. **0019**: devolver el archivo, `--dry-run` debe listar **solo `0019`**; `db push`;
   `0019_cron_webhooks.sql` **9/9** con el MCP `execute_sql` como `postgres` (la 6 descifra
   `cron_token`). Después de un par de minutos: `cron.job_run_details` `succeeded`,
   `net._http_response` con 200 y el monitor `cron-webhooks` de Sentry en verde. La
   comprobación 10 de `0014_cron.sql` sigue en `false` (ahora también con
   `entregar-webhooks`): esperado.
7. Actualizar la documentación con los resultados reales (hecho el 2026-11-19 para la 0018, la
   0019, el deploy, el humo, el Firewall y el criterio; `grep -rn "pendiente de aplicar" documentación/`): esta sección, la tabla de Migraciones y la de Tareas programadas,
   `rls-y-privilegios.md`, `triggers-y-logica.md`, `vault-y-secretos.md`,
   `03-api-reference/rpc-integraciones.md`, `rpc-backend.md`, `acceso-por-tabla.md`,
   `04-objetos/objetos-auditoria-e-integraciones.md` y `05-pruebas/probar-el-esquema.md`
   (§14).

### Fase 12: sin migraciones

El sitio público ([guía](../02-guias/sitio-publico.md)) no agrega migraciones; usa lo que
ya existe:

- La landing lee `planes` como `anon` (clave publicable, sin cookies) gracias a la política
  `lectura` de la 0001 (`using (activo)`); la grilla es la de `0015_planes_comerciales`.
- `/estado` lee con `service_role`, solo conteos con `head: true` y una fecha suelta, sobre
  `operaciones_sii` (por `ambiente`, `resultado`, `operacion` y `terminada_en`) y
  `v_envios_por_consultar`, más una lectura `head` de `planes` para medir la base. Como mucho
  7 lecturas por minuto (`revalidate = 60`).
- **Pendiente para la Fase 13:** `operaciones_sii` no tiene índice por fecha sin
  organización (solo `(organizacion_id, iniciada_en)` y `(empresa_id, operacion,
  iniciada_en)`), así que los conteos de `/estado` recorren la tabla. Cuando haya volumen, una
  migración aditiva con un índice `concurrently` (p. ej. `(terminada_en)` o
  `(ambiente, terminada_en)`), junto con los de `unindexed_foreign_keys`.

Antes del deploy van `NEXT_PUBLIC_APP_URL` (se fija en el build: sitemap, canónica, OG) y
`CORREO_CONTACTO` en Vercel *Production*; después, la regla del Firewall para los POST a
`/contacto` ([checklist](../07-referencia/checklist-produccion.md#sitio-público-fase-12)).

## Requisitos del proyecto

- Postgres 17 (`supabase/config.toml` declara `major_version = 17`).
- Región `sa-east-1` (São Paulo), junto a las funciones de Vercel en `gru1`.
- **Vault** (`supabase_vault`): viene instalado en todo proyecto de Supabase.
- **Realtime**: la publicación `supabase_realtime` existe por defecto; la 0001 le agrega
  `documentos`, `envios` y `procesos_certificacion` (la Fase 4 suma `operaciones_sii` y
  `solicitudes_folios` con la `0006`, aplicada el 2026-11-13; la Fase 6 suma `cafs` y
  `folios_anulados` con la `0011`, aplicada el 2026-11-15).
- **Storage**: la 0001 crea el bucket privado `documentos-xml` (10 MB, XML y PDF).

## Pasos manuales después de la 0002

**`cron_token` en Vault**, con el mismo valor que `CRON_SECRET` en Vercel (no va en una
migración porque es un secreto). SQL Editor:

```sql
select vault.create_secret('<valor>', 'cron_token', 'Bearer para /api/cron/*');
```

Existe en producción (una fila, consultado el 2026-11-17 sin leer su valor). El mismo valor
va en `CRON_SECRET` (Vercel, *Production*, *Sensitive*); la `0014_cron` se niega a correr si
falta `cron_token`. Rotarlo: cambiar el secreto en Vault (`vault.update_secret`) y
`CRON_SECRET` en Vercel, y redesplegar; los jobs lo leen en cada corrida, sin migración.

## Tareas programadas

`pg_cron` + `pg_net` llaman a rutas Node.js de Vercel, no a Edge Functions (la librería es
solo Node). Siempre a la URL de **Production** de Vercel, el único entorno que se usa. Cada
`cron.schedule` se agrega en una migración de la fase que crea su ruta. Los de la Fase 8
están en `0014_cron.sql` (**aplicada el 2026-11-17**, después del deploy;
[arriba](#fase-8-migraciones-0013-y-0014)), con este patrón:

```sql
select cron.schedule(
  'seguimiento-envios', '*/5 * * * *',
  $cron$
  select net.http_post(
    url := 'https://boleteame.dev/api/cron/seguimiento',
    body := '{"origen":"pg_cron"}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets
                                     where name = 'cron_token' limit 1)
    ),
    timeout_milliseconds := 300000
  );
  $cron$
);
```

| Job | Frecuencia (UTC) | Fase | Migración |
|---|---|---|---|
| `seguimiento-envios` → `/api/cron/seguimiento` | `*/5 * * * *` | 8 | `0014_cron` (aplicada) |
| `alertas` → `/api/cron/alertas` (documento rechazado, envío incierto, certificado por vencer; la de folios sale sin cron desde la Fase 6, al cruzar el 15 %) | `*/10 * * * *` | 8 | `0014_cron` (aplicada) |
| `limpiar-tokens-sii` (tokens vencidos hace más de un día) | `17 * * * *` | 8 | `0014_cron` (aplicada) |
| `limpiar-historial-cron` (`cron.job_run_details` de más de 7 días) | `23 3 * * *` | 8 | `0014_cron` (aplicada) |
| `sincronizar-suscripciones` → `/api/cron/suscripciones` (mora, vuelta a Certificación tras cancelar, pagos y correo de mora; timeout 120 s) | `41 * * * *` | 10 | `0017_cron_suscripciones` (aplicada el 2026-11-18, después del deploy) |
| `entregar-webhooks` → `/api/cron/webhooks` (entrega de webhooks con firma HMAC y backoff; timeout 60 s; siempre llama, para el monitor `cron-webhooks`) | `* * * * *` | 11 | `0019_cron_webhooks` (aplicada el 2026-11-19, después del deploy) |
| `limpiar-webhook-entregas` (entregas `entregado`/`descartado` de más de 30 días) | `37 4 * * *` | 11 | `0019_cron_webhooks` (aplicada el 2026-11-19, después del deploy) |
| `limpiar-api-idempotencia` (claves `terminada` de más de 30 días y `en_curso` abandonadas de más de 7) | `47 4 * * *` | 11 | `0019_cron_webhooks` (aplicada el 2026-11-19, después del deploy) |

`net._http_response` no necesita limpieza: `pg_net` borra las respuestas de más de
`pg_net.ttl` (6 horas en este proyecto).
