---
title: "Probar el esquema (RLS, triggers, cuotas)"
description: "Cómo verificar el esquema y simular roles en la única base (producción) sin dejar rastro."
keywords: [verificaciones, solo lectura, producción, RLS, set local role, request.jwt.claims, auth.uid, auth.role, rollback, service_role, authenticated, anon, simulación de roles, rls-fase2-tenancy.sql, rls-fase3-empresas.sql, 0005_certificados_resoluciones.sql, ejemplo.invalid, pg_temp, 0006_realtime_operaciones.sql, 0007_bloqueos_sii.sql, rls-fase4-bloqueos.sql, bloqueos_sii, arriendo]
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
| `0005_certificados_resoluciones.sql` | 15 comprobaciones: las 3 funciones con su firma, nombres de parámetros, `plpgsql`, `security definer` solo en `registrar_certificado`, `search_path` vacío; `registrar_certificado` solo para `service_role`; las otras dos para `authenticated` y `service_role`, no `anon`; `certificados` sin políticas de escritura; `trg_borrar_secretos`; herencia de `organizacion_id`; privilegios que necesitan las funciones invoker; índices parciales; migración registrada. Aplicada el 2026-11-13: 15/15 `ok` |
| `0006_realtime_operaciones.sql` | 9 comprobaciones: `supabase_realtime` existe y publica `insert`/`update`/`delete`; `operaciones_sii` y `solicitudes_folios` están en ella; las tres de la 0001 siguen publicadas; RLS activo; política `lectura` (`select`, `authenticated`, `es_miembro(organizacion_id)`); `select` para `authenticated`; nada para `anon`; *replica identity* por defecto; migración registrada. **Pendiente de aplicar**: antes de migrar da 7/9 |
| `0007_bloqueos_sii.sql` | 14 comprobaciones: `bloqueos_sii` con sus 5 columnas y tipos; PK `(certificado_id, ambiente)`; FK a `certificados` en cascada; RLS activo sin políticas; nada para `anon`/`authenticated`; las 2 funciones con su firma y `boolean`; nombres de parámetros (los que usa `bloqueos.ts`); `plpgsql`, `security definer`, `search_path` vacío; solo `service_role` las ejecuta; el `insert … on conflict` con la condición del arriendo; migración registrada; el índice único y válido `operaciones_sii_efecto_global_en_curso` sobre `(empresa_id, operacion, ambiente)`; su predicado (`en_curso`, `confirmada` y exactamente `solicitar_folios`, `postular`, `declarar`, como `OPERACIONES_EFECTO_GLOBAL`). **Pendiente de aplicar**: antes de migrar da todo `false` |

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

## 4. Simulación de roles de la Fase 3 (`rls-fase3-empresas.sql`)

`supabase/verificaciones/rls-fase3-empresas.sql` prueba el criterio de la Fase 3 con el
mismo patrón que la de la Fase 2 (usuarios `@ejemplo.invalid`, claims locales,
`pg_temp.registrar`, `rollback` final). **Requiere la migración 0005 aplicada**: sin
ella se detiene con `42883` y la transacción se descarta completa, sin resultados.
Corrida en producción el 2026-11-13: 43/43 con `ok = true`, y la consulta de control del
encabezado en 0 (el `rollback` no dejó datos ni secretos de prueba).

Diferencias con la de la Fase 2: cinco usuarios (`…a1`–`a4` en A, `…b1` en B); A pasa a
Pyme y su equipo se da de alta directo como `postgres` (las invitaciones ya las prueba
la Fase 2); B queda en Certificación. Crea certificados de prueba con huellas
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
iguales no quedan `en_curso` a la vez. **Requiere la migración 0007 aplicada** (pendiente al 2026-11-13): sin ella se
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

## 6. Lo que no se prueba con SQL

El aislamiento entre organizaciones y los permisos por rol también se prueban de punta a
punta con la app (Fase 2): dos usuarios de organizaciones distintas, cada uno con su
organización de prueba marcada como tal. Esas organizaciones viven en producción: se crean
con un nombre que las identifique y se borran al terminar.
