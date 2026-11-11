# Documentación de `certificacion-node`

Port a Node.js/TypeScript de la librería PHP `winex/certificacion` v1.9.1 (`../certificacion-core`).
Integra con el SII de Chile para boleta electrónica (tipos 39 y 41):

- certificado digital (.pfx o PEM) y firma XML-DSig;
- timbre electrónico (TED) con el CAF;
- armado de la boleta, del sobre `EnvioBOLETA` y del RCOF (este último solo para períodos
  hasta julio de 2022: el SII lo eliminó desde el 2022-08-01);
- envío y consulta por dos canales: SOAP DTEWS (`maullin` / `palena`) y API REST de boleta
  (`apicert` / `pangal`, `api` / `rahue`);
- solicitud de folios (CAF) con el asistente web del SII;
- postulación a boleta electrónica y declaración de cumplimiento.

Lo que se firma o se envía al SII sale **idéntico, byte a byte**, a lo que produce el PHP
(ver [tests.md](tests.md)). El estado del port está en
[`PLAN-MIGRACION.md`](../PLAN-MIGRACION.md).

El repo tiene dos paquetes:

| Paquete | Carpeta | Qué es |
|---|---|---|
| `@winex/certificacion` | `packages/core/` | La librería |
| CLI `sii` | `apps/cli/` | Línea de comandos; reemplaza los scripts de `bin/` del PHP |

## Por dónde empezar

| Si quieres... | Lee |
|---|---|
| Instalar, configurar y hacer el recorrido completo (certificación y producción) | [guia-de-uso.md](guia-de-uso.md) |
| Usar la línea de comandos | [cli.md](cli.md) y [configuracion.md](configuracion.md) |
| Llamar a la librería desde tu código | [guia-de-uso.md](guia-de-uso.md) y luego la referencia de la API |
| Resolver un error | [solucion-de-problemas.md](solucion-de-problemas.md) |
| Venir del PHP | [migracion-desde-php.md](migracion-desde-php.md) |

## Índice

### Uso

| Documento | Contenido |
|---|---|
| [guia-de-uso.md](guia-de-uso.md) | **Empieza aquí.** Instalación, uso desde código y desde la CLI, flujo de certificación y de producción |
| [cli.md](cli.md) | Los comandos de `sii`: opciones, qué sale al SII, archivos, `--confirmar`, códigos de salida |
| [mcp.md](mcp.md) | Servidor MCP `sii-mcp`: los comandos como herramientas para Claude u otros clientes MCP |
| [configuracion.md](configuracion.md) | Variables del `.env`, qué comando usa cada una, rutas, `--env` |
| [certificacion.md](certificacion.md) | Procedimiento con que se aprobó la certificación (set de pruebas, cómo leer el estado) |
| [piloto-produccion.md](piloto-produccion.md) | Emisión en producción y seguimiento del piloto (`sii produccion seguimiento`) |
| [solucion-de-problemas.md](solucion-de-problemas.md) | Errores frecuentes, su causa y qué hacer |
| [glosario.md](glosario.md) | Términos del SII y del código (TED, CAF, RCOF, IDK, P90...) |

### Referencia de la librería

| Documento | Área | Código |
|---|---|---|
| [core.md](core.md) | Certificado, firma, timbre, boleta, sobre | `packages/core/src/core/`, `comun/` |
| [canales.md](canales.md) | SOAP DTEWS, API REST, estado de envío, tokens, RCOF | `certificacion/`, `produccion/` |
| [folios.md](folios.md) | Login AUT2000 y solicitud de CAF | `folios/` |
| [postulacion.md](postulacion.md) | Postulación, revisión del set, declaración de cumplimiento | `postulacion/` |

### Proyecto

| Documento | Contenido |
|---|---|
| [tests.md](tests.md) | Tests unitarios, paridad con el PHP, CI |
| [migracion-desde-php.md](migracion-desde-php.md) | Equivalencias de clases y métodos, diferencias de comportamiento |
| [validaciones.md](validaciones.md) | Resultados de cada prueba contra el SII real (fechas, trackId, estados) |
| [`PLAN-MIGRACION.md`](../PLAN-MIGRACION.md) | Plan y estado del port, decisiones tomadas |

## Reglas que conviene saber desde el principio

- **Certificación primero.** Producción emite documentos tributarios reales y consume folios.
- **No conviertas los XML.** La librería entrega `Buffer` en ISO-8859-1, listos para el SII.
  Cualquier reconversión cambia los bytes firmados e invalida la firma.
- **El material sensible no se versiona:** `.env`, `data/certs/`, `data/caf/` (el CAF trae
  la llave de los folios) y `data/output/` (los XML traen RUT y razón social).
- **Ante la duda de si algo llegó al SII, consulta antes de repetir.** Folios timbrados,
  boletas enviadas o una declaración pueden haber quedado hechos aunque la respuesta se
  haya perdido. La CLI lo avisa con el código de salida 6.
