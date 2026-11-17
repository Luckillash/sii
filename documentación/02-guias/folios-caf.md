---
title: "Folios: solicitar CAF, subirlo, anular y alertas"
description: "Gestión de folios de la Fase 6 (/[org]/folios): disponibilidad por tipo y ambiente, solicitud en tres niveles (ensayo, revisión con el SII, timbrado), solicitud incierta, carga manual de un CAF, anulación con anular_folios, alerta folios.por_agotarse y permisos. Más los folios del set de pruebas de la Fase 5."
keywords: [folios, CAF, /folios, Folios (CAF), server/folios, lib/folios, solicitarFolios, subirCaf, anularFolios, leerFolios, puedeEmitir, alertaDespuesDeAsignar, alertarSiCruza, solicitarFoliosSet, solicitarEnSii, TransporteSinTimbrar, DetenidoAntesDeTimbrar, of_genera_folio, SolicitudFolios, solicitar_folios, registrar_caf, anular_folios, trg_20_caf_sin_traslape, 23P01, migración 0011, Vault, RSASK, RSAPK, cafs, solicitudes_folios, folios_anulados, en_curso, simulada, timbrada, incierta, rechazada, error, revisión con el SII, revisionId, MINUTOS_REVISION_VIGENTE, ensayo, timbrar, FolioInicialRequeridoError, folio inicial, FoliosSinCafError, representante electrónico, IDK 100, IDK 300, autorizada_produccion, permite_produccion, plan_vigente, asignar_folio, Folios ya autorizados, Marcar como revisada, MedidorFolios, UMBRAL_AVISO_FOLIOS, 15 %, disponibilidadDe, decidirAlerta, folios.por_agotarse, Idempotency-Key, encolar_evento, correoFoliosPorAgotarse, cola, Anular los que quedan, RangoAnulados, ErrorFolios, armarResumen, leerResumenFolios, Tablero]
related: ["04-objetos/objetos-folios.md", "03-api-reference/rpc-backend.md", "03-api-reference/indice-operaciones.md", "05-pruebas/set-de-pruebas.md", "02-guias/certificacion-empresa.md", "01-fundamentos/errores-y-resultados.md", "07-referencia/trampas-conocidas.md", "08-esquema-supabase/despliegue.md", "02-guias/tablero-y-reportes.md"]
source: ["supabase_saas_sii.sql §7", "certificacion-node/docs/folios.md", "supabase/migrations/0008_certificacion.sql", "supabase/migrations/0011_folios.sql", "apps/web/src/server/folios/", "apps/web/src/lib/folios.ts", "apps/web/src/app/[org]/folios/", "apps/web/src/server/certificacion/folios.ts", "apps/web/src/server/certificacion/envio-set.ts", "packages/correos/src/folios.ts"]
---

# Folios: solicitar CAF, subirlo, anular y alertas

> **Úsalo cuando:** necesitas pedir o cargar un CAF, anular folios, entender la alerta de folios bajos o dar folio a una boleta.

