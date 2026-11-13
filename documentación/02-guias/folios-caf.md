---
title: "Folios: solicitar CAF, asignar folios y anular"
description: "Solicitud de CAF, registro en cafs, asignar_folio y folios anulados. Hoy cubre lo de la Fase 5: los folios de certificación del set de pruebas y registrar_caf."
keywords: [folios, CAF, solicitarFoliosSet, SolicitudFolios, solicitar_folios, registrar_caf, Vault, RSASK, cafs, solicitudes_folios, en_curso, timbrada, incierta, rechazada, error, simulada, FolioInicialRequeridoError, folio inicial, FoliosSinCafError, representante electrónico, IDK 100, asignar_folio, folios_anulados, leerDatosCaf, Folios ya autorizados]
related: ["04-objetos/objetos-folios.md", "03-api-reference/rpc-backend.md", "05-pruebas/set-de-pruebas.md", "02-guias/certificacion-empresa.md", "01-fundamentos/errores-y-resultados.md"]
source: ["supabase_saas_sii.sql §7", "certificacion-node/docs/folios.md", "supabase/migrations/0008_certificacion.sql", "apps/web/src/server/certificacion/folios.ts", "apps/web/src/server/certificacion/envio-set.ts"]
---

# Folios: solicitar CAF, asignar folios y anular

> **Úsalo cuando:** necesitas pedir un CAF o dar folio a una boleta.

<!-- TODO (Fase 6): pantalla de folios, solicitud de CAF de producción, carga manual de un CAF, alertas de folios bajos, anulación desde el panel y el resto de asignar_folio. -->

Esta guía todavía no está completa: la **Fase 6** agrega la gestión de folios de la
organización (producción, carga manual, anulación). Lo que existe hoy es lo de la
**Fase 5**: los folios de certificación que pide el asistente para el set de pruebas.

## Folios del set de pruebas (Fase 5)

`solicitarFoliosSet(ctx, { confirmada, folioInicial? })` de
`apps/web/src/server/certificacion/folios.ts`, desde el paso 3 del asistente
([guía](certificacion-empresa.md)). Paridad con `sii certificacion solicitar-folios`.

| Dato | Valor |
|---|---|
| Ambiente | `certificacion` (maullin, IDK 100): los folios sirven solo para el set, no en producción |
| Tipo | 39 (boleta electrónica) |
| Cantidad | número de casos guardados del set; 5 si todavía no se descarga |
| Certificado | de un **representante electrónico** (`certificadoDeEmpresa({ representante: true })`; si el predeterminado no lo es, elige otro representante vigente) |
| Sesión | AUT2000 con `SolicitudFolios.autenticar`, bajo `conBloqueoCertificado` + `conSesionReutilizada` |
| Operación | `solicitar_folios`, ⚠️ y de efecto global: un `incierto` sin revisar la bloquea, y no puede haber dos confirmadas en curso (índice único de la 0007) |

### Ensayo y confirmación

- **Ensayo** (`confirmada: false`): valida empresa, proceso, folio inicial y certificado
  de representante, y devuelve el resumen (tipo, cantidad, folio inicial si se informó,
  folios disponibles hoy). **No sale al SII ni escribe nada**, tampoco una solicitud
  `simulada` (la CLI sin `--confirmar` recorre el asistente del SII hasta antes de
  timbrar; la app no sale a la red en un ensayo). Si los folios disponibles ya alcanzan,
  el primer aviso lo dice.
- **Confirmada**, dentro de `ejecutarOperacion`:
  1. inserta la fila de `solicitudes_folios` (`estado = 'en_curso'`, `confirmada = true`,
     `cantidad`, `folio_inicial`, `certificado_id`, `solicitado_por`) y la enlaza a la
     operación (`operaciones_sii.solicitud_id`);
  2. `SolicitudFolios.solicitar(sesion, rut, 39, cantidad, { folioInicial })`, que
     devuelve el CAF ya validado por la librería (IDK, RUT y tipo);
  3. lee el `<DA>` del CAF (`leerDatosCaf`: `RE`, `RS`, `TD`, `RNG D/H`, `FA`, `IDK`;
     nunca la llave) y llama a `registrar_caf` con el XML completo como texto
     ([contrato](../03-api-reference/rpc-backend.md#registrar_caf-migración-0008)): Vault +
     fila de `cafs` + solicitud `timbrada` con el rango y el `caf_id`, en una transacción.
     La migración `0008` que la trae está **aplicada desde el 2026-11-13**
     ([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0008)).

### Cómo termina la solicitud

| Qué pasó | `solicitudes_folios` | Operación | Qué ve el usuario |
|---|---|---|---|
| CAF guardado | `timbrada` (lo deja `registrar_caf`) | `ok` | «El SII timbró los folios. Guardamos el CAF de boleta con los folios D a H…» |
| `FolioInicialRequeridoError` (primer timbraje del tipo) | `rechazada` | `rechazo_sii` | el mensaje de la librería y el campo «Folio inicial» con el valor sugerido (`requiere.folioInicial.sugerido`); no se timbró nada |
| `ErrorSolicitudFolios` | `rechazada`, `mensaje` saneado | `rechazo_sii` | el mensaje de la librería |
| `FoliosSinCafError` (la orden de timbrar salió y no llegó el CAF) | `incierta` con `folio_desde`/`folio_hasta` | `incierto` | no volver a pedir: revisar «Folios ya autorizados» en el SII |
| Red u otro error antes de timbrar | `error` | `transporte` / `error` | el mensaje correspondiente |
| **El CAF se timbró pero no se pudo guardar** (lectura del `<DA>`, `registrar_caf`, base) | `incierta` | `incierto` | «Se timbraron los folios, pero no pudimos guardar el CAF. No los vuelvas a pedir: baja el CAF desde «Folios ya autorizados» en el portal del SII y escríbenos a soporte para cargarlo.» |

Si cerrar la solicitud falla, queda un aviso en consola (solo el código) y la operación
sigue: la fila puede quedar `en_curso`. El XML del CAF nunca va a `mensaje`, a
`operaciones_sii` ni a los logs.

### Uso de los folios: `asignar_folio` y anulación

`enviarSet` toma un folio por caso con `asignar_folio(empresa, 'certificacion', 39)`
(el CAF activo de `folio_desde` más bajo con folios libres, con `for update`) y lee el
XML del CAF de Vault con `leer_secreto` para timbrar. Si el envío no alcanza a salir al
SII, o el SII lo rechaza sin Track ID, los folios asignados van a `folios_anulados` con el
motivo y los documentos quedan `anulado`. Si la subida falla por red después de salir,
**no** se anulan (el SII pudo haberlos recibido). Detalle en
[set de pruebas](../05-pruebas/set-de-pruebas.md#5-armado-y-envío-por-rest-enviarset).

Los folios disponibles que muestra el asistente suman todos los CAF 39 de certificación
`activo` de la empresa (`folio_hasta - siguiente_folio + 1`); el rango que se muestra es
el del CAF que se usa primero.
