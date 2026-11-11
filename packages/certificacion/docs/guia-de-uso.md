# Guía de uso

Cómo pasar de cero a emitir boletas electrónicas (tipos 39 y 41) con este proyecto. Sigue
el orden real del trámite ante el SII: **certificación** (ambiente de pruebas: maullin,
apicert, pangal, www4) y después **producción** (palena, api, rahue).

Hay dos formas de usarlo, y se pueden combinar:

- **CLI `sii`:** cada paso es un comando. Es la forma más corta; ver [cli.md](cli.md).
- **Librería `@winex/certificacion`:** desde tu propio código Node (un servidor, una app
  Next.js). Ver la referencia en [core.md](core.md), [canales.md](canales.md),
  [folios.md](folios.md) y [postulacion.md](postulacion.md).

> Esto emite documentos tributarios reales. Prueba siempre en certificación primero.
> Sin garantía; ver [LICENSE](../LICENSE).

## 0. Qué necesitas

- **Node.js ≥ 22.19** (lo exige undici 8; se desarrolla con Node 24 LTS). Usa el binario
  oficial de Node o la imagen Docker oficial: algunas builds de distro con el OpenSSL del
  sistema (p. ej. RHEL 9) bloquean SHA1, que el SII exige.
- **pnpm** (`corepack enable pnpm`). En este entorno Windows, `pnpm` solo funciona desde
  **PowerShell**, no desde Git Bash.
- Un **certificado digital** (.pfx) del representante de la empresa, y su clave. Node lee
  los .pfx antiguos del SII (RC2-40, 3DES) **sin el binario `openssl`**.
- Una empresa con giro y clave tributaria en el SII.

No hace falta PHP. Solo se usa para regenerar los esperados de paridad (ver
[tests.md](tests.md)).

## 1. Instalar y configurar

Desde PowerShell, en la raíz del repo:

```
pnpm install
pnpm build            # compila la librería y la CLI (dist/)
pnpm test             # opcional: unitarios + paridad, sin red ni certificados reales
Copy-Item .env.example .env
New-Item -ItemType Directory -Force data/certs, data/caf
```

`pnpm build` hace falta para usar la CLI compilada (`node apps/cli/dist/main.js`) o la
librería desde `dist/`. `pnpm sii ...` corre la CLI desde el código fuente y no lo necesita.

Deja el certificado en `data/certs/` y los CAF en `data/caf/`. Ambas carpetas, `data/output/`
y el `.env` están en el `.gitignore`: **nunca las subas a git** (el CAF trae la llave
privada de los folios).

Completa el `.env`. Para empezar basta con:

| Variable | Qué es |
|---|---|
| `SII_CERT_PATH` | Ruta al .pfx, relativa a la carpeta del `.env`: `data/certs/mi-certificado.pfx` |
| `SII_CERT_PASS` | Clave del certificado |
| `SII_RUT_EMPRESA` | RUT de la empresa emisora, con guion y DV (`76123456-0`) |
| `SII_RUT_FIRMA` | RUT del titular del certificado (`12345678-5`) |
| `EMISOR_RAZON_SOCIAL`, `EMISOR_GIRO`, `EMISOR_DIRECCION`, `EMISOR_COMUNA` | Datos del emisor. **El giro sin abreviaciones** |

El resto (resolución, CAF, folios, set) se completa a medida que avanza el trámite. Todas
las variables y qué comando usa cada una: [configuracion.md](configuracion.md).

Comprueba que el certificado abre, **sin salir a la red**:

```
pnpm sii util firmar-semilla 123456
```

Si imprime un XML entre `===== COPIA DESDE AQUI =====` y `===== HASTA AQUI =====`, el .pfx y
la clave están bien. Con una clave incorrecta termina con código 3 y
`No se pudo abrir el .pfx: la contraseña es incorrecta.`

## 2. Usar la librería desde código

La librería es ESM, todo lo que habla con el SII es `async` y la firma y el timbre son
síncronos. Corre solo en Node (en Next.js, `export const runtime = 'nodejs'`, no Edge).
Dentro de este workspace se agrega como dependencia igual que en `apps/cli/package.json`:

```json
{ "dependencies": { "@winex/certificacion": "workspace:*" } }
```

Lo mínimo: certificado, firmador y transporte HTTP.

