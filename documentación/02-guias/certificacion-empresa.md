---
title: "Certificación de la empresa ante el SII"
description: "El asistente de la Fase 5: los 5 pasos visibles y las 8 etapas de procesos_certificacion, qué hace cada acción en el SII y en la base, ensayo y confirmación, operaciones inciertas y cómo revisarlas, roles, avisos y actualización en vivo."
keywords: [certificación, asistente, /certificacion, server/certificacion, ResultadoPaso, ResumenEnsayo, ensayo, confirmada, Dialogo, PASOS, ETAPAS, pasoDeEtapa, estadoPaso, postular, guardarDatosPostulacion, ASCII imprimible, verificar_portal, descargarSet, solicitarFoliosSet, enviarSet, consultarEstadoSet, solicitarRevision, consultarEstadoDeclaracion, declarar, guardarDatosDeclaracion, marcarRevisada, bloqueoEnvioSet, incierto, Marcar como revisada, comoRevisar, P90, P91, autorizada_produccion, resolución número 0, puedeAdministrar, lector, emisor, EnVivo, Realtime, correoCertificacion, Idempotency-Key, certificacion.actualizada, maxDuration]
related: ["05-pruebas/set-de-pruebas.md", "02-guias/folios-caf.md", "04-objetos/objetos-certificacion.md", "03-api-reference/indice-operaciones.md", "03-api-reference/servicios-sii.md", "01-fundamentos/errores-y-resultados.md", "03-api-reference/rpc-backend.md", "07-referencia/trampas-conocidas.md"]
source: ["supabase_saas_sii.sql §12", "certificacion-node/docs/postulacion.md", "certificacion-node/docs/certificacion.md", "PLAN-SAAS.md Fase 5", "apps/web/src/server/certificacion/", "apps/web/src/lib/certificacion.ts", "apps/web/src/app/[org]/certificacion/", "packages/correos/src/certificacion.ts", "supabase/migrations/0008_certificacion.sql"]
---

# Certificación de la empresa ante el SII

> **Úsalo cuando:** guías a una empresa hasta quedar autorizada en producción.

El asistente de `/<org>/certificacion` lleva a una empresa desde la postulación hasta la
declaración de cumplimiento (P91, autorizada para emitir boletas en producción), todo en
el **ambiente de certificación** del SII. Es la Fase 5 del plan: el código está escrito
pero **sin desplegar**, y la migración `0008_certificacion` que usa está
**aplicada en producción desde el 2026-11-13**
([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0008)).

La app no reimplementa nada de la librería `@winex/certificacion` (principio 4): cada
acción tiene paridad con un comando `sii certificacion …` de la CLI y solo agrega
persistencia, secretos y UI.

## Resumen: 5 pasos, 8 etapas

La UI muestra 5 pasos (`PASOS` de `@/lib/certificacion`); la base guarda 8 etapas
(`procesos_certificacion.etapa`, enum `etapa_certificacion`). `pasoDeEtapa(etapa)` dice en
qué paso está el proceso y `estadoPaso(n, etapa)` si cada paso está `completo`,
`en_curso` o `pendiente` (con `autorizada`, los 5 están completos).

| Paso visible | Etapas del paso | Acciones (en el paso en curso) | La etapa avanza con |
|---|---|---|---|
| 1. Postulación | `borrador` | guardar datos de la postulación; **Postular en el SII** ⚠️ | `postular` OK → `postulada` |
| 2. Set de pruebas | `postulada` | **Descargar el set de pruebas** ⚠️ | `descargarSet` legible → `set_descargado` |
| 3. Folios y envío del set | `set_descargado`, `set_enviado` | **Solicitar folios de certificación** ⚠️ (si faltan); **Enviar el set al SII** / **Volver a enviar el set** ⚠️; **Consultar el estado del envío** 🔁 | `enviarSet` con Track ID → `set_enviado`; `consultarEstadoSet` con EPR limpio → `set_aceptado` |
| 4. Revisión | `set_aceptado`, `revision_solicitada` | **Solicitar revisión** ⚠️; luego **Consultar el estado en el SII** 🔁 | `solicitarRevision` → `revision_solicitada`; el estado P90 → `por_declarar` |
| 5. Declaración de cumplimiento | `por_declarar`, `autorizada` | guardar datos de la declaración; **Declarar cumplimiento** ⚠️; **Consultar el estado en el SII** 🔁 | P91 → `autorizada` |

