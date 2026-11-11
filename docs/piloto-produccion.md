# Piloto en producción con la CLI

Cómo emitir las primeras boletas **reales** con la CLI de Node (`sii`) y observarlas en el
SII durante 1–2 semanas antes del corte (fase 8 de `PLAN-MIGRACION.md`).

El piloto es **solo con Node**: unas pocas boletas reales de bajo riesgo. El PHP no emite
en producción, así que no hay que repartir folios entre los dos ni comparar sus estados.

> **En producción cada boleta es un documento tributario real y consume un folio.** Nada
> de esta guía se hace a ciegas: cada paso que sale al SII de producción tiene su ensayo
> previo, y la emisión con `--confirmar` se hace solo con la aprobación explícita del
> responsable.

Todos los comandos se corren desde la raíz de `certificacion-node`, en PowerShell, con
`pnpm sii ...` (o con el binario `sii` si está instalado).

## Requisitos previos

1. **Empresa autorizada** a emitir boleta electrónica en producción (certificación
   aprobada). Se confirma con `pnpm sii certificacion estado-declaracion`.
2. **Certificado digital** (.pfx) vigente, de un representante electrónico de la empresa
   (lo exige el timbraje de folios).
3. **CAF de producción.** Se pide con la CLI, en dos pasos:

   ```
   pnpm sii certificacion solicitar-folios --ambiente produccion --tipo 39 --cantidad 5 --folio-inicial 1
   pnpm sii certificacion solicitar-folios --ambiente produccion --tipo 39 --cantidad 5 --folio-inicial 1 --confirmar
   ```

   - `--folio-inicial 1` hace falta en el **primer** timbraje de boletas en producción: el
     SII pide "Ingrese Folio Inicial" (visto el 2026-11-10). En los timbrajes siguientes el
     SII no lo pide y la opción no cambia nada.

   - Sin `--confirmar` recorre el asistente de palena, se detiene **antes** de timbrar e
     informa el rango que asignaría el SII. No gasta folios.
   - Con `--confirmar` timbra los folios (irreversible) y deja el CAF en
     `data/caf/caf-produccion-39-<desde>-<hasta>.xml`.
   - Para el piloto bastan pocos folios.
   - Si termina con código 6, **no repitas la solicitud**: baja el CAF desde "Folios ya
     autorizados" en el portal del SII.
4. **`.env`** con la configuración de producción (además de la general: certificado,
   `SII_RUT_EMPRESA`, `SII_RUT_FIRMA` y los `EMISOR_*`):

   | Variable | Qué es | Ojo |
   |---|---|---|
   | `SII_PRODUCCION_CAF_39` | Ruta al CAF de producción del paso 3 | Relativa al `.env`. Para boletas exentas, `SII_PRODUCCION_CAF_41` |
   | `SII_PRODUCCION_NRO_RESOL` | Número de la resolución de la empresa | Sin valor por defecto. Confírmalo con el SII |
   | `SII_PRODUCCION_FCH_RESOL` | Fecha de esa resolución, `AAAA-MM-DD` | Sin valor por defecto |
   | `SII_CACHE_TOKENS` | Opcional. Archivo donde se guardan los tokens vigentes | La carpeta tiene que existir. Guarda credenciales: no lo versiones |

   Con `SII_CACHE_TOKENS`, las consultas diarias reutilizan el token y piden menos
   semillas al SII.

`data/` y `.env` no se versionan: traen el CAF (con su llave), RUTs y claves.

## La boleta (`--boleta`)

Un archivo JSON con los ítems. El folio **no** va en el JSON: se pasa con `--folio`. Los
campos desconocidos son error. Ejemplo mínimo (datos ficticios), en
`data/piloto/boleta-1.json`:

```json
{
  "tipoDte": 39,
  "detalles": [
    { "nombre": "Producto de prueba", "cantidad": 1, "precio": 1190 }
  ]
}
```

- `precio`: unitario **bruto** (IVA incluido), en pesos.
- Sin `receptor`, va el genérico `66666666-6` "Cliente General".
- Opcionales: `receptor` (`rut` y `razonSocial`), `"exento": true` y `"unidad"` por ítem,
  y `descuento` (`{ "tipo": "monto" | "porcentaje", "valor": N }`, solo sobre lo afecto).
- El formato completo está en `pnpm sii produccion emitir --ayuda`.

**Bajo riesgo** quiere decir: una venta real, de monto bajo, con un solo ítem simple y el
receptor genérico. Sigue siendo un documento tributario: tiene que corresponder a una
operación real.

## Pasos

### 1. Ensayo sin `--confirmar`

```
pnpm sii produccion emitir --boleta data/piloto/boleta-1.json --folio <N>
```

- `<N>` es un folio del CAF de producción que no se haya usado.
- Arma, timbra y firma la boleta, y la guarda en `data/output/boleta-produccion-<N>.xml`.
- **No hace ninguna petición de red.** No consume el folio.
- Revisa el resumen: emisor, folio, rango del CAF, resolución, ítems y total.

### 2. Verificar el timbre

```
pnpm sii util verificar-ted data/output/boleta-produccion-<N>.xml --caf data/caf/caf-produccion-39-<desde>-<hasta>.xml
```

- Pasa siempre `--caf` con el CAF de producción: sin él, el comando usa `SII_CAF_39`, que
  es el de certificación.
- Tiene que dar `OK` y terminar con 0. Si da 7, no sigas.

### 3. Emitir la primera boleta (con aprobación)

Solo con la **aprobación explícita del responsable**, repite el mismo comando del paso 1
agregando `--confirmar`:

