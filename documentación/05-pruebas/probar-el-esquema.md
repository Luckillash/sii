---
title: "Probar el esquema (RLS, triggers, cuotas)"
description: "Cómo verificar el esquema y simular roles en la única base (producción) sin dejar rastro."
keywords: [verificaciones, solo lectura, producción, RLS, set local role, request.jwt.claims, auth.uid, auth.role, rollback, service_role, authenticated, anon, simulación de roles, rls-fase2-tenancy.sql, rls-fase3-empresas.sql, 0005_certificados_resoluciones.sql, ejemplo.invalid, pg_temp, 0006_realtime_operaciones.sql, 0007_bloqueos_sii.sql, rls-fase4-bloqueos.sql, bloqueos_sii, arriendo, 0008_certificacion.sql, rls-fase5-certificacion.sql, registrar_caf, guardar_set_pruebas, CAF de mentira, 0009_autorizacion_externa.sql, rls-fase5-autorizacion-externa.sql, tg_resolucion_autoriza_produccion, autorizada_produccion, 0010_verificar_autorizacion.sql, rls-fase5-verificar-autorizacion.sql, verificar_autorizacion, PGlite, 0011_folios.sql, rls-fase6-folios.sql, anular_folios, trg_20_caf_sin_traslape, 23P01, 0012_folio_anulado.sql, rls-fase7-folio-anulado.sql, tg_validar_documento, folio anulado, for key share, 0013_notificaciones.sql, rls-fase8-notificaciones.sql, notificaciones, reclamar_notificacion, 0014_cron.sql, pg_cron, cron_token, fase9-tablero-control.sql, consulta de control, Tablero, Fase 9, Fase 10, 0015_planes_comerciales.sql, 0016_pagos.sql, rls-fase10-pagos.sql, activar_suscripcion, clientes_pago, pagos, eventos_pasarela, rls-fase11-api.sql, migración 0018, api_idempotencia, webhook_entregas]
related: ["08-esquema-supabase/rls-y-privilegios.md", "08-esquema-supabase/despliegue.md", "02-guias/tablero-y-reportes.md", "02-guias/planes-y-pagos.md"]
source: ["supabase_saas_sii.sql §15 §17", "supabase/verificaciones/", "supabase/verificaciones/rls-fase2-tenancy.sql", "supabase/verificaciones/fase9-tablero-control.sql", "supabase/verificaciones/rls-fase10-pagos.sql", "supabase/verificaciones/rls-fase11-api.sql", "supabase/verificaciones/0018_api_webhooks.sql"]
---

# Probar el esquema (RLS, triggers, cuotas)

> **Úsalo cuando:** necesitas verificar que una migración quedó bien, o que RLS o un trigger se comportan como se espera.

La única base es el proyecto de Supabase en la nube, que es **producción**
([despliegue](../08-esquema-supabase/despliegue.md)). No hay base local ni de pruebas, así
que todo lo de esta página está pensado para correr sobre datos reales sin cambiarlos.

## 1. Verificaciones de solo lectura (después de cada migración)

`supabase/verificaciones/<migración>.sql`: un `select` que devuelve una fila por
comprobación con `ok = true/false` y, si falla, el `detalle`. No escribe nada.

