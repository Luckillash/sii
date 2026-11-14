---
title: "Códigos y enumeraciones"
description: "Tipos enum del esquema, estados del SII, tipos de DTE, P90/P91, STATUS de DTEUpload y reparos frecuentes."
keywords: [ambiente_sii, canal_sii, rol_miembro, estado_suscripcion, estado_caf, estado_solicitud_folios, tipo_descuento, estado_documento, origen_documento, proposito_envio, clasificacion_envio, tipo_observacion, etapa_certificacion, operacion_sii, resultado_operacion, estado_entrega_webhook, tipos_dte, estados_sii, EPR, REC, SOK, CRT, FOK, PRD, RSC, RFR, RCT, RCH, P90, P91, IDK, códigos de salida]
related: ["01-fundamentos/errores-y-resultados.md"]
source: ["supabase_saas_sii.sql §1 §3", "certificacion-node/docs/glosario.md"]
---

# Códigos y enumeraciones

> **Úsalo cuando:** necesitas interpretar un estado, un enum o un código.

Fuente: §1 (tipos) y §3 (catálogos) de `supabase_saas_sii.sql`. Ninguna migración posterior
(0002–0009) cambia estos enums. Los valores son exactos: no los traduzcas al compararlos.

## Catálogos

### `tipos_dte`

| `codigo` | `nombre` | `afecto_iva` |
|---|---|---|
| 39 | Boleta electrónica | sí |
| 41 | Boleta exenta electrónica | no |

### `estados_sii` (estado de un envío en el SII)

| `codigo` | Glosa | `en_proceso` | `es_rechazo` |
|---|---|---|---|
| `REC` | Recibido | sí | |
| `SOK` | Esquema validado | sí | |
| `CRT` | Carátula validada | sí | |
| `FOK` | Firma validada | sí | |
| `PRD` | En proceso | sí | |
| `EPR` | Envío procesado (mirar los conteos: puede traer rechazos o reparos) | | |
| `RSC` | Rechazado por error en el esquema | | sí |
| `RFR` | Rechazado por error en la firma | | sí |
| `RCT` | Rechazado por error en la carátula | | sí |
| `RCH` | Rechazado | | sí |

## Enums del SII y la librería

| Enum | Valores | Notas |
|---|---|---|
| `ambiente_sii` | `certificacion`, `produccion` | Certificación: maullin / apicert / pangal, IDK 100. Producción: palena / api / rahue, IDK 300 |
| `canal_sii` | `rest`, `soap` | API REST de boleta o DTEWS (SOAP) |
| `operacion_sii` | `autenticar`, `obtener_token`, `postular`, `descargar_set`, `solicitar_folios`, `enviar_set`, `estado_envio`, `solicitar_revision`, `verificar_portal`, `estado_declaracion`, `declarar`, `enviar_rcof`, `emitir`, `consultar_envio`, `seguimiento` | Una por comando de la CLI que sale al SII. Efecto global (bloqueo por `incierto`): `solicitar_folios`, `postular`, `declarar` |
| `resultado_operacion` | `en_curso`, `ok`, `error`, `uso`, `config`, `transporte`, `rechazo_sii`, `incierto`, `verificacion_fallida` | Equivale a los códigos de salida de la CLI (abajo) |
| `etapa_certificacion` | `borrador`, `postulada`, `set_descargado`, `set_enviado`, `set_aceptado`, `revision_solicitada`, `por_declarar` (P90), `autorizada` (P91) | Solo la cambia el sistema (`tg_proteger_proceso`) |
| `estado_solicitud_folios` | `en_curso`, `simulada`, `timbrada`, `incierta`, `rechazada`, `error` | `simulada` = ensayo; `incierta` = salió la orden de timbrar y no llegó el CAF: **no reintentar**, bajarlo desde «Folios ya autorizados» |
| `estado_caf` | `activo`, `agotado`, `anulado` | `asignar_folio` marca `agotado` |
| `proposito_envio` | `emision`, `set_pruebas`, `rcof` | |
| `clasificacion_envio` | `pendiente`, `incierto`, `en_proceso`, `aceptado`, `aceptado_con_reparos`, `rechazado`, `inconsistente` | Como `sii produccion seguimiento` (`clasificar_envio`): en proceso = REC/SOK/CRT/FOK/PRD; EPR limpio = `aceptado`; EPR con rechazos o RSC/RFR/RCT/RCH = `rechazado`; EPR con conteos que no cuadran = `inconsistente` |
| `tipo_observacion` | `rechazo`, `reparo` | Filas de `envio_rechazos` |

## Enums de documentos

| Enum | Valores | Notas |
|---|---|---|
| `estado_documento` | `borrador`, `firmado`, `enviado`, `incierto`, `aceptado`, `aceptado_con_reparos`, `rechazado`, `anulado` | `borrador` sin folio (lo edita el emisor); `firmado` con folio y TED, sin enviar; `incierto` = el envío no devolvió Track ID; `anulado` = folio anulado. En la UI, `incierto` es «Por verificar» (D3) |
| `origen_documento` | `panel`, `api`, `cli`, `set_pruebas` | |
| `tipo_descuento` | `monto`, `porcentaje` | |

