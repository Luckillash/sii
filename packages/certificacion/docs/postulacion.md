# Postulación y declaración de cumplimiento

Los trámites de certificación de boleta electrónica que no son envíos de documentos:
postular la empresa en maullin, pedir la revisión del set, descargar el set y declarar
cumplimiento en www4. Usan la sesión AUT2000 de [folios.md](folios.md).

Lo que se envía es idéntico al PHP (casos `http-postulacion-*`, `http-declaracion-*` y
`gwt-*`, ver [tests.md](tests.md)). Validado en certificación: portal vigente y estado de la
declaración consultado con el login real. Sin validar a propósito: postular, descargar el
set, pedir la revisión y declarar (la empresa de pruebas ya está autorizada, P91).

## Secuencia completa

```
PostulacionSii.autenticar()               login AUT2000 (una sesión para todo)
PostulacionSii.postular()                 maullin, pe_*   → graba la postulación
  … enviar el set de boletas (canales.md) …
ClienteDtews.estadoEnvio().limpio()
DeclaracionBoletas.solicitarRevisionSet() www4, GWT       → si SetSinDescargarError:
DeclaracionBoletas.descargarSetPruebas()  www4, servlet      descargar y volver a pedir
  … el SII responde por correo; si aprueba, estado P90 …
DeclaracionBoletas.estado().porDeclarar()
DeclaracionBoletas.declarar()             www4, GWT       → P91: autorizada en producción
```

El RCOF ya no forma parte de la certificación (el SII lo eliminó desde el 2022-08-01, ver
[canales.md](canales.md)).

## Sin tildes en los datos de los asistentes

**Decisión del usuario (2026-11-07, PLAN §8):** en los datos que se envían a los asistentes
del SII (nombre del software y demás campos de la postulación, y el `NOMUSU` de folios)
**no se usan tildes ni otros caracteres fuera de ASCII**.

Motivo: las páginas del asistente declaran `<meta charset=iso-8859-1>` y, como en el PHP
(libxml), eso hace que los valores con tildes de sus formularios se reenvíen doblemente
codificados (`Ñ` → `Ã‘`). En la postulación es peor: si la confirmación repite un `NOM_SW`
con tildes, no calza con lo enviado y la postulación se detiene sin grabar. Node replica el
defecto por paridad y no se corrige; sin tildes, el PHP y Node envían lo mismo.

La CLI (`sii certificacion postular`) rechaza los textos que no son ASCII imprimible.
`DatosPostulacion` no lo exige: es responsabilidad de quien llama. La declaración va por
GWT en UTF-8 y no tiene este problema.

---

## `PostulacionSii`

`new PostulacionSii(opciones?: { transporte?, reloj? })`. Sin `transporte`, crea un
`TransporteUndici` propio. Host fijo `maullin.sii.cl` (`HOST_POSTULACION`): la postulación
es siempre en certificación. Tope 70 s por paso (`MS_POSTULACION`).

### `autenticar(certificado: Certificado): Promise<SesionSii>`

El login de `SolicitudFolios` con ambiente `certificacion`. La sesión sirve también para
`DeclaracionBoletas`. Un rechazo del login llega como `ErrorPostulacion` (mismo mensaje); una
falla de red, como `ErrorTransporte`. Mismo freno de re-login que en folios.

### `postular(sesion: SesionSii, datos: DatosPostulacion): Promise<ResultadoPostulacion>`

El usuario autenticado tiene que ser representante legal. La postulación **se puede
repetir** (vuelve a dejar la empresa en certificación con los datos nuevos).

