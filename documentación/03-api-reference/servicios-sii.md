---
title: "Servicios del SII que usa el backend"
description: "Endpoints REST, SOAP, AUT2000, asistentes y portal GWT, con el método de la librería y la operación de auditoría; cómo los llama la capa SII."
keywords: [servicios del SII, REST, SOAP, DTEWS, AUT2000, asistente, portal, ClienteBoletaRest, ClienteDtews, SolicitudFolios, PostulacionSii, TokenStore, SesionSii, operacion_sii, canal_sii, ejecutarOperacion, conBloqueoCertificado, conSesionReutilizada, crearTransporte]
related: ["01-fundamentos/ambientes-y-credenciales.md", "01-fundamentos/autenticacion-sii.md", "09-libreria/backend-service-role.md", "09-libreria/mapeo-libreria-tablas.md", "04-objetos/objetos-auditoria-e-integraciones.md"]
source: ["certificacion-node/docs/canales.md", "certificacion-node/docs/folios.md", "certificacion-node/docs/postulacion.md", "apps/web/src/server/sii/"]
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

<!-- TODO (Fases 5–8): endpoint por endpoint (método HTTP, ruta, método de la librería, operacion_sii, si es repetible 🔁 o ⚠️, errores que lanza). -->
