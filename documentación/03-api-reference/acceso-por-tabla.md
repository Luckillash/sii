---
title: "Acceso por tabla (PostgREST + RLS)"
description: "Qué puede hacer cada rol en cada tabla: select, insert, update, delete."
keywords: [RLS, PostgREST, políticas, grant, revoke, privilegios por columna, anon, authenticated, service_role, lector, emisor, administrador, propietario, select, insert, update, delete, "new row violates row-level security policy", "permission denied for table", 42501]
related: ["08-esquema-supabase/rls-y-privilegios.md", "01-fundamentos/tenancy-y-roles.md", "03-api-reference/rpc-organizacion.md", "05-pruebas/probar-el-esquema.md"]
source: ["supabase_saas_sii.sql §17", "supabase/verificaciones/rls-fase2-tenancy.sql", "supabase/migrations/0005_certificados_resoluciones.sql", "supabase/verificaciones/rls-fase3-empresas.sql"]
---

# Acceso por tabla (PostgREST + RLS)

> **Úsalo cuando:** vas a leer o escribir una tabla desde el panel.

## Cómo se decide

Una operación pasa solo si se cumplen las dos capas:

1. **Privilegio de tabla (o de columna).** `anon` solo tiene `select` en `tipos_dte`,
   `estados_sii` y `planes` (`revoke all … from anon`). `authenticated` tiene los
   privilegios por defecto de Supabase en todas las tablas, salvo: nada en `tokens_sii` ni
   `sesiones_sii`; en `invitaciones`, `api_keys` y `webhooks` solo `select` y `delete`,
   más `update` en columnas puntuales. `service_role` tiene todo.
2. **Política RLS.** RLS está activo en las 33 tablas. Sin política para una operación,
   `authenticated` no puede hacerla aunque tenga el privilegio. `service_role` salta RLS.

Cómo falla cada caso (lo que ve el cliente en `error`):

| Situación | Resultado |
|---|---|
| Sin privilegio (p. ej. `anon` sobre `empresas`) | `42501` `permission denied for table <tabla>` |
| `insert` o `update` cuya fila nueva no pasa el `WITH CHECK` | `42501` `new row violates row-level security policy for table "<tabla>"` |
| `select`, `update` o `delete` sobre filas que la política `USING` no deja ver | **sin error**: 0 filas. Revisa `count` o el largo de `data` |
| `insert` sin política de `insert` (p. ej. `suscripciones`) | `42501` `new row violates row-level security policy …` |
| `update` o `delete` sin política para esa operación | **sin error**: 0 filas |

