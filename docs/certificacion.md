# Certificación de boleta electrónica con Node

Cómo enviar el set de pruebas al ambiente de **certificación** del SII usando solo la
librería Node (`@winex/certificacion`). Es el procedimiento con que se aprobó la
certificación el 2026-11-06; los resultados están en [validaciones.md](validaciones.md).

Desde la fase 7, el flujo completo se hace con la CLI `sii` (ver [cli.md](cli.md)). Este
documento describe además los scripts con que se hizo la certificación:
`scripts/validar-certificacion.ts` (set de pruebas) y `scripts/solicitar-folios.ts`
(CAF). Esos scripts **solo hablan con certificación** (maullin / apicert / pangal): el
ambiente está fijo en el código y no se puede cambiar por configuración.

> **RCOF: ya no es obligatorio.** El SII eliminó la obligación de enviar el Resumen de
> Ventas Diarias (RCOF, antes Reporte de Consumo de Folios) a partir del **1 de agosto de
> 2022**. Las boletas emitidas desde esa fecha no se reportan en un RCOF diario; la
> obligación sigue solo para períodos hasta **julio de 2022 inclusive** (reportes pendientes
> o deudas de esas fechas, que se revisan en los servicios online de boletas electrónicas del
> sitio del SII).
>
> Por eso `validar-certificacion.ts` **ya no arma ni envía el RCOF por defecto**: solo con
> `--con-rcof` (lo que hacían los scripts del PHP; así se hizo la certificación del
> 2026-11-06, y el SII lo recibió por `DTEUpload` con reparos que no bloquearon la
> aprobación). Por la API REST (pangal) el SII responde **HTTP 404** al RCOF; para un período
> antiguo pendiente, usar el canal SOAP.

## Antes de empezar

1. **Postular** a la certificación de boleta electrónica en el SII. La **fecha de la
   postulación** es la `FchResol` de certificación; el `NroResol` es `0`.
2. **Descargar el set de pruebas de tu empresa** desde maullin. El SII revisa el envío
   contra el set que entregó a esa empresa; guárdalo en `data/set_pruebas/`.
