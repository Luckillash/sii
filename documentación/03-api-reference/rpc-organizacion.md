---
title: "RPC: organización, equipo, acceso y validación"
description: "crear_organizacion, crear_invitacion, aceptar_invitacion, ver_invitacion y funciones de acceso y validación."
keywords: [rpc, supabase.rpc, crear_organizacion, crear_invitacion, aceptar_invitacion, ver_invitacion, token, token_hash, sha256, invitación, slug, 42501, "Sin permiso", "Invitación inválida o vencida", "Requiere sesión", es_miembro, es_admin, puede_emitir, rut_valido, correo_sii_valido]
related: ["02-guias/onboarding-organizacion.md", "01-fundamentos/tenancy-y-roles.md", "03-api-reference/acceso-por-tabla.md"]
source: ["supabase_saas_sii.sql §2 §5 §15 §17", "supabase/migrations/0003_preferencias.sql"]
---

# RPC: organización, equipo, acceso y validación

> **Úsalo cuando:** necesitas el contrato exacto de una RPC de organización.

Todas se llaman con `supabase.rpc(nombre, { parámetros })` desde un cliente con la sesión
del usuario. Las de escritura son `security definer`: validan el permiso por dentro, así
que no dependen del RLS de las tablas que tocan. Los errores llegan en `error.code`
(SQLSTATE) y `error.message` (texto literal de la función).

## Resumen

| RPC | Quién la ejecuta | Devuelve | Efecto |
|---|---|---|---|
| `crear_organizacion(p_nombre, p_slug)` | `authenticated` | `uuid` | organización + suscripción de prueba + el usuario como propietario |
| `crear_invitacion(p_organizacion, p_correo, p_rol)` | `authenticated` (administradores) | `text` (token, una vez) | invitación pendiente por 7 días |
| `aceptar_invitacion(p_token)` | `authenticated` (correo que calce) | `uuid` | alta como miembro con el rol invitado |
| `ver_invitacion(p_token)` (migración 0003) | `anon`, `authenticated` | 0 o 1 fila | ninguno (solo lectura) |

`anon` no ejecuta `crear_organizacion`, `crear_invitacion` ni `aceptar_invitacion`:
recibe `42501` `permission denied for function …`.

---

## `crear_organizacion`

```sql
public.crear_organizacion(p_nombre text, p_slug text) returns uuid
-- security definer · grant execute to authenticated
```

**Efectos** (en una transacción):

1. Inserta en `organizaciones` con `slug = lower(p_slug)` y `creado_por = auth.uid()`.
2. Crea la suscripción al plan `certificacion` en estado `prueba`, con
   `periodo_fin = now() + 30 días`.
3. Agrega al usuario a `miembros_organizacion` como `propietario`.

Devuelve el `id` de la organización.

**Errores**

| Código | Mensaje | Causa |
|---|---|---|
| `42501` | `Requiere sesión` | sin `auth.uid()` |
| `23505` | `duplicate key value violates unique constraint "organizaciones_slug_key"` | el slug ya existe (es único en todo el SaaS) |
| `23514` | `… violates check constraint "organizaciones_slug_check"` | el slug (ya en minúsculas) no calza con `^[a-z0-9][a-z0-9-]{1,62}$`: 2 a 63 caracteres, letras, dígitos y guion, sin empezar con guion |
| `23514` | `… violates check constraint "organizaciones_nombre_check"` | nombre vacío o solo espacios |

```ts
const { data: organizacionId, error } = await supabase.rpc('crear_organizacion', {
  p_nombre: 'Estudio Contable Pérez',
  p_slug: 'estudio-perez',
});
if (error?.code === '23505') {
  // "Ese identificador ya está en uso. Prueba con otro."
}
```

## `crear_invitacion`

```sql
public.crear_invitacion(
  p_organizacion uuid,
  p_correo text,
  p_rol public.rol_miembro default 'lector'
) returns text
-- security definer · grant execute to authenticated
```

**Quién:** propietarios y administradores de `p_organizacion` (`es_admin`).

**Efectos**

1. Borra la invitación **pendiente** que hubiera para el mismo correo en esa organización
   (su token deja de servir).
2. Inserta la invitación con `correo = lower(p_correo)`, `invitado_por = auth.uid()`,
   `expira_en = now() + 7 días` y `token_hash` = sha256 (hex) del token.
3. Devuelve el **token en claro una sola vez** (64 caracteres hex, de `token_aleatorio()`).
   La base guarda solo el hash: si se pierde, se crea otra invitación.

El token va en el enlace del correo (`/invitacion/<token>`). No se registra en logs ni en
Sentry.

**Errores**

| Código | Mensaje | Causa |
|---|---|---|
| `42501` | `Sin permiso` | quien llama no es administrador de esa organización (lector, emisor o ajeno) |
| `23514` | `new row for relation "invitaciones" violates check constraint "invitaciones_rol_check"` | `p_rol = 'propietario'`: no se invita como propietario; se nombra después |
| `23514` | `… violates check constraint "invitaciones_correo_check"` | el correo no tiene `@` después del primer carácter |

No revisa el cupo de usuarios del plan: eso pasa al aceptar. La función solo pasa el
correo a minúsculas (no lo recorta ni lo valida más): limpia el campo en la app.

