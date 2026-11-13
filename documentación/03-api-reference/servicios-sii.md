---
title: "Servicios del SII que usa el backend"
description: "Endpoints REST, SOAP, AUT2000, asistentes y portal GWT, con el método de la librería y la operación de auditoría; cómo los llama la capa SII."
keywords: [servicios del SII, REST, SOAP, DTEWS, AUT2000, asistente, portal, ClienteBoletaRest, ClienteDtews, SolicitudFolios, PostulacionSii, TokenStore, SesionSii, operacion_sii, canal_sii, ejecutarOperacion, conBloqueoCertificado, conSesionReutilizada, crearTransporte, DeclaracionBoletas, verificarPortal, descargarSetPruebas, solicitarRevisionSet, declarar, enviarBoleta, consultarEnvio, www4, FABRICAS_SII, asistente de certificación, ad_empresa, ConsultaAutorizacion, verificar_autorizacion, STC, getConsultaData, SituacionTributaria, timbrajes]
related: ["01-fundamentos/ambientes-y-credenciales.md", "01-fundamentos/autenticacion-sii.md", "09-libreria/backend-service-role.md", "09-libreria/mapeo-libreria-tablas.md", "04-objetos/objetos-auditoria-e-integraciones.md"]
source: ["certificacion-node/docs/canales.md", "certificacion-node/docs/folios.md", "certificacion-node/docs/postulacion.md", "apps/web/src/server/sii/", "apps/web/src/server/certificacion/"]
---

# Servicios del SII que usa el backend

> **Úsalo cuando:** necesitas saber qué petición hace la librería al SII y si es repetible.

