---
title: "Tablero y reportes"
description: "Fase 9: qué muestra el Tablero y de dónde sale cada cifra (v_ventas_diarias menos el set de pruebas, conteos por estado con count exact, folios con armarResumen), selectores de empresa, ambiente y período en la URL, alertas, Realtime y manejo de errores por sección; exportación CSV y Excel (/[org]/reportes/exportar, reportes documentos y resumen, CSV con BOM y `;`, neutralización de fórmulas, XLSX propio sin dependencias, tope de 50.000 filas, códigos HTTP) y la consulta SQL de control del criterio de aceptación."
keywords: [Tablero, Fase 9, tablero, reportes, exportación, exportar, CSV, Excel, XLSX, leerCifras, CifrasPeriodo, calcularVentas, cifrasDocumentos, detalleVentas, detalleExento, ESTADOS_CONTADOS, conteoVacio, MAXIMO_SET, alertasFolios, leerFiltrosTablero, opcionesPeriodoTablero, leerResumenFolios, armarResumen, ResumenTipo, tuvoCaf, v_ventas_diarias, set_pruebas, origen, count exact, head, agregaciones de PostgREST, mnt_neto.sum, hrefExportacion, hrefExportar, lib/reportes.ts, REPORTES, FORMATOS_REPORTE, /reportes/exportar, generarExportacion, leerPedido, leerDocumentosExportacion, leerResumenDiario, agruparPorDia, tablaDocumentos, tablaResumen, totalesResumen, nombreArchivo, MAXIMO_FILAS, FILAS_POR_LOTE, keyset, No encontramos esa empresa, ExportacionDemasiadoGrande, 413, medidorFoliosTablero, condicionCursor, generarCsv, neutralizarFormula, inyección de fórmulas, CSV injection, BOM, separador, punto y coma, es-CL, generarXlsx, inlineStr, serieExcel, nombreHoja, escaparXml, armarZip, deflateRawSync, crc32, MIME_XLSX, MIME_CSV, Content-Disposition, seguro, Falla, EnVivo, canal tablero, ProveedorEnVivo, fase9-tablero-control.sql, criterio de aceptación]
related: ["02-guias/seguimiento-envios.md", "02-guias/folios-caf.md", "02-guias/emision-boletas.md", "04-objetos/objetos-documentos.md", "03-api-reference/acceso-por-tabla.md", "03-api-reference/indice-operaciones.md", "06-integraciones/realtime-y-storage.md", "05-pruebas/probar-el-esquema.md", "07-referencia/trampas-conocidas.md"]
source: ["supabase/migrations/0001_esquema_inicial.sql (v_ventas_diarias)", "supabase/verificaciones/fase9-tablero-control.sql", "PLAN-SAAS.md Fase 9", "apps/web/src/app/[org]/tablero/", "apps/web/src/server/tablero/", "apps/web/src/server/folios/lectura.ts", "apps/web/src/lib/reportes.ts", "apps/web/src/app/[org]/reportes/exportar/route.ts", "apps/web/src/server/reportes/", "apps/web/src/app/[org]/documentos/page.tsx"]
---

# Tablero y reportes

> **Úsalo cuando:** tocas el Tablero (`/[org]/tablero`), las descargas CSV o Excel, o
> necesitas explicar por qué una cifra del Tablero no calza con otra fuente.

