# Configuración

Cómo se configura la CLI `sii`: el archivo `.env`, qué variables existen y qué comando usa
cada una. La librería (`@winex/certificacion`) **no lee el `.env` ni el entorno**: todo le
llega por parámetros. Lo de este documento aplica a la CLI y a los scripts de `scripts/`.

Código: `apps/cli/src/config.ts`. Plantilla: [`.env.example`](../.env.example).

## El archivo `.env`

```
cp .env.example .env
```

El `.env` **nunca se versiona** (está en el `.gitignore`): trae la clave del certificado y
los RUT de la empresa.

Reglas:

| Regla | Detalle |
|---|---|
| Dónde se busca | En `--env <ruta>` o, si no viene, en `./.env` (carpeta actual) |
| Si no existe | Sin `--env`, valen solo las variables del entorno. Con `--env` y un archivo que no existe: error de configuración (código 3) |
| El entorno gana | Una variable definida en el entorno del proceso reemplaza a la del `.env` |
| Vacía = faltante | `SII_FCH_RESOL=` cuenta como no definida. Ojo: una variable vacía en el entorno también tapa la del `.env` |
| Rutas del `.env` | Relativas a la **carpeta del `.env`**, no a la carpeta actual. `SII_CAF_39=data/caf/caf-39.xml` apunta a `<carpeta del .env>/data/caf/caf-39.xml` |
| Rutas de las opciones | Relativas a la **carpeta actual** (`--caf`, `--set`, `--salida`, `--boleta`...) |
| Opción sobre variable | Las opciones (`--caf`, `--folio-inicial`, `--fch-resol`, `--nro-resol`, `--set`, `--rut`, `--correo`...) reemplazan a la variable correspondiente |
| Validación | Cada comando valida **solo** las variables que usa, **todas antes de la primera petición** al SII. El error nombra todas las que fallan, sin mostrar sus valores |
| Formato | Lo lee `util.parseEnv` de Node (el mismo formato de `node --env-file`). Valores con espacios, `#` o comillas, entre comillas |

Con `pnpm sii ...`, pnpm ejecuta el comando desde la raíz del repo: el `.env` por defecto y
las rutas relativas de las opciones se toman desde ahí. Con el binario compilado
(`node apps/cli/dist/main.js`), desde la carpeta en que estés.

Varias empresas o ambientes: un `.env` por cada uno y `--env`:

```
pnpm sii certificacion estado-envio 1234567890 --env config/empresa-a.env
```

## Variables

| Variable | Qué es | Formato / por defecto |
|---|---|---|
| `SII_CERT_PATH` | Certificado digital: `.pfx`/`.p12` o PEM con la llave | Ruta. Obligatoria para todo lo que firma o hace login |
| `SII_CERT_PASS` | Clave del `.pfx` (o passphrase de la llave PEM) | Puede ir vacía. Se usa tal cual, sin recortar espacios |
| `SII_RUT_EMPRESA` | Empresa emisora | RUT con DV (`76123456-0`); se acepta con puntos o `k` minúscula y se normaliza. Debe ser el `<RE>` del CAF |
| `SII_RUT_FIRMA` | Titular del certificado, quien envía (`RutEnvia`) | RUT con DV. El RUT, no el nombre |
| `EMISOR_RAZON_SOCIAL` | Razón social del emisor | Texto |
| `EMISOR_GIRO` | Giro del emisor | Texto, **sin abreviaciones** (lo exige el SII) |
| `EMISOR_DIRECCION` | Dirección de origen | Texto |
| `EMISOR_COMUNA` | Comuna de origen | Texto |
| `SII_FCH_RESOL` | Fecha de resolución de **certificación** (la fecha de la postulación) | `AAAA-MM-DD`. Una sola fecha para el sobre y el RCOF |
| `SII_NRO_RESOL` | Número de resolución de certificación | Entero. Por defecto `0` |
| `SII_CAF_39` | CAF de boletas afectas de **certificación** (IDK 100) | Ruta |
| `SII_CAF_41` | CAF de boletas exentas de certificación | Ruta. Opcional: solo para `emitir --ambiente certificacion` con `tipoDte: 41` |
| `SII_FOLIO_INICIAL` | Primer folio libre del CAF para el set | Entero ≥ 1. El set usa un folio por caso, consecutivos |
| `SII_SET_PRUEBAS` | Set de pruebas `.txt` que entregó el SII | Ruta. En el ejemplo, `data/set_pruebas/Set Prueba BE.txt` |
| `SII_RCOF_SEC_ENVIO` | Secuencia del RCOF del día | Entero ≥ 1. Por defecto `1`. Solo `enviar-rcof` |
| `SII_CORREO_PROVEEDOR` | Correo del proveedor de software | Correo. Lo piden `descargar-set` y `declarar` |
| `SII_PRODUCCION_NRO_RESOL` | Número de resolución de **producción** | Entero. **Sin valor por defecto**: el de la autorización de la empresa |
| `SII_PRODUCCION_FCH_RESOL` | Fecha de resolución de producción | `AAAA-MM-DD`. Sin valor por defecto |
| `SII_PRODUCCION_CAF_39` | CAF de boletas afectas de **producción** (IDK 300) | Ruta |
| `SII_PRODUCCION_CAF_41` | CAF de boletas exentas de producción | Ruta. Opcional |
| `SII_CACHE_TOKENS` | Archivo JSON donde se guardan los tokens vigentes entre ejecuciones | Ruta. Opcional; la carpeta tiene que existir. Ver abajo |
| `CERTIFICACION_CORE` | Ruta al core PHP | Solo para `pnpm paridad:generar`; la CLI no la usa |

