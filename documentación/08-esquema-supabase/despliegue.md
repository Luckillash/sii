---
title: "Esquema: despliegue"
description: "Cómo se aplican las migraciones en la única base (Supabase en la nube, producción), requisitos (Vault, Realtime, pg_cron, pg_net) y tareas programadas."
keywords: [migraciones, supabase db push, supabase link, producción, una sola base, Vault, pg_cron, pg_net, cron_token, Realtime, Storage, tipos, verificaciones, 0006_realtime_operaciones, 0007_bloqueos_sii, bloqueos_sii, aplicadas, 0008_certificacion, registrar_caf, guardar_set_pruebas, rls-fase5-certificacion, 0009_autorizacion_externa, tg_resolucion_autoriza_produccion, rls-fase5-autorizacion-externa, 0010_verificar_autorizacion, verificar_autorizacion, operacion_sii, rls-fase5-verificar-autorizacion, 0011_folios, anular_folios, trg_20_caf_sin_traslape, tg_caf_sin_traslape, rls-fase6-folios, Fase 6]
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
| `0003_…` en adelante | las previstas en PLAN-SAAS §6 (la `0008_certificacion` y la `0009_autorizacion_externa`, aplicadas el 2026-11-13, y la `0010_verificar_autorizacion`, aplicada el 2026-11-14, son de la Fase 5: ver [abajo](#fase-5-migración-0008); la `0011_folios`, de la Fase 6, se aplicó el 2026-11-15: ver [abajo](#fase-6-migración-0011); la `0012_folio_anulado`, de la Fase 7, se aplicó el 2026-11-15: ver [abajo](#fase-7-migración-0012)) |

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
| alertas (certificado por vencer, folios; la de folios ya sale sin cron desde la Fase 6, al cruzar el 15 %) | diaria | 8 |
| `/api/cron/webhooks` | cada minuto | 11 |
