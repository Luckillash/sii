---
title: "Objetos: documentos y catálogo comercial"
description: "Columnas de documentos, documento_detalles, receptores, productos y la vista v_ventas_diarias; qué escribe cada fase (set de pruebas, emisión del panel) y la forma de documentos.metadata."
keywords: [documentos, documento_detalles, receptores, productos, v_ventas_diarias, estado_documento, borrador, firmado, enviado, incierto, anulado, folio, caf_id, ted_xml, xml_path, metadata, receptor_correo, metadata.pdf, metadata.correo, descuento_aplicado, mnt_neto, iva, mnt_exe, mnt_total, receptor_rut, 66666666-6, Cliente General, clave_idempotencia, origen, caso_set, precio_bruto, monto_item, descuento_monto, tg_validar_documento, tg_contar_uso_documento, trg_50_evento_documento, emisión, Fase 7]
related: ["02-guias/emision-boletas.md", "04-objetos/objetos-envios-y-rcof.md", "04-objetos/objetos-folios.md", "03-api-reference/acceso-por-tabla.md", "08-esquema-supabase/triggers-y-logica.md", "05-pruebas/set-de-pruebas.md"]
source: ["supabase_saas_sii.sql §8 §10 §16", "supabase/migrations/0001_esquema_inicial.sql", "supabase/migrations/0012_folio_anulado.sql", "apps/web/src/server/emision/", "apps/web/src/server/certificacion/envio-set.ts"]
---

# Objetos: documentos y catálogo comercial

> **Úsalo cuando:** necesitas los campos de una boleta o de su catálogo.

Todas las tablas llevan `organizacion_id` (heredado por `trg_00_organizacion`), RLS de
lectura para los miembros y `actualizado_en` mantenido por trigger donde existe. Quién
escribe qué: [acceso por tabla](../03-api-reference/acceso-por-tabla.md). Flujo de
escritura de la emisión: [emisión de boletas](../02-guias/emision-boletas.md).

## `documentos`

Una boleta (39 o 41), desde borrador hasta su estado final en el SII. Publicada en
Realtime (0001 §19).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | |
| `organizacion_id`, `empresa_id` ✔ | `uuid` | |
| `ambiente` ✔ | `ambiente_sii` | |
| `tipo_dte` | `smallint` | 39 por defecto; FK `tipos_dte` |
| `folio` | `integer` ≥ 1 | `null` mientras es borrador (`check`: solo `borrador` puede no tener folio). Único por `(empresa_id, ambiente, tipo_dte, folio)` |
| `caf_id` | `uuid` | FK compuesta `(empresa_id, caf_id) → cafs` |
| `fecha_emision` | `date` | por defecto el día en Chile; la emisión la reemplaza por el `<FchEmis>` del DTE |
| `ind_servicio` | `smallint` | 3 (boleta de ventas y servicios) |
| `receptor_id` | `uuid` | FK `receptores`, `on delete set null` |
| `receptor_rut` | `rut` | `66666666-6` por defecto |
| `receptor_razon_social` | `text` | `Cliente General` por defecto |
| `mnt_neto`, `mnt_exe`, `iva` | `bigint` ≥ 0 | |
| `mnt_total` | `bigint` < 1e15 | `check (mnt_total = mnt_neto + iva + mnt_exe)` |
| `tasa_iva` | `numeric(5,2)` | 19,00 |
| `descuento_tipo`, `descuento_valor` | `tipo_descuento`, `numeric(18,6)` | los dos o ninguno |
| `descuento_glosa` | `text` | |
| `descuento_aplicado` | `bigint` ≥ 0 | lo que de verdad se descontó (acotado a lo afecto) |
| `referencia_codigo`, `referencia_razon` | `text` | solo el set de pruebas (`SET`, `CASO-N`) |
| `ted_xml` | `text` | el `<TED>` para el PDF417. La emisión lo guarda como texto `latin1` (un carácter por byte ISO-8859-1): se usa tal cual al regenerar el PDF |
| `timbrado_en`, `firmado_en` | `timestamptz` | |
| `xml_path` | `text` | ruta del DTE firmado en el bucket `documentos-xml` (`<org>/<empresa>/<ambiente>/DTE-<tipo>-F<folio>.xml`) |
| `estado` | `estado_documento` | ver abajo |
| `envio_id` | `uuid` | FK compuesta `(empresa_id, envio_id) → envios`, `on delete set null` |
| `origen` | `origen_documento` | `panel` (emisión de la Fase 7), `api`, `cli`, `set_pruebas` |
| `caso_set` | `integer` | N de `CASO-N` (obligatorio con `origen = 'set_pruebas'`, solo en certificación) |
| `clave_idempotencia` | `text` | único por organización; para la API pública (Fase 11). El panel no la usa |
| `metadata` | `jsonb` | `{}` por defecto; forma abajo |
| `creado_por` | `uuid` | FK `auth.users` |

### Estados (`estado_documento`)

