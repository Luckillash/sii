---
title: "Objetos: certificación"
description: "Columnas de procesos_certificacion y set_pruebas_casos, sus triggers y qué módulo del backend escribe cada columna en cada paso del asistente."
keywords: [procesos_certificacion, set_pruebas_casos, etapa, etapa_certificacion, borrador, postulada, set_descargado, set_enviado, set_aceptado, revision_solicitada, por_declarar, autorizada, P90, P91, codigo_estado_sii, glosa_estado_sii, paso_sii, avisos_postulacion, set_pruebas_texto, correo_proveedor_set, envio_set_id, revision_solicitada_en, declarada_en, tg_proteger_proceso, tg_certificacion_autorizada, guardar_set_pruebas, actualizarProceso, CASO-N, documento_id, Realtime]
related: ["02-guias/certificacion-empresa.md", "05-pruebas/set-de-pruebas.md", "03-api-reference/rpc-backend.md", "09-libreria/mapeo-libreria-tablas.md", "04-objetos/objetos-envios-y-rcof.md", "03-api-reference/acceso-por-tabla.md"]
source: ["supabase_saas_sii.sql §12", "supabase/migrations/0008_certificacion.sql", "apps/web/src/server/certificacion/", "apps/web/src/lib/certificacion.ts"]
---

# Objetos: certificación

> **Úsalo cuando:** necesitas los campos del proceso de certificación.

Leyenda: ✔ obligatoria (`not null` sin default útil) · 🔒 solo `service_role` (o el
sistema).

## `procesos_certificacion`

Un proceso por empresa (`empresa_id` es `unique`): la certificación de boleta ante el SII,
siempre en el ambiente de certificación. Se crea al guardar por primera vez los datos de
la postulación (paso 1) y **no se borra** desde la app (se va en cascada con la empresa o
la organización).

