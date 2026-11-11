# Plan de migración: `winex/certificacion` (PHP) → Node.js

Plan para reescribir en TypeScript/Node.js la librería PHP `winex/certificacion` v1.9.1
(`../certificacion-core`) en un proyecto nuevo, **sin perder la compatibilidad con el SII**.

- **Origen:** `sii/certificacion-core`. Librería PHP 8.3, unas 4.400 líneas en `src/`, 119 tests PHPUnit, Apache-2.0.
- **Destino:** `sii/certificacion-node`, esta carpeta. Se trabaja junto al proyecto PHP.
- **Fecha del plan:** 2026-11-05

## Estado

Leyenda: ✅ listo · 🟡 en parte · ⬜ pendiente. Se actualiza al terminar cada tarea.

| Fase | Estado | Fecha | Nota |
|---|---|---|---|
| 0. Preparación | ✅ | 2026-11-05 | CI en verde (Node 22/24 + paridad PHP); humo TLS OK en los 5 hosts |
| 1. Fundamentos | ✅ | 2026-11-06 | `comun/` completo; 310 tests; 62 casos de paridad idénticos al PHP |
| 2. Criptografía | ✅ | 2026-11-06 | `Certificado`, `firmarDte` y `Timbre` en paridad: 28 casos nuevos (90 en total), 523 tests. Compuerta superada |
| 3. Documentos | ✅ | 2026-11-06 | Set de pruebas completo idéntico al PHP (EnvioBOLETA y RCOF), ambos validan contra el XSD del SII; decisiones del usuario aplicadas; 173 casos de paridad, 1035 tests |
| 4. Canales de envío | ✅ | 2026-11-06 | REST y SOAP DTEWS portados, con requests idénticos al PHP en el cable (servidor de captura: 19 casos `http-*`); `TokenStore`; 192 casos de paridad, 1261 tests. Validado en certificación (§5.4): set **aceptado** (EPR, 5/5) y RCOF aceptado con reparos, por DTEUpload; **certificación aprobada y empresa autorizada para producción**. Subida REST (pangal) validada el 2026-11-07: set EPR 5/5; el RCOF por REST recibe 404 del SII (igual que el PHP; el SII eliminó el RCOF desde el 2022-08-01, ver §1) |
| 5. Folios | ✅ | 2026-11-07 | `SesionSii`, login AUT2000 con TLS mutuo y `SolicitudFolios` portados, con requests idénticos al PHP (15 casos `http-folios-*`, incluido el certificado y la cadena del login); parser HTML propio que reproduce a libxml (6 casos `html-form-*`); navegación compartida con la postulación; candados probados con el transporte falso. 215 casos de paridad, 1339 tests. Validado en certificación (§5.4): CAF real de boleta obtenido con Node (folios 31–35) y el parser idéntico al PHP en las páginas reales del SII |
| 6. Postulación | ✅ | 2026-11-07 | `DatosPostulacion` / `DatosDeclaracion` portados (fase 1). Ronda 1 lista (2 sub-agentes en paralelo): `GwtRpc`/`LectorGwt` con BigInt (57 casos `gwt-*`); `NavegadorSii` + `PostulacionSii` (18 `http-postulacion-*`, 2 `html-form-postulacion-*`, 3 `texto-html-*`). 295 casos de paridad, 1611 tests. Ronda 2 lista: `DeclaracionBoletas` / `EstadoDeclaracion` (25 `http-declaracion-*`). **320 casos de paridad, 1744 tests.** Validado en certificación (§5.4) con `scripts/declaracion.ts`: portal vigente (versión GWT capturada) y estado de la declaración consultado con el login real (sin trámite: empresa ya autorizada). Sin validar a propósito: la descarga del set (la empresa está en P91), la postulación y la declaración (no hay otro RUT) |
| 7. CLI | ✅ | 2026-11-07 | Binario `sii` con 14 comandos: los 7 de `bin/` más los del flujo completo de certificación. Config con zod, códigos de salida tipados, `--confirmar` en todo lo que graba. 173 tests de la CLI con un SII falso (1917 en total). Probado sin red con la config real (`enviar-set --solo-armar` + `verificar-ted`: 5 TED OK). Validado en certificación (§5.4), con el OK del usuario: portal vigente, estado de la declaración y estado de envíos por SOAP y REST (2026-11-07). Además, el flujo de envío completo solo con la CLI (2026-11-10): CAF nuevo con folios 36–40 → set por DTEUpload → **EPR 5/5**. Sin validar a propósito: postulación y declaración (empresa en P91) |
| 8. Piloto y corte | 🟡 | 2026-11-10 | Listo sin tocar producción: `solicitar-folios --ambiente produccion` (palena), comando `produccion seguimiento` para el período de observación, procedimiento en `docs/piloto-produccion.md` y documentación de `docs/` completa. Se agregó `--folio-inicial` para el primer timbraje y se obtuvo el **CAF de producción** (tipo 39, folios 1–5). **5 boletas reales emitidas con Node (folios 1–5): todas EPR, aceptadas sin reparos.** Seguimiento diario automático hasta el 2026-11-24. 195 tests de la CLI y 1748 del core. Falta: terminar el período de observación y dejar el PHP en mantenimiento |

```
sii/
├── certificacion-core/   ← PHP actual: referencia de comportamiento, se congela en v1.9.1
└── certificacion-node/   ← proyecto nuevo (este plan)
```

---

## 1. Objetivo y principios

**Objetivo:** tener en Node.js todo lo que hace hoy el core PHP:

- certificado y firma XML-DSig;
- TED/CAF;
- armado de la boleta, de `EnvioBOLETA` y del RCOF (ver la nota de abajo);
- canal SOAP DTEWS y API REST de boleta;
- solicitud de folios;
- postulación y declaración de cumplimiento;
- reemplazo de los scripts de `bin/`.

> **RCOF (Resumen de Ventas Diarias, ex Reporte de Consumo de Folios).** El SII eliminó la
> obligación de enviarlo a partir del **1 de agosto de 2022**: las boletas emitidas desde
> esa fecha no se reportan en un RCOF diario. La obligación sigue solo para períodos hasta
> **julio de 2022 inclusive** (reportes pendientes o deudas de esas fechas, que se revisan en
> los servicios online de boletas electrónicas del sitio del SII). Consecuencias para este
> plan (2026-11-07):
> - El RCOF ya portado (`GeneradorConsumoFolios`, `resumirParaRcof`, firma `#RCOF`,
>   `enviarConsumoFolios` REST) se **mantiene** por paridad con el PHP y para esos períodos
>   antiguos, pero no forma parte del flujo normal de emisión ni de la certificación.
> - Por REST no se puede enviar: pangal responde **HTTP 404** en
>   `boleta.electronica.consumo` (validado el 2026-11-07, igual con el PHP). Para un período
>   antiguo pendiente, el canal que funciona es `DTEUpload` (SOAP), que lo recibió en la
>   validación de la fase 4.
> - La CLI (fase 7) y la interfaz web (§10) no envían RCOF por defecto. Lo mismo
>   `scripts/validar-certificacion.ts` desde el 2026-11-07: solo con `--con-rcof`.
La librería debe quedar lista para usarse desde un servidor Node y, más adelante, desde una
interfaz Next.js.

**Principios que mandan sobre cualquier otra decisión:**

1. **Paridad byte a byte antes que mejoras.** El SII valida digests y firmas sobre bytes
   exactos. Todo lo que se firma o se envía al SII debe salir **idéntico** al PHP.
   Se comprueba con tests automáticos ("golden tests") contra la salida real del PHP.
2. **El PHP es la referencia viva.** Mientras dure la migración, `certificacion-core`
   no cambia lo que envía al SII. Si cambia, se regeneran las salidas esperadas (§5).
3. **Lo que cambia bytes enviados al SII requiere una decisión explícita** y una
   validación en el ambiente de certificación (maullin / apicert / pangal) antes de
   llegar a producción.
4. **Los arreglos que no cambian bytes se hacen durante el port.** Por ejemplo tipos,
   errores, revisión de códigos HTTP, caché de token o duplicaciones. Ver §8.
5. **De lo más arriesgado a lo menos arriesgado.** La criptografía (fase 2) es una
   compuerta: si no se logra paridad ahí, se detiene la migración antes de invertir en
   lo demás.

---

## 2. Stack del proyecto nuevo

| Pieza | Elección | Motivo |
|---|---|---|
| Runtime | **Node.js 24 LTS** (`engines: >=22.19`, lo exige undici 8) | `fetch`/undici, `process.loadEnvFile()`, `node:crypto` con OpenSSL 3 |
| Lenguaje | TypeScript estricto (`strict`, `noUncheckedIndexedAccess`) | Los tipos eliminan varios pendientes (ej. 1.5 `exento`) |
| Gestor | pnpm con workspaces | Librería + CLI (+ web después) en un solo repo |
| Módulos | ESM, compilado con `tsup` (se puede agregar CJS si alguna app lo necesita) | Compatible con Next.js |
| Tests | Vitest | Equivalente directo de PHPUnit |
| Lint/format | Biome (o ESLint + Prettier) | |
| Validación de entradas | zod | Config del `.env` y datos de entrada de la CLI/API |

### Equivalencias de dependencias

