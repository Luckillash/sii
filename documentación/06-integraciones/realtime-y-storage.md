---
title: "Realtime y Storage"
description: "Tablas publicadas en Realtime (incluida la migración 0006), bucket documentos-xml, rutas, AlmacenDocumentos, content-type y URLs firmadas."
keywords: [Realtime, supabase_realtime, postgres_changes, replica identity, migración 0006, operaciones_sii, solicitudes_folios, documentos, envios, procesos_certificacion, RLS, Storage, documentos-xml, bucket, AlmacenDocumentos, rutaDocumento, subirXml, subirPdf, urlFirmada, createSignedUrl, MAXIMO_SEGUNDOS_URL, MAXIMO_BYTES, ErrorAlmacen, content-type, application/xml, text/xml, application/pdf, charset, ISO-8859-1, xml_path, uuid_o_nulo, storage.foldername, EnVivo, router.refresh, asistente de certificación, DTE-39-F, EnvioBOLETA-set, folios, /folios, migración 0011, cafs, folios_anulados, emisión, EnvioBOLETA-39-F, DTE-39-F41-carta.pdf, rollo, metadata.pdf, receptor_correo, metadata.correo, enlaceDocumento, SEGUNDOS_URL, nombresArchivos, nombrePdfDeXml, Fase 8, useEnVivoStore, ProveedorEnVivo, filtrosRealtime, estadoVigente, envioVigente, actualizado_en, documentos/EnVivo.tsx, suscribirEnVivo, lib/supabase/realtime.ts, realtime.setAuth, phx_join, system, subscription_check_filters, carga completa]
related: ["08-esquema-supabase/rls-y-privilegios.md", "04-objetos/objetos-auditoria-e-integraciones.md", "09-libreria/backend-service-role.md", "03-api-reference/acceso-por-tabla.md", "07-referencia/trampas-conocidas.md"]
source: ["supabase_saas_sii.sql §18 §19", "supabase/migrations/0006_realtime_operaciones.sql", "supabase/verificaciones/0006_realtime_operaciones.sql", "supabase/migrations/0011_folios.sql", "apps/web/src/server/sii/almacen.ts", "apps/web/src/app/[org]/certificacion/EnVivo.tsx", "apps/web/src/server/certificacion/envio-set.ts", "apps/web/src/server/emision/representacion.ts", "apps/web/src/server/emision/enlaces.ts", "apps/web/src/app/[org]/documentos/EnVivo.tsx", "apps/web/src/stores/enVivo.ts", "apps/web/src/stores/ProveedorEnVivo.tsx", "apps/web/src/lib/supabase/realtime.ts"]
---

# Realtime y Storage

> **Úsalo cuando:** el panel necesita actualizaciones en vivo o descargar XML.

## Realtime

### Tablas publicadas

| Tabla | Publicada por | Para qué |
|---|---|---|
| `documentos` | `0001` §19 | estado de cada boleta en el panel (Documentos emitidos y el envío, Fase 8) |
| `envios` | `0001` §19 | estado de los envíos: lo escucha `/documentos` y `/envios/[id]` (Fase 8) mientras el seguimiento los consulta |
| `procesos_certificacion` | `0001` §19 | etapa del asistente de certificación |
| `operaciones_sii` | **`0006_realtime_operaciones`** (aplicada el 2026-11-13) | avance y resultado de las operaciones largas (solicitud de folios, postulación, declaración) |
| `solicitudes_folios` | **`0006_realtime_operaciones`** (aplicada el 2026-11-13) | estado de cada solicitud de folios |
| `cafs` | **`0011_folios`** (**aplicada el 2026-11-15**) | CAF cargados, `siguiente_folio` y `estado` (agotado, anulado). Solo datos públicos del CAF: el XML con `<RSASK>` está en Vault y la fila trae `caf_secret_id`, un uuid que sin `service_role` no abre nada |
| `folios_anulados` | **`0011_folios`** (**aplicada el 2026-11-15**) | anulaciones hechas por otro administrador o por el backend (set de pruebas) |

La 0006 resuelve el hallazgo H9 del plan: sin ella, la UI de las Fases 5 y 6 tendría que
consultar a cada rato en vez de escuchar los cambios. Es **idempotente** (agrega cada tabla
solo si la publicación existe y la tabla no está) y **aditiva** (no cambia tablas,
políticas ni privilegios). Se probó en PGlite y se **aplicó en
producción el 2026-11-13**. En una base que no la tenga, una suscripción a `operaciones_sii`
o `solicitudes_folios` no recibe nada (no da error).