| Estado | Quién lo pone en la emisión del panel |
|---|---|
| `borrador` | `guardarEnSesion` con la sesión (RLS); sin folio |
| `firmado` | el `update` único con folio, TED y rutas (service_role) |
| `enviado` | la app al guardar el Track ID, o `sincronizar_documentos_envio` si el envío trae un estado en proceso |
| `incierto` | el trigger del envío al marcar `envios.incierto` |
| `aceptado`, `aceptado_con_reparos`, `rechazado` | la sincronización con el envío (consulta de estado: set de pruebas en la Fase 5; seguimiento en la Fase 8) |
| `anulado` | la app cuando el SII rechazó la subida sin recibirla (4xx), con su folio en `folios_anulados`. Un `anulado` no lo pisa la sincronización |

Triggers: `trg_10_validar_documento` (CAF del tipo y ambiente, folio en rango, folio no
anulado con la 0012 (`23514`), y en todo `insert` de producción empresa autorizada y plan
con producción, `P0001`), `trg_20_contar_uso` (`uso_mensual` al recibir folio; en
producción, `P0001` al pasar `max_boletas_mes`) y `trg_50_evento_documento` (webhook
`documento.<estado>` para `aceptado`, `aceptado_con_reparos`, `rechazado` e `incierto`)
([triggers](../08-esquema-supabase/triggers-y-logica.md)).

### `metadata` (Fase 7)

`documentos` no tiene columna para el correo del receptor ni para el PDF; la emisión los
guarda aquí (`MetadataDocumento` de `server/emision/borradores.ts`, todo opcional):

```json
{
  "receptor_correo": "pagos@cliente.cl",
  "pdf": {
    "carta": "<org>/<empresa>/<ambiente>/DTE-39-F41-carta.pdf",
    "rollo": "<org>/<empresa>/<ambiente>/DTE-39-F41-rollo.pdf"
  },
  "correo": { "id": "<id de Resend>", "enviado_en": "<ISO 8601>" }
}
```

- `receptor_correo`: lo escribe el borrador (sesión); `null` si no hay correo.
- `pdf`: las rutas de los PDF generados al emitir o regenerados en una descarga
  (service_role). Si falta una, `enlaceDocumento` la regenera.
- `correo`: el envío del PDF al receptor, solo si salió.

Como `documentos` está en Realtime y la leen todos los miembros, `metadata` nunca lleva
secretos.

## `documento_detalles`

Líneas de la boleta (`<Detalle>`), únicas por `(documento_id, nro_linea)`.

| Columna | Tipo | Notas |
|---|---|---|
| `documento_id` ✔ | `uuid` | `on delete cascade` |
| `nro_linea` ✔ | `smallint` 1–1000 | `<NroLinDet>`; el panel admite hasta 100 líneas |
| `producto_id` | `uuid` | FK `productos`, `on delete set null`; la emisión solo lo pone si el producto es de la empresa |
| `nombre` ✔ | `text` 1–80 | `<NmbItem>` |
| `cantidad` ✔ | `numeric(18,6)` > 0 | `<QtyItem>`; el panel usa hasta 3 decimales |
| `unidad` | `text` 1–4 | `<UnmdItem>` |
| `precio` ✔ | `numeric(18,6)` ≥ 0 | `<PrcItem>` **bruto** (IVA incluido) |
| `exento` | `boolean` | `<IndExe>1` |
| `descuento_monto` | `bigint` ≥ 0 | `<DescuentoMonto>` (parte del descuento global); `check`: una línea exenta no lleva descuento |
| `monto_item` ✔ | `bigint` ≥ 0 | `<MontoItem>` = bruto − descuento |

La emisión del panel reemplaza todas las líneas del borrador cada vez que lo guarda (borra
e inserta, con la sesión).

## `receptores`

Catálogo de receptores por empresa, único por `(empresa_id, rut)`.

| Columna | Tipo | Notas |
|---|---|---|
| `rut` ✔ | `rut` | `<RUTRecep>` |
| `razon_social` ✔ | `text` 1–100 | `<RznSocRecep>` |
| `correo` | `text` | se le envía el PDF al emitir |

La emisión (Fase 7) agrega o actualiza el receptor (no el genérico) al guardar el borrador,
con la sesión del emisor; el correo solo se escribe si viene. `/emitir` lo busca por RUT
(con o sin puntos) o razón social, hasta 8.

## `productos`

Catálogo de productos por empresa, único por `(empresa_id, codigo)`.

| Columna | Tipo | Notas |
|---|---|---|
| `codigo` | `text` | |
| `nombre` ✔ | `text` 1–80 | `<NmbItem>` |
| `precio_bruto` ✔ | `numeric(18,6)` ≥ 0 | IVA incluido; el autocompletado lo redondea a pesos enteros |
| `exento` | `boolean` | |
| `unidad` | `text` 1–4 | `<UnmdItem>` |
| `activo` | `boolean` | el autocompletado solo muestra los activos |

La Fase 7 solo lee productos (autocompletado por código o nombre, hasta 8); no hay pantalla
para editarlos todavía.

## `v_ventas_diarias`

`security_invoker`: aplica el RLS de quien consulta. Ventas por organización, empresa,
ambiente, fecha de emisión y tipo, **solo de documentos `aceptado` o
`aceptado_con_reparos`**: `documentos` (cantidad), `mnt_neto`, `iva`, `mnt_exe`,
`mnt_total`, `folio_min`, `folio_max`. Base del Tablero (Fase 9).
