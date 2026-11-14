---
title: "SaaS de boleta electrónica (SII) — Índice de documentación para agentes"
description: "Punto de entrada. Resume las invariantes del sistema y enruta cada tarea al archivo que hay que leer."
version_esquema: "supabase_saas_sii.sql"
generated: "2026-11-10"
sources: ["supabase_saas_sii.sql", "certificacion-node/docs/"]
---

# SaaS de boleta electrónica (SII) — Índice de documentación (orientado a agentes)

Boletéame es un SaaS multiempresa para emitir boletas electrónicas (DTE 39 y 41) ante el SII
de Chile y para certificar empresas como emisoras. Una **organización** (cliente) administra
una o más **empresas** emisoras; cada empresa carga su certificado digital, pide folios
(CAF), emite, firma y envía boletas, y sigue su estado en el SII. Corre sobre Next.js en
Vercel y Supabase (Postgres con RLS, Auth, Vault, Storage, Realtime), y habla con el SII a
través de la librería `@winex/certificacion` (`packages/certificacion`).

Esta carpeta es la referencia para agentes y desarrolladores: modelo de datos, contratos de
RPC, capa de servicio SII, guías por flujo, pruebas y trampas conocidas. El plan y el estado
por fase están en `PLAN-SAAS.md`, en la raíz del repositorio.

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