| Paso | Petición | Detalle |
|---|---|---|
| 1 | `POST pe_ingrut` (`ACEPTAR=Aceptar Condiciones`) | el formulario siguiente debe ir a `pe_datos_empresa` |
| 2 | `POST pe_datos_empresa` | `RUT_EMP`, `DV_EMP`. Pasa hasta 3 páginas de aviso con `ACEPTAR=Continuar` y guarda su texto en `avisos` |
| 3 | `POST pe_confirma` (`GRABAR=Confirmar Datos`) | parte de los campos del SII sin `ESFAC, FACT, NC, ND, SET03, SET06, SET11, SET84, SET72, BOLEXEN` (factura queda sin marcar); fija `RUT_USU`, `DV_USU`, `MAIL_SUP`, `MAIL_SII`, `MAIL_DTE`, `URL`, `NOM_SW`, `ESBOL=S`, `BOLELEC=S` y `BOLEXEN=S` si `boletaExenta` |
| 4 | `POST pe_graba_postulacion` (`CONF=Confirmar Postulación`) | **graba**, con `conexionNueva`. Antes compara la confirmación con lo enviado (sin distinguir mayúsculas): `RUT_EMP`, `DV_EMP`, `RUT_USU`, `DV_USU`, `MAIL_SUP`, `MAIL_SII`, `MAIL_DTE`, `NOM_SW`, `ESBOL=S`, `BOLELEC=S`, `ESFAC=N` y `BOLEXEN`. Si algo no calza, se detiene sin grabar. Después exige el texto "ha sido aceptada" |

- Los valores van en ISO-8859-1 (`?` para lo que no cabe) y los nombres de campo tal cual,
  como el PHP. Los campos con nombre numérico se renumeran desde 0 (`array_merge`), como el
  PHP.
- Todo va a maullin por `https`; cada redirección y cada `action` se revisan antes de
  enviar.
- Si el texto de una respuesta trae "El código de este mensaje es", "no está autorizado",
  "no es representante", "No ha sido posible completar su solicitud" o "Usted no tiene":
  `ErrorPostulacion` "El SII rechazó la postulación. (SII: …)".

`ResultadoPostulacion`: `empresa` (`Rut`), `avisos` (textos de las páginas de aviso, p. ej.
que la empresa deja de ser usuaria del facturador gratuito del SII: mostrarlos) y `mensaje`
(texto final, hasta 600 caracteres).

Errores de `postular`:

| Error | Cuándo |
|---|---|
| `SesionCaducaError` | la sesión ya no sirve: volver a autenticar |
| `ErrorTransporte` | red o HTTP ≠ 200 **antes** de grabar: se puede reintentar |
| `ErrorPostulacion` | rechazo del SII, flujo inesperado, confirmación que no calza ("Postulación detenida antes de grabar…"), sin "ha sido aceptada", o la orden de grabar salió sin respuesta válida (red o HTTP ≠ 200; el mensaje dice que no se sabe si quedó grabada) |

A diferencia de `declarar()`, no hay error "incierto": repetir la postulación es seguro.

---

## `DeclaracionBoletas`

`new DeclaracionBoletas(opciones?: { transporte?, reloj? })`. Habla GWT-RPC con
`https://www4.sii.cl/certBolElectDteInternet/` (`BASE_DECLARACION`), con la misma sesión de
`PostulacionSii.autenticar()`. Tope 45 s (`MS_DECLARACION`). `reloj` da la fecha `d-m-Y` de
la declaración, en hora de Chile.

Versión del portal capturada (1.0.55, 2026-09-14): `POLICY_DECLARACION`,
`PERMUTACION_DECLARACION` y `PASO_DECLARACION = 90`. Si el SII publica otra versión, las
llamadas responden `IncompatibleRemoteServiceException` y se corta con un mensaje claro: hay
que recapturar esas constantes (y revisar los esquemas de los DTO) desde el portal.
`verificarPortal()` lo detecta antes.

