---
title: "Emisión de boletas: de borrador a envío"
description: "Emisión de la Fase 7 (/[org]/emitir): formulario y useEmisionStore, ensayo y confirmación, flujo del servidor (token antes del folio, asignar_folio, armado, Storage, envios, un solo update a firmado, envío REST), estados por camino (ok, incierto, 4xx, fallas antes de enviar, 23514, cuota, 0 filas, Track ID sin guardar), PDF carta y rollo con el PDF417 del TED, correo al receptor, descargas con URL firmada, borradores, permisos y pruebas."
keywords: [emisión, emitir, /emitir, Emitir boleta, server/emision, lib/emision, emitirDocumento, prepararEmision, guardarEnSesion, guardarBorrador, borrarBorrador, leerVistaEmision, buscarReceptores, buscarProductos, enlaceDocumento, representarYEnviar, generarYSubirPdf, leerDte, nombresArchivos, ResultadoEmision, ResumenEmision, DocumentoEmitido, VistaEmision, esquemaBorrador, calcularTotales, redondearPhp, GeneradorBoleta, ArmadorBoleta, EnvioBoleta, ClienteBoletaRest, FABRICA_REST_EMISION, ejecutarOperacion, documentoId, asignar_folio, INTENTOS_FOLIO, 23514, P0001, P0002, tg_contar_uso_documento, tg_validar_documento, migración 0012, envioIncierto, ErrorIncierto, envios.incierto, Track ID, firmado, enviado, incierto, anulado, borrador, folios_anulados, alertaDespuesDeAsignar, PDF, PDF417, bwip-js, binarytext, pdfkit, carta, rollo, 80 mm, ted_xml, latin1, metadata.pdf, metadata.receptor_correo, metadata.correo, correoBoleta, enviarBoletaPorCorreo, Resend, adjuntos, Idempotency-Key, URL firmada, SEGUNDOS_URL, useEmisionStore, Zustand, ProveedorEmision, sessionStorage, claveSesion, reaccionAError, Ya la revisé, bloqueoEmision, bloqueoGuardado, Autocompletado, receptores, productos, Cliente General, 66666666-6, puede_emitir, maxDuration, criterio de aceptación, verificar-ted]
related: ["02-guias/folios-caf.md", "02-guias/seguimiento-envios.md", "04-objetos/objetos-documentos.md", "04-objetos/objetos-envios-y-rcof.md", "01-fundamentos/firma-y-timbre.md", "01-fundamentos/errores-y-resultados.md", "03-api-reference/indice-operaciones.md", "06-integraciones/realtime-y-storage.md", "07-referencia/trampas-conocidas.md", "09-libreria/backend-service-role.md"]
source: ["supabase_saas_sii.sql §8 §9 §10 §15", "supabase/migrations/0001_esquema_inicial.sql", "supabase/migrations/0012_folio_anulado.sql", "certificacion-node/docs/core.md", "PLAN-SAAS.md Fase 7", "apps/web/src/lib/emision.ts", "apps/web/src/server/emision/", "apps/web/src/server/pdf/", "apps/web/src/server/correo/boleta.ts", "apps/web/src/server/correo/resend.ts", "packages/correos/src/boleta.ts", "apps/web/src/app/[org]/emitir/", "apps/web/src/stores/emision.ts", "apps/web/src/stores/ProveedorEmision.tsx", "apps/web/src/components/boleteame/Autocompletado.tsx", "apps/web/e2e/emitir.spec.ts"]
---

# Emisión de boletas: de borrador a envío

> **Úsalo cuando:** emites una boleta desde el panel, tocas `server/emision`, el PDF o el
> correo de la boleta, o necesitas saber en qué estado queda cada fila cuando algo falla.

