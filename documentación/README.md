---
title: "SaaS de boleta electrónica (SII) — Índice de documentación para agentes"
description: "Punto de entrada. Resume las invariantes del sistema y enruta cada tarea al archivo que hay que leer."
version_esquema: "supabase_saas_sii.sql"
generated: "2026-11-10"
sources: ["supabase_saas_sii.sql", "certificacion-node/docs/"]
---

# SaaS de boleta electrónica (SII) — Índice de documentación (orientado a agentes)

<!-- TODO: párrafo de presentación (qué es el SaaS, qué cubre esta carpeta) -->

**Nombres.** El nombre comercial del producto es **«Boletéame»** (antes «Timbre»; decisión D8 de `PLAN-SAAS.md`): es lo único que ve el usuario en la UI, los correos y el design system. Donde no cabe la tilde (namespace JS, carpetas) se escribe `boleteame`. Los servicios y paquetes de backend se llaman `sii` / `SII` (paquete raíz `sii`, `@sii/correos`). «timbre» en minúscula es el término del SII (timbre electrónico, TED), no la marca.

## Cómo usar esta carpeta (instrucciones para el agente)

1. **Lee este README primero.** La sección [Invariantes](#invariantes) suele bastar para tareas simples.
2. **Enruta según la tarea:** usa la tabla [¿Qué archivo leo?](#qué-archivo-leo) y abre **solo** los archivos necesarios.
3. **Frontmatter de cada archivo:**
   - `title` y `description`: de qué trata el archivo.
   - `keywords`: términos útiles para grep.
   - `related`: siguientes lecturas. Las rutas son **relativas a esta carpeta**.
   - `source`: sección de origen (`supabase_saas_sii.sql §N` o un documento de `certificacion-node/docs/`).
4. Bajo el título, la línea **"Úsalo cuando:"** dice si el archivo es relevante.
5. **Antes de escribir código**, revisa [`07-referencia/trampas-conocidas.md`](07-referencia/trampas-conocidas.md).
6. Búsqueda rápida: `grep -ril "<término>" .`

### Convenciones

| Marca | Significado |
|---|---|
| ✔ | Columna o parámetro obligatorio |
| 🔒 | Solo `service_role` (backend) |
| ⚠️ | Graba algo en el SII o es irreversible: no repetir a ciegas |
| 🔁 | Solo lectura, repetible |
| 🧩 | Lo implementa el backend; el esquema solo define el contrato |
| 🕰️ | Legado (RCOF, solo períodos hasta 2022-07) |

---

## Invariantes

<!-- TODO: tabla de reglas válidas para todo el sistema -->

| Tema | Regla |
|---|---|
| | |

---

## ¿Qué archivo leo?

| Si la tarea es… | Lee |
|---|---|
| Entender qué es el SaaS y qué pieza hace cada cosa | [01-fundamentos/vision-general.md](01-fundamentos/vision-general.md) |
| Ambientes, hosts del SII, certificado, roles y claves API de Supabase, sesiones y revocación | [01-fundamentos/ambientes-y-credenciales.md](01-fundamentos/ambientes-y-credenciales.md) |
| Tokens del SII o sesión AUT2000 | [01-fundamentos/autenticacion-sii.md](01-fundamentos/autenticacion-sii.md) |
| Firma XML, TED, ISO-8859-1 | [01-fundamentos/firma-y-timbre.md](01-fundamentos/firma-y-timbre.md) |
| Organizaciones, roles y permisos | [01-fundamentos/tenancy-y-roles.md](01-fundamentos/tenancy-y-roles.md) |
| Decidir si reintentar o interpretar un error | [01-fundamentos/errores-y-resultados.md](01-fundamentos/errores-y-resultados.md) |
| RUT, correo, montos, IVA, fechas | [01-fundamentos/formatos-y-validaciones.md](01-fundamentos/formatos-y-validaciones.md) |
| Recorrido mínimo ejecutable | [02-guias/quickstart.md](02-guias/quickstart.md) |
| Alta de cliente, equipo, plan, certificado | [02-guias/onboarding-organizacion.md](02-guias/onboarding-organizacion.md) |
| **Certificar una empresa ante el SII** | [02-guias/certificacion-empresa.md](02-guias/certificacion-empresa.md) |
| **Pedir CAF y asignar folios** | [02-guias/folios-caf.md](02-guias/folios-caf.md) |
| **Emitir una boleta** | [02-guias/emision-boletas.md](02-guias/emision-boletas.md) |
| **Seguir el estado de los envíos** | [02-guias/seguimiento-envios.md](02-guias/seguimiento-envios.md) |
| Secuencia resumida de un caso de uso | [02-guias/flujos-tipicos.md](02-guias/flujos-tipicos.md) |
| Buscar una RPC, vista o servicio por función | [03-api-reference/indice-operaciones.md](03-api-reference/indice-operaciones.md) |
| Contrato de una RPC | `03-api-reference/rpc-*.md` |
| Qué permite RLS en una tabla | [03-api-reference/acceso-por-tabla.md](03-api-reference/acceso-por-tabla.md) |
| Qué petición hace la librería al SII | [03-api-reference/servicios-sii.md](03-api-reference/servicios-sii.md) |
| Columnas de una tabla | `04-objetos/` (ver la tabla de objetos abajo) |
| Interpretar un estado, enum o código | [04-objetos/codigos-y-enumeraciones.md](04-objetos/codigos-y-enumeraciones.md) |
| Probar en certificación | [05-pruebas/ambiente-certificacion.md](05-pruebas/ambiente-certificacion.md) |
| Set de pruebas del SII | [05-pruebas/set-de-pruebas.md](05-pruebas/set-de-pruebas.md) |
| Probar RLS, triggers o cuotas | [05-pruebas/probar-el-esquema.md](05-pruebas/probar-el-esquema.md) |
| Integrar un sistema externo (API, webhooks) | [06-integraciones/overview.md](06-integraciones/overview.md) |
| Copiar un ejemplo de código | [07-referencia/ejemplos-de-codigo.md](07-referencia/ejemplos-de-codigo.md) |
| Dato rápido (vigencia, tope, largo) | [07-referencia/reglas-y-limites.md](07-referencia/reglas-y-limites.md) |
| Pasar una empresa a producción | [07-referencia/checklist-produccion.md](07-referencia/checklist-produccion.md) |
| Algo no funciona como se espera | [07-referencia/trampas-conocidas.md](07-referencia/trampas-conocidas.md) |
| Construir una pantalla, usar un componente o un token | [07-referencia/design-system.md](07-referencia/design-system.md) |
| **Esquema:** entender o modificar el SQL | [08-esquema-supabase/arquitectura.md](08-esquema-supabase/arquitectura.md) |
| **Esquema:** instalarlo o programar tareas | [08-esquema-supabase/despliegue.md](08-esquema-supabase/despliegue.md) |
| **Esquema:** error de la base | [08-esquema-supabase/solucion-de-problemas.md](08-esquema-supabase/solucion-de-problemas.md) |
| **Librería:** dónde guardar lo que devuelve | [09-libreria/mapeo-libreria-tablas.md](09-libreria/mapeo-libreria-tablas.md) |
| **Librería:** implementar el backend | [09-libreria/backend-service-role.md](09-libreria/backend-service-role.md) |
| **Librería:** operar con la CLI `sii` | [09-libreria/cli-sii.md](09-libreria/cli-sii.md) |

### Tabla → archivo de objetos

| Tablas | Archivo |
|---|---|
| `perfiles`, `organizaciones`, `miembros_organizacion`, `invitaciones`, `planes`, `suscripciones`, `uso_mensual` | [04-objetos/objetos-tenancy.md](04-objetos/objetos-tenancy.md) |
| `empresas`, `resoluciones`, `certificados`, `empresa_certificados`, `tokens_sii`, `sesiones_sii`, `v_certificados_estado` | [04-objetos/objetos-empresas-y-credenciales.md](04-objetos/objetos-empresas-y-credenciales.md) |
| `cafs`, `solicitudes_folios`, `folios_anulados`, `v_folios_disponibles` | [04-objetos/objetos-folios.md](04-objetos/objetos-folios.md) |
| `documentos`, `documento_detalles`, `receptores`, `productos`, `v_ventas_diarias` | [04-objetos/objetos-documentos.md](04-objetos/objetos-documentos.md) |
| `envios`, `envio_estadisticas`, `consultas_envio`, `envio_rechazos`, `rcof`, `v_envios_por_consultar` | [04-objetos/objetos-envios-y-rcof.md](04-objetos/objetos-envios-y-rcof.md) |
| `procesos_certificacion`, `set_pruebas_casos` | [04-objetos/objetos-certificacion.md](04-objetos/objetos-certificacion.md) |
| `operaciones_sii`, `api_keys`, `webhooks`, `webhook_entregas` | [04-objetos/objetos-auditoria-e-integraciones.md](04-objetos/objetos-auditoria-e-integraciones.md) |
| XML del SII (DTE, TED, CAF, EnvioBOLETA, RCOF) y JSON | [04-objetos/objetos-xml-y-json.md](04-objetos/objetos-xml-y-json.md) |
| `tipos_dte`, `estados_sii`, tipos enum | [04-objetos/codigos-y-enumeraciones.md](04-objetos/codigos-y-enumeraciones.md) |

---

## Estructura

```
documentación/
├── README.md                          ← este índice
├── 01-fundamentos/                    ← reglas transversales (SII + SaaS)
│   ├── vision-general.md              piezas y módulos del esquema
│   ├── ambientes-y-credenciales.md    certificación/producción, hosts, IDK, secretos, roles, claves, sesiones
│   ├── autenticacion-sii.md           semilla/token, tokens_sii, AUT2000, sesiones_sii
│   ├── firma-y-timbre.md              XML-DSig, TED, CAF, ISO-8859-1
│   ├── tenancy-y-roles.md             organizaciones, roles, funciones de acceso
│   ├── errores-y-resultados.md        errores, resultado_operacion, regla del incierto
│   └── formatos-y-validaciones.md     RUT, correo, montos, IVA, fechas, largos
├── 02-guias/                          ← flujos paso a paso (el "cómo")
│   ├── quickstart.md
│   ├── onboarding-organizacion.md
│   ├── certificacion-empresa.md
│   ├── folios-caf.md
│   ├── emision-boletas.md
│   ├── seguimiento-envios.md
│   └── flujos-tipicos.md
├── 03-api-reference/                  ← contrato de RPC, tablas y servicios del SII (el "qué")
│   ├── indice-operaciones.md
│   ├── rpc-organizacion.md · rpc-integraciones.md · rpc-backend.md
│   ├── acceso-por-tabla.md
│   └── servicios-sii.md
├── 04-objetos/                        ← columnas de tablas, XML/JSON y enumeraciones
│   ├── objetos-tenancy · objetos-empresas-y-credenciales · objetos-folios
│   │   · objetos-documentos · objetos-envios-y-rcof · objetos-certificacion
│   │   · objetos-auditoria-e-integraciones (.md)
│   ├── objetos-xml-y-json.md
│   └── codigos-y-enumeraciones.md
├── 05-pruebas/
│   ├── ambiente-certificacion.md
│   ├── set-de-pruebas.md
│   └── probar-el-esquema.md
├── 06-integraciones/                  ← cómo se conecta un sistema externo
│   ├── overview.md
│   ├── api-keys.md
│   ├── webhooks.md
│   └── realtime-y-storage.md
├── 07-referencia/                     ← material de consulta rápida
│   ├── ejemplos-de-codigo.md
│   ├── herramientas.md
│   ├── reglas-y-limites.md
│   ├── checklist-produccion.md
│   ├── trampas-conocidas.md
│   ├── design-system.md           tokens, componentes, layouts, /_ds, axe
│   └── mapa-fuentes.md
├── 08-esquema-supabase/               ← el esquema SQL y su documentación
│   ├── supabase_saas_sii.sql          ← el artefacto del repo (fuente de verdad)
│   ├── arquitectura.md
│   ├── despliegue.md
│   ├── rls-y-privilegios.md
│   ├── triggers-y-logica.md
│   ├── vault-y-secretos.md
│   └── solucion-de-problemas.md
└── 09-libreria/                       ← @winex/certificacion y CLI sii (certificacion-node)
    ├── mapeo-libreria-tablas.md
    ├── backend-service-role.md
    └── cli-sii.md
```

## Glosario mínimo

<!-- TODO: términos clave (DTE, CAF, TED, IDK, trackId, P90/P91, RCOF…) -->

| Término | Significado |
|---|---|
| | |

## Fuentes y vigencia

<!-- TODO: fuentes, fecha de análisis y fuente de verdad -->