Todos los casos «solo filas de sus organizaciones» se refieren a `es_miembro(organizacion_id)`
o a la función de rol que indique la nota ([funciones de acceso](../01-fundamentos/tenancy-y-roles.md#funciones-de-acceso)).

## Matriz

Leyenda: **S** select · **I** insert · **U** update · **D** delete · **—** nada.
Para los roles de miembro (lector, emisor, administrador, propietario) todo se limita a las
filas de sus organizaciones. `service_role` siempre tiene **SIUD** sin RLS (filtra por
`organizacion_id` en el código).

### Catálogos

| Tabla | anon | lector | emisor | administrador | propietario | service_role |
|---|---|---|---|---|---|---|
| `tipos_dte` | S | S | S | S | S | SIUD |
| `estados_sii` | S | S | S | S | S | SIUD |
| `planes` | S ¹ | S ¹ | S ¹ | S ¹ | S ¹ | SIUD |

### Tenancy

| Tabla | anon | lector | emisor | administrador | propietario | service_role |
|---|---|---|---|---|---|---|
| `perfiles` | — | S ² U ³ | S ² U ³ | S ² U ³ | S ² U ³ | SIUD |
| `organizaciones` | — | S | S | SU | SUD | SIUD |
| `miembros_organizacion` | — | S D ⁴ | S D ⁴ | SIUD ⁵ | SIUD ⁶ | SIUD |
| `invitaciones` | — | — | — | S D ⁷ | S D ⁷ | SIUD |
| `suscripciones` | — | S | S | S | S | SIUD |
| `uso_mensual` | — | S | S | S | S | SIUD |

### Empresas y credenciales

| Tabla | anon | lector | emisor | administrador | propietario | service_role |
|---|---|---|---|---|---|---|
| `empresas` | — | S | S | SIUD ⁸ | SIUD ⁸ | SIUD |
| `resoluciones` | — | S | S | SIUD ¹⁴ | SIUD ¹⁴ | SIUD |
| `certificados` | — | S | S | S ¹⁵ | S ¹⁵ | SIUD |
| `empresa_certificados` | — | S | S | SIUD ¹⁶ | SIUD ¹⁶ | SIUD |
| `tokens_sii` 🔒 | — | — | — | — | — | SIUD |
| `sesiones_sii` 🔒 | — | — | — | — | — | SIUD |
| `bloqueos_sii` 🔒 ¹⁷ | — | — | — | — | — | SIUD |

### Folios

| Tabla | anon | lector | emisor | administrador | propietario | service_role |
|---|---|---|---|---|---|---|
| `cafs` | — | S | S | S | S | SIUD |
| `solicitudes_folios` | — | S | S | S | S | SIUD |
| `folios_anulados` | — | S | S | SI | SI | SIUD |

### Catálogo comercial y documentos

| Tabla | anon | lector | emisor | administrador | propietario | service_role |
|---|---|---|---|---|---|---|
| `receptores` | — | S | SIU | SIUD | SIUD | SIUD |
| `productos` | — | S | SIU | SIUD | SIUD | SIUD |
| `documentos` | — | S | S + IUD ⁹ | S + IUD ⁹ | S + IUD ⁹ | SIUD |
| `documento_detalles` | — | S | S + IUD ¹⁰ | S + IUD ¹⁰ | S + IUD ¹⁰ | SIUD |

### Envíos, RCOF y certificación

| Tabla | anon | lector | emisor | administrador | propietario | service_role |
|---|---|---|---|---|---|---|
| `envios` | — | S | S | S | S | SIUD |
| `envio_estadisticas` | — | S | S | S | S | SIUD |
| `consultas_envio` | — | S | S | S | S | SIUD |
| `envio_rechazos` | — | S | S | S | S | SIUD |
| `rcof` 🕰️ | — | S | S | S | S | SIUD |
| `procesos_certificacion` | — | S | S | SIUD ¹¹ | SIUD ¹¹ | SIUD |
| `set_pruebas_casos` | — | S | S | S ¹⁸ | S ¹⁸ | SIUD |

### Auditoría e integraciones

| Tabla | anon | lector | emisor | administrador | propietario | service_role |
|---|---|---|---|---|---|---|
| `operaciones_sii` | — | S | S | S | S | SIUD |
| `api_keys` | — | — | — | S U ¹² D | S U ¹² D | SIUD |
| `webhooks` | — | — | — | S U ¹³ D | S U ¹³ D | SIUD |
| `webhook_entregas` | — | — | — | S | S | SIUD |

### Notas

1. Solo planes con `activo = true`.
2. El perfil propio y los de quienes comparten alguna organización (`comparte_organizacion`).
   Los perfiles se crean con el trigger `trg_nuevo_usuario` y se borran en cascada con
   `auth.users`: no hay `insert` ni `delete` para usuarios.
3. Solo la fila propia (`id = auth.uid()`). El privilegio es de tabla: puede editar
   cualquier columna de su perfil.
4. Solo su propia fila (salir de la organización). El último propietario no puede
   (`tg_proteger_ultimo_propietario`).
5. Altas, cambios de rol y bajas de miembros que **no** son propietarios; la fila nueva
   tampoco puede ser `propietario` (`42501`). Sobre la fila de un propietario, `update` y
   `delete` afectan 0 filas. Las altas directas revisan el cupo del plan
   (`trg_10_limite_usuarios`). Lo normal es entrar por invitación
   ([RPC](rpc-organizacion.md)).
6. Incluye nombrar y quitar propietarios, siempre que quede al menos uno.
7. Se crean solo con `crear_invitacion()`: `authenticated` no tiene `insert` ni `update`
   sobre la tabla.
8. `tg_limite_empresas` aplica el máximo del plan. `autorizada_produccion` y
   `autorizada_en` los fija el sistema: en el `insert` se fuerzan a `false`/`null`, y
   cambiarlos en un `update` lanza error (`tg_proteger_autorizacion`).
9. `puede_emitir`: insertar, editar y borrar solo filas con `estado = 'borrador'` y
   `folio is null`. Un documento con folio solo lo cambia el backend. `organizacion_id`
   se hereda de la empresa (`tg_heredar_organizacion`).
10. `puede_emitir` y el documento padre en `estado = 'borrador'`.
11. `tg_proteger_proceso`: en el `insert` la etapa queda `borrador` y el estado SII en
    `null`; cambiar `etapa`, `codigo_estado_sii` o `paso_sii` en un `update` lanza error.
12. Solo las columnas `nombre`, `revocada_en` y `expira_en`. Se crean con `crear_api_key()`.
13. Solo las columnas `url`, `eventos` y `activo`. Se crean con `crear_webhook()`.
14. `organizacion_id` se hereda de la empresa (`tg_heredar_organizacion`). Para cambiar
    la vigente, la app usa `registrar_resolucion()` (migración 0005, aplicada el
    2026-11-13; `security invoker`, así que aplica esta misma regla): un `insert` directo
    con `vigente = true` cuando ya hay una vigente choca con `resoluciones_vigente_unica`
    ([RPC](rpc-organizacion.md#registrar_resolucion-migración-0005)).
15. Sin políticas de escritura: ni un propietario inserta, edita ni borra certificados
    (el `insert` da `42501`; `update` y `delete`, 0 filas). El alta es
    `registrar_certificado()` (migración 0005, solo `service_role`), y revocar y eliminar
    los hace el backend con `service_role` filtrando por `organizacion_id`
    ([RPC del backend](rpc-backend.md#registrar_certificado-migración-0005)).
16. `organizacion_id` se hereda de la empresa, y la FK compuesta
    `(organizacion_id, certificado_id)` impide asociar un certificado de otra
    organización (`23503`). El predeterminado se cambia con
    `fijar_certificado_predeterminado()` (migración 0005, `security invoker`)
    ([RPC](rpc-organizacion.md#fijar_certificado_predeterminado-migración-0005)).
17. Migración `0007_bloqueos_sii` (aplicada el 2026-11-13). RLS activo sin políticas y
    `revoke all` a `anon` y `authenticated`, como `tokens_sii` y `sesiones_sii`. La app
    no la toca directo: solo por `tomar_bloqueo_certificado` /
    `liberar_bloqueo_certificado` (solo `service_role`)
    ([RPC del backend](rpc-backend.md#tomar_bloqueo_certificado-y-liberar_bloqueo_certificado-migración-0007)).
18. Sin políticas de escritura: ni un administrador escribe casos. El backend de la Fase 5
    los reemplaza con `guardar_set_pruebas()` (migración 0008, aplicada el 2026-11-13; solo
    `service_role`), los borra si el set es ilegible y les pone `documento_id` al enviar
    el set, siempre con `service_role` filtrando por organización
    ([RPC del backend](rpc-backend.md#guardar_set_pruebas-migración-0008)). Las columnas de
    datos de `procesos_certificacion` sí las escribe un administrador (nota 11); `etapa`,
    `codigo_estado_sii` y `paso_sii` solo el backend. Las fechas del SII
    (`postulada_en`, `declarada_en`…), `glosa_estado_sii` y `envio_set_id` también las
    escribe solo el backend, pero ningún trigger las protege: un administrador podría
    cambiarlas con un `update` directo.

`operaciones_sii` la escribe solo la capa SII con `service_role` (`ejecutarOperacion`,
`marcarInciertaRevisada`); los miembros la leen y, con la migración 0006, reciben sus
cambios por Realtime ([Realtime](../06-integraciones/realtime-y-storage.md#realtime)).

## Vistas y Storage

- Las vistas `v_folios_disponibles`, `v_certificados_estado`, `v_envios_por_consultar` y
  `v_ventas_diarias` son `security_invoker`: aplican el RLS de quien consulta sobre las
  tablas de origen.
- Bucket `documentos-xml` (privado): `select` para `authenticated` cuando el primer
  segmento de la ruta es una organización de la que es miembro
  (`<organizacion_id>/<empresa_id>/<ambiente>/<archivo>`). Solo el backend sube archivos,
  con `AlmacenDocumentos` (`server/sii/almacen.ts`)
  ([Storage](../06-integraciones/realtime-y-storage.md#storage-documentos-xml)).

## Verificación

- Privilegios de tabla: consultados en la base con `has_table_privilege` para `anon`,
  `authenticated` y `service_role` (2026-11-12); coinciden con esta página.
- Comportamiento por rol en tenancy, empresas y borradores:
  `supabase/verificaciones/rls-fase2-tenancy.sql` (simulación con `rollback`,
  [cómo correrla](../05-pruebas/probar-el-esquema.md)). El resto de las tablas se cubre
  con la simulación por tabla de la Fase 13.
- Empresas, resoluciones, certificados, asociaciones y `v_certificados_estado` por rol:
  `supabase/verificaciones/rls-fase3-empresas.sql`. Requiere la migración 0005; corrida en
  producción el 2026-11-13 (43/43).
- `bloqueos_sii` y sus dos RPC por rol: `supabase/verificaciones/rls-fase4-bloqueos.sql`
  (21, incluye el índice único de `operaciones_sii`). Requiere la migración 0007; corrida en
  producción el 2026-11-13 (21/21).
