---
title: "Objetos: auditoría e integraciones"
description: "Columnas de operaciones_sii (y qué guarda la capa SII en mensaje y detalle), api_keys, webhooks y webhook_entregas."
keywords: [operaciones_sii, auditoría, resultado, resultado_operacion, en_curso, confirmada, ensayo, mensaje, detalle, revisada_en, revisada_por, abandonada, detalleSeguro, sanearDetalle, agregarDetalle, operacion_sii, canal_sii, api_key_id, envio_id, solicitud_id, documento_id, iniciada_en, terminada_en, Realtime, api_keys, webhooks, webhook_entregas]
related: ["01-fundamentos/errores-y-resultados.md", "09-libreria/backend-service-role.md", "06-integraciones/realtime-y-storage.md", "06-integraciones/overview.md", "03-api-reference/acceso-por-tabla.md"]
source: ["supabase_saas_sii.sql §13 §14 §17", "supabase/migrations/0006_realtime_operaciones.sql", "apps/web/src/server/sii/operacion.ts", "apps/web/src/server/sii/errores.ts"]
---

# Objetos: auditoría e integraciones

> **Úsalo cuando:** necesitas los campos de auditoría, API keys o webhooks.

Leyenda: ✔ obligatoria (`not null` sin default útil) · 🔒 solo `service_role`.

## `operaciones_sii`

