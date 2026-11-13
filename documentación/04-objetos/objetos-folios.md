---
title: "Objetos: folios"
description: "Columnas de cafs, solicitudes_folios, folios_anulados y la vista v_folios_disponibles. Hoy cubre cómo las escribe la Fase 5 (folios del set de pruebas)."
keywords: [cafs, solicitudes_folios, folios_anulados, v_folios_disponibles, caf_secret_id, Vault, registrar_caf, solicitud_id, siguiente_folio, estado_caf, estado_solicitud_folios, en_curso, timbrada, incierta, rechazada, simulada, asignar_folio, IDK]
related: ["02-guias/folios-caf.md", "03-api-reference/rpc-backend.md", "05-pruebas/set-de-pruebas.md", "09-libreria/mapeo-libreria-tablas.md"]
source: ["supabase_saas_sii.sql §7 §16", "supabase/migrations/0008_certificacion.sql", "apps/web/src/server/certificacion/folios.ts", "apps/web/src/server/certificacion/envio-set.ts"]
---

# Objetos: folios

> **Úsalo cuando:** necesitas los campos de un CAF o una solicitud de folios.

<!-- TODO (Fase 6): tabla completa de columnas de cafs, solicitudes_folios y folios_anulados, la vista v_folios_disponibles y cómo las escribe la gestión de folios de producción. -->

La tabla completa de columnas llega con la **Fase 6**. Lo que sigue es cómo escribe estas
tablas la **Fase 5** (folios de certificación del set de pruebas,
`apps/web/src/server/certificacion/`). Todas tienen RLS de lectura para miembros; las
escrituras son del backend con `service_role` filtrando por `organizacion_id`
([acceso](../03-api-reference/acceso-por-tabla.md#folios)).

## `cafs` (Fase 5)

Una fila por CAF. **Solo la crea `registrar_caf`** (migración 0008,
aplicada el 2026-11-13; [contrato](../03-api-reference/rpc-backend.md#registrar_caf-migración-0008)),
nunca un `insert` directo desde la app:

| Columna | Valor que pone `registrar_caf` |
|---|---|
| `organizacion_id`, `empresa_id` | los de la llamada (la empresa se verifica dentro de la organización) |
| `ambiente`, `tipo_dte` | `certificacion`, 39 |
| `folio_desde`, `folio_hasta` | `<RNG><D>` y `<RNG><H>` del CAF |
| `siguiente_folio` | `folio_desde` |
| `fecha_autorizacion`, `idk` | `<FA>`, `<IDK>` (100; el `check` de la tabla exige 100 en certificación y 300 en producción) |
| `rut_emisor` | `<RE>` normalizado (sin puntos, mayúsculas); tiene que ser el RUT de la empresa |
| `razon_social` | `<RS>`, nula si viene vacía |
| `caf_secret_id` | id del secreto de Vault con el **XML completo** (incluida `<RSASK>`), descripción `caf:<rut>:<ambiente>:<tipo>:<desde>-<hasta>` |
| `solicitud_id` | la solicitud que lo pidió |
| `estado` | `activo` (default) |

Llave única `(empresa_id, ambiente, tipo_dte, folio_desde)`: un segundo registro del
mismo CAF devuelve el id existente sin crear otro secreto; otro rango con el mismo
`folio_desde` da `23505`. Después, `asignar_folio` avanza `siguiente_folio` y pasa el CAF
a `agotado` al terminarse. La UI nunca lee `caf_secret_id` (`leerAsistente` pide solo
`id`, `folio_desde`, `folio_hasta`, `siguiente_folio`).

## `solicitudes_folios` (Fase 5)

Bitácora de cada solicitud **confirmada** al SII. El ensayo no crea fila (no se usa
`simulada`).

| Momento | Escritura |
|---|---|
| Antes de salir | `insert` con `estado = 'en_curso'`, `confirmada = true`, `ambiente`, `tipo_dte = 39`, `cantidad`, `folio_inicial` (si se informó), `certificado_id` (el del representante), `solicitado_por` |
| CAF guardado | `registrar_caf` la deja `timbrada` con `folio_desde`, `folio_hasta`, `caf_id` y `terminado_en` |
| Error de la librería | `update` con `estado` (`rechazada` para `ErrorSolicitudFolios` y `FolioInicialRequeridoError`; `incierta` con el rango para `FoliosSinCafError`; `error` para red u otro), `mensaje` saneado y `terminado_en` |
| CAF timbrado sin guardar | `incierta` con el mensaje «Se timbraron los folios, pero no pudimos guardar el CAF…» |

La fila se enlaza a la operación (`operaciones_sii.solicitud_id`) y está publicada en
Realtime (migración 0006).

## `folios_anulados` (Fase 5)

`enviarSet` inserta un registro por folio asignado cuando el set no llega al SII (falla
antes de salir) o el SII rechaza la subida sin Track ID: `caf_id`, `folio`, `motivo`
(«El set no se alcanzó a enviar al SII.» o «El SII rechazó la subida del set sin entregar
un Track ID.») y `anulado_por`. Si el insert falla, solo queda un aviso en consola (con el
código): la operación termina con el error original.
