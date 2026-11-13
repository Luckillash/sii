---
title: "Multi-tenancy, roles y funciones de acceso"
description: "Organizaciones como tenant, roles de miembro, funciones de acceso y herencia de organizacion_id."
keywords: [tenant, organización, organizacion_id, miembros_organizacion, rol_miembro, propietario, administrador, emisor, lector, es_miembro, tiene_rol, es_admin, puede_emitir, comparte_organizacion, tg_heredar_organizacion, tg_proteger_ultimo_propietario, max_usuarios, exigir_cupo_usuarios, plan_vigente, RLS]
related: ["08-esquema-supabase/rls-y-privilegios.md", "03-api-reference/acceso-por-tabla.md", "03-api-reference/rpc-organizacion.md", "05-pruebas/probar-el-esquema.md"]
source: ["supabase_saas_sii.sql §4 §5 §15 §17", "supabase/verificaciones/rls-fase2-tenancy.sql"]
---

# Multi-tenancy, roles y funciones de acceso

> **Úsalo cuando:** necesitas saber quién puede ver o escribir qué.

## La organización es el tenant

- El cliente del SaaS es una **organización** (`organizaciones`). Puede administrar varias
  empresas emisoras (p. ej. un estudio contable con sus clientes).
- Cada persona es un usuario de Supabase Auth (`auth.users`). Al registrarse, el trigger
  `trg_nuevo_usuario` le crea su fila en `perfiles` (correo y `raw_user_meta_data.nombre`).
- La pertenencia vive en `miembros_organizacion` (clave `organizacion_id, usuario_id`) con
  un **rol** (`rol_miembro`). Un usuario puede estar en varias organizaciones, con un rol
  distinto en cada una.
- **Toda tabla de datos tiene `organizacion_id`.** Las políticas RLS filtran por esa
  columna con las funciones de acceso de abajo; nunca por la empresa ni por el usuario
  que creó la fila.
- `service_role` (capa SII, cron, API pública) salta RLS: por eso **siempre** filtra por
  `organizacion_id` a mano (PLAN-SAAS §2).

Las organizaciones se crean solo con `crear_organizacion()` y los miembros entran con
`crear_invitacion()` + `aceptar_invitacion()` ([contratos](../03-api-reference/rpc-organizacion.md)).

## Roles

`rol_miembro`: `propietario`, `administrador`, `emisor`, `lector` (default de la columna:
`lector`). Los permisos son acumulativos: cada rol puede lo del de abajo.

| Acción | propietario | administrador | emisor | lector |
|---|:-:|:-:|:-:|:-:|
| Ver los datos de la organización (empresas, documentos, envíos, folios, certificados, suscripción, uso, operaciones) | sí | sí | sí | sí |
| Ver los perfiles de los compañeros | sí | sí | sí | sí |
| Editar el propio perfil | sí | sí | sí | sí |
| Crear, editar y borrar **borradores** (`documentos` y `documento_detalles` en `estado = 'borrador'`, sin folio) | sí | sí | sí | no |
| Crear y editar receptores y productos | sí | sí | sí | no |
| Emitir (folio, firma, envío al SII) | sí | sí | sí | no |
| Borrar receptores y productos | sí | sí | no | no |
| Administrar empresas, resoluciones, asociación empresa–certificado y proceso de certificación | sí | sí | no | no |
| Anular folios (`folios_anulados`) | sí | sí | no | no |
| Editar la organización (nombre, slug) | sí | sí | no | no |
| Ver, crear y borrar invitaciones, API keys y webhooks | sí | sí | no | no |
| Cambiar el rol o dar de baja a miembros que **no** son propietarios | sí | sí | no | no |
| Nombrar o quitar propietarios | sí | no | no | no |
| Borrar la organización | sí | no | no | no |
| Salir de la organización (baja propia) | sí, si no es el último propietario | sí | sí | sí |

Notas:

- **Emitir** no es una escritura directa: el folio lo asigna `asignar_folio()` y lo
  timbrado lo escribe el backend con `service_role` (`authenticated` no puede ejecutar
  `asignar_folio`). La regla de quién puede pedirlo es `puede_emitir()`; el backend la
  valida antes de operar (PLAN-SAAS Fase 7).
- **Certificados, CAF, envíos, solicitudes de folios, RCOF, set de pruebas, operaciones,
  uso y suscripciones** los escribe solo el backend. Para los usuarios son de solo lectura,
  sea cual sea su rol (detalle en [acceso por tabla](../03-api-reference/acceso-por-tabla.md)).
- La UI oculta acciones según el rol, pero **la autoridad es RLS**: un botón escondido no
  protege nada.
- **Quitar a un miembro corta su acceso al instante**, porque `es_miembro()` se evalúa
  en cada consulta. Borrar o banear al usuario en Auth, en cambio, deja vivo su token
  de acceso hasta una hora ([sesiones y revocación](ambientes-y-credenciales.md#sesiones-de-usuario-y-revocación)):
  para una baja urgente, primero se quita la membresía.
- La autorización a producción (`empresas.autorizada_produccion`) y la etapa del proceso
  de certificación solo las cambia el sistema (`tg_proteger_autorizacion`,
  `tg_proteger_proceso`), aunque el usuario sea administrador.

## Funciones de acceso

Las usan las políticas RLS. Todas son `stable security definer`, con `search_path = ''`, y
leen el usuario de `auth.uid()` (el `sub` de `request.jwt.claims`). Son `security definer`
para poder leer `miembros_organizacion` sin volver a pasar por su propio RLS. Las ejecuta
`authenticated`; `anon` no.

| Función | Devuelve `true` si el usuario actual… |
|---|---|
| `es_miembro(p_organizacion uuid)` | es miembro de la organización, con cualquier rol |
| `tiene_rol(p_organizacion uuid, p_roles rol_miembro[])` | es miembro con alguno de los roles de la lista |
| `es_admin(p_organizacion uuid)` | es `propietario` o `administrador` (`tiene_rol(org, '{propietario,administrador}')`) |
| `puede_emitir(p_organizacion uuid)` | es `propietario`, `administrador` o `emisor` |
| `comparte_organizacion(p_usuario uuid)` | comparte al menos una organización con `p_usuario` (lectura de `perfiles`) |

Sin sesión (`auth.uid()` nulo) todas devuelven `false`. Úsalas también en la app para
decidir qué mostrar, con `supabase.rpc('es_admin', { p_organizacion })`.

## Herencia de `organizacion_id`

En las tablas hijas, `organizacion_id` **no lo decide quien escribe**: el trigger
`trg_00_organizacion` (función `tg_heredar_organizacion`, `before insert or update`)
lo copia del padre y pisa lo que venga en la fila. El `WITH CHECK` de RLS se evalúa
después, sobre el valor heredado. Así nadie puede colgar una fila de una empresa ajena
declarando su propia organización.

| Tabla | Hereda de | Por la columna |
|---|---|---|
| `resoluciones`, `empresa_certificados`, `cafs`, `solicitudes_folios`, `receptores`, `productos`, `envios`, `documentos`, `rcof`, `procesos_certificacion` | `empresas` | `empresa_id` |
| `folios_anulados` | `cafs` | `caf_id` |
| `envio_estadisticas`, `consultas_envio`, `envio_rechazos` | `envios` | `envio_id` |
| `documento_detalles` | `documentos` | `documento_id` |
| `set_pruebas_casos` | `procesos_certificacion` | `proceso_id` |

Errores del trigger: `<tabla>.<columna> es obligatorio` si la FK viene nula, y
`No existe <padre> <id>` (`23503`, `foreign_key_violation`) si el padre no existe.

Verificado en la simulación de roles: un emisor que inserta un borrador con la empresa de
su organización y el `organizacion_id` de otra queda con el de la empresa; un usuario de
otra organización que apunta a esa empresa recibe `42501` (`new row violates row-level
security policy for table "documentos"`).

Las tablas sin padre (`empresas`, `certificados`, `invitaciones`, `suscripciones`,
`uso_mensual`, `operaciones_sii`, `api_keys`, `webhooks`, `webhook_entregas`,
`miembros_organizacion`) reciben `organizacion_id` explícito; ahí lo protege el
`WITH CHECK` de la política (o la escribe solo el backend).

## Regla del último propietario

`trg_proteger_ultimo_propietario` (`before update or delete` en `miembros_organizacion`)
impide que una organización quede sin propietario: si la fila es de un propietario y se
borra o cambia de rol, y no hay otro propietario, lanza
`La organización debe tener al menos un propietario` (`P0001`).

- Vale también para la baja propia: el único propietario no puede salir ni degradarse.
  Primero nombra a otro propietario y después se degrada o sale.
- **Excepción:** borrar la organización completa. La cascada borra los miembros cuando la
  organización ya no existe, y el trigger lo permite.
- Además, RLS impide que un administrador toque a un propietario: no puede ascender a
  nadie (ni a sí mismo) a propietario (`42501`), y un `update` o `delete` sobre la fila de
  un propietario no afecta filas (0 filas, sin error).
- `aceptar_invitacion()` hace `on conflict do update set rol = excluded.rol`: si quien
  acepta ya era miembro, su rol pasa a ser el de la invitación (según el SQL). Un
  propietario que acepta una invitación de lector queda como lector, salvo que sea el
  último propietario (entonces el trigger lo impide).

## Cupos de usuarios y empresas por plan

`plan_vigente(org)` devuelve el plan de la suscripción más reciente en estado `prueba` o
`activa`. Valores actuales de `planes` (de ejemplo, PLAN-SAAS D5):

| Plan (`codigo`) | `max_usuarios` | `max_empresas` |
|---|---|---|
| `certificacion` | 2 | 1 |
| `emprendedor` | 2 | 1 |
| `pyme` | 5 | 3 |
| `empresa` | sin límite | sin límite |

- **Usuarios.** `exigir_cupo_usuarios(org)` cuenta las filas de `miembros_organizacion`
  (el propietario incluido; las invitaciones pendientes no cuentan) y lanza
  `El plan <nombre> permite como máximo <n> usuario(s)` si ya está lleno. Lo llaman
  `aceptar_invitacion()` (solo si quien acepta no era miembro) y el trigger
  `trg_10_limite_usuarios` en altas directas de un administrador o de `service_role`.
  `crear_invitacion()` **no** revisa el cupo: la invitación se crea y el error aparece
  al aceptarla. Conviene que la UI avise antes de invitar.
- **Empresas.** `trg_10_limite_empresas` (solo para administradores y `service_role`)
  lanza `El plan <nombre> permite como máximo <n> empresa(s)` o
  `La organización no tiene una suscripción vigente`.
- **Sin suscripción vigente** (`morosa` o `cancelada`): las empresas nuevas se rechazan,
  pero el cupo de usuarios **no se aplica** (con `plan_vigente` nulo, `max_usuarios` es
  nulo y cuenta como ilimitado). Verificado con una prueba con `rollback`: una
  organización Certificación morosa aceptó un tercer miembro. Es una brecha del esquema
  `0001` que corrige la migración `0004_cupo_sin_suscripcion` (aplicada el 2026-11-12):
  desde ella, `exigir_cupo_usuarios` también lanza `La organización no tiene una
  suscripción vigente`, igual que las empresas.

Verificación: `supabase/verificaciones/rls-fase2-tenancy.sql` prueba todo lo anterior
con usuarios ficticios y `rollback` ([cómo correrlo](../05-pruebas/probar-el-esquema.md)).
