# Canales de envío: REST, SOAP y documentos del set

Cómo se habla con el SII para subir documentos y consultar su estado:

- **API REST de Boleta Electrónica** (`ClienteBoletaRest`): semilla, token, envío de
  boletas, consulta del envío (`EstadoEnvioRest`) y RCOF.
- **Canal SOAP DTEWS** (`ClienteDtews`): semilla, token, subida por `DTEUpload` y estado
  del envío (`EstadoEnvio`).
- Lo que comparten: `TokenStore`, el transporte HTTP inyectable y los hosts por ambiente.
- Las piezas del set de pruebas que no hablan con el SII: `parsearSetPruebas`,
  `GeneradorConsumoFolios` y `resumirParaRcof`.

El procedimiento de certificación paso a paso está en [certificacion.md](certificacion.md).
El armado de los documentos que se suben, en [core.md](core.md).

> **RCOF.** El SII eliminó la obligación de enviar el RCOF (Resumen de Ventas Diarias, ex
> Reporte de Consumo de Folios) a partir del **1 de agosto de 2022**. Solo aplica a períodos
> hasta julio de 2022 inclusive. Todo lo del RCOF se conserva por paridad con el PHP y para
> esos períodos, pero no es parte del flujo normal ni de la certificación. Por REST, pangal
> responde **HTTP 404** (validado el 2026-11-07); para un período antiguo, usar
> `ClienteDtews.enviarDte` (DTEUpload). Ver PLAN §1.

## Hosts por ambiente

| Canal | Certificación | Producción |
|---|---|---|
| REST: semilla, token y consulta | `https://apicert.sii.cl/recursos/v1` | `https://api.sii.cl/recursos/v1` |
| REST: envío de boleta y RCOF | `https://pangal.sii.cl/recursos/v1` | `https://rahue.sii.cl/recursos/v1` |
| SOAP DTEWS y DTEUpload | `https://maullin.sii.cl` | `https://palena.sii.cl` |

Constantes: `URLS_BOLETA_REST[ambiente]` (`{ auth, envio }`) y `datosAmbiente(ambiente).host`.
Los hosts de folios, login y postulación están en [folios.md](folios.md) y
[postulacion.md](postulacion.md).

El ambiente es obligatorio en cada cliente. Las opciones `urls` (REST) y `urlBase` (SOAP)
existen **solo para tests** con el servidor de captura: cualquier otro servidor recibiría
el token.

---

## Transporte HTTP

Todos los clientes reciben un `TransporteHttp` (una interfaz con `enviar(peticion:
PeticionHttp): Promise<RespuestaHttp>`). El transporte hace **una** petición: no sigue
redirecciones ni maneja cookies (eso lo hace cada cliente, para revisar cada salto) y
devuelve cualquier código HTTP.

| Implementación | Uso |
|---|---|
| `new TransporteUndici(opciones?)` | el real. Solo `https` (salvo `permitirHttp`, para tests), TLS verificado siempre, HTTP/1.1, conexión 10 s y petición completa 45 s (`msConexion`, `msRespuesta`), `ca` extra para tests (se suma a las de Node). Reutiliza conexiones con un `Agent` por identidad TLS (`maxIdentidadesTls`, 16 por defecto). Cerrar al terminar: `await transporte.close()` o `await using` |
| `new TransporteFalso(respuestas)` | tests sin red. Responde por patrón `host+ruta` (`*` comodín, sin distinguir mayúsculas, gana el primero); sin patrón, 404. La respuesta es texto, bytes, una `RespuestaHttp` o una función que recibe la petición (o lanza, para simular la red). Registra todo en `enviadas`; `urls()` las lista |

`PeticionHttp`:

| Campo | Notas |
|---|---|
| `metodo`, `url`, `cabeceras` | las cabeceras salen en ese orden y capitalización |
| `cuerpo` | `{ tipo: 'formulario', campos }` (como `http_build_query`) o `{ tipo: 'crudo', datos, contentType }` (SOAP, multipart, GWT) |
| `tls` | `IdentidadTls` (`certificado.identidadTls()`), en memoria: nunca se escribe a disco |
| `msRespuesta`, `signal` | tope por petición |
| `descomprimir` | `true` por defecto: envía `Accept-Encoding: gzip, deflate` y descomprime |
| `conexionNueva` | conexión propia con `Connection: close` (ver abajo) |