```ts
const { data: token, error } = await supabase.rpc('crear_invitacion', {
  p_organizacion: organizacionId,
  p_correo: 'maria@ejemplo.cl',
  p_rol: 'emisor',
});
// Server Action: enviar `${process.env.NEXT_PUBLIC_APP_URL}/invitacion/${token}` con Resend.
```

## `aceptar_invitacion`

```sql
public.aceptar_invitacion(p_token text) returns uuid
-- security definer · grant execute to authenticated
```

**Quién:** el usuario con sesión cuyo correo de Auth (`auth.users.email`, en minúsculas)
es igual al de la invitación.

**Efectos**

1. Busca (y bloquea con `for update`) la invitación por sha256 del token, pendiente
   (`aceptada_en is null`) y vigente (`expira_en > now()`).
2. Si el usuario todavía no es miembro, exige cupo (`exigir_cupo_usuarios`).
3. Inserta en `miembros_organizacion` con el rol de la invitación. Si ya era miembro,
   **reemplaza su rol** por el de la invitación (`on conflict do update`).
4. Marca `aceptada_en = now()`: el token no sirve una segunda vez.

Devuelve el `id` de la organización (para redirigir a `/<slug>`).

**Errores**

| Código | Mensaje | Causa |
|---|---|---|
| `42501` | `Invitación inválida o vencida` | token inexistente, ya aceptado o vencido; correo de la sesión distinto al invitado; o sin sesión |
| `P0001` | `El plan <nombre> permite como máximo <n> usuario(s)` | la organización llenó el cupo de su plan |
| `P0001` | `La organización debe tener al menos un propietario` | el usuario era el único propietario y la invitación lo degradaría |

El mismo mensaje cubre todos los casos inválidos a propósito: no revela si el token
existe. Para explicar el motivo antes de pedir sesión, usa `ver_invitacion`.

```ts
const { data: organizacionId, error } = await supabase.rpc('aceptar_invitacion', {
  p_token: params.token,
});
if (error?.code === '42501') {
  // "Esta invitación no es válida o ya venció. Pide a tu administrador que te invite de nuevo."
}
```

## `ver_invitacion` (migración 0003)

```sql
public.ver_invitacion(p_token text)
returns table (
  organizacion_nombre text,
  correo              text,
  rol                 public.rol_miembro,
  expira_en           timestamptz
)
-- stable security definer · grant execute to anon, authenticated, service_role
```

Viene en `supabase/migrations/0003_preferencias.sql`, aplicada el 2026-11-12. Las
comprobaciones 48–51 de la simulación de roles la cubren (ver
[probar el esquema](../05-pruebas/probar-el-esquema.md)).

**Quién:** cualquiera, también sin sesión. Sirve para que `/invitacion/[token]` muestre a
qué organización, con qué correo y con qué rol se invita antes de iniciar sesión.

**Efecto:** ninguno. Devuelve **una fila** si el token corresponde a una invitación
pendiente y vigente (misma búsqueda por sha256 que `aceptar_invitacion`) y **cero filas**
en cualquier otro caso (token malo, ya aceptado o vencido). No lanza errores por token
inválido. No da acceso a la tabla `invitaciones`, que sigue siendo solo de
administradores.

```ts
const { data: invitacion } = await supabase
  .rpc('ver_invitacion', { p_token: params.token })
  .maybeSingle();
if (!invitacion) {
  // "Esta invitación no es válida o ya venció."
}
// invitacion.organizacion_nombre, invitacion.correo, invitacion.rol, invitacion.expira_en
```

---

## Funciones de acceso

`es_miembro(uuid)`, `tiene_rol(uuid, rol_miembro[])`, `es_admin(uuid)`,
`puede_emitir(uuid)` y `comparte_organizacion(uuid)` devuelven `boolean` para el usuario
de la sesión. Las ejecuta `authenticated` (no `anon`). Definición y uso en
[tenancy y roles](../01-fundamentos/tenancy-y-roles.md#funciones-de-acceso).

```ts
const { data: esAdmin } = await supabase.rpc('es_admin', { p_organizacion: organizacionId });
```

## Funciones de validación

Las usan los dominios, `CHECK` y columnas generadas del esquema; también se pueden llamar
para validar antes de escribir.

| Función | Ejecutan | Devuelve |
|---|---|---|
| `rut_valido(p_rut text)` | `anon`, `authenticated` | `true` si el RUT tiene formato `12345678-K` (hasta 8 dígitos, guion, DV con K mayúscula) y DV módulo 11 correcto. `strict`: con `null` devuelve `null` |
| `correo_sii_valido(p_correo text)` | `anon`, `authenticated` | `true` si cumple la regla `esValidoMail2` del SII (máx. 50, sin caracteres prohibidos, un `@`, punto en el dominio) |
| `uuid_o_nulo(p_texto text)` | `authenticated` | el `uuid`, o `null` si el texto no es uuid (rutas de Storage) |
| `clasificar_envio(...)` | `authenticated` | la `clasificacion_envio` de un envío (columna generada de `envios`) |

Detalle de formatos en [formatos y validaciones](../01-fundamentos/formatos-y-validaciones.md).
