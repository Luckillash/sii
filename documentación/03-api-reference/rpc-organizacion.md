---
title: "RPC: organización, equipo, acceso y validación"
description: "crear_organizacion, crear_invitacion, aceptar_invitacion, ver_invitacion, registrar_resolucion, fijar_certificado_predeterminado y funciones de acceso y validación."
keywords: [rpc, supabase.rpc, crear_organizacion, crear_invitacion, aceptar_invitacion, ver_invitacion, registrar_resolucion, fijar_certificado_predeterminado, resolución vigente, certificado predeterminado, for no key update, token, token_hash, sha256, invitación, slug, 42501, P0002, 22004, "Sin permiso", "Invitación inválida o vencida", "Requiere sesión", "La empresa no existe", "El certificado no está asociado a la empresa", es_miembro, es_admin, puede_emitir, rut_valido, correo_sii_valido]
related: ["02-guias/onboarding-organizacion.md", "01-fundamentos/tenancy-y-roles.md", "03-api-reference/acceso-por-tabla.md", "04-objetos/objetos-empresas-y-credenciales.md"]
source: ["supabase_saas_sii.sql §2 §5 §15 §17", "supabase/migrations/0003_preferencias.sql", "supabase/migrations/0005_certificados_resoluciones.sql"]
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
| `registrar_resolucion(p_empresa, p_ambiente, p_numero, p_fecha)` (migración 0005) | `authenticated` (administradores), `service_role` | `uuid` | reemplaza la resolución vigente de la empresa en ese ambiente |
| `fijar_certificado_predeterminado(p_empresa, p_certificado)` (migración 0005) | `authenticated` (administradores), `service_role` | `void` | deja ese certificado como el único predeterminado de la empresa |

`anon` no ejecuta `crear_organizacion`, `crear_invitacion`, `aceptar_invitacion`,
`registrar_resolucion` ni `fijar_certificado_predeterminado`: recibe `42501`
`permission denied for function …`.

