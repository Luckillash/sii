---
title: "Índice de operaciones"
description: "Todas las funciones RPC, vistas y servicios del SII, con quién puede llamarlos."
keywords: [índice, operaciones, asistente de certificación, server/certificacion, Server Actions, postular, descargarSet, solicitarFoliosSet, enviarSet, consultarEstadoSet, solicitarRevision, consultarEstadoDeclaracion, declarar, marcarRevisada, leerAsistente, guardarDatosPostulacion, guardarDatosDeclaracion, registrar_caf, guardar_set_pruebas]
related: ["03-api-reference/acceso-por-tabla.md", "03-api-reference/servicios-sii.md", "02-guias/certificacion-empresa.md", "03-api-reference/rpc-backend.md"]
source: ["supabase_saas_sii.sql §15 §16 §17", "apps/web/src/server/certificacion/index.ts", "apps/web/src/app/[org]/certificacion/acciones.ts", "supabase/migrations/0008_certificacion.sql"]
---

# Índice de operaciones

> **Úsalo cuando:** buscas una operación por su función.

<!-- TODO: índice completo de RPC, vistas y servicios (Fases 2–4 y 6 en adelante). -->

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
