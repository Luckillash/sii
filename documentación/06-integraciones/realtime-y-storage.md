---
title: "Realtime y Storage"
description: "Tablas publicadas en Realtime (incluida la migración 0006), bucket documentos-xml, rutas, AlmacenDocumentos, content-type y URLs firmadas."
keywords: [Realtime, supabase_realtime, postgres_changes, replica identity, migración 0006, operaciones_sii, solicitudes_folios, documentos, envios, procesos_certificacion, RLS, Storage, documentos-xml, bucket, AlmacenDocumentos, rutaDocumento, subirXml, subirPdf, urlFirmada, createSignedUrl, MAXIMO_SEGUNDOS_URL, MAXIMO_BYTES, ErrorAlmacen, content-type, application/xml, text/xml, application/pdf, charset, ISO-8859-1, xml_path, uuid_o_nulo, storage.foldername]
related: ["08-esquema-supabase/rls-y-privilegios.md", "04-objetos/objetos-auditoria-e-integraciones.md", "09-libreria/backend-service-role.md", "03-api-reference/acceso-por-tabla.md", "07-referencia/trampas-conocidas.md"]
source: ["supabase_saas_sii.sql §18 §19", "supabase/migrations/0006_realtime_operaciones.sql", "supabase/verificaciones/0006_realtime_operaciones.sql", "apps/web/src/server/sii/almacen.ts"]
---

# Realtime y Storage

> **Úsalo cuando:** el panel necesita actualizaciones en vivo o descargar XML.

## Realtime

### Tablas publicadas

| Tabla | Publicada por | Para qué |
|---|---|---|
| `documentos` | `0001` §19 | estado de cada boleta en el panel |
| `envios` | `0001` §19 | estado de los envíos (seguimiento) |
| `procesos_certificacion` | `0001` §19 | etapa del asistente de certificación |
| `operaciones_sii` | **`0006_realtime_operaciones`** (aplicada el 2026-11-13) | avance y resultado de las operaciones largas (solicitud de folios, postulación, declaración) |
| `solicitudes_folios` | **`0006_realtime_operaciones`** (aplicada el 2026-11-13) | estado de cada solicitud de folios |

La 0006 resuelve el hallazgo H9 del plan: sin ella, la UI de las Fases 5 y 6 tendría que
consultar a cada rato en vez de escuchar los cambios. Es **idempotente** (agrega cada tabla
solo si la publicación existe y la tabla no está) y **aditiva** (no cambia tablas,
políticas ni privilegios). Se probó en PGlite y se **aplicó en
producción el 2026-11-13**. En una base que no la tenga, una suscripción a `operaciones_sii`
o `solicitudes_folios` no recibe nada (no da error).

### Quién recibe qué

Realtime respeta RLS: a cada suscriptor de `postgres_changes` le entrega solo las filas que
su política `select` le deja ver, evaluadas con su rol.

- Las cinco tablas tienen RLS activo y la política `lectura`
  (`for select to authenticated using (es_miembro(organizacion_id))`), y `authenticated`
  tiene `select`: **un miembro recibe los cambios de su organización y nada de las demás**,
  sea cual sea su rol (también un lector).
