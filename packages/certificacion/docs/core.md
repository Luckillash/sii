# Core: certificado, firma, timbre y boleta

API de `@winex/certificacion` para armar y firmar boletas: `Certificado`,
`FirmaElectronica`, `Timbre`, `GeneradorBoleta`, `ArmadorBoleta` y `EnvioBoleta`, más las
utilidades de `comun/` que se exportan (RUT, ambiente, reloj, codificación y errores).
Todo se importa desde la raíz del paquete:

```ts
import { ArmadorBoleta, Certificado, EnvioBoleta, FirmaElectronica } from '@winex/certificacion';
```

Los canales de envío están en [canales.md](canales.md); folios en [folios.md](folios.md);
postulación y declaración en [postulacion.md](postulacion.md). Si vienes del PHP, ver
[migracion-desde-php.md](migracion-desde-php.md).

## Reglas comunes

- **Bytes en los bordes.** Lo que se firma o se envía al SII sale como `Buffer`, en
  ISO-8859-1 cuando el XML lo declara. No hay que convertirlo: se escribe o se envía tal
  cual. Los datos de entrada son strings normales de JavaScript (Unicode).
- **Síncrono.** Firma, timbre y armado son síncronos. Solo `Certificado.desdeArchivo` es
  `async` (lee el archivo).
- **Hora inyectable.** Todo lo que estampa hora (`FchEmis`, `TSTED`, `TmstFirma`,
  `TmstFirmaEnv`) recibe un `reloj` opcional y escribe la hora de Chile
  (`America/Santiago`), sin importar la zona del servidor.