3. **Pedir un CAF de boletas (tipo 39) en maullin**, con al menos un folio por caso del set
   (el set de boletas trae 5). Es un CAF de certificación (`<IDK>100</IDK>`); los de
   producción traen IDK 300 y no sirven aquí. Se puede pedir con Node (ver
   [Pedir folios](#pedir-folios-caf)) o en el portal; queda en `data/caf/`.
4. **Certificado digital** (.pfx) del titular que envía, vigente.

`data/caf/`, `data/output/` y `.env` no se versionan: traen la llave del CAF, RUTs y
claves.

## Configuración (`.env`)

Copia `.env.example` a `.env` y completa:

| Variable | Qué es | Ojo |
|---|---|---|
| `SII_CERT_PATH`, `SII_CERT_PASS` | .pfx y su clave | Los .pfx del SII son legacy (RC2-40); Node los lee sin `openssl` |
| `SII_RUT_EMPRESA` | RUT de la empresa emisora | Con guion: `76543210-K`. Debe ser el `<RE>` del CAF |
| `SII_RUT_FIRMA` | RUT del titular del certificado | El **RUT**, no el nombre |
| `EMISOR_RAZON_SOCIAL`, `EMISOR_GIRO`, `EMISOR_DIRECCION`, `EMISOR_COMUNA` | Datos del emisor | El giro, sin abreviaciones (lo pide el SII). Sin comillas |
| `SII_FCH_RESOL` | Fecha de la postulación, `AAAA-MM-DD` | Una sola fecha para el sobre (y el RCOF, si se envía) |
| `SII_NRO_RESOL` | `0` en certificación | |
| `SII_CAF_39` | Ruta al CAF, p. ej. `data/caf/caf-39-31-35.xml` | |
| `SII_FOLIO_INICIAL` | Primer folio sin usar del CAF | Se usan tantos folios consecutivos como casos tenga el set |
| `SII_SET_PRUEBAS` | Ruta al set (por defecto `data/set_pruebas/Set Prueba BE.txt`) | |
| `SII_RCOF_SEC_ENVIO` | Secuencia del RCOF del día (por defecto `1`) | Solo con `--con-rcof` (el RCOF no es obligatorio desde 2022-08-01) |

## Pedir folios (CAF)

```
node scripts/solicitar-folios.ts revisar   [--tipo 39] [--cantidad 5]   # hasta la confirmación, NO timbra
node scripts/solicitar-folios.ts solicitar [--tipo 39] [--cantidad 5]   # timbra y guarda el CAF
```

Inicia sesión en AUT2000 con el certificado y recorre el asistente de timbraje de maullin.
`revisar` se detiene antes de la orden de timbrar (no gasta folios) y muestra el rango que
ofrecería el SII. `solicitar` timbra y guarda el CAF en `data/caf/caf-<tipo>-<desde>-<hasta>.xml`,
ya revisado (IDK de certificación, RUT de la empresa y tipo pedido). Las respuestas del SII
quedan en `data/output/folios-<fecha>/`. Después, apunta `SII_CAF_39` al CAF nuevo y
`SII_FOLIO_INICIAL` a su primer folio.

Si falla **después** de la orden de timbrar (`FoliosSinCafError`), los folios pueden estar
timbrados: no repitas la solicitud; baja el CAF desde "Folios ya autorizados" en el portal.
El SII frena los inicios de sesión seguidos (unos 5 ciclos).

## Pasos

Todos los comandos, desde la raíz de `certificacion-node`:

```
node scripts/revisar-env.ts                         # 1. revisa el .env (no imprime valores)
node scripts/validar-certificacion.ts token         # 2. token SOAP y REST con el certificado
node scripts/validar-certificacion.ts armar         # 3. arma el set, sin enviar
node scripts/validar-certificacion.ts enviar        # 4. envía el set; consume folios
node scripts/validar-certificacion.ts estado <trackId> <trackId>   # 5. consulta el estado
```

1. **`revisar-env`** comprueba, sin mostrar valores: RUTs válidos, que el RUT que firma sea
   el titular del certificado, resolución `0` con fecha no futura, CAF tipo 39 de
   certificación del mismo RUT empresa, y que los folios del set quepan en el CAF. Avisa si
   el set es idéntico al de ejemplo del repo. Corrige todo lo marcado `ERROR` antes de seguir.
2. **`token`** confirma que el SII acepta el certificado (no envía documentos).
3. **`armar`** muestra cada caso con su folio y deja `validacion-envio-set.xml` en
   `data/output/` (con `--con-rcof`, también `validacion-rcof.xml`). Conviene validarlo
   contra los XSD antes de enviar (ver abajo).
4. **`enviar`** pide un token y sube el set por `DTEUpload` (maullin), como los scripts del
   PHP, e imprime su trackId. Con `--canal rest` lo sube por la API REST (pangal). Con
   `--con-rcof` envía además el RCOF después del set (ver la nota del inicio); por REST, el
   SII le responde HTTP 404 y el script termina con error, aunque el set ya quedó subido.
5. **`estado`** consulta cada trackId por SOAP (`QueryEstUp`) y por REST. Espera unos
   minutos después de enviar. Para ver la respuesta cruda del SII (sin el token):
   `node scripts/estado-crudo.ts <trackId>`.

Validar contra los XSD (PHP con libxml):

```php
$d = new DOMDocument(); $d->load('data/output/validacion-envio-set.xml');
var_dump($d->schemaValidate('data/schemas/EnvioBOLETA_v11.xsd'));   // RCOF: ConsumoFolio_v10.xsd
```

## Cómo leer el estado

| Estado | Significado | Qué hacer |
|---|---|---|
| `REC`, `SOK`, `CRT`, `FOK`, `PRD` | El SII todavía valida | Volver a consultar |
| `-11` (sin glosa) | Visto apenas subido un RCOF (pasó a `RPR` minutos después) y al consultar por SOAP un envío REST | Volver a consultar; si el envío fue por REST, consultarlo por REST |
| `EPR` | Envío procesado | Revisar aceptados / rechazados / reparos |
| `RPR` | Aceptado con reparos | El detalle llega por correo al contacto de la empresa y al portal; `QueryEstUp` no lo trae |
| `RCH`, `RFR`, `RCT`... | Rechazado | Revisar la glosa |

Cada consulta **solo conoce los envíos de su propio canal**: la REST
(`boleta.electronica.envio`) responde "No existe recurso" para un trackId de `DTEUpload`, y
`QueryEstUp` devuelve `-11` para uno subido por REST.

## Problemas conocidos

- **El primer intento a un host puede agotar el tope de conexión (10 s).** Pasó con apicert
  y con maullin; el reintento funcionó de inmediato. Es la red o el SII. Vuelve a correr el
  comando (`token` y `estado` no tienen efectos; `enviar` sí: antes de repetirlo, revisa si
  la subida alcanzó a llegar).
- **Folios ya usados.** Cada `enviar` consume folios. No repitas folios de un envío anterior;
  si reenvías, pide un CAF nuevo o avanza `SII_FOLIO_INICIAL`.
- **RCOF por REST: HTTP 404** (solo con `--con-rcof`). Pangal no expone
  `boleta.electronica.consumo` (el PHP usa la misma URL). Es esperable: el SII eliminó el
  RCOF desde el 2022-08-01.

## Después de certificar: producción

La empresa queda autorizada a emitir en producción (palena / api / rahue). Estos scripts no
sirven para eso. Diferencias que hay que tener en cuenta, para la CLI (fase 7) y el piloto
(fase 8):

- **CAF de producción** (IDK 300), pedido en palena. Los folios de producción emiten
  documentos con valor tributario.
- **Resolución:** el bin de producción del PHP usa la resolución general de boleta
  electrónica, `NroResol 80` del `2014-08-22` (`bin/produccion/emitir-boleta.php`).
  Confirmar con el SII antes de usarla.
- **Canal:** en producción el PHP emite boletas por la API REST (`SiiBoletaProduccion`,
  aquí `ClienteBoletaRest` con `ambiente: 'produccion'`). La subida REST se validó en
  certificación el 2026-11-07 (set EPR 5/5 en pangal).
- **Sin RCOF diario:** desde el 2022-08-01 no se envía. Solo haría falta para reportes
  pendientes de períodos hasta julio de 2022, y en ese caso por `DTEUpload`.
- Antes del corte va un piloto con pocas boletas reales, solo con Node (el PHP no emite
  en producción; decisión del 2026-11-10): ver [piloto-produccion.md](piloto-produccion.md).