`por_declarar` y `autorizada` **no las escribe la app**: las pone el trigger
`tg_certificacion_autorizada` cuando la app guarda `codigo_estado_sii = 'P90'` o `'P91'`
(y con P91 marca `empresas.autorizada_produccion`). Etiquetas de cada etapa y quién la
escribe en [objetos de certificación](../04-objetos/objetos-certificacion.md#etapas).

## Roles

| Rol | Ve | Usa |
|---|---|---|
| propietario, administrador | todo | todas las acciones y los formularios (`puedeAdministrar`) |
| emisor, lector | los pasos, el estado, los casos, el envío, las últimas operaciones; la página se actualiza en vivo | nada: no ve botones ni formularios, y un aviso dice «Solo un propietario o un administrador avanza la certificación» |

La autoridad final es la base y el servidor: cada Server Action de `acciones.ts` llama a
`exigirMembresia(slug)`, revisa `puedeAdministrar(rol)` («No tienes permiso para
certificar empresas»), valida el id de la empresa con zod y comprueba que la empresa sea
de la organización (`obtenerEmpresa`). Los formularios escriben con el cliente de sesión
(RLS: solo administradores). Lo que va al SII o cambia la etapa usa `service_role`
filtrando siempre por `organizacion_id`.

## Piezas

| Pieza | Qué hace |
|---|---|
| `apps/web/src/app/[org]/certificacion/page.tsx` | RSC; `maxDuration = 300` y `runtime = 'nodejs'` (en Next 16 el `maxDuration` de la página aplica a sus Server Actions). Elige la empresa (`?empresa=`, la última abierta, la primera activa sin autorizar o la primera) y lee el estado con `leerAsistente` |
| `acciones.ts` | Server Actions finas: membresía, rol, zod, llamada a la API, `revalidatePath` (salvo en un ensayo) |
| `Asistente.tsx`, `Formularios.tsx`, `Piezas.tsx` | UI: pasos, `Dialogo` del ensayo, avisos, casos, envío, operaciones |
| `logica.ts` | lógica pura: qué acción ofrece cada paso (`planAsistente`), qué bloquea (`bloqueoSii`), validación de formularios, textos |
| `EnVivo.tsx` | Realtime de `procesos_certificacion` y `operaciones_sii` → `router.refresh()` ([abajo](#actualización-en-vivo)) |
| `apps/web/src/lib/certificacion.ts` | contrato compartido: `ETAPAS`, `ETIQUETA_ETAPA`, `PASOS`, `pasoDeEtapa`, `estadoPaso`, `ResumenEnsayo`, `ResultadoPaso`, `Requerimiento` |
| `apps/web/src/server/certificacion/` | la API (`index.ts`): `datos.ts`, `postulacion.ts`, `set.ts`, `folios.ts`, `envio-set.ts`, `declaracion.ts`, `operaciones.ts`, `lectura.ts`, `portal.ts`, `notificar.ts`; piezas comunes en `comun.ts`; dependencias inyectables (para Vitest) en `dependencias.ts` |
| `packages/correos/src/certificacion.ts` | correo de cambio de etapa (`correoCertificacion`) |

Lista de funciones, con qué escribe cada una, en el
[índice de operaciones](../03-api-reference/indice-operaciones.md#certificación-ante-el-sii-fase-5).

## Antes de empezar

La UI deshabilita todas las acciones que salen al SII, con el motivo junto a los botones,
si (en este orden): la empresa ya está autorizada; la empresa está desactivada; no tiene
certificado predeterminado; hay una operación `en_curso`; hay una operación incierta sin
revisar. El backend vuelve a validar todo:

- **Empresa activa** (`cargarEmpresa`): si no, «La empresa está desactivada. Actívala en
  Configuración → Empresas…».
- **Certificado predeterminado vigente** de la empresa (`crearCredenciales().certificadoDeEmpresa`):
  inicia sesión en el SII, firma las boletas y la declaración. Para pedir folios hace falta
  un **representante electrónico** (`representante: true`; si el predeterminado no lo es,
  elige otro representante vigente).
- **Proceso creado**: se crea al guardar los datos de la postulación; sin él, «Primero
  guarda los datos de la postulación en el paso 1».

## Ensayo y confirmación

Toda acción ⚠️ se llama dos veces:

1. **Ensayo** (`confirmada: false`), al apretar el botón. El backend valida lo mismo que
   validaría al confirmar (datos, etapa, empresa, certificado, CAF, folios, resolución) y
   devuelve `{ tipo: 'ensayo', resumen }`: título, ambiente (siempre certificación),
   certificado (titular, RUT, vigencia; nunca la huella ni secretos), filas de «qué se
   enviará», avisos y el texto del botón. **No sale al SII ni inserta filas en
   `operaciones_sii`** (equivale a no pasar `--confirmar`; ni siquiera
   `verificar_portal`). La UI lo muestra en un `Dialogo` (tono `peligro` para enviar el
   set y declarar).
2. **Confirmación** (`confirmada: true`), desde el diálogo. El backend valida otra vez
   antes de abrir la operación (un dato que falta no deja fila: `validarAntes`) y una
   tercera dentro de `ejecutarOperacion`, que es quien audita. Ahí aplican la confirmación
   de sesión con `getUser()`, el bloqueo por incierto y el índice de efecto global
   ([regla del incierto](../01-fundamentos/errores-y-resultados.md#la-regla-del-incierto)).

Las consultas de solo lectura (`consultarEstadoSet`, `consultarEstadoDeclaracion`) no
tienen ensayo: van directo, igual dentro de `ejecutarOperacion` (`confirmada = true`).

Todas las acciones devuelven `ResultadoPaso`:

| `tipo` | Lleva | La UI |
|---|---|---|
| `ensayo` | `resumen` | abre el `Dialogo` |
| `ok` | `mensaje { titulo, detalle }`, `avisos?` (los del SII), `operacionId` | `Alerta` de éxito con los avisos |
| `error` | `mensaje`, y según el caso `resultado` (si se ejecutó), `motivo` (si no, o por qué), `operacionPendienteId` (la incierta que bloquea), `errores` (por campo), `requiere.folioInicial` | `Alerta` de error; con `operacionPendienteId`, el botón «Marcar como revisada»; con `requiere`, el campo «Folio inicial» |

Un `error` no siempre significa que la operación falló en `operaciones_sii`: descargar un
set ilegible, encontrar la empresa en P91 al descargar y consultar un set rechazado o con
reparos dejan la operación `ok` y devuelven `error` con `motivo` `set_ilegible`,
`autorizada`, `set_rechazado` o `set_con_reparos`. Otros `motivo`: `no_ejecutada` (la
Server Action no llamó al backend), `datos_invalidos`, `uso` / `config` (validación
previa), los de `ejecutarOperacion` (`incierto_sin_revisar`, `en_curso`,
`sesion_invalida`, `sin_registro`) y `no_encontrada` / `no_revisable` de `marcarRevisada`.

## Paso 1. Postulación

### Datos (`guardarDatosPostulacion`, no sale al SII)

Formulario: RUT del administrador (sugerido: el titular del certificado), correo del
administrador, correo de contacto con el SII, correo de intercambio, nombre del software
(hasta 30), boleta exenta y URL opcional (`www.…`, hasta 100).

- Se valida en la Server Action (`logica.ts`) y otra vez en el backend con zod y con
  `DatosPostulacion` de la librería (las reglas del formulario del SII). Correos con la
  regla del SII (hasta 50, sin `+` ni símbolos, un solo `@`).
- **Solo ASCII imprimible** en lo que va a maullin: «Escríbelo sin tildes, ñ ni otros
  caracteres especiales…: el asistente del SII declara charset=iso-8859-1 y con tildes la
  confirmación no calza y la postulación no se graba».
- Escribe `procesos_certificacion` con el **cliente de sesión** (RLS); la primera vez
  inserta la fila, y `tg_proteger_proceso` la deja en `borrador`.

### Postular (`postular`, ⚠️, efecto global)

- Etapas permitidas: de `borrador` a `revision_solicitada` (se puede repetir: el SII deja
  la empresa en certificación con los datos nuevos). En `por_declarar` o `autorizada`:
  «…no hace falta volver a postular».
- Avisos del ensayo: el titular tiene que ser representante legal; si ya estaba postulada;
  si el administrador no es el titular del certificado.
- Al confirmar: primero **`verificar_portal`** (GET público a www4, su propia fila en
  `operaciones_sii`): si el portal GWT cambió, `verificacion_fallida` (7) y el paso se
  bloquea («El portal de certificación del SII cambió…»). Luego login AUT2000 y
  `PostulacionSii.postular`.
- OK: `postulada_en`, `avisos_postulacion` (la UI los muestra en el paso 1), etapa
  `postulada` si estaba en `borrador`. Si la empresa no tiene resolución de certificación
  vigente, la registra con `registrar_resolucion` (**número 0, fecha del día en Chile**, la
  `FchResol` de certificación); si eso falla, la respuesta trae el aviso «No pudimos
  registrar la resolución de certificación… Regístrala en Configuración → Empresas antes
  de enviar el set».

## Paso 2. Set de pruebas (`descargarSet`, ⚠️)

Campo opcional «Correo del proveedor de software» (en blanco usa el guardado). El SII
**registra la descarga y entrega un set nuevo**: los envíos hechos con uno anterior dejan
de servir. Guarda el estado de la declaración que leyó; con P91 no descarga, con P90 la
librería no descarga. Con el texto legible, `guardar_set_pruebas` reemplaza los casos y
deja `set_descargado`; si no se puede leer, guarda el texto, borra los casos y responde
`set_ilegible` sin cambiar la etapa. Detalle en
[set de pruebas](../05-pruebas/set-de-pruebas.md#1-descarga-descargarset).

## Paso 3. Folios y envío del set

- **Solicitar folios** (`solicitarFoliosSet`, ⚠️, efecto global): tipo 39, cantidad = casos
  del set, certificado de representante; CAF → Vault + `cafs` con `registrar_caf`. La UI lo
  ofrece solo si los folios disponibles no alcanzan. Primer timbraje: si el SII exige folio
  inicial, aparece el campo con el sugerido. [Folios](folios-caf.md#folios-del-set-de-pruebas-fase-5).
- **Enviar el set** (`enviarSet`, ⚠️): un folio por caso, boletas con receptor
  `66666666-6`, sobre con la resolución de certificación, subida por la API REST. Con Track
  ID → `set_enviado`. Bloqueado (también el ensayo) si el envío anterior quedó incierto sin
  revisar. [Envío](../05-pruebas/set-de-pruebas.md#5-armado-y-envío-por-rest-enviarset).
- **Consultar el estado del envío** (`consultarEstadoSet`, 🔁): guarda estado, estadísticas,
  rechazos y la consulta; con EPR limpio → `set_aceptado`. Con rechazos o reparos, la UI
  ofrece «Volver a enviar el set» (con folios nuevos) solo si la clasificación es
  `rechazado` o `inconsistente` ([trampa](../07-referencia/trampas-conocidas.md#certificación-ante-el-sii-fase-5)).
  [Estado](../05-pruebas/set-de-pruebas.md#6-consulta-de-estado-consultarestadoset).

## Paso 4. Revisión

- **Solicitar revisión** (`solicitarRevision`, ⚠️): con el Track ID del envío aceptado sin
  reparos → `revision_solicitada`. El SII responde por correo.
  [Revisión](../05-pruebas/set-de-pruebas.md#7-revisión-solicitarrevision).
- **Consultar el estado en el SII** (`consultarEstadoDeclaracion`, 🔁): `DeclaracionBoletas.estado`
  y guarda `codigo_estado_sii`, `glosa_estado_sii`, `paso_sii`, `estado_consultado_en`.
  Con **P90** el trigger pasa la etapa a `por_declarar` («La empresa está lista para
  declarar (P90)»); con **P91**, a `autorizada`. Sin trámite (código nulo): «El SII no
  muestra un trámite pendiente: la empresa ya está autorizada, no está postulada o el
  titular del certificado no la representa». Disponible desde `postulada` (en la UI, en
  los pasos 4 y 5).

## Paso 5. Declaración de cumplimiento

### Datos (`guardarDatosDeclaracion`, no sale al SII)

Enlace de consulta (hasta 100), RUT, nombre (hasta 30) y correo del proveedor de software.
Van por GWT-RPC en UTF-8: **admiten tildes**. Se validan con zod y `DatosDeclaracion`.
Exige que el proceso exista. Cliente de sesión (RLS).

### Declarar (`declarar`, ⚠️, efecto global)

- Solo en `por_declarar` (P90). En `autorizada`: «…no hace falta declarar otra vez».
- El ensayo avisa: «Declarar deja a la empresa AUTORIZADA EN PRODUCCIÓN…» y que el titular
  firma como representante legal. La UI además muestra una alerta permanente en el paso.
- Al confirmar: `verificar_portal`, login y `DeclaracionBoletas.declarar`. Guarda
  `declarada_en` y el estado que devuelve el SII; con P91 el trigger deja `autorizada` y
  marca la empresa.
- `DeclaracionInciertaError` → `incierto`, con «No repitas la declaración a ciegas:
  consulta antes el estado de la declaración (P91 = quedó autorizada; P90 = se puede volver
  a declarar)».

## Operaciones inciertas y cómo revisarlas

`incierto` (código 6) = la orden llegó o pudo llegar al SII y no se sabe si quedó hecha
([regla](../01-fundamentos/errores-y-resultados.md#la-regla-del-incierto)). En el asistente
aparece en:

| Operación | Cuándo queda incierta | Qué la bloquea |
|---|---|---|
| `postular` | la librería no lo marca incierto: una falla en el POST que graba llega como `ErrorPostulacion` (`rechazo_sii`); solo una `en_curso` abandonada cuenta como incierta | `ejecutarOperacion` (efecto global) |
| `solicitar_folios` | `FoliosSinCafError`, o CAF timbrado que no se pudo guardar | `ejecutarOperacion` (efecto global) |
| `enviar_set` | `ErrorTransporte` después de salir, o Track ID que no se pudo guardar | **`bloqueoEnvioSet`** de `operaciones.ts` (no es de efecto global): mira el último `enviar_set` confirmado de la empresa y bloquea si es `incierto` o `en_curso` (abandonada o no) sin revisar; aplica **también al ensayo** |
| `declarar` | `DeclaracionInciertaError` | `ejecutarOperacion` (efecto global) |

La UI lista cada operación incierta sin revisar (de `postular`, `descargar_set`,
`solicitar_folios`, `enviar_set`, `solicitar_revision` y `declarar`) en un aviso «<nombre>:
por verificar» con qué revisar en el SII (`comoRevisar` de `logica.ts`), y deshabilita
todas las acciones que salen al SII mientras haya una:

| Operación | Qué revisar antes de marcarla |
|---|---|
| `postular` | en maullin.sii.cl, con el certificado de la empresa, si la postulación quedó grabada |
| `solicitar_folios` | si se timbró un CAF nuevo de boleta en certificación; si se timbró, no volver a pedirlo |
| `enviar_set` | si llegó un envío de boletas de la empresa en los últimos minutos; si llegó, no reenviarlo |
| `declarar` | el estado de la declaración: P91 = la declaración se grabó |
| `solicitar_revision` | el estado de la declaración, para saber si la revisión quedó solicitada |
| `descargar_set` | si se generó un set de pruebas nuevo |

**«Marcar como revisada»** (solo administradores) abre un `Dialogo` con ese texto y llama a
`marcarRevisada(ctx, operacionId)`, que comprueba que la operación sea de la organización
**y de la empresa** y envuelve `marcarInciertaRevisada` (agrega `detalle.revisada_en` y
`revisada_por`; con eso la fila deja de bloquear). Marcar desbloquea un reintento que
puede quemar folios: hazlo solo después de revisar en el SII.

## Avisos por correo y webhook

En cada cambio de etapa, `notificarCambioEtapa` (`notificar.ts`) manda un correo por Resend
a los **propietarios y administradores** de la organización (correos de `perfiles`, sin
repetir):

- Asunto «Certificación de <empresa>: <etapa>», la etapa nueva con su etiqueta, el
  siguiente paso (`SIGUIENTE_PASO`) y el botón «Abrir el asistente de certificación»
  (`NEXT_PUBLIC_APP_URL/<slug>/certificacion`). Sin secretos.
- Idempotente por operación: `Idempotency-Key` = `certificacion/<operacionId>/<etapa>`.
- Compara la etapa antes y después del `update` (la que dejó el trigger): sin cambio, no
  manda nada. Nunca hace fallar la operación: cualquier error queda en un aviso de consola
  sin datos. Sin `NEXT_PUBLIC_APP_URL`, no se envía.
- Los cambios que hace `guardar_set_pruebas` también avisan (la app conoce la etapa
  anterior y la nueva).

El webhook `certificacion.actualizada` no lo encola la app: lo encola el trigger
`tg_certificacion_autorizada` en cada `update` que cambia la etapa
([webhooks](../06-integraciones/webhooks.md#certificacionactualizada-fase-5)).

## Actualización en vivo

`EnVivo.tsx` se suscribe con el cliente del navegador a `postgres_changes` de
`procesos_certificacion` y `operaciones_sii` filtrados por `empresa_id`, y ante cualquier
cambio llama a `router.refresh()` (con una espera de 400 ms para juntar cambios seguidos).
No guarda filas: la fuente de verdad es el RSC, que lee con RLS. Al reconectar refresca
una vez; si el canal falla, muestra «No pudimos conectar la actualización en vivo…». La
operación en curso se muestra desde `operaciones_sii` («Postulando en el SII desde las
14:32…»), sin spinners por fila
([Realtime](../06-integraciones/realtime-y-storage.md#asistente-de-certificación-fase-5)).

## Pruebas

- Vitest de la capa (`apps/web/src/server/certificacion/*.test.ts`) con dobles de la
  librería y un cliente de Supabase falso (`apps/web/test/supabase-falso.ts`,
  `certificacion-prueba.ts`, `caf-prueba.ts`), sin red ni base. `secretos.test.ts` comprueba
  que ninguna llave del CAF, token, cookie ni clave del .pfx llega a `operaciones_sii`, a
  los mensajes, a Sentry ni a la consola.
- `logica.test.ts` (plan del asistente, validaciones) y
  `packages/correos/src/certificacion.test.ts`.
- E2E (`apps/web/e2e/certificacion.spec.ts`): solo que la ruta sin sesión redirige a
  `/ingresar` (la base es producción). El asistente con sesión se prueba a mano contra
  certificación.
- Base: verificación `0008_certificacion.sql` y simulación `rls-fase5-certificacion.sql`
  ([cómo](../05-pruebas/probar-el-esquema.md#6-simulación-de-las-rpc-de-la-fase-5-rls-fase5-certificacionsql)).
