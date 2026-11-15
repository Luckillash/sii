---
title: "Objetos: folios"
description: "Columnas de cafs, solicitudes_folios, folios_anulados y la vista v_folios_disponibles, y cómo las escriben la gestión de folios (Fase 6) y el set de pruebas (Fase 5)."
keywords: [cafs, solicitudes_folios, folios_anulados, v_folios_disponibles, caf_secret_id, Vault, registrar_caf, anular_folios, trg_20_caf_sin_traslape, tg_caf_sin_traslape, 23P01, migración 0011, solicitud_id, siguiente_folio, estado_caf, activo, agotado, anulado, estado_solicitud_folios, en_curso, timbrada, incierta, rechazada, simulada, revisión con el SII, asignar_folio, IDK, RangoAnulados, motivo, anulado_por, cafs_disponibles]
related: ["02-guias/folios-caf.md", "03-api-reference/rpc-backend.md", "03-api-reference/acceso-por-tabla.md", "05-pruebas/set-de-pruebas.md", "09-libreria/mapeo-libreria-tablas.md", "04-objetos/codigos-y-enumeraciones.md"]
source: ["supabase_saas_sii.sql §7 §16", "supabase/migrations/0001_esquema_inicial.sql", "supabase/migrations/0008_certificacion.sql", "supabase/migrations/0011_folios.sql", "apps/web/src/server/folios/", "apps/web/src/server/certificacion/folios.ts", "apps/web/src/server/certificacion/envio-set.ts"]
---

# Objetos: folios

> **Úsalo cuando:** necesitas los campos de un CAF, una solicitud de folios o un folio anulado.

