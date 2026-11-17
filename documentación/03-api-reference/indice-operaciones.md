---
title: "Índice de operaciones"
description: "Todas las funciones RPC, vistas y servicios del SII, con quién puede llamarlos."
keywords: [índice, operaciones, asistente de certificación, server/certificacion, Server Actions, postular, descargarSet, solicitarFoliosSet, enviarSet, consultarEstadoSet, solicitarRevision, consultarEstadoDeclaracion, declarar, marcarRevisada, leerAsistente, guardarDatosPostulacion, guardarDatosDeclaracion, registrar_caf, guardar_set_pruebas, folios, server/folios, leerFolios, solicitarFolios, subirCaf, anularFolios, puedeEmitir, alertaDespuesDeAsignar, alertarSiCruza, anular_folios, encolar_evento, folios.por_agotarse, migración 0011, emisión, server/emision, emitirDocumento, emitir, guardarBorrador, borrarBorrador, leerVistaEmision, buscarReceptores, buscarProductos, enlaceDocumento, ResultadoEmision, Fase 8, seguimiento, ejecutarSeguimiento, consultarEnvio, consultarEstado, consultar_envio, ejecutarAlertas, marcarEnvioRevisado, marcarRevisado, reenviarAlReceptor, enlaceArchivo, listarDocumentos, leerEnvio, enviosInciertos, reclamar_notificacion, /api/cron/seguimiento, /api/cron/alertas]
related: ["03-api-reference/acceso-por-tabla.md", "03-api-reference/servicios-sii.md", "02-guias/certificacion-empresa.md", "02-guias/folios-caf.md", "02-guias/emision-boletas.md", "02-guias/seguimiento-envios.md", "03-api-reference/rpc-backend.md"]
source: ["apps/web/src/server/seguimiento/index.ts", "apps/web/src/server/documentos/index.ts", "apps/web/src/server/alertas/index.ts", "apps/web/src/app/[org]/documentos/acciones.ts", "apps/web/src/app/api/cron/", "apps/web/src/server/emision/index.ts", "apps/web/src/app/[org]/emitir/acciones.ts", "supabase_saas_sii.sql §15 §16 §17", "apps/web/src/server/certificacion/index.ts", "apps/web/src/app/[org]/certificacion/acciones.ts", "supabase/migrations/0008_certificacion.sql", "apps/web/src/server/folios/index.ts", "apps/web/src/app/[org]/folios/acciones.ts", "supabase/migrations/0011_folios.sql"]
---

# Índice de operaciones

> **Úsalo cuando:** buscas una operación por su función.

<!-- TODO: índice completo de RPC, vistas y servicios (Fases 2–4 y 8 en adelante). -->

## Seguimiento de envíos y documentos (Fase 8)

El seguimiento vive en `apps/web/src/server/seguimiento/` (API en `index.ts`); la lectura y
las acciones del panel en `apps/web/src/server/documentos/`; las alertas en
`apps/web/src/server/alertas/`. Las Server Actions están en
`apps/web/src/app/[org]/documentos/acciones.ts` (las usa también `/[org]/envios/[id]`) y
exigen membresía; las que marcan o envían algo, además `puedeEmitir`. Detalle en
[seguimiento de envíos](../02-guias/seguimiento-envios.md). Código **desplegado**
(`3ade4c9`, 2026-11-17); migraciones `0013_notificaciones` y `0014_cron` **aplicadas**
(2026-11-17, la 0014 después del deploy), con el cron corriendo en producción.