El RCOF (`SII_RCOF_SEC_ENVIO`) ya no es obligatorio: el SII lo eliminó desde el
**2022-08-01**. Solo sirve para reportes pendientes de períodos hasta julio de 2022.

### `SII_CACHE_TOKENS`

Sin esta variable, cada ejecución pide un token nuevo al SII. Con ella, la CLI guarda los
tokens en ese archivo y los reutiliza mientras estén vigentes (menos de 3000 segundos).

- La clave de cada token es canal + ambiente + empresa + huella del certificado: no se
  mezclan empresas, ambientes ni certificados.
- El archivo se escribe de forma atómica, con permisos `0600`.
- **Guarda credenciales:** no lo versiones ni lo compartas. Lo más simple es dejarlo en
  `data/output/` (ignorada por git), p. ej. `SII_CACHE_TOKENS=data/output/tokens.json`.
- Si el SII rechaza en una subida el token del caché (`STATUS 5` de DTEUpload, HTTP 401 en
  `produccion emitir`), la CLI lo borra y la siguiente ejecución pide otro.

## Qué variables usa cada comando

`✔` obligatoria · `○` opcional o con valor por defecto · `—` no la usa. "o JSON" / "o
opción": la variable solo se exige si no viene en el archivo de datos o en la opción.

| Comando | Cert. | `SII_RUT_EMPRESA` | `SII_RUT_FIRMA` | `EMISOR_*` | Resolución | CAF | Otras |
|---|---|---|---|---|---|---|---|
| `certificacion postular` | ✔ | o JSON | o JSON | — | — | — | — |
| `certificacion descargar-set` | ✔ | o `--rut` | — | — | — | — | `SII_CORREO_PROVEEDOR` o `--correo` |
| `certificacion solicitar-folios` | ✔ | ✔ | — | — | — | — | — |
| `certificacion enviar-set` | ✔ | ✔ | ✔ | ✔ | `SII_FCH_RESOL`, `SII_NRO_RESOL` (○ 0) | `SII_CAF_39` o `--caf` | `SII_FOLIO_INICIAL`, `SII_SET_PRUEBAS`, `SII_CACHE_TOKENS` ○ |
| `certificacion estado-envio` | ✔ | ✔ | ✔ | — | — | — | `SII_CACHE_TOKENS` ○ |
| `certificacion solicitar-revision` | ✔ | o `--rut` | — | — | — | — | — |
| `certificacion verificar-portal` | — | — | — | — | — | — | ninguna: no lee el `.env` |
| `certificacion estado-declaracion` | ✔ | o argumento | — | — | — | — | — |
| `certificacion declarar` | ✔ | o JSON | — | — | — | — | `SII_CORREO_PROVEEDOR` o JSON |
| `certificacion enviar-rcof` | ✔ | ✔ | ✔ | — | según `--ambiente` (ver abajo) | — | `SII_RCOF_SEC_ENVIO` ○ 1, `SII_CACHE_TOKENS` ○ |
| `produccion emitir` | ✔ | ✔ | ✔ | ✔ | según `--ambiente` (ver abajo) | según ambiente y `tipoDte` | `SII_CACHE_TOKENS` ○ |
| `produccion consultar` | ✔ | ✔ | — | — | — | — | `SII_CACHE_TOKENS` ○ |
| `produccion seguimiento` | ✔ | ✔ | — | — | — | — | `SII_CACHE_TOKENS` ○. Ver [piloto-produccion.md](piloto-produccion.md) |
| `util firmar-semilla` | ✔ | — | — | — | — | — | — |
| `util verificar-ted` | — | — | — | — | — | `SII_CAF_39` o `--caf` | — |