| Método | Qué hace |
|---|---|
| `estado(sesion, rutEmpresa): Promise<EstadoDeclaracion>` | `obtenerEstadoAutorizaEmp(rut, dv, 90, null)`. Código `null` si el SII no devuelve objeto (ya autorizada, sin trámite o el usuario no la representa) |
| `declarar(sesion, datos: DatosDeclaracion): Promise<EstadoDeclaracion>` | **Autoriza a la empresa en producción.** Solo si el estado es `P90`. `estado` → `recuperarNombreContribuyente` → `listarDocAutorizados` → `autorizarEmpresaBolProd` (con `conexionNueva`). Exige razón social y al menos un documento. Devuelve `EstadoDeclaracion(empresa, 'P91', 'DECLARACION EFECTUADA {usuario}', paso)` |
| `solicitarRevisionSet(sesion, rutEmpresa, trackId: string): Promise<void>` | `recuperarNroActividadesVigAfecIva` → `ingresarTrackId`. `'1'` = OK; `'errorEstado'` → `SetSinDescargarError`; otra → `ErrorPostulacion`. El resultado no es inmediato: el SII avisa por correo y, si aprueba, `estado()` pasa a P90. Revisar antes que el envío esté `limpio()` |
| `descargarSetPruebas(sesion, rutEmpresa, correoProveedor): Promise<string>` | `obtenerPostulacionSeg(rut, dv, "90", "P90")` y `GET DownloadFileServlet` (Referer `?SET=1`). Devuelve el texto del set y deja registrada la descarga. **Candado:** no descarga si la empresa ya está en P90 (un set nuevo reinicia la certificación). Exige que el texto traiga "SET DE PRUEBA" y "CASO-" |
| `verificarPortal(): Promise<string[]>` | `GET {PERMUTACION}.cache.html`, sin sesión ni cookies. Lista de problemas (vacía = vigente). Un 404 se devuelve como problema (otra versión del portal), no lanza |

- `declarar()` y `descargarSetPruebas()` sacan el RUT del usuario de las cookies
  `RUT_NS`/`DV_NS`; si faltan, `SesionCaducaError`. En `declarar()` ese usuario firma como
  representante legal.
- Cada llamada GWT revisa primero la sesión (login → `SesionCaducaError`) y después el
  código (≠ 200 → `ErrorTransporte`, reintentable). `//EX` o una respuesta que no se entiende
  → `ErrorPostulacion`.
- RUT y trackId inválidos son `ErrorValidacion` y no sale ninguna petición.
- `GwtRpc` y `NavegadorSii` son internos (no se exportan). `GwtRpc` usa `BigInt` para los
  `long` de GWT.

### `DeclaracionInciertaError`

Desde que sale el POST de `autorizarEmpresaBolProd`, **cualquier** falla (red, HTTP ≠ 200,
sesión caducada, redirección fuera del host, GWT mal formado, `//EX`, respuesta sin P91) es
`DeclaracionInciertaError`, con la causa en `cause` y la empresa en `rutEmpresa`. La empresa
puede haber quedado autorizada.

**No reintentar a ciegas:** consultar `estado()`. Si `autorizada()` (P91), ya quedó; si
sigue `porDeclarar()` (P90), se puede volver a declarar.

---

## Datos y resultados

Validan al construirse y lanzan `ErrorValidacion` con un mensaje apto para mostrar. Las
reglas son las del formulario del SII: si no se cumplen, el SII rechaza la página, así que
se cortan antes de salir.

| Clase | Contenido y validaciones |
|---|---|
| `new DatosPostulacion(entrada: EntradaPostulacion)` | `rutEmpresa`, `rutAdministrador` (quien se autentica después para ver o declarar), `correoAdministrador`, `correoContactoSii`, `correoIntercambio`, `nombreSoftware` (1–30 caracteres), `boletaExenta?` (por defecto `true`), `url?` (si va, empieza con `www.`, máx. 100). Expone `empresa` y `administrador` como `Rut` |
| `new DatosDeclaracion(entrada: EntradaDeclaracion)` | `rutEmpresa`, `linkConsulta` (1–100), `rutProveedor`, `nombreProveedor` (1–30), `correoProveedor`. El proveedor es quien desarrolla o vende el software (para la propia empresa, ella misma). Expone `empresa` y `proveedor` como `Rut` |
| `validarCorreo(correo, campo = 'correo')` | regla `esValidoMail2` del SII: ≤ 50, ASCII visible sin `!"#$%&/()=?+*\|<>[];`, un solo `@`, sin `@.`, no empieza ni termina en `@` o `.`, punto en el dominio |
| `EstadoDeclaracion` | `empresa`, `codigo` (`string \| null`), `glosa`, `paso` (`number \| null`, el que se reenvía al declarar). `porDeclarar()` = P90, `autorizada()` = P91 |