| Archivo | Qué verifica |
|---|---|
| `0001_esquema.sql` | las 33 tablas; RLS activo en todas; `tokens_sii` y `sesiones_sii` sin políticas ni privilegios para `anon`/`authenticated`; `token_guardar` y `leer_secreto` fuera del alcance de la API y disponibles para `service_role`; Vault, `pg_cron` y `pg_net`; bucket privado; publicación de Realtime; `tipos_dte` = 39 y 41 |
| `0005_certificados_resoluciones.sql` | 15 comprobaciones: las 3 funciones con su firma, nombres de parámetros, `plpgsql`, `security definer` solo en `registrar_certificado`, `search_path` vacío; `registrar_certificado` solo para `service_role`; las otras dos para `authenticated` y `service_role`, no `anon`; `certificados` sin políticas de escritura; `trg_borrar_secretos`; herencia de `organizacion_id`; privilegios que necesitan las funciones invoker; índices parciales; migración registrada. Aplicada el 2026-11-13: 15/15 `ok` |
| `0006_realtime_operaciones.sql` | 9 comprobaciones: `supabase_realtime` existe y publica `insert`/`update`/`delete`; `operaciones_sii` y `solicitudes_folios` están en ella; las tres de la 0001 siguen publicadas; RLS activo; política `lectura` (`select`, `authenticated`, `es_miembro(organizacion_id)`); `select` para `authenticated`; nada para `anon`; *replica identity* por defecto; migración registrada. Aplicada el 2026-11-13: 9/9 `ok` (antes de migrar daba 7/9) |
| `0007_bloqueos_sii.sql` | 14 comprobaciones: `bloqueos_sii` con sus 5 columnas y tipos; PK `(certificado_id, ambiente)`; FK a `certificados` en cascada; RLS activo sin políticas; nada para `anon`/`authenticated`; las 2 funciones con su firma y `boolean`; nombres de parámetros (los que usa `bloqueos.ts`); `plpgsql`, `security definer`, `search_path` vacío; solo `service_role` las ejecuta; el `insert … on conflict` con la condición del arriendo; migración registrada; el índice único y válido `operaciones_sii_efecto_global_en_curso` sobre `(empresa_id, operacion, ambiente)`; su predicado (`en_curso`, `confirmada` y exactamente `solicitar_folios`, `postular`, `declarar`, como `OPERACIONES_EFECTO_GLOBAL`). Aplicada el 2026-11-13: 14/14 `ok` (antes de migrar daba todo `false`) |
| `0008_certificacion.sql` | 10 comprobaciones: `registrar_caf` y `guardar_set_pruebas` existen con su firma (`to_regprocedure`); devuelven `uuid` e `integer`; nombres de parámetros (los que usa `server/certificacion` al llamar por RPC); `plpgsql`, `security definer`, `search_path` vacío; `service_role` las ejecuta; `authenticated`, `anon` y `PUBLIC` no; cuerpos (Vault con `guardar_secreto` tras `for no key update`, idempotencia por `folio_hasta`, `unique_violation`, filtro por organización; borrado e inserción de casos, `set_descargado`, `envio_set_id = null`); migración registrada como `0008`. Aplicada el 2026-11-13 ([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0008)): 10/10 `ok` (antes de migrar daba todo `false`) |
| `0009_autorizacion_externa.sql` | 9 comprobaciones: `tg_resolucion_autoriza_produccion()` existe y devuelve `trigger`; `plpgsql`, `security definer`, `search_path` vacío; sin `EXECUTE` para PUBLIC, `anon` ni `authenticated`; cuerpo (marca `autorizada_produccion` y `coalesce(autorizada_en, now())` filtrando por empresa y organización, sin desmarcar); trigger `trg_50_resolucion_autoriza_produccion` en `resoluciones` (`after`, por fila, `insert` y `update`, activo); su `WHEN` (producción y vigente); `trg_05_proteger_autorizacion` sigue en `empresas`; ninguna empresa con resolución de producción vigente queda sin autorizar; migración registrada como `0009`. Aplicada el 2026-11-13: 9/9 `ok` ([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0009)); en PGlite: 9/9 con la 0009, 2/9 sin ella |
| `0010_verificar_autorizacion.sql` | 6 comprobaciones: `operacion_sii` tiene `verificar_autorizacion`; es el último valor, justo después de `seguimiento`; los 15 anteriores siguen en su orden (16 en total); el índice único `operaciones_sii_efecto_global_en_curso` (0007) sigue válido y con exactamente `solicitar_folios`, `postular` y `declarar`; ninguna fila `verificar_autorizacion` abandonada en curso (más de 15 minutos); migración registrada como `0010`. Usa `operacion::text` para poder correr antes de migrar. Aplicada el 2026-11-14: 6/6 `ok` ([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0010)); en PGlite: 6/6 con la 0010, 2/6 sin ella |
| `0011_folios.sql` | 18 comprobaciones: 1–9 de `anular_folios` (firma `(uuid, integer, integer, text)` y `integer` con `to_regprocedure`; nombres de parámetros `p_caf`, `p_desde`, `p_hasta`, `p_motivo`; `plpgsql`, `security definer`, `search_path` vacío; la ejecutan `service_role` y `authenticated`, no `anon` ni PUBLIC; comentario; cuerpo: permiso `service_role` o `es_admin`, `for update`, documentos no anulados con `23503`, `on conflict`, cierre del CAF en la cola completa); 10–11 del trigger (`tg_caf_sin_traslape()` `security definer` con `for no key update` y `23P01`, sin `EXECUTE` para PUBLIC, `anon` ni `authenticated`; `trg_20_caf_sin_traslape` en `cafs`: `before`, por fila, `insert` y `update of` las 5 columnas, activo); 12 ningún par de CAF traslapado en los datos; 13–14 `folios_anulados` sin la política `alta` (solo `lectura`) y `authenticated` sin `insert`, `update`, `delete` ni `truncate` (sí `select`), `anon` sin nada; 15 `cafs` y `folios_anulados` en `supabase_realtime` (`insert`/`update`/`delete`) sin sacar a las 5 de la 0001 y la 0006; 16 Realtime aplica RLS en las dos (RLS activo, `lectura` con `es_miembro`, `select` para `authenticated`, nada para `anon`, *replica identity* por defecto); 17 `cafs` sin columnas de XML ni llave (`caf_secret_id` es un uuid); 18 migración registrada como `0011`. Aplicada el 2026-11-15: 18/18 `ok` ([despliegue](../08-esquema-supabase/despliegue.md#fase-6-migración-0011)); antes de migrar daba 3/18 (12, 16 y 17), igual que en PGlite sin la 0011 (18/18 con ella) |
| `0012_folio_anulado.sql` | 7 comprobaciones: `tg_validar_documento()` existe, devuelve `trigger`, `plpgsql`, `security definer`, `search_path` vacío; cuerpo de la 0012 (lee el CAF con `for key share` **antes** de `folios_anulados`, solo cuando el documento fija su folio —`new.folio is distinct from old.folio` o `new.caf_id is distinct from old.caf_id`—, `23514`); conserva las reglas de la 0001 (CAF obligatorio, ambiente y tipo, rango, P91 y plan); sin `EXECUTE` para PUBLIC, `anon` ni `authenticated`; `trg_10_validar_documento` sin cambios (`before`, por fila, `insert` y `update of` `ambiente`, `caf_id`, `folio`, `tipo_dte`); ningún documento vivo con folio anulado; migración registrada como `0012`. Aplicada el 2026-11-15: 7/7 `ok` ([despliegue](../08-esquema-supabase/despliegue.md#fase-7-migración-0012)); antes de migrar daba 5/7 (2 y 7 en `false`), igual que en PGlite sin la 0012 (7/7 con ella) |
| `0013_notificaciones.sql` | 18 comprobaciones: 1–8 la tabla `notificaciones` (15 columnas con sus tipos y `not null`; PK y clave única; FK a `organizaciones` en cascada; los `check` de tipo, clave, estado, enviada con fecha, intentos, datos, destinatarios y textos; índice `notificaciones_organizacion`; trigger `trg_90_actualizado_en`; RLS con una sola política `lectura`; `authenticated` solo lee, `anon` nada, `service_role` escribe); 9–13 `reclamar_notificacion` (las 5 funciones con su firma; nombres de parámetros; `plpgsql`, `security definer`, `search_path` vacío; solo `service_role` ejecuta las 5; cuerpo con `on conflict`, misma organización, menos de 5 intentos, fallida o pendiente de más de 15 minutos y el `grupo`); 14–17 `notificacion_cerrada` y las de candidatos (negación de reclamar; `sql`, `stable`, invoker, `search_path` vacío; excluyen lo avisado y reparten por turnos; umbral 1/7/15/30); 18 fuera de Realtime y migración registrada. **Aplicada el 2026-11-17**: en producción 18/18 (antes de migrar sale todo `false`); en PGlite 18/18 con la 0013 y 0/18 sin ella |
| `0014_cron.sql` | 12 comprobaciones (no muestra el secreto: de Vault solo cuenta filas, y la 9 compara dentro de la consulta): 1 `pg_cron` y `pg_net`; 2 `cron_token` existe una vez; 3 los 4 jobs con su horario; 4–5 los dos `net.http_post` (URL de *Production*, JSON, Bearer leído de `vault.decrypted_secrets` en tiempo de ejecución, timeout; ningún literal después de `'Bearer '`); 6–7 las dos limpiezas; 8 activos, base y usuario `postgres`; 9 ningún job contiene el valor de `cron_token`; 10 nada más llama a `/api/cron`; 11 sin corridas fallidas en la última hora; 12 migración registrada. **Aplicada el 2026-11-17**: en producción 12/12, corrida con el MCP `execute_sql` (rol `postgres`); con `supabase db query --read-only` falla la 9, que descifra `cron_token` (`42501` en `_crypto_aead_det_decrypt`). Antes de migrar salen true 1, 2, 9, 10 y 11; en PGlite 11/12 (la 1 no aplica). Además, después de aplicarla, mirar `net._http_response` y los monitores de Sentry (2026-11-17: 200 en las dos rutas y los dos monitores en `ok`). **Desde la `0017_cron_suscripciones` la 10 sale `false`** con detalle `sincronizar-suscripciones`: es esperado |
| `0015_planes_comerciales.sql` | 10 comprobaciones: 1–2 columnas `autoservicio` (`boolean not null default false`) y `orden` (`smallint not null default 0`) de `planes`; 3–6 la grilla (los 5 planes activos con sus valores, comparados con `to_jsonb(p) @>`; `emprendedor` inactivo; solo `pyme`, `contador` y `api` de autoservicio; la política `lectura` sigue ocultando los inactivos); 7–8 `crear_organizacion` (sin el plazo de 30 días; mismos privilegios); 9 ninguna suscripción de Certificación con `periodo_fin`; 10 migración registrada. **Aplicada el 2026-11-18**: en producción 10/10 (antes de migrar daba 1/10, solo la 7: la 9 salía `false` porque la suscripción de `servicio` todavía tenía `periodo_fin`); en PGlite 10/10 con la 0015 y 2/10 sin ella (7 y 9) |
| `0016_pagos.sql` | 20 comprobaciones: 1–3 `clientes_pago` (columnas; PK, único y FK; `check`); 4–7 `pagos` (columnas; llaves y FK; `check`; índice `pagos_organizacion`); 8–9 `eventos_pasarela` (columnas; llaves, FK y `check`); 10 triggers `trg_90_actualizado_en`; 11–12 RLS y políticas (`es_admin`; ninguna en `eventos_pasarela`); 13 privilegios; 14–15 `suscripciones` (columnas nuevas e índice único parcial `suscripciones_externa_unica`); 16–19 `activar_suscripcion` (firma, `security definer` y `search_path`, solo `service_role`, cuerpo con `for no key update`); 20 fuera de Realtime y migración registrada. **Aplicada el 2026-11-18**: en producción 20/20 (antes de migrar, 0/20); en PGlite 20/20 con la 0016 y 0/20 sin ella. Ojo: en `suscripciones` la columna es `proveedor_pago`; en las tablas nuevas, `proveedor` |

Se ejecuta pegándolo en el SQL Editor o con el MCP `execute_sql`. Cada migración nueva trae
el suyo. `supabase db query --remote --read-only -f` sirve para las que no leen secretos;
`0014_cron.sql` no, porque su comprobación 9 descifra `cron_token` desde
`vault.decrypted_secrets` y ese rol no tiene permiso (`42501` en
`_crypto_aead_det_decrypt`): córrela como `postgres`.

## 2. Simular roles sin dejar rastro

Para probar una política o un trigger se usa una transacción que **siempre** termina en
`rollback`: nada de lo que pasa adentro queda en la base.

```sql
begin;

-- Como un usuario concreto (lo que lee auth.uid()):
set local role authenticated;
set local request.jwt.claims = '{"sub": "<uuid del usuario>", "role": "authenticated"}';
select count(*) from public.empresas;            -- solo las de sus organizaciones

-- Como el backend:
reset role;
set local role service_role;
select * from public.token_obtener('rest', 'certificacion', '76543210-3', repeat('a', 64));

rollback;   -- obligatorio: nunca commit en una prueba
```

Reglas para hacerlo en producción:

- Empezar con `begin;` y terminar con `rollback;`. Si la sesión se corta a mitad, Postgres
  descarta la transacción sola.
- No llamar dentro de la prueba a nada con efectos fuera de la base: `net.http_post`
  (`pg_net` envía la petición aunque después haya `rollback`) ni funciones que la
  disparen. Tampoco programar `cron.schedule`.
- Las pruebas que escriben, y bloquean filas mientras duran, se hacen cortas y fuera de
  horas de uso.
- Usar RUT de prueba con DV válido (el dominio `rut` lo exige): `76543210-3`,
  `11111111-1`, `66666666-6`.

## 3. Simulación de roles de la Fase 2 (`rls-fase2-tenancy.sql`)

`supabase/verificaciones/rls-fase2-tenancy.sql` es la prueba SQL del criterio de
aceptación de la Fase 2: dos organizaciones no se ven entre sí y un lector no crea
borradores. A diferencia de las verificaciones de §1, **escribe**, pero todo dentro de
`begin; … rollback;`.

### Qué hace

1. Crea seis usuarios ficticios en `auth.users` con ids fijos
   `00000000-0000-4000-8000-0000000000a1` … `a5` y `…b1`, y correos `@ejemplo.invalid`
   (dominio reservado: nunca recibe correo). En este proyecto la única columna
   obligatoria de `auth.users` es `id`; el script pasa también `email`, `aud`, `role` y
   `raw_user_meta_data`. `trg_nuevo_usuario` crea cada perfil.
2. Simula cada sesión con `request.jwt.claims` local a la transacción y
   `set local role authenticated` (o `anon`). En este proyecto `auth.uid()` lee
   `request.jwt.claim.sub` o, si no está, `request.jwt.claims ->> 'sub'`; `auth.role()`
   lee el `role` de los mismos claims. Hay que poner `"role":"authenticated"` en los
   claims: `tg_limite_empresas`, `tg_limite_usuarios` y otros triggers miran
   `auth.role()`, no el rol de Postgres. Para volver a `postgres` entre sesiones:
   `reset role`.
3. A y B crean su organización con `crear_organizacion()`. A invita a un administrador, un
   emisor y un lector, que aceptan con `aceptar_invitacion()`. El plan Certificación
   permite 2 usuarios, así que el script comprueba que el tercero choca con el cupo y
   luego, como `postgres` (el backend), sube a A al plan Empresa (sin tope) para completar
   el equipo. Hasta la Fase 10 era Pyme; con la grilla de la `0015` Pyme admite 3 usuarios y
   el lector, cuarto miembro, ya no cabría. Con Empresa el script sirve con y sin la 0015.
4. Cada comprobación escribe una fila en la tabla temporal `resultados(n, verificacion,
   ok, detalle)` mediante `pg_temp.registrar()`. Los errores esperados se capturan con
   bloques `do $$ … exception when insufficient_privilege | raise_exception |
   check_violation … $$`: un fallo esperado cuenta como `ok = true`.
5. El `select` final muestra todas las filas y el `rollback` deshace todo.

Los ids que pasan de un paso a otro (organizaciones, empresas, tokens) van en parámetros
locales `prueba.*` (`set_config(…, true)`), que cualquier rol puede leer con
`current_setting`. La tabla temporal y `pg_temp.registrar` se conceden a `authenticated`
y `anon` para que las sesiones simuladas puedan anotar resultados.

### Qué comprueba

| # | Grupo | Comprobaciones |
|---|---|---|
| 1–3 | Alta | perfil automático; el creador queda propietario; suscripción `certificacion`/`prueba` |
| 4–9 | Invitaciones | token guardado solo como sha256 y correo en minúsculas; no se invita como propietario (`23514`); aceptar devuelve la organización; cupo de usuarios del plan; equipo completo; `aceptada_en` |
| 10–17 | Invitaciones que fallan | otro correo, token inventado, token ya aceptado y token vencido (`42501 Invitación inválida o vencida`); un ajeno, un lector y un emisor no invitan (`42501 Sin permiso`); un administrador sí |
| 18–20 | Empresas | el propietario crea una; `autorizada_produccion` se fuerza a `false`; tope de 1 empresa en Certificación |
| 21–27 | Borradores | el lector no crea borradores ni empresas (`42501`); el emisor sí crea borradores y `organizacion_id` se hereda de la empresa; el emisor no crea empresas ni ejecuta `asignar_folio`; el lector ve pero no edita ni borra (0 filas); B no escribe en una empresa de A |
| 28–34 | Aislamiento | B no ve organizaciones, miembros, invitaciones, suscripciones, perfiles, empresas ni documentos de A, y viceversa; cada uno ve solo lo suyo; el lector no ve invitaciones; el administrador sí |
| 35–40 | Roles | el administrador no asciende a nadie a propietario, no degrada ni quita a un propietario, no da de alta un propietario y no borra la organización; sí cambia el rol de un no propietario |
| 41–44 | Último propietario | el único propietario no sale ni se degrada; tras nombrar a otro, sí; el propietario borra su organización (la cascada no choca con la regla) |
| 45–47 | anon | permiso denegado en las 8 tablas de tenancy; no ejecuta `crear_organizacion` ni `aceptar_invitacion`; sí lee `planes` |
| 48–51 | `ver_invitacion` | token correcto devuelve la fila; token malo, ya aceptado o vencido devuelve cero filas. Solo si `to_regprocedure('public.ver_invitacion(text)')` existe (migración 0003); si no, `ok = null` y detalle «omitida». La fila 52 solo aparece (con `ok = false`) si `ver_invitacion` lanza un error inesperado |
| 53 | Suscripción morosa | como `postgres`, A pasa a `morosa` (en Empresa, sin tope de usuarios: el cupo no es el motivo) y se reabre la invitación de `vencida-a`; `aceptar_invitacion` rechaza con «La organización no tiene una suscripción vigente» (migración 0004). Sin 0004 sale `ok = false` |

### Cómo correrlo sin dejar datos

1. Ejecuta el archivo **completo**, tal cual, con el MCP `execute_sql` o en el SQL Editor
   (como `postgres`). El MCP pide confirmación porque el texto escribe; devuelve el
   resultado del último `select`, que es la tabla de resultados.
2. Todas las filas deben salir `ok = true` (o `null` en las omitidas). Si una sale
   `false`, el `detalle` dice qué pasó; corrige el script si el error es suyo, y si es del
   esquema, repórtalo: el script no se cambia para que pase.
3. Confirma que no quedó nada:

   ```sql
   select
     (select count(*) from auth.users where email like '%@ejemplo.invalid') as usuarios,
     (select count(*) from public.perfiles where correo like '%@ejemplo.invalid') as perfiles,
     (select count(*) from public.organizaciones where slug like 'zz-prueba-rls%') as organizaciones,
     (select count(*) from public.invitaciones where correo like '%@ejemplo.invalid') as invitaciones;
   -- todo en 0
   ```

Si la ejecución se corta a mitad, Postgres descarta la transacción completa. Nunca cambies
el `rollback` final por `commit`, ni ejecutes el archivo por partes.

Resultado de la última corrida en producción (2026-11-12, con 0003 y 0004 aplicadas): 52 de
52 en `ok = true` (1–51 y 53; la 52 no aparece). La consulta de control dio 0 en todo. Con el
ajuste de la Fase 10 (plan Empresa): en PGlite con la 0015 y la 0016, 52/52; en producción,
el 2026-11-18 con las dos aplicadas, 52/52 y la consulta de control en 0.

## 4. Simulación de roles de la Fase 3 (`rls-fase3-empresas.sql`)

`supabase/verificaciones/rls-fase3-empresas.sql` prueba el criterio de la Fase 3 con el
mismo patrón que la de la Fase 2 (usuarios `@ejemplo.invalid`, claims locales,
`pg_temp.registrar`, `rollback` final). **Requiere la migración 0005 aplicada**: sin
ella se detiene con `42883` y la transacción se descarta completa, sin resultados.
Corrida en producción el 2026-11-13: 43/43 con `ok = true`, y la consulta de control del
encabezado en 0 (el `rollback` no dejó datos ni secretos de prueba).

Diferencias con la de la Fase 2: cinco usuarios (`…a1`–`a4` en A, `…b1` en B); A pasa a
Pyme y su equipo se da de alta directo como `postgres` (las invitaciones ya las prueba
la Fase 2; el alta directa como `postgres` no revisa el cupo, así que los 3 usuarios de
Pyme en la grilla de la `0015` no la afectan: 43/43 en PGlite con la 0015 y la 0016); B
queda en Certificación. Crea certificados de prueba con huellas
`repeat('a', 64)` y `repeat('b', 64)` y dos secretos de prueba por certificado en Vault,
que el `rollback` también deshace. De `vault.secrets` solo cuenta filas y mira ids y
descripciones, nunca el contenido. Anota el texto completo de cada error de
`registrar_certificado` para comprobar que no arrastra la clave ni el base64.

| # | Grupo | Comprobaciones |
|---|---|---|
| 1 | Preparación | A (Pyme) con los cuatro roles; B en Certificación |
| 2–12 | Empresas | tope de 1 empresa en Certificación; el administrador crea y edita en A; `autorizada_produccion` forzada a `false` y no editable; no crea ni edita en B; emisor y lector no crean ni editan (el lector sí ve) |
| 13–20 | `registrar_resolucion` | crea la vigente y hereda `organizacion_id`; reemplaza la vigente (una sola por ambiente); producción no toca certificación; número ≠ 0 en certificación (`23514`); emisor y lector (`42501`); administrador de otra organización (`P0002`); las vigentes no cambian tras los fallos |
| 21–30 | `registrar_certificado` | crea la fila y 2 secretos con descripciones `certificado:<huella>:pfx` y `:clave`; misma huella en otra organización; huella repetida (`23505`, sin secretos nuevos); huella inválida y RUT inválido (`22023`); organización inexistente (`23503`); ningún error contiene la clave ni el base64; `authenticated` no la ejecuta ni inserta, edita o borra certificados |
| 31–39 | Predeterminado | asociar (organización heredada); fijar, cambiar y repetir deja uno solo; no se asocia un certificado de B; no asociado (`P0002`); emisor y lector (`42501`); entre organizaciones (`P0002`); el predeterminado no cambia tras los fallos |
| 40 | anon | sin `execute` en las tres funciones |
| 41 | Borrado | borrar el certificado borra sus 2 secretos y su asociación |
| 42–43 | Vista | el lector de A ve su certificado `por_vencer` y nada de B; B ve solo el suyo y nada de A |

La consulta de control (todo en 0) está en el encabezado del archivo: usuarios
`@ejemplo.invalid`, organizaciones `zz-prueba-rls-fase3%`, certificados con esas dos
huellas y secretos con esas descripciones.

## 5. Simulación del bloqueo de la Fase 4 (`rls-fase4-bloqueos.sql`)

`supabase/verificaciones/rls-fase4-bloqueos.sql` prueba el criterio del bloqueo con
arriendo: dos peticiones no abren sesiones AUT2000 en paralelo con el mismo certificado y
ambiente; y el índice único parcial de `operaciones_sii`: dos operaciones de efecto global
iguales no quedan `en_curso` a la vez. **Requiere la migración 0007 aplicada** (en producción desde el 2026-11-13): sin ella se
detiene con `42P01` (`relation … does not exist`) o `42883` y la transacción se descarta
completa, sin resultados.

Mismo patrón que las de las Fases 2 y 3 (`request.jwt.claims` y `set local role` por rol,
`pg_temp.registrar`, parámetros locales `prueba.*`, `rollback` final). Crea como
`postgres` una organización (`zz-prueba-bloqueos-fase4`) y un certificado de prueba con
huella `repeat('c', 64)`, **sin secretos en Vault** (los ids de los secretos son
aleatorios y no apuntan a nada). Usa dos titulares fijos (`…0001` y `…0002`), como los que
genera `bloqueos.ts`. Dentro de una transacción `now()` no avanza: el arriendo vencido se
simula moviendo `vence_en` al pasado como `postgres`, y la renovación se distingue moviendo
`tomado_en`.

| # | Grupo | Comprobaciones |
|---|---|---|
| 1 | Preparación | organización y certificado de prueba, sin bloqueos |
| 2–5 | Tomar (como `service_role`) | el titular 1 toma el libre (`true`, vence en 60 s); el titular 2 no lo toma mientras está vigente (`false`, la fila no cambia); el titular 1 renueva (`true`, 300 s, conserva `tomado_en`); el mismo certificado en producción es otro bloqueo |
| 6 | Arriendo vencido | con el del titular 1 vencido, el titular 2 lo toma (`tomado_en` nuevo) |
| 7–9 | Liberar | el titular 1 (vencido) no libera el del titular 2; el titular 2 libera (`true`) y liberar otra vez da `false`, producción sigue tomado; liberado, cualquiera lo vuelve a tomar |
| 10–12 | Validaciones | `p_segundos` 0, 901, negativo o nulo → `22023`; sin titular, certificado o ambiente → `22004`; certificado inexistente → `23503` |
| 13–15 | `authenticated` y `anon` | no ejecutan tomar ni liberar ni leen `bloqueos_sii`; sus intentos no cambiaron el bloqueo |
| 16 | Cascada | borrar el certificado borra sus bloqueos de los dos ambientes |
| 17–18 | Índice único de efecto global (como `service_role`, sobre una empresa de prueba) | dos `solicitar_folios` confirmadas `en_curso` de la misma empresa y ambiente: la segunda da `23505` con el nombre del índice; `postular` y `declarar` chocan igual; la misma operación en el otro ambiente no |
| 19–21 | Lo que no choca | ensayos (`confirmada = false`) y operaciones fuera de la lista (`emitir`, `enviar_set`); cerrada la que estaba en curso (`incierto`), otra entra y las filas cerradas no chocan (por eso `ejecutarOperacion` vuelve a revisar después de insertar); sin empresa (`empresa_id` nulo) no chocan (lo cubre `ejecutarOperacion` con `uso`) |

Cómo correrlo: el archivo **completo**, tal cual, con el MCP `execute_sql` o en el SQL
Editor (como `postgres`); nunca por partes ni cambiando el `rollback` por `commit`. Debe dar
21/21 con `ok = true` (sin el índice, 17 y 18 salen `false`). Después, la consulta de
control del encabezado (organizaciones con ese slug, certificados con esa huella, la
empresa de prueba y `bloqueos_sii`) en 0; `bloqueos` puede no ser 0 si
la app ya está tomando bloqueos reales: basta con que ninguno sea del certificado de
prueba.

Corrida en producción el 2026-11-13, después de aplicar la 0006 y la 0007: 21/21 `ok`; tras
el `rollback`, la consulta de limpieza dio todo en 0 (organizaciones, certificados,
empresas, bloqueos y operaciones).

## 6. Simulación de las RPC de la Fase 5 (`rls-fase5-certificacion.sql`)

`supabase/verificaciones/rls-fase5-certificacion.sql` prueba las dos RPC de la migración
0008: el XML del CAF entra a Vault y su fila a `cafs` en la misma transacción (con la
solicitud de folios enlazada y `timbrada`); repetir el mismo CAF devuelve el mismo id sin
crear otro secreto; un CAF inválido se rechaza sin dejar secretos huérfanos; el set de
pruebas se reemplaza completo junto con el proceso; y nada de esto lo ejecutan
`authenticated` ni `anon`. **Requiere la migración 0008 aplicada** (en producción desde el
2026-11-13): sin ella se detiene con `42883` y la transacción se descarta completa, sin
resultados.

Mismo patrón que las de las Fases 2 a 4 (`set local role` por rol, `pg_temp.registrar`,
parámetros locales `prueba.*`, `rollback` final), pero **sin usuarios**: como `postgres`
crea dos organizaciones (`zz-prueba-certificacion-fase5` y `…-otra`), dos empresas de la
primera (RUT `11111111-1` y `22222222-2`), un proceso en `postulada` y una solicitud de
folios por empresa. Los «CAF» son un texto de prueba
(`<AUTORIZACION><CAF>de mentira</CAF><RSASK>llave-de-mentira</RSASK></AUTORIZACION>`), no
un CAF del SII, y sus secretos en Vault los deshace el `rollback`. De Vault solo cuenta
secretos por descripción (`caf:11111111-1:%`) y comprueba con un booleano que el secreto
trae `<RSASK>`: el contenido no sale del script.

| # | Grupo | Comprobaciones |
|---|---|---|
| 1 | Preparación | organizaciones, empresas, proceso y solicitudes, sin CAF ni secretos |
| 2–5 | `registrar_caf` (como `service_role`) | crea la fila (`activo`, `siguiente_folio = folio_desde`) y un secreto; el secreto guarda el XML completo y la fila apunta a él; la solicitud queda `timbrada` con el rango y el `caf_id`, y el CAF la enlaza; el mismo CAF otra vez devuelve el mismo id sin secreto nuevo |
| 6–10 | `registrar_caf` que falla | mismo `folio_desde` con otro rango (`23505`); otro RUT emisor, IDK de producción en certificación y solicitud de otra empresa (`22023`); empresa de otra organización (`P0002`). Ninguno deja secretos |
| 11–14 | `guardar_set_pruebas` (como `service_role`) | guarda 5 casos y deja el proceso en `set_descargado` con texto, correo y fecha; un set nuevo reemplaza los casos (3, con `referencia_codigo = 'SET'` por defecto) y conserva el correo; casos inválidos (sin detalles) dan `22023` y los anteriores siguen; en `por_declarar` no reemplaza (`22023`) |
| 15–16 | `authenticated` y `anon` | no ejecutan ninguna de las dos (`42501`) y no quedó ningún secreto de más |

Cómo correrlo: el archivo **completo**, tal cual, con el MCP `execute_sql` o en el SQL
Editor (como `postgres`); nunca por partes ni cambiando el `rollback` por `commit`. Debe dar
16/16 con `ok = true`. Después, la consulta de control del encabezado en 0:

```sql
select
  (select count(*) from public.organizaciones where slug like 'zz-prueba-certificacion-fase5%') as organizaciones,
  (select count(*) from public.empresas where razon_social like 'Empresa de prueba fase 5%') as empresas,
  (select count(*) from vault.secrets where description like 'caf:11111111-1:%') as secretos;
```

Corrida en producción el 2026-11-13, después de aplicar la 0008
([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0008)): 16/16 `ok`; tras
el `rollback`, la consulta de limpieza dio todo en 0 (organizaciones, empresas y secretos).

## 7. Simulación de la autorización externa (`rls-fase5-autorizacion-externa.sql`)

`supabase/verificaciones/rls-fase5-autorizacion-externa.sql` prueba el trigger de la
migración 0009 (decisión del usuario 2026-11-13: registrar la resolución de producción
equivale a declarar que la empresa ya está autorizada): un administrador que registra la
resolución de producción, con `registrar_resolucion` o con un `insert` con RLS, deja la
empresa con `autorizada_produccion` y `autorizada_en`; la de certificación no la marca; un
lector o un administrador de otra organización no pueden; un `authenticated` sigue sin
poder poner ni quitar la columna a mano; repetir no cambia la fecha y nada la desmarca.
**Requiere la migración 0009 aplicada** (en producción desde el 2026-11-13): sin ella el script corre igual, pero
las comprobaciones 4, 5, 6, 7, 9 y 11 salen `false`.

Mismo patrón que la de la Fase 3 (usuarios ficticios `autext-…@ejemplo.invalid` creados en
`auth.users`, `crear_organizacion` con la sesión del propietario, `set local role` por rol,
`pg_temp.registrar`, parámetros locales `prueba.*`, `rollback` final). La organización A
(`zz-prueba-autorizacion-externa-a`) pasa a Pyme con propietario, administrador y lector y
dos empresas (A1 por la RPC, A2 por `insert` directo); B
(`zz-prueba-autorizacion-externa-b`) queda con una empresa. `pg_temp.autorizacion()` lee
`autorizada_produccion|autorizada_en` sin RLS para comparar desde cualquier rol. No toca
Vault.

| # | Grupo | Comprobaciones |
|---|---|---|
| 1 | Preparación | equipo de A, tres empresas, ninguna autorizada |
| 2–7 | Administrador de A, empresa A1 (`registrar_resolucion`) | la de certificación no marca; no pone `autorizada_produccion` a mano; la de producción la deja autorizada con fecha; otra de producción no cambia `autorizada_en` y la anterior pasa al historial; dejarla sin vigencia no desmarca; tampoco la quita a mano |
| 8–9 | Empresa A2 | el lector no registra (`42501` por la RPC y por RLS) y A2 sigue sin autorizar; el administrador con un `insert` directo (RLS) la autoriza |
| 10–11 | Empresa B | el administrador de A no registra en B (`P0002` por la RPC, `42501` por RLS); `service_role` con `registrar_resolucion` autoriza solo a B |
| 12 | Procesos | el trigger no crea ni mueve `procesos_certificacion` |

Cómo correrlo: el archivo **completo**, tal cual, con el MCP `execute_sql` o en el SQL
Editor (como `postgres`); nunca por partes ni cambiando el `rollback` por `commit`. Debe dar
12/12 con `ok = true`. Después, la consulta de control del encabezado en 0:

```sql
select
  (select count(*) from auth.users where email like 'autext-%@ejemplo.invalid') as usuarios,
  (select count(*) from public.organizaciones where slug like 'zz-prueba-autorizacion-externa%') as organizaciones,
  (select count(*) from public.empresas where razon_social like 'Empresa autorizacion externa%') as empresas;
```

Probada en PGlite (en memoria, esquema 0001 y 0003–0009 con stubs de `auth`, `storage`,
`vault` y `supabase_migrations`; nada toca la base real): 12/12 con la 0009 y 6/12 sin
ella; la consulta de limpieza dio todo en 0. En la misma corrida, `rls-fase3-empresas.sql`
(43/43) y `rls-fase5-certificacion.sql` (16/16) siguen en verde con la 0009. Corrida en
producción el 2026-11-13, con la 0009 aplicada: 12/12 `ok` y la consulta de limpieza en 0
(usuarios, organizaciones, empresas)
([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0009)).

## 8. Simulación de `verificar_autorizacion` (`rls-fase5-verificar-autorizacion.sql`)

`supabase/verificaciones/rls-fase5-verificar-autorizacion.sql` prueba el valor que agrega la
migración 0010. **Requiere la 0010 aplicada** (en producción desde el 2026-11-14): sin ella
el script corre igual, pero las comprobaciones 2, 3, 5 y 6 salen `false` (`22P02`, el valor
no existe).

Mismo patrón que las anteriores (`pg_temp.registrar`, parámetros locales `prueba.*`,
`set local role` por rol, `rollback` final). Como `postgres` crea un usuario ficticio
(`veraut-propietario@ejemplo.invalid`), la organización `zz-prueba-verificar-autorizacion`
con ese usuario de propietario y la empresa `Empresa verificar autorizacion`. No toca Vault.

| # | Rol | Comprobación |
|---|---|---|
| 1 | postgres | preparación |
| 2–3 | service_role | registra una `verificar_autorizacion` confirmada en producción; una segunda en curso de la misma empresa y ambiente no choca (no es de efecto global) |
| 4 | service_role | control: una segunda `solicitar_folios` en curso sigue chocando (`23505`) |
| 5 | service_role | la cierra en `ok` con `terminada_en` y el `detalle` de la consulta (`respuesta`, `nro_resol`, `fch_resol`, `fecha_autorizacion`, `stc`, `stc_ultimo_anio`) |
| 6–7 | authenticated (propietario) | ve las dos filas de su organización; no inserta en `operaciones_sii` (`42501`: solo escribe el backend) |

Cómo correrlo: el archivo **completo**, tal cual, con el MCP `execute_sql` o en el SQL
Editor (como `postgres`). Debe dar 7/7. Después, la consulta de control del encabezado en 0:

```sql
select
  (select count(*) from auth.users where email like 'veraut-%@ejemplo.invalid') as usuarios,
  (select count(*) from public.organizaciones where slug like 'zz-prueba-verificar-autorizacion%') as organizaciones,
  (select count(*) from public.empresas where razon_social like 'Empresa verificar autorizacion%') as empresas;
```

Probada en PGlite (esquema 0001 y 0003–0010 con stubs): 7/7 con la 0010 y 3/7 sin ella; la
limpieza dio todo en 0. Corrida en producción el 2026-11-14, con la 0010 aplicada: 7/7 `ok`
y la limpieza en 0 (también 0 filas `verificar_autorizacion` en `operaciones_sii`)
([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0010)).

## 9. Simulación de folios de la Fase 6 (`rls-fase6-folios.sql`)

`supabase/verificaciones/rls-fase6-folios.sql` prueba la migración 0011: un administrador
anula folios asignados que no se usaron (caso a) y la cola completa de un CAF (caso b, que
lo deja `anulado` y fuera de `asignar_folio`); emisor, lector y `anon` no pueden, y para
otra organización el CAF no existe; un folio con documento no anulado, una cola parcial y
un rango fuera del CAF se rechazan; repetir devuelve 0; un CAF que se traslapa da `23P01` y
`registrar_caf` sigue idempotente; un administrador con su sesión no escribe directo en
`folios_anulados`, y `cafs` y `folios_anulados` están en la publicación de Realtime.
**Requiere la 0011 aplicada** (en producción desde el 2026-11-15): sin ella el script corre
igual (cada llamada captura su error), pero solo la 1 sale `true` (`anular_folios` da
`42883`, los CAF traslapados entran, el `insert` directo pasa y las tablas no están
publicadas).

Mismo patrón que las anteriores (usuarios ficticios `folios-…@ejemplo.invalid`,
`request.jwt.claims` + `set local role`, `pg_temp.registrar`, parámetros locales
`prueba.*`, `rollback` final). Usuarios `…6a1`–`6a4` (propietario, administrador, emisor y
lector de A) y `…6b1` (propietario de B); A pasa a Pyme. En la empresa de A (tipo 39,
certificación): CAF1 folios 1–10 y CAF2 11–20 por `registrar_caf` (CAF **de mentira**, con
su secreto de prueba en Vault, que el `rollback` deshace); `asignar_folio` entrega 5 folios
de CAF1 (siguiente 6); un documento `anulado` con folio 1 y uno `firmado` con folio 2. No
llama a `pg_net` (los documentos en `firmado` y `anulado` no encolan webhooks) y de Vault
solo cuenta filas por descripción.

| # | Grupo | Comprobaciones |
|---|---|---|
| 1 | Preparación | A (Pyme) con los 4 roles y B; CAF1 con 5 folios asignados y CAF2 activos; los dos documentos |
| 2–6 | Caso a (administrador) | anula 3–4: devuelve 2, motivo recortado, `anulado_por` y organización, el CAF sigue activo; repetir devuelve 0 sin duplicar; 3–5 cuenta solo el nuevo (1); un folio con documento `firmado` da `23503` y no entra ninguno; uno cuyo documento está `anulado` sí se anula |
| 7–11 | Validaciones (`22023`) | cola parcial (6–8) sin cambiar el CAF; cola que empieza más arriba del siguiente (8–10); rango fuera del CAF (9–11 y 0–2); inicial mayor que final; motivo vacío, nulo o de 501 caracteres (el de 500 pasa) |
| 12–15 | Quienes no pueden | emisor y lector de A (`42501`, el CAF no cambia); propietario de B (`P0002`, mismo mensaje que un CAF inexistente, y no lo ve por `select`); `anon` (`42501`) |
| 16–20 | Caso b | el propietario anula la cola 6–10: devuelve 5 y CAF1 queda `anulado` con siguiente 11; repetir da 0; `asignar_folio` entrega el 11 de CAF2; `service_role` anula la cola de CAF2 desde un folio ya asignado (11–20 con siguiente 12): 10, `anulado_por` nulo; con los dos anulados, `asignar_folio` da `P0002` |
| 21–24 | Traslapes y `registrar_caf` | un CAF 15–25 da `23P01` que nombra el rango, sin secreto huérfano; entran el contiguo 21–30 y el mismo 1–10 en tipo 41; mover 21–30 a 18–30 da `23P01`; `registrar_caf` repetido con CAF1 devuelve el mismo id, sin secreto nuevo y sin reactivarlo |
| 25 | Lectura (RLS de 0001) | el lector de A ve los 19 folios anulados de su organización; B no ve ninguno |
| 26 | Sin escritura directa | el administrador de A con su sesión no inserta, edita ni borra en `folios_anulados` (`42501`; sin la política `alta`); nada cambia |
| 27 | Realtime | `cafs` y `folios_anulados` están en `supabase_realtime` |

Cómo correrlo: el archivo **completo**, tal cual, con el MCP `execute_sql` o en el SQL
Editor (como `postgres`); nunca por partes ni cambiando el `rollback` por `commit`. Debe dar
27/27 con `ok = true`. Después, la consulta de control del encabezado:

```sql
select
  (select count(*) from auth.users where email like 'folios-%@ejemplo.invalid') as usuarios,
  (select count(*) from public.organizaciones where slug like 'zz-prueba-folios-fase6%') as organizaciones,
  (select count(*) from public.empresas where razon_social like 'Empresa folios fase 6%') as empresas,
  (select count(*) from vault.secrets where description like 'caf:11111111-1:%') as secretos;
-- todo en 0 (secretos: el mismo número que antes, si una empresa real tuviera el RUT 11111111-1)
```

Probada en PGlite (esquema 0001 y 0003–0011 con stubs, incluida la publicación
`supabase_realtime`): 27/27 con la 0011 y 1/27 sin ella. En la misma corrida siguen en
verde `rls-fase3-empresas.sql` (43/43), `rls-fase4-bloqueos.sql` (21/21),
`rls-fase5-certificacion.sql` (16/16), `rls-fase5-autorizacion-externa.sql` (12/12),
`rls-fase5-verificar-autorizacion.sql` (7/7) y las verificaciones `0008_certificacion.sql`
(10/10) y `0006_realtime_operaciones.sql` (9/9).

Corrida en producción el 2026-11-15, con la 0011 aplicada
([despliegue](../08-esquema-supabase/despliegue.md#fase-6-migración-0011)): 27/27 `ok`; tras
el `rollback`, la consulta de limpieza dio todo en 0 (usuarios, perfiles, organizaciones,
empresas, CAF, folios anulados, documentos y secretos `caf:11111111-1:%`), y `vault.secrets`
quedó con los mismos 3 secretos que antes de correrla.

## 10. Simulación del folio anulado (`rls-fase7-folio-anulado.sql`)

`supabase/verificaciones/rls-fase7-folio-anulado.sql` prueba la migración 0012: un documento
no recibe un folio que está en `folios_anulados`. Es el riesgo que dejó anotado la Fase 6
(un folio asignado por `asignar_folio` que un administrador anula antes de que exista su
documento). **Requiere la 0012 aplicada** (en producción desde el 2026-11-15) y la 0011: sin la
0012 el script corre igual y da 5/9 (la 2 reproduce el riesgo: el documento entra con el
folio anulado).

Mismo patrón que la de la Fase 6. Como `postgres` crea un usuario ficticio
(`folan-propietario@ejemplo.invalid`), la organización `zz-prueba-folio-anulado` y la empresa
`Empresa folio anulado`; como `service_role`, un CAF de tipo 39 y otro de tipo 41 (folios
1–10, CAF de mentira por `registrar_caf`) y 6 folios asignados del 39; el propietario anula
con su sesión el 3 del 39 (caso a) y la cola completa del 41. Los documentos los inserta
`service_role`, como el backend.

| # | Comprobación |
|---|---|
| 1 | preparación (folios 1–6 asignados, 3 anulado en el 39, cola del 41 anulada, sin documentos) |
| 2 | el riesgo: insertar el documento con el folio 3 (asignado y anulado antes) da `23514` con el folio en el mensaje, y no entra |
| 3 | con un folio libre (4) entra |
| 4 | el 6 anulado en el tipo 41 no afecta a un documento del tipo 39 con el 6 |
| 5 | como `envio-set.ts`: documento con el 2, después el 2 a `folios_anulados` y el documento a `anulado`; otro `update` de estado y uno con el mismo folio y CAF en el `set` pasan |
| 6 | cambiar el folio de un documento (4 → 3) da `23514` y conserva el 4 |
| 7 | a un borrador no se le fija el folio 3 (`23514`); el 5 sí (flujo de la Fase 7) |
| 8 | al revés, `anular_folios` sobre un folio con documento firmado sigue dando `23503` |
| 9 | ningún documento vivo de la empresa queda con un folio anulado |

La concurrencia (el `for key share` sobre el CAF antes de leer `folios_anulados`, que se
serializa con el `for update` de `anular_folios`) no se puede probar con una sola sesión; el
razonamiento está en el encabezado de la migración y en
[triggers](../08-esquema-supabase/triggers-y-logica.md#tg_validar_documento-migración-0012).

Cómo correrlo: el archivo **completo**, tal cual, con el MCP `execute_sql` o en el SQL
Editor (como `postgres`). Debe dar 9/9. Después, la consulta de control del encabezado en 0:

```sql
select
  (select count(*) from auth.users where email like 'folan-%@ejemplo.invalid') as usuarios,
  (select count(*) from public.organizaciones where slug like 'zz-prueba-folio-anulado%') as organizaciones,
  (select count(*) from public.empresas where razon_social like 'Empresa folio anulado%') as empresas,
  (select count(*) from vault.secrets where description like 'caf:11111111-1:%') as secretos;
-- todo en 0 (secretos: el mismo número que antes)
```

Probada en PGlite (esquema 0001 y 0003–0012 con stubs): 9/9 con la 0012 y 5/9 sin ella; la
limpieza dio todo en 0. En la misma corrida siguen en verde `0011_folios.sql` (18/18),
`rls-fase6-folios.sql` (27/27), `rls-fase3-empresas.sql` (43/43), `rls-fase4-bloqueos.sql`
(21/21), `rls-fase5-certificacion.sql` (16/16), `rls-fase5-autorizacion-externa.sql` (12/12),
`rls-fase5-verificar-autorizacion.sql` (7/7) y las verificaciones `0008` (10/10) y `0006`
(9/9).

Corrida en producción el 2026-11-15, con la 0012 aplicada
([despliegue](../08-esquema-supabase/despliegue.md#fase-7-migración-0012)): 9/9 `ok`; tras el
`rollback`, la consulta de limpieza dio todo en 0 (usuarios, perfiles, organización, empresa,
folios anulados, documentos y secretos `caf:11111111-1:%`), `vault.secrets` quedó con los
mismos 4 secretos que antes, y el CAF real de certificación (41–45 de la empresa del piloto)
siguió intacto: `activo`, `siguiente_folio = 41`, 0 anulados.

## 11. Simulación de alertas de la Fase 8 (`rls-fase8-notificaciones.sql`)

`supabase/verificaciones/rls-fase8-notificaciones.sql` prueba la migración 0013: la
deduplicación de alertas por correo. **Requiere la 0013 aplicada** (lo está desde el
2026-11-17): sin ella el
script corre igual y solo la 1 sale `true` (`42883` / `42P01`).

Mismo patrón que las anteriores. Como `postgres` crea usuarios ficticios
(`notif-…@ejemplo.invalid`: propietario, administrador y lector de A; propietario de B), las
organizaciones `zz-prueba-notif-fase8…`, dos empresas, envíos, un CAF de mentira por
`registrar_caf`, documentos (insertados ya `rechazado` o `aceptado`, sin `update` de estado,
así que no encolan webhooks), certificados sin archivo y notificaciones de prueba. No envía
correos ni llama a `pg_net`.

| # | Comprobación |
|---|---|
| 1 | preparación |
| 2–3 | una clave nueva devuelve su id (`pendiente`, 1 intento); reclamarla otra vez (pendiente reciente) no devuelve nada |
| 4–7 | una `fallida` se vuelve a tomar (2 intentos, sin error); una `enviada` no; una fallida con 5 intentos no; una `pendiente` de hace 20 minutos sí, con los datos nuevos |
| 8 | el mismo certificado con otro umbral es otra clave |
| 9–10 | otra organización con la misma clave no recibe nada; B reclama la suya |
| 11–14 | formatos inválidos → `23514`; faltan datos → `22004`; organización inexistente → `23503`; una `enviada` sin `enviado_en` o un estado fuera de los 3 → `23514` |
| 15–20 | el administrador de A ve solo las de A, no inserta, edita ni borra (`42501`) ni ejecuta `reclamar_notificacion`; el lector también lee; B ve solo la suya; `anon` no lee |
| 21–22 | `reclamar` devuelve intentos y el mismo `grupo` al reintentar; `notificacion_cerrada` es la negación de reclamar |
| 23–25 | candidatos: inciertos sin el ya avisado, el no incierto, el viejo ni el del set, por turnos entre organizaciones; rechazados sin el avisado, el aceptado, el fuera de la ventana ni el del set; certificados con su umbral, sin el que vence en 40 días, el ya avisado ni el revocado, el más urgente primero |
| 26 | el administrador no ejecuta las de candidatos ni `notificacion_cerrada` (`42501`) |

Cómo correrlo: el archivo **completo**, tal cual (como `postgres`). Debe dar 26/26. Después,
la consulta de control del encabezado en 0:

```sql
select
  (select count(*) from auth.users where email like 'notif-%@ejemplo.invalid') as usuarios,
  (select count(*) from public.organizaciones where slug like 'zz-prueba-notif-fase8%') as organizaciones,
  (select count(*) from public.empresas where razon_social like 'Empresa notificaciones fase 8%') as empresas,
  (select count(*) from public.certificados where id::text like '00000000-0000-4000-8000-0000000008%') as certificados,
  (select count(*) from vault.secrets where description like 'caf:11111111-1:%') as secretos,
  (select count(*) from public.notificaciones where clave like '%:00000000-0000-4000-8000-0000000008%') as notificaciones;
-- todo en 0 (secretos: el mismo número que antes)
```

Probada en PGlite: 26/26 con la 0013 y 1/26 sin ella. En producción, el 2026-11-17: 26/26, con la consulta de control en 0 antes
y después, `vault.secrets` con los mismos 4 secretos y `notificaciones` sin filas.

## 12. Consulta de control del Tablero (Fase 9, `fase9-tablero-control.sql`)

`supabase/verificaciones/fase9-tablero-control.sql` no prueba una migración (la Fase 9 no
trae): es la consulta del criterio de aceptación de la fase, «las cifras del tablero cuadran
con una consulta SQL de control sobre `documentos` aceptados». **Solo lectura**: un `select`
con CTE, sin crear objetos ni escribir.

Calcula directo desde `documentos` (no desde `v_ventas_diarias`, que es lo que lee la app),
con las reglas del Tablero: período por `fecha_emision`, sin el set de pruebas, ventas de
`aceptado` y `aceptado_con_reparos`, documentos emitidos con folio y sin borradores ni
anulados, y «esperando al SII» = `enviado`. Devuelve una fila por cifra (`orden`, `cifra`,
`valor`), con «Empresas que calzan con los parámetros» al final (si da 0, los parámetros no
calzan y todo sale 0).

Cómo correrla: ajustar el primer CTE (slug, RUT de la empresa como se guarda, ambiente y
período) y ejecutar el archivo completo (SQL Editor, MCP `execute_sql` o `supabase db query
--read-only -f`). En producción, el 2026-11-17, para `servicio`, 20.630.500-2, certificación
y noviembre de 2026: ventas netas $ 2.000, IVA $ 380, exento $ 0, total $ 2.380, 2 boletas
aceptadas y 0 esperando al SII. El Tablero desplegado mostró las mismas cifras (criterio
cumplido el 2026-11-17;
[guía](../02-guias/tablero-y-reportes.md#consulta-de-control-y-criterio-de-aceptación)).

## 13. Simulación de planes y pagos de la Fase 10 (`rls-fase10-pagos.sql`)

`supabase/verificaciones/rls-fase10-pagos.sql` prueba las migraciones 0015 y 0016: una
organización nueva nace en Certificación sin `periodo_fin`; `activar_suscripcion` (solo
`service_role`) deja vigente el plan pagado en Flow en una transacción, es idempotente con
el mismo id externo, cambia de plan sobre la misma suscripción externa, vuelve a
Certificación sin proveedor y rechaza datos incompletos o estados no permitidos; el cupo de
boletas del plan nuevo se aplica al emitir en producción; propietarios y administradores
leen `pagos` y `clientes_pago` de su organización, y nadie más; `eventos_pasarela` es solo
de `service_role`. **Requiere la 0015 y la 0016 aplicadas** (en producción desde el
2026-11-18): sin ellas el script corre igual (cada paso captura su error), pero casi todo
sale `false`.

Mismo patrón que las anteriores (usuarios ficticios `pagos-…@ejemplo.invalid`, claims
locales + `set local role`, `pg_temp.registrar`, parámetros locales `prueba.*`, `rollback`
final, igual que `rls-fase8-notificaciones.sql`). Crea dos organizaciones
(`zz-prueba-pagos-fase10…`), suscripciones con ids externos `sub-prueba-fase10…`, una empresa
marcada como autorizada en producción, un CAF de producción **de mentira** por
`registrar_caf` (con su secreto de prueba en Vault), boletas de producción, filas de
`uso_mensual`, clientes (`cus-prueba-fase10…`), pagos (`inv-prueba-fase10…`) y avisos
(`tok-prueba-fase10…`). No llama a Flow, al SII ni a `pg_net`: los documentos se insertan ya
`firmado`.

| # | Grupo | Comprobaciones |
|---|---|---|
| 1–3 | Preparación y Certificación | `crear_organizacion` deja a A y B en `certificacion`/`prueba` sin `periodo_fin` y `plan_vigente` sin producción; A con los 4 roles, empresa autorizada y CAF de producción 1–2000; en Certificación una boleta de producción se rechaza y no cuenta uso |
| 4–7 | Alta en Pyme | Certificación → Pyme con id externo: id nuevo, la anterior `cancelada` con `periodo_fin`, una sola vigente, `plan_vigente` pyme con 1.000; `sincronizada_en` y `cancelar_al_fin_periodo = false`; repetir es idempotente; con 999 usadas la boleta 1.000 entra y la 1.001 se rechaza |
| 8–9 | Cambio de plan | mismo id externo → `plan_id` contador en la misma fila; la boleta 1.001 que Pyme rechazó ahora entra |
| 10–11 | Ids externos y mora | B no puede usar el id externo de A (`23505`); una `morosa` no tiene plan vigente y el mismo id la reactiva en la misma fila |
| 12–14 | Vuelta a Certificación | sin proveedor: id nuevo, la de Flow `cancelada`; repetir es idempotente; no se emite en producción y un aviso tardío con el id cancelado da `22023` («ya terminó») |
| 15–18 | Errores y permisos | `22004`; `22023` (estado `morosa`/`cancelada`, proveedor sin id o al revés); `P0002`; propietario, administrador, lector y `anon` no ejecutan `activar_suscripcion` (`42501`) |
| 19–21 | Tablas (service_role) | registra clientes, 3 pagos y un aviso; los `check` dan `23514`; los únicos dan `23505` y el upsert por `(proveedor, factura_externa)` actualiza |
| 22–28 | RLS | propietario y administrador de A leen sus 2 pagos y su cliente (con marca y últimos 4), nada de B; nadie lee `eventos_pasarela` con sesión (`42501`); el administrador no escribe (`42501`); emisor y lector leen 0 filas; B solo lo suyo; `anon` nada |
| 29–30 | FK | borrar una suscripción deja sus pagos con `suscripcion_id` nulo; borrar B borra sus pagos y su cliente y deja su aviso con `organizacion_id` nulo |

Lo que no prueba: que el `for no key update` sobre la organización no frene un insert en
una tabla hija (hace falta una segunda sesión concurrente; la verificación 0016, 19, revisa
que el cuerpo use ese modo).

Cómo correrlo: el archivo **completo**, tal cual, con el MCP `execute_sql` o en el SQL
Editor (como `postgres`); nunca por partes ni cambiando el `rollback` por `commit`. Debe dar
30/30. Después, la consulta de control del encabezado, todo en 0:

```sql
select
  (select count(*) from auth.users where email like 'pagos-%@ejemplo.invalid') as usuarios,
  (select count(*) from public.organizaciones where slug like 'zz-prueba-pagos-fase10%') as organizaciones,
  (select count(*) from public.suscripciones where id_externo like 'sub-prueba-fase10%') as suscripciones,
  (select count(*) from public.empresas where razon_social like 'Empresa pagos fase 10%') as empresas,
  (select count(*) from vault.secrets where description like 'caf:76543210-3:produccion:39:1-%') as secretos,
  (select count(*) from public.clientes_pago where cliente_externo like 'cus-prueba-fase10%') as clientes_pago,
  (select count(*) from public.pagos where factura_externa like 'inv-prueba-fase10%') as pagos,
  (select count(*) from public.eventos_pasarela where token like 'tok-prueba-fase10%') as eventos;
-- todo en 0 (secretos: el mismo número que antes, si una empresa real tuviera el RUT
-- 76543210-3 con un CAF de producción de boletas desde el folio 1)
```

Antes de aplicar la 0016 la consulta de limpieza falla (las tablas `clientes_pago`, `pagos` y
`eventos_pasarela` no existen): córrela después de migrar.

Probada en PGlite (esquema 0001 y 0003–0016 con stubs): 30/30 con las dos migraciones, 3/30
solo con la 0015 y 2/30 sin ninguna; la limpieza dio todo en 0. En la misma corrida siguen en
verde `rls-fase2-tenancy.sql` (52/52, con el ajuste del plan Empresa), `rls-fase3-empresas.sql`
(43/43), la verificación `0004` (3/3) y `rls-fase8-notificaciones.sql` (26/26).

Corrida en producción el 2026-11-18, con la 0015 y la 0016 aplicadas
([despliegue](../08-esquema-supabase/despliegue.md#fase-10-migraciones-0015-0016-y-0017)):
30/30 `ok`; la consulta de limpieza dio todo en 0 antes y después, y los totales de la base no
cambiaron (`vault.secrets` 4, suscripciones 1, usuarios 2, organizaciones 1, miembros 1). En la
misma sesión, `rls-fase2-tenancy.sql` (ajustada) 52/52.

## 14. Simulación de la API pública y los webhooks de la Fase 11 (`rls-fase11-api.sql`)

`supabase/verificaciones/rls-fase11-api.sql` prueba la migración 0018: autenticación de API
keys, idempotencia, encolado con filtro por plan, reclamo y cierre de entregas con backoff,
las acciones del panel por rol, el check de la URL y el RLS de las tablas de integraciones.
**Requiere la 0015, la 0016 y la 0018 aplicadas** (en producción desde el 2026-11-18 la 0015
y la 0016, y desde el 2026-11-19 la 0018): sin la 0018 el script corre igual (cada paso captura su error), pero solo salen
`true` la 1, la 35 y la 37 (lo que ya hacía la 0001).

Mismo patrón que las anteriores (usuarios ficticios `api-…@ejemplo.invalid`, claims locales
+ `set local role`, `pg_temp.registrar`, parámetros locales `prueba.*`, `rollback` final).
Crea tres organizaciones (`zz-prueba-api-fase11-a|b|c`; A y B pasan al plan `api` con
`activar_suscripcion`, C sigue en Certificación), una empresa con un CAF de certificación
**de mentira** (`registrar_caf`, secreto de prueba en Vault), una boleta de la API que el SII
«acepta» (como `postgres`), API keys (`Prueba fase 11 …`), webhooks
(`https://receptor-fase11-…`, secretos de prueba en Vault), entregas y claves de
idempotencia (`fase11-…`). No llama al SII, a `pg_net` ni a ninguna URL.

| # | Grupo | Comprobaciones |
|---|---|---|
| 1–8 | API keys | `crear_api_key` devuelve `sk_test_` + 64 hex y guarda solo sha256 y prefijo; en C (sin API) `P0001`; `autenticar_api_key` con la clave válida (organización, alcances, ambiente, motivo nulo, `ultimo_uso_en`); el *throttle* de un minuto; `invalida`, `revocada`, `vencida` y `plan_sin_api` con los ids nulos; `authenticated` y `anon` no la ejecutan (`42501`) |
| 9–17 | Idempotencia | nueva; en curso; conflicto por otra huella u otro recurso; terminada con la respuesta guardada (y `terminar` no la pisa); retomada con el arriendo vencido; soltar conserva la huella y entrega el `recurso_id`; por organización; formato (`23514`, `22004`); el propietario no lee la tabla ni ejecuta las RPC (`42501`) |
| 18–21 | Webhooks y encolado | `crear_webhook` con `whsec_` en Vault; el check `webhooks_url_permitida` rechaza 14 URL (localhost, IP v4/v6, `.internal`, `.local`, `.localhost`, otro puerto, usuario:clave, http, punto final, espacios, > 2.048) y acepta una https con `:443`, ruta y consulta; `encolar_evento` solo con plan con webhooks y solo para los suscritos; `documento.aceptado` lleva `estado`, `origen` y `clave_idempotencia` |
| 22–28 | Cron | `reclamar_entregas_webhook` por turnos entre organizaciones, con intento, URL, id del secreto y arriendo; una segunda corrida no repite; `cerrar` (con el intento reclamado) entregada y ya cerrada (`null`); falla y timeout → 1 min ±10 %; 2 h y 24 h ±10 %; intento 8 y falla definitiva → `descartado`, respuesta truncada a 1.000; descarte al reclamar (webhook desactivado, 8 intentos, plan sin webhooks) con su motivo |
| 29–34 | Panel | reenviar la misma fila (`intentos = 0`, `reenviada_por`); `22023` en cola o desactivado; `42501` emisor, `P0002` otra organización o inexistente, `42501` `anon`; `P0001` sin plan; `probar_webhook` y sus errores; `rotar_secreto_webhook` (secreto nuevo, el viejo fuera de Vault, `42501` para el emisor) |
| 35–37 | RLS y borrado | el administrador ve claves, webhooks y entregas de A; emisor y otra organización 0/0/0; `anon` `42501`; el propietario no ejecuta las RPC del cron ni escribe entregas; borrar el webhook saca su secreto de Vault y sus entregas |
| 38 | Reenvío en vuelo | una entrega `fallido` reclamada (intento 3) que el administrador reenvía queda `pendiente` con `intentos = 0`; el cierre del intento 3 devuelve `null` y no la pisa |
| 39 | Revocar es definitivo | el administrador no reactiva una clave revocada (`22023`) ni toca `expira_en` (`42501`, sin grant); `service_role` tampoco alarga ni quita la expiración (`22023`) pero sí la acorta; la revocada sigue rechazada |

Lo que no prueba: que `for update skip locked` reparta entre dos corridas **concurrentes**
(hace falta una segunda sesión; la verificación 0018, 14, revisa el cuerpo) ni la entrega
HTTP, la firma o el bloqueo SSRF (pruebas de Vitest de `server/webhooks/`).

Cómo correrlo: el archivo **completo**, tal cual, con el MCP `execute_sql` o en el SQL
Editor (como `postgres`). Debe dar 39/39. Después, la consulta de control del encabezado,
todo en 0:

```sql
select
  (select count(*) from auth.users where email like 'api-%@ejemplo.invalid') as usuarios,
  (select count(*) from public.organizaciones where slug like 'zz-prueba-api-fase11%') as organizaciones,
  (select count(*) from public.empresas where razon_social like 'Empresa api fase 11%') as empresas,
  (select count(*) from public.api_keys where nombre like 'Prueba fase 11%') as api_keys,
  (select count(*) from public.webhooks where url like 'https://receptor-fase11%') as webhooks,
  (select count(*) from public.api_idempotencia where clave like 'fase11-%') as idempotencia,
  (select count(*) from vault.secrets where description like 'webhook https://receptor-fase11%') as secretos_webhook,
  (select count(*) from vault.secrets where description like 'caf:76543210-3:certificacion:39:1-%') as secretos_caf;
```

Antes de aplicar la 0018 la consulta falla (`api_idempotencia` no existe).

Probada en PGlite (esquema 0001 y 0003–0019, con stubs de `pg_cron` y `pg_net`): 39/39 con
la 0018 y 3/39 sin ella; la limpieza dio todo en 0. Verificaciones: `0018_api_webhooks.sql`
23/23 (2/23 sin la 0018) y `0019_cron_webhooks.sql` 8/9 (la 1, extensiones, no aplica en
PGlite; 2/9 sin la 0019). En la misma corrida siguen en verde `rls-fase2-tenancy` 52/52,
`rls-fase3-empresas` 43/43, `rls-fase4-bloqueos` 21/21, `rls-fase5-certificacion` 16/16,
`rls-fase5-autorizacion-externa` 12/12, `rls-fase5-verificar-autorizacion` 7/7,
`rls-fase6-folios` 27/27, `rls-fase7-folio-anulado` 9/9, `rls-fase8-notificaciones` 26/26,
`rls-fase10-pagos` 30/30 y las verificaciones `0004`, `0011`, `0012`, `0013`, `0015` y
`0016`.

Corrida en producción el 2026-11-19, con la 0018 aplicada
([despliegue](../08-esquema-supabase/despliegue.md#fase-11-migraciones-0018-y-0019)): antes de
migrar, `0018_api_webhooks.sql` 2/23; después, 23/23 y `rls-fase11-api.sql` 39/39 (con
`supabase db query --remote --yes -f`: el CLI exige `--yes` en modo agente aunque el script
termine en *rollback*), con la consulta de limpieza en 0 antes y después. Regresiones:
`rls-fase8-notificaciones.sql` 26/26, `rls-fase10-pagos.sql` 30/30 y las verificaciones
`0013_notificaciones.sql` 18/18 y `0016_pagos.sql` 20/20. La `0019_cron_webhooks.sql` sigue
**pendiente** (se aplica después del deploy).

## 15. Lo que no se prueba con SQL

El aislamiento entre organizaciones y los permisos por rol también se prueban de punta a
punta con la app (Fase 2): dos usuarios de organizaciones distintas, cada uno con su
organización de prueba marcada como tal. Esas organizaciones viven en producción: se crean
con un nombre que las identifique y se borran al terminar.