"Cert." es `SII_CERT_PATH` + `SII_CERT_PASS`. Se lee y se abre el certificado antes de
cualquier petición: una clave incorrecta termina con código 3 sin haber salido nada.

`estado-envio` exige `SII_RUT_FIRMA` aunque solo consulta: lee el par empresa/titular de
una vez.

### Resolución y CAF según el ambiente

| Comando | `certificacion` | `produccion` |
|---|---|---|
| `produccion emitir` (por defecto `produccion`) | `SII_CAF_39` / `SII_CAF_41`, `SII_NRO_RESOL` (○ 0), `SII_FCH_RESOL` | `SII_PRODUCCION_CAF_39` / `_41`, `SII_PRODUCCION_NRO_RESOL`, `SII_PRODUCCION_FCH_RESOL` (sin valores por defecto) |
| `certificacion enviar-rcof` (por defecto `certificacion`) | `SII_NRO_RESOL` (○ 0), `SII_FCH_RESOL` | `SII_PRODUCCION_NRO_RESOL`, `SII_PRODUCCION_FCH_RESOL` |
| `certificacion solicitar-folios` (por defecto `certificacion`) | Timbra en maullin. El CAF sirve para `SII_CAF_39` | Timbra en palena **folios reales**; sin `--confirmar` solo recorre el asistente. `--cantidad` es obligatoria. El CAF va en `SII_PRODUCCION_CAF_39` (o `_41`) |

`emitir` elige la variable del CAF por el `tipoDte` del JSON de la boleta: 39 → `..._CAF_39`,
41 → `..._CAF_41`. `--caf`, `--nro-resol` y `--fch-resol` reemplazan a las variables.

## Carpetas de `data/`

| Carpeta | Versionada | Contenido |
|---|---|---|
| `data/schemas/` | sí | XSD del SII (`EnvioBOLETA_v11.xsd`, `ConsumoFolio_v10.xsd`...) |
| `data/set_pruebas/` | sí | `Set Prueba BE.txt`: set de ejemplo de 5 casos. Para certificar, usa **el set que el SII entregó a tu empresa** |
| `data/certs/` | no | Certificado digital |
| `data/caf/` | no | CAF (traen la llave privada de los folios). `solicitar-folios` los deja aquí por defecto |
| `data/output/` | no | Lo que escribe la CLI: sobres, RCOF, registros de envío. La crea la CLI si falta |

Todas se resuelven contra la carpeta del `.env`. `--salida <dir>` (relativa a la carpeta
actual) cambia dónde escribe cada comando.

## Otras variables del entorno

No van en el `.env` de la CLI, pero cambian el comportamiento del proceso Node:

| Variable | Efecto |
|---|---|
| `NODE_EXTRA_CA_CERTS` | Agrega CA raíz para verificar los servidores del SII (p. ej. detrás de un proxy corporativo que inspecciona TLS). La verificación nunca se apaga |
| `NODE_TLS_REJECT_UNAUTHORIZED=0` | **No tiene efecto**: el transporte fuerza `rejectUnauthorized: true` |