- **Errores tipados.** Todo deriva de `SiiError` (ver [Errores](#errores)). Los mensajes
  no traen PEM, contraseñas, tokens ni rutas; el detalle técnico va en `cause`.
- **Paridad.** La salida es byte a byte la del PHP v1.9.1 (golden tests, ver
  [tests.md](tests.md)).

## Flujo de una boleta

```
Certificado.desdeArchivo()        → llave + certificado
new FirmaElectronica(llave, cert)
ArmadorBoleta.armar(datos, caf)   → GeneradorBoleta → Timbre.generarTed → TED + <TmstFirma> → firmarDte('#F{folio}T{tipo}')
EnvioBoleta.empaquetar([dtes])    → <EnvioBOLETA> firmado con '#SetDoc'
```

`ArmadorBoleta` hace lo que en el PHP hacía cada script de `bin/` a mano (generar, timbrar,
insertar el TED con `str_replace` y firmar).

```ts
import { readFile } from 'node:fs/promises';
import { ArmadorBoleta, Certificado, EnvioBoleta, FirmaElectronica } from '@winex/certificacion';

const certificado = await Certificado.desdeArchivo('/ruta/certificado.pfx', claveDelPfx);
const firmador = new FirmaElectronica(certificado.llavePrivada, certificado.certificado);
const caf = await readFile('/ruta/caf-39-1-10.xml');

const emisor = {
  rut: '76123456-0',
  razonSocial: 'EMPRESA DE PRUEBA SPA',
  giro: 'VENTA AL POR MENOR DE ARTICULOS DE PRUEBA',
  direccion: 'CALLE FALSA 123',
  comuna: 'SANTIAGO',
};

const dte = new ArmadorBoleta(firmador).armar(
  {
    emisor,
    receptor: { rut: '66666666-6', razonSocial: 'Cliente General' },
    folio: 1,
    detalles: [{ nombre: 'Producto', cantidad: 1, precio: 1190 }],
  },
  caf,
);

const sobre = new EnvioBoleta(firmador, {
  rutEmisor: emisor.rut,
  rutEnvia: '11111111-1',
  nroResol: 0,
  fchResol: '2026-09-04',
}).empaquetar([dte]); // Buffer ISO-8859-1, listo para ClienteDtews o ClienteBoletaRest
```

---

## `Certificado`

Carga el certificado digital (.pfx/.p12 o PEM). El .pfx se lee con `node-forge`, también
con el cifrado legacy RC2-40 de los .pfx del SII, **sin el binario `openssl`**.

| Construcción | Qué hace |
|---|---|
| `static async desdeArchivo(ruta: string, clave = ''): Promise<Certificado>` | Lee el archivo y llama a `desdeContenido`. Si no se puede leer: `ErrorCertificado` sin la ruta en el mensaje (los .pfx suelen llevar el RUT en el nombre); la ruta queda en `cause` |
| `static desdeContenido(contenido: Uint8Array \| string, clave = ''): Certificado` | Bytes de un .pfx, o un PEM con la llave y el certificado (y opcionalmente intermedios). Un `string` solo puede ser PEM. `clave` es la contraseña del .pfx o la passphrase de la llave del PEM |

| Miembro | Devuelve |
|---|---|
| `llavePrivada: string` | Llave privada en PEM, sin cifrar (PKCS#8) |
| `certificado: string` | Certificado del titular (la hoja) en PEM |
| `cadena: string` | Hoja + intermedios en PEM. Si solo venía la hoja, igual a `certificado`. Es lo que se presenta en el TLS mutuo |
| `identidadTls(): IdentidadTls` | `{ cert: cadena, key: llavePrivada }`, para el transporte HTTP |
| `aPem(): string` | Llave (sin cifrar) + hoja + intermedios, sin repetidos y la hoja primero. Para guardar un .pfx ya convertido: cifrarlo en reposo es tarea de quien lo guarda |
| `info(): InfoCertificado` | `{ cn, vigenteDesde, vigenteHasta }`; fechas `YYYY-MM-DD HH:MM:SS` en hora de Chile, `null` si no se pueden leer |
| `static sinMaterialPem(salida: string): string` | Texto apto para logs: sin bloques PEM (aunque vengan cortados), sin atributos de bolsa de `openssl pkcs12` ni líneas base64 largas |

Errores (`ErrorCertificado`):

| Mensaje (inicio) | Causa |
|---|---|
| `No se pudo leer el archivo del certificado…` | ruta inexistente o sin permisos |
| `El contenido no es un PEM…` | se pasó un `string` que no es PEM (un .pfx va como `Buffer`) |
| `El PEM no trae la llave privada.` / `…no contiene el bloque CERTIFICATE.` | PEM incompleto |
| `El PEM no tiene una llave privada legible…` | llave cifrada sin passphrase o con otra |
| `No se pudo abrir el .pfx: la contraseña es incorrecta.` | MAC del .pfx inválido |
| `No se pudo leer el .pfx: el archivo está dañado o usa un cifrado no soportado.` | archivo roto, o cifrado RC2-128, RC4 o 3DES de 2 llaves (raros) |
| `El .pfx no trae la llave privada.` / `…el certificado del titular.` | .pfx incompleto |

Notas de paridad:

- Los PEM (llave, certificado, cadena, `aPem()`) son los mismos bytes que entrega el PHP en
  Linux. Con un .pfx legacy (los del SII) la llave y el certificado no terminan en `\n`;
  con uno moderno sí. Importa porque `certificado` va tal cual a la firma de la semilla
  SOAP (ver [canales.md](canales.md#firma-de-la-semilla-soap)).
- Con un .pfx **no legacy** que trae intermedios, la cadena sale hoja → raíz → intermedia,
  como el PHP (defecto replicado; ver PLAN §8, "Orden de la cadena TLS"). Los .pfx del SII
  no se ven afectados.
- En Windows el PHP repetía la hoja en `toPem()`. `aPem()` no la repite.

```ts
const certificado = Certificado.desdeContenido(bytesDesdeLaBd, clave); // .pfx en memoria
const { cn, vigenteHasta } = certificado.info();
```

---

## `FirmaElectronica`

`new FirmaElectronica(llavePrivadaPem: string, certificadoPem: string)`. Se le pasan
`certificado.llavePrivada` y `certificado.certificado`. El certificado se guarda limpio (sin
`BEGIN/END` ni saltos de línea), que es lo que va en `<X509Certificate>`. Si la llave no es
un PEM legible lanza `ErrorFirma`.

Todas las firmas son RSA-SHA1 (PKCS#1 v1.5), digest SHA1 y C14N 1.0 inclusivo. El
`<KeyInfo>` lleva `RSAKeyValue` (módulo y exponente) y `X509Certificate`. Si el OpenSSL del
sistema bloquea SHA1 (algunas builds de distro), la firma lanza `ErrorFirma`: usar el
binario oficial de Node.

### `firmarSemilla(semilla: string): string`

Firma `<getToken><item><Semilla>…</Semilla></item></getToken>` para el canje semilla → token
de la **API REST**. `Reference URI=""` con transform enveloped-signature (con el transform
C14N el SII responde ESTADO 11). Devuelve el XML completo, en una línea, con
`<?xml version="1.0"?>`. Lo usa `ClienteBoletaRest.solicitarToken()`.

El canal SOAP no usa esta firma sino una propia del PHP (`firmarSemillaDtews`, ver
[canales.md](canales.md#firma-de-la-semilla-soap)).

### `firmarDte(xml: Buffer | Uint8Array | string, referenciaUri = '#F1T33'): Buffer`

Firma un nodo y agrega `<Signature>` como último hijo del **elemento raíz**. El nodo se
elige por la URI (el primero con ese nombre local):

| `referenciaUri` contiene | Nodo firmado |
|---|---|
| `SetDoc` | `SetDTE` (sobre `EnvioBOLETA`) |
| `RCOF` | `DocumentoConsumoFolios` |
| `Libro` | no portado: lanza `ErrorFirma` |
| (vacía) | lanza `ErrorFirma` (para el token, `firmarSemilla`) |
| cualquier otra (`#F12T39`) | `Documento` |

- `xml` como `Buffer`: sus bytes exactos, decodificados según la declaración (ISO-8859-1 o
  UTF-8, como libxml). Como `string`: ya es texto; la declaración solo define la
  codificación de la salida.
- Devuelve los bytes como `saveXML()` del PHP, sin formatear, en la codificación declarada y
  **sin salto de línea final**.
- El valor por defecto `#F1T33` es de factura (herencia del PHP): para boletas, pasar
  `#F{folio}T39` o `#F{folio}T41`.
- Defecto replicado por paridad: el `SignedInfo` que se firma declara `xmlns:xsi` y el que
  se transmite no. El SII lo acepta.
- Lanza `ErrorFirma` si el XML no es válido, falta el nodo (`No se encontró el nodo {tag}
  para aplicar la firma.`), la URI rompe el atributo o la firma falla.

```ts
const dteFirmado = firmador.firmarDte(xmlDte, '#F15T39');
const rcofFirmado = firmador.firmarDte(xmlRcof, '#RCOF');
```

---

## `Timbre`

`new Timbre(caf: Uint8Array | string, opciones?: OpcionesTimbre)`. Recibe el **contenido**
del CAF, no una ruta. Como `Buffer` acepta UTF-8 o ISO-8859-1 aunque el prólogo no lo
declare (algunos CAF traen así las tildes de la razón social). `opciones.reloj` fija el
`<TSTED>`.

Al construir toma el bloque `<CAF>…</CAF>` tal cual (sin reserializar, para no alterar el
`<DA>` firmado por el SII) y carga la `<RSASK>`. Lanza `ErrorTimbre` si el XML no es
válido, falta `<CAF>` o `<RSASK>`, o la llave no es RSA legible.

### `generarTed(datos: DatosTed): Buffer`

| Campo de `DatosTed` | Elemento | Notas |
|---|---|---|
| `rutEmisor` | `<RE>` | tal cual |
| `tipoDte: string \| number` | `<TD>` | |
| `folio: string \| number` | `<F>` | |
| `fecha` | `<FE>` | `YYYY-MM-DD` |
| `rutReceptor` | `<RR>` | `66666666-6` si no hay receptor identificado |
| `razonSocialReceptor` | `<RSR>` | se escapa; no se trunca |
| `montoTotal: string \| number` | `<MNT>` | debe calzar con `<MntTotal>` del DTE |
| `nombreItem1` | `<IT1>` | primeros 40 caracteres (code points), escapado; debe calzar con el primer `<NmbItem>` |

1. Arma el `<DD>` con esos campos, el `<CAF>` original y `<TSTED>` (hora de Chile).
2. Lo aplana (`>\s+<` → `><`) y lo pasa a ISO-8859-1 (`?` para lo que no cabe).
3. Firma SHA1withRSA con la llave del CAF.
4. Devuelve `<TED version="1.0">{DD}<FRMT algoritmo="SHA1withRSA">…</FRMT></TED>` en bytes
   ISO-8859-1.

El aplanado evita el reparo 510 (firma del TED incorrecta) y la firma sobre ISO-8859-1
evita el RFR con tildes. Un campo numérico que no es entero seguro lanza `ErrorValidacion`;
una falla de firma, `ErrorTimbre`.

Para insertarlo en un DTE en ISO-8859-1 se concatenan bytes. Si se necesita como texto,
`desdeIso88591(ted)` da un string que vuelve a los mismos bytes con `aIso88591`.

---

## `GeneradorBoleta`

`new GeneradorBoleta(opciones?: { reloj?: Reloj })` y
`generarBoleta(datos: DatosBoleta): Buffer`. Devuelve el `<DTE version="1.0">` sin TED ni
firma, formateado como libxml (`formatOutput`), con prólogo `encoding="ISO-8859-1"`. Los
caracteres fuera de ISO-8859-1 salen como `&#N;`.

| `DatosBoleta` | Elementos |
|---|---|
| `emisor: { rut, razonSocial, giro, direccion, comuna }` | `RUTEmisor`, `RznSocEmisor`, `GiroEmisor`, `DirOrigen`, `CmnaOrigen` |
| `receptor: { rut, razonSocial? }` | `RUTRecep`; `RznSocRecep` solo si viene (un `''` escribe `<RznSocRecep/>`) |
| `folio: string \| number` | `Folio` e `ID="F{folio}T{tipo}"` |
| `detalles: DetalleBoleta[]` | un `<Detalle>` por línea (al menos una) |
| `tipoDte?: string \| number` | `TipoDTE`, por defecto `39` |
| `referencia?: { codigo, razon }` | `NroLinRef=1`, `CodRef`, `RazonRef` (el set exige `SET` / `CASO-N`) |
| `descuento?: { tipo?: 'porcentaje' \| 'monto', valor, glosa? }` | se reparte como `<DescuentoMonto>` (ver abajo) |

`DetalleBoleta`: `nombre`, `cantidad`, `precio` (unitario **bruto**, IVA incluido),
`exento?: boolean` y `unidad?`. Genera `NroLinDet`, `IndExe=1` si es exento, `NmbItem`,
`QtyItem`, `UnmdItem`, `PrcItem`, `DescuentoMonto` (si le toca) y `MontoItem`. Fijos:
`FchEmis` = hoy en Chile, `IndServicio = 3`.

**Totales** (IVA 19 %):

- Cada línea: `round(cantidad × precio)` (redondeo de PHP), acumulada en exento o afecto.
- Descuento global: solo sobre el afecto, acotado a `[0, afecto]`; un porcentaje se acota a
  100 y un valor ≤ 0 se ignora. No se emite `<DscRcgGlobal>` (daba el reparo 260): se
  reparte a prorrata entre las líneas afectas como `<DescuentoMonto>` y `MontoItem` va neto
  de descuento. `glosa` no se escribe.
- `MntNeto = round(afecto / 1,19)`, `IVA = afecto − neto`, `MntTotal = neto + IVA + exento`.
- Orden en `<Totales>`: `MntNeto`, `MntExe`, `IVA`, `MntTotal`; los tres primeros solo si
  son > 0.
- Las cantidades y precios con decimales se escriben como el `(string)` de un float de PHP.

Lanza `ErrorValidacion` (el PHP no validaba) si un RUT no tiene el formato del SII
(`12345678-9`) o su DV no calza, no hay líneas, una cantidad o un precio no es un número
finito no negativo menor que 1e15 (ni su producto, ni la suma), `exento` no es booleano, el
folio o el tipo no es entero, o el descuento es inválido.

```ts
const xml = new GeneradorBoleta().generarBoleta({
  emisor,
  receptor: { rut: '66666666-6' },
  folio: 15,
  detalles: [
    { nombre: 'item afecto 1', cantidad: 8, precio: 1590 },
    { nombre: 'item exento 2', cantidad: 2, precio: 1000, exento: true },
  ],
  referencia: { codigo: 'SET', razon: 'CASO-4' },
  descuento: { tipo: 'porcentaje', valor: 10 },
});
```

---

## `ArmadorBoleta`

Nuevo en el port (pend. 2.5). `new ArmadorBoleta(firmador: FirmaElectronica, opciones?: {
reloj?: Reloj })` y `armar(datos: DatosBoleta, caf: Uint8Array | string): Buffer`.

1. `GeneradorBoleta.generarBoleta(datos)`.
2. Lee del XML generado `<MntTotal>` y el primer `<NmbItem>` (no recalcula).
3. `Timbre.generarTed` con esos valores y los RUT, la fecha y la razón social del receptor.
4. Inserta `TED + "\n<TmstFirma>…</TmstFirma>\n"` antes de `</Documento>`, sobre los bytes.
5. `firmarDte(xml, '#F{folio}T{tipo}')`.

Devuelve el DTE firmado en ISO-8859-1, sin salto de línea final. La salida es la misma que
la del bucle de `bin/certificacion/enviar-set-boletas.php` del PHP.

- **Un solo reloj por boleta.** Lee la hora una vez: `FchEmis`, `<FE>`, `<TSTED>` y
  `<TmstFirma>` siempre coinciden (en el PHP, una boleta armada a medianoche podía quedar con
  días distintos). Por eso recibe el contenido del CAF y no un `Timbre`.
- **Exige `receptor.razonSocial`** no vacía (decisión del usuario, PLAN §6 fase 3): sin ella
  el TED se firmaría con `<RSR></RSR>`. Para boletas sin receptor identificado, usar
  `Cliente General`.
- **Valida el CAF contra la boleta:** emisor (`<RE>`), tipo (`<TD>`) y folio dentro de
  `<RNG>`. Si no calzan, `ErrorValidacion`.
- Errores: `ErrorValidacion` (datos, CAF de otro emisor o tipo, folio fuera de rango),
  `ErrorTimbre` (CAF sin `<DA>`, `<RE>`, `<TD>` o `<RNG>`, o llave ilegible), `ErrorFirma`.

---

## `EnvioBoleta`

`new EnvioBoleta(firmador: FirmaElectronica, datos: DatosEnvioBoleta, opciones?: { reloj?:
Reloj })`, con `DatosEnvioBoleta = { rutEmisor, rutEnvia, nroResol: string | number,
fchResol }`. `rutEnvia` es el RUT del titular del certificado. En certificación, `nroResol`
es `0` y `fchResol` la fecha de la postulación.

`empaquetar(dtesFirmados): Buffer`:

| `dtesFirmados` | Cómo se toma |
|---|---|
| `Buffer` / `Uint8Array` | bytes exactos (lo normal: lo que devuelve `firmarDte` o `armar`) |
| `string` | texto; se pasa a ISO-8859-1. Un carácter fuera de ISO-8859-1 lanza `ErrorValidacion` |
| arreglo | cada elemento seguido de `\n` (lo que hacía el bin del PHP) |

1. Quita todas las declaraciones `<?xml …?>` de los DTE.
2. Cuenta `<TipoDTE>` y escribe un `<SubTotDTE>` por tipo, en orden de aparición.
3. Arma `<EnvioBOLETA version="1.0">` (`schemaLocation … EnvioBOLETA_v11.xsd`), `<SetDTE
   ID="SetDoc">` y la `<Caratula version="1.0">` con `RutEmisor`, `RutEnvia`, `RutReceptor =
   60803000-K` (fijo), `FchResol`, `NroResol`, `TmstFirmaEnv` y los subtotales.
4. Firma con `firmarDte(sobre, '#SetDoc')`.

Devuelve el sobre en ISO-8859-1, sin salto de línea final. Los datos de la carátula van sin
escapar (como el PHP). Sin ningún DTE (`<TipoDTE>N</TipoDTE>`) lanza `ErrorValidacion`: el
PHP armaba un sobre que no valida contra el XSD.

---

## Utilidades de `comun/`

### `Rut`

| | |
|---|---|
| `Rut.de(rut: string, campo = 'RUT'): Rut` | Acepta `76123456-0`, `76.123.456-0` o `761234560`; `k` → `K`; quita ceros a la izquierda. Valida el DV (módulo 11). Si no: `ErrorValidacion` con `campo` en el mensaje |
| `Rut.esValido(rut): boolean` | mismas reglas, sin lanzar |
| `numero`, `dv` | número sin puntos y DV (`0`–`9` o `K`) |
| `toString()` | `76123456-0`, el formato de los XML |
| `equals(otro)` | |
| `calcularDv(numero: string): string` | DV por módulo 11 |

Todos los clientes aceptan `string | Rut`: un RUT con puntos o `k` minúscula se normaliza.

### `Ambiente`

`type Ambiente = 'certificacion' | 'produccion'`, `AMBIENTES`, `esAmbiente(valor)` y
`datosAmbiente(ambiente): { host, portal, idk }`:

| Ambiente | `host` (asistente de folios, DTEWS) | `idk` del CAF |
|---|---|---|
| `certificacion` | `maullin.sii.cl` | `100` |
| `produccion` | `palena.sii.cl` | `300` |

El ambiente es siempre un parámetro obligatorio en código, no configuración: timbrar o
emitir en el ambiente equivocado gasta folios reales. `datosAmbiente` lanza `TypeError` con
un valor desconocido. Los hosts de la API REST están en [canales.md](canales.md#hosts-por-ambiente).

### Reloj

| | |
|---|---|
| `interface Reloj { ahora(): Date }` | lo reciben todas las clases que estampan hora |
| `relojSistema` | el reloj real (por defecto) |
| `relojFijo(instante: Date \| string \| number)` | reloj detenido (tests) |
| `fechaSii(d)` / `fechaHoraSii(d)` | `YYYY-MM-DD` / `YYYY-MM-DDTHH:MM:SS` en hora de Chile |
| `instanteSii(marca)` | el inverso: el instante de una marca de hora de Chile |
| `ZONA_SII` | `'America/Santiago'` |

### Codificación

Equivalentes exactos de las funciones de texto de PHP que usa el core (verificados con
golden tests):

| Función | Equivale a |
|---|---|
| `aIso88591(texto): Buffer` | `mb_convert_encoding($t, 'ISO-8859-1', 'UTF-8')`: `?` por cada code point que no cabe. **No** usar `Buffer.from(t, 'latin1')`, que toma el byte bajo (`€` → `0xAC`) |
| `desdeIso88591(bytes): string` | lo inverso |
| `decodificarUtf8OIso(bytes): string` | UTF-8 si es válido; si no, ISO-8859-1 (CAF y respuestas del SII) |
| `esUtf8Valido(bytes)` | `mb_check_encoding($b, 'UTF-8')` |
| `truncarCodePoints(texto, n)` / `largoCodePoints(texto)` | `mb_substr` / `mb_strlen` |
| `escaparXml(texto, modo: ModoEscape)` | las tres variantes de `htmlspecialchars` del PHP (`'xml1-iso-8859-1'`, `'xml1-sustituir'`, `'defecto'`) |
| `trimPhp(texto)`, `minusculasAscii(texto)` | `trim()` y `strtolower()` de PHP |

### Bajo nivel

También se exportan, para tests y herramientas: el serializador estilo libxml
(`parsearDocumento`, `parsearXml`, `crearDocumento`, `crearElemento`, `fijarAtributo`,
`serializarXml`, `declaracionXml`), el C14N propio (`c14n`, `c14nPorEtiqueta`,
`elementoPorEtiqueta`), el parser HTML estilo libxml (`parsearHtml`, `elementosPorNombre`,
`atributo`, `textoHtml`, `decodificarEntidadesHtml`) y la navegación con redirecciones de
los asistentes (`navegar`, `resolverUrl`, `exigirSesionVigente`). Reproducen rarezas de
libxml y PHP a propósito; para armar boletas no hacen falta.

---

## Errores

```
SiiError
├── ErrorValidacion           dato de entrada inválido (RUT, montos, correo, trackId…)
├── ErrorCertificado          .pfx / PEM ilegible
├── ErrorFirma                firma XML-DSig
├── ErrorTimbre               TED o CAF
├── ErrorTransporte           red o HTTP inesperado (status, url)
├── ErrorRespuestaSii         el SII respondió pero rechazó o no se entiende (estado, glosa)
├── ErrorSolicitudFolios
│   ├── SesionCaducaError     sesión AUT2000 vencida (también desde la postulación)
│   ├── FolioInicialRequeridoError  primer timbraje: falta folioInicial (no timbró)
│   └── FoliosSinCafError     timbró y no se obtuvo el CAF (folioDesde, folioHasta, ambiente)
└── ErrorPostulacion
    ├── DeclaracionInciertaError   la orden de declarar salió sin confirmación (rutEmpresa)
    └── SetSinDescargarError       hay que descargar el set antes de pedir la revisión
```

- `name` es el nombre de la clase. Todos aceptan `{ cause }`.
- `ErrorTransporte.status`: código HTTP, o `undefined` si no hubo respuesta (DNS, TLS,
  timeout). `url`: origen y ruta, sin query (algunas llevan RUT).
- `ErrorRespuestaSii.estado` / `.glosa`: lo que respondió el SII (`ESTADO`/`GLOSA`,
  `STATUS` de DTEUpload o el fault SOAP), ya saneado.
- `SesionCaducaError` hereda de `ErrorSolicitudFolios`, no de `ErrorPostulacion`, aunque
  también la lanzan `PostulacionSii` y `DeclaracionBoletas` (igual que el PHP): atraparla
  aparte.

Cuándo reintentar: `ErrorTransporte` antes de una orden irreversible, sí;
`FoliosSinCafError` y `DeclaracionInciertaError`, nunca sin revisar el SII (ver
[folios.md](folios.md) y [postulacion.md](postulacion.md)).
