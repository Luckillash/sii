# Tests

Dos tipos de tests, los dos con Vitest:

- **Unitarios**: el port de los 119 tests PHPUnit del PHP más los huecos que el PHP no
  cubría (pend. 6.1): `SesionSii`, candados de folios, clientes SOAP y REST, GWT,
  `NavegadorSii`, postulación y declaración, todos con el transporte falso.
- **Paridad** (golden tests): exigen que Node produzca **los mismos bytes** que el PHP
  v1.9.1, tanto en los XML firmados como en las peticiones HTTP (PLAN §5).

Ningún test habla con el SII ni usa material real. La CLI tiene sus propios tests, con un
SII falso.

## Cómo correr

Desde PowerShell (en este entorno pnpm no funciona desde Git Bash):

```
pnpm install
pnpm test                                    # core + CLI: unitarios y paridad (no necesita PHP)
pnpm typecheck
pnpm lint
pnpm --filter @winex/certificacion test      # solo el core
pnpm --filter @winex/certificacion-cli test  # solo la CLI
pnpm --filter @winex/certificacion exec vitest run test/unitarios/core/timbre.test.ts   # un archivo
pnpm --filter @winex/certificacion exec vitest run -t "se desglosa en neto e IVA"      # por nombre
pnpm --filter @winex/certificacion exec vitest                                         # modo watch
```

`pnpm test` no necesita PHP: compara contra los esperados versionados en
`paridad/esperados/`. Solo regenerarlos necesita PHP (ver abajo).

**Requisitos:** Node ≥ 22.19 con SHA1 habilitado (el binario oficial de Node lo trae; hay un
test de arranque que firma con SHA1). No se necesita el binario `openssl`.

## Dónde está cada cosa

| Carpeta | Contenido |
|---|---|
| `packages/core/test/unitarios/` | por módulo: `comun/` (incluye `http/`), `core/`, `certificacion/`, `produccion/`, `folios/`, `postulacion/`, `paridad/` (el servidor de captura) |
| `packages/core/test/paridad/` | un test por operación de paridad (`firmar-dte.test.ts`, `http-rest.test.ts`, `gwt.test.ts`…) |
| `packages/core/test/soporte/` | material de prueba y ayudas (abajo) |
| `apps/cli/test/` | comandos de la CLI con un SII falso |
| `paridad/` | casos, esperados, material, generador PHP y servidor de captura ([paridad/README.md](../paridad/README.md)) |

## Principios

1. **Sin red.** Los clientes del SII reciben un `TransporteFalso` o hablan con el servidor
   de captura local.
2. **Sin material real.** Nada de .pfx, CAF ni RUT de contribuyentes reales. RUT de
   prueba: `76123456-0` (emisor), `11111111-1` (quien envía), `66666666-6` (receptor
   genérico), `60803000-K` (el SII). Las páginas del SII de folios y postulación son
   sintéticas, y las respuestas grabadas están anonimizadas (tokens, cookies y trackIds
   inventados).
3. **Verificar de verdad.** Las firmas XML-DSig y TED se verifican con la llave pública,
   además de comparar bytes.
4. **Hora fija.** Todo lo que estampa hora recibe un `reloj` (`relojFijo`): los tests no
   dependen de la fecha ni de la zona del equipo.

### Material de prueba (`packages/core/test/soporte/`)

| Archivo | Produce |
|---|---|
| `criptografia.ts` | llaves RSA de cualquier tamaño (`llave(bits)`, con caché; `generarLlave` sin caché), certificados autofirmados o emitidos por una CA de prueba (`certificado`, `cadena`) y .pfx (`pfx`). node-forge no crea .pfx legacy: para RC2-40 se usan los de `paridad/material/` |
| `caf.ts` | CAF de prueba (`cafPrueba({ rut, razonSocial, tipoDte, desde, hasta, bits, exponente })`), con `<RSASK>` PKCS#1, `<RSAPK>` y `<RSAPUBK>` como los del SII; la `<FRMA>` es relleno. Ayudas para leer el TED (`partesTed`, `tedsEn`, `llavePublicaRsapk`) |
| `paridad.ts` | `casos(operacion)`, `esperado(caso)`, `material(nombre)`, `exigirIdentico(obtenido, esperado, caso)` (diff legible desde ISO-8859-1 con el primer byte distinto) |
| `captura.ts` | `usarServidorCaptura()` y `cabecerasComoCurl()` para los tests HTTP de paridad |

### Regresiones de rechazos reales del SII

Estos tests existen porque el SII ya rechazó envíos por esa causa. Si uno falla, no hay que
"ajustar el test": el cambio reintroduce el rechazo.

| Rechazo | Test |
|---|---|
| Reparo 260 "Monto Total No Cuadra con Parciales" | `unitarios/core/generador-boleta.test.ts`: el total siempre iguala la suma de las líneas con descuento |
| Reparo 510 (firma del TED) | `unitarios/core/timbre.test.ts`: el `<DD>` no lleva blancos entre etiquetas |
| RFR con tildes | `unitarios/core/timbre.test.ts`: el TED se firma sobre los bytes ISO-8859-1 |
| ESTADO 11 "elemento 'Certificate' no existe" | `unitarios/core/firma-electronica.test.ts`: `firmarSemilla` usa el transform enveloped-signature |
| Boleta 39 sin desglose | `unitarios/core/generador-boleta.test.ts`: el precio con IVA incluido se desglosa en neto e IVA |