Las tres tablas son de la §7 de la `0001` y tienen RLS de lectura para cualquier miembro.
`cafs` y `solicitudes_folios` no tienen políticas de escritura: las escribe el backend con
`service_role` filtrando por `organizacion_id`. La app anula con la RPC `anular_folios`
([acceso](../03-api-reference/acceso-por-tabla.md#folios)). La migración `0011_folios`
(**aplicada el 2026-11-15**) agrega la RPC y el trigger contra traslapes, quita la política
`alta` de `folios_anulados` (que dejaba insertar directo a un administrador) y revoca a
`authenticated` `insert`, `update`, `delete` y `truncate` en esa tabla, y publica `cafs` y
`folios_anulados` en Realtime; no cambia columnas.

## `cafs`

Archivo de Autorización de Folios. El XML completo (con `<RSASK>`) vive en Vault.

| Columna | Tipo | Notas |
|---|---|---|
| `id` ✔ | `uuid` | default `gen_random_uuid()` |
| `organizacion_id` ✔ | `uuid` | FK `organizaciones`, cascada; lo hereda `trg_00_organizacion` de la empresa |
| `empresa_id` ✔ | `uuid` | FK `empresas`, cascada |
| `ambiente` ✔ | `ambiente_sii` | |
| `tipo_dte` ✔ | `smallint` | FK `tipos_dte` (hoy 39 y 41) |
| `folio_desde` ✔ | `integer` | `<RNG><D>`, `>= 1` |
| `folio_hasta` ✔ | `integer` | `<RNG><H>`, `>= folio_desde` |
| `siguiente_folio` ✔ | `integer` | el que entrega `asignar_folio`; `trg_10_caf_inicial` lo deja en `folio_desde`; entre `folio_desde` y `folio_hasta + 1` |
| `fecha_autorizacion` ✔ | `date` | `<FA>` |
| `idk` ✔ | `smallint` | `<IDK>`: `check` 100 en certificación, 300 en producción |
| `rut_emisor` ✔ | `rut` | `<RE>` |
| `razon_social` | `text` | `<RS>` |
| `caf_secret_id` ✔ | `uuid` | secreto de Vault con el XML; `trg_borrar_secretos` lo borra con la fila. La UI nunca lo lee |
| `estado` ✔ | `estado_caf` | `activo` (default), `agotado`, `anulado` |
| `solicitud_id` | `uuid` | FK `solicitudes_folios`, `set null`: la solicitud que lo trajo (nula si se subió a mano sin incierta) |
| `creado_en`, `actualizado_en` ✔ | `timestamptz` | |

Restricciones: `unique (empresa_id, ambiente, tipo_dte, folio_desde)` (dos CAF no empiezan
en el mismo folio) y, con la 0011, `trg_20_caf_sin_traslape`: dos CAF de la misma empresa,
ambiente y tipo no pueden cruzar sus rangos, en ningún estado (`23P01`;
[contrato](../03-api-reference/rpc-backend.md#trg_20_caf_sin_traslape-migración-0011)).
Índice parcial `cafs_disponibles (empresa_id, ambiente, tipo_dte, folio_desde) where estado
= 'activo'`. `trg_60_contar_uso` suma los folios de un CAF de **producción** en
`uso_mensual.folios_timbrados`.

| Quién escribe | Qué |
|---|---|
| `registrar_caf` (0008, service_role) | **la única vía de alta**: desde un timbraje (`solicitarEnSii`, Fases 5 y 6) o una carga manual (`subirCaf`). Pone `siguiente_folio = folio_desde`, `estado = 'activo'`, `caf_secret_id` y `solicitud_id`; con el mismo CAF devuelve el id existente (solo enlaza `solicitud_id` si faltaba) |
| `asignar_folio` | `siguiente_folio + 1`; `agotado` al pasar de `folio_hasta` |
| `anular_folios` (0011) | al anular la cola completa: `siguiente_folio = folio_hasta + 1` y `estado = 'anulado'` |

Ni `asignar_folio` ni `anular_folios` ni el enlace de `solicitud_id` disparan el trigger de
traslape (solo `insert` o `update` de rango, ambiente, tipo o empresa).

## `solicitudes_folios`

Bitácora de `SolicitudFolios` (asistente `cvc_cgi/dte/of_*`). Publicada en Realtime (0006).

| Columna | Tipo | Notas |
|---|---|---|
| `id` ✔ | `uuid` | |
| `organizacion_id` ✔, `empresa_id` ✔ | `uuid` | |
| `certificado_id` | `uuid` | el del representante electrónico; `set null` |
| `ambiente` ✔ | `ambiente_sii` | |
| `tipo_dte` ✔ | `smallint` | |
| `cantidad` ✔ | `integer` | `>= 1` (la app limita a 10.000) |
| `folio_inicial` | `integer` | solo si el SII lo pidió (primer timbraje del tipo en el ambiente) |
| `confirmada` ✔ | `boolean` | `false` = revisión con el SII; `check`: `timbrada` exige `true` |
| `estado` ✔ | `estado_solicitud_folios` | default `en_curso` |
| `folio_desde`, `folio_hasta` | `integer` | rango que fijó el SII (también en `simulada` e `incierta`) |
| `caf_id` | `uuid` | FK `cafs`, `set null`; lo pone `registrar_caf` |
| `mensaje` | `text` | saneado; nunca el XML |
| `solicitado_por` | `uuid` | `auth.users`, `set null` |
| `creado_en` ✔, `terminado_en` | `timestamptz` | |

| Momento | Escritura (service_role, `solicitarEnSii`) |
|---|---|
| Antes de salir | `insert` con `estado = 'en_curso'`, `confirmada` (`false` en la revisión), `ambiente`, `tipo_dte`, `cantidad`, `folio_inicial`, `certificado_id`, `solicitado_por`; se enlaza a la operación (`operaciones_sii.solicitud_id`) |
| Revisión detenida antes de timbrar | `simulada` con `folio_desde`/`folio_hasta` |
| CAF guardado | `registrar_caf` la deja `timbrada` con el rango, `caf_id` y `terminado_en` |
| Error de la librería | `rechazada` (`ErrorSolicitudFolios`, `FolioInicialRequeridoError`), `incierta` con el rango (`FoliosSinCafError`) o `error` (red u otro), con `mensaje` saneado |
| CAF timbrado sin guardar | `incierta` con el rango del CAF (si se pudo leer) y «Se timbraron los folios, pero no pudimos guardar el CAF…» |
| Incierta resuelta al subir el CAF | `registrar_caf` (con `p_solicitud`) la deja `timbrada` con el CAF |

Un ensayo no crea fila. Una `simulada` es la `revisionId` que habilita timbrar en producción
(misma empresa, ambiente, tipo, cantidad y folio inicial, menos de 30 min, un solo uso).

## `folios_anulados`

Folios no usados. Van en `<RangoAnulados>` del RCOF.

| Columna | Tipo | Notas |
|---|---|---|
| `id` ✔ | `uuid` | |
| `organizacion_id` ✔ | `uuid` | lo hereda `trg_00_organizacion` del CAF |
| `caf_id` ✔ | `uuid` | FK `cafs`, cascada |
| `folio` ✔ | `integer` | `unique (caf_id, folio)` |
| `motivo` | `text` | nulo permitido por la tabla; `anular_folios` lo exige (1–500, sin espacios a los lados) |
| `anulado_por` | `uuid` | `auth.users`, `set null`; nulo si anula el backend sin usuario |
| `creado_en` ✔ | `timestamptz` | |

| Quién escribe | Cuándo |
|---|---|
| `anular_folios` (0011) | un administrador desde `/folios` (cliente de sesión) o el backend: un rango bajo `siguiente_folio` o la cola completa; `on conflict (caf_id, folio) do nothing` |
| `enviarSet` (Fase 5, `insert` directo con service_role) | folios asignados a un set que no llegó al SII o que el SII rechazó sin Track ID, con el motivo «El set no se alcanzó a enviar al SII.» o «El SII rechazó la subida del set sin entregar un Track ID.» |

La vista cuenta los anulados por CAF (`count: 'exact', head: true`) sin traer las filas.

## `v_folios_disponibles`

Vista `security_invoker` (aplica el RLS de quien consulta) de la §16:

| Columna | Cálculo, por organización, empresa, ambiente y tipo, sobre los CAF `activo` |
|---|---|
| `cafs_activos` | `count(*)` |
| `folios_disponibles` | Σ (`folio_hasta − siguiente_folio + 1`) |
| `proximo_folio` | `min(siguiente_folio)` |

La app no la consulta: calcula lo mismo en `disponibilidadDe` (`@/lib/folios`), que además
da el denominador del 15 % (tamaño de los CAF activos con folios libres) y el CAF en uso
([regla](../02-guias/folios-caf.md#disponibilidad-y-umbral)). Un CAF `activo` sin folios
libres no existe en la práctica (`asignar_folio` lo pasa a `agotado`).
