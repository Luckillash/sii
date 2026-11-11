---
title: "Probar el esquema (RLS, triggers, cuotas)"
description: "Cómo verificar el esquema y simular roles en la única base (producción) sin dejar rastro."
keywords: [verificaciones, solo lectura, producción, RLS, set local role, request.jwt.claims, rollback, service_role, authenticated]
related: ["08-esquema-supabase/rls-y-privilegios.md", "08-esquema-supabase/despliegue.md"]
source: ["supabase_saas_sii.sql §15 §17", "supabase/verificaciones/"]
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

## 3. Lo que no se prueba con SQL

El aislamiento entre organizaciones y los permisos por rol también se prueban de punta a
punta con la app (Fase 2): dos usuarios de organizaciones distintas, cada uno con su
organización de prueba marcada como tal. Esas organizaciones viven en producción: se crean
con un nombre que las identifique y se borran al terminar.