```ts
import { Certificado, FirmaElectronica, TransporteUndici } from '@winex/certificacion';

const certificado = await Certificado.desdeArchivo('data/certs/mi-certificado.pfx', 'clave');
// o desde bytes (p. ej. guardados cifrados en tu base de datos):
// const certificado = Certificado.desdeContenido(bytesDelPfx, 'clave');
const firmador = new FirmaElectronica(certificado.llavePrivada, certificado.certificado);

// Un transporte para toda la operación; se cierra solo al salir del bloque.
await using transporte = new TransporteUndici();
```

Reglas de la API:

- Lo que va al SII sale como **`Buffer` en ISO-8859-1**. Guárdalo y envíalo tal cual.
- **Nada escribe archivos por su cuenta:** tú decides dónde guardar CAF, sobres y tokens.
- Cada cliente recibe el **ambiente obligatorio** (`'certificacion'` o `'produccion'`); no
  hay valor por defecto.
- Los errores son clases de `SiiError` (ver [§7](#7-manejo-de-errores-en-código)). Los
  mensajes nunca traen PEM, claves, tokens ni cookies.

## 3. Pedir folios (CAF)

El CAF es el archivo con los folios autorizados; sin él no se puede timbrar.

**CLI:**

```
pnpm sii certificacion solicitar-folios --cantidad 5               # ensayo: NO timbra
pnpm sii certificacion solicitar-folios --cantidad 5 --confirmar   # timbra y guarda el CAF
```

El ensayo recorre el asistente del SII hasta la confirmación y muestra el rango que
asignaría. Con `--confirmar` deja `data/caf/caf-39-<desde>-<hasta>.xml` y sugiere las
líneas `SII_CAF_39=...` y `SII_FOLIO_INICIAL=...` para el `.env`.

**Código:**

```ts
import { writeFile } from 'node:fs/promises';
import { SolicitudFolios } from '@winex/certificacion';

const folios = new SolicitudFolios({ ambiente: 'certificacion', transporte });
const sesionFolios = await folios.autenticar(certificado); // reutilízala: el SII frena los re-login
const cafNuevo = await folios.solicitar(sesionFolios, '76123456-0', 39, 5); // RUT, tipo, cantidad
await writeFile('data/caf/caf-39.xml', cafNuevo);
```

Si falla con `FoliosSinCafError` (CLI: código 6), el SII ya timbró los folios pero no se
pudo bajar el archivo: **no reintentes**; descárgalo desde "Folios ya autorizados" en el
portal. Detalle en [folios.md](folios.md).

## 4. Certificación paso a paso

El trámite obligatorio antes de emitir en producción. Con la CLI, todo el flujo de
certificación se hizo contra el SII real (ver [validaciones.md](validaciones.md)). El
procedimiento con que se aprobó la certificación está en [certificacion.md](certificacion.md).

> **Sin RCOF.** El SII eliminó la obligación de enviar el RCOF (Resumen de Ventas Diarias,
> ex Reporte de Consumo de Folios) desde el **2022-08-01**. Ya no es parte de la
> certificación ni de la emisión diaria. Solo aplica a reportes pendientes de períodos
> hasta julio de 2022 (`sii certificacion enviar-rcof`, por DTEUpload).

### 4.1 Postular

```
pnpm sii certificacion postular --datos postulacion.json              # ensayo
pnpm sii certificacion postular --datos postulacion.json --confirmar
```

Formato del JSON en [cli.md](cli.md#postular). **Sin tildes ni `ñ`** en los datos: el
asistente del SII los devuelve doblemente codificados y la postulación no se graba.

Anota la **fecha en que postulas**: es la `SII_FCH_RESOL` de certificación. El
`SII_NRO_RESOL` de certificación es `0`.

```ts
import { DatosPostulacion, PostulacionSii } from '@winex/certificacion';

const postulacion = new PostulacionSii({ transporte });
const sesion = await postulacion.autenticar(certificado);
const resultado = await postulacion.postular(
  sesion,
  new DatosPostulacion({
    rutEmpresa: '76123456-0',
    rutAdministrador: '12345678-5',
    correoAdministrador: 'admin@empresa.cl',
    correoContactoSii: 'contacto@empresa.cl',
    correoIntercambio: 'dte@empresa.cl',
    nombreSoftware: 'Software Propio',
  }),
);
for (const aviso of resultado.avisos) console.log(aviso); // muéstraselos al usuario
```

### 4.2 Descargar el set de pruebas

El SII revisa el envío contra **el set que entregó a tu empresa** (el de
`data/set_pruebas/` es un ejemplo). Cada descarga queda registrada en el SII y entrega un
set nuevo.

```
pnpm sii certificacion descargar-set --confirmar
```

Deja `data/set_pruebas/set-pruebas-AAAA-MM-DD.txt` y sugiere la línea `SII_SET_PRUEBAS=...`.
También se puede bajar desde el portal del SII.

```ts
import { DeclaracionBoletas } from '@winex/certificacion';

const declaracion = new DeclaracionBoletas({ transporte });
const textoSet = await declaracion.descargarSetPruebas(sesion, '76123456-0', 'sw@proveedor.cl');
await writeFile('data/set_pruebas/set.txt', textoSet, 'utf8');
```

En P90 (lista para declarar) la librería se niega a bajar otro set.

### 4.3 Pedir el CAF de certificación

Como en el [§3](#3-pedir-folios-caf): un folio por caso del set (el de boletas trae 5). Es un
CAF de certificación (IDK 100). Apunta `SII_CAF_39` al CAF y `SII_FOLIO_INICIAL` a su primer
folio.

### 4.4 Enviar el set

```
pnpm sii certificacion enviar-set --solo-armar   # arma y guarda el sobre, sin red
pnpm sii certificacion enviar-set                # arma y envía por DTEUpload; consume folios
```

Imprime los casos que leyó (revísalos contra tu set), los folios asignados y el trackId.
Con `--canal rest` lo envía por la API REST (pangal). Antes de enviar, puedes revisar los
timbres del sobre armado:

```
pnpm sii util verificar-ted data/output/envio-set-boletas.xml
```

Lo mismo con la librería:

```ts
import { readFile } from 'node:fs/promises';
import {
  ArmadorBoleta,
  ClienteDtews,
  EnvioBoleta,
  parsearSetPruebas,
  type EmisorBoleta,
} from '@winex/certificacion';

const emisor: EmisorBoleta = {
  rut: '76123456-0',
  razonSocial: 'EMPRESA DE PRUEBA SPA',
  giro: 'ACTIVIDADES DE CONSULTORIA DE INFORMATICA',
  direccion: 'CALLE 123',
  comuna: 'SANTIAGO',
};
const caf = await readFile('data/caf/caf-39.xml');
const casos = parsearSetPruebas(await readFile('data/set_pruebas/set.txt'), '39');

// Genera, timbra, agrega el TED y firma cada boleta (valida emisor, tipo y rango del CAF).
const armador = new ArmadorBoleta(firmador);
const dtes = casos.map((caso, i) =>
  armador.armar(
    {
      emisor,
      receptor: { rut: '66666666-6', razonSocial: 'Cliente General' },
      folio: 31 + i, // un folio por caso, dentro del CAF
      tipoDte: caso.tipo,
      detalles: caso.detalles,
      referencia: caso.referencia,
    },
    caf,
  ),
);
const sobre = new EnvioBoleta(firmador, {
  rutEmisor: '76123456-0',
  rutEnvia: '12345678-5',
  nroResol: 0,
  fchResol: '2026-09-04', // fecha de la postulación
}).empaquetar(dtes);
await writeFile('data/output/envio-set-boletas.xml', sobre); // ya es ISO-8859-1: no lo conviertas

const dtews = new ClienteDtews(certificado, { ambiente: 'certificacion', transporte });
const token = await dtews.obtenerToken('76123456-0');
const trackId = await dtews.enviarDte(token, {
  rutEmisor: '76123456-0',
  rutEnvia: '12345678-5',
  xml: sobre,
  nombreArchivo: 'envio-set-boletas.xml',
});
```

### 4.5 Revisar el estado del envío

```
pnpm sii certificacion estado-envio <trackId>
```

Espera unos minutos después de enviar. Lo que buscas es `EPR` con todos los documentos
aceptados, sin rechazos ni reparos. Cada canal solo conoce sus envíos: un envío por
DTEUpload aparece por SOAP y responde "No existe recurso" por REST (y al revés, `-11`). Cómo
leer cada estado: [certificacion.md](certificacion.md#cómo-leer-el-estado).

```ts
const estado = await dtews.estadoEnvio(token, '76123456-0', trackId);
console.log(estado.resumen());
if (estado.limpio()) {
  // EPR, aceptado sin rechazos ni reparos
}
```

### 4.6 Pedir la revisión del set

Con el envío limpio:

```
pnpm sii certificacion solicitar-revision <trackId> --confirmar
```

El resultado llega por correo. Si el SII aprueba, el estado pasa a **P90**:

```
pnpm sii certificacion estado-declaracion
```

### 4.7 Declarar cumplimiento

**Deja a la empresa autorizada en producción.** Solo se puede en P90.

```
pnpm sii certificacion verificar-portal                               # el portal no cambió
pnpm sii certificacion declarar --datos declaracion.json              # ensayo
pnpm sii certificacion declarar --datos declaracion.json --confirmar
pnpm sii certificacion estado-declaracion                             # P91 = autorizada
```

```ts
import { DatosDeclaracion } from '@winex/certificacion';

await declaracion.solicitarRevisionSet(sesion, '76123456-0', trackId);
// ...días después, con el set aprobado:
const e = await declaracion.estado(sesion, '76123456-0');
if (e.porDeclarar()) {
  await declaracion.declarar(
    sesion,
    new DatosDeclaracion({
      rutEmpresa: '76123456-0',
      linkConsulta: 'https://www.empresa.cl/boletas',
      rutProveedor: '76543210-3',
      nombreProveedor: 'Proveedor SpA',
      correoProveedor: 'sw@proveedor.cl',
    }),
  );
}
```

Si la declaración termina con `DeclaracionInciertaError` (CLI: código 6), la orden salió y no
llegó la confirmación: consulta el estado antes de repetir (P91 = quedó; P90 = se puede
declarar de nuevo).

## 5. Producción: emitir boletas

Ya autorizada la empresa, se emite por la API REST de producción (api.sii.cl para el token,
rahue.sii.cl para el envío). En producción **Node es el único emisor**: el PHP no emite.
El procedimiento del piloto (primeras boletas, revisión diaria, qué hacer ante un rechazo)
está en [piloto-produccion.md](piloto-produccion.md).

### 5.1 Con la CLI

1. **CAF de producción** (IDK 300), en palena. Son **folios reales**:

   ```
   pnpm sii certificacion solicitar-folios --ambiente produccion --cantidad 10              # ensayo
   pnpm sii certificacion solicitar-folios --ambiente produccion --cantidad 10 --confirmar
   ```

2. **`.env`:** `SII_PRODUCCION_CAF_39` (el CAF de arriba), `SII_PRODUCCION_NRO_RESOL` y
   `SII_PRODUCCION_FCH_RESOL` (los de la autorización de la empresa; no hay valores por
   defecto). Opcional: `SII_CACHE_TOKENS` para reutilizar el token entre ejecuciones.

3. **Ensayo:** arma, timbra, firma y guarda la boleta, sin ninguna petición de red.

   ```
   pnpm sii produccion emitir --boleta boleta.json --folio 1
   pnpm sii util verificar-ted data/output/boleta-produccion-1.xml --caf <CAF de producción>
   ```

4. **Emitir** (documento real; consume el folio):

   ```
   pnpm sii produccion emitir --boleta boleta.json --folio 1 --confirmar
   ```

5. **Consultar** el envío, en unos minutos, y seguir todos los envíos:

   ```
   pnpm sii produccion consultar <trackId>
   pnpm sii produccion seguimiento
   ```

El formato de `boleta.json` y el registro que evita emitir dos veces el mismo folio están en
[cli.md](cli.md#emitir). Para probar todo esto en apicert / pangal, agrega
`--ambiente certificacion` (usa `SII_CAF_39`, `SII_NRO_RESOL` y `SII_FCH_RESOL`).

### 5.2 Con la librería

```ts
import { ClienteBoletaRest, TokenStoreArchivo } from '@winex/certificacion';

const cafProduccion = await readFile('data/caf/produccion/caf-39.xml'); // CAF de PRODUCCIÓN
const dte = new ArmadorBoleta(firmador).armar(
  {
    emisor,
    receptor: { rut: '66666666-6', razonSocial: 'Cliente General' },
    folio: 1, // uno de tu CAF, que no se haya usado
    detalles: [{ nombre: 'Producto', cantidad: 1, precio: 1190 }], // precio con IVA
  },
  cafProduccion,
);
const envio = new EnvioBoleta(firmador, {
  rutEmisor: emisor.rut,
  rutEnvia: '12345678-5',
  nroResol: 99,            // resolución de la autorización de la empresa
  fchResol: '2026-11-06',
}).empaquetar([dte]);
await writeFile('data/output/boleta-1.xml', envio);

const rest = new ClienteBoletaRest(certificado, {
  ambiente: 'produccion',
  transporte,
  tokenStore: new TokenStoreArchivo('data/output/tokens.json'), // opcional; por defecto, en memoria
});
const tokenRest = await rest.obtenerToken(emisor.rut); // reutiliza el token vigente (< 3000 s)
const respuesta = await rest.enviarBoleta(tokenRest, emisor.rut, '12345678-5', envio);
console.log(respuesta.trackId, respuesta.estado); // normalmente REC

const estadoRest = await rest.consultarEnvio(tokenRest, emisor.rut, respuesta.trackId);
console.log(estadoRest.estado, estadoRest.aceptados, estadoRest.rechazados);
```

Guarda qué folio usaste con qué boleta **antes** de enviar. Si `enviarBoleta` falla por red
o con un HTTP 5xx, no sabes si la boleta llegó: revisa en el SII antes de reenviar ese folio.

### Reglas de la boleta

- En la boleta, el **precio del detalle va con IVA incluido**; la librería calcula `MntNeto`
  e `IVA`.
- Un ítem exento lleva `exento: true` (booleano; otro valor es error). En una boleta 41
  (exenta) usa el CAF de tipo 41.
- El descuento global se reparte en las líneas afectas, nunca en las exentas.
- El receptor anónimo es `66666666-6`. `ArmadorBoleta` exige la razón social del receptor.
- Los datos entran como texto Unicode; la librería entrega los XML en **ISO-8859-1**, que es
  como se firman y se envían. No los conviertas: cambia los bytes firmados.
- Cada folio se usa **una sola vez**. `ArmadorBoleta` rechaza un folio fuera del rango del
  CAF o un CAF de otro emisor o tipo.
- **No hay RCOF diario** desde el 2022-08-01.

## 6. Otras operaciones útiles

| Para | CLI | Librería |
|---|---|---|
| Ver si el portal de la declaración cambió | `sii certificacion verificar-portal` | `DeclaracionBoletas.verificarPortal()` |
| Firmar una semilla REST a mano (Postman, Swagger) | `sii util firmar-semilla <semilla>` | `FirmaElectronica.firmarSemilla()` |
| Verificar los TED de un sobre | `sii util verificar-ted <sobre.xml>` | — |
| Reutilizar la sesión AUT2000 (el SII frena los re-login) | — | `sesion.aArreglo()` y `SesionSii.desdeArreglo()` (guárdala cifrada) |
| Probar sin red | — | `TransporteFalso` como transporte (ver [tests.md](tests.md)) |

## 7. Manejo de errores en código

Todos los errores de la librería son subclases de `SiiError`:

| Error | Cuándo | ¿Reintentar? |
|---|---|---|
| `ErrorValidacion` | Un dato de entrada no cumple las reglas (RUT, montos, trackId...). No salió nada | No: corregir el dato |
| `ErrorCertificado` | .pfx ilegible, clave incorrecta, PEM sin llave | No |
| `ErrorFirma`, `ErrorTimbre` | La firma o el timbre fallaron | No |
| `ErrorTransporte` | Red, timeout o HTTP inesperado (`status`) | Sí en consultas; en subidas, revisar antes |
| `ErrorRespuestaSii` | El SII respondió con un error (`estado`, `glosa`) | Según la glosa |
| `ErrorSolicitudFolios` / `SesionCaducaError` | Folios rechazados / sesión vencida antes de timbrar | `SesionCaducaError`: autenticar de nuevo |
| `FoliosSinCafError` | Se timbró y no se obtuvo el CAF | **No.** Bajar el CAF del portal |
| `ErrorPostulacion` / `SetSinDescargarError` | Postulación o portal de la declaración | Según el mensaje |
| `DeclaracionInciertaError` | La declaración salió y no se confirmó | **No.** Consultar `estado()` |

```ts
import {
  DeclaracionInciertaError,
  ErrorRespuestaSii,
  ErrorTransporte,
  FoliosSinCafError,
  SiiError,
} from '@winex/certificacion';

try {
  await rest.enviarBoleta(tokenRest, emisor.rut, '12345678-5', envio);
} catch (error) {
  if (error instanceof ErrorTransporte) {
    console.error(error.status, error.message); // sin status: no hubo respuesta
  } else if (error instanceof ErrorRespuestaSii) {
    console.error(error.estado, error.glosa);
  } else if (error instanceof FoliosSinCafError || error instanceof DeclaracionInciertaError) {
    // no reintentar: revisar en el SII
  } else if (error instanceof SiiError) {
    console.error(error.message);
  } else throw error;
}
```

La CLI traduce estos errores a sus [códigos de salida](cli.md#códigos-de-salida).

## 8. Más detalle

- Errores frecuentes y qué hacer: [solucion-de-problemas.md](solucion-de-problemas.md).
- Términos (TED, CAF, IDK, P90...): [glosario.md](glosario.md).
- Si vienes del PHP: [migracion-desde-php.md](migracion-desde-php.md).
- Índice completo: [README.md](README.md).