## Enums del SaaS

| Enum | Valores | Notas |
|---|---|---|
| `rol_miembro` | `propietario`, `administrador`, `emisor`, `lector` | `es_admin` = propietario o administrador; `puede_emitir` = esos más emisor |
| `estado_suscripcion` | `prueba`, `activa`, `morosa`, `cancelada` | `plan_vigente()` solo considera `prueba` y `activa` |
| `estado_entrega_webhook` | `pendiente`, `entregado`, `fallido`, `descartado` | Fase 11 |

## Códigos de salida de la CLI ↔ `resultado_operacion`

| Código | `resultado_operacion` | Significado | ¿Reintentar? |
|---|---|---|---|
| 0 | `ok` | Éxito | — |
| 1 | `error` | Error no clasificado | Revisar |
| 2 | `uso` | Uso incorrecto; nada salió al SII | Corregir |
| 3 | `config` | Configuración inválida; nada salió al SII | Corregir |
| 4 | `transporte` | Red/HTTP | Sí |
| 5 | `rechazo_sii` | El SII rechazó | No sin corregir |
| 6 | `incierto` | No se sabe si se aplicó | **No**: revisar el SII antes |
| 7 | `verificacion_fallida` | Verificación fallida | Revisar |

`en_curso` es el estado de la fila mientras la operación corre. Traducción de errores y
mensajes en [errores y resultados](../01-fundamentos/errores-y-resultados.md).

## Respuestas del SII

Fuente: `packages/certificacion/docs/solucion-de-problemas.md`, `canales.md` y `glosario.md`.

### `STATUS` de DTEUpload (subida SOAP)

Sin Track ID numérico, `ClienteDtews.enviarDte` lanza `ErrorRespuestaSii` con el `STATUS` en
`estado` (→ `rechazo_sii`). No se reintenta sola.

| `STATUS` | Significado | Qué hacer |
|---|---|---|
| 0 | OK (trae Track ID) | — |
| 1 / 6 | El titular no puede enviar por la empresa, o la empresa no está autorizada | Revisar los permisos del titular en el SII |
| 5 | No autenticado: token inválido o vencido | Borrar el token del caché (`olvidarToken`) y pedir otro |
| 7 | Esquema inválido | No convertir el XML después de armarlo; validar contra los XSD |
| 8 | Firma del documento inválida | Ídem |

### Otras respuestas de consulta

| Respuesta | Causa | Qué hacer |
|---|---|---|
| `ESTADO -11` sin glosa (SOAP, `QueryEstUp`) | El envío se subió por REST, o por DTEUpload hace muy poco | Consultar por el canal con que se subió, o esperar unos minutos |
| «No existe recurso» (REST) | El Track ID es de un envío por DTEUpload | Consultar por SOAP |
| HTTP 503 en maullin | Saturado o en mantención | Reintentar más tarde (`transporte`) |
| `RPR` | Aceptado con reparos; `QueryEstUp` no trae el detalle (llega por correo y al portal) | **No está en el catálogo `estados_sii`** de la `0001`: tenerlo en cuenta en la Fase 8 |

### Reparos y rechazos conocidos

La librería ya los evita; si reaparecen, alguien alteró el XML después de armarlo.

| Código | Causa | Cómo se evita |
|---|---|---|
| Reparo **260** «Monto Total No Cuadra con Parciales» | Descuento global en `<DscRcgGlobal>` | El descuento se reparte en las líneas afectas; los exentos van con `exento: true` |
| Reparo **510** «Firma Timbre Electrónico Incorrecta» | `<DD>` firmado con espacios entre etiquetas | `Timbre` aplana el `<DD>` ([firma y timbre](../01-fundamentos/firma-y-timbre.md)) |
| **RFR** con tildes en la razón social | TED firmado sobre UTF-8 | Firma sobre ISO-8859-1 |
| Reparo **TED-1-646** | `FA` del CAF con la fecha de mañana (servidor en UTC de noche) | La solicitud de folios envía `FECHA` en hora de Chile |
| Firma inválida con tildes o eñes | XML reconvertido a ISO-8859-1 cuando ya lo estaba | Guardar y enviar el `Buffer` tal cual |
| Set rechazado | Giro abreviado, datos del emisor distintos a los del SII, o set de otra empresa | Giro y razón social exactos del SII; el set propio |

### Errores de folios

| Error | Código CLI | Qué hacer |
|---|---|---|
| `SesionCaducaError` | — | La sesión venció antes de timbrar: autenticar y reintentar (no se gastaron folios) |
| `FolioInicialRequeridoError` | 3 (`rechazo_sii` en la app) | Primer timbraje del tipo en el ambiente: repetir con folio inicial |
| `FoliosSinCafError` | 6 (`incierto`) | **No reintentar**: bajar el CAF desde «Folios ya autorizados» |