| PHP | Node | Notas / riesgo |
|---|---|---|
| `DOMDocument::loadXML`, `getElementsByTagName` | `@xmldom/xmldom` | Solo para **leer** XML (CAF, respuestas, DTE a firmar) |
| `DOMNode::C14N()` (C14N 1.0 inclusivo) | ~~`C14nCanonicalization` de `xml-crypto`~~ → **C14N propio** (`comun/c14n.ts`) | ✅ **Resuelto en la fase 1.** `xml-crypto` omitía o duplicaba los namespaces heredados en los subárboles reales; el C14N propio da los mismos bytes que libxml en 32 casos y `xml-crypto` se quitó |
| `DOMDocument` + `formatOutput` + `saveXML()` | **Serializador propio** que imite a libxml | ✅ **Listo en la fase 1** (`comun/xml.ts`, 21 casos idénticos). `xmldom` no tiene pretty-print y escapa distinto. `GeneradorBoleta` depende del formato exacto de libxml (2 espacios, `<X/>` vacíos, `&#13;`, referencias `&#N;` para caracteres fuera de ISO-8859-1) |
| `openssl_pkcs12_read` + fallback por la CLI `openssl -legacy` | `node-forge` (PKCS#12) | ✅ **Listo en la fase 2.** Lee .pfx con cifrados legacy (RC2-40, 3DES) **sin el binario openssl**: desaparece toda la lógica de `comandoPkcs12` y el paso de la clave por el entorno. forge valida el MAC y descifra, pero los certificados se toman con sus bytes DER originales (forge los reserializa). No lee RC2-128, RC4 ni 3DES de 2 llaves (raros) |
| `openssl_sign(..., OPENSSL_ALGO_SHA1)` | `crypto.sign('sha1', datos, llave)` | PKCS#1 v1.5 es determinista, lo que permite la comparación byte a byte. **Ojo:** usar el binario oficial de Node o la imagen Docker oficial; algunas builds de distro con OpenSSL del sistema (RHEL 9) bloquean SHA1 |
| `openssl_pkey_get_details()['rsa']['n'/'e']` | `KeyObject.export({ format: 'jwk' })` → base64url a base64 | Mismo big-endian sin cero inicial |
| `mb_convert_encoding(..., 'ISO-8859-1', 'UTF-8')` | ~~`iconv-lite`~~ → función propia `aIso88591()` | ✅ **Listo en la fase 1**, sin dependencia. **No** usar `Buffer.from(s, 'latin1')`: toma el byte bajo de caracteres fuera de rango en vez de poner `?` como PHP |
| `htmlspecialchars(ENT_XML1)` | función propia `escaparXml()` | ✅ **Listo en la fase 1**: las 3 variantes que usa el PHP, en paridad |
| `mb_substr(..., 0, 40)` | `truncarCodePoints()` | ✅ **Listo en la fase 1**. Por code points, no por unidades UTF-16 |
| cURL (timeouts, mTLS, multipart) | `undici` (`Agent` con `connect: { key, cert }`) + multipart propio (`comun/http/multipart.ts`) | ✅ Transporte listo en la fase 1 (timeouts, mTLS en memoria, `conexionNueva`). Multipart armado a mano e **idéntico al de cURL 8.23** en el cable (fase 4, casos `http-multipart-*`). Única diferencia conocida: cURL agrega `Expect: 100-continue` con cuerpos de más de 1 MiB y undici no |
| `file_get_contents` + stream context (SOAP) | `undici.request` | Sobres SOAP armados a mano, como hoy. No se necesita la librería `soap` |
| `DOMDocument::loadHTML` (formularios del SII) | ~~`parse5`~~ → **parser propio estilo libxml** (`comun/html.ts`) | ✅ **Listo en la fase 5.** Un parser HTML5 repara el HTML roto de otra forma (forms en tablas, `</form>` en celdas), así que se replicaron las reglas de libxml 2.10.4 medidas con PHP: cierres automáticos, prioridades de cierre, texto crudo de `<script>`, atributos y referencias, y el `<meta charset>` que vuelve a decodificar la página. 6 casos `html-form-*` (74 páginas) idénticos. Probado con las 3 páginas reales del asistente en maullin (2026-11-07): mismo formulario que el PHP |
| `int` de 64 bits en `GwtRpc::longDeBase64` / `long()` | **`BigInt`** | **Riesgo alto, silencioso:** en JS `<<` trabaja con 32 bits. Portar literal corrompe los `long` de GWT |
| `date()` con zona del proceso | Reloj inyectable + `Intl.DateTimeFormat` con `America/Santiago` | ✅ **Listo en la fase 1** (`comun/reloj.ts`). Hace los tests deterministas y resuelve 6.2 / 6.4 de `pendientes.md` |
| `vlucas/phpdotenv` | `process.loadEnvFile()` nativo + zod | Sin dependencia |

---

## 3. Estructura del proyecto nuevo

```
certificacion-node/
├── PLAN-MIGRACION.md                ← este archivo
├── package.json                     ← workspace raíz (scripts: test, paridad, lint, build)
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .env.example
├── LICENSE / NOTICE                 ← Apache-2.0, ver §11
├── packages/
│   └── core/                        ← @winex/certificacion (la librería)
│       ├── src/
│       │   ├── comun/               ← Rut, Ambiente, errores, reloj, codificación, xml, http
│       │   ├── core/                ← Certificado, FirmaElectronica, Timbre, GeneradorBoleta, EnvioBoleta
│       │   ├── certificacion/       ← ClienteDtews (SOAP), EstadoEnvio, parsearSetPruebas, GeneradorConsumoFolios
│       │   ├── produccion/          ← ClienteBoletaRest (API REST)
│       │   ├── folios/              ← SesionSii, SolicitudFolios (los transportes están en comun/http)
│       │   ├── postulacion/         ← GwtRpc, LectorGwt, NavegadorSii, PostulacionSii, DeclaracionBoletas
│       │   └── index.ts             ← API pública
│       └── test/
│           ├── unitarios/           ← port de los 119 tests + los huecos de pendientes 6.1
│           ├── paridad/             ← golden tests contra el PHP (§5)
│           └── soporte/             ← generación de llaves/certificados/CAF de prueba
├── apps/
│   └── cli/                         ← reemplazo de bin/ (certificacion, produccion, util)
├── paridad/
│   ├── php/                         ← scripts PHP que llaman a ../../certificacion-core
│   ├── casos/                       ← entradas de cada caso (JSON)
│   └── esperados/                   ← salidas generadas por PHP (NO se editan a mano)
├── data/
│   ├── schemas/                     ← XSD del SII (copiados de certificacion-core)
│   └── set_pruebas/
└── docs/
```

Más adelante se agrega `apps/web/` (Next.js), ver §10.

---

## 4. Mapa de módulos PHP → TypeScript

| PHP (`src/`) | TS (`packages/core/src/`) | Fase | Tamaño | Cambios previstos | Estado |
|---|---|---|---|---|---|
| `Postulacion/Rut` | `comun/rut.ts` | 1 | S | Pasa a `comun` y lo usan todos los módulos (pend. 2.3) | ✅ |
| `Folios/Ambiente` | `comun/ambiente.ts` | 1 | S | `enum` / union de strings | ✅ |
| Excepciones (`*Exception`) | `comun/errores.ts` | 1 | S | Una jerarquía única `SiiError` (pend. 6.4) | ✅ |
| — | `comun/reloj.ts`, `comun/codificacion.ts`, `comun/xml.ts` | 1 | M | Nuevos: reloj inyectable, ISO-8859-1, escape y serializador estilo libxml, C14N | ✅ (C14N en `comun/c14n.ts`) |
| `Folios/RespuestaHttp`, `TransporteHttp`, `TransporteCuerpoCrudo`, `TransporteCurl`, `TransporteFalso` | `comun/http/*` | 1 | M | Un solo transporte inyectable para **todos** los clientes (hoy SOAP y REST no lo tienen: pend. 6.1) | ✅ (multipart listo en la fase 4: `comun/http/multipart.ts`) |
| `Core/Certificate` | `core/certificado.ts` | 2 | M | `node-forge`; sin fallback a la CLI de openssl; se conserva `sinMaterialPem` para mensajes de error | ✅ |
| `Core/FirmaElectronica` | `core/firma-electronica.ts` | 2 | M | Paridad exacta de `firmarSemilla` y `firmarDte`, incluidos los saltos de línea de `<Signature>` y el `rtrim` final | ✅ (ramas `Libro` y URI vacía no portadas: lanzan `ErrorFirma`) |
| `Core/Timbre` | `core/timbre.ts` | 2 | M | DD aplanado → ISO-8859-1 → firma. CAF en ISO-8859-1 sin declarar | ✅ (`generarTed` devuelve `Buffer` ISO-8859-1) |
| `Core/GeneradorBoleta` | `core/generador-boleta.ts` | 3 | L | Serializador estilo libxml; `exento: boolean` | ✅ (`round()` y `(string)` de float de PHP replicados; rechaza negativos y montos ≥ 1e15) |
| `Core/EnvioBoleta` | `core/envio-boleta.ts` | 3 | S | | ✅ |
| — | `core/armador-boleta.ts` | 3 | M | Nuevo: encapsula generar → timbrar → insertar TED/`TmstFirma` → firmar (pend. 2.5) | ✅ (recibe el CAF y valida emisor, tipo y rango de folios) |
| — | `certificacion/resumen-rcof.ts` | 3 | S | Nuevo: `resumirParaRcof(dtes)` arma los `ResumenRcof` desde los DTE (pend. 5) | ✅ |
| `Certificacion/GeneradorConsumoFolios` | `certificacion/consumo-folios.ts` | 3 | S | Entradas tipadas (pend. 6.4) | ✅ |
| `Certificacion/SetPruebasParser` | `certificacion/set-pruebas.ts` | 3 | M | | ✅ (`parsearSetPruebas(contenido)`: función, sin E/S) |
| `Certificacion/EstadoEnvio` | `certificacion/estado-envio.ts` | 3 | S | | ✅ |
| `Produccion/SiiBoletaProduccion` | `produccion/boleta-rest.ts` | 4 | M | Revisa el código HTTP (1.9), `TokenStore` inyectable por empresa y ambiente (1.4), estado REST tipado (1.6), multipart compartido (2.4) | ✅ (`ClienteBoletaRest`; nombre de archivo por defecto `envio.xml` / `rcof.xml`) |
| `Certificacion/SiiSoapClient` | `certificacion/dtews-soap.ts` | 4 | M | Firma de la semilla: primero paridad, unificar después (1.3, 1.8, 2.1) | ✅ (`ClienteDtews`; firma de semilla propia del PHP en `firma-semilla-dtews.ts`) |
| `Folios/SesionSii` | `folios/sesion-sii.ts` | 5 | M | Reglas de dominio de cookies con tests (pend. 6.1) | ✅ (formato de `toArray()` del PHP; reloj inyectable para `Expires`; no muestra las cookies al inspeccionar ni serializar) |
| `Folios/SolicitudFolios` | `folios/solicitud-folios.ts` | 5 | L | `revisarCaf` dentro del `try` (1.2); navegación compartida (2.2) | ✅ (devuelve el CAF como `Buffer`; exige HTTP 200; orden de timbrar con `conexionNueva`) |
| — | `comun/html.ts`, `comun/navegacion-sii.ts` | 5 | M | Nuevos: parser HTML estilo libxml; redirecciones, `resolverUrl` y `sesionVigente` compartidos con la postulación (pend. 2.2) | ✅ |
| `Postulacion/GwtRpc`, `LectorGwt` | `postulacion/gwt-rpc.ts` | 6 | L | **BigInt** para `long`; números decimales sin truncar en silencio | ✅ (2026-11-07; 57 casos `gwt-*`, incluidas las 7 llamadas de `DeclaracionBoletas` byte a byte; uso interno, no se exporta en `index.ts`) |
| `Postulacion/NavegadorSii` | `postulacion/navegador-sii.ts` | 6 | M | Se une con la navegación de folios; las **dos reglas de `form()` se mantienen separadas** hasta probar que se pueden unificar | ✅ (2026-11-07; usa `comun/navegacion-sii.ts`; `texto()` con la tabla HTML5 completa en `comun/entidades-html5.ts`; interno, no se exporta) |
| `Postulacion/PostulacionSii`, `DeclaracionBoletas`, `Datos*`, `EstadoDeclaracion`, `ResultadoPostulacion` | `postulacion/*` | 6 | L | | ✅ `DatosPostulacion` y `DatosDeclaracion` (fase 1); `PostulacionSii` y `ResultadoPostulacion` (`postulacion/postulacion-sii.ts`); `DeclaracionBoletas` y `EstadoDeclaracion` (`postulacion/declaracion-boletas.ts`, `estado-declaracion.ts`) (2026-11-07) |
| `bin/*` (7 scripts) | `apps/cli` | 7 | M | Config validada, sin doble conversión ISO-8859-1 (1.1), sin datos fijos (pend. 5) | ✅ (14 comandos, binario `sii`; consultas validadas en certificación) |

S = horas, M = 1–2 jornadas, L = 2–4 jornadas.

---

## 5. Estrategia de paridad (el corazón del plan)

### 5.1 Golden tests de salida (XML y firmas)

La firma RSA PKCS#1 v1.5 con SHA1 es **determinista**: con la misma llave y los mismos
bytes, la firma es idéntica. Por lo tanto la salida firmada del PHP y la de Node deben
ser iguales byte a byte.

1. `paridad/casos/*.json` describe entradas: emisor, receptor, ítems (con tildes, `Ñ`,
   `&`, `<`, caracteres fuera de ISO-8859-1), descuentos, exentos, referencias, CAF con
   razón social `DÍAZ` en ISO-8859-1, semillas, etc.
2. `paridad/php/generar.php` carga `../../certificacion-core/vendor/autoload.php`, ejecuta
   cada caso con la librería PHP y guarda `paridad/esperados/<caso>.bin` (bytes exactos)
   más `<caso>.meta.json`.
3. **Problema de la hora:** el PHP usa `date()` directo para `FchEmis`, `TSTED`,
   `TmstFirma` y `TmstFirmaEnv`, y no se puede inyectar. **Solución:** el script PHP
   **extrae** esas marcas de su propia salida y las guarda en el `meta.json`. En Node,
   cada función que estampa hora recibe un `ahora` opcional, y el test le pasa esas
   mismas marcas.
4. `test/paridad/*.test.ts` ejecuta Node con las mismas entradas y exige
   `Buffer.equals(esperado)`. Si falla, muestra un diff legible (decodificado desde
   ISO-8859-1) con el primer byte distinto.
5. **Verificación cruzada:** además de comparar bytes, Node verifica las firmas del PHP
   y el PHP (`openssl_verify`) verifica las de Node.

Material criptográfico: llaves, certificados, .pfx (incluido uno con cifrado legacy) y
CAF de prueba, generados para los tests (como hace `tests/Soporte/Criptografia.php`) y
guardados en `paridad/`. **Nunca** se usan certificados ni CAF reales.

Comandos previstos:

```
pnpm paridad:generar   # corre el PHP y regenera paridad/esperados/ (requiere PHP 8.3 + composer install en ../certificacion-core)
pnpm test              # unitarios + paridad (no necesita PHP: usa los esperados versionados)
```

### 5.2 Casos mínimos de paridad

| Área | Casos |
|---|---|
| `Certificado` ✅ | .pfx moderno, .pfx legacy (RC2-40), PEM con clave, PEM sin clave, contraseña incorrecta, cadena con intermedios |
| `firmarSemilla` ✅ | semilla numérica normal; con ceros a la izquierda |
| `firmarDte` ✅ | `#F{folio}T39`, `#F{folio}T41`, `SetDoc`, `RCOF`; DTE con y sin espacios en blanco |
| `Timbre` ✅ | razón social sin tilde y con tilde (ISO-8859-1 en el CAF); ítem de más de 40 caracteres con multibyte; `&` y `<` en RSR/IT1; CAF con saltos de línea |
| `GeneradorBoleta` ✅ | afecta, exenta (41), mixta, descuento % y monto, con referencia, con receptor con razón social |
| `EnvioBoleta` / RCOF ✅ | 1 y N boletas; rangos de folios discontinuos |
| Set de pruebas ✅ | `data/set_pruebas/Set Prueba BE.txt` completo, de punta a punta: el sobre firmado debe ser idéntico |

### 5.3 Paridad de requests HTTP (canales SII)

Las fases 4 a 6 no producen archivos sino **requests**. Para compararlos:

- Se levanta un **servidor local de captura** (Node, HTTP plano o TLS con un certificado
  de prueba) que graba cada request crudo y responde con respuestas del SII grabadas.
- El PHP (apuntando su host al servidor de captura) y Node ejecutan el mismo flujo, y se
  comparan método, ruta, cabeceras relevantes y cuerpo. En el multipart se ignora solo
  el *boundary*.
- Las respuestas grabadas del SII (HTML de AUT2000, `of_*`, respuestas GWT, JSON REST,
  XML SOAP) se guardan **anonimizadas** como fixtures y alimentan también los unitarios
  con el transporte falso.

### 5.4 Validación contra el SII real

La paridad local no reemplaza la prueba real. Antes de dar por terminada cada fase
que habla con el SII, se ejecuta el flujo en **certificación** (maullin / apicert /
pangal) con un RUT de pruebas y se registra el resultado en `docs/validaciones.md`
(fecha, flujo, trackId, estado devuelto).

---

## 6. Fases

Cada fase tiene un **criterio de salida**. No se pasa a la siguiente sin cumplirlo.

### Fase 0: Preparación (1–2 jornadas) ✅ Lista (2026-11-05)
- [x] Crear el repo `certificacion-node` (git, pnpm workspace, tsconfig, Biome, Vitest, tsup).
- [x] CI en GitHub Actions: Node 22 y 24, lint, typecheck y tests. Un job aparte con PHP 8.3
  (`shivammathur/setup-php`) hace checkout de `certificacion-core@v1.9.1`, regenera
  los esperados y falla si difieren de los versionados.
- [x] `paridad/php/generar.php` con un primer caso trivial (`firmarSemilla`).
- [x] **Prueba de humo de TLS:** desde Node, abrir conexión TLS con certificado de cliente
  contra los hosts de certificación del SII, para descartar a tiempo problemas de
  OpenSSL 3 (renegociación legacy, cifrados). Resultado en `docs/validaciones.md`.
- [x] Copiar `data/schemas` y `data/set_pruebas`, `LICENSE` y `NOTICE`.

**Salida:** ✅ CI en verde; el job de paridad corre con un caso.

### Fase 1: Fundamentos (2–3 jornadas) ✅ Lista (2026-11-06)
- [x] `comun/`: `Rut`, `Ambiente`, errores, `Reloj`, `codificacion` (UTF-8 ↔ ISO-8859-1 con
  `?`), `escaparXml`, serializador estilo libxml, C14N y transporte HTTP (real con undici
  y falso).
- [x] Port de `RutTest`, `AmbienteTest` y `DatosPostulacionTest`.
- [x] Extra: C14N propio validado en subárboles (`Documento`, `SetDTE`, RCOF), el
  parser rechaza lo mismo que `loadXML` (salvo `<!DOCTYPE>`, a propósito),
  `http_build_query` en paridad y `conexionNueva` para POST críticos.

**Salida:** ✅ tests en verde; el serializador reproduce byte a byte salidas de
`DOMDocument::saveXML()` para un conjunto de árboles de prueba generados desde PHP.
Pendiente de confirmar en el CI: que el job de paridad (libxml de Ubuntu) dé los
mismos esperados que libxml 2.10.4 de Windows.

### Fase 2: Criptografía (3–5 jornadas): **compuerta go / no-go** ✅ Lista (2026-11-06)
- [x] `Certificado`, `FirmaElectronica`, `Timbre`. (`firmarSemilla` ✅ desde la fase 0).
- [x] Port de `CertificateTest`, `FirmaElectronicaTest` y `TimbreTest`, más los casos de
  paridad de §5.2 para estas tres clases (10 `certificado-*`, 9 `firmar-dte-*`,
  9 `timbre-*`).
- [x] Extra: generadores de material de prueba (`test/soporte/criptografia.ts`: llaves
  de cualquier tamaño, cadenas y .pfx; `test/soporte/caf.ts`) y test de arranque de SHA1.

**Salida:** ✅ paridad byte a byte en todos los casos y verificación cruzada OK
(Node verifica las firmas del PHP: `<SignatureValue>` de `firmarDte`, `FRMT` del TED
y firma con la llave del `Certificado`; como los bytes son idénticos, el PHP también
verifica los de Node). Pendiente de confirmar en el CI: los casos `certificado-pfx-legacy*`
asumen que el PHP de Ubuntu no lee RC2 de forma nativa y cae al binario `openssl`.
Validado también con el .pfx real (2026-11-06): llave, certificado, cadena, `getInfo` y
`firmarSemilla` idénticos al PHP (ver `docs/validaciones.md`).

Notas para las fases siguientes:
- El PHP tiene dos defectos que Node repite a propósito, por paridad: (1) con un .pfx
  **no legacy** que trae intermedios, la cadena TLS sale hoja → raíz → intermedia (ver
  §8, "Orden de la cadena TLS"); (2) el SignedInfo que se firma declara `xmlns:xsi` y
  el que se envía no (no cambia bytes; el SII lo acepta hoy).
- Hora fija en el PHP: `paridad/php/operaciones/timbre.php` define
  `Winex\Certificacion\Core\date()`, que intercepta los `date()` del core sin
  modificarlo. La fase 3 lo necesita para `FchEmis`, `TmstFirma` y `TmstFirmaEnv`:
  conviene moverlo a un archivo común de `paridad/php/`. ✅ Hecho (2026-11-06):
  `paridad/php/hora-fija.php` lo define en los namespaces `Core` y `Certificacion`, y
  las operaciones usan `conHoraFija()`. Los 90 esperados se regeneraron idénticos.
- Generar los esperados `certificado-*` en Windows requiere `OPENSSL_CONF` y el
  `openssl` de Git en el PATH (ver `paridad/README.md`).
**Si no se logra** (por ejemplo, C14N irreproducible), se detiene la migración y se
evalúa la alternativa: mantener el core PHP detrás de una API y usar Node solo para el
servidor y la interfaz.

### Fase 3: Documentos (3–4 jornadas) ✅ Lista (2026-11-06)
- [x] `GeneradorBoleta`, `EnvioBoleta`, `GeneradorConsumoFolios`, `SetPruebasParser` y
  `EstadoEnvio` (2026-11-06): 22 casos `boleta-*`, 7 `envio-boleta-*`, 7 `rcof-*`,
  17 `set-pruebas-*` y 23 `estado-envio-*`, todos idénticos al PHP.
- [x] El nuevo `ArmadorBoleta` (6 casos `armar-boleta-*`) y `resumirParaRcof`.
- [x] Port de los tests restantes de `Core` y `Certificacion` (2026-11-06).
- [x] Extra: `parsearDocumento` rechaza `<?xml?>` fuera del inicio, como libxml (8 entradas
  nuevas en `xml-bien-formado`).

- [x] Validación XSD (`paridad/xsd.json` + `paridad/php/validar-xsd.php`; `pnpm paridad:xsd`
  en local, `xmllint` en el job `paridad-php` del CI). `ConsumoFolio_v10.xsd` y
  `SiiTypes_v10.xsd` descargados de sii.cl (procedencia en `data/schemas/README.md`).

**Salida:** ✅ (2026-11-06) el set de pruebas completo produce un `EnvioBOLETA` firmado
idéntico al del PHP (`set-completo`), y el RCOF también (`rcof-set-completo`); ambos
validan contra `EnvioBOLETA_v11.xsd` y `ConsumoFolio_v10.xsd`. Pendiente de confirmar en
el CI: primera corrida real de `xmllint` (en local solo se validó con PHP, misma libxml).
No validan, a propósito, los casos con DTE sin firmar (`envio-boleta-crudo-bytes` y
`-declaraciones`): quedan excluidos con su motivo en `paridad/xsd.json`.

**Decisiones de la fase 3** (tomadas por el usuario el 2026-11-06; ninguna cambia bytes
de entradas válidas, solo el camino de error):
1. **Se mantienen** las validaciones más estrictas que el PHP: `GeneradorBoleta` rechaza
   cantidades/precios negativos y montos ≥ 1e15; `ArmadorBoleta` rechaza un CAF de otro
   emisor o tipo, o un folio fuera de rango.
2. **Parser:** error si un encabezado `CASO-N` no se puede leer como bloque (antes se
   perdía sin avisar) y error con números ambiguos como `1.000,50` (antes → 1). Los sets
   en ISO-8859-1 con tildes salen bien en Node (en el PHP, rotos).
3. **`EnvioBoleta` sin DTE lanza error** (antes armaba un sobre que no valida contra el
   XSD). Se retira el caso `envio-boleta-vacio`.
4. **`ArmadorBoleta` exige la razón social del receptor** (evita el TED con `<RSR></RSR>`
   y el DTE con `<RSR/>`). `GeneradorBoleta` sigue aceptándolo, por paridad.
5. El bin usa `fchResol` distinta en el sobre (`2026-09-05`) y en el RCOF (`2026-09-04`);
   los casos lo replican. **La CLI (fase 7) la toma de un solo valor de config.**
6. `EnvioBOLETA_v11.xsd` y `xmldsignature_v10.xsd` **se quedan como están**: son el
   contenido oficial con tildes de la documentación en ASCII y LF; validan igual
   (diferencias en `data/schemas/README.md`).

Estado de la implementación de 2–4: ✅ (2026-11-06). Los esperados restantes no
cambiaron (sha256 idénticos). Los casos `set-pruebas-bloques` y `set-pruebas-numeros`
quedan como divergencias documentadas (mapa `DIVERGENCIAS` en su test: el PHP entrega
casos y Node lanza el error). Huecos conocidos, iguales que en el PHP: un `caso-2` en
minúsculas sobre su línea `===` mete sus ítems en el caso anterior, y un `CASO-N` en
medio de una línea seguido de `===` abre un bloque.

**Salida:** el set de pruebas completo produce un `EnvioBOLETA` firmado **idéntico** al
del PHP, y el RCOF también. Ambos validan contra `EnvioBOLETA_v11.xsd` (validar con
`xmllint` en CI; conseguir `ConsumoFolio_v10.xsd`, que hoy falta, ver pend. 3).

### Fase 4: Canales de envío (3–4 jornadas) ✅ Lista (2026-11-06; subida REST validada el 2026-11-07)
- [x] API REST (`produccion/boleta-rest.ts`, `ClienteBoletaRest`): semilla, token, envío de
  boleta, consulta de envío (`EstadoEnvioRest`, pend. 1.6), RCOF. 6 casos `http-rest-*`.
- [x] SOAP DTEWS (`certificacion/dtews-soap.ts`, `ClienteDtews`): semilla, token, `DTEUpload`,
  estado de envío. 9 casos `http-dtews-*`.
- [x] `TokenStore` (`comun/token-store.ts`): interfaz, `TokenStoreMemoria` y
  `TokenStoreArchivo` (ruta explícita, escritura atómica 0600). Clave: canal + ambiente +
  empresa + huella del certificado (el token queda atado a quien firmó la semilla). Los
  dos clientes usan la misma API: `solicitarToken()` (sin caché), `obtenerToken(rut)`
  (reutiliza el token < 3000 s, como el PHP), `olvidarToken(rut)`.
- [x] Paridad de requests (§5.3): servidor de captura `paridad/http/servidor-captura.mjs`
  (HTTP y HTTPS con un certificado de prueba para `localhost`); `pnpm paridad:generar` lo
  levanta solo (`paridad/http/generar.mjs`) y el CI también. Multipart idéntico al de
  cURL (4 casos `http-multipart-*`). Receta en `paridad/README.md`.
- [x] Validación en el SII de certificación (§5.4), 2026-11-06, con
  `scripts/validar-certificacion.ts` (detalle en `docs/validaciones.md`): tokens SOAP y
  REST con el certificado real; set de pruebas por DTEUpload → trackId 0263913806,
  **EPR, 5 aceptados de 5**; RCOF por DTEUpload → trackId 0263913808, **RPR (aceptado con
  reparos)**; XSD de ambos validados antes de enviar.
- [x] **Certificación aprobada** (2026-11-06): con el set y el RCOF enviados por Node, la
  empresa quedó autorizada para el ambiente de producción. Los reparos del RCOF no la
  bloquearon. Procedimiento repetible en `docs/certificacion.md`.
- [x] **Pendiente anotado (por decisión del usuario, 2026-11-06), resuelto el 2026-11-07:**
  set subido por REST a pangal (trackId 33887260) → consulta REST **EPR, 5 aceptados de 5**,
  con el CAF que pidió Node en la fase 5. El RCOF por REST recibe **HTTP 404** del SII (la
  misma URL que el PHP; pangal no expone `boleta.electronica.consumo`), lo que calza con que
  el SII eliminó el RCOF desde el 2022-08-01 (§1): ver `docs/validaciones.md`. Texto original: subida REST (pangal) y
  consulta REST de ese envío. La consulta REST no conoce los envíos de DTEUpload ("No
  existe recurso"), así que el canal REST quedó validado solo hasta el token y la consulta.
  Requiere otro CAF de certificación con folios libres (5 por set); ✅ obtenido en la fase 5
  (2026-11-07, folios 31–35, `data/caf/caf-39-31-35.xml`):
  `node scripts/validar-certificacion.ts enviar --canal rest`. Hay que hacerlo antes de
  emitir en producción por REST (fase 8).

Hallazgos y decisiones de la implementación (ninguno cambia bytes firmados ni enviados):
- **Diferencias en el cable, documentadas:** (1) `Connection`: el PHP manda `close` en
  SOAP (`file_get_contents`) y nada en los cURL; Node manda `keep-alive`, y `close` en
  los POST con `conexionNueva` (decisión de arriba). El servidor de captura excluye esta
  cabecera. (2) cURL agrega `Expect: 100-continue` con cuerpos de más de 1 MiB (la
  subida REST no lo suprime; DTEUpload sí) y undici nunca lo envía. (3) `filename` del
  multipart REST: el PHP usaba el nombre del temporal + `.xml`; Node usa `envio.xml` /
  `rcof.xml` (se puede cambiar con `nombreArchivo`).
- **Firma de la semilla SOAP (pend. 1.3/1.8/2.1, paridad primero):** el PHP firma el
  SignedInfo tal como está escrito (sin C14N, con `<X/>`), pone `\n` entre elementos y
  escapa todo con `htmlspecialchars` dentro de `<pszXml>`. Además, `<X509Certificate>`
  lleva el **PEM completo** con BEGIN/END y saltos de línea (los bin le pasan
  `getPublicKey()` como `$publicKeyLimpia`), y el SII lo acepta. Node lo replica byte a
  byte; unificar con `firmarSemilla()` cambia bytes y queda para una tarea aparte,
  validada en maullin.
- **Códigos HTTP (pend. 1.9):** REST exige 200 en todo (el PHP solo en las subidas). SOAP:
  200 sigue; un SOAP fault (HTTP 500 con cuerpo) lanza `ErrorRespuestaSii` con
  faultcode/faultstring; cualquier otro código lanza `ErrorTransporte` (el 503 de maullin
  en el estado se puede reintentar).
- **Mensajes de error:** nunca llevan el token, cookies, PEM ni el XML firmado. El PHP
  incluía la respuesta cruda (que en el canje puede traer el token); ahora solo ESTADO /
  GLOSA o un extracto saneado y truncado.
- **Entradas:** los RUT pasan por `Rut` (un RUT con puntos o `k` minúscula se normaliza;
  el PHP lo enviaba tal cual; un RUT bien escrito sale idéntico); trackId numérico; tokens
  solo ASCII imprimible sin `;`; las subidas reciben los bytes del XML (sin temporales).
- `html_entity_decode` del PHP replicado con la tabla HTML 4.01 completa (1442 cadenas
  comparadas con PHP 8.3, 0 diferencias).
- **Decidido (2026-11-06):** `Accept-Encoding: gzip, deflate` donde el PHP usaba
  `CURLOPT_ENCODING ''` (la lista exacta de cURL depende de cómo esté compilado);
  SOAP y REST se portan con `descomprimir: false`. Los POST que no se pueden
  repetir (DTEUpload, envío REST de boleta y RCOF) van con `conexionNueva: true`;
  el resto reutiliza conexiones. Lo mismo aplica a timbrar folios (fase 5) y a
  grabar la declaración (fase 6).

**Salida:** paridad de requests (§5.3) ✅ (2026-11-06: 19 casos `http-*` idénticos al PHP)
y, en certificación del SII, envío del set de pruebas y del RCOF aceptados, con el estado
consultado por ambos canales ✅ (2026-11-06: set EPR 5/5 y RCOF RPR por SOAP, y
certificación aprobada; REST validado hasta el token y la consulta, y la subida REST el
2026-11-07: set EPR 5/5 por pangal). Pendiente de confirmar en el CI: primera corrida del
servidor de captura en Ubuntu (el PHP de ahí trae otra versión de libcurl).

### Fase 5: Folios (3–4 jornadas) ✅ Lista (2026-11-07)
- [x] `SesionSii` (cookies), login AUT2000 con TLS mutuo y `SolicitudFolios` (2026-11-07):
  `folios/sesion-sii.ts`, `folios/solicitud-folios.ts`, y lo compartido con la
  postulación en `comun/navegacion-sii.ts` (redirecciones, `resolverUrl`,
  `exigirSesionVigente`) y `comun/html.ts` (parser HTML estilo libxml).
- [x] Tests de los candados (`soloAmbiente`, revisión de IDK/RUT/tipo del CAF) con el
  transporte falso (hueco 6.1): `test/unitarios/folios/` (también `soloSii`, hosts
  parecidos, puertos, usuario en la URL, 10 redirecciones, 4 vueltas del paso 2, qué
  errores son `FoliosSinCafError`, `FECHA` en hora de Chile).
- [x] Paridad (§5.2/§5.3): 15 casos `http-folios-*` (login con TLS mutuo y cadena,
  redirecciones, 307, sesión caducada, rechazos, candados, timbraje sin CAF, CAF que no
  cuadra), 6 `html-form-*`, `resolver-url` y `sesion-sii-cookies`. El servidor de
  captura ahora muestra el certificado de cliente (huella y largo de la cadena),
  normaliza el valor de `Accept-Encoding` y, por caso, campos con la hora real
  (`FECHA`). Los 192 esperados anteriores se regeneraron idénticos.
- [x] Solicitud de un CAF real en certificación (§5.4), con el OK del usuario
  (2026-11-07), con `scripts/solicitar-folios.ts` (detalle en `docs/validaciones.md`):
  primero un recorrido sin timbrar (`revisar`), cuyas 3 páginas reales dieron el mismo
  formulario en Node y en el PHP; después la solicitud: **CAF tipo 39, folios 31–35, IDK
  100**, `FA` del día en Chile. Esos 5 folios sirven para el pendiente de la fase 4
  (subida REST).

Hallazgos y decisiones de la implementación (ninguno cambia bytes enviados con las
páginas que se probaron):
- **`<meta charset>` y doble codificación (defecto del PHP, replicado por paridad):**
  el PHP pasa la página a UTF-8 y le antepone `<?xml encoding="UTF-8">`, pero si la
  página declara `charset=iso-8859-1` en un `<meta>`, libxml igual vuelve a leer como
  ISO-8859-1 todo lo que sigue. Los valores con tildes de los formularios (p. ej. un
  `NOMUSU` con tilde) salen doblemente codificados (`Ñ` → `Ã‘`) y así se envían al
  SII. Node hace lo mismo. Corregirlo cambia bytes enviados: queda en §8 para decidir.
  **Confirmado con las páginas reales (2026-11-07):** el asistente declara
  `charset=iso-8859-1`. Hoy no cambia lo enviado para esta empresa (el único valor no
  ASCII es `ACEPTAR`, que se reemplaza), pero un `NOMUSU` con tildes saldría mal.
- **Errores** (pend. 1.2 y 1.9): un CAF que no cuadra después de timbrar lanza
  `FoliosSinCafError` (caso `http-folios-caf-otro-ambiente`, divergencia documentada en
  su test). Se exige HTTP 200: antes de timbrar lanza `ErrorTransporte` (reintentable);
  desde el POST que timbra, cualquier falla es `FoliosSinCafError`. Las fallas de red
  antes de timbrar son `ErrorTransporte` (el PHP lanzaba `SolicitudFoliosException`).
- **Candados más estrictos** (solo cambia el camino de error): además de host y
  https, se rechazan URLs con puerto o usuario. El RUT pasa por `Rut` (valida el DV).
  Cantidad y tipo deben ser enteros positivos.
- Mensajes: el texto del SII se toma con las entidades de HTML 4.01 (el PHP usaba la
  tabla de HTML5); no cambia lo enviado.
- La orden de timbrar va con `conexionNueva` (decisión de la fase 4). Las cookies
  del login (cabeceras y `document.cookie`) se manejan como bytes (latin1), igual que el PHP.
- TLS: undici reanuda sesiones TLS entre conexiones y cURL no. En una sesión
  reanudada no se vuelve a enviar el certificado, pero la identidad es la misma; el
  servidor de captura la desactiva para comparar siempre la cadena completa.
- Una sesión guardada por el PHP (`toArray()`) se carga en Node con
  `SesionSii.desdeArreglo()` y viceversa (mismos campos).

**Salida:** ✅ (2026-11-07) paridad de requests (15 casos `http-folios-*` idénticos al
PHP) y solicitud de un CAF real en certificación (folios 31–35 de boleta).

### Fase 6: Postulación (4–6 jornadas) ✅ Lista (2026-11-07)
- [x] `GwtRpc` / `LectorGwt` con BigInt, `NavegadorSii`, `PostulacionSii`,
  `DeclaracionBoletas`. (Listos el 2026-11-07: `GwtRpc` / `LectorGwt` en
  `postulacion/gwt-rpc.ts`; `NavegadorSii` en `postulacion/navegador-sii.ts`;
  `PostulacionSii` en `postulacion/postulacion-sii.ts`; `DeclaracionBoletas` en
  `postulacion/declaracion-boletas.ts`.)
- [x] Paridad de requests de la postulación (§5.3) (2026-11-07): 18 casos
  `http-postulacion-*` desde páginas sintéticas (`paridad/postulacion/`), más 2
  `html-form-postulacion-*` y 3 `texto-html-*`, idénticos al PHP. Los casos que se
  detienen antes de grabar no tienen el POST a `pe_graba_postulacion`.
- [x] Tests de GWT con respuestas grabadas, incluidos `long` mayores que 2^31 y 2^53
  (2026-11-07): 45 unitarios y 57 casos de paridad `gwt-*` (las 7 llamadas de
  `DeclaracionBoletas` idénticas al PHP, respuestas sintéticas con sus esquemas, `long`
  > 2^31, > 2^53 y ±2^63).

Hallazgos de `GwtRpc` (2026-11-07):
- **Long negativos (defecto del PHP, replicado por paridad):** `long()` no escribe la
  extensión de signo que espera GWT: -1 sale como token vacío, -2 como `$` (el servidor
  lee 62), -64 como `A`. `DeclaracionBoletas` solo envía `long(0)` y Long positivos
  leídos del SII, así que hoy no le afecta. Corregirlo cambia bytes: queda en §8 para
  decidir (caso `gwt-llamada-long-negativos`).
- **Números sin truncar (divergencias intencionales, solo en el camino de error):** un
  decimal leído como entero, índice o Long, un entero > 2^53, un Long numérico de más de
  64 bits, un base64 con caracteres fuera del alfabeto, un Long entre comillas dobles, una
  referencia circular o texto que no es UTF-8 lanzan `ErrorPostulacion` (el PHP truncaba,
  saturaba o seguía). Escribir un `long` ≥ 2^63 lanza (el PHP lo saturaba y lo enviaba).
  Los 8 casos están en `DIVERGENCIAS` de `test/paridad/gwt.test.ts`; los demás casos
  deben quedar sin marcas de truncado.
- Replicado: las rarezas del parser de respuestas (`\u` que se come 4 bytes, `hexdec`
  permisivo, surrogates descartados, comas faltantes o sobrantes, `ctype_space`/`trim`).

**Ronda 2: `DeclaracionBoletas` (2026-11-07).** El sub-agente se detuvo antes de su
verificación final (sin informe); el agente principal revisó el código contra el PHP,
regeneró los 25 casos `http-declaracion-*` con el PHP (idénticos; los 640 esperados, 320
casos, sin cambios por sha256), lo exportó en `index.ts` y dejó todo en verde (1744 tests).
- [x] `DeclaracionBoletas` y `EstadoDeclaracion` (`postulacion/declaracion-boletas.ts`,
  `estado-declaracion.ts`): `estado`, `declarar`, `solicitarRevisionSet`,
  `descargarSetPruebas`, `verificarPortal`. 49 unitarios y 25 casos
  `http-declaracion-*` (estado P90/P91/nulo, declarar OK, sin P90 sin el POST de autorizar,
  incierta, revisión 1/errorEstado/otra, descarga OK/bloqueada/sin set, portal
  vigente/404/faltantes, sesión caducada).
- [x] Validación real (§5.4), **con el OK del usuario** (2026-11-07, detalle en
  `docs/validaciones.md`): `verificar-portal` → portal vigente; `estado` → login OK y
  respuesta sin trámite (empresa ya autorizada). Con `scripts/declaracion.ts`:
  `verificar-portal` (GET público, sin login) y `estado` (login + consulta, solo
  lectura). `descargar-set --confirmar` queda en duda: la empresa ya está autorizada (P91)
  y no se sabe si un set nuevo la afecta en el SII (el script se detiene en P91 salvo con
  `--aunque-autorizada`): el usuario eligió no ejecutarlo. El script no declara ni pide la
  revisión del set.

Decisiones de `DeclaracionBoletas` (ninguna cambia bytes enviados al SII):
- **Declaración incierta:** desde que sale el POST de `autorizarEmpresaBolProd` (con
  `conexionNueva`), cualquier falla (red, HTTP ≠ 200, sesión caducada, redirección fuera
  del host, GWT mal formado, `//EX`, sin P91) es `DeclaracionInciertaError` con la causa.
  En el PHP la red caía en el mismo `catch` porque llegaba envuelta; en Node se captura
  explícitamente. El PHP no miraba el código HTTP de esa respuesta; aquí ≠ 200 es incierta.
- **Códigos HTTP (pend. 1.9):** en cada llamada GWT se revisa primero la sesión (como el
  PHP) y después el código; ≠ 200 es `ErrorTransporte` reintentable (el PHP:
  `PostulacionException`). Igual en `verificarPortal` (≠ 200 y ≠ 404) y en
  `descargarSetPruebas` (≠ 200; con 200 y sin el set sigue siendo `ErrorPostulacion`).
- RUT y trackId inválidos son `ErrorValidacion` (no salen peticiones); el trackId se exige
  sin el salto de línea final que el `$` de PCRE dejaba pasar.
- `estado()` exige un `EstadoAutorizaTo` (el PHP tomaba por posición los campos de
  cualquier DTO); un paso que no cabe en un entero seguro lanza.
- La fecha `d-m-Y` de la declaración sale del reloj inyectable (hora de Chile).

Hallazgos de `NavegadorSii` / `PostulacionSii` (2026-11-07; ninguno cambia bytes enviados):
- **`texto()` con la tabla HTML5 completa** (`comun/entidades-html5.ts`, las 2125
  entidades que decodifica PHP 8.3): en la postulación ese texto decide el flujo
  (rechazo o "ha sido aceptada"), así que no basta la tabla HTML 4.01 de folios. Se
  replican también la máquina de estados de `strip_tags`, el `\s` de PCRE con `/u`
  (incluye `&nbsp;`, U+0085 y U+180E) y el plegado de `mb_stripos`. Comparado con el PHP
  en 160.000 entradas al azar: 0 diferencias. Pendiente de confirmar en el CI que el
  PCRE de Ubuntu da el mismo `\s` (caso `texto-html-entidades`).
- **Errores:** antes de grabar, un HTTP ≠ 200 o una falla de red es `ErrorTransporte`
  (reintentable; el PHP envolvía la red en `PostulacionException` y no miraba el
  código). Desde el POST a `pe_graba_postulacion` (con `conexionNueva`), falla de red o
  HTTP ≠ 200 es `ErrorPostulacion` con la causa y el aviso de que no se sabe si quedó
  grabada (repetir la postulación es seguro). La sesión caducada sigue siendo
  `SesionCaducaError`. En `autenticar`, el error del login llega como
  `ErrorPostulacion` (mismo mensaje del PHP) y la falla de red como `ErrorTransporte`.
- **`<meta charset>`:** en la postulación impide postular con tildes en el nombre del
  software (la confirmación no calza). Replicado. Decisión del usuario (2026-11-07): no se
  corrige y no se usan tildes en esos datos (ver §8).
- **`array_merge`** renumera los campos con nombre entero; la postulación lo replica,
  folios no (brecha de paridad sin efecto con las páginas del SII; ver §8).
- `aviso()` se corta en la primera palabra "Continuar" o "Salir" del texto visible
  (como el PHP; solo afecta el texto que se muestra).
- Los valores se envían en ISO-8859-1 y los nombres de campo en UTF-8, como el PHP (sin
  efecto con los nombres ASCII del SII).

**Salida:** paridad de requests y, en certificación, consulta del estado de declaración
y descarga del set de pruebas. La postulación completa solo si hay un RUT disponible
para hacerla.

**Salida:** ✅ (2026-11-07) paridad de requests (18 `http-postulacion-*`, 25
`http-declaracion-*`, 57 `gwt-*`) y, en certificación, portal vigente y estado de la
declaración consultado con Node. La descarga del set queda sin validar por decisión del
usuario (la empresa ya está autorizada); la postulación y la declaración completas, sin RUT
disponible.

### Fase 7: CLI (2 jornadas) ✅ Lista (2026-11-07)
- [x] `apps/cli`, con comandos equivalentes a los 7 scripts de `bin/`:
  `certificacion enviar-set`, `certificacion enviar-rcof`, `certificacion estado-declaracion`,
  `produccion emitir`, `produccion consultar`, `util firmar-semilla`, `util verificar-ted`.
  `enviar-rcof` queda solo para períodos hasta julio de 2022 (el SII eliminó el RCOF desde
  el 2022-08-01, §1), por `DTEUpload`, y no lo llama ningún otro comando.
  (Listo el 2026-11-07. Binario `sii` (`sii <grupo> <comando>`; desde el código fuente,
  `pnpm sii ...`). Se agregaron 7 comandos más para que el flujo completo de certificación
  se pueda hacer solo con la CLI: `postular`, `descargar-set`, `solicitar-folios`,
  `estado-envio`, `solicitar-revision`, `verificar-portal` y `declarar`.)
- [x] Config desde `.env` validada con zod. Salida con códigos de error consistentes
  (pend. 5). `FchResol`, el CAF y los folios se pasan como parámetros o config, no
  quedan fijos en el código. (Listo el 2026-11-07: `apps/cli/src/config.ts`, `errores.ts`.)

**Implementación (2026-11-07).** El agente principal hizo el esqueleto: despacho con
`util.parseArgs`, contexto inyectable (reloj, transporte, salida), config, códigos de salida
y arnés de tests con `TransporteFalso`. Después, 3 sub-agentes en paralelo con archivos
disjuntos hicieron los comandos de envío, los del portal y los de producción + util.
172 tests de la CLI (más los 1744 del core), typecheck, lint y build en verde. Probado
sin red con la config real: `enviar-set --solo-armar` arma el set y `util verificar-ted`
da los 5 TED OK.

Reglas comunes:
- **Configuración:** `.env` (o `--env <ruta>`) + entorno; el entorno gana. Cada comando
  valida solo lo que usa, todo antes de la primera petición, y el error nombra todas las
  variables que fallan sin mostrar sus valores. Las opciones (`--caf`, `--folio-inicial`,
  `--fch-resol`, `--nro-resol`, `--set`...) reemplazan a las variables. Las rutas del
  `.env` son relativas al `.env`. Variables nuevas en `.env.example`:
  `SII_PRODUCCION_NRO_RESOL`, `SII_PRODUCCION_FCH_RESOL`, `SII_PRODUCCION_CAF_39`
  (y `_41`), `SII_CAF_41` y `SII_CACHE_TOKENS` (caché de tokens entre ejecuciones).
- **Códigos de salida:** 0 OK · 1 error · 2 uso · 3 config/datos de entrada · 4 red/HTTP
  (reintentable) · 5 rechazo del SII · 6 incierto (no repetir sin revisar el SII) ·
  7 verificación fallida.
- **`--confirmar`:** lo exigen todos los comandos que graban algo en el SII (`postular`,
  `descargar-set`, `solicitar-folios`, `solicitar-revision`, `declarar`, `produccion emitir`
  y `enviar-rcof` en producción). Sin `--confirmar` el comando valida todo, muestra lo que
  haría y termina con 0 sin enviar nada. `solicitar-folios` recorre el asistente y se
  detiene antes de timbrar; `emitir` arma y guarda el XML sin ninguna petición.
  `enviar-set` (certificación) envía directo, como el PHP; para ensayar está `--solo-armar`.
- **Archivos:** en `data/output/` junto al `.env`, o en `--salida`. Los bytes se escriben
  tal cual (pend. 1.1).

Decisiones tomadas por los sub-agentes (sin cambio de bytes enviados):
- `produccion emitir`:
  - Producción no tiene resolución por defecto (el PHP tenía 80 / 2014-08-22 fijos).
  - El `--boleta` es un JSON estricto, validado con zod.
  - Cada envío deja `boleta-<ambiente>-<folio>.envio.json`. Mientras exista, ese folio no
    se vuelve a armar ni a enviar.
  - Si el envío queda en duda (corte de red, 5xx), el folio queda bloqueado y sale con 6.
- `postular` rechaza textos que no son ASCII imprimible (decisión del usuario sobre
  `<meta charset>`, §8). `declarar` no lo exige porque va por GWT en UTF-8.
- `enviar-rcof` arma el RCOF desde un sobre guardado (`--sobre`). Se niega a enviar
  períodos desde 2022-08-01 salvo con `--aunque-no-obligatorio`, y solo usa DTEUpload.
- `descargar-set` se detiene en P91 salvo con `--aunque-autorizada`, y nunca pisa un set
  existente.
- `verificar-ted` verifica con `<RSASK>` como el PHP y avisa (código 7) si no calza con
  `<RSAPK>`.

- [x] Validación real (§5.4), **con el OK del usuario** (2026-11-07, detalle en
  `docs/validaciones.md`). Todas las consultas terminaron con código 0:
  - `verificar-portal`: portal vigente.
  - `estado-declaracion`: login OK y sin trámite (empresa autorizada).
  - `estado-envio 33887260` (subida REST): EPR 5/5 por REST y `-11` por SOAP.
  - `estado-envio 0263913806` (DTEUpload): EPR 5/5 por SOAP y "No existe recurso" por REST.

  A partir de esto, `estado-envio` ahora explica el `-11` (test nuevo; 173 tests de la CLI).
- [x] Envío completo con la CLI, **con el OK del usuario** (2026-11-10):
  - `solicitar-folios --confirmar` timbró un CAF de certificación nuevo (tipo 39, folios 36–40).
  - `enviar-set` lo envió por DTEUpload (trackId 0263994364).
  - `verificar-ted` dio 5 TED OK.
  - `estado-envio` dio **EPR, 5 de 5 aceptadas**.

  Sin validar, a propósito:
  - `postular`, `descargar-set`, `solicitar-revision` y `declarar`: la empresa ya está
    en P91, igual que en la fase 6.
  - `produccion emitir`: es de la fase 8.

**Salida:** se ejecuta el flujo completo de certificación de boleta solo con la CLI.
✅ (2026-11-07) Todos los pasos existen como comandos y están probados con el SII falso.
Contra el SII de certificación, solo con la CLI, funcionaron:
- las consultas (portal, login y estado de la declaración, estado de envíos por SOAP y REST;
  2026-11-07);
- el envío completo (2026-11-10): folios nuevos 36–40 → set por DTEUpload → **EPR 5/5**.

### Fase 8: Piloto en producción y corte (2–3 jornadas + período de observación) 🟡 En curso (desde 2026-11-10)

**Decisiones del usuario (2026-11-10):**
1. El PHP **no emite en producción**: el piloto se hace **solo con Node** (unas pocas
   boletas reales de bajo riesgo), sin comparación en paralelo con el PHP.
2. El CAF de producción se pide **con la CLI**: `solicitar-folios --ambiente produccion`
   (palena). El core ya lo permitía; la CLI solo usaba certificación.
3. **Sin versionamiento ni publicación:** se quita la tarea de publicar una versión.

- [x] Herramientas del piloto (2026-11-10, sin hablar con el SII; probadas con el SII falso):
  - `sii certificacion solicitar-folios --ambiente produccion`: recorre el asistente de
    palena; sin `--confirmar` se detiene antes de timbrar. En producción `--cantidad` es
    obligatoria y el CAF se guarda como `caf-produccion-<tipo>-<desde>-<hasta>.xml`, con
    la sugerencia de `SII_PRODUCCION_CAF_<tipo>`. Los candados de `SolicitudFolios` (host,
    IDK 300, empresa y tipo) van atados al ambiente. 5 tests nuevos.
  - `sii produccion seguimiento` (solo lectura): lee los registros
    `boleta-<ambiente>-<folio>.envio.json` de `emitir`, consulta cada trackId con un solo
    token e imprime la tabla de estados. `--bitacora <archivo.jsonl>` agrega una línea por
    envío y consulta (historial del período de observación); `--desde`, `--json`,
    `--salida`. Salida: 5 si hay rechazos (gana), 6 si hay registros inciertos o
    ilegibles, 4 si falló una consulta, 0 si todo está aceptado (con o sin reparos) o en
    proceso. 13 tests nuevos.
  - Procedimiento del piloto: `docs/piloto-produccion.md` (requisitos, ensayo sin
    `--confirmar`, `verificar-ted` con el CAF de producción, emisión, consulta,
    seguimiento diario, qué hacer con un rechazo o un envío incierto, bitácora).
- [ ] Emitir boletas reales de bajo riesgo con Node (solo Node, decisión 1). Revisar los
  estados del SII durante 1–2 semanas. Requiere el OK explícito del usuario en cada paso
  que toca producción. Pasos previos sugeridos, de menor a mayor riesgo:
  1. ✅ (2026-11-10) `solicitar-folios --ambiente produccion --cantidad 5 --folio-inicial 1`
     **sin** `--confirmar`: login y asistente de palena hasta la confirmación, **folios 1 a
     5** ofrecidos, sin timbrar (`docs/validaciones.md`). El primer intento se detuvo: en
     el primer timbraje de producción el SII pide "Ingrese Folio Inicial" y el código (como
     el PHP) mandaba `FOLIO_INICIAL=0`. Corregido con la decisión del usuario: opción
     `folioInicial` en `SolicitudFolios.solicitar` y `--folio-inicial` en la CLI; solo va
     en esa página y sin ella lanza `FolioInicialRequeridoError` sin enviarla. Sin cambios
     en los demás pasos (320 casos de paridad idénticos). 4 tests nuevos en el core y 3 en
     la CLI;
  2. ✅ (2026-11-10) lo mismo con `--confirmar`: **CAF de producción tipo 39, folios 1–5**,
     IDK 300, en `data/caf/caf-produccion-39-1-5.xml` y en el `.env`
     (`SII_PRODUCCION_CAF_39`);
  3. ✅ (2026-11-10) resolución de producción del portal del SII: **N° 80 del 2014-08-22**
     (en el `.env`). `produccion emitir --folio 1` sin `--confirmar` (sin red) +
     `util verificar-ted --caf data/caf/caf-produccion-39-1-5.xml`: **1 TED OK**; el sobre
     valida contra `EnvioBOLETA_v11.xsd`. `data/piloto/` se agregó a `.gitignore`;
  4. ✅ (2026-11-10) la primera boleta con `--confirmar`: 1 × "Cable USB" a $1.190, folio 1,
     **trackId 24566880452 → EPR, 1 aceptada, 0 rechazos, 0 reparos**. Bitácora iniciada
     en `data/piloto/bitacora.jsonl` (`produccion seguimiento`).
  5. ⬜ Período de observación (1–2 semanas, desde el 2026-11-10): `produccion seguimiento
     --bitacora data/piloto/bitacora.jsonl` una vez al día. Criterio de salida: 0 rechazos
     atribuibles a la migración. Boletas 2–5 emitidas el 2026-11-10 (1 × "Cable USB" a
     $1.190 cada una; trackIds 24567048084, 24567048323, 24567048640, 24567048966): **las
     5 del piloto en EPR, aceptadas sin reparos**. CAF 1–5 usado completo.
     Automatizado el 2026-11-10: `scripts/seguimiento-diario.ps1` (log en
     `data/piloto/seguimiento.log`, alertas en `data/piloto/ALERTAS.txt`) con la tarea
     programada de Windows "SII seguimiento piloto", diaria a las 09:00 hasta el
     2026-11-24. Probada desde el Programador (resultado 0) y con un error forzado (código
     3 en el log y en `ALERTAS.txt`).
- [x] Documentación en `docs/` (port de `docs/` del PHP, ajustado) (2026-11-10, 2
  sub-agentes en paralelo): índice `docs/README.md`; uso: `guia-de-uso.md`,
  `configuracion.md`, `cli.md` (15 comandos y equivalencias con `bin/`),
  `solucion-de-problemas.md`, `glosario.md`; API de la librería: `core.md`, `canales.md`,
  `folios.md`, `postulacion.md`, `tests.md`, `migracion-desde-php.md`. Los ejemplos de
  código se compilaron contra `packages/core/src/index.ts`. `docs/certificacion.md` y el
  `README.md` raíz, actualizados. `docs/pendientes.md` del PHP no se porta: su
  seguimiento es §8 de este plan.
- [ ] `certificacion-core` queda en modo mantenimiento: solo arreglos críticos, que también
  se aplican a Node.

Incoherencias menores encontradas al documentar (2026-11-10). Corregidas: ayuda de
`emitir` (cuándo sale 4 y cuándo 6), ayuda de `enviar-rcof` (se niega desde el mismo
2022-08-01), `.env.example` (`SII_CORREO_PROVEEDOR` lo usan también `descargar-set` y
`declarar`), §2, §3 y §7 de este plan. Sin corregir (cambian comportamiento; por decidir):
- `SesionCaducaError` sale con 5 (rechazo del SII), aunque se arregla autenticando de
  nuevo; `descargar-set` en P91 sale con 1 (no clasificado).
- `estado-envio` exige `SII_RUT_FIRMA` aunque no lo usa.
- API: `ClienteBoletaRest` exige la clase `Certificado` y `ClienteDtews` acepta cualquier
  objeto con los mismos campos; `SolicitudFolios.solicitar` rechaza cantidad o tipo
  inválidos con `ErrorSolicitudFolios` y no con `ErrorValidacion`.
- `--help` no existe (la ayuda es `--ayuda` / `-h`) y sale con 2 y un mensaje en inglés
  de `parseArgs`.

**Salida:** 0 rechazos atribuibles a la migración durante el período de observación.

**Estimación total:** unas 25–35 jornadas de una persona. Es una estimación gruesa; el
mayor riesgo de desvío está en las fases 2 (C14N/serialización) y 6 (GWT/HTML).

---

## 7. Diseño de la API (lineamientos)

- **Bytes en los bordes:** las funciones que producen algo para enviar al SII devuelven
  `Buffer` (ISO-8859-1 cuando corresponde). Internamente se trabaja con strings
  Unicode. Nunca se mezclan strings con bytes "latin1", como pasa hoy en PHP, donde
  todo es string de bytes.
- **Dependencias inyectables** por constructor: `transporte`, `reloj`, `tokenStore`.
  Así todo se puede probar sin red y la interfaz web puede controlar timeouts. (Un
  `logger` inyectable estaba previsto, pero ninguna clase lo recibe todavía: queda para
  la interfaz web, §10.)
- **Asíncrono:** todo lo que habla con el SII es `async`. La firma y el timbre son
  síncronos.
- **Errores tipados:** `SiiError` → `ErrorCertificado`, `ErrorFirma`, `ErrorTransporte`
  (con código HTTP), `ErrorRespuestaSii` (con el estado y la glosa del SII),
  `SesionCaducaError`, `FoliosSinCafError`, `DeclaracionInciertaError`, etc. Los
  mensajes nunca incluyen material PEM ni contraseñas.
- **Sin estado global ni archivos implícitos:** nada escribe en `data/output` por su
  cuenta; quien llama decide dónde guardar.
- **Nombres en español**, como el original (`generarTed`, `firmarDte`, `empaquetar`),
  para que el mapeo con la documentación existente sea directo.

---

## 8. Qué pasa con `docs/pendientes.md` del PHP

| Pendiente | Tratamiento en Node | Estado |
|---|---|---|
| 1.1 Doble conversión a ISO-8859-1 en `bin/` | **Desaparece** (la API devuelve `Buffer`; la CLI no reconvierte) | ✅ fase 7 (2026-11-07): la CLI escribe los bytes tal cual |
| 1.2 `revisarCaf()` fuera del `try` | **Se corrige** en el port | ✅ fase 5 (2026-11-07): un CAF que no cuadra lanza `FoliosSinCafError` (caso `http-folios-caf-otro-ambiente`) |
| 1.3 / 1.8 / 2.1 Firma de semilla SOAP propia y no canónica | **Paridad primero.** Unificar con `firmarSemilla()` en una tarea posterior, validada en maullin | 🟡 paridad lista (fase 4, `firma-semilla-dtews.ts`); falta unificar (cambia bytes: decisión + maullin) |
| 1.4 Caché de token global en archivo | **Se corrige:** `TokenStore` inyectable, con clave empresa+ambiente | ✅ fase 4 (2026-11-06): clave canal + ambiente + empresa + huella del certificado; memoria y archivo |
| 1.5 `exento` con `=== true` vs `empty()` | **Desaparece:** `exento: boolean` tipado. Verificar en paridad que el reparto del descuento coincide | ✅ fase 3 (2026-11-06): un valor no booleano lanza `ErrorValidacion`; caso `boleta-*` con exentos y descuento idéntico al PHP |
| 1.6 Estado REST sin tipar | **Se corrige:** `EstadoEnvioRest` | ✅ fase 4 (2026-11-06) |
| 1.7 `openssl_sign` sin revisar | **Desaparece:** `crypto.sign` lanza error | ✅ fase 2 (`firmarSemilla`, `firmarDte` y `Timbre` lanzan `ErrorFirma` / `ErrorTimbre`) |
| 1.9 Códigos HTTP sin revisar | **Se corrige:** el transporte valida el estado | ✅ REST y SOAP (fase 4), folios (fase 5: HTTP 200 en el login y en cada paso), la postulación (fase 6: HTTP 200 en cada página) y `DeclaracionBoletas` (fase 6: HTTP 200 en cada llamada GWT; ≠ 200 en la orden de declarar es incierta) revisan el código |
| 2.2 Navegación duplicada | Se unifica el bucle de redirecciones, `resolverUrl` y `sesionVigente`; las dos reglas de `form()` siguen separadas | ✅ `comun/navegacion-sii.ts` usado por folios (fase 5) y por `NavegadorSii` (fase 6, 2026-11-07), que comparten `PostulacionSii` y `DeclaracionBoletas` |
| 2.3 RUT en tres lugares | `comun/rut.ts` único y validado en todas las entradas | ✅ `comun/rut.ts` listo y usado en `Datos*` y en `GeneradorBoleta` (fase 3) en los clientes REST y SOAP (fase 4) y en folios (fase 5) y en `PostulacionSii` y `DeclaracionBoletas` (fase 6) |
| 2.4 Multipart repetido | Helper compartido | ✅ fase 4 (2026-11-06): `armarMultipart`, idéntico a cURL |
| 2.5 Armado DTE en scripts | `ArmadorBoleta` | ✅ fase 3 (2026-11-06) |
| 3 Código muerto | No se porta (`WSDL`, propiedades sin uso, ramas `Libro`/`getToken` de `firmarDte` salvo que una app las use) | 🟡 ramas `Libro`/`getToken` no portadas (fase 2); `WSDL` y el caché de token en archivo no portados (fase 4); el resto en fases 5–6 |
| 4 Docs desactualizadas | Se reescriben en `docs/` | ✅ fase 8 (2026-11-10): 12 documentos nuevos en `docs/` (índice en `docs/README.md`) |
| 5 Datos fijos en `bin/` | La CLI lo resuelve con config | ✅ `resumirParaRcof` calcula los montos del RCOF desde los DTE (fase 3); fase 7 (2026-11-07): CAF, folios, resolución (una sola `fchResol` para sobre y RCOF), set y datos del emisor vienen del `.env` validado con zod o de opciones; códigos de salida tipados |
| 6.1 Huecos de tests | Se cubren: `SesionSii`, GWT, `NavegadorSii`, candados de folios, clientes SOAP/REST | ✅ transporte HTTP y clientes SOAP/REST (fase 4), `SesionSii`, navegación y candados de folios (fase 5) cubiertos; GWT (45 unitarios + 57 casos), `NavegadorSii` (40), `PostulacionSii` (54) y `DeclaracionBoletas` (49 + 25 casos) cubiertos (fase 6, 2026-11-07) |
| 6.2 Tests frágiles por la fecha y RSA 2048 | Reloj inyectable; generador de llaves de cualquier tamaño | ✅ reloj (fase 1) y generador de llaves, certificados, .pfx y CAF (fase 2) |
| Nuevo (fase 2): orden de la cadena TLS | Con un .pfx **no legacy** (AES/3DES) que trae intermedios, el PHP arma la cadena del handshake como hoja → raíz → intermedia (toma los intermedios desde el final). Node lo reproduce por paridad. Los .pfx del SII (legacy) no se ven afectados (confirmado con el .pfx real el 2026-11-06, ver `docs/validaciones.md`). Corregirlo cambia lo que se envía al SII: **decisión del usuario**, con validación en certificación | ⬜ por decidir. Desde la fase 5 el login de folios usa TLS mutuo (la paridad muestra la cadena enviada: `http-folios-completo` con un .pfx legacy); el .pfx real es legacy y no se ve afectado |
| Nuevo (fase 2): `toPem()` repite la hoja en Windows | Defecto del PHP **solo en Windows**, con un .pfx legacy que trae intermedios. La salida de `openssl` llega por las tuberías de `proc_open` con CRLF; `extractPemBlock()` pasa la llave y la hoja a LF, pero la cadena (`$rawChain`) no. Entonces `toPem()` no reconoce la hoja dentro de la cadena y la escribe dos veces, aunque `docs/core.md` del PHP promete "sin duplicados". En Linux el PHP no tiene el defecto. **Node se corrige sin cambiar bytes enviados al SII:** `aPem()` sigue a Linux (el CI lo compara byte a byte), `toPem()` no se envía al SII y nada en `src/` ni `bin/` lo usa. Un PEM guardado por el PHP de Windows se carga en Node igual que en el PHP (con la hoja dos veces en la cadena). Solo si algún sistema compara byte a byte PEM guardados por el PHP de Windows haría falta una opción explícita (p. ej. `aPem({ comoPhpWindows: true })`) | ✅ corregido en el port (2026-11-06); visto con el .pfx real (ver `docs/validaciones.md`) |
| Nuevo (fase 5): `<meta charset>` vuelve a decodificar la página | Con una página del asistente en ISO-8859-1 que lo declara en un `<meta>`, libxml lee como ISO-8859-1 el UTF-8 que le entrega el PHP: los valores con tildes de los formularios se reenvían al SII doblemente codificados. Node lo replica (caso `html-form-codificacion`). Corregirlo cambia lo que se envía al SII: **decisión del usuario**. Confirmado el 2026-11-07: las páginas reales declaran `charset=iso-8859-1`; hoy solo afecta a `ACEPTAR` (que se reemplaza), pero afectaría a un `NOMUSU` con tildes. **En la postulación (fase 6, 2026-11-07) es peor:** si la confirmación declara `charset=iso-8859-1` y repite un `NOM_SW` con tildes, el PHP lo lee doblemente codificado (`SeÃ±al`), la confirmación no calza y la postulación se detiene sin grabar; en la práctica no se puede postular con tildes en el nombre del software. Los hidden con tildes se reenvían doblemente codificados (`Ñ` → `%C3%91`). Casos `http-postulacion-meta-charset` y `-meta-charset-confirma` | ✅ decidido (2026-11-07): **no se corrige**; en los datos que se envían a los asistentes (nombre de software y demás campos de la postulación, `NOMUSU` de folios) **no se usan tildes**. Así el PHP y Node envían lo mismo y no hace falta validar un cambio de bytes en certificación |
| Nuevo (fase 8): `FOLIO_INICIAL=0` fijo en folios | En el primer timbraje de un tipo de documento el SII pide "Ingrese Folio Inicial"; el PHP manda siempre `FOLIO_INICIAL=0` y el SII repite la página, así que el PHP no puede hacer el primer timbraje de producción (visto en palena el 2026-11-10) | ✅ decidido y hecho (2026-11-10): opción `folioInicial` / `--folio-inicial`, que solo se envía en esa página; sin ella, `FolioInicialRequeridoError` antes de enviarla. Sin cambio de bytes en los demás casos. Validado en palena sin timbrar |
| Nuevo (fase 6): `array_merge` renumera campos con nombre entero | El PHP renumera desde 0 los campos de formulario con nombre entero (`name="7"` se envía como `0=`). La postulación lo replica (`combinarComoArrayMerge`, caso `http-postulacion-campos-numericos`), pero `combinar` de folios no: brecha de paridad en folios que solo aparece con nombres numéricos (el SII no los usa). Alinearlo con el PHP cambia bytes solo en ese caso | ⬜ por decidir (sugerido: replicarlo también en folios por paridad) |
| Nuevo (fase 6): `long()` de GWT con negativos | `GwtRpc::longBase64` corta en -1 en vez de escribir los 64 bits en complemento a dos como Java: -1 sale como token vacío, -2 como `$` (el servidor lee 62), -64 como `A`. Node lo replica (caso `gwt-llamada-long-negativos`). Hoy no afecta: `DeclaracionBoletas` solo envía `long(0)` y Long positivos leídos del SII. Corregirlo (p. ej. -1 → `P__________`) cambia bytes enviados: **decisión del usuario**, con validación en certificación | ⬜ por decidir |
| 6.4 Timeouts/TLS/zona horaria/tipos | Timeouts unificados (conexión 10 s, respuesta 45 s), TLS verificado siempre, `America/Santiago` explícito, entradas tipadas. **Truncar RSR:** solo después de verificar contra el XSD y con una decisión explícita (cambia bytes) | 🟡 timeouts, TLS, zona horaria y entradas tipadas de los generadores (`GeneradorBoleta`, RCOF; fase 3) listos; falta lo de RSR |

Regla general: **todo lo que cambia bytes enviados al SII queda fuera de la paridad y
se hace después, en un PR propio, con validación en certificación.**

---

## 9. Riesgos

| Riesgo | Prob. | Impacto | Mitigación | Estado |
|---|---|---|---|---|
| C14N de `xml-crypto` difiere de libxml en un caso límite (namespaces heredados, `xmlns:xsi`) | Media | Alto | Golden tests desde la fase 2; C14N propio como plan B | ✅ Ocurrió y se resolvió (fase 1): C14N propio, 32 casos idénticos a libxml; `xml-crypto` se quitó |
| El serializador no reproduce `formatOutput` de libxml | Media | Alto | Fase 1 dedicada; se compara contra árboles generados por PHP | ✅ Mitigado (fase 1): 21 casos idénticos |
| La versión de libxml del CI (Ubuntu) difiere de la que generó los esperados (2.10.4, Windows) | Media | Medio | El job de paridad imprime la versión, muestra el primer byte distinto y sube los esperados regenerados | ⬜ Por confirmar al subir |
| El PHP del CI (Ubuntu) lee .pfx RC2 de forma nativa y no cae al binario `openssl`: los esperados `certificado-pfx-legacy*` cambiarían en un `\n` final | Baja | Bajo | El job de paridad lo detecta; no afecta lo enviado al SII | ⬜ Por confirmar al subir |
| `long` de GWT corrupto por usar operaciones de 32 bits | Alta si se porta literal | Alto | `BigInt` obligatorio; tests con valores > 2^31 y > 2^53 | ✅ Mitigado (fase 6, 2026-11-07): `gwt-rpc.ts` con BigInt y desborde de 64 bits como PHP/Java; casos con > 2^31, > 2^53 y ±2^63 |
| Multipart de undici distinto al de cURL y el SII lo rechaza | Media | Medio | Servidor de captura (§5.3); armar el multipart a mano si hace falta | ✅ Mitigado (fase 4): multipart a mano, idéntico a cURL en el cable; DTEUpload aceptado por el SII en certificación (2026-11-06). Subida REST real aceptada por el SII (2026-11-07, EPR 5/5) |
| HTML del SII parseado distinto (parse5 vs libxml) | Media | Medio | Fixtures de páginas reales; tests de `form()` | 🟡 Mitigado en la fase 5: parser propio con las reglas de libxml, 74 páginas de prueba idénticas al PHP (`html-form-*`) y el flujo completo con páginas sintéticas al estilo del SII. Contrastado con las páginas reales del asistente en maullin (2026-11-07): las 3 dan el mismo formulario que el PHP |
| SHA1 bloqueado por el OpenSSL del sistema | Baja | Alto | Binarios oficiales de Node o imagen Docker oficial; test de arranque que firme con SHA1 | ✅ Mitigado: SHA1 OK en la prueba de humo y test de arranque (fase 2) |
| TLS mutuo / servidores antiguos del SII con OpenSSL 3 | Baja | Alto | Prueba de humo en la fase 0 | ✅ Descartado (fase 0): los 5 hosts OK sin relajar OpenSSL |
| El PHP cambia durante la migración | Media | Medio | Congelar en `v1.9.1`; el job de CI de paridad detecta diferencias | ✅ Mitigado (fase 0) |
| Fixtures con datos reales (RUT, cookies, tokens) | Media | Alto | Anonimizar antes de versionar; revisión en el PR; `.gitignore` para `data/certs`, `data/caf`, `.env` | 🟡 `.gitignore` listo; fixtures de las fases 4 y 5 anonimizados (material de prueba; las páginas del asistente son sintéticas, sin RUT ni cookies reales); los de la fase 6 hasta ahora también (páginas sintéticas de la postulación con RUT de prueba y correos de `empresa-prueba.cl`; respuestas GWT sintéticas) |

---

## 10. Después de la migración: interfaz Next.js (fuera del alcance de este plan)

- `apps/web` con Next.js (App Router). Los Route Handlers y Server Actions usan
  `@winex/certificacion` con `export const runtime = 'nodejs'` (no Edge).
- El `.pfx` y su contraseña **nunca llegan al navegador**: se suben una vez, se guardan
  cifrados (AES-256-GCM, con la llave en una variable de entorno o un KMS) y se
  descifran solo en el servidor al firmar.
- Las operaciones largas (postulación, solicitud de folios, espera de estado del envío)
  van a una **cola de trabajos** con reintentos y estado consultable, no a un request
  HTTP bloqueante.
- Pantallas iniciales: certificados y CAF, avance de la certificación (set → revisión →
  declaración; sin RCOF, eliminado por el SII desde el 2022-08-01), emisión de boletas y
  consulta de envíos.

---

## 11. Licencia y atribución

El original es **Apache-2.0**, © 2026 Meniaz (William Menares). El port es una obra
derivada, por lo tanto:

- incluir `LICENSE` (Apache-2.0) y conservar el `NOTICE` original, agregando una línea
  sobre el port a Node.js;
- indicar en los archivos portados que derivan de `winex/certificacion` y que fueron
  modificados (Apache-2.0 §4(b));
- los XSD y el texto del set de pruebas pertenecen al SII y se redistribuyen como
  referencia, igual que en el original;
- el paquete no se publica (decisión del usuario, 2026-11-10): `@winex/certificacion` es
  solo el nombre interno del workspace. Si algún día se publica, antes hay que confirmar
  con el autor original el uso del scope `winex`.

---

## 12. Primeros pasos concretos

- [x] `cd sii/certificacion-node && git init && pnpm init`, y crear el workspace (§3).
- [x] `cd ../certificacion-core && git tag` para confirmar `v1.9.1`, y `composer install`
   (lo necesita el generador de paridad).
- [x] Escribir `paridad/php/generar.php` con el caso `firmarSemilla` y su golden test en
   Node. Esto valida toda la cadena de paridad desde el primer día.
- [x] Prueba de humo de TLS mutuo contra el ambiente de certificación del SII.
- [x] Empezar la fase 1. (Lista el 2026-11-06; sigue la fase 2.)
- [x] Fase 2 (compuerta criptográfica) superada el 2026-11-06; sigue la fase 3.
- [x] Fase 3 (documentos) lista el 2026-11-06, con las decisiones del usuario aplicadas;
  sigue la fase 4.
- [x] Fase 4 (canales) lista el 2026-11-06: clientes en paridad, set aceptado y
  certificación aprobada con Node (empresa autorizada para producción). Pendiente anotado:
  subida REST en certificación. Sigue la fase 5.
- [x] Fase 5 (folios) lista el 2026-11-07: paridad de requests y CAF real obtenido en
  certificación con Node (folios 31–35). Sigue la fase 6.
- [x] Subida REST de la fase 4 validada el 2026-11-07 (set EPR 5/5 por pangal). El RCOF por
  REST recibe 404 del SII. Resuelto el mismo día: el SII eliminó el RCOF desde el 2022-08-01;
  no se envía en el flujo normal y queda solo para períodos hasta julio de 2022 (§1).
- [x] Fase 6 (postulación) lista el 2026-11-07: `GwtRpc`, `NavegadorSii`, `PostulacionSii` y
  `DeclaracionBoletas` en paridad (320 casos, 1744 tests); portal y estado validados en el
  SII real. Sigue la fase 7 (CLI).
- [x] Fase 7 (CLI) lista el 2026-11-07: binario `sii`, 14 comandos, 173 tests. Consultas
  validadas en el SII de certificación. Sigue la fase 8 (piloto en producción).
- [ ] Fase 8 (piloto) en curso desde el 2026-11-10: folios de producción en la CLI,
  `produccion seguimiento`, `docs/piloto-produccion.md` y documentación completa. Falta
  el piloto real (con el OK del usuario) y el período de observación.