```ts
import {
  DatosPostulacion,
  DeclaracionBoletas,
  PostulacionSii,
  SesionCaducaError,
} from '@winex/certificacion';

const postulacion = new PostulacionSii({ transporte });
const sesion = await postulacion.autenticar(certificado);
const resultado = await postulacion.postular(
  sesion,
  new DatosPostulacion({
    rutEmpresa: '76123456-0',
    rutAdministrador: '11111111-1',
    correoAdministrador: 'admin@empresa-prueba.cl',
    correoContactoSii: 'sii@empresa-prueba.cl',
    correoIntercambio: 'dte@empresa-prueba.cl',
    nombreSoftware: 'Sistema de Prueba', // sin tildes
  }),
);

const declaracion = new DeclaracionBoletas({ transporte });
try {
  const estado = await declaracion.estado(sesion, '76123456-0');
  if (estado.porDeclarar()) {
    // declarar(...) autoriza a la empresa en producción
  }
} catch (error) {
  if (error instanceof SesionCaducaError) {
    // volver a autenticar
  }
  throw error;
}
```

## Errores

```
SiiError
├── ErrorValidacion                datos, RUT, correo, trackId
├── ErrorTransporte                red o HTTP ≠ 200 antes de una orden que graba
├── ErrorSolicitudFolios
│   └── SesionCaducaError          también se lanza desde aquí
└── ErrorPostulacion
    ├── DeclaracionInciertaError   (rutEmpresa)
    └── SetSinDescargarError
```

`SesionCaducaError` **no** es `ErrorPostulacion`: atraparla aparte.

| Error / mensaje | Qué hacer |
|---|---|
| `SesionCaducaError` | volver a `autenticar()` y reintentar. En `declarar()` solo sale antes de enviar la orden |
| `DeclaracionInciertaError` | **no** reintentar a ciegas: `estado()` (ver arriba) |
| `SetSinDescargarError` | `descargarSetPruebas()` y volver a `solicitarRevisionSet()` |
| `ErrorPostulacion` "no está en el paso de declarar cumplimiento" | revisar `estado()`: la revisión del set no se aprobó todavía, ya está autorizada o el usuario no la representa |
| `ErrorPostulacion` "No se descarga un set nuevo…" | la empresa ya está en P90: declarar, no descargar |
| `ErrorPostulacion` por `IncompatibleRemoteServiceException` o "tipo no esperado" | el portal GWT cambió: `verificarPortal()` y recapturar las constantes |
| `ErrorPostulacion` "Postulación detenida antes de grabar" | la confirmación no repite lo enviado (¿tildes?); revisar en el portal. No se grabó nada |
| `ErrorPostulacion` "El SII rechazó la postulación. (SII: …)" | leer el texto del SII |
| `ErrorTransporte` | red o SII caído antes de grabar: reintentar más tarde |

## Probar sin red

Las dos clases aceptan un `TransporteFalso`. Una respuesta GWT es `//OK[<payload
invertido>,[<tabla de strings>],0,7]`:

```ts
import { DeclaracionBoletas, SesionSii, TransporteFalso } from '@winex/certificacion';

const transporte = new TransporteFalso({
  // EstadoAutorizaTo (campos codigo, paso, glosa). Se lee al revés:
  // 1 = firma del tipo, 2 = "P90", 3 = "90", 4 = glosa.
  'www4.sii.cl/certBolElectDteInternet/facade':
    '//OK[4,3,2,1,["cl.sii.sdi.diii.certBolElectDte.to.EstadoAutorizaTo/1011533792","P90","90","FALTA DECLARAR"],0,7]',
});
const estado = await new DeclaracionBoletas({ transporte }).estado(new SesionSii(), '76123456-0');
// estado.porDeclarar() === true, estado.paso === 90

// Sin patrón para el .cache.html, TransporteFalso responde 404:
const problemas = await new DeclaracionBoletas({ transporte: new TransporteFalso() }).verificarPortal();
// ['El SII publicó otra versión del portal de boletas: …']
```

Para `declarar()` y `descargarSetPruebas()` la sesión tiene que traer `RUT_NS`/`DV_NS`
(`SesionSii.desdeArreglo([...])`), y la respuesta de `facade` tiene que ser una función que
mire el método en `peticion.bytes`. Los unitarios del repo están en
`packages/core/test/unitarios/postulacion/`.