| Función | Quién la llama | Sale al SII | `operacion_sii` | Escribe |
|---|---|---|---|---|
| `ejecutarSeguimiento()` | `POST`/`GET /api/cron/seguimiento` (Bearer `CRON_SECRET`; `pg_cron` cada 5 min con la 0014) | 🔁 (token y estado, REST o SOAP) | `seguimiento`, una por organización + empresa + ambiente + canal, `usuario_id` nulo | service_role: `envio_estadisticas`, `envio_rechazos`, `envios` (los triggers sincronizan `documentos` y encolan `envio.actualizado` y `documento.*`), `consultas_envio`; cierra las `seguimiento`/`consultar_envio` abandonadas |
| `consultarEnvio(ctx)` | Server Action `consultarEstado(slug, envioId)`, cualquier miembro | 🔁, salvo incierto, sin Track ID, final o consultado hace menos de 30 s | `consultar_envio`, con `envio_id` y `usuario_id` | lo mismo que el cron, para un envío |
| `ejecutarAlertas()` | `POST`/`GET /api/cron/alertas` (Bearer; `pg_cron` cada 10 min con la 0014) | no | — | `notificaciones` (`reclamar_notificacion` 🔒 y `update` con service_role) y correos por Resend |
| `listarDocumentos`, `leerDetalleDocumento`, `leerEnvio`, `ambientePorDefecto`, `enviosInciertos` | `page.tsx` de `/documentos`, `/envios/[id]` y el Tablero | no | — | nada (sesión, RLS) |
| `marcarEnvioRevisado(ctx, envioId)` | Server Action `marcarRevisado` («Ya lo revisé»), `puedeEmitir` | no | — | `operaciones_sii.detalle.revisada_en` de las operaciones inciertas del envío (vía `marcarInciertaRevisada`, service_role) |
| `reenviarAlReceptor(ctx, documentoId)` | Server Action `reenviarAlReceptor`, `puedeEmitir` | no | — | correo por Resend y `documentos.metadata.correo` (service_role) |
| `enlaceDocumento(ctx, documentoId, archivo)` de `server/emision` | Server Action `enlaceArchivo` | no | — | lo de la Fase 7 (URL firmada; regenera un PDF que falte) |