| Columna | Tipo | Notas | Quién la escribe |
|---|---|---|---|
| `id` | `uuid` | PK | — |
| `organizacion_id` ✔ | `uuid` | FK `organizaciones`, cascada. La fija `trg_00_organizacion` desde la empresa | trigger |
| `empresa_id` ✔ | `uuid` | FK `empresas`, cascada, **única** | `guardarDatosPostulacion` (al crear) |
| `etapa` | `etapa_certificacion` | default `borrador` ([etapas](#etapas)) | 🔒 backend y triggers |
| `rut_administrador` | `rut` | quien se autentica después para ver el avance y declarar | formulario del paso 1 |
| `correo_administrador`, `correo_contacto_sii`, `correo_intercambio` | `correo_sii` | | formulario del paso 1 |
| `nombre_software` | `text` | 1–30 caracteres | formulario del paso 1 |
| `boleta_exenta` | `boolean` | default `true` | formulario del paso 1 |
| `url` | `text` | nula o `www.…` de hasta 100 | formulario del paso 1 |
| `postulada_en` | `timestamptz` | última postulación aceptada por el SII | 🔒 `postular` |
| `avisos_postulacion` | `jsonb` | default `[]`. Arreglo de textos que el SII mostró al postular (`ResultadoPostulacion.avisos`); la UI los muestra en el paso 1 | 🔒 `postular` |
| `correo_proveedor_set` | `correo_sii` | correo del proveedor de software que se informa al descargar el set | 🔒 `descargarSet` (`guardar_set_pruebas` o set ilegible) |
| `set_pruebas_texto` | `text` | el `.txt` del set tal como lo entregó el SII | 🔒 `descargarSet` |
| `set_descargado_en` | `timestamptz` | última descarga | 🔒 `descargarSet` |
| `envio_set_id` | `uuid` | el **último envío del set que recibió Track ID**. FK compuesta `(empresa_id, envio_set_id)` → `envios`, `on delete set null (envio_set_id)`. Un set nuevo lo borra | 🔒 `enviarSet`; `guardar_set_pruebas` lo deja nulo |
| `revision_solicitada_en` | `timestamptz` | | 🔒 `solicitarRevision`; un set nuevo lo borra |
| `link_consulta` | `text` | 1–100 | formulario del paso 5 |
| `rut_proveedor` | `rut` | | formulario del paso 5 |
| `nombre_proveedor` | `text` | 1–30 | formulario del paso 5 |
| `correo_proveedor` | `correo_sii` | | formulario del paso 5 |
| `declarada_en` | `timestamptz` | | 🔒 `declarar` |
| `codigo_estado_sii` | `text` | código de `EstadoDeclaracion` (`P90`, `P91`…) o nulo si el SII no muestra trámite | 🔒 `descargarSet`, `consultarEstadoDeclaracion`, `declarar` |
| `glosa_estado_sii` | `text` | nula si el SII la entrega vacía | 🔒 ídem |
| `paso_sii` | `integer` | | 🔒 ídem |
| `estado_consultado_en` | `timestamptz` | última lectura del estado | 🔒 ídem |
| `creado_en`, `actualizado_en` | `timestamptz` | `actualizado_en` lo mantiene `trg_90_actualizado_en` | trigger |

### Triggers

| Trigger | Qué hace |
|---|---|
| `trg_00_organizacion` | copia `organizacion_id` de la empresa en `insert` y `update` |
| `trg_05_proteger_proceso` (`tg_proteger_proceso`) | si quien escribe no es `service_role` ni `postgres`: en el `insert` fuerza `etapa = 'borrador'` y el estado SII en nulo; en un `update` que cambie `etapa`, `codigo_estado_sii` o `paso_sii`, lanza «La etapa y el estado SII solo los cambia el sistema». No protege `glosa_estado_sii` ni las fechas |
| `trg_10_certificacion_autorizada` (`tg_certificacion_autorizada`, `before insert or update of codigo_estado_sii, etapa`) | `P91` → `etapa = 'autorizada'`; `P90` con etapa anterior a `por_declarar` → `por_declarar`. Al llegar a `autorizada`, marca `empresas.autorizada_produccion = true` y `autorizada_en`. En un `update` que cambia la etapa, encola el webhook `certificacion.actualizada` con `empresa_id`, `etapa` y `codigo_estado_sii` |
| `trg_90_actualizado_en` | `actualizado_en = now()` |

Por eso `actualizarProceso()` (`comun.ts`) devuelve la etapa **después** del `update`
(`.select('etapa')`): el trigger puede haberla movido, y el correo de aviso se manda con
esa etapa.

### Acceso

- **Leer:** cualquier miembro (política `lectura`). La página lo lee con el cliente de
  sesión (`leerAsistente`). Publicada en Realtime desde la `0001`.
- **Datos de los formularios:** `guardarDatosPostulacion` y `guardarDatosDeclaracion`
  escriben con el **cliente de sesión** (RLS: `alta` y `edicion` solo para
  administradores, `es_admin`). No tocan la etapa ni el estado SII. Si RLS deja el
  `update` en 0 filas o el `insert` da `42501`, devuelven «No pudimos guardar los datos»
  (rol o empresa).
- **Etapa, estado SII, fechas del SII:** el backend con `service_role`, siempre con
  `.eq('organizacion_id', …)` (`actualizarProceso`), o la RPC `guardar_set_pruebas`.

### Etapas

`etapa_certificacion` avanza en este orden (el orden del enum, que usan las comparaciones
`>=`). Los cinco pasos visibles de la UI agrupan las ocho etapas (`PASOS` de
`@/lib/certificacion`):

| Etapa | Etiqueta (UI y correo) | Paso visible | Se llega con |
|---|---|---|---|
| `borrador` | Sin postular | 1. Postulación | crear el proceso (forzado por `tg_proteger_proceso`) |
| `postulada` | Postulada | 2. Set de pruebas | `postular` OK, si estaba en `borrador` |
| `set_descargado` | Set de pruebas descargado | 3. Folios y envío del set | `guardar_set_pruebas` (descarga legible) |
| `set_enviado` | Set enviado al SII | 3 | `enviarSet` con Track ID guardado |
| `set_aceptado` | Set aceptado | 4. Revisión | `consultarEstadoSet` con `EPR` limpio, desde `set_enviado` |
| `revision_solicitada` | Revisión solicitada | 4 | `solicitarRevision` OK |
| `por_declarar` | Lista para declarar (P90) | 5. Declaración de cumplimiento | el trigger, al guardar `codigo_estado_sii = 'P90'` |
| `autorizada` | Autorizada en producción (P91) | 5 (completo) | el trigger, al guardar `P91` |

- No hay retrocesos explícitos salvo uno: un set nuevo (`guardar_set_pruebas`) vuelve a
  `set_descargado` desde cualquier etapa anterior a `por_declarar`. Postular de nuevo no
  cambia la etapa si ya no es `borrador`.
- Un set **ilegible** no cambia la etapa (ver
  [set de pruebas](../05-pruebas/set-de-pruebas.md#set-ilegible)).
- La UI trata a la empresa como `autorizada` si `empresas.autorizada_produccion` es
  `true`, aunque el proceso diga otra cosa.

## `set_pruebas_casos`

Un caso `CASO-N` del set descargado, con su boleta una vez enviada.

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK |
| `organizacion_id` ✔ | `uuid` | cascada; la fija `trg_00_organizacion` desde el proceso |
| `proceso_id` ✔ | `uuid` | FK `procesos_certificacion`, cascada |
| `numero_caso` ✔ | `integer` | ≥ 1; el `N` de `CASO-N`. `unique (proceso_id, numero_caso)` |
| `tipo_dte` ✔ | `smallint` | FK `tipos_dte`; 39 en la Fase 5 |
| `detalles` ✔ | `jsonb` | arreglo (`check jsonb_typeof = 'array'`) de `{ nombre, cantidad, precio, exento?, unidad? }` (`DetalleSetPruebas`); `precio` es unitario con IVA. `exento` solo aparece si es `true`; `unidad` solo si no está vacía |
| `referencia_codigo` | `text` | default `SET` (`CodRef` del DTE) |
| `referencia_razon` ✔ | `text` | `CASO-N` (`RazonRef`) |
| `documento_id` | `uuid` | FK `documentos`, `on delete set null`: la boleta del último envío del set |
| `creado_en` | `timestamptz` | |

**Cómo los escribe el backend** (no hay políticas de escritura para `authenticated`: solo
`service_role`):

| Momento | Escritura |
|---|---|
| Descarga legible | `guardar_set_pruebas` borra todos los casos del proceso e inserta los nuevos, en la misma transacción que deja el proceso en `set_descargado` ([RPC](../03-api-reference/rpc-backend.md#guardar_set_pruebas-migración-0008), migración 0008, aplicada el 2026-11-13) |
| Descarga ilegible | `delete` de todos los casos del proceso (`service_role`, filtrado por organización); no inserta ninguno |
| Envío del set | `update documento_id` de cada caso con la boleta que se armó para él (antes de subir el sobre). Un reenvío los apunta a las boletas nuevas |

La UI los lee con `leerAsistente` (orden `numero_caso`) y descarta en silencio un detalle
que no tenga `nombre`, `cantidad` y `precio` con el tipo correcto; `enviarSet`, en cambio,
lo rechaza con «… tiene un detalle ilegible. Vuelve a descargar el set.» (`config`).