### Quién recibe qué

Realtime respeta RLS: a cada suscriptor de `postgres_changes` le entrega solo las filas que
su política `select` le deja ver, evaluadas con su rol.

- Las cinco tablas (siete con la 0011) tienen RLS activo y la política `lectura`
  (`for select to authenticated using (es_miembro(organizacion_id))`), y `authenticated`
  tiene `select`: **un miembro recibe los cambios de su organización y nada de las demás**,
  sea cual sea su rol (también un lector).
- `anon` no tiene `select` ni políticas: no recibe nada.
- No se publica nada que el miembro no pudiera leer con un `select`. Por eso
  `operaciones_sii.mensaje` y `detalle` nunca llevan tokens, claves ni cookies
  ([qué guarda la capa](../04-objetos/objetos-auditoria-e-integraciones.md#qué-guarda-la-capa-en-detalle)).

### `replica identity` por defecto

Las dos tablas de la 0006 (y las dos de la 0011) quedan con la *replica identity* de
siempre (la llave primaria, `id`):

- `INSERT` y `UPDATE` llegan con la **fila nueva completa**, que es lo que la UI necesita.
  El filtro de la suscripción (`organizacion_id=eq.<id>`) se evalúa sobre esa fila.
- Se pierde la fila **anterior** completa en `UPDATE` y `DELETE` (`old` trae solo `id`).
  La UI no la usa.
- En `DELETE`, Realtime no puede aplicar RLS y entrega solo la llave primaria, con o sin
  `full`. Aquí los `DELETE` solo ocurren en cascada (al borrar la organización o la
  empresa).
- `replica identity full` agrandaría el WAL de cada `UPDATE` sin ganar nada.

### Suscribirse desde el panel

**Regla: suscribir siempre con `suscribirEnVivo`** (`apps/web/src/lib/supabase/realtime.ts`),
nunca con `.channel(…).on(…).subscribe()` directo en un `useEffect`. La función:

- **espera la sesión antes del `phx_join`**: llama a `supabase.realtime.setAuth()` (sin
  argumento usa el callback de supabase-js, que espera `auth.getSession()`) y recién
  entonces crea el canal, para que la unión salga con el JWT del usuario;
- **trata un mensaje `system` con `status: 'error'` como desconexión** (`desconectado`),
  igual que `CHANNEL_ERROR` o `TIMED_OUT`, para que la UI muestre el aviso;
- devuelve la limpieza para el `useEffect`, segura aunque el canal todavía no exista.

Sin eso, en una carga completa de la página el canal se unía antes de que el cliente
leyera la sesión de las cookies: el `phx_join` salía como `anon`, Realtime rechazaba la
suscripción entera («invalid column for filter id», porque `anon` no tiene `select`) y no
la reintentaba al llegar el JWT; el error venía como `system`, que nadie escuchaba, así que
la página quedaba sin eventos y sin aviso. Navegando dentro de la app funcionaba, porque la
sesión ya estaba cargada. Visto en *Production* el 2026-11-17; el arreglo está en el código,
sin desplegar a esa fecha
([trampa](../07-referencia/trampas-conocidas.md#realtime-en-una-carga-completa-bug-visto-en-production-2026-11-17)).
La señal para diagnosticarlo: `realtime.subscription` vacía con la página abierta.

Con el cliente del navegador (`clienteNavegador()` de `src/lib/supabase/navegador.ts`, que
lleva la sesión del usuario):

```ts
useEffect(() => {
  return suscribirEnVivo(
    clienteNavegador(),
    `operaciones:${organizacionId}`,
    [
      {
        tabla: 'operaciones_sii',
        filtro: `organizacion_id=eq.${organizacionId}`,
        alCambiar: (cambio) => {
          // cambio.new: la fila completa (resultado, mensaje, detalle, terminada_en…)
        },
      },
    ],
    (estado) => {
      // 'conectado' | 'reconectado' (refrescar una vez) | 'desconectado' (mostrar el aviso)
    },
  );
}, [organizacionId]);
```

El filtro reduce el tráfico; la seguridad la pone RLS (sin filtro, igual llegan solo las
filas de las organizaciones del usuario). Una fila `en_curso` que pasa a otro `resultado`
llega como `UPDATE`: es la señal para mostrar el resultado sin recargar.

### Asistente de certificación (Fase 5)

Primer uso real de Realtime en la app: `apps/web/src/app/[org]/certificacion/EnVivo.tsx`.

- Un canal `certificacion:<empresaId>` con dos `postgres_changes` (`event: '*'`):
  `procesos_certificacion` y `operaciones_sii`, los dos con
  `filter: empresa_id=eq.<empresaId>` (la página es de una empresa; RLS ya limita a las
  organizaciones del usuario).
- **No guarda las filas que llegan.** Cualquier cambio programa un `router.refresh()` con
  400 ms de espera (junta el cambio de la operación y el del proceso en un solo refresco) y
  el RSC vuelve a leer todo con RLS (`leerAsistente`). Así no hay dos fuentes de verdad.
- Al reconectar (`SUBSCRIBED` después de haber estado suscrito) refresca una vez, para
  traer lo que cambió con el canal caído. Con `CHANNEL_ERROR`, `TIMED_OUT` o un `system`
  con error (`suscribirEnVivo`, sin desplegar al 2026-11-17) muestra «No
  pudimos conectar la actualización en vivo. Recarga la página para ver el estado más
  reciente.»
- No escucha `envios`, `solicitudes_folios` ni `set_pruebas_casos`: sus cambios ocurren
  dentro de una operación, y el cierre de la fila de `operaciones_sii` (que sí se escucha)
  llega después y dispara el refresco.
- Lo ven todos los miembros, también un lector o un emisor: la operación en curso se
  muestra desde `operaciones_sii` («Descargando el set de pruebas desde las 14:32…»), sin
  spinners por fila.
- `operaciones_sii` depende de la migración 0006 (aplicada); `procesos_certificacion` está
  publicada desde la 0001.

Segundo uso (Fase 6): `apps/web/src/app/[org]/folios/EnVivo.tsx`, mismo patrón.

- Canal `folios:<empresaId>` con `solicitudes_folios`, `operaciones_sii` y `cafs`
  (`filter: empresa_id=eq.<empresaId>`) y `folios_anulados`
  (`filter: organizacion_id=eq.<organizacionId>`: no tiene `empresa_id`),
  `router.refresh()` con 400 ms y el RSC relee con `leerFolios` (RLS). Mismo aviso si el
  canal no conecta.
- Aquí sí escucha `solicitudes_folios`: una revisión con el SII (`simulada`) cambia la
  solicitud y su operación `confirmada = false`, y el historial de solicitudes la muestra.
- **`cafs` y `folios_anulados` están publicadas desde la 0011** (aplicada el
  2026-11-15). Antes, un CAF nuevo solo llegaba con el cambio de su solicitud
  (`registrar_caf` la deja `timbrada`) o con la Server Action que lo subió o anuló (que hace
  `revalidatePath`), y la carga o anulación de otro administrador sin solicitud no se veía
  hasta recargar. `EnVivo.tsx` está suscrito a las dos; en una base sin la 0011 esas
  suscripciones simplemente no reciben eventos.
  `folios_anulados` llega por organización, así que una anulación en otra empresa de la
  misma organización también refresca la vista (inofensivo).
- `solicitudes_folios` y `operaciones_sii`, de la 0006 (aplicada).

`/emitir` (Fase 7) **no** usa Realtime: la emisión es una sola Server Action que devuelve
el resultado, y después revalida `/emitir` y `/folios` (`revalidatePath`). El cambio de
estado de una boleta después de la subida (aceptada, rechazada) lo muestran Documentos
emitidos y la página del envío (Fase 8, abajo).

### Documentos emitidos y envíos (Fase 8)

Los tres `EnVivo` (Certificación, Folios y Documentos/Envíos) se suscriben con
`suscribirEnVivo` ([arriba](#suscribirse-desde-el-panel)); hasta ese arreglo (2026-11-17,
sin desplegar) los tres tenían el defecto de la carga completa.

Tercer uso: `apps/web/src/app/[org]/documentos/EnVivo.tsx`, en `/[org]/documentos` y en
`/[org]/envios/[id]`. **A diferencia de Certificación y Folios, sí guarda lo que llega**,
en un store de Zustand (`useEnVivoStore`, `stores/enVivo.ts`), porque el criterio de la fase
es que el badge cambie sin recargar aunque el refresco tarde o falle.

- Escucha `documentos` y `envios` (publicadas desde la `0001`, sin migración nueva). En la
  lista, las dos con `filter: organizacion_id=eq.<id>`; en la página de un envío, solo ese
  envío (`id=eq.<envioId>`) y sus documentos (`envio_id=eq.<envioId>`), para no refrescar
  por cualquier cambio de la organización (`filtrosRealtime`).
- Cada evento (salvo `DELETE`) se guarda en el store con su `actualizado_en`
  (`aplicarDocumento`, `aplicarEnvio`; descarta lo que no entiende y un evento más viejo
  que el guardado) y programa un `router.refresh()` con 400 ms de espera.
- Los badges, el panel y la página del envío muestran el más nuevo entre lo del servidor y
  lo del store (`estadoVigente`, `envioVigente`, por `actualizado_en`): un refresco más
  nuevo gana sobre un evento viejo.
- El store es uno por montaje (`ProveedorEnVivo`, `useState`), nunca un singleton de
  módulo; fuera del proveedor `useEnVivoStore` usa uno vacío y el componente muestra lo del
  servidor.
- Reconexión y aviso de canal caído, igual que en las otras dos.
- `documentos` llega con la fila completa (Realtime no filtra columnas), incluido
  `ted_xml`: es lo mismo que el miembro ya puede leer con un `select` (RLS `es_miembro`);
  nada de Vault.
- Cada consulta del seguimiento sube `envios.consultas` y `actualizado_en`, así que también
  una consulta sin cambio de estado manda un evento de `envios` y un refresco.

### Verificación

`supabase/verificaciones/0006_realtime_operaciones.sql` (solo lectura, 9 comprobaciones):
la publicación existe y publica `insert`, `update` y `delete`; las dos tablas están en ella;
`documentos`, `envios` y `procesos_certificacion` siguen publicadas; RLS activo; política
`lectura`; `select` para `authenticated`; nada para `anon`; *replica identity* por defecto;
migración registrada como `0006`. Antes de aplicar la migración daba 7/9 (fallaban la 2 y la 9); aplicada el 2026-11-13, da 9/9 `ok`.

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
- **Set de pruebas (Fase 5, primera subida real).** `enviarSet` sube cada boleta como
  `<org>/<empresa>/certificacion/DTE-39-F<folio>.xml` y el sobre como
  `EnvioBOLETA-set-<envio_id>.xml`, **antes** de salir al SII, con `upsert: false` (el folio
  y el id del envío no se repiten). Si el envío no llega a salir, los archivos quedan en
  Storage aunque las boletas pasen a `anulado`. Con esta subida se puede confirmar lo de
  la [trampa del `content-type`](../07-referencia/trampas-conocidas.md#errores-y-saneado).
- **Emisión (Fase 7).** Nombres deterministas por tipo y folio, en
  `<org>/<empresa>/<ambiente>/` (`nombresArchivos` de `server/emision/representacion.ts`):

  | Archivo | Qué es | Dónde queda la ruta | Cuándo se sube |
  |---|---|---|---|
  | `DTE-39-F41.xml` | DTE firmado (ISO-8859-1) | `documentos.xml_path` | antes de salir al SII, `upsert: false` |
  | `EnvioBOLETA-39-F41.xml` | sobre `EnvioBOLETA` | `envios.xml_path` | antes de salir, `upsert: false` |
  | `DTE-39-F41-carta.pdf` | representación impresa carta | `documentos.metadata.pdf.carta` | después del `ok`, con `sobrescribir: true` |
  | `DTE-39-F41-rollo.pdf` | representación impresa rollo 80 mm | `documentos.metadata.pdf.rollo` | ídem |

  (39 y 41 son el tipo y el folio de ejemplo.) El nombre del PDF se deriva del XML
  (`nombrePdfDeXml`). Los PDF se pueden regenerar y se sobrescriben; los XML firmados no.
  Si la emisión falla antes de enviar o se reintenta con otro folio (`23514`), los XML ya
  subidos quedan en Storage. `documentos.metadata.receptor_correo` y
  `documentos.metadata.correo` (`{ id, enviado_en }` del correo con el PDF) no son
  archivos, pero viven en el mismo `metadata`
  ([objetos](../04-objetos/objetos-documentos.md#metadata-fase-7)). La subida del set usa
  `DTE-39-F<folio>.xml` en la misma carpeta de certificación; no chocan porque el folio es
  único por empresa, ambiente y tipo.

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
- **Descargas de `/emitir` (Fase 7)**: `enlaceDocumento` lee el documento con la sesión
  (RLS, filtrado por organización y empresa) y firma por 60 s (`SEGUNDOS_URL`) el XML o el
  PDF; si el PDF falta, lo regenera con los datos guardados y el `ted_xml`, lo sube y guarda
  la ruta en `metadata.pdf` ([guía](../02-guias/emision-boletas.md#descargas)).

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