`RespuestaHttp`: `status`, `cabeceras` (nombres en minúsculas, lista de valores), `cuerpo`
(`Buffer`), `cabecera(nombre)` y `esRedireccion()`. `exigirStatus(respuesta, url,
esperados = 200)` lanza `ErrorTransporte` si el código no es uno de los esperados.
`armarMultipart(campos, boundary?)` arma el multipart idéntico al de cURL.

```ts
import { ClienteBoletaRest, TransporteUndici } from '@winex/certificacion';

await using transporte = new TransporteUndici();
const sii = new ClienteBoletaRest(certificado, { ambiente: 'certificacion', transporte });
```

### Decisiones de la fase 4

Ninguna cambia bytes firmados ni enviados (PLAN §6, fase 4):

- **`Accept-Encoding`.** Donde el PHP usaba `CURLOPT_ENCODING ''` (folios y postulación) se
  envía `gzip, deflate` (la lista de cURL dependía de su build). SOAP y REST van con
  `descomprimir: false`: sin `Accept-Encoding`, como el PHP.
- **`conexionNueva`.** Los POST que no se pueden repetir sin consecuencias van por una
  conexión propia: `DTEUpload`, envío REST de boleta y de RCOF, la orden de timbrar folios,
  grabar la postulación y la declaración. Con una conexión reutilizada, el servidor podría
  cerrarla justo al enviar y no se sabría si la orden llegó. El resto reutiliza conexiones
  (`keep-alive`; el PHP abría una por petición).
- **Códigos HTTP** (pend. 1.9). REST exige 200 en todo (el PHP solo en las subidas). SOAP:
  200 sigue; un fault SOAP (HTTP 500 con `<soapenv:Fault>`) lanza `ErrorRespuestaSii` con
  `faultcode` y `faultstring`; cualquier otro código lanza `ErrorTransporte` con `status`.
  Los clientes SOAP y REST no siguen redirecciones.
- **Mensajes sin secretos.** Nunca llevan el token, cookies, PEM ni el XML firmado. El PHP
  incluía la respuesta cruda (que en el canje puede traer el token); ahora va `ESTADO` /
  `GLOSA` o un extracto saneado y truncado a 200 caracteres.
- **Entradas.** Los RUT pasan por `Rut` (un RUT bien escrito sale idéntico; uno con puntos
  o `k` se normaliza). El trackId debe ser numérico. Un token debe ser ASCII visible sin
  espacios ni `;` (si no, `ErrorValidacion`). Las subidas reciben los bytes del XML, sin
  archivos temporales.
