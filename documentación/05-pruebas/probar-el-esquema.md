---
title: "Probar el esquema (RLS, triggers, cuotas)"
description: "Cómo verificar el esquema y simular roles en la única base (producción) sin dejar rastro."
keywords: [verificaciones, solo lectura, producción, RLS, set local role, request.jwt.claims, auth.uid, auth.role, rollback, service_role, authenticated, anon, simulación de roles, rls-fase2-tenancy.sql, ejemplo.invalid, pg_temp]
related: ["08-esquema-supabase/rls-y-privilegios.md", "08-esquema-supabase/despliegue.md"]
source: ["supabase_saas_sii.sql §15 §17", "supabase/verificaciones/", "supabase/verificaciones/rls-fase2-tenancy.sql"]
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

Se ejecuta pegándolo en el SQL Editor o con el MCP `execute_sql`. Cada migración nueva trae
el suyo.

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
   luego, como `postgres` (el backend), sube a A al plan Pyme para completar el equipo.
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
| 53 | Suscripción morosa | como `postgres`, A pasa a `morosa` (en Pyme, con cupo libre) y se reabre la invitación de `vencida-a`; `aceptar_invitacion` rechaza con «La organización no tiene una suscripción vigente» (migración 0004). Sin 0004 sale `ok = false` |

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

Resultado de la última corrida (2026-11-12, con 0003 y 0004 aplicadas): 52 de 52 en
`ok = true` (1–51 y 53; la 52 no aparece). La consulta de control dio 0 en todo.

## 4. Lo que no se prueba con SQL

El aislamiento entre organizaciones y los permisos por rol también se prueban de punta a
punta con la app (Fase 2): dos usuarios de organizaciones distintas, cada uno con su
organización de prueba marcada como tal. Esas organizaciones viven en producción: se crean
con un nombre que las identifique y se borran al terminar.