## Paridad con el PHP

La receta completa (formato de los casos, cómo agregar uno, el servidor de captura, el
material de prueba y cómo generar en Windows) está en
**[paridad/README.md](../paridad/README.md)**. Resumen:

- `paridad/casos/<caso>.json` describe la entrada; `paridad/php/generar.php` la ejecuta con
  el core PHP (`../certificacion-core`, o `CERTIFICACION_CORE`) y escribe
  `paridad/esperados/<caso>.bin` (bytes exactos) y `<caso>.meta.json`. Los esperados **no
  se editan a mano**.
- El test de Node corre la misma entrada y exige `Buffer.equals`. El PHP estampa la hora con
  `date()`: el generador la fija (`paridad/php/hora-fija.php`) o la extrae al `meta.json`, y
  Node la inyecta con el reloj.
- **Peticiones HTTP:** PHP y Node hablan con el mismo servidor de captura
  (`paridad/http/servidor-captura.mjs`, HTTP y HTTPS con una CA de prueba), que graba cada
  petición cruda y responde con respuestas grabadas. Se comparan método, ruta, todas las
  cabeceras y el cuerpo, con unas pocas normalizaciones (boundary, host, `connection`, lista
  de `Accept-Encoding`).
- **Divergencias intencionales:** donde Node es más estricto que el PHP solo en el camino de
  error (set de pruebas, GWT), el esperado sigue siendo la salida del PHP y el test de Node
  exige el error. Están listadas en el mapa `DIVERGENCIAS` de cada test.
- **XSD:** los esperados que se envían al SII se validan contra los esquemas de
  `data/schemas/` (`paridad/xsd.json`). Como Node produce los mismos bytes, eso valida
  también a Node.

```
pnpm paridad:generar                  # regenera todos los esperados (PHP 8.3 + composer install en ../certificacion-core)
pnpm paridad:generar timbre-39-normal # solo algunos casos
pnpm paridad:xsd                      # valida los esperados contra los XSD (PHP + DOMDocument)
```

`pnpm paridad:generar` levanta el servidor de captura y llama a `generar.php`. Si el PHP no
cambió, los esperados salen idénticos: `git status paridad/esperados` no debe mostrar
cambios. En Windows, los casos con .pfx legacy necesitan `OPENSSL_CONF` y el `openssl` de
Git en el PATH (ver [paridad/README.md](../paridad/README.md#material-de-prueba)).

## CI (`.github/workflows/ci.yml`)

Disparadores: `push` a `main` y todo `pull_request`.

| Job | Qué hace |
|---|---|
| `node` (Node 22 y 24, `fail-fast: false`) | `pnpm install --frozen-lockfile`, `biome ci`, `pnpm typecheck`, `pnpm test`, `pnpm build` |
| `paridad-php` | checkout del core PHP público congelado en la v1.9.1 (`CORE_REF`) junto al repo, PHP 8.3, imprime la versión de libxml, `node paridad/http/generar.mjs` (servidor de captura + PHP) y **falla si los esperados regenerados difieren de los versionados**, mostrando el primer byte distinto. Después valida contra los XSD con `xmllint` (`validar-xsd.php --xmllint --estricto`), aunque falle la comparación. Si falla, sube los esperados regenerados como artefacto |

El job `paridad-php` detecta tanto un cambio en el PHP como un esperado editado a mano.

## Qué no cubren los tests

| Qué | Cómo se valida |
|---|---|
| Login AUT2000 con TLS mutuo real | contra el SII de certificación, con el .pfx real (`docs/validaciones.md`) |
| El HTML real del asistente de folios y de la postulación | páginas sintéticas en paridad; contrastado con las páginas reales de maullin (fase 5) |
| Que el SII acepte lo enviado | validaciones en certificación: set EPR 5/5 por SOAP y REST, CAF real, certificación aprobada ([validaciones.md](validaciones.md)) |
| Postular y declarar de punta a punta | sin validar contra el SII: la empresa de pruebas ya está autorizada (P91) |

Las validaciones contra el SII se registran en [validaciones.md](validaciones.md) (PLAN
§5.4), sin RUT, nombres, claves, tokens ni cookies.

## Cómo escribir un test nuevo

- **Unitario de un cliente del SII:** `TransporteFalso` con las respuestas por patrón y,
  después, revisar `transporte.enviadas` (URL, cabeceras, `bytes`, `conexionNueva`, `tls`).
  Ejemplos en [folios.md](folios.md#probar-sin-red) y
  [postulacion.md](postulacion.md#probar-sin-red).
- **Algo que se firma o se envía:** agregar un caso de paridad (receta en
  [paridad/README.md](../paridad/README.md#agregar-un-caso)) para compararlo con el PHP.
- **Material:** generarlo con `soporte/criptografia.ts` y `soporte/caf.ts`; nunca copiar un
  .pfx, CAF o respuesta real del SII sin anonimizar.