- `anon` no tiene `select` ni políticas: no recibe nada.
- No se publica nada que el miembro no pudiera leer con un `select`. Por eso
  `operaciones_sii.mensaje` y `detalle` nunca llevan tokens, claves ni cookies
  ([qué guarda la capa](../04-objetos/objetos-auditoria-e-integraciones.md#qué-guarda-la-capa-en-detalle)).

### `replica identity` por defecto

Las dos tablas de la 0006 quedan con la *replica identity* de siempre (la llave primaria,
`id`):

- `INSERT` y `UPDATE` llegan con la **fila nueva completa**, que es lo que la UI necesita.
  El filtro de la suscripción (`organizacion_id=eq.<id>`) se evalúa sobre esa fila.
- Se pierde la fila **anterior** completa en `UPDATE` y `DELETE` (`old` trae solo `id`).
  La UI no la usa.
- En `DELETE`, Realtime no puede aplicar RLS y entrega solo la llave primaria, con o sin
  `full`. Aquí los `DELETE` solo ocurren en cascada (al borrar la organización o la
  empresa).
- `replica identity full` agrandaría el WAL de cada `UPDATE` sin ganar nada.

### Suscribirse desde el panel

Con el cliente del navegador (`clienteNavegador()` de `src/lib/supabase/navegador.ts`, que
lleva la sesión del usuario):

```ts
const canal = clienteNavegador()
  .channel(`operaciones:${organizacionId}`)
  .on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'operaciones_sii', filter: `organizacion_id=eq.${organizacionId}` },
    (cambio) => {
      // cambio.new: la fila completa (resultado, mensaje, detalle, terminada_en…)
    },
  )
  .subscribe();
// al desmontar: clienteNavegador().removeChannel(canal)
```

El filtro reduce el tráfico; la seguridad la pone RLS (sin filtro, igual llegan solo las
filas de las organizaciones del usuario). Una fila `en_curso` que pasa a otro `resultado`
llega como `UPDATE`: es la señal para mostrar el resultado sin recargar.

### Verificación

`supabase/verificaciones/0006_realtime_operaciones.sql` (solo lectura, 9 comprobaciones):
la publicación existe y publica `insert`, `update` y `delete`; las dos tablas están en ella;
`documentos`, `envios` y `procesos_certificacion` siguen publicadas; RLS activo; política
`lectura`; `select` para `authenticated`; nada para `anon`; *replica identity* por defecto;
migración registrada como `0006`. Antes de aplicar la migración da 7/9 (fallan la 2 y la 9).

## Storage: `documentos-xml`

### El bucket

Creado por la §18 de `0001`:

| Propiedad | Valor |
|---|---|
| `id` / `name` | `documentos-xml` (`BUCKET_DOCUMENTOS`) |
| `public` | `false` (privado) |
| `file_size_limit` | 10.485.760 bytes, 10 MiB (`MAXIMO_BYTES`) |
| `allowed_mime_types` | `application/xml`, `text/xml`, `application/pdf` |
| Política | `documentos-xml: lectura de miembros`: `select` para `authenticated` si `es_miembro(uuid_o_nulo((storage.foldername(name))[1]))` |

Solo el backend sube (con `service_role`); no hay políticas de `insert`, `update` ni
`delete` para `authenticated`. Qué va: XML firmados (DTE, `EnvioBOLETA`, RCOF) y
representaciones impresas en PDF.

### Rutas

```
<organizacion_id>/<empresa_id>/<ambiente>/<archivo>
0b8f2c1e-5a4d-4c3b-9e2f-1a2b3c4d5e6f/3c1d…/certificacion/EnvioBOLETA-123.xml
```

- La política toma el **primer segmento** como la organización. Por eso la ruta se arma en
  un solo lugar, `rutaDocumento()` de `server/sii/almacen.ts`, que valida cada segmento:
  - organización y empresa: uuid (se normalizan a minúsculas);
  - ambiente: `certificacion` o `produccion`;
  - archivo: `^[A-Za-z0-9][A-Za-z0-9._-]{0,150}$`, sin `..`, con extensión `.xml` o `.pdf`
    según el tipo (letras sin tilde, dígitos, punto, guion y guion bajo).
- Lo que se guarda en `documentos.xml_path` y `envios.xml_path` es la ruta **dentro del
  bucket** (sin el prefijo `documentos-xml/`), tal como la devuelven `subirXml` y
  `subirPdf`.

### `AlmacenDocumentos`

```ts
new AlmacenDocumentos(cliente: ClienteServicio, organizacionId: string)
  subirXml(destino: { empresaId: string; ambiente: Ambiente; archivo: string },
           xml: Uint8Array, opciones?: { sobrescribir?: boolean }): Promise<string>
  subirPdf(destino, pdf: Uint8Array, opciones?: { sobrescribir?: boolean }): Promise<string>
  urlFirmada(ruta: string, segundos = 60): Promise<string>

rutaDocumento(organizacionId: string, destino: DestinoArchivo, tipo?: 'xml' | 'pdf'): string
```

- **Un almacén por organización.** El constructor exige un uuid y el almacén no sube ni
  firma nada fuera de esa carpeta (`service_role` salta RLS; principio 2).
- **XML en ISO-8859-1, bytes tal cual.** `subirXml` exige un `Uint8Array`/`Buffer` (un
  `string` ya se decodificó y se recodificaría como UTF-8, rompiendo la firma) y que empiece
  con `<` (tras espacios). Sube exactamente esos bytes, también si son una vista de un
  buffer mayor.
- **PDF:** tiene que empezar con `%PDF-`.
- **Tamaño:** vacío o más de 10 MiB se rechaza antes de subir.
- **No se pisa un archivo:** `upsert: false` por defecto; un XML firmado no se reemplaza.
  Si ya existe, Storage responde 409 y el almacén lanza `ErrorAlmacen('existe')`.
  `{ sobrescribir: true }` lo permite.
- **`content-type` exacto:** `application/xml` para XML y `application/pdf` para PDF, **sin
  `; charset=`**. Storage compara el tipo con `allowed_mime_types` y el XML ya declara su
  codificación en `<?xml … encoding="ISO-8859-1"?>`. Ver la
  [trampa](../07-referencia/trampas-conocidas.md#capa-de-servicio-sii-fase-4) sobre esto.

### URLs firmadas

`urlFirmada(ruta, segundos)` llama a `createSignedUrl` del bucket:

- Duración **1 a 3600 s** (`MAXIMO_SEGUNDOS_URL`), entero; por defecto **60 s**. Son
  descargas puntuales: pídela al momento de descargar, no la guardes.
- Valida la ruta completa (4 segmentos, cada uno con las reglas de arriba) y que el primer
  segmento sea **la organización del almacén**; si no, `ErrorAlmacen('ruta')` («El archivo
  no es de esta organización.»).
- Firmada con `service_role`, la URL abre el archivo a quien la tenga. **Quien la pide ya
  comprobó que el usuario es miembro** de la organización.

### Errores (`ErrorAlmacen`)

| `motivo` | Cuándo | Mensaje (ejemplo) |
|---|---|---|
| `ruta` | uuid, ambiente, nombre o extensión inválidos; ruta de otra organización; duración fuera de rango | «El nombre del archivo no es válido: usa letras sin tilde, dígitos, punto, guion o guion bajo.» |
| `contenido` | `string` en vez de bytes, no parece XML o PDF, vacío o más de 10 MiB | «El XML debe entregarse como bytes (Buffer).» |
| `existe` | 409 de Storage | «Ya hay un archivo con ese nombre en Storage.» |
| `storage` | cualquier otra falla de Storage | «No se pudo subir el archivo en Storage (HTTP 413).» |

Los mensajes **no incluyen la ruta, el contenido ni el detalle de Storage**. Dentro de
`ejecutarOperacion`, `ErrorAlmacen` termina en `error` (código 1) con mensaje genérico.

### Lectura directa desde el panel

Un miembro también puede leer con su sesión (`clienteNavegador().storage.from('documentos-xml')`)
gracias a la política del bucket, sin pasar por `AlmacenDocumentos`. La política no
distingue roles: cualquier miembro (también un lector) lee todos los archivos de su
organización.