**Estado (2026-11-15).** La **Fase 6** está desplegada en *Production* (`4f26921`) y con el
criterio de aceptación cumplido el 2026-11-15
([prueba real](#prueba-real-en-production-criterio-de-aceptación)). La
migración `0011_folios` (RPC `anular_folios`, trigger `trg_20_caf_sin_traslape`, sin
política `alta` en `folios_anulados` y Realtime de `cafs` y `folios_anulados`) está
**aplicada el 2026-11-15** en producción (verificación 18/18 y simulación 27/27;
[despliegue](../08-esquema-supabase/despliegue.md#fase-6-migración-0011)). En una base sin
ella (referencia):

| Qué | Sin la 0011 |
|---|---|
| Anular folios | `anular_folios` no existe (`PGRST202`): el usuario ve «No pudimos anular los folios» y no se anula nada |
| Subir un CAF que se cruza con otro | la app lo rechaza igual (revisa los rangos antes de llamar a `registrar_caf`) |
| Timbrar un CAF que se cruza con otro | entra: solo la llave única `(empresa, ambiente, tipo, folio_desde)` atrapa el mismo `folio_desde` |
| `insert` directo en `folios_anulados` con la sesión de un administrador | pasa (política `alta` de la 0001); la app no lo hace. Con la 0011 da `42501` |
| Realtime de `cafs` y `folios_anulados` | no están publicadas (la vista no las escucha todavía) |
| Todo lo demás (vista, solicitud, carga, alerta) | funciona: usa `registrar_caf` (0008) y tablas de la 0001 |

## Dónde vive

| Pieza | Archivo |
|---|---|
| Página y Server Actions | `apps/web/src/app/[org]/folios/` (`page.tsx`, `acciones.ts`, `Folios.tsx`, `EnVivo.tsx`, `logica.ts`) |
| Capa de servidor (`server-only`) | `apps/web/src/server/folios/` (API en `index.ts`): `lectura`, `disponibles`, `plan`, `solicitar`, `sii`, `caf`, `subir`, `anular`, `alertas`, `errores`, `tipos` |
| Contrato con la UI (puro) | `apps/web/src/lib/folios.ts`: tipos 39/41, ambientes, regla del umbral, `ResultadoFolios`, esquemas zod |
| Correo de la alerta | `packages/correos/src/folios.ts` (`correoFoliosPorAgotarse`) |
| Folios del set (Fase 5) | `apps/web/src/server/certificacion/folios.ts`, que desde la Fase 6 reutiliza `server/folios/sii.ts` |

Las acciones devuelven `ResultadoFolios`: `ensayo` (resumen para el `Dialogo`), `revision`
(rango que asignaría el SII y `revisionId`), `ok` (mensaje y avisos) o `error` (mensaje,
`motivo`, `errores` por campo, `operacionPendienteId` o `requiere.folioInicial`).

## La vista `/[org]/folios`

`page.tsx` exige membresía (`exigirMembresia`), elige la empresa (`?empresa=<id>`, si no la
última usada, si no la primera activa) y lee todo con `leerFolios(organizacionId,
empresaId)` usando el cliente de **sesión** (RLS: la ve cualquier miembro). `maxDuration =
300` y `runtime = 'nodejs'`: en Next 16 el valor de la página aplica a sus Server Actions,
y la solicitud hace varias peticiones de hasta 45 s al SII.

| Bloque | Qué muestra |
|---|---|
| Selector de empresa | formulario GET (funciona sin JavaScript), solo si hay más de una |
| Avisos | solicitud en curso por ambiente; solicitudes **por verificar** (incierta o `en_curso` abandonada sin revisar) con la guía y «Subir el CAF» / «Marcar como revisada» (sin «Subir el CAF» si es un traslape, ver [Solicitud incierta](#solicitud-incierta)); falta un representante electrónico; «Solo un propietario o un administrador gestiona los folios» para lector y emisor |
| Resumen | una tarjeta por ambiente (Producción, Certificación) con un `MedidorFolios` por tipo (39 y 41): folios libres, CAF en uso y estado `sello` / `aviso` (≤ 15 %) / `error` (agotado o sin CAF) |
| Solicitar folios (admin) | tipo, ambiente, cantidad (1–10.000) y, si el SII lo pidió, folio inicial con el sugerido; «Preparar la solicitud» deshabilitado con el motivo si algo lo bloquea |
| Subir un CAF (admin) | ambiente (IDK 100 / 300) y archivo XML (hasta 64 KB) |
| Historial de CAF | últimos 50: ambiente, tipo, folios, fecha de autorización, estado, siguiente folio, anulados; acciones «Anular folios» y «Anular los que quedan» (admin) |
| Historial de solicitudes | últimas 30: fecha, ambiente, tipo, cantidad, rango, estado, quién la pidió, mensaje |

**En vivo.** `EnVivo.tsx` escucha por Realtime `solicitudes_folios`, `operaciones_sii` y
`cafs` (`filter: empresa_id=eq.<id>`) y `folios_anulados` (`filter:
organizacion_id=eq.<id>`: no tiene `empresa_id`, así que llegan los de toda la
organización), y hace `router.refresh()` con 400 ms de espera; no guarda las filas. Así la
vista abierta ve también la carga o anulación de otro administrador y el avance de
`siguiente_folio` al emitir. Las dos primeras tablas están en la publicación desde la 0006;
`cafs` y `folios_anulados` las agrega la 0011 (**aplicada el 2026-11-15**); en una base sin
ella esas dos suscripciones no reciben eventos y la vista se comporta como antes
([Realtime](../06-integraciones/realtime-y-storage.md#realtime)).

### Disponibilidad y umbral

La misma regla en el resumen, el ensayo, `puedeEmitir` y la alerta (`disponibilidadDe` de
`@/lib/folios`), alineada con `asignar_folio` y `v_folios_disponibles`:

| Valor | Cálculo, sobre los CAF `activo` con `siguiente_folio <= folio_hasta` de una empresa, ambiente y tipo |
|---|---|
| `restante` | Σ (`folio_hasta − siguiente_folio + 1`) |
| `total` (denominador del 15 %) | Σ (`folio_hasta − folio_desde + 1`) de esos mismos CAF |
| CAF en uso | el de `folio_desde` más bajo (el que entrega `asignar_folio`) |
| Estado | `error` si no queda ninguno; `aviso` si `restante / total ≤ 15 %` (`UMBRAL_AVISO_FOLIOS`); si no, `sello` |

Con un solo CAF el estado es exactamente el de su `MedidorFolios`. Un CAF agotado o anulado
sale del conjunto, lo que solo puede subir la proporción. La vista distingue «Aún no hay
folios de este tipo» (nunca hubo CAF) de «CAF agotado».

Las cuatro tarjetas (39 y 41 por ambiente) las arma `armarResumen` (`server/folios/lectura.ts`),
que comparten `leerFolios` y, desde la Fase 9, `leerResumenFolios`: el Tablero lee solo
`cafs` y muestra las del ambiente elegido con el mismo cálculo, más las alertas de folios
agotados o por agotarse. Esta página no cambia con la Fase 9 (medidor del CAF en uso y nota
con el total); el medidor del Tablero, en cambio, dibuja los números de la alerta, con un
rango sintético si hay varios CAF activos ([Tablero](tablero-y-reportes.md#folios-disponibles)).

## Solicitar folios

`solicitarFolios(ctx, { nivel, tipoDte, ambiente, cantidad, folioInicial?, revisionId? })`
(`server/folios/solicitar.ts`), desde la Server Action `solicitarFolios`. Tipos 39 y 41,
en certificación (maullin, IDK 100) o producción (palena, IDK 300).

### Requisitos

Se validan antes de abrir la operación, en los tres niveles (sin salir al SII ni dejar
filas) y otra vez dentro de la operación:

| Requisito | Si falta |
|---|---|
| Tipo 39 o 41, cantidad entera 1–10.000 (sin valor por defecto), folio inicial entero > 0 si viene | `uso`: «Ese tipo de documento no se puede pedir aquí» o el mensaje del campo |
| Empresa de la organización y activa | «No encontramos la empresa» / «La empresa está desactivada» |
| Producción: `empresas.autorizada_produccion` | «La empresa no está autorizada en producción» |
| Producción: `plan_vigente(org).permite_produccion` (sin suscripción vigente cuenta como no; `planPermiteProduccion` de `server/folios/plan.ts`, la misma que usa la vista) | «Tu plan no incluye producción» |
| Producción, al timbrar: una revisión válida (`revisionId`, abajo) | «Primero revisa la solicitud con el SII» / «Esa revisión ya no sirve para timbrar» |
| Certificado de un **representante electrónico** vigente (`certificadoDeEmpresa({ representante: true })`) | `config` (`ErrorCredenciales`) |

Todos los mensajes de `ErrorFolios` (`server/folios/errores.ts`) terminan con «No se envió
nada al SII.».

### Tres niveles

| Nivel | Sale al SII | `operaciones_sii` | `solicitudes_folios` | Resultado |
|---|---|---|---|---|
| `ensayo` | no | ninguna | ninguna | `ensayo`: empresa, tipo, ambiente, cantidad, folio inicial, folios disponibles hoy, certificado y avisos |
| `revision` | sí, sin timbrar | `solicitar_folios`, `confirmada = false` | `simulada` con el rango que asignaría el SII | `revision` con `revisionId` y el rango |
| `timbrar` ⚠️ | sí, timbra | `solicitar_folios`, `confirmada = true` (efecto global) | `en_curso` → `timbrada` (o los cierres de abajo) | `ok`: «El SII timbró los folios» |

**Revisión con el SII** (paridad con `sii certificacion solicitar-folios` sin
`--confirmar`). Recorre el asistente `cvc_cgi/dte/of_*` con la sesión AUT2000 reutilizada
(bajo el bloqueo del certificado) y un transporte por **lista permitida**:
`TransporteSinTimbrar` (`server/folios/sii.ts`) deja pasar, en el host del portal del
ambiente (maullin o palena), solo `/cvc_cgi/dte/of_solicita_folios`,
`of_solicita_folios_dcto` y `of_confirma_folio` (`PASOS_REVISION`); cualquier otra ruta de
ese host (incluidas `of_genera_folio`, que timbra, y `of_genera_archivo`, que descarga el
CAF) lanza `DetenidoAntesDeTimbrar` sin salir. El login en los hosts de autenticación
(herculesr, zeusr) sigue pasando. Es más estricto que la CLI, que solo corta
`of_genera_folio`. `SolicitudFolios` responde con `FoliosSinCafError` con el rango y esa
causa, y la solicitud queda `simulada`. No se gasta ningún folio. Si el SII renombra un
paso, la revisión falla en vez de timbrar. Si aun así llegara un CAF, la solicitud queda
`incierta` y la operación `incierto` («La revisión obtuvo un CAF, lo que no debería
pasar…»).

**Candados del servidor para la revisión.** Como sale al SII con el certificado de la
empresa pero `ejecutarOperacion` no la vigila (`confirmada: false`), `solicitarFolios` le
aplica antes de abrir la operación, sin dejar filas:

1. la sesión confirmada con Auth (`getUser()`, como las operaciones ⚠️): si no, «Tu sesión
   ya no es válida»;
2. el control previo de `ejecutarOperacion`, expuesto como `revisarOperacionPendiente`
   (`server/sii/operacion.ts`, la misma función, no una copia): un `incierto` sin revisar
   de `solicitar_folios` de la misma empresa y ambiente, o una confirmada `en_curso` de
   menos de 15 minutos, devuelven el mismo mensaje y `operacionPendienteId` que el
   timbraje (`motivo` `incierto_sin_revisar` o `en_curso`).

**Timbrar en producción exige la revisión**, y el servidor lo verifica: el timbraje trae
`revisionId` y tiene que ser una solicitud de la organización

- `simulada` y no confirmada,
- de la misma empresa, ambiente, tipo, cantidad y folio inicial,
- de hace menos de 30 minutos (`MINUTOS_REVISION_VIGENTE`), y
- sin ninguna solicitud confirmada del mismo tipo (empresa y ambiente) creada después: una
  revisión sirve para un solo timbraje.

En certificación la revisión es opcional (el `Dialogo` ofrece «Revisar antes con el SII»).
Si el rango timbrado difiere del revisado, el `ok` trae el aviso «En la revisión el SII
indicó los folios … al timbrar asignó …. Es normal si alguien timbró entre medio.».

**En la UI.** «Preparar la solicitud» pide el ensayo y abre el `Dialogo`. En producción el
botón de confirmar dice «Revisar con el SII»; con una revisión que calza (`revisionCalza`:
mismo ambiente, tipo, cantidad y folio inicial) cambia a «Timbrar N folios» con variante de
peligro. En certificación confirma directo «Timbrar N folios».

### Cómo termina un timbraje

`solicitarEnSii` (`server/folios/sii.ts`), dentro de `ejecutarOperacion`, la misma función
que usa el set de pruebas:

| Qué pasó | `solicitudes_folios` | Operación | Qué ve el usuario |
|---|---|---|---|
| CAF guardado | `timbrada` (lo deja `registrar_caf`) | `ok` | «El SII timbró los folios. Guardamos el CAF de … con los folios D a H …» |
| `FolioInicialRequeridoError` (primer timbraje del tipo en el ambiente) | `rechazada` | `rechazo_sii` | el mensaje de la librería y el campo «Folio inicial» con el sugerido (`requiere.folioInicial.sugerido`); no se timbró nada |
| `ErrorSolicitudFolios` | `rechazada`, `mensaje` saneado | `rechazo_sii` | el mensaje de la librería |
| `FoliosSinCafError` (la orden de timbrar salió y no llegó el CAF) | `incierta` con `folio_desde`/`folio_hasta` | `incierto` | no volver a pedir: revisar «Folios ya autorizados» |
| Red u otro error antes de timbrar | `error` | `transporte` / `error` | el mensaje correspondiente |
| **CAF timbrado que no se pudo guardar** (lectura del `<DA>` o cualquier error de `registrar_caf` salvo un traslape) | `incierta`, con el rango del CAF si se pudo leer | `incierto` (`ErrorIncierto`) | «Se timbraron los folios, pero no pudimos guardar el CAF. No los vuelvas a pedir: baja el CAF desde «Folios ya autorizados» en el portal del SII y súbelo en Folios (CAF).» |
| **CAF timbrado que choca con uno ya cargado** (`registrar_caf` → `23P01`, trigger de la 0011) | `incierta` con el rango del CAF timbrado y el mensaje de la derecha | `incierto` (`ErrorIncierto`), con `detalle.incierto_motivo = 'traslape'` y `traslape_desde`/`traslape_hasta` (el CAF cargado) | «Se timbraron los folios D a H, pero chocan con el CAF de los folios X a Y que ya estaba cargado, así que no pudimos guardarlos. No los vuelvas a pedir: revisa los dos CAF en «Folios ya autorizados» del portal del SII y escríbenos a soporte.» Subirlo no serviría (la carga también choca), así que no se propone |

Si cerrar la solicitud falla, queda un aviso en consola (solo el código) y la fila puede
quedar `en_curso`. El XML del CAF nunca va a `mensaje`, a `operaciones_sii` ni a los logs.

### Qué bloquea pedir folios

La UI lo explica antes de que el usuario choque con el servidor (`bloqueoSolicitud` de
`logica.ts`, el primero que aplique): empresa desactivada; en producción, empresa no
autorizada o plan sin producción; sin representante electrónico; una solicitud confirmada
`en_curso` en ese ambiente; una solicitud por verificar sin revisar en ese ambiente. La
autoridad es el servidor: `ejecutarOperacion` bloquea un `incierto` sin revisar de
`solicitar_folios` al timbrar, `revisarOperacionPendiente` lo mismo antes de una revisión,
y el índice único de la 0007 impide dos confirmadas en curso
([regla del incierto](../01-fundamentos/errores-y-resultados.md#la-regla-del-incierto)).

## Solicitud incierta

Una solicitud `incierta` (o una operación `en_curso` de más de 15 minutos) pudo haber
timbrado folios. Mientras nadie la revise, no se pueden pedir más folios en ese ambiente.
El aviso de la vista dice el rango que iba a asignar el SII, si se alcanzó a fijar, y da
dos salidas:

1. **Subir el CAF que calza** (lo recomendado). En el portal del SII (palena o maullin,
   con el certificado de la empresa) → «Folios ya autorizados» → bajar el CAF y subirlo en
   «Subir un CAF». Si calza con la incierta (misma empresa, ambiente, tipo y rango, sin
   CAF), `subirCaf` la pasa como `p_solicitud` a `registrar_caf`, que la deja `timbrada`
   con el CAF enlazado, y marca revisada la operación que la originó
   (`marcarInciertaRevisada`). El mensaje lo dice: «Con este CAF queda resuelta la
   solicitud por verificar del …: la marcamos como revisada y ya puedes volver a pedir
   folios.».
2. **«Marcar como revisada»** si el SII no muestra un CAF nuevo. Abre un `Dialogo` («Ya
   revisé en el SII») y llama a `marcarRevisada` de `server/certificacion`, que comprueba
   que la operación sea de la organización y de la empresa. Si los folios sí se timbraron,
   quedarían pedidos dos veces.

**Incierta por traslape.** Si la operación trae `detalle.incierto_motivo = 'traslape'`
(`leerFolios` lo expone como `operacion.traslape`, con el rango del CAF cargado), el aviso
no ofrece «Subir el CAF»: dice que los folios sí se timbraron, que chocan con el CAF X–Y ya
cargado y que hay que revisar los dos CAF en «Folios ya autorizados» y escribir a soporte
antes de marcarla como revisada. El `Dialogo` de «Marcar como revisada» repite que solo se
marque después de aclarar con soporte cuál de los dos CAF es el correcto.

## Subir un CAF

`subirCaf(ctx, { ambiente, contenido })` (`server/folios/subir.ts`), desde la Server
Action `subirCaf` (formulario `multipart`, campos `ambiente` y `caf`). Para un CAF que la
empresa ya tiene: el de una solicitud incierta o uno timbrado en el portal del SII. **No es
una operación del SII**: no sale a la red ni deja fila en `operaciones_sii`.

Validaciones, en orden (`validarCaf` de `server/folios/caf.ts`, con la librería):

| # | Qué revisa | Mensaje si falla |
|---|---|---|
| 1 | archivo presente y de hasta 64 KB (`TAMANO_MAXIMO_CAF`) | «Elige el archivo del CAF» / «El archivo es demasiado grande para ser un CAF» |
| 1b | empresa de la organización y **activa** (como pedir folios) | «No encontramos la empresa» / «La empresa está desactivada» |
| 2 | trae `<AUTORIZACION>` y `<CAF>`, es XML y tiene `<DA>` con `<RNG>`, `<FA>` e `<IDK>` | «El archivo no es un CAF del SII» |
| 3 | tipo 39 o 41 | «Ese CAF no es de boletas» |
| 4 | IDK del ambiente elegido (`datosAmbiente()`: 100 / 300) | «El CAF es de otro ambiente» (o «no es de ningún ambiente del SII») |
| 5 | `<RE>` = RUT de la empresa | «El CAF es de otra empresa» |
| 6 | trae `<RSASK>` | «Al CAF le falta la llave para timbrar» |
| 7 | `new Timbre(xml)` acepta la llave (el mismo validador que se usa para timbrar) | «No pudimos leer la llave del CAF» |
| 8 | `<RSASK>` y `<RSAPK>` son del mismo par (como `sii util verificar-ted`) | «La llave del CAF no calza con la del SII» |
| 9 | mismo rango ya cargado | `ok` informativo: «Ese CAF ya estaba cargado» (no cambia nada) |
| 10 | se cruza con otro CAF de la empresa, ambiente y tipo | «El CAF se cruza con otro ya cargado» con el rango del otro |
| 11 | sesión confirmada con Auth (`getUser()`) | «Tu sesión ya no es válida» |

Después llama a `registrar_caf` (service_role, organización de la membresía) con el XML
completo y, si calza, la solicitud incierta. Errores de la base: `23P01` (trigger de la
0011) o `23505` → traslape; `P0002` → empresa no encontrada; `22023` → «El CAF no calza
con la empresa o el ambiente». El archivo solo vive en la petición: nunca va a disco, logs,
Sentry ni de vuelta al navegador (tampoco su nombre).

## Anular folios

`anularFolios(ctx, { cafId, desde, hasta, motivo })` (`server/folios/anular.ts`), desde la
Server Action `anularFolios`. Llama a la RPC `anular_folios` (migración 0011, **aplicada el
2026-11-15**; [contrato](../03-api-reference/rpc-backend.md#anular_folios-migración-0011))
con el cliente de **sesión**: la base verifica el rol con `auth.uid()` y deja
`anulado_por` con el id del usuario. No es una operación del SII.

| Acción en el historial | Cuándo aparece | Rango | Efecto |
|---|---|---|---|
| «Anular folios» | el CAF tiene folios asignados (`siguiente_folio > folio_desde`) | lo elige el usuario, todo **bajo** `siguiente_folio` | inserta en `folios_anulados` |
| «Anular los que quedan» | el CAF está `activo` con folios libres (`tieneCola`) | la **cola completa**: de `siguiente_folio` a `folio_hasta` | inserta en `folios_anulados` y deja el CAF `anulado` (`siguiente_folio = folio_hasta + 1`): `asignar_folio` ya no lo usa |

Reglas (las valida antes `validarRangoAnulacion` para dar el mensaje con los folios, y la
RPC es la autoridad): rango dentro del CAF y `desde ≤ hasta`; un rango que llega a
`siguiente_folio` tiene que ser la cola completa (`desde ≤ siguiente_folio` y `hasta =
folio_hasta`); motivo obligatorio, hasta 500 caracteres. Un folio con un documento que no
está `anulado` no se anula: se corrige con nota de crédito (Fase 14). Repetir una anulación
no falla: «Esos folios ya estaban anulados» (la RPC devuelve 0).

| Código de la RPC | Lo que ve el usuario |
|---|---|
| `P0002` | «No encontramos el CAF» (inexistente o de otra organización) |
| `42501` | «No tienes permiso para gestionar folios» |
| `22023` | «Revisa el rango a anular» (dentro del CAF, motivo 1–500, la cola va completa) |
| `23503` | «Hay folios del rango que ya se usaron»: «El folio N ya tiene un documento emitido…» |
| otro (p. ej. `PGRST202` sin la 0011) | «No pudimos anular los folios. Inténtalo de nuevo en unos minutos.» |

Los folios anulados se informan en `<RangoAnulados>` del resumen diario de boletas (RCOF)
y no se recuperan. Después de anular una cola se revisa la alerta (la disponibilidad baja).

## Alerta `folios.por_agotarse`

`server/folios/alertas.ts`. Avisa cuando los folios de una empresa, en un ambiente y para un
tipo, **cruzan** el umbral del 15 % o se agotan.

| Tema | Regla |
|---|---|
| Cuándo | `decidirAlerta(antes, despues)`: `por_agotarse` al pasar de `sello` a `aviso`; `agotado` al llegar a cero desde cualquier estado con folios. Sin folios antes, nada |
| Disparadores | `alertarSiCruza` después de anular una cola (aquí) y `alertaDespuesDeAsignar` después de una emisión `ok` de la **Fase 7** (`emitirDocumento`, con el CAF y el folio usados: reconstruye el «antes» sin otra lectura) |
| Correo | `correoFoliosPorAgotarse` a los propietarios y administradores (correos de `perfiles`, sin duplicados), con enlace a `/<slug>/folios?empresa=<id>`; sin `NEXT_PUBLIC_APP_URL` no se envía (aviso en consola) |
| `Idempotency-Key` (Resend) | `folios.por_agotarse/<empresa>/<ambiente>/<tipo>/<CAF en uso>/<15\|agotado>` (determinista, sin datos sensibles) |
| Webhook | `encolar_evento(org, 'folios.por_agotarse', datos)` con `service_role` ([payload](../06-integraciones/webhooks.md#foliospor_agotarse-fase-6)) |
| Deduplicación | descansa en que el cruce ocurre una sola vez y en la `Idempotency-Key` (Resend no repite en 24 h); no usa la tabla `notificaciones` (Fase 8, migración 0013), que es solo para rechazos, inciertos y certificados |
| Fallas | nunca lanza ni frena la anulación o la emisión: queda un aviso en consola sin datos |

## Permisos

| Rol | Ver `/folios` | Pedir, subir, anular, marcar revisada |
|---|---|---|
| lector, emisor | sí (RLS `lectura`), en vivo | no: la UI oculta los formularios; las Server Actions responden «No tienes permiso para gestionar folios» (`puedeAdministrar`) |
| administrador, propietario | sí | sí |

Además: `anular_folios` exige `es_admin` en la base (`42501`); `registrar_caf` y
`encolar_evento` son solo `service_role` y la app los llama después de verificar membresía
y rol; las Server Actions confirman que la empresa es de la organización.

## Cómo los usa la emisión (Fase 7)

Lo que la Fase 6 dejó como enganche y cómo quedó en la
[emisión](emision-boletas.md):

- **Folios disponibles.** La emisión **no** usa `puedeEmitir(cliente, clave)` (sigue
  exportada desde `server/folios`): la vista de `/emitir` calcula los folios con `leerCafs`
  + `disponibilidadDe` (sesión) y la validación previa con `foliosDisponibles`
  (service_role). Las dos siguen la regla de `asignar_folio`; sin folios, el botón «Emitir
  boleta» queda deshabilitado con la guía a Folios (CAF), y el servidor responde «No quedan
  folios» sin abrir la operación.
- **Alerta.** `alertaDespuesDeAsignar(deps, cliente, clave, { cafId, folio })` se llama
  después de cada emisión `ok`, fuera de la operación. Una emisión que termina en error no
  la llama.
- **Folio anulado entre `asignar_folio` y el documento.** La migración 0012 (**aplicada el
  2026-11-15**) hace que `tg_validar_documento` rechace con `23514` («El folio N está
  anulado…») el `update` que le fija el folio al borrador si `(caf_id, folio)` está en
  `folios_anulados`. La emisión lo trata: pide otro folio con `asignar_folio` y vuelve a
  armar, hasta 3 intentos (`INTENTOS_FOLIO`); el folio anulado no se anula de nuevo. Un
  `update` de `estado` sobre un documento ya emitido no se revisa
  ([trampas](../07-referencia/trampas-conocidas.md#emisión-de-boletas-fase-7),
  [triggers](../08-esquema-supabase/triggers-y-logica.md#tg_validar_documento-migración-0012)).
- **Folios que la emisión anula.** Cuando una emisión falla con el folio ya asignado y la
  boleta no llegó al SII (falla antes de enviar, cuota, 0 filas, rechazo 4xx), el folio va a
  `folios_anulados` con `insert` directo (service_role), como en el set de pruebas. Un
  envío incierto **no** anula su folio.

## Prueba real en *Production* (criterio de aceptación)

2026-11-15, deploy `4f26921`, sesión del propietario en Chrome, empresa del piloto
(20.630.500-2), certificado del representante desde Vault:

1. «Preparar la solicitud» (certificación, boleta 39, 5): resumen local, sin filas.
2. «Revisar antes con el SII»: «El SII asignaría los folios 41 a 45»; solicitud `simulada`
   (`confirmada = false`, 41–45) y operación `solicitar_folios` `ok` con `nivel: revision`.
3. «Timbrar 5 folios»: «El SII timbró los folios»; operación `ok` con `nivel: timbrar`,
   solicitud `timbrada` con `caf_id`, y en `cafs` el CAF de certificación 41–45, IDK 100,
   `activo`, `fecha_autorizacion` 2026-11-15 y **`siguiente_folio = folio_desde` (41)**; el XML
   (con `RSASK`) en Vault (secretos de 3 a 4).

Sin secretos en `operaciones_sii` ni en `solicitudes_folios` (búsqueda de `RSASK`, `<CAF`,
`BEGIN`, `TOKEN`, cookies: 0), ningún bloqueo tomado, sin errores de consola ni de runtime en
Vercel. El medidor de certificación pasó a «5 de 5 disponibles» sin recargar.

## Folios del set de pruebas (Fase 5)

Lo de la Fase 5 sigue igual en comportamiento. `solicitarFoliosSet(ctx, { confirmada,
folioInicial? })` de `apps/web/src/server/certificacion/folios.ts`, desde el paso 3 del
asistente ([guía](certificacion-empresa.md)), pone solo las reglas del set y delega la
conversación con el SII en `solicitarEnSii` de `server/folios/sii.ts` (siempre `simular:
false`):

| Dato | Valor |
|---|---|
| Ambiente | `certificacion` (maullin, IDK 100): los folios sirven solo para el set |
| Tipo | 39 |
| Cantidad | número de casos guardados del set; 5 si todavía no se descarga |
| Certificado | de un representante electrónico |
| Operación | `solicitar_folios`, ⚠️ y de efecto global |
| Ensayo (`confirmada: false`) | no sale al SII ni escribe, tampoco una `simulada` (la revisión con el SII está en `/folios`) |

Los cierres son los de la tabla [de arriba](#cómo-termina-un-timbraje). Dos cambios de la
Fase 6 que también ve el asistente: un CAF timbrado que no se pudo guardar deja la
solicitud `incierta` **con el rango** (si se pudo leer el `<DA>`), y el mensaje ya no pide
escribir a soporte sino subir el CAF en Folios (CAF).

### Uso de los folios: `asignar_folio` y anulación del set

`enviarSet` toma un folio por caso con `asignar_folio(empresa, 'certificacion', 39)` (el CAF
activo de `folio_desde` más bajo con folios libres, con `for update`) y lee el XML del CAF
de Vault con `leer_secreto` para timbrar. Si el envío no alcanza a salir al SII, o el SII lo
rechaza sin Track ID, los folios asignados van a `folios_anulados` con `insert` directo
(service_role) y los documentos quedan `anulado`. Si la subida falla por red después de
salir, **no** se anulan (el SII pudo haberlos recibido). Detalle en
[set de pruebas](../05-pruebas/set-de-pruebas.md#5-armado-y-envío-por-rest-enviarset).