**Estado (2026-11-17).** La **Fase 9** está desplegada en *Production* (`f5f8927`) y su
[criterio de aceptación](#consulta-de-control-y-criterio-de-aceptación) está cumplido: el
Tablero muestra las mismas cifras que la consulta SQL de control. No trae migraciones: todo
sale de lo que ya existe (`v_ventas_diarias`, `documentos`, `cafs`, `envios`,
`v_certificados_estado`).

## Dónde vive

| Pieza | Archivo |
|---|---|
| Página | `apps/web/src/app/[org]/tablero/page.tsx` y `tablero.module.css` |
| Cifras del Tablero (`server-only`) | `apps/web/src/server/tablero/` (API en `index.ts`): `cifras.ts` (filtros de la URL, ventas, conteos, textos y alertas de folios; puro) y `lectura.ts` (`leerCifras`, con la sesión) |
| Resumen de folios | `apps/web/src/server/folios/lectura.ts`: `armarResumen` (compartido con la página de Folios) y `leerResumenFolios` (una sola consulta a `cafs`) |
| Contrato de la URL de descarga (puro) | `apps/web/src/lib/reportes.ts`: `REPORTES`, `FORMATOS_REPORTE`, `hrefExportacion` |
| Ruta de exportación | `apps/web/src/app/[org]/reportes/exportar/route.ts` |
| Exportaciones (`server-only`) | `apps/web/src/server/reportes/` (API en `index.ts`, `generarExportacion`): `filas.ts` (pedido, columnas, filas, nombre del archivo, `hrefExportar`; puro), `lectura.ts` (documentos paginados por *keyset* y, para el resumen de producción, `v_ventas_diarias`; con la sesión), `tabla.ts` (forma común), `csv.ts`, `xlsx.ts` y `zip.ts` (puros) |
| Botones en Documentos emitidos | `apps/web/src/app/[org]/documentos/page.tsx` («Exportar lo filtrado») |
| Consulta de control | `supabase/verificaciones/fase9-tablero-control.sql` (solo lectura) |
| Pruebas | `server/tablero/cifras.test.ts`, `lectura.test.ts`; `server/reportes/{filas,lectura,csv,xlsx}.test.ts` (con `zip-lector.test-util.ts`, que descomprime el .xlsx); `app/[org]/reportes/exportar/route.test.ts`; `lib/reportes.test.ts` |

Todo lee con el cliente de **sesión** (RLS: lectura para cualquier miembro) y cada consulta
filtra además por organización, empresa y ambiente. Nada usa `service_role` y nada escribe.

## El Tablero

### Qué empresa, ambiente y período

Los tres van en la URL (`?empresa=<uuid>&ambiente=certificacion|produccion&periodo=AAAA-MM`)
y los elige un formulario GET con «Ver período», como Documentos emitidos: funciona sin
JavaScript y un enlace copiado muestra lo mismo. `leerFiltrosTablero` usa el mismo
`leerFiltros` de Documentos (nunca lanza; lo inválido vuelve a su valor por defecto).

| Selector | Por defecto | Notas |
|---|---|---|
| Empresa | la de la URL si es de la organización; si no, la última abierta (`perfiles.ultima_empresa`), la primera activa o la primera | solo se muestra con más de una empresa; las desactivadas dicen «, desactivada» |
| Ambiente | `ambientePorDefecto`: el del último documento de la empresa (sin borradores ni el set); sin documentos, producción si la empresa está autorizada y si no certificación | en certificación aparece `BannerAmbiente` |
| Período tributario | el mes actual en hora de Chile | los últimos 12 meses (`MESES_SELECTOR`), más el pedido si es más antiguo. **No hay «Todos los períodos»**: el Tablero resume un mes; si llega `periodo=todos`, vale el mes actual (`opcionesPeriodoTablero`) |

El período se aplica sobre `fecha_emision` (columna `date`, fecha de Chile): desde el día 1
del mes hasta antes del día 1 del siguiente (`rangoPeriodo`).

Sin empresas, la página muestra solo el título «Tablero», los avisos de certificados y «Lo
que viene» (qué cargar en Configuración para emitir).

### Qué muestra

En orden: `BannerAmbiente`; la cabecera «Resumen del mes» con «Período tributario <mes> ·
Actualizado <fecha y hora del render> · <razón social> (<RUT>)» y «Emitir boleta» (solo para
quien puede emitir, `puedeEmitir`); los selectores; las alertas
([abajo](#alertas)); y cuatro secciones: **Cifras del período**, **Folios disponibles**,
**Últimos documentos emitidos** y **Descargas**.

### De dónde sale cada cifra

`leerCifras(ctx)` (`server/tablero/lectura.ts`) lanza todas las consultas en paralelo:

| Tarjeta | Valor | Fuente y reglas |
|---|---|---|
| **Ventas netas** | Σ `mnt_neto` | `v_ventas_diarias` del período (la vista ya filtra `aceptado` y `aceptado_con_reparos`), **menos** los documentos del set de pruebas aceptados del mismo período (solo en certificación) |
| bajo Ventas netas | «N boletas aceptadas por el SII» o «Aún no hay boletas aceptadas en el período» | Σ `documentos` de la vista menos los del set; cuenta también las aceptadas con reparos |
| bajo Ventas netas, solo si hay | «Más $ X exentos» | Σ `mnt_exe` (boleta 41 o líneas exentas): no va en el neto |
| **IVA débito** | Σ `iva` | igual que Ventas netas; nota fija «19% sobre ventas afectas» |
| **Documentos emitidos** | suma de los conteos de `aceptado`, `aceptado_con_reparos`, `rechazado`, `enviado`, `incierto` y `firmado` | un `select('id', { count: 'exact', head: true })` por estado sobre `documentos` (no trae filas), **sin el set de pruebas** (`origen <> 'set_pruebas'`) y **sin documentos sin folio** (`folio is not null`) |
| bajo Documentos emitidos | «2 aceptados · 0 con reparos · 0 rechazados» y, solo si hay, «N enviados», «N por verificar», «N firmados» | los mismos conteos (`cifrasDocumentos`) |
| bajo Documentos emitidos, solo si hay | «Sin contar N anulados» | conteo de `anulado`: no valen como documento y no suman en emitidos |
| **Esperando al SII** | conteo de `enviado` | nota fija «Enviados con Track ID, sin respuesta» |

Los borradores nunca cuentan (viven en Emitir). Los conteos usan exactamente los filtros de
la lista de Documentos emitidos, así que «Ver todos» (que abre Documentos con la misma
empresa, ambiente y período) muestra el mismo total que «Documentos emitidos» más los
anulados. Los montos son pesos enteros; las sumas de la vista son `numeric`, y `numero()`
las acepta como número o como texto y trata `null` como 0.

Si una consulta falla, `leerCifras` lanza un `fallaBase` (sin datos de la fila) y la
sección muestra su aviso ([abajo](#si-una-lectura-falla)).

#### Por qué no sale de `v_ventas_diarias` tal cual

`v_ventas_diarias` (de la `0001`) agrupa por organización, empresa, ambiente, fecha y tipo
los documentos aceptados, pero **no mira `origen`**: en certificación suma también los
documentos del set de pruebas que el SII aceptó. Esos no son ventas, Documentos emitidos no
los lista y la alerta de rechazos los excluye. Sin restarlos, el Tablero no cuadraría con
«Ver todos» ni con la consulta de control.

Por eso `leerCifras` pide, solo en certificación, los documentos `origen = 'set_pruebas'`
aceptados (o con reparos) del período, con sus montos (hasta `MAXIMO_SET` = 1.000; un set
trae unos 10), y `calcularVentas` resta su suma, contando 1 por documento. En producción no
hay set (solo se crea en certificación: `envio-set.ts` fija `AMBIENTE = 'certificacion'`) y
esa consulta no se hace. Así no hizo falta una migración que cambiara la vista,
que también usan otros (p. ej. el RCOF de períodos antiguos).

**Por qué la vista y no sumar `documentos`.** La vista trae una fila por día y tipo, pocas
filas aunque haya miles de boletas en el mes. Sumar en la base con agregaciones de
PostgREST (`select=mnt_neto.sum()`) no es opción: están **apagadas** en el proyecto
(`db-aggregates-enabled` en falso, el valor por defecto), y traer todas las filas de
`documentos` para sumarlas en JS chocaría con el `max-rows` de 1.000.

### Folios disponibles

`leerResumenFolios(organizacionId, empresaId)` hace **una** consulta a `cafs` (id, ambiente,
tipo, rango, `siguiente_folio`, estado; nunca `caf_secret_id`) en vez de todo lo que lee
`leerFolios` (historial, solicitudes, operaciones, anulados, certificados y plan), y arma las
cuatro tarjetas (39 y 41 en producción y certificación) con `armarResumen`, la misma función
que usa la página de Folios: disponibles, total y estado son los mismos en los dos. Devuelve
`null` si los ids no son UUID.

El Tablero muestra solo las dos del ambiente elegido:

- con un CAF en uso, un `MedidorFolios` con los **mismos números que la alerta** (los
  disponibles y el total de todos los CAF activos de ese tipo y ambiente), calculados por
  `medidorFoliosTablero` (`server/tablero/cifras.ts`):
  - con un solo CAF activo, su rango real (desde, hasta y siguiente);
  - con varios, un rango sintético que parte del primer folio del CAF en uso, con el largo
    del total y el siguiente corrido en los folios ya usados, más la nota «Suma los folios de
    todos los CAF activos de este tipo.». Es exacto si los CAF son consecutivos (lo normal:
    el SII timbra rangos seguidos) y una aproximación si no;
- sin CAF en uso, una `Tarjeta` «0 disponibles» que dice «CAF agotado: no puedes emitir este
  tipo hasta que pidas o subas uno nuevo.» si alguna vez hubo un CAF de ese tipo y ambiente
  (`tuvoCaf`), o «Aún no hay folios de este tipo.» si nunca lo hubo.

La página de Folios lo muestra distinto: el `MedidorFolios` del CAF en uso y, si hay más
CAF activos, la nota «En total quedan N folios sumando los CAF que vienen». Con varios CAF,
el medidor del Tablero y el de Folios no dibujan el mismo rango, aunque los dos cuentan lo
mismo.

«Administrar folios» lleva a `/[org]/folios` (con `?empresa=` si la URL la traía).

### Últimos documentos emitidos

`listarDocumentos` con los mismos filtros que «Ver todos» (empresa, ambiente y período, sin
tipo, estado ni búsqueda): la primera página (20, por `fecha_emision` y folio
descendentes) recortada a 6 (`ULTIMOS`), en la misma `ListaDocumentos` de Documentos
emitidos. Sin documentos: «Aún no hay boletas emitidas en <ambiente> en <mes>.».

### Alertas

| Alerta | Fuente | Alcance |
|---|---|---|
| Envíos por verificar (Fase 8) | `enviosInciertos` | la empresa elegida en **los dos ambientes** (un incierto se revisa aunque se mire el otro), sin el set ni los ya revisados; hasta 10 con enlace a cada envío ([seguimiento](seguimiento-envios.md#envíos-inciertos-y-ya-lo-revisé)) |
| Certificados vencidos o por vencer (Fase 3) | `estadosCertificados` + `alertasCertificados` (`v_certificados_estado`) | la organización; «Cargar certificado» para administradores, «Ver certificados» para el resto |
| Folios agotados o por agotarse (Fase 9) | `alertasFolios(resumen, ambiente)` | la empresa elegida, **solo el ambiente elegido** |

`alertasFolios` usa la regla del 15 % de `estadoDisponibilidad` (la misma de la página de
Folios y del correo `folios.por_agotarse`) sobre el resumen de `armarResumen`:

- una alerta `error` «Se acabaron los folios de boleta (y boleta exenta) en <ambiente>» para
  los tipos con estado `error` que alguna vez tuvieron CAF; un tipo que nunca tuvo CAF no
  avisa (es lo normal para quien no emite ese tipo);
- una alerta `aviso` «Quedan pocos folios de …» con cuántos quedan de cada tipo («Queda 1
  folio de boleta», «Quedan 3 folios de boleta y 50 folios de boleta exenta»), para los
  tipos en `aviso`.

Las dos traen «Pedir folios» (administradores) o «Ver folios» (el resto).

### En vivo

La página va dentro de `ProveedorEnVivo` y reutiliza `EnVivo` de Documentos emitidos con el
canal `tablero:<organizacionId>`: escucha `documentos` y `envios` de **toda la
organización** y, con cada evento, guarda el estado en `useEnVivoStore` y pide un
`router.refresh()` (400 ms de espera para juntar ráfagas). El refresco vuelve a leer cifras,
folios, últimos documentos y alertas con RLS: al emitir una boleta o al llegar la respuesta
del SII, las tarjetas se actualizan sin recargar. Se suscribe con `suscribirEnVivo`, así que
también funciona en una carga completa
([Realtime](../06-integraciones/realtime-y-storage.md#tablero-fase-9)).

No escucha `cafs`: un CAF que sube o anula otro administrador se ve en el próximo refresco
(otro evento de documentos o envíos) o al recargar.

### Si una lectura falla

Cada parte se lee con `seguro(parte, leer)`: si lanza, registra en consola solo el tipo de
error (`error.name`, nunca datos) y devuelve `null`, y el resto del Tablero se ve igual.

| Parte | Si falla |
|---|---|
| Cifras del período | `Tarjeta` plana: «No pudimos leer las cifras del período. Recarga la página en un momento; si sigue igual, revisa Documentos emitidos.» |
| Folios | «No pudimos leer los folios. Recarga la página en un momento o revisa la página de Folios.» (y sin alertas de folios) |
| Últimos documentos | «No pudimos leer los últimos documentos. Recarga la página en un momento.» |
| Envíos por verificar | la alerta no aparece |
| Certificados | sin avisos de certificados |

`exigirMembresia` y `listarEmpresas` no van envueltas: sin ellas no hay página (sin
membresía, 404). `ambientePorDefecto` nunca lanza (ante un error usa el respaldo).

## Exportación

Dos reportes, en CSV o Excel. Los enlaza el Tablero (sección **Descargas**: «Boletas del
período (CSV)», «Boletas del período (Excel)», «Resumen diario por tipo (CSV)» y «Resumen
diario por tipo (Excel)», para la empresa, ambiente y período que muestra) y Documentos
emitidos («Exportar lo filtrado»: «Exportar CSV» y «Exportar Excel» del reporte `documentos`
con los filtros vigentes de la lista y la empresa explícita). Son enlaces `<a download>`, no
Server Actions.

### La ruta

`GET /<slug>/reportes/exportar?empresa=<uuid>&ambiente=…&periodo=…&reporte=…&formato=…`
(`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`).

| Parámetro | Valores | Notas |
|---|---|---|
| `reporte` | `documentos` \| `resumen` | obligatorio |
| `formato` | `csv` \| `xlsx` | obligatorio |
| `empresa` | uuid | si falta, la última abierta, la primera activa o la primera (como en Documentos); si viene y **no es de la organización**, 404 «No encontramos esa empresa en esta organización…» (nunca se cambia en silencio por otra). El archivo lleva el RUT en el nombre |
| `ambiente` | `certificacion` \| `produccion` | si falta, `ambientePorDefecto` |
| `periodo` | `AAAA-MM` o `todos` | por defecto el mes actual; `resumen` exige un mes |
| `tipo`, `estado`, `q` | como en Documentos emitidos | solo con `reporte=documentos`; `resumen` los ignora |

`hrefExportacion` (`lib/reportes.ts`, el que usa el Tablero) escribe siempre `empresa`,
`ambiente`, `periodo`, `reporte` y `formato` en ese orden; `hrefExportar`
(`server/reportes/filas.ts`, el de Documentos) parte de los filtros de la lista
(`parametrosDe`), sin página ni documento abierto, y para `resumen` quita tipo, estado y
búsqueda.

La ruta, en orden:

1. **Sesión** (`obtenerUsuario`). El proxy ya manda a `/ingresar?siguiente=…` sin sesión;
   la ruta lo repite por si acaso (redirección **307** a `/ingresar?siguiente=<ruta y
   consulta completas>`).
2. **Membresía** por el slug (`obtenerMembresias`). Sin ella, **404** «No encontramos esa
   organización.» (como las páginas de `/[org]`: no revela qué organizaciones existen). No usa
   `exigirMembresia`, porque su `notFound()` es para páginas.
3. **Pedido** (`leerFiltros` + `leerPedido`, con zod): reporte o formato desconocido, o
   `resumen` con `periodo=todos`, dan **400** con un texto que dice qué usar.
4. **Empresa y ambiente**. Una `empresa` de la URL que no es de la organización da **404**
   «No encontramos esa empresa en esta organización. Vuelve a exportar desde el Tablero o
   Documentos emitidos.»; sin `empresa`, la misma elección que Documentos. Sin
   empresas, **404** «Aún no hay empresas en esta organización: no hay nada que exportar.».
5. **Archivo** (`generarExportacion`) y respuesta.

| Respuesta | Cuándo | Cuerpo |
|---|---|---|
| **200** | archivo generado | el archivo, con `Content-Type` (`text/csv; charset=utf-8` o `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`), `Content-Disposition: attachment; filename="…"`, `Content-Length`, `Cache-Control: no-store` y `X-Content-Type-Options: nosniff` |
| **307** | sin sesión | redirección a ingresar |
| **400** | reporte o formato inválido, resumen sin mes | texto plano con la guía |
| **404** | sin membresía, empresa de otra organización o sin empresas | texto plano |
| **413** | más de 50.000 documentos, al contar o durante la lectura | «La exportación tiene N documentos y el máximo es 50.000. Acota el período o filtra por tipo o estado y vuelve a exportar.» |
| **500** | cualquier otra falla | «No pudimos generar el archivo. Intenta de nuevo en unos minutos; si sigue fallando, escríbenos.»; en consola solo el nombre y el mensaje del error |

Los textos de error van como `text/plain; charset=utf-8` con `no-store`. Como el enlace tiene
`download`, el navegador no los muestra en la página: según el navegador, la descarga falla
o el texto se guarda como archivo (ver
[trampas](../07-referencia/trampas-conocidas.md#tablero-y-reportes-fase-9)).

### Reporte `documentos` (boletas del período)

Las mismas filas que mostraría la lista de Documentos emitidos con esos filtros, todas las
páginas: estados listados (todos menos `borrador`, o el del filtro `estado`), sin el set de
pruebas, sin documentos sin folio, con tipo, búsqueda y período (o todos los períodos). Orden
estable: `fecha_emision`, tipo, folio e `id` ascendentes, y la lectura pagina por *keyset*
sobre esa misma tupla (cada lote empieza después de la última fila del anterior), no por
`offset`: una boleta emitida durante la exportación no corre las páginas ni duplica o salta
filas. La condición del cursor (`condicionCursor`, `(fecha_emision, tipo_dte, folio, id) >
última fila`) va expandida en un `or()` de PostgREST, que no compara tuplas; sus valores se
validan y van entre comillas dobles, así que no pueden inyectar filtros. Con búsqueda (`q`,
que también es un `or()`), las dos se combinan en **un solo `or()` anidado**
(`and(or(…),or(…))`), para no depender de cómo trata PostgREST dos parámetros `or`
repetidos. Una sola consulta por lote trae también el Track ID, con el *embed* de la FK compuesta
`envios!documentos_empresa_id_envio_id_fkey(track_id)` (la pista evita la ambigüedad con
`v_envios_por_consultar`, que expone la misma FK). Nunca `ted_xml` ni ids de Vault.

| Columna | Tipo | Contenido |
|---|---|---|
| Tipo (código) | entero | 39 o 41 |
| Tipo | texto | `nombreTipoDte` («Boleta electrónica», …) |
| Folio | entero | |
| Fecha de emisión | fecha | |
| RUT receptor | texto | con puntos y guion (`formatearRut`) |
| Razón social receptor | texto | la guardada; si falta, «Cliente General» para `66666666-6` y «Sin razón social» para el resto (como la tabla de Documentos) |
| Neto, Exento, IVA, Total | monto | pesos enteros |
| Estado | texto | la palabra del design system (`textoEstadoDte`: «Aceptado», «Aceptado con reparos», «Por verificar»…) |
| Track ID | texto | del envío, si hay |

Hoja «Boletas» en Excel.

### Reporte `resumen` (resumen diario por tipo)

Una fila por día y tipo del **mes** pedido, con los documentos `aceptado` y
`aceptado_con_reparos`, sin el set de pruebas: Fecha, Tipo, Documentos, Folio desde, Folio
hasta, Neto, Exento, IVA y Total, en orden de fecha y tipo, y al final una fila «Total» con
los conteos y montos del período (sin tipo ni rango de folios, porque mezcla tipos; en
negrita en Excel). Hoja «Resumen diario».

La fuente depende del ambiente (`leerResumenDiario`):

- **Producción: directo de `v_ventas_diarias`.** Ahí no hay set de pruebas, así que la vista
  es exactamente el resumen: una fila por día y tipo, pocas filas aunque el mes tenga miles
  de boletas, y nunca se acerca al tope.
- **Certificación: boleta por boleta, sin el set.** La vista incluye los documentos del set
  aceptados; restarlos por día y tipo cuadraría los montos, pero no el rango de folios (la
  vista solo trae mínimo y máximo, y un folio del set puede ser uno de ellos). Por eso se
  leen los documentos sin el set con el mismo lector del reporte de boletas y `agruparPorDia`
  replica el `group by` de la vista (conteo, folio mínimo y máximo, sumas). En certificación
  los volúmenes son mínimos.

En los dos casos los totales cuadran con el Tablero (vista menos set) y los folios son
correctos.

### Nombre del archivo

`nombreArchivo`: `boletas-<RUT>-<ambiente>-<período>.<formato>` o
`resumen-diario-<RUT>-<ambiente>-<período>.<formato>`, con el RUT sin puntos (`rutSii`). Por
ejemplo `boletas-20630500-2-certificacion-2026-11.csv` o
`resumen-diario-20630500-2-produccion-2026-11.xlsx`; con todos los períodos,
`boletas-…-todos.csv`.

### CSV

`generarCsv` (`server/reportes/csv.ts`) está pensado para abrirse con doble clic en Excel con
configuración regional de Chile:

- **UTF-8 con BOM**: sin él, Excel lo lee como Windows-1252 y rompe tildes y eñes.
- **Separador `;`**: en es-CL la coma es el separador decimal, así que Excel espera `;`
  como separador de lista. Con `,` abriría todo en una sola columna.
- **CRLF** y comillas según RFC 4180, solo cuando hacen falta (el campo trae `;`, comillas,
  saltos de línea o espacios en los bordes); las comillas internas se duplican. Termina con
  un salto de línea.
- **Montos y folios como enteros sin formato** (sumables en Excel); **fechas `DD-MM-AAAA`**.
  Un texto en una columna de fecha que no tiene forma de fecha (p. ej. «Total») va tal cual.
- **Neutralización de fórmulas** (OWASP «CSV Injection», `neutralizarFormula`): una celda de
  **texto** (también los títulos) que empieza con `=`, `+`, `-`, `@`, tabulación o retorno de
  carro lleva un `'` delante; Excel la evaluaría como fórmula. Las celdas numéricas no se
  tocan: un monto negativo sigue siendo número.

### Excel (XLSX)

`generarXlsx` (`server/reportes/xlsx.ts`) escribe un .xlsx mínimo (Office Open XML, ECMA-376)
**sin dependencias**: un libro con una hoja, armado como ZIP por `armarZip` (`zip.ts`:
DEFLATE con `deflateRawSync` y CRC con `crc32` de `node:zlib`, formato clásico de PKWARE, sin
ZIP64, porque 50.000 filas quedan muy lejos de 4 GB). Partes: `[Content_Types].xml` (primero),
`_rels/.rels`, `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, `xl/styles.xml` y
`xl/worksheets/sheet1.xml`.

- **Texto como `inlineStr`** (sin tabla de cadenas compartidas, que solo ahorra espacio). Un
  `inlineStr` nunca se evalúa como fórmula: no hace falta neutralizar. Sí se escapa el XML y
  se quitan los caracteres que XML 1.0 no admite (controles C0 salvo tabulación y saltos de
  línea, sustitutos sueltos, U+FFFE y U+FFFF): uno de ellos en una razón social dejaría el
  archivo ilegible para Excel.
- **Números como números**; **fechas como fechas reales** (número de serie del sistema 1900,
  día 0 = 30-12-1899, `serieExcel`; una fecha inexistente como el 31-02 va como texto), con
  formato `dd-mm-yyyy`.
- **Estilos fijos**: encabezado en negrita, montos con `#,##0` (Excel lo muestra con el
  separador de miles de la configuración regional: `1.190` en es-CL), fila de totales en
  negrita. Encabezado fijo al desplazarse y anchos de columna por columna.
- Nombre de hoja saneado (`nombreHoja`: sin `[]:*?/\`, sin `'` en los bordes, hasta 31
  caracteres).

### Tope de filas

`MAXIMO_FILAS` = **50.000** por exportación de documentos. El lector pide lotes de 1.000
(`FILAS_POR_LOTE`, el `max-rows` de PostgREST en Supabase); el primero con `count: 'exact'`.
Si el conteo pasa del tope, lanza `ExportacionDemasiadoGrande` antes de leer el resto y la
ruta responde 413. Si el tope se supera **durante** la lectura (boletas emitidas mientras se
exporta), también es 413: nunca se entrega un archivo cortado en silencio. Un lote
incompleto es el último. 50 lotes caben holgados en `maxDuration = 60`. El resumen de
producción sale de la vista y no llega al tope. El archivo
se arma entero en memoria antes de responder (no hay *streaming*).

## Permisos

| Acción | Quién |
|---|---|
| Ver el Tablero, sus cifras, folios y alertas | cualquier miembro (RLS `es_miembro`) |
| «Emitir boleta» desde el Tablero | propietario, administrador o emisor (`puedeEmitir`) |
| Descargar CSV o Excel | cualquier miembro, también un lector (es lo mismo que ya ve en Documentos emitidos) |

Ver [acceso por tabla](../03-api-reference/acceso-por-tabla.md).

## Consulta de control y criterio de aceptación

El criterio (PLAN-SAAS Fase 9):

> Las cifras del tablero cuadran con una consulta SQL de control sobre `documentos`
> aceptados.

`supabase/verificaciones/fase9-tablero-control.sql` calcula las cifras **directo desde
`documentos`**, no desde `v_ventas_diarias` (que es lo que lee la app), con las mismas reglas
que el Tablero: período por `fecha_emision`, sin el set de pruebas, ventas de `aceptado` y
`aceptado_con_reparos`, documentos emitidos con folio y sin borradores ni anulados, y
«esperando al SII» = `enviado`. Es de **solo lectura** (un `select` con CTE; no crea objetos).

**Cómo correrla:**

1. Ajustar el primer CTE (`parametros`): slug de la organización, RUT de la empresa como se
   guarda (`20630500-2`, sin puntos), ambiente y período.
2. Ejecutar el archivo completo en el SQL Editor o con el MCP `execute_sql` (o `supabase db
   query --read-only -f`).
3. Sale una fila por cifra (`orden`, `cifra` con el texto del Tablero, `valor` en pesos sin
   formato o como conteo): Ventas netas, IVA débito, Exento, Total, Boletas aceptadas,
   Documentos emitidos y su desglose (aceptados, con reparos, rechazados, enviados, por
   verificar, firmados), Anulados, Esperando al SII y «Empresas que calzan con los
   parámetros». Si esta última da 0, los parámetros no calzan con ninguna empresa y todo lo
   demás sale 0.
4. Abrir el Tablero con la misma empresa, ambiente y período
   (`/<slug>/tablero?empresa=<id>&ambiente=…&periodo=…`) y comparar: Ventas netas, IVA
   débito, el exento («Más $ X exentos», si hay), el conteo bajo Ventas netas, Documentos
   emitidos con su detalle y anulados, y Esperando al SII. «Total» no está en el Tablero:
   sirve para comparar con la fila «Total» del resumen diario exportado.

**Resultado en producción (2026-11-17, solo lectura):** organización `servicio`, empresa
20.630.500-2, certificación, noviembre de 2026:

| Cifra | Valor |
|---|---|
| Ventas netas | $ 2.000 |
| IVA débito | $ 380 |
| Exento | $ 0 |
| Total | $ 2.380 |
| Boletas aceptadas | 2 |
| Esperando al SII | 0 |

Son las dos boletas de $ 1.190 de las Fases 7 y 8 (folios 41 y 42), las dos aceptadas.

**Criterio cumplido (2026-11-17, deploy `f5f8927`).** Con la sesión del propietario,
`/servicio/tablero?ambiente=certificacion&periodo=2026-11` mostró ventas netas $ 2.000, IVA
débito $ 380, Documentos emitidos 2 («2 aceptados · 0 con reparos · 0 rechazados») y
Esperando al SII 0. La consulta, corrida otra vez en ese momento, dio lo mismo (además 0
anulados y 0 enviados). Sin errores de consola ni de runtime en Vercel.

**Descargas con sesión** (con `fetch` desde la página, sin guardar archivos): las cuatro del
Tablero y las dos de Documentos emitidos respondieron 200, con `attachment`, el nombre
`boletas-20630500-2-certificacion-2026-11.csv|xlsx` o `resumen-diario-…` y `no-store`. El CSV
trae BOM, `;` y CRLF, con los folios 41 y 42 y sus Track ID; la fila «Total» del resumen da
`Total;;2;;;2000;0;380;2380`. Los XLSX tienen sus 6 partes, la hoja parsea y las fechas son
series de Excel (46342 = 16-11-2026). En producción, sin boletas, el resumen sale de
`v_ventas_diarias` con «Total» en 0. Los errores responden con su código y texto: empresa
ajena 404, resumen con `periodo=todos` 400, reporte o formato inválido 400. El usuario abrió
en Excel el de boletas del período (las 12 columnas con sus datos) y el del resumen diario
por tipo, y los dos se ven bien.

## Cómo se probó

Sin red ni base: Vitest con dobles del cliente de Supabase. En `server/tablero/lectura.test.ts`
la vista `v_ventas_diarias` se arma desde los documentos del doble con su misma regla
(aceptados y con reparos, sin mirar el origen), así que la prueba de que el Tablero resta el
set es real. Corrida local del 2026-11-17, después de corregir la revisión: typecheck,
Vitest de la app **1149** (+1 omitida), Biome, stylelint y `pnpm build` en verde. Una
revisión de código encontró 5 hallazgos, todos corregidos: el resumen de producción sale de
la vista, el medidor usa los mismos números que la alerta (`medidorFoliosTablero`), la lectura pagina por *keyset* y da 413 si el tope
se supera durante la lectura, una `empresa` ajena da 404 y «Documentos emitidos» no cuenta
los anulados.

| Archivo | Qué cubre |
|---|---|
| `server/tablero/cifras.test.ts` | `medidorFoliosTablero` (un CAF: rango real; varios: rango sintético con el total), filtros de la URL (mes en hora de Chile, «todos» → mes actual), opciones del período, `calcularVentas` (números o texto, nulos, resta del set), textos de ventas y exento, `cifrasDocumentos` (singulares, otros estados, anulados aparte), `alertasFolios` (agotado ≠ sin CAF, solo el ambiente elegido, singular y plural) |
| `server/tablero/lectura.test.ts` | `leerCifras` (suma sin el set ni lo de otra empresa, en producción no resta, una consulta que falla lanza sin datos, período inválido); `leerResumenFolios` (las cuatro tarjetas con la regla de Folios, `null` sin UUID) |
| `server/reportes/filas.test.ts` | `leerPedido`, `hrefExportar`, `nombreArchivo`, columnas y filas de los dos reportes, `agruparPorDia` y totales |
| `server/reportes/lectura.test.ts` | lotes por *keyset*, orden, filtros, Track ID por el *embed*, tope y 413 (también si se supera durante la lectura); el resumen sale de la vista en producción y, en certificación, agrupa los aceptados del mes sin el set |
| `server/reportes/csv.test.ts` | BOM, `;`, CRLF, comillas, fechas, neutralización de fórmulas (texto sí, números no) |
| `server/reportes/xlsx.test.ts` | descomprime el .xlsx y revisa partes, celdas, fechas reales, estilos, escape y caracteres inválidos, nombres de hoja |
| `app/[org]/reportes/exportar/route.test.ts` | 307 sin sesión, 404 sin membresía, con empresa ajena o sin empresas, 400, 200 con los filtros y la empresa pedida, 413, 500 sin detalles |
| `lib/reportes.test.ts` | `hrefExportacion` (orden y codificación) |

No hay e2e propio de la fase. `e2e/organizacion.spec.ts` ya comprueba que `/<slug>/tablero`
sin sesión redirige a ingresar.