La tercera RPC de la migración 0005, `registrar_certificado`, es solo de `service_role`
y está en [RPC del backend](rpc-backend.md#registrar_certificado-migración-0005).

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

## Empresa: resolución y certificado predeterminado (migración 0005)

Las dos vienen en `supabase/migrations/0005_certificados_resoluciones.sql`, aplicada en producción el
2026-11-13 (verificación 15/15).

A diferencia de las de arriba, son **`security invoker`**: corren con el RLS de quien
llama, así que solo escriben si es administrador de la organización. Existen porque las
dos tablas tienen un **índice único parcial** (`resoluciones_vigente_unica` y
`empresa_certificados_predeterminado_unico`) que Postgres revisa fila a fila: para
cambiar cuál es la vigente o la predeterminada hay que apagar la actual **antes** de
encender la nueva, en la misma transacción. Con escrituras sueltas desde la app, un
fallo entre una y otra dejaría la empresa sin vigente o sin predeterminado.

Comportamiento común:

- Primero buscan la fila con el RLS de quien llama: si es de otra organización, es lo
  mismo que no existir (`P0002`). Después revisan `es_admin`: un emisor o lector, que sí
  ve la fila, recibe `42501` `Sin permiso`.
- Antes de escribir toman `for no key update` sobre la fila de la empresa. Dos llamadas
  simultáneas para la misma empresa se ordenan (la segunda espera y ve lo que dejó la
  primera) en vez de chocar con el índice. `no key update` no bloquea las FK que apuntan
  a la empresa. El candado exige pasar la política `UPDATE` de `empresas`, por eso va
  después de la revisión de permisos.
- Con `service_role` (sin `auth.uid()`) también sirven: se salta la revisión de
  administrador, igual que en `tg_limite_empresas`.
- `authenticated` no necesita grants nuevos: ya tiene `select`/`insert`/`update` sobre
  esas tablas (RLS decide las filas) y `execute` sobre `es_admin`.

### `registrar_resolucion` (migración 0005)

```sql
public.registrar_resolucion(
  p_empresa  uuid,
  p_ambiente public.ambiente_sii,
  p_numero   integer,
  p_fecha    date
) returns uuid
-- security invoker · search_path = '' · grant execute to authenticated, service_role
```

**Quién:** propietarios y administradores de la organización de la empresa.

**Efectos** (en una transacción):

1. Valida los datos (ver errores).
2. Bloquea la empresa (`for no key update`).
3. Deja `vigente = false` la resolución vigente de esa empresa **y ese ambiente**. La de
   otro ambiente no se toca. La anterior se conserva como historial.
4. Inserta la nueva con `vigente = true`. `organizacion_id` no se pasa: lo llena
   `trg_00_organizacion` desde la empresa, antes del `WITH CHECK` de RLS.

Devuelve el `id` de la resolución nueva. Registrar dos veces los mismos datos crea dos
filas (la primera queda en el historial).

**Errores**

| Código | Mensaje | Causa |
|---|---|---|
| `P0002` | `La empresa no existe` | id inexistente, o de una organización de la que quien llama no es miembro |
| `42501` | `Sin permiso` | quien llama ve la empresa pero no es administrador (emisor, lector) |
| `22004` | `Faltan el ambiente, el número o la fecha de la resolución` | algún parámetro nulo |
| `23514` | `El número de resolución no puede ser negativo` | `p_numero < 0` |
| `23514` | `En certificación el número de resolución es 0` | `p_ambiente = 'certificacion'` y `p_numero <> 0` (el mismo check de la tabla, adelantado para dar un mensaje claro) |
| `23505` | `duplicate key … "resoluciones_vigente_unica"` | no debería pasar gracias al candado; la app lo traduce como «Se registró otra resolución al mismo tiempo» |

La base acepta número 0 en producción; la app exige ≥ 1 y una fecha que no sea futura en
hora de Chile (`esquemaResolucion`).

```ts
const { error } = await supabase.rpc('registrar_resolucion', {
  p_empresa: empresa.id,
  p_ambiente: 'certificacion',
  p_numero: 0,
  p_fecha: '2026-11-10', // AAAA-MM-DD
});
// error.code → traducirErrorEmpresa(error, 'resolucion') en server/empresas-errores.ts
```

### `fijar_certificado_predeterminado` (migración 0005)

```sql
public.fijar_certificado_predeterminado(p_empresa uuid, p_certificado uuid) returns void
-- security invoker · search_path = '' · grant execute to authenticated, service_role
```

**Quién:** propietarios y administradores de la organización de la empresa.

**Efectos** (en una transacción):

1. Comprueba que exista la asociación `(p_empresa, p_certificado)` en
   `empresa_certificados` y que sea visible para quien llama.
2. Bloquea la empresa (`for no key update`).
3. Pone `predeterminado = false` en la que lo era (si es otra).
4. Pone `predeterminado = true` en la indicada.

Repetirla con el mismo certificado no cambia nada y no falla. Para dejar la empresa
**sin** predeterminado no hay RPC: basta un `update … set predeterminado = false`
directo (apagar no choca con el índice).

**Errores**

| Código | Mensaje | Causa |
|---|---|---|
| `P0002` | `El certificado no está asociado a la empresa` | no hay asociación, o es de otra organización (RLS no la deja ver). También si el `update` final no afectó filas |
| `42501` | `Sin permiso` | quien llama ve la asociación pero no es administrador |

Asociar no fija el predeterminado por sí solo: la app inserta la fila con
`predeterminado = false` y después llama a esta RPC (`server/certificados/asociaciones.ts`).

```ts
const { error } = await supabase.rpc('fijar_certificado_predeterminado', {
  p_empresa: empresaId,
  p_certificado: certificadoId,
});
// error.code → traducirErrorCertificado(error, 'predeterminado'):
// P0002 → «No se aplicó el cambio»; 42501 → «No tienes permiso para hacer esto»
```

Verificación: comprobaciones 13–20 (resoluciones) y 31–39 (predeterminado) de
`supabase/verificaciones/rls-fase3-empresas.sql`, y las de firma y privilegios de
`supabase/verificaciones/0005_certificados_resoluciones.sql`. Se corren después de
aplicar la 0005 ([probar el esquema](../05-pruebas/probar-el-esquema.md)).

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