| Tema | Regla |
|---|---|
| `service_role` | Salta RLS: todo código que lo usa filtra por `organizacion_id`, tomado de la membresía verificada ([tenancy](01-fundamentos/tenancy-y-roles.md)) |
| Llamadas al SII | Solo en el servidor (`server/sii/`, `server-only`, runtime Node.js) y siempre dentro de `ejecutarOperacion`: sin fila en `operaciones_sii` no se llama al SII ([contrato](09-libreria/backend-service-role.md)) |
| Resultado | `operaciones_sii.resultado` equivale al código de salida de la CLI 0–7 ([errores](01-fundamentos/errores-y-resultados.md)) |
| ⚠️ e incierto | Las operaciones que graban tienen ensayo y confirmación, y confirman la sesión con `getUser()`. Un `incierto` no se repite a ciegas: bloquea `solicitar_folios`, `postular` y `declarar` (y, en el asistente de certificación, `enviar_set`) hasta marcarlo como revisado ([errores](01-fundamentos/errores-y-resultados.md#la-regla-del-incierto)) |
| Certificación | El asistente (`/<org>/certificacion`) muestra 5 pasos sobre las 8 etapas de `procesos_certificacion`; `por_declarar` (P90) y `autorizada` (P91) las pone un trigger, nunca la app. Su ensayo no sale al SII ni deja filas ([guía](02-guias/certificacion-empresa.md)) |
| Secretos | .pfx, clave, CAF, tokens y cookies nunca en mensajes, logs, Sentry ni `operaciones_sii`; credenciales y transporte se crean por invocación, nunca globales ([vault](08-esquema-supabase/vault-y-secretos.md)) |
| Tenancy | Todo dato de negocio lleva `organizacion_id`, heredado del padre por `trg_00_organizacion`; RLS es la autoridad y la UI solo oculta acciones ([RLS](08-esquema-supabase/rls-y-privilegios.md)) |
| Campos del sistema | `autorizada_produccion`, la etapa y el estado SII del proceso solo los cambia el sistema (triggers `trg_05_proteger_*`) ([triggers](08-esquema-supabase/triggers-y-logica.md)) |
| Plan | Los límites salen de `plan_vigente()`; un plan `null` significa «sin suscripción vigente», no «ilimitado» ([RPC del backend](03-api-reference/rpc-backend.md#plan_vigente)) |
| Ambientes | Una sola base (producción) para local y Vercel; el ambiente del SII (`certificacion` / `produccion`) es un enum, nunca un texto libre, y en certificación se muestra `BannerAmbiente` |
| Textos al SII | XML en ISO-8859-1 tal cual (`Buffer`, sin recodificar); montos en pesos enteros; fechas en hora de Chile ([formatos](01-fundamentos/formatos-y-validaciones.md)) |

---

## ¿Qué archivo leo?

| Si la tarea es… | Lee |
|---|---|
| Entender qué es el SaaS y qué pieza hace cada cosa | [01-fundamentos/vision-general.md](01-fundamentos/vision-general.md) |
| Ambientes, hosts del SII, certificado, roles y claves API de Supabase, sesiones y revocación | [01-fundamentos/ambientes-y-credenciales.md](01-fundamentos/ambientes-y-credenciales.md) |
| Tokens del SII, sesión AUT2000 o bloqueo por certificado | [01-fundamentos/autenticacion-sii.md](01-fundamentos/autenticacion-sii.md) |
| **Escribir una operación con el SII** (capa `server/sii/`: credenciales, `ejecutarOperacion`, almacén) | [09-libreria/backend-service-role.md](09-libreria/backend-service-role.md) |
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
| `empresas`, `resoluciones`, `certificados`, `empresa_certificados`, `tokens_sii`, `sesiones_sii`, `bloqueos_sii`, `v_certificados_estado` | [04-objetos/objetos-empresas-y-credenciales.md](04-objetos/objetos-empresas-y-credenciales.md) |
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
│   ├── autenticacion-sii.md           semilla/token, tokens_sii, AUT2000, sesiones_sii, bloqueos_sii
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

| Término | Significado |
|---|---|
| DTE | Documento tributario electrónico. Boletéame emite boleta afecta (39) y exenta (41); facturas, en la Fase 14 |
| CAF | Código de Autorización de Folios: XML del SII con el rango de folios y la llave privada (`RSASK`) con que se timbra. Va en Vault |
| Folio | Número correlativo de un DTE dentro del rango de un CAF (`asignar_folio`) |
| TED | Timbre electrónico del documento: firma con la llave del CAF que va en el XML y en el PDF417 impreso |
| IDK | Identificador de la llave del SII en el CAF: 100 en certificación, 300 en producción |
| Semilla / token | Autenticación del SII: se firma una semilla con el certificado y se obtiene un token (REST o SOAP), cacheado cifrado en `tokens_sii` |
| AUT2000 | Sesión web del SII con certificado (cookies), para postular, pedir folios y declarar; cacheada en `sesiones_sii` |
| Track ID | Identificador que devuelve el SII al recibir un envío; con él se consulta su estado |
| EPR / RCT / RSC… | Estados de un envío en el SII (`estados_sii`); EPR = envío procesado |
| Set de pruebas | Casos que el SII entrega en la certificación; se emiten y envían para que los revise |
| P90 / P91 | Estados de la postulación: P90 = set aprobado, falta declarar; P91 = autorizada para producción |
| RCOF | Reporte de consumo de folios; obligatorio solo hasta julio de 2022 (🕰️) |
| Resolución | Número y fecha de la resolución del SII que van en la carátula; en certificación, número 0 |
| Incierto | Resultado 6: la orden salió al SII y no se sabe si se aplicó; se revisa antes de repetir |
| Ensayo | Ejecución sin confirmar (`confirmada = false`): valida y muestra lo que haría, sin salir al SII |

## Fuentes y vigencia

| Fuente | Qué aporta | Fuente de verdad para |
|---|---|---|
| `supabase/migrations/` (0001–0009) | Esquema aplicado en producción | Tablas, RLS, triggers y RPC |
| `08-esquema-supabase/supabase_saas_sii.sql` | Esquema original (= `0001`), comentado | Intención de diseño de la `0001` |
| `apps/web/src/server/` | Capa SII, certificación y Supabase | Comportamiento del backend |
| `packages/certificacion` (`@winex/certificacion`, de `certificacion-node`) | Librería y CLI `sii`, con sus `docs/` | Protocolo con el SII y códigos de error |
| `PLAN-SAAS.md` | Fases, decisiones y estado | Qué está hecho y qué falta |

Análisis inicial: 2026-11-10; actualizado por fase hasta la Fase 5 (2026-11-13). Si un
archivo de esta carpeta contradice a las migraciones o al código, mandan las migraciones y
el código: corrige el archivo.