```
pnpm sii produccion emitir --boleta data/piloto/boleta-1.json --folio <N> --confirmar
```

- Envía la boleta por la API REST (rahue) e imprime el **trackId**.
- Deja el registro `data/output/boleta-produccion-<N>.envio.json`. Mientras exista, ese
  folio no se vuelve a emitir.
- Anota el folio y el trackId en la bitácora de abajo.

### 4. Consultar el envío

Unos minutos después:

```
pnpm sii produccion consultar <trackId>
```

Lo esperable es `EPR` con la boleta aceptada. Si sale `REC`, `SOK`, `CRT`, `FOK` o `PRD`,
el SII todavía valida: vuelve a consultar más tarde.

### 5. Seguimiento diario (1–2 semanas)

Una vez al día, durante todo el período de observación:

```
pnpm sii produccion seguimiento --bitacora data/piloto/bitacora.jsonl
```

- Lee todos los registros `boleta-produccion-*.envio.json` de `data/output/` y consulta
  cada trackId en el SII, con un solo token.
- Imprime una tabla: folio, tipo, fecha del envío, trackId, estado SII, aceptados,
  rechazados y reparos. Debajo, el detalle de rechazos y reparos, y los envíos inciertos.
- `--bitacora` agrega una línea JSON por envío (con la fecha de la consulta). La carpeta
  `data/piloto/` tiene que existir. El archivo nunca se reescribe: queda el historial.
- Otras opciones: `--desde AAAA-MM-DD` (solo los envíos desde ese día), `--json` y
  `--salida <dir>`. Ver `pnpm sii produccion seguimiento --ayuda`.
- No envía documentos.

**Automático (Windows).** `scripts/seguimiento-diario.ps1` corre ese mismo comando, agrega
la salida con fecha y código a `data/piloto/seguimiento.log` y, si el código no es 0, deja
una línea en `data/piloto/ALERTAS.txt`. La tarea programada **"SII seguimiento piloto"**
lo ejecuta todos los días a las 09:00 hasta el 2026-11-24 (si el equipo estaba apagado,
corre al encenderlo). Solo corre con la sesión de Windows iniciada, porque usa el `.env`
y el certificado locales.

```
Start-ScheduledTask -TaskName 'SII seguimiento piloto'                   # correrlo ahora
Get-ScheduledTaskInfo -TaskName 'SII seguimiento piloto'                 # última corrida y resultado
Unregister-ScheduledTask -TaskName 'SII seguimiento piloto' -Confirm:$false   # quitarlo
```

Revisa `ALERTAS.txt` de vez en cuando: si existe, algo dio 5, 6, 4 o 3.

Las demás boletas del piloto se emiten igual (pasos 1 a 3), una a la vez, cada una con su
folio.

## Códigos de salida del seguimiento

| Código | Significa | Qué hacer |
|---|---|---|
| 0 | Todo aceptado (con o sin reparos) o aún en proceso. También si no hay registros | Nada. Si hay envíos en proceso, vuelve a correrlo más tarde |
| 5 | Algún envío rechazado o con documentos rechazados (o una respuesta del SII que no se entiende) | Ver [Rechazo](#rechazo-código-5) |
| 6 | Hay envíos inciertos o registros ilegibles | Ver [Envío incierto](#envío-incierto-código-6) |
| 4 | Alguna consulta falló por red o HTTP | Reintentar más tarde |
| 3 | Configuración inválida (no salió nada al SII) | Corregir el `.env` o las opciones |

Si se dan varios casos, gana el primero de la tabla: 5, después 6, después 4.

### Rechazo (código 5)

1. Lee el detalle del seguimiento (o `pnpm sii produccion consultar <trackId>`): código y
   glosa del error por folio.
2. **No emitas más boletas** hasta entender la causa.
3. Decide si el rechazo es **atribuible a la migración** (XML, timbre, firma, carátula,
   montos que arma Node) o a otra cosa (datos de la venta, configuración, el SII).
4. Anótalo en la bitácora con esa conclusión.
5. El folio rechazado no se reutiliza. Si la venta sigue en pie, se emite con otro folio
   después de corregir la causa.

Una boleta **con reparos** (`RPR`) está aceptada: no da 5, pero revisa el detalle igual.

### Envío incierto (código 6)

El envío se cortó (red, error 5xx) y no se sabe si la boleta llegó al SII. El registro
queda con `"incierto": true` y sin trackId; el seguimiento no puede consultarlo.

1. **No reemitas a ciegas.**
2. Revisa en el portal del SII (consulta de boletas emitidas) si el folio quedó recibido.
3. Si quedó recibido: anota el folio como emitido en la bitácora. Deja el registro como
   está (bloquea ese folio).
4. Si **no** llegó: emite la venta con **otro folio** y deja el registro como está, para
   que el folio dudoso siga bloqueado (así no se arriesga un duplicado). Si después se
   confirma que ese folio nunca llegó al SII, anúlalo en el portal ("Anulación de folios").

Un registro **ilegible** (JSON roto o con campos que faltan) también da 6: revísalo a mano
y confirma en el portal qué pasó con ese folio.

## Criterio de salida

El piloto termina bien con **0 rechazos atribuibles a la migración** durante todo el
período de observación (1–2 semanas). Al final:

- todas las boletas del piloto en `EPR` aceptadas (o con reparos explicados);
- ningún envío incierto sin resolver;
- la bitácora completa, con una entrada por día.

## Bitácora (para llenar a mano)

Una fila por boleta emitida y por revisión diaria. La bitácora `.jsonl` del seguimiento es
el respaldo automático.

| Fecha | Folio | TrackID | Estado | Observación |
|---|---|---|---|---|
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
| | | | | |