Una fila por operación que sale (o habría salido, en un ensayo) al SII (§13 de `0001`).
**La escribe solo la capa SII** con `service_role`, desde `ejecutarOperacion()` y
`marcarInciertaRevisada()` (`server/sii/operacion.ts`). Los miembros la leen (política
`lectura`, `es_miembro(organizacion_id)`; `authenticated` no tiene políticas de escritura)
y, con la migración 0006, la reciben por Realtime
([Realtime](../06-integraciones/realtime-y-storage.md#realtime)).

| Columna | Tipo | Notas |
|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()`. Es el `operacionId` que devuelve `ejecutarOperacion` |
| `organizacion_id` ✔ | `uuid` | FK `organizaciones`, `on delete cascade`. Toda consulta de la capa filtra por ella |
| `empresa_id` | `uuid` | FK `empresas`, `on delete set null`. Nulo si la operación no es de una empresa; las de efecto global siempre la llevan (sin ella, `ejecutarOperacion` devuelve `motivo: 'uso'` sin insertar) |
| `usuario_id` | `uuid` | FK `auth.users`, `on delete set null`. Nulo en cron y API pública |
| `api_key_id` | `uuid` | FK `api_keys` (`operaciones_api_key_fk`), `on delete set null`. La API pública (Fase 11) |
| `operacion` ✔ | `operacion_sii` | qué se hizo (tabla abajo) |
| `ambiente` ✔ | `ambiente_sii` | `certificacion` o `produccion` |
| `canal` | `canal_sii` | `rest` o `soap`, si aplica |
| `confirmada` | `boolean` | default `false` = **ensayo** (sin `--confirmar`). `true` = se ejecutó de verdad |
| `resultado` | `resultado_operacion` | default `en_curso`; al cerrar, el equivalente al código de la CLI 0–7 ([tabla](../01-fundamentos/errores-y-resultados.md#resultado_operacion-y-los-códigos-de-la-cli)) |
| `mensaje` | `text` | lo que vio el usuario, en una línea (`titulo. detalle`, `mensajeEnTexto()`). Nulo si `ok`. Nunca tokens, claves ni cookies |
| `detalle` | `jsonb` | default `'{}'`. Datos técnicos **saneados** (abajo) |
| `envio_id` | `uuid` | FK `envios`, `on delete set null` |
| `solicitud_id` | `uuid` | FK `solicitudes_folios`, `on delete set null` |
| `documento_id` | `uuid` | FK `documentos`, `on delete set null` |
| `iniciada_en` | `timestamptz` | default `now()`; la capa **no** la envía: la pone la base, así el orden de las filas no depende del reloj de cada función |
| `terminada_en` | `timestamptz` | `check (resultado = 'en_curso' or terminada_en is not null)` |

Índices: `(organizacion_id, iniciada_en desc)` (listado del panel),
`(empresa_id, operacion, iniciada_en desc)` y, con la migración 0007, el índice **único
parcial** `operaciones_sii_efecto_global_en_curso` sobre `(empresa_id, operacion, ambiente)`
`where resultado = 'en_curso' and confirmada and operacion in ('solicitar_folios', 'postular', 'declarar')`:
una sola operación de efecto global confirmada en curso por empresa y ambiente. La lista es
`OPERACIONES_EFECTO_GLOBAL` de `operacion.ts` (van juntas); un insert que choca da 23505 y
la capa no ejecuta. Los NULL de `empresa_id` no chocan; los ensayos, las demás operaciones y
las filas cerradas no entran al índice. La consulta del bloqueo por incierto filtra por
organización, empresa, operación, ambiente, `confirmada = true` y
`resultado not in ('uso', 'config')`, y toma la más reciente
([regla del incierto](../01-fundamentos/errores-y-resultados.md#la-regla-del-incierto)).

### `operacion` (enum `operacion_sii`)

| Valor | ⚠️ graba en el SII (`OPERACIONES_QUE_GRABAN`) | Bloqueo por incierto (`OPERACIONES_EFECTO_GLOBAL`) |
|---|---|---|
| `autenticar` (login AUT2000), `obtener_token` (semilla + token) | 🔁 no | no |
| `postular` | ⚠️ sí | **sí** |
| `descargar_set` | ⚠️ sí | no |
| `solicitar_folios` | ⚠️ sí | **sí** |
| `enviar_set` | ⚠️ sí | no |
| `estado_envio`, `verificar_portal`, `estado_declaracion` | 🔁 no | no |
| `solicitar_revision` | ⚠️ sí | no |
| `declarar` | ⚠️ sí | **sí** |
| `enviar_rcof` 🕰️ | ⚠️ sí | no |
| `emitir` | ⚠️ sí | no aquí: por documento (`envios.incierto`, Fase 7) |
| `consultar_envio`, `seguimiento` | 🔁 no | no |

### Qué guarda la capa en `detalle`

Siempre un objeto JSON pasado por `sanearDetalle()`
([reglas](../08-esquema-supabase/vault-y-secretos.md#capa-sii-serversiierrorests)):

| Clave | Cuándo | Contenido |
|---|---|---|
| lo que pase `fn` | `agregarDetalle(datos)` durante la operación | datos acotados (tipo de documento, cantidad, folios, Track ID…), saneados y combinados |
| `error` | al cerrar con un resultado que no es `ok` | `detalleSeguro(error)`: `nombre`, y según el error `status` y `host` (transporte), `estado` y `glosa` (respuesta del SII), `folio_desde`/`folio_hasta`/`ambiente` (folios sin CAF), `folio_sugerido`/`ambiente` (folio inicial), `rut_empresa` (declaración incierta). Nunca `cause`, stack ni el `message` de un error desconocido |
| `revisada_en`, `revisada_por` | `marcarInciertaRevisada()` | ISO y id del usuario. Con `revisada_en` presente, la fila ya no bloquea reintentos |
| `abandonada` | `marcarInciertaRevisada()` sobre una `en_curso` de más de 15 min | `true`; además la fila pasa a `resultado = 'incierto'` con `terminada_en` |

Ejemplo de una solicitud de folios incierta, ya revisada:

```json
{
  "tipo_dte": 39,
  "cantidad": 5,
  "error": { "nombre": "FoliosSinCafError", "folio_desde": 101, "folio_hasta": 105, "ambiente": "certificacion" },
  "revisada_en": "2026-11-13T15:02:11.000Z",
  "revisada_por": "0b8f2c1e-5a4d-4c3b-9e2f-1a2b3c4d5e6f"
}
```

`detalle` y `mensaje` los ve cualquier miembro de la organización (también un lector) y
llegan por Realtime: no pongas ahí nada que un lector no deba ver.

### Ciclo de vida de una fila

```
insert (resultado = en_curso, terminada_en = null)
  └─ update al terminar: resultado, mensaje, detalle, terminada_en
     └─ (solo incierto) update de marcarInciertaRevisada: detalle.revisada_en / revisada_por
```

- Si la operación no llegó a ejecutarse (sesión inválida, incierto pendiente, otra en
  curso, falla al consultar), **no hay fila**.
- Si el cierre falla, la fila queda `en_curso`; pasados 15 min cuenta como abandonada.
- No hay `delete` desde la app; las filas se van en cascada con la organización.

<!-- TODO (Fase 11): api_keys, webhooks y webhook_entregas. -->