- **Diferencias en el cable, documentadas.** `Connection` (`close` en el SOAP del PHP, nada
  en cURL, `keep-alive` o `close` aquí). cURL agrega `Expect: 100-continue` con cuerpos de
  más de 1 MiB en la subida REST; undici nunca lo envía. El `filename` del multipart REST
  (ver [Envío](#envío)).

---

## `TokenStore`

Caché de tokens inyectable (pend. 1.4). Reemplaza el archivo global del PHP
(`data/output/token_cache_boleta_produccion.txt`, uno para todas las empresas y
ambientes).

```ts
interface TokenStore {
  obtener(clave: ClaveToken): Promise<TokenGuardado | undefined>;
  guardar(clave: ClaveToken, guardado: TokenGuardado): Promise<void>;
  borrar(clave: ClaveToken): Promise<void>;
}
```

- **Clave** (`ClaveToken`): `canal` (`'rest'` o `'soap'`) + `ambiente` + `rutEmpresa`
  (normalizado) + `huellaCertificado` (sha256 en hex del DER de la hoja, ver
  `huellaCertificado(pem)`). El token queda atado a quien firmó la semilla.
- **`TokenGuardado`**: `{ token, venceEn: Date }`. Las implementaciones no validan la
  vigencia: lo hace el cliente con su reloj.
- `TokenStoreMemoria`: en el proceso (por defecto en cada cliente, si no se pasa otro).
  `tamano` cuenta las entradas.
- `TokenStoreArchivo(ruta)`: JSON en la ruta que se entrega (nada en rutas por defecto).
  Escritura atómica (temporal 0600 creado en exclusiva + `rename`), operaciones en fila por
  instancia, un archivo roto se trata como vacío. La carpeta debe existir. Guarda
  credenciales: protegerlo. Lo usa la CLI (`SII_CACHE_TOKENS`).
- Una app web puede implementar la interfaz con Redis o su base de datos.

Los dos clientes tienen la misma API de token:

| Método | Qué hace |
|---|---|
| `solicitarToken(): Promise<string>` | semilla → firma → token, **sin caché** |
| `obtenerToken(rutEmpresa): Promise<string>` | el del `TokenStore` si sigue vigente; si no, uno nuevo que se guarda por `SEGUNDOS_VIGENCIA_TOKEN` (3000 s desde que llegó, como el PHP). Dos llamadas simultáneas para la misma empresa comparten el pedido |
| `olvidarToken(rutEmpresa): Promise<void>` | lo borra (p. ej. si el SII lo rechazó antes de vencer) |
| `claveToken(rutEmpresa): ClaveToken` | la clave que usa |

---

## `ClienteBoletaRest`

`new ClienteBoletaRest(certificado: Certificado, opciones: OpcionesClienteBoletaRest)`, con
`{ ambiente, transporte, tokenStore?, reloj?, urls?, boundary? }` (`urls` y `boundary`
solo para tests). Firma la semilla con `FirmaElectronica.firmarSemilla()`. Lanza
`TypeError` si el ambiente o las URLs no son válidos.

```ts
const sii = new ClienteBoletaRest(certificado, { ambiente: 'certificacion', transporte });
const token = await sii.obtenerToken('76123456-0');
const { trackId } = await sii.enviarBoleta(token, '76123456-0', '11111111-1', sobre);
const estado = await sii.consultarEnvio(token, '76123456-0', trackId);
if (estado.enProceso()) {
  // volver a consultar más tarde
}
```

### Token

| Método | Petición |
|---|---|
| `obtenerSemilla(): Promise<string>` | `GET {auth}/boleta.electronica.semilla` → `<SEMILLA>` |
| `solicitarToken()` | semilla → `firmarSemilla` → `POST {auth}/boleta.electronica.token` (`Content-Type: application/xml`) → `<TOKEN>` |

Sin `<SEMILLA>` o `<TOKEN>`: `ErrorRespuestaSii` con el `ESTADO` y la `GLOSA` del SII
(nunca un extracto de la respuesta del token).

### Envío

| Método | Petición |
|---|---|
| `enviarBoleta(token, rutEmisor, rutEnvia, xml: Uint8Array, opciones?: { nombreArchivo? }): Promise<RespuestaEnvioRest>` | `POST {envio}/boleta.electronica.envio` |
| `enviarConsumoFolios(token, rutEmisor, rutEnvia, xml, opciones?)` | `POST {envio}/boleta.electronica.consumo` (RCOF: hoy responde 404, ver arriba) |

- Multipart con `rutSender`/`dvSender` (de `rutEnvia`, el titular del certificado),
  `rutCompany`/`dvCompany` (de `rutEmisor`) y `archivo` (`text/xml`), en ese orden.
  Cabeceras `Accept: */*`, `Cookie: TOKEN=…` y el User-Agent fijo del PHP
  (`USER_AGENT_BOLETA_REST`). Con `conexionNueva`.
- `xml` son los bytes exactos (lo que devuelve `EnvioBoleta.empaquetar`): no se firma ni se
  convierte nada.
- `filename`: `envio.xml` (`NOMBRE_ARCHIVO_BOLETA`) o `rcof.xml` (`NOMBRE_ARCHIVO_RCOF`),
  o `nombreArchivo`. El PHP mandaba el nombre del temporal + `.xml`; el SII lo devuelve en
  `file` pero no lo valida.
- `RespuestaEnvioRest`: `trackId`, `estado` (normalmente `REC`), `fechaRecepcion`,
  `rutEmisor`, `rutEnvia`, `archivo` y el `json` completo.
- **En producción `enviarBoleta` emite documentos reales y consume folios.** Un
  `ErrorTransporte` sin `status` (se cortó la conexión) no garantiza que no haya llegado: no
  reenviar sin revisar.
- Errores: `ErrorValidacion` (token, RUT, XML vacío o no `Uint8Array`, nombre vacío),
  `ErrorTransporte` (red o HTTP ≠ 200, con un extracto saneado), `ErrorRespuestaSii` (sin
  JSON o sin `trackid`).

### Consulta: `consultarEnvio(token, rutEmisor, trackId: string | number): Promise<EstadoEnvioRest>`

`GET {auth}/boleta.electronica.envio/{rut}-{dv}-{trackId}` con `Cookie: TOKEN=…` (va al
host de autenticación, como el PHP). Solo lectura.

`EstadoEnvioRest` (pend. 1.6; el PHP devolvía el arreglo crudo):

| Miembro | |
|---|---|
| `trackId`, `estado`, `rutEmisor`, `rutEnvia`, `fechaRecepcion` | `''` si no vinieron |
| `estadistica: EstadisticaEnvioRest[]` | `{ tipo, informados, aceptados, rechazados, reparos }` por tipo |
| `informados`, `aceptados`, `rechazados`, `reparos` | sumas sobre todos los tipos |
| `detalleRepRech: DetalleRepRechRest[]` | `{ tipo, folio, estado, descripcion, errores[] }`; cada error `{ seccion, linea, nivel, codigo, descripcion, detalle }` |
| `json` | el JSON completo |
| `enProceso()` | `REC`, `SOK`, `CRT`, `FOK` o `PRD`: volver a consultar |
| `procesado()` | `EPR` |
| `limpio()` | `EPR`, al menos un informado, todos aceptados, sin rechazos ni reparos |
| `static desdeJson(json, trackId)` | lanza `ErrorRespuestaSii` si no es un objeto con `estado` |

La consulta REST no conoce los envíos subidos por `DTEUpload` (responde "No existe
recurso"), y `QueryEstUp` responde `ESTADO -11` (sin glosa) para un envío subido por REST:
consultar cada envío por su canal (validado en la fase 7).

---

## `ClienteDtews`

`new ClienteDtews(certificado: CredencialesDtews, opciones: OpcionesClienteDtews)`, con
`{ ambiente, transporte, tokenStore?, reloj?, urlBase? }`. `CredencialesDtews` es `{
llavePrivada, certificado }`: un `Certificado` sirve tal cual. Pese al nombre del canal, no
usa una librería SOAP: arma los sobres a mano, como el PHP.

```ts
const sii = new ClienteDtews(certificado, { ambiente: 'certificacion', transporte });
const token = await sii.obtenerToken('76123456-0');
const trackId = await sii.enviarDte(token, {
  rutEmisor: '76123456-0',
  rutEnvia: '11111111-1',
  xml: sobre,
  nombreArchivo: 'EnvioBOLETA.xml',
});
const estado = await sii.estadoEnvio(token, '76123456-0', trackId);
console.log(estado.resumen());
```

| Método | Petición |
|---|---|
| `obtenerSemilla()` | `POST /DTEWS/CrSeed.jws` (`getSeed`) → `<SEMILLA>` numérica |
| `solicitarToken()` | semilla → `firmarSemillaDtews` → `POST /DTEWS/GetTokenFromSeed.jws` (`getToken`, XML firmado escapado en `<pszXml>`) → `<TOKEN>` |
| `enviarDte(token, archivo: ArchivoDte): Promise<string>` | `POST /cgi_dte/UPL/DTEUpload` → TrackID |
| `estadoEnvio(token, rutEmpresa, trackId: string): Promise<EstadoEnvio>` | `POST /DTEWS/QueryEstUp.jws` (`getEstUp`) |

- Semilla, token y estado: `Content-Type: text/xml; charset=utf-8` y `SOAPAction: ""`, sin
  `Accept` ni `Accept-Encoding`, como el `file_get_contents` del PHP.
- `enviarDte`: `ArchivoDte = { rutEmisor, rutEnvia, xml: Uint8Array, nombreArchivo }`.
  Multipart con los mismos cuatro campos que REST y `archivo`. `Accept: */*`, `Cookie:
  TOKEN=…`, User-Agent fijo `USER_AGENT_DTEUPLOAD` (distinto del de REST), con
  `conexionNueva`. No se reintenta solo. Sin TrackID numérico lanza `ErrorRespuestaSii` con
  el `STATUS` en `estado` y su glosa (1 sin permiso, 5 no autenticado, 7 esquema inválido,
  8 error de firma, etc.).
- `estadoEnvio`: trackId de 1 a 15 dígitos (sin el `\n` final que aceptaba el PHP).
  Maullin responde 503 de vez en cuando: `ErrorTransporte` con `status` 503, volver a
  consultar más tarde. Sin `getEstUpReturn`: `ErrorRespuestaSii`.
- `DTEUpload` sirve para el set de boletas y para un RCOF de un período anterior a
  2022-08-01.

### Firma de la semilla SOAP

`firmarSemillaDtews(semilla, llave, certificado)` replica byte a byte la firma propia del
PHP, que **no** es la de `firmarSemilla()` (pend. 1.3 / 1.8 / 2.1):

1. El `SignatureValue` se calcula sobre el `<SignedInfo>` tal como está escrito (con
   `<X/>`), no sobre su forma C14N.
2. El XML firmado lleva `\n` entre elementos.
3. `<X509Certificate>` lleva el certificado **tal cual**: el PEM completo, con
   `BEGIN/END` y saltos de línea (los scripts del PHP le pasaban `getPublicKey()`). El SII
   lo acepta. `Certificado.certificado` da esos mismos bytes.
4. El resultado va escapado con `htmlspecialchars` dentro de `<pszXml>`
   (`sobreGetToken(xmlFirmado)`).

Unificarla con `firmarSemilla()` cambia bytes enviados: queda pendiente, con decisión del
usuario y validación en maullin (PLAN §8).

---

## `EstadoEnvio`

Estado de un envío según `QueryEstUp` (inmutable).

| Miembro | |
|---|---|
| `new EstadoEnvio(datos: DatosEstadoEnvio)` | `{ trackId, estado, glosa, informados?, aceptados?, rechazados?, reparos? }` |
| `static desdeRespuesta(respuesta: string, trackId: string)` | decodifica entidades, lee la primera aparición de `ESTADO` (obligatorio: si falta, `ErrorRespuestaSii`), `TRACKID` (si falta, vacío o `0`, usa el recibido) y `GLOSA`, y **suma** `INFORMADOS`, `ACEPTADOS`, `RECHAZADOS` y `REPAROS` de todos los tipos |
| `enProceso()` | `REC`, `SOK`, `CRT`, `FOK` o `PRD` |
| `procesado()` | `EPR` |
| `limpio()` | `EPR`, al menos un informado, todos aceptados, sin rechazos ni reparos |
| `resumen()` | con `EPR`: `EPR Envio Procesado: 5 informados, 5 aceptados, 0 rechazados, 0 con reparos`; si no, `{estado} {glosa}` |

Cualquier otro estado (p. ej. un rechazo del envío) da `enProceso()` y `procesado()` en
`false`: es final y no se resuelve reintentando. Excepción conocida: `-11` sin glosa, que
`QueryEstUp` responde a un envío recién subido que todavía no registra (volver a consultar en
unos minutos) o a un trackId de la API REST.

---

## `parsearSetPruebas`

`parsearSetPruebas(contenido: string | Uint8Array, tipoDte = '39'): CasoSetPruebas[]`. Lee
el `.txt` del Set de Pruebas de Boletas que entrega el SII. Recibe el **contenido** (sin
E/S); como bytes acepta UTF-8 o ISO-8859-1.

`CasoSetPruebas = { tipo, detalles: DetalleSetPruebas[], referencia: { codigo: 'SET', razon:
'CASO-N' } }`. `detalles` y `referencia` se pasan tal cual a `GeneradorBoleta` /
`ArmadorBoleta`.

- Un bloque por `CASO-N` seguido de una línea de `=`.
- Ítems: líneas de exactamente tres columnas (nombre, cantidad, precio) separadas por 2 o
  más blancos. Números con miles (`1.250.000`, `1,250,000`) o decimales con `.` o `,`.
- La primera `OBSERVACION: "…"`: "item N … exento" marca ese ítem (sin número, solo si hay
  un único ítem); "unidad de medida en X" pone `unidad` al ítem nombrado o a todos.
- Lanza `ErrorValidacion` si no hay casos, un caso queda sin ítems, **un encabezado `CASO-N`
  no va seguido de su línea de `=`** o **un número es ambiguo** (`1.000,50`). Las dos
  últimas son decisiones del usuario (fase 3): el PHP perdía el caso o leía `1`.

```ts
const casos = parsearSetPruebas(await readFile('data/set_pruebas/Set Prueba BE.txt'));
const dtes = casos.map((caso, i) =>
  armador.armar(
    { emisor, receptor, folio: folioInicial + i, detalles: caso.detalles, referencia: caso.referencia },
    caf,
  ),
);
```

---

## RCOF: `GeneradorConsumoFolios` y `resumirParaRcof`

Ver la nota del inicio: no es obligatorio desde el 2022-08-01.

`new GeneradorConsumoFolios(opciones?: { reloj?: Reloj })` y `generar(caratula: CaratulaRcof,
resumenes: readonly ResumenRcof[]): Buffer`. Devuelve el `ConsumoFolios` sin firmar,
formateado, en ISO-8859-1, con `<DocumentoConsumoFolios ID="RCOF">` (lo que busca
`firmarDte(rcof, '#RCOF')`). Lanza `ErrorValidacion` si un monto, cantidad, folio o
`secEnvio` no es un entero no negativo.

| `CaratulaRcof` | `ResumenRcof` |
|---|---|
| `rutEmisor`, `rutEnvia`, `fchResol`, `nroResol`, `fchInicio`, `fchFinal`, `secEnvio`; `TmstFirmaEnv` sale del reloj | `tipo`, `neto`, `iva`, `tasaIva?` (`'19.00'`), `exento`, `total`, `foliosEmitidos`, `foliosAnulados`, `foliosUtilizados`, `rangosUtilizados`, `rangosAnulados?`. `MntNeto`, `MntIva`+`TasaIVA` y `MntExento` se omiten si valen 0 |

`resumirParaRcof(dtes): ResumenDtes` (nuevo en el port, pend. 5) arma los resúmenes desde
los DTE (o un sobre completo): suma `MntNeto`, `IVA`, `MntExe` y `MntTotal` por `TipoDTE`,
agrupa los folios en rangos consecutivos (`rangosConsecutivos`) y devuelve `{ resumenes,
fchInicio, fchFinal }`. Lanza `ErrorValidacion` si no hay documentos, falta `TipoDTE`,
`Folio` o `FchEmis`, o un folio se repite.

```ts
const { resumenes, fchInicio, fchFinal } = resumirParaRcof(dtes);
const rcof = new GeneradorConsumoFolios().generar(
  { rutEmisor: '76123456-0', rutEnvia: '11111111-1', fchResol: '2022-01-10', nroResol: 0, fchInicio, fchFinal, secEnvio: 1 },
  resumenes,
);
const rcofFirmado = firmador.firmarDte(rcof, '#RCOF'); // enviar con ClienteDtews.enviarDte
```