**Estado (2026-11-16).** El código de la **Fase 7** está probado con Vitest y dobles (sin
red ni base), **desplegado** (`4cb6e9f`) y con el
[criterio de aceptación](#criterio-de-aceptación-cumplido-el-2026-11-16) cumplido el
2026-11-16. No hubo migración nueva: la emisión usa las tablas y triggers de la `0001`
(`documentos`, `documento_detalles`, `receptores`, `productos`, `envios`,
`tg_validar_documento`, `tg_contar_uso_documento`, `sincronizar_documentos_envio`) y la
`0012_folio_anulado` (**aplicada el 2026-11-15**;
[despliegue](../08-esquema-supabase/despliegue.md#fase-7-migración-0012)). El estado del
envío después de la subida lo trae el [seguimiento](seguimiento-envios.md) de la Fase 8.

## Dónde vive

| Pieza | Archivo |
|---|---|
| Página y Server Actions | `apps/web/src/app/[org]/emitir/`: `page.tsx`, `acciones.ts`, `Emision.tsx` (pantalla), `Documento.tsx`, `Receptor.tsx`, `Lineas.tsx` (líneas y descuento), `Resumen.tsx`, `Resultado.tsx` (ensayo, ok e incierta), `Borradores.tsx`, `logica.ts` (puro) |
| Estado del formulario | `apps/web/src/stores/emision.ts` (`useEmisionStore`, Zustand vanilla) y `ProveedorEmision.tsx` (un store por montaje) |
| Contrato con la UI (puro) | `apps/web/src/lib/emision.ts`: `Borrador`, `esquemaBorrador` (zod), `calcularTotales`, `ResultadoEmision`, `VistaEmision` |
| Capa de servidor (`server-only`) | `apps/web/src/server/emision/` (API en `index.ts`): `emitir.ts` (ensayo y emisión ⚠️), `preparar.ts` (validación previa), `borradores.ts`, `lectura.ts`, `catalogo.ts`, `enlaces.ts` (descargas), `representacion.ts` (PDF y correo), `errores.ts`, `dependencias.ts`, `tipos.ts` |
| Representación impresa | `apps/web/src/server/pdf/`: `index.ts` (`generarPdf`), `timbre.ts` (PDF417), `carta.ts`, `rollo.ts`, `comun.ts` |
| Correo al receptor | `apps/web/src/server/correo/boleta.ts` (`enviarBoletaPorCorreo`), `server/correo/resend.ts` (adjuntos) y la plantilla `packages/correos/src/boleta.ts` (`correoBoleta`) |
| Componente nuevo | `apps/web/src/components/boleteame/Autocompletado.tsx` ([design system](../07-referencia/design-system.md)) |
| Pruebas | `*.test.ts` junto a cada módulo, `apps/web/test/emision-prueba.ts` (escenario con dobles) y `apps/web/e2e/emitir.spec.ts` |

Las Server Actions devuelven `ResultadoEmision` (`@/lib/emision`): `ensayo` (resumen para el
`Dialogo`), `borrador` (guardado), `ok` (mensaje, `DocumentoEmitido`, `operacionId`,
`avisos`) o `error` (mensaje y, según el caso, `resultado`, `motivo`, `documento`,
`errores` por campo).

## El contrato (`@/lib/emision`)

Puro, sin `server-only` ni React: lo importan el store (navegador), las Server Actions y
`server/emision`.

### El borrador y su validación

`esquemaBorrador` (zod) valida lo mismo en el navegador y en el servidor:

| Campo | Regla |
|---|---|
| `tipoDte` | 39 o 41. En la 41 todas las líneas tienen que ser exentas |
| `ambiente` | `certificacion` o `produccion` |
| `receptor.rut` | vacío = receptor genérico `66666666-6` «Cliente General» (`RECEPTOR_GENERICO`); si no, RUT con dígito verificador válido, normalizado sin puntos |
| `receptor.razonSocial` | hasta 100 caracteres, ISO-8859-1. Obligatoria si el RUT no es el genérico (la exige `receptorListo` del servidor: «Falta la razón social del receptor») |
| `receptor.correo` | opcional; `correoSiiValido`. Si viene, se le envía el PDF al emitir |
| `lineas` | 1 a 100 (`MAXIMO_LINEAS`; el esquema de la base admite 1.000) |
| `lineas[].nombre` | 1 a 80 caracteres, ISO-8859-1 («Tiene caracteres que el SII no acepta») |
| `lineas[].cantidad` | > 0, hasta 3 decimales, menor que 1e15 |
| `lineas[].precio` | precio unitario **bruto** (IVA incluido), pesos enteros ≥ 0, menor que 1e15 |
| `lineas[].unidad` | opcional, hasta 4 caracteres |
| `descuento` | opcional: `monto` (pesos enteros) o `porcentaje` (0–100, hasta 2 decimales); glosa hasta 45 |
| total | mayor que $ 0 y menor que 1e15 |

### Totales (paridad con la librería)

`calcularTotales` replica **exactamente** las cuentas de `GeneradorBoleta` de
`@winex/certificacion`, porque la librería no se puede importar en el navegador
(node-forge, `Buffer`):

- bruto de cada línea = `round(cantidad × precio)` con el `round()` de PHP 8.3
  (`redondearPhp`, igual al de la librería);
- el descuento global rebaja **solo lo afecto**: se acota a la suma bruta afecta y se
  reparte entre las líneas afectas como `<DescuentoMonto>` (proporcional, el resto de a un
  peso); las exentas no reciben descuento;
- neto = `round((afecto − descuento) / 1,19)`; IVA = (afecto − descuento) − neto;
- total = neto + IVA + exento.

`emision.test.ts` compara `calcularTotales` contra el XML que escribe la librería (casos
fijos y muchos al azar): si la librería cambia, la prueba falla. El servidor no confía en
esta cuenta para el documento emitido: después de armar lee los montos del DTE
(`leerDte`) y esos son los que quedan en `documentos`.

## La pantalla `/[org]/emitir`

`page.tsx` exige membresía (`exigirMembresia`). Un **lector** ve «Con el rol Lector no
puedes emitir» y nada más; propietario, administrador y emisor (`puedeEmitir`) ven el
formulario. La empresa sale de `?empresa=<id>`, si no de la última usada, si no de la
primera activa; con más de una hay un selector (formulario GET, funciona sin JavaScript).
`?borrador=<id>` carga un borrador guardado (si ya no existe: «No encontramos ese
borrador»). `maxDuration = 60` y `runtime = 'nodejs'`: en Next 16 el valor de la página
aplica a sus Server Actions, y la emisión pide un token y hace una subida al SII.

La vista la arma `leerVistaEmision(ctx, { borradorId? })` con el cliente de **sesión**
(RLS), salvo `plan_vigente()` (solo `service_role`, con la organización de la membresía;
si falla, la vista no bloquea por el plan y decide el servidor).

| Bloque | Qué muestra |
|---|---|
| Documento | tipo (39 / 41) y ambiente del SII. Un ambiente bloqueado sale deshabilitado con «No disponible: …» y el enlace para arreglarlo |
| Receptor | por defecto Cliente General; «Buscar en tus receptores» (`Autocompletado` sobre `receptores`), RUT (`CampoRut`), razón social o nombre y correo |
| Líneas | producto o servicio (`Autocompletado` sobre `productos` activos: llena nombre, precio, unidad y exento), cantidad, unidad, precio unitario con IVA, exento, subtotal; subir, bajar y quitar líneas |
| Descuento global | monto en pesos o porcentaje; si no se aplica entero, lo explica (`avisoDescuento`: solo rebaja lo afecto) |
| Resumen | documento, ambiente, receptor, **folio que se asignará**, subtotal, descuento, neto, IVA, exento y total en vivo; «Emitir boleta», «Guardar borrador», «Empezar una boleta nueva»; el `MedidorFolios` del tipo y ambiente |
| Borradores | los 10 más recientes de la empresa, con «Retomar» y «Borrar» |

`BannerAmbiente` aparece en certificación, como en el resto de la app.

### Qué impide emitir (antes de que choque con el servidor)

`bloqueoEmision` (`logica.ts`), el primero que aplique, deshabilita «Emitir boleta» y dice
por qué con un enlace:

| Motivo (`MotivoAmbienteBloqueado` o folios) | Texto | Enlace |
|---|---|---|
| `empresa_inactiva` | La empresa está desactivada | configuración de la empresa |
| `sin_autorizacion` (producción) | La empresa aún no está autorizada para emitir en producción | certificación |
| `plan_sin_produccion` (producción) | El plan vigente no incluye producción | Configuración |
| `sin_resolucion` | Falta la resolución del SII que autoriza a emitir en ese ambiente | la empresa |
| `sin_certificado` | Falta un certificado vigente para firmar las boletas | certificados de la empresa |
| sin CAF del tipo | Aún no hay folios de … : pide o sube un CAF | Folios (CAF) |
| CAF agotado | CAF agotado: no quedan folios … | Folios (CAF) |
| boleta por verificar en esta sesión | Hay una boleta por verificar: revísala antes de emitir otra… «Ya la revisé» | — |

Los motivos de ambiente son los mismos que valida el servidor (`motivoAmbiente` de
`preparar.ts`) y los folios siguen la regla de `disponibilidadDe` (la de `asignar_folio`,
[folios](folios-caf.md#disponibilidad-y-umbral)). La autoridad es el servidor.

### Estado del formulario: `useEmisionStore`

- Store **vanilla** de Zustand (`createStore`) creado por `ProveedorEmision` con
  `useState`, **uno por montaje** (nunca un singleton de módulo: en el servidor se
  compartiría entre usuarios). `useEmisionStore(selector)` lo lee; `useTotalesEmision()`
  da los totales con `calcularTotales`.
- Los campos numéricos se guardan como el texto que escribe la persona («1.190.000»,
  «1,5») y se convierten al armar el `Borrador` (`aBorrador`).
- **`sessionStorage`**: cada cambio se guarda con la clave
  `boleteame:emision:<organizacionId>:<empresaId>` (`claveSesion`). Toda lectura y
  escritura va en try/catch: sin almacenamiento (modo privado, bloqueado) la pantalla
  funciona igual. Al montar, `datosIniciales` decide: con `?borrador=<id>`, lo de la sesión
  si es ese mismo borrador, si no el del servidor; sin él, lo de la sesión (soltando un
  `borradorId` que ya no está entre los borradores); si no hay nada, el formulario vacío.
  La boleta **por verificar** (`incierta`) de la sesión se conserva siempre.
- En el servidor y en el primer render del navegador parte del borrador pedido o vacío
  (así el HTML calza al hidratar); lo de la sesión se aplica en un efecto.

## Ensayo y confirmación

1. «Emitir boleta» valida en el navegador con `esquemaBorrador` (errores por campo, con
   la ruta completa: `receptor.rut`, `lineas.0.precio`…) y llama a `emitir(slug,
   empresaId, { nivel: 'ensayo', borrador, borradorId? })`.
2. El **ensayo** valida en el servidor todo lo de la [validación previa](#1-validación-previa)
   y devuelve `ResumenEmision`: empresa, documento, ambiente, receptor, correo, líneas,
   descuento, total, resolución, canal («API REST de boletas del SII»), el certificado con
   que se firmará, el **folio previsto** (sin reservarlo) y los avisos («Es un documento
   tributario real: al emitirla se usa el folio N…» en producción, «Es una boleta de
   certificación: no tiene validez tributaria…» en certificación, «El folio queda usado
   aunque el SII rechace la boleta», «Le enviaremos el PDF a …»). **Sin folio, sin red y
   sin filas.**
3. El `Dialogo` muestra el resumen (variante de peligro en producción). Confirmar («Emitir
   boleta» → «Emitiendo en el SII…») llama a `emitir` con `nivel: 'emitir'` y
   **exactamente** el borrador que se ensayó (y su `borradorId`), no lo que haya en el
   formulario en ese momento.
4. Freno contra el doble envío en la pantalla: una referencia (`corriendo`) que no deja
   arrancar otra acción mientras hay una en curso, y el `Dialogo` en `cargando`. **No hay
   idempotencia en el servidor para el panel** ([trampa](../07-referencia/trampas-conocidas.md#emisión-de-boletas-fase-7)).

La Server Action `emitir` revalida `/emitir` y `/folios` después de todo lo que no es un
ensayo. Si `emitirDocumento` lanza una excepción no prevista al emitir (o se corta la
comunicación con el servidor), la pantalla lo trata como **incierto** («No sabemos si la
boleta se emitió»), nunca como «inténtalo de nuevo».

## Flujo del servidor (`emitirDocumento`)

`emitirDocumento(ctx, { nivel, borrador, borradorId? })` de `server/emision/emitir.ts`.
`ctx` (`ContextoEmision`: organización, empresa, usuario) lo arma la Server Action después
de verificar membresía, rol `puede_emitir` y que la empresa sea de la organización.
Paridad con `sii produccion emitir --confirmar` de la CLI.

### 1. Validación previa

`prepararEmision` (`preparar.ts`), con `service_role` filtrando por organización. Corre en
el ensayo, antes de escribir nada y otra vez dentro de la operación. Lanza el primer
problema, y ninguno deja filas ni consume folios («No se envió nada al SII.»):

| # | Qué revisa | Si falla (`motivo`, resultado) |
|---|---|---|
| 1 | receptor identificado con razón social | `receptor_sin_razon_social` (`uso`), marca el campo |
| 2 | empresa de la organización y activa | `empresa_no_encontrada` / `empresa_inactiva` (`uso`) |
| 3 | producción: `autorizada_produccion` y `plan_vigente().permite_produccion` | `sin_autorizacion` / `plan_sin_produccion` (`uso`) |
| 4 | resolución vigente del ambiente (la de la carátula; en certificación, número 0) | `sin_resolucion` (`config`) |
| 5 | certificado predeterminado vigente (`certificadoDeEmpresa`) | `ErrorCredenciales` con su mensaje (`config`) |
| 6 | folios del tipo en el ambiente (`foliosDisponibles`) | `sin_folios` (`config`) |
| 7 | producción: cuota del mes (`uso_mensual.boletas_produccion` contra `max_boletas_mes`) | `cuota` (`config`), para no quemar un folio que el trigger rechazaría |

### 2. El borrador con la sesión

`guardarEnSesion` (`borradores.ts`) guarda el borrador y sus líneas con el cliente de
**sesión** (RLS `puede_emitir`), igual que «Guardar borrador»: si viene `borradorId` lo
actualiza (solo si sigue `borrador`), si no inserta uno nuevo (`origen = 'panel'`,
`creado_por`). Detalle en [Borradores](#borradores). Si falla, nada salió al SII y no hay
fila en `operaciones_sii`.

### 3. La operación con el SII

Dentro de `ejecutarOperacion({ operacion: 'emitir', ambiente, canal: 'rest', confirmada:
true, documentoId })`, llamado **directo** (no con el `ejecutar` de certificación, que no
pasa `documentoId`): la fila de `operaciones_sii` queda con `documento_id` y, al crear el
envío, con `envio_id` (`enlazarOperacion`). Como `emitir` está en
`OPERACIONES_QUE_GRABAN`, se confirma la sesión con `getUser()`; no está en
`OPERACIONES_EFECTO_GLOBAL`, así que un `incierto` anterior **no** la bloquea (ver
[incierto](#boleta-por-verificar-incierta)). No usa `conBloqueoCertificado`: el REST no
abre sesiones AUT2000 y `asignar_folio` ya es atómico.

Todo con `service_role` filtrando por organización, en un orden que no quema folios a la
ligera:

1. **`prepararEmision` otra vez** (los datos pudieron cambiar desde el ensayo).
2. **Cliente REST** de la librería (`ClienteBoletaRest`) en el ambiente del borrador, con
   la fábrica propia `FABRICA_REST_EMISION` (`dependencias.ts`; desde la Fase 8 delega en
   `clienteBoletaRest` de `server/sii/clientes.ts`, compartido con el seguimiento): la de
   certificación (`FABRICAS_SII.rest`) fija `ambiente: 'certificacion'`. Transporte por invocación
   (`await using`) y `TokenStoreSupabase`.
3. **Token primero** (`obtenerToken(rut)`): si falla, todavía no se asignó ningún folio.
4. **`asignar_folio(empresa, ambiente, tipo)`** (bloquea el CAF; `P0002` → «No quedan
   folios»). `detalle`: `folio`, `caf_id`, `intentos`.
5. **CAF de Vault** (`leer_secreto` del `caf_secret_id`, filtrado por organización) y
   **`ArmadorBoleta.armar`** con el certificado: DTE timbrado y firmado (`Buffer`
   ISO-8859-1). `leerDte` saca del DTE la fecha, los montos, las líneas y el `<TED>` como
   texto `latin1` (un carácter por byte).
6. **DTE a Storage**: `<org>/<empresa>/<ambiente>/DTE-<tipo>-F<folio>.xml`.
7. **`EnvioBoleta.empaquetar([dte])`** con la carátula (RUT emisor, RUT de quien envía =
   titular del certificado, resolución vigente) y el **sobre a Storage**:
   `EnvioBOLETA-<tipo>-F<folio>.xml`.
8. **`envios`**: `canal = 'rest'`, `proposito = 'emision'`, `rut_envia`,
   `certificado_id`, `nro_resol`, `fch_resol`, `tmst_firma`, `nombre_archivo = 'envio.xml'`
   (`NOMBRE_ARCHIVO_BOLETA`), `xml_path` del sobre.
9. **Un solo `update` del documento**, con `.eq('estado', 'borrador')`: `folio`,
   `caf_id`, `ted_xml`, `timbrado_en`, `firmado_en`, `xml_path`, `mnt_neto`, `mnt_exe`,
   `iva`, `mnt_total` (los del DTE), `descuento_aplicado`, `fecha_emision` (la del DTE),
   `envio_id` y `estado = 'firmado'`. Ese `update` dispara `tg_validar_documento` (CAF del
   tipo y ambiente, folio en rango, folio **no anulado**, 0012) y
   `tg_contar_uso_documento` (cuota). Sus fallas se tratan en la
   [tabla](#cómo-termina-una-emisión).
10. **Envío** (`enviarBoleta(token, rut, rutEnvia, sobre)`): desde aquí la boleta «salió».
11. **Con Track ID**: `envios.track_id`, `enviado_en`, `respuesta_subida` (JSON completo) y
    `estado_sii` solo si es `REC`, `SOK`, `CRT`, `FOK`, `PRD` o `EPR`; después el documento
    a `enviado` (`.eq('estado', 'firmado')`; si el trigger del envío ya lo movió, no
    cambia nada). `detalle.track_id`.

### Cómo termina una emisión

La regla del incierto es la de la CLI (`envioIncierto()`): un error **después de salir**
deja la duda, salvo `ErrorValidacion` o un `ErrorTransporte` con HTTP < 500 (el SII no la
recibió).

| Camino | Documento | Folio | `envios` | `operaciones_sii.resultado` | Qué ve el usuario |
|---|---|---|---|---|---|
| **ok** (Track ID guardado) | `enviado` | usado | `track_id`, `enviado_en`, `respuesta_subida`, `estado_sii` si es de subida | `ok` | «Emitimos la boleta electrónica N.º N» y «El SII la recibió con el Track ID … Su resultado (aceptada o rechazada) aparece en Documentos en unos minutos.» (en certificación, además, «sin validez tributaria»). Avisos si el PDF o el correo fallaron |
| **Incierto**: error después de salir (red, tiempo, HTTP ≥ 500, respuesta sin `trackid`) | `incierto` (lo pone el trigger del envío) | usado, **sin anular** | `incierto = true`, `error` con el motivo | `incierto` (`ErrorIncierto`); `detalle.incierto = true` | «No sabemos si el SII recibió la boleta… No la vuelvas a emitir a ciegas: revisa en el portal del SII si el folio N quedó recibido.» La pantalla bloquea emitir ([abajo](#boleta-por-verificar-incierta)) |
| **HTTP 4xx o `ErrorValidacion`** después de salir (el SII no la recibió) | `anulado` | a `folios_anulados` («El SII rechazó el envío de la boleta sin recibirla.») | `error` con el motivo | `transporte` (4xx) o `error` (`ErrorValidacion`); `detalle.folios_anulados` | «El SII no recibió la boleta… quedó anulada; ese folio no se vuelve a usar. Revisa los datos y vuelve a emitirla: se usará un folio nuevo.» Un **401** además olvida el token guardado (`olvidarToken`) |
| **Falla antes de enviar** con folio asignado (CAF de Vault, armado, Storage, `envios`, un error de base en el `update`, incluido un `23514` que no es de folio anulado) | sigue `borrador` | a `folios_anulados` («La boleta no se alcanzó a enviar al SII.») | `error`, si alcanzó a crearse | el del error (`error` para una falla de base o de Storage) | el mensaje del error más «El folio N quedó anulado; el borrador sigue guardado y al reintentar se usa un folio nuevo.» |
| **Falla del token** | sigue `borrador` | ninguno asignado | ninguno | el del error (`transporte` si es de red) | el mensaje del error; nada se consumió |
| **`23514` de folio anulado** en el `update` (0012: el folio se anuló entre `asignar_folio` y el `update`) | sigue `borrador` | ya estaba en `folios_anulados` (no se anula otra vez) | el de ese intento queda con `error` «El folio N se anuló antes de usarlo.» | — | se pide otro folio y se vuelve a armar (pasos 4–9), **hasta 3 intentos** (`INTENTOS_FOLIO`); si sale bien, `ok` con `detalle.intentos` |
| …tres `23514` seguidos | sigue `borrador` | los 3 en `folios_anulados` | 3 envíos con `error` | `config` (`folio_anulado`) | «Los folios asignados se anularon mientras emitíamos… Revisa las anulaciones en Folios (CAF) y vuelve a intentarlo.» |
| **Cuota del mes** (`P0001` «Se alcanzó el límite de N boletas…» de `tg_contar_uso_documento` en el `update`) | sigue `borrador` | a `folios_anulados` | `error` | `config` (`cuota`) | «Se alcanzó el límite de boletas del mes… El folio N quedó anulado. Cambia a un plan con más boletas o espera al próximo mes.» |
| **`update` con 0 filas** (el borrador se borró o se emitió en paralelo) | el que tenga | a `folios_anulados` | `error` | `uso` (`borrador_cambio`) | «El borrador cambió mientras lo emitíamos… El folio N quedó anulado. Revisa Documentos antes de volver a emitir.» |
| **Track ID recibido pero no guardado** (falla el `update` de `envios` o el del documento) | `incierto` si no se guardó el Track ID (trigger); si el Track ID quedó y falló el del documento, `firmado` o `enviado` | usado, sin anular | `incierto = true` y `error` **solo si `track_id` sigue nulo** (el `check` de `envios` no admite `incierto` con Track ID) | `incierto` | «El SII recibió la boleta N.º N con el Track ID …, pero no pudimos guardarlo. No la vuelvas a emitir: anota el Track ID y escríbenos a soporte.» |
| Sin folios al asignar (`P0002`) | sigue `borrador` | — | — | `config` (`sin_folios`) | «No quedan folios…» |

Las escrituras de esos cierres (anular folios, cerrar o marcar el envío, anular el
documento) **nunca lanzan**: corren dentro del manejo de otro error y un `incierto` no
puede terminar como `error` por una falla de la base; si fallan queda un aviso en consola
con el código. Ningún cierre borra los XML ya subidos a Storage.

En el resultado `error`, `documento` viene solo cuando quedó un documento con folio
(incierto o anulado): la pantalla lo usa para decidir si bloquear
([`reaccionAError`](#qué-hace-la-pantalla-con-un-error)).

### Qué queda en `operaciones_sii`

`operacion = 'emitir'`, `canal = 'rest'`, `confirmada = true`, `documento_id` (columna) y
`envio_id` (el del último intento). En `detalle`: `documento_id`, `tipo_dte`, `folio`,
`caf_id`, `intentos` y, según el camino, `track_id`, `incierto: true` o `folios_anulados`
(la **lista** de folios, no la cantidad como en `enviar_set`). Nunca el CAF, la `<RSASK>`,
el token, el PEM ni la clave del .pfx (`secretos.test.ts` lo comprueba en la base, los
mensajes, Sentry y la consola).

### 4. Después del ok: alerta, PDF y correo

Ya fuera de la operación, y sin poder cambiar el `ok`:

1. **Alerta de folios**: `alertaDespuesDeAsignar` (Fase 6) con el CAF y el folio usados;
   si la disponibilidad cruzó el 15 % o se agotó, correo a los administradores y webhook
   `folios.por_agotarse` ([folios](folios-caf.md#alerta-foliospor_agotarse)).
2. **PDF carta y rollo** (`representarYEnviar`): cada uno se genera con `generarPdf` y se
   sube junto al XML (`DTE-<tipo>-F<folio>-carta.pdf` y `-rollo.pdf`, con `sobrescribir:
   true`); las rutas van a `documentos.metadata.pdf`.
3. **Correo al receptor**, solo si el borrador trae correo y el PDF carta se generó: ver
   [Correo](#correo-al-receptor). Si sale, `documentos.metadata.correo = { id, enviado_en }`
   (id de Resend).

Si algo falla, la emisión sigue `ok` con `avisos` (y una línea de consola sin datos):

| Falla | Aviso |
|---|---|
| ningún PDF | «No pudimos generar el PDF de la boleta. La boleta igual quedó emitida; descárgalo desde Documentos más tarde.» |
| uno de los dos | «No pudimos generar el PDF en formato rollo (o carta). Descárgalo desde Documentos más tarde.» |
| correo sin PDF carta | «No enviamos la boleta a … porque no se generó el PDF. Puedes reenviarla desde Documentos.» |
| Resend sin configurar | «El envío de correos todavía no está configurado: no enviamos la boleta al receptor.» |
| otra falla del correo | «No pudimos enviar la boleta a …. Puedes reenviarla desde Documentos.» |

`DocumentoEmitido.conPdf` y `correoEnviado` lo reflejan. La pantalla de resultado muestra
tipo, folio, ambiente, estado (`EstadoDTE`), Track ID y total, los avisos, «Descargar XML»,
«Descargar PDF carta» y «Descargar PDF rollo» (los PDF solo si hay) y «Emitir otra». Al
emitir, el formulario y la sesión del navegador se vacían, para que recargar no deje la
misma boleta lista para emitirla otra vez.

## Representación impresa (PDF)

`generarPdf(datos, formato)` de `server/pdf/index.ts`, con `pdfkit` (Helvetica estándar,
WinAnsi: cubre tildes y ñ) y el PDF417 con `bwip-js`. `DatosRepresentacion` trae ambiente,
tipo, folio, fecha, emisor, receptor, líneas (con descuento y `<MontoItem>`), totales,
resolución y `tedXml`.

| Formato | Cómo es |
|---|---|
| `carta` | Letter (612 × 792 pt), blanco y negro. Emisor a la izquierda y recuadro del SII (R.U.T., tipo y N.º de folio) a la derecha; fecha y receptor; tabla de detalle (descripción, cantidad, precio unitario, descuento, monto) que pasa de página repitiendo el encabezado; al final el timbre abajo a la izquierda y los totales a la derecha; pie con «Página n de m» |
| `rollo` | 80 mm de ancho, una sola página con el alto justo para el contenido: pdfkit fija el tamaño al crear la página, así que se compone dos veces (una para medir en una página muy alta, otra con el alto medido) |

- El **receptor** se imprime solo si está identificado (RUT distinto de 66.666.666-6).
- Totales: descuento global (si hubo), monto neto, monto exento (si hay), IVA (19 %) y
  total; la boleta exenta (41) solo exento y total.
- En certificación, el aviso «Documento emitido en el ambiente de certificación del SII,
  sin validez tributaria.»
- Bajo el timbre: «Timbre Electrónico SII», la resolución («Res. N.º 80 de 2014»; en
  certificación, número 0) y «Verifique documento: www.sii.cl».

### El timbre PDF417

`timbre.ts`:

- **Bytes exactos.** La `<FRMT>` firma los bytes ISO-8859-1 del `<DD>`, así que el código
  lleva esos bytes: `tedXml` llega como texto `latin1` (un carácter por byte) y
  `binarytext: true` le dice a bwip-js que use cada carácter como un byte en vez de pasarlo
  a UTF-8. Una «ñ» queda como `0xF1`, no como `C3 B1`. `validarTed` rechaza un TED sin la
  forma `<TED…</TED>` o con un carácter sobre U+00FF (alguien lo decodificó como Unicode):
  mejor fallar que imprimir un timbre que no verifica.
- **Parámetros**: PDF417 con nivel de seguridad (corrección de errores) 5, filas de 3
  módulos de alto (Y:X = 3), zona de silencio de 2 módulos, dimensión X mínima 0,0067"
  (≈ 0,17 mm) y área máxima 4 × 9 cm (alto × ancho). `timbreParaArea` prueba entre 10 y
  18 columnas, elige la que da el módulo más grande que cabe y escala el PNG completo (3 px
  por módulo) sin deformarlo; lanza si ni así llega al módulo mínimo. En el rollo el ancho
  disponible es el útil del papel (72 mm).
- **De dónde salen esos parámetros**: del instructivo técnico del SII para la
  representación impresa, que **no está en el repositorio**; conviene contrastarlos con el
  documento oficial ([trampa](../07-referencia/trampas-conocidas.md#emisión-de-boletas-fase-7)).
- `documentos.ted_xml` guarda ese mismo texto `latin1`: al regenerar el PDF se usa tal
  cual ([firma y timbre](../01-fundamentos/firma-y-timbre.md#el-ted)).

## Correo al receptor

- **Plantilla** `correoBoleta` (`@sii/correos`, `packages/correos/src/boleta.ts`): asunto
  «Tu boleta electrónica N.º N de <empresa>», quién la emite y por cuánto, que el PDF va
  adjunto y cómo verificarla en www.sii.cl. Sin enlaces a la app (el receptor no es
  usuario de Boletéame) ni secretos.
- **Envío** `enviarBoletaPorCorreo` (`server/correo/boleta.ts`): revisa que el correo
  sea plausible y que haya PDF, y llama a `enviarCorreo` con el adjunto
  `boleta-<tipo>-F<folio>.pdf` (`application/pdf`) y la `Idempotency-Key`
  `boleta-<documentoId>` (Resend no lo repite en 24 h). **Nunca lanza**: todo vuelve como
  `ResultadoEnvio`; el PDF nunca va en un detalle de error.
- **Adjuntos en `resend.ts`** (nuevo en esta fase): `adjuntos[]` con nombre sin rutas,
  controles ni comillas (hasta 200 caracteres), contenido no vacío y un total de hasta
  40 MB ya en base64; si no, `rechazado` sin enviar.

## Descargas

`enlaceDocumento(ctx, documentoId, archivo)` (`enlaces.ts`), desde la Server Action
`enlaceDocumento`, con `archivo` = `xml`, `pdf_carta` o `pdf_rollo`:

1. Lee el documento con la **sesión** (RLS), filtrado por organización y empresa. Sin
   folio o sin `xml_path`: «El documento todavía no se emite».
2. Firma la URL con el almacén de la organización (`service_role`, solo su carpeta) por
   **60 s** (`SEGUNDOS_URL`): la descarga empieza en seguida.
3. `xml`: siempre que tenga folio (también una boleta anulada).
4. PDF: una boleta `anulado` no tiene («El SII no la recibió, así que no tiene
   representación impresa. Su XML sigue disponible.»). Si la ruta está en
   `metadata.pdf`, la firma. **Si falta** (falló al emitir), lo **regenera** con
   `documento_detalles`, los datos **actuales** de la empresa, la resolución del envío
   (`nro_resol`, `fch_resol`) y `ted_xml`; lo sube, guarda la ruta en `metadata.pdf` y
   firma. Sin `ted_xml`, sin envío o con una falla: «No pudimos generar el PDF».

En la pantalla, la ventana se abre en el clic (después de un `await` el navegador la
bloquearía) y se le pone la URL al llegar.

## Borradores

«Guardar borrador» es **RLS directo** con la sesión (`guardarBorrador` →
`guardarEnSesion`), no una operación del SII ni usa folio:

- Políticas de la 0001: `alta_borrador` / `edicion_borrador` / `borrado_borrador` en
  `documentos` (`puede_emitir`, `estado = 'borrador'` y `folio is null`) y las de
  `documento_detalles` (padre en `borrador`). Cada consulta filtra además por organización
  y empresa.
- Guarda tipo, ambiente, receptor (`receptor_id`, `receptor_rut`,
  `receptor_razon_social`), los totales de `calcularTotales`, el descuento y
  `metadata.receptor_correo` (`documentos` no tiene columna de correo). Las líneas se
  **reemplazan** (se borran y se insertan) con `descuento_monto` y `monto_item`;
  `producto_id` solo si el producto es de la empresa.
- Un receptor distinto del genérico con razón social se agrega o actualiza en
  `receptores` (upsert por empresa y RUT, con la sesión). El correo solo se escribe si
  viene (no borra uno guardado). Si falla, se avisa en consola y el borrador sigue.
- **Un borrador de producción sin autorización no se puede guardar.**
  `tg_validar_documento` revisa en **todo** `insert` de producción (también un borrador sin
  folio) que la empresa esté autorizada y que el plan lo permita (`P0001`); el servidor lo
  traduce a «La empresa no está autorizada en producción» / «Tu plan no incluye
  producción», y la UI lo anticipa (`bloqueoGuardado`: «No se puede guardar un borrador de
  producción: …»).
- Actualizar un borrador que ya no está en `borrador` (0 filas) se explica
  (`explicarBorradorAusente`): no existe → «No encontramos el borrador»; `incierto` →
  «No sabemos si el SII recibió esta boleta»; emitido → «Este borrador ya se emitió»; sigue
  `borrador` pero RLS no deja → «No tienes permiso para emitir». `42501` → sin permiso.
- `borrarBorrador`: `delete` con la sesión, solo `estado = 'borrador'`; uno emitido no se
  borra («No encontramos el borrador»).
- La vista lista los 10 más recientes; «Retomar» navega a `?borrador=<id>` sin volver a
  montar el formulario.

## Qué hace la pantalla con un error

`reaccionAError` (`logica.ts`), con el resultado de `emitir` (nivel `emitir`):

| Caso | Reacción |
|---|---|
| `resultado = 'incierto'`, documento `incierto`, `motivo = 'documento_incierto'`, o un documento con folio en cualquier estado que no sea `anulado` ni `borrador` | **bloquear** (`incierta`) y soltar el `borradorId` |
| `motivo = 'borrador_emitido'` | mostrar el mensaje con «Empezar una boleta nueva»; **no** soltar el id (reintentar daría el mismo error, no una boleta duplicada) |
| documento `anulado` (4xx) o `borrador_no_encontrado` | mostrar y soltar el `borradorId`: el próximo intento crea un documento nuevo |
| lo demás (validación, sin folios, ambiente, cuota…) | mostrar el mensaje y los errores por campo; el formulario se conserva |

### Boleta por verificar (incierta)

- **En la pantalla, por sesión del navegador.** El store guarda `incierta` (ambiente,
  documento, folio, Track ID, hora) y lo persiste en `sessionStorage` (por pestaña):
  «Emitir boleta» queda deshabilitado con «Hay una boleta por verificar…» y aparece
  `AlertaIncierta` («No la vuelvas a emitir hasta revisar si llegó: búscala en el SII por
  su folio o en Documentos emitidos. Si la emites de nuevo y sí había llegado, quedaría
  duplicada.»). «Ya la revisé» abre un `Dialogo` de peligro («Ya la revisé: empezar
  otra») que vacía el formulario y quita el bloqueo. Otra pestaña u otro navegador no lo
  ven.
- **En el servidor, por documento.** `ejecutarOperacion` no bloquea `emitir` por un
  `incierto` anterior. Lo que impide reemitir **ese** documento es que ya no está en
  `borrador`: volver a emitirlo con su `borradorId` da «No sabemos si el SII recibió esta
  boleta» sin salir al SII. Una boleta nueva (otro documento) sí se puede emitir.
- Desde la Fase 8 un envío incierto aparece en el Tablero, llega por correo a los
  administradores y se marca con «Ya lo revisé» en su página; nunca se consulta ni se
  reintenta solo ([seguimiento](seguimiento-envios.md#envíos-inciertos-y-ya-lo-revisé)). El
  estado de una boleta `enviado` (aceptada, rechazada) lo trae el seguimiento
  ([seguimiento](seguimiento-envios.md)).

## Permisos

| Rol | Ver `/emitir` | Emitir, guardar y borrar borradores, buscar en el catálogo, descargar |
|---|---|---|
| lector | solo el aviso «no puedes emitir» | no: las Server Actions responden «No tienes permiso para emitir» (`puedeEmitir`) y RLS no le deja escribir |
| emisor, administrador, propietario | sí | sí |

Además: `asignar_folio`, `leer_secreto` y la escritura de documentos con folio y de
`envios` son solo `service_role` y la app los usa después de verificar membresía y rol;
las Server Actions confirman que la empresa es de la organización
([acceso por tabla](../03-api-reference/acceso-por-tabla.md)).

## Cómo se probó

Sin red ni base: Vitest con dobles (`apps/web/test/supabase-falso.ts`, el escenario
`test/emision-prueba.ts`, CAF y .pfx de prueba generados al vuelo). Corrida local del
2026-11-15: 13 archivos y 176 pruebas en `apps/web` (lo de esta fase) y 4 en
`@sii/correos` (`boleta.test.ts`), todas pasan.

| Archivo | Qué cubre |
|---|---|
| `lib/emision.test.ts` | paridad de `calcularTotales` con el XML de `GeneradorBoleta` (casos fijos y al azar); `esquemaBorrador` (genérico, RUT, exenta, total cero, decimales, emoji) |
| `server/emision/emitir.test.ts` | ensayo sin folio, red ni filas; cada motivo de la validación previa; ok en producción y certificación (filas, rutas, metadata, uso del mes, `siguiente_folio`); borrador ya guardado; token que falla; incierto por red, 5xx o sin `trackid`; 4xx; 401; falla antes de enviar; `23514` con reintento y tres veces; cuota `P0001`; 0 filas; Track ID sin guardar; PDF o correo que fallan; alerta del 15 %; descuento global |
| `server/emision/secretos.test.ts` | ningún secreto en `operaciones_sii`, la base, los mensajes, Sentry ni la consola, también con errores que traen el token, el CAF o la clave |
| `server/emision/borradores.test.ts`, `lectura.test.ts`, `catalogo.test.ts`, `enlaces.test.ts` | borradores con RLS (producción sin autorización, `42501`, emitido o inexistente); la vista; el `ilike` saneado; URL firmada y regeneración del PDF |
| `server/pdf/timbre.test.ts` | el PNG del PDF417 se decodifica (`zxing-wasm`) a los bytes exactos del TED y su `<FRMT>` verifica contra el CAF, también al tamaño de la carta y del rollo; control: en UTF-8 no verificaría; filas de 3 módulos y zona de silencio |
| `server/pdf/index.test.ts` | carta y rollo válidos, exenta, producción sin aviso, descuentos, muchas líneas, nombres largos |
| `server/correo/resend.test.ts`, `packages/correos/src/boleta.test.ts` | adjuntos y la plantilla |
| `app/[org]/emitir/acciones.test.ts`, `logica.test.ts`, `stores/emision.test.ts` | permisos y validación de las Server Actions, excepción al emitir = incierto; bloqueos, `reaccionAError`, medidor; store (uno por montaje, exenta, productos, sesión) |

`e2e/emitir.spec.ts` (Playwright) prueba **solo lo que no escribe** en la base (es la de
producción) ni sale al SII: sin sesión, la redirección a `/ingresar`; con una sesión
guardada (`E2E_SESION`, `E2E_ORG`), el formulario, los totales, la boleta exenta, axe
(WCAG 2.1 AA) y el ancho en móvil, **sin** pulsar «Emitir boleta» ni «Guardar borrador» (la
prueba falla si sale un POST de Server Action).

La primera boleta real se emitió en certificación el 2026-11-16, para el criterio de
aceptación (ver abajo). En producción todavía no se ha emitido ninguna.

## Criterio de aceptación (cumplido el 2026-11-16)

El criterio (PLAN-SAAS Fase 7):

> En certificación, una boleta emitida desde la UI llega a EPR aceptada y su PDF muestra un
> PDF417 que `sii util verificar-ted` valida.

Cómo se hizo, en *Production* (deploy `4cb6e9f`), con la sesión del propietario y la
empresa del piloto (20.630.500-2):

1. **Requisito previo.** Se registró la resolución de certificación de la empresa (N.º 0 del
   06-11-2026, el `SII_FCH_RESOL` del `.env` de `certificacion-node`) en Configuración →
   Empresas. Sin ella, la pantalla bloquea certificación con el motivo `sin_resolucion`. La
   empresa se autorizó fuera de Boletéame y nunca postuló aquí, que es el paso que registra
   esa resolución sola.
2. **Emisión.** Boleta 39 con una línea de $ 1.190 (neto $ 1.000, IVA $ 190) al receptor
   genérico. Ensayo con el folio previsto N.º 41 y, al confirmar, resultado `ok`: folio 41,
   Track ID 34015200.
3. **En la base:**
   - documento `enviado`, con `ted_xml`, `xml_path` y `metadata.pdf` (carta y rollo);
   - envío con `track_id` 34015200, `estado_sii` `REC` y sin `incierto`;
   - `operaciones_sii` `emitir` `ok` con un solo intento y sin secretos;
   - CAF con `siguiente_folio = 42`, sin folios anulados;
   - `uso_mensual.boletas_certificacion` = 1.
4. **Estado en el SII.** `sii produccion consultar 34015200 --ambiente certificacion`
   (desde `certificacion-node`) dio **EPR**: 1 informado, 1 aceptado, 0 rechazados y 0
   reparos. El documento sigue `enviado` en la base hasta que la Fase 8 consulte los envíos
   y propague el estado.
5. **PDF417.** Un script local:
   - descargó de Storage el PDF carta y el rollo;
   - extrajo la imagen del timbre de cada uno y la decodificó con `zxing-wasm`. En los dos,
     los bytes leídos son idénticos a `ted_xml`;
   - armó el DTE con el TED reemplazado por lo leído del PDF carta y corrió
     `sii util verificar-ted` con el CAF 41–45 leído de Vault a un archivo temporal, que se
     borró al terminar. El resultado: `OK TED de TipoDTE: 39 | Folio: 41`, 1 de 1 OK.

No hubo errores de consola ni de runtime en Vercel. El receptor era el genérico, sin
correo, así que no se envió correo.