`consultarEstado` devuelve `ResultadoConsultaEnvio` (`@/lib/seguimiento`: `consultado`,
`sin_track_id`, `final` o `error`); `marcarRevisado` y `reenviarAlReceptor`, `{ ok,
mensaje }`. RPC de la fase (migración 0013, solo `service_role`):
[`reclamar_notificacion`, `notificacion_cerrada` y las tres de candidatos](rpc-backend.md#notificaciones-migración-0013).

## Emisión de boletas (Fase 7)

Todo vive en `apps/web/src/server/emision/` (API en `index.ts`) y se llama desde las
Server Actions de `apps/web/src/app/[org]/emitir/acciones.ts`, que exigen membresía, rol
**propietario, administrador o emisor** (`puedeEmitir`) y que la empresa sea de la
organización, y validan con `esquemaBorrador`. Un lector ve solo el aviso. Detalle en
[emisión de boletas](../02-guias/emision-boletas.md). Desplegado (`4cb6e9f`); sin migración
nueva (usa la 0001 y la 0012).

| Función de la API | Server Action | Sale al SII | `operacion_sii` | Escribe |
|---|---|---|---|---|
| `leerVistaEmision(ctx, { borradorId? })` | (la usa `page.tsx`) | no | — | nada (sesión, RLS; `plan_vigente` con service_role) |
| `emitirDocumento(ctx, { nivel: 'ensayo', borrador, borradorId? })` | `emitir` | no | — | nada (sin folio ni filas) |
| `emitirDocumento(ctx, { nivel: 'emitir', borrador, borradorId? })` | `emitir` | ⚠️ (usa un folio; REST `apicert`/`api` y `pangal`/`rahue`) | `emitir`, `canal = 'rest'`, `confirmada = true`, con `documento_id` y `envio_id` | sesión: `documentos` (borrador), `documento_detalles`, `receptores`; service_role: `asignar_folio` 🔒, `leer_secreto` 🔒, Storage (DTE y sobre), `envios`, `documentos` (`firmado` → `enviado`); si falla, `folios_anulados` y `envios.error` o `envios.incierto`; después, PDF a Storage, `documentos.metadata` y correo |
| `guardarBorrador(ctx, borrador, borradorId?)` | `guardarBorrador` | no | — | sesión (RLS): `documentos` (`borrador`), `documento_detalles`, `receptores` |
| `borrarBorrador(ctx, borradorId)` | `borrarBorrador` | no | — | sesión: `delete` de un documento `borrador` |
| `buscarReceptores(ctx, texto)` / `buscarProductos(ctx, texto)` | `buscarReceptores` / `buscarProductos` (desde 2 letras) | no | — | nada (sesión, `ilike` saneado, hasta 8) |
| `enlaceDocumento(ctx, documentoId, 'xml' \| 'pdf_carta' \| 'pdf_rollo')` | `enlaceDocumento` | no | — | nada, salvo un PDF que falte: lo regenera, lo sube y guarda la ruta en `metadata.pdf` (service_role); devuelve una URL firmada de 60 s |

`ctx` es `ContextoEmision` (`organizacionId`, `empresaId`, `usuarioId`). Las acciones de
emisión y borrador devuelven `ResultadoEmision` (`@/lib/emision`). Estados por camino en la
[guía](../02-guias/emision-boletas.md#cómo-termina-una-emisión).

## Folios (Fase 6)

Todo vive en `apps/web/src/server/folios/` (API en `index.ts`) y se llama desde las Server
Actions de `apps/web/src/app/[org]/folios/acciones.ts`, que exigen membresía, rol
**propietario o administrador** (`puedeAdministrar`) y que la empresa sea de la
organización. Lector y emisor ven la página. Detalle en
[folios](../02-guias/folios-caf.md).

| Función de la API | Server Action | Sale al SII | `operacion_sii` | Escribe |
|---|---|---|---|---|
| `leerFolios(organizacionId, empresaId)` | (la usa `page.tsx`) | no | — | nada (cliente de sesión, RLS) |
| `solicitarFolios(ctx, { nivel: 'ensayo', … })` | `solicitarFolios` | no | — | nada |
| `solicitarFolios(ctx, { nivel: 'revision', … })` | `solicitarFolios` | sí, sin timbrar (corta `of_genera_folio`) | `solicitar_folios`, `confirmada = false` | `solicitudes_folios` (`simulada`) |
| `solicitarFolios(ctx, { nivel: 'timbrar', …, revisionId? })` | `solicitarFolios` | ⚠️ (efecto global, timbra) | `solicitar_folios`, `confirmada = true` | `solicitudes_folios` + `registrar_caf` 🔒 (Vault + `cafs`) |
| `subirCaf(ctx, { ambiente, contenido })` | `subirCaf` (`FormData`) | no | — | `registrar_caf` 🔒 (Vault + `cafs`; resuelve una `incierta` que calce) y `operaciones_sii.detalle.revisada_en` de su operación |
| `anularFolios(ctx, { cafId, desde, hasta, motivo })` | `anularFolios` | no | — | `anular_folios` (migración 0011, **aplicada el 2026-11-15**; cliente de sesión): `folios_anulados` y, si es la cola, el CAF `anulado`; después la alerta |
| `marcarRevisada(ctx, operacionId)` de `server/certificacion` | `marcarRevisada` | no | — | `operaciones_sii.detalle.revisada_en` (vía `marcarInciertaRevisada`) |
| `puedeEmitir(cliente, clave)` | (ninguna; la emisión de la Fase 7 no la usa: valida con `foliosDisponibles` y la vista con `leerCafs` + `disponibilidadDe`) | no | — | nada (service_role) |
| `alertaDespuesDeAsignar(deps, cliente, clave, asignado)` / `alertarSiCruza(…)` | (`emitirDocumento` después de un `ok` / interna) | no | — | `encolar_evento` 🔒 (`folios.por_agotarse`) y correo por Resend |

`ctx` es `ContextoFolios` (`organizacionId`, `empresaId`, `usuarioId`). Todas las acciones
devuelven `ResultadoFolios` (`@/lib/folios`). RPC de la fase:
[`anular_folios`](rpc-backend.md#anular_folios-migración-0011) (también `authenticated`
administrador) y el trigger
[`trg_20_caf_sin_traslape`](rpc-backend.md#trg_20_caf_sin_traslape-migración-0011), los dos
de la migración `0011`, **aplicada el 2026-11-15**.

## Certificación ante el SII (Fase 5)

Todo vive en `apps/web/src/server/certificacion/` (API en `index.ts`) y se llama desde las
Server Actions de `apps/web/src/app/[org]/certificacion/acciones.ts`, que exigen membresía
y rol **propietario o administrador** (`puedeAdministrar`) antes de llamar. Un lector o un
emisor ve la página (`leerAsistente`) pero no las acciones. Detalle en
[certificación de la empresa](../02-guias/certificacion-empresa.md).

| Función de la API | Server Action | Sale al SII | Ensayo | `operacion_sii` | Escribe |
|---|---|---|---|---|---|
| `leerAsistente(organizacionId, empresaId)` | (la usa `page.tsx`) | no | — | — | nada (cliente de sesión, RLS) |
| `guardarDatosPostulacion(ctx, datos)` | `guardarPostulacion` | no | — | — | `procesos_certificacion` con el cliente de sesión (crea la fila si no existe) |
| `guardarDatosDeclaracion(ctx, datos)` | `guardarDeclaracion` | no | — | — | `procesos_certificacion` con el cliente de sesión |
| `postular(ctx, { confirmada })` | `postular` | ⚠️ | sí | `verificar_portal` + `postular` | proceso (`postulada`), `resoluciones` (si falta) |
| `descargarSet(ctx, { confirmada, correoProveedorSet? })` | `descargarSet` | ⚠️ | sí | `descargar_set` | proceso (estado SII) + `guardar_set_pruebas` 🔒 |
| `solicitarFoliosSet(ctx, { confirmada, folioInicial? })` | `solicitarFolios` | ⚠️ | sí | `solicitar_folios` | `solicitudes_folios` + `registrar_caf` 🔒 (Vault + `cafs`) |
| `enviarSet(ctx, { confirmada })` | `enviarSet` | ⚠️ | sí | `enviar_set` | `asignar_folio` 🔒, Storage, `envios`, `documentos`, `documento_detalles`, `set_pruebas_casos`, proceso (`set_enviado`); o `folios_anulados` |
| `consultarEstadoSet(ctx)` | `consultarEstadoSet` | 🔁 | no | `estado_envio` | `envios`, `envio_estadisticas`, `envio_rechazos`, `consultas_envio`, proceso (`set_aceptado`) |
| `solicitarRevision(ctx, { confirmada })` | `solicitarRevision` | ⚠️ | sí | `solicitar_revision` | proceso (`revision_solicitada`) |
| `consultarEstadoDeclaracion(ctx)` | `consultarEstadoDeclaracion` | 🔁 | no | `estado_declaracion` | proceso (código, glosa, paso; el trigger mueve P90/P91); si no existe, lo crea en `borrador` (service_role) tras la respuesta del SII. Disponible desde `borrador` |
| `declarar(ctx, { confirmada })` | `declarar` | ⚠️ | sí | `verificar_portal` + `declarar` | proceso (`declarada_en`, estado SII) |
| `marcarRevisada(ctx, operacionId)` | `marcarRevisada` | no | — | — | `operaciones_sii.detalle.revisada_en` (vía `marcarInciertaRevisada`) |
| `verificarAutorizacion(ctx)` (`server/certificacion/autorizacion.ts`; probada en *Production* el 2026-11-14) | `verificarAutorizacion` | 🔁 (producción) | no | `verificar_autorizacion` (migración 0010) | si el SII la da por autorizada: `resoluciones` de producción (el trigger de la 0009 marca la empresa) y `empresas.autorizada_en` con la fecha del SII (service_role); si no, nada ([guía](../02-guias/certificacion-empresa.md#verificar-la-autorización-en-el-sii)) |

`ctx` es `ContextoCertificacion` (`organizacionId`, `empresaId`, `usuarioId`), armado por la
Server Action desde la membresía verificada. Todas devuelven `ResultadoPaso`
(`@/lib/certificacion`): `ensayo` con el resumen, `ok` con el mensaje y los avisos, o
`error` con el mensaje y, según el caso, `resultado`, `motivo`, `operacionPendienteId`,
`errores` por campo o `requiere.folioInicial`.

Las seis acciones ⚠️ se niegan con la empresa ya autorizada en producción (por P91 o por
su resolución de producción, migración 0009), en el ensayo y en la confirmada, antes de
salir al SII y sin fila en `operaciones_sii`: `error` con `motivo: 'empresa_autorizada'`
([guía](../02-guias/certificacion-empresa.md#empresa-autorizada-fuera-de-boletéame)).

RPC nuevas de la fase (migración `0008`, aplicada el 2026-11-13), solo `service_role`:
[`registrar_caf`](rpc-backend.md#registrar_caf-migración-0008) y
[`guardar_set_pruebas`](rpc-backend.md#guardar_set_pruebas-migración-0008).
