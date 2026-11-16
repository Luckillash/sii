---
title: "Objetos: envíos y RCOF"
description: "Columnas de envios, envio_estadisticas, consultas_envio, envio_rechazos, rcof y v_envios_por_consultar; clasificacion, incierto y cómo los escriben el set de pruebas y la emisión."
keywords: [envios, envio_estadisticas, consultas_envio, envio_rechazos, rcof, v_envios_por_consultar, clasificacion_envio, clasificar_envio, proposito_envio, emision, set_pruebas, track_id, incierto, estado_sii, respuesta_subida, respuesta_estado, xml_path, EnvioBOLETA, nombre_archivo, envio.xml, sincronizar_documentos_envio, trg_50_envio_actualizado, envio.actualizado, Fase 7]
related: ["02-guias/seguimiento-envios.md", "02-guias/emision-boletas.md", "04-objetos/objetos-documentos.md", "05-pruebas/set-de-pruebas.md", "09-libreria/mapeo-libreria-tablas.md"]
source: ["supabase_saas_sii.sql §9 §11 §16", "supabase/migrations/0001_esquema_inicial.sql", "apps/web/src/server/emision/emitir.ts", "apps/web/src/server/certificacion/envio-set.ts"]
---

# Objetos: envíos y RCOF

> **Úsalo cuando:** necesitas los campos de un envío o su estado.

Solo el backend escribe estas tablas (`service_role`); los miembros las leen
([acceso por tabla](../03-api-reference/acceso-por-tabla.md)). `envios` está publicada en
Realtime (0001 §19).

## `envios`

Un sobre subido al SII: `EnvioBOLETA` (REST o DTEWS) o `ConsumoFolios` (RCOF).

| Columna | Tipo | Notas |
|---|---|---|
| `organizacion_id`, `empresa_id` ✔, `ambiente` ✔ | | |
| `canal` | `canal_sii` | `rest` por defecto |
| `proposito` | `proposito_envio` | `emision` (Fase 7), `set_pruebas` (Fase 5), `rcof` 🕰️ |
| `rut_envia` ✔ | `rut` | carátula: RUT de quien envía (titular del certificado) |
| `certificado_id` | `uuid` | `on delete set null` |
| `nro_resol` ✔ (≥ 0), `fch_resol` ✔ | | resolución de la carátula (certificación: número 0) |
| `tmst_firma` | `timestamptz` | `<TmstFirmaEnv>` |
| `nombre_archivo` | `text` | nombre del multipart (`envio.xml` en las boletas, `NOMBRE_ARCHIVO_BOLETA`) |
| `xml_path` | `text` | sobre en Storage |
| `track_id` | `text` (solo dígitos) | único por `(empresa_id, ambiente, track_id)` |
| `enviado_en`, `fecha_recepcion` | `timestamptz` | `fecha_recepcion` solo si el SII la da con zona horaria |
| `incierto` | `boolean` | sin Track ID tras subir: no se sabe si llegó. `check (not (incierto and track_id is not null))` |
| `error` | `text` | motivo de un envío que no salió, se anuló o quedó incierto (texto propio de la app, sin secretos) |
| `estado_sii`, `glosa_sii` | `text` | de la subida (solo `REC`, `SOK`, `CRT`, `FOK`, `PRD`, `EPR`) o de la consulta |
| `informados`, `aceptados`, `rechazados`, `reparos` | `integer` | conteos de la consulta |
| `clasificacion` | `clasificacion_envio` | **generada** con `clasificar_envio(...)` (abajo) |
| `respuesta_subida`, `respuesta_estado` | `jsonb` | JSON completo de la subida y de la última consulta |
| `ultima_consulta_en`, `consultas` | | |

### `clasificacion`

Igual que `sii produccion seguimiento`:

| Valor | Cuándo |
|---|---|
| `incierto` | `incierto = true` |
| `pendiente` | sin `estado_sii` |
| `en_proceso` | `REC`, `SOK`, `CRT`, `FOK`, `PRD` |
| `aceptado` | `EPR`, todos aceptados, sin reparos |
| `aceptado_con_reparos` | `EPR`, sin rechazos, con reparos |
| `rechazado` | `EPR` con rechazos, o cualquier otro estado (`RSC`, `RFR`, `RCT`, `RCH`…) |
| `inconsistente` | `EPR` cuyos conteos no cuadran |

`trg_50_envio_actualizado` (al cambiar `estado_sii`, `incierto` o los conteos) llama a
`sincronizar_documentos_envio`, que lleva el estado a los documentos del envío (salvo los
`anulado`), y encola el webhook `envio.actualizado`. `trg_60_contar_uso` suma
`uso_mensual.envios` al **insertar** un envío, salga o no al SII.

### Cómo lo escribe la emisión (Fase 7)

Un envío por boleta (`proposito = 'emision'`, `canal = 'rest'`), insertado **antes** de
salir, con la carátula y `xml_path` del sobre
(`<org>/<empresa>/<ambiente>/EnvioBOLETA-<tipo>-F<folio>.xml`):

| Camino | Lo que queda en el envío |
|---|---|
| ok | `track_id`, `enviado_en`, `respuesta_subida` y `estado_sii` si es de subida |
| incierto (error después de salir) | `incierto = true` y `error`; el trigger deja el documento `incierto` |
| 4xx o validación (el SII no la recibió) | `error`; el documento queda `anulado` |
| falla antes de enviar, cuota, 0 filas | `error` (el folio se anula) |
| folio anulado en paralelo (`23514`) | `error` «El folio N se anuló antes de usarlo.»; el reintento crea **otro** envío |
| Track ID recibido sin guardar | `incierto = true` y `error` solo si `track_id` quedó nulo |

Detalle en [emisión de boletas](../02-guias/emision-boletas.md#cómo-termina-una-emisión).

## `envio_estadisticas`

`estadistica[]` de la consulta, por `(envio_id, tipo_dte)`: `informados`, `aceptados`,
`rechazados`, `reparos`.

## `consultas_envio`

Bitácora de consultas de estado (`--bitacora` de `seguimiento`): `consultado_en`,
`estado_sii`, `glosa_sii`, conteos, `error` (falla de red o HTTP, saneada) y `respuesta`
(JSON).

## `envio_rechazos`

Documentos rechazados o con reparos (`detalle_rep_rech[]`), únicos por
`(envio_id, tipo_dte, folio)`: `documento_id` (si falta, lo busca `trg_10_envio_rechazo`),
`estado` tal como lo da el SII, `tipo_observacion` (`rechazo` / `reparo`), `descripcion` y
`errores` (arreglo JSON `{ seccion, linea, nivel, codigo, descripcion, detalle }`).
`trg_50_envio_rechazo_sincronizar` vuelve a sincronizar los documentos del envío.

## `rcof` 🕰️

Reporte de consumo de folios, solo para períodos hasta julio de 2022 (`check (fch_final <=
'2022-07-31')`): `fch_inicio`, `fch_final`, `sec_envio`, `resumenes` (arreglo JSON de
`ResumenRcof`) y `envio_id`. Único por `(empresa_id, ambiente, fch_inicio, fch_final,
sec_envio)`.

## `v_envios_por_consultar`

`security_invoker`. Los envíos que el seguimiento tiene que consultar: `clasificacion =
'en_proceso'`, o `pendiente` con `track_id`. La usa el cron de la Fase 8
([seguimiento](../02-guias/seguimiento-envios.md)).

<!-- TODO (Fase 8): cómo escribe el seguimiento automático envio_estadisticas, consultas_envio y envio_rechazos. -->