Hosts por ambiente en [ambientes y credenciales](../01-fundamentos/ambientes-y-credenciales.md#ambientes).

## Cómo los llama la capa SII (Fase 4)

Toda petición al SII sale de un cliente de la librería, creado dentro de la función que se
pasa a `ejecutarOperacion()`, con un transporte por invocación
(`await using transporte = crearTransporte()`). Lo que cambia entre canales es cómo se
autentica:

| Canal | Cliente de la librería | Autenticación | Módulo de la capa | ¿Bloqueo del certificado? | `canal` en `operaciones_sii` |
|---|---|---|---|---|---|
| REST de boleta (`apicert`/`api`, `pangal`/`rahue`) | `ClienteBoletaRest` | semilla → token (`obtenerToken`) | `TokenStoreSupabase` como `tokenStore` | no | `rest` |
| SOAP DTEWS / DTEUpload (`maullin`/`palena`) | `ClienteDtews` | semilla → token | `TokenStoreSupabase` como `tokenStore` | no | `soap` |
| Asistentes del portal (folios: `cvc_cgi/dte/of_*`) | `SolicitudFolios` | sesión AUT2000 (`autenticar`, TLS mutuo) | `conSesionReutilizada` + `SesionesSupabase` | **sí**, `conBloqueoCertificado` | nulo |
| Portal de certificación (postulación, set, revisión, declaración) | `PostulacionSii` | sesión AUT2000 | `conSesionReutilizada` + `SesionesSupabase` | **sí** | nulo |

- El bloqueo existe porque el SII frena el re-login AUT2000 seguido con el mismo
  certificado (error `01.01.215.500.771.52`); el token REST/SOAP no tiene ese límite
  ([autenticación](../01-fundamentos/autenticacion-sii.md)).
- Qué operaciones graban (⚠️) y cuáles se bloquean tras un `incierto`:
  [tabla de `operacion`](../04-objetos/objetos-auditoria-e-integraciones.md#operacion-enum-operacion_sii).
- Ejemplo completo de composición en
  [contrato del backend](../09-libreria/backend-service-role.md#cómo-se-compone-una-operación).

## Asistente de certificación (Fase 5)

Lo que llama `apps/web/src/server/certificacion/`, siempre en el ambiente
`certificacion` (salvo `verificarAutorizacion`, prevista, que consulta producción). Los clientes de la librería se crean por fábrica en
`dependencias.ts` (`FABRICAS_SII`), uno por operación y con el transporte de esa
invocación. Las que usan sesión AUT2000 la abren con `PostulacionSii.autenticar` o
`SolicitudFolios.autenticar` (el mismo login; la sesión sirve para maullin y www4) dentro
de `conBloqueoCertificado` + `conSesionReutilizada` (`conSesionSii` de `comun.ts`).

| Acción de la API | Host | Método de la librería | `operacion_sii` | Tipo | Errores que importan |
|---|---|---|---|---|---|
| (antes de `postular` y `declarar`) | `www4.sii.cl` (GET público, sin login) | `DeclaracionBoletas.verificarPortal()` | `verificar_portal` (`confirmada = true`) | 🔁 | lista de problemas no vacía → la app lanza `ErrorVerificacion` → `verificacion_fallida` (7) y bloquea el paso |
| `postular` | `maullin.sii.cl` (`cvc_cgi/dte/pe_*`) | `PostulacionSii.postular(sesion, DatosPostulacion)` | `postular` | ⚠️ (efecto global) | `ErrorTransporte` antes de grabar (4); `ErrorPostulacion` (5), también una falla en el POST que graba (la orden pudo llegar; repetir es seguro según la librería) |
| `descargarSet` | `www4.sii.cl` (GWT-RPC + `DownloadFileServlet`) | `DeclaracionBoletas.estado()` y `descargarSetPruebas(sesion, rut, correo)` | `descargar_set` | ⚠️ (el SII registra la descarga) | `ErrorPostulacion` si está en P90 (la librería no descarga) o si el SII no entregó el set (5) |
| `solicitarFoliosSet` | `maullin.sii.cl` (`cvc_cgi/dte/of_*`) | `SolicitudFolios.solicitar(sesion, rut, 39, cantidad, { folioInicial? })` (certificado de representante electrónico) | `solicitar_folios` | ⚠️ (efecto global, timbra) | `FolioInicialRequeridoError` (5, sin timbrar: `requiere.folioInicial`); `FoliosSinCafError` (6); `ErrorSolicitudFolios` (5) |
| `enviarSet` | `apicert.sii.cl` (token) y `pangal.sii.cl` (subida) | `ClienteBoletaRest.obtenerToken(rut)` y `enviarBoleta(token, rut, rutEnvia, sobre)` | `enviar_set`, `canal = 'rest'` | ⚠️ (usa folios) | `ErrorTransporte` **después** de salir → la app lo vuelve `incierto` (6); otro error tras salir (rechazo sin Track ID) → folios anulados |
| `consultarEstadoSet` | `apicert.sii.cl` | `ClienteBoletaRest.obtenerToken(rut)` y `consultarEnvio(token, rut, trackId)` | `estado_envio`, `canal = 'rest'` | 🔁 (sin ensayo) | cualquiera se anota en `consultas_envio.error` (saneado) y se relanza |
| `solicitarRevision` | `www4.sii.cl` | `DeclaracionBoletas.solicitarRevisionSet(sesion, rut, trackId)` | `solicitar_revision` | ⚠️ | `SetSinDescargarError` (5): la app le agrega qué hacer (descargar un set nuevo y enviarlo) |
| `consultarEstadoDeclaracion` | `www4.sii.cl` | `DeclaracionBoletas.estado(sesion, rut)` | `estado_declaracion` | 🔁 (sin ensayo) | — |
| `declarar` | `www4.sii.cl` | `DeclaracionBoletas.declarar(sesion, DatosDeclaracion)` (solo en P90) | `declarar` | ⚠️ (efecto global; deja la empresa autorizada) | `DeclaracionInciertaError` (6): consultar el estado antes de repetir; `ErrorPostulacion` si no está en P90 (5) |
| `verificarAutorizacion` (**prevista**, sin código) | `palena.sii.cl` (`cvc_cgi/dte/ad_empresa1` → `ad_empresa2`), **producción** | `ConsultaAutorizacion.consultar(sesion, rut)` (por agregar a la librería; sesión de `SolicitudFolios.autenticar` en producción) | `verificar_autorizacion` (migración 0010, prevista), `ambiente = 'produccion'` | 🔁 (sin ensayo; nunca envía el formulario de actualización de `ad_empresa2`) | página que no reconoce o RUT distinto → verificación fallida (7). Solo responde si el titular es representante legal ([trampas](../07-referencia/trampas-conocidas.md#datos-de-la-empresa-autorizada-en-el-sii-ad_empresa-prevista)) |
| (dentro de `verificarAutorizacion`, **prevista**) | `www2.sii.cl` (`/app/stc/recurso/v1/recaptcha/key` y `/consulta/getConsultaData/`, públicos, sin login ni certificado) | `SituacionTributaria.timbrajes(rut)` (por agregar a la librería) | la misma fila `verificar_autorizacion` (`detalle.stc`) | 🔁 (solo apoyo) | captcha encendido → `{ tipo: 'captcha' }`, se omite; forma desconocida → verificación (7), que la app trata como `stc = 'no_disponible'` sin fallar la operación ([trampas](../07-referencia/trampas-conocidas.md#situación-tributaria-de-terceros-stc-fuente-de-apoyo-prevista)) |

- **Ensayo sin red.** Con `confirmada: false` ninguna de estas acciones sale al SII ni
  inserta filas en `operaciones_sii` (ni `verificar_portal`): validan datos, empresa,
  certificado, CAF y resolución en la base y devuelven el resumen. Es más estricto que la
  CLI, cuyo `solicitar-folios` sin `--confirmar` recorre el asistente del SII hasta antes
  de timbrar ([guía](../02-guias/certificacion-empresa.md#ensayo-y-confirmación)).
- **El token REST no usa el bloqueo del certificado**: `enviarSet` y `consultarEstadoSet`
  piden el token con `TokenStoreSupabase` (`tokens_sii`), sin `conBloqueoCertificado`.
- Detalle de cada acción (validaciones previas, qué escribe, mensajes) en
  [certificación de la empresa](../02-guias/certificacion-empresa.md).

<!-- TODO (Fases 6–8): endpoint por endpoint de emisión, folios de producción y seguimiento (método HTTP, ruta, método de la librería, operacion_sii, si es repetible 🔁 o ⚠️, errores que lanza). -->
