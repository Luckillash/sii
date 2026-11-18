---
title: "Planes, suscripciones y pagos (Flow)"
description: "Fase 10: grilla de planes (D5), contratación con Flow (D4: cliente, registro de tarjeta, retorno sin cookies, suscripción y activar_suscripcion), cambio de plan con prorrateo, cancelación al fin del período, sincronización y mora (gracia hasta morose = 1), callback de pago, cron horario, idempotencia con eventos_pasarela, correo de mora, cuotas y avisos de la UI, variables FLOW_*, qué responde cada ruta y cómo probar en el sandbox de Flow."
keywords: [Fase 10, D4, D5, planes, grilla, suscripciones, pagos, Flow, flow.cl, sandbox, pasarela, server/pagos, flow.ts, flow-pasarela.ts, pasarela.ts, suscripciones.ts, avisos.ts, llamarFlow, firmarFlow, HMAC-SHA256, apiKey, firma s, asegurarPlan, boleteame-, planId, customerId, customer/create, customer/register, customer/getRegisterStatus, subscription/create, subscription/get, subscription/changePlan, subscription/changePlanPreview, subscription/cancel, at_period_end, payment/getStatus, invoice/get, commerceOrder, urlCallback, url_return, days_until_due, charges_retries_number, morose, status, gracia, morosa, cancelar_al_fin_periodo, sincronizada_en, activar_suscripcion, clientes_pago, plan_pendiente_id, pagos, eventos_pasarela, iniciarContratacion, activarDespuesDeRegistro, previsualizarCambio, cambiarDePlan, cancelarSuscripcion, procesarAvisoPago, sincronizarSuscripcion, sincronizarTodas, avisarMorosas, suscripcion.morosa, correoSuscripcionMorosa, leerVistaPlan, cuotaProduccion, nivelCuota, UMBRAL_AVISO_CUOTA, limitesExcedidos, BarraUso, Configuración → Plan, /api/pagos/flow/registro, /api/pagos/flow/confirmacion, /api/cron/suscripciones, sincronizar-suscripciones, cron-suscripciones, FLOW_API_KEY, FLOW_SECRET_KEY, FLOW_API_URL, envFlow, SameSite=Lax, 303, tarjeta de prueba, 4051885600446623]
related: ["01-fundamentos/tenancy-y-roles.md", "04-objetos/objetos-tenancy.md", "03-api-reference/rpc-backend.md", "03-api-reference/acceso-por-tabla.md", "03-api-reference/indice-operaciones.md", "01-fundamentos/ambientes-y-credenciales.md", "08-esquema-supabase/despliegue.md", "05-pruebas/probar-el-esquema.md", "07-referencia/trampas-conocidas.md", "07-referencia/checklist-produccion.md", "02-guias/onboarding-organizacion.md", "02-guias/emision-boletas.md"]
source: ["PLAN-SAAS.md Fase 10, D4 y D5", "supabase/migrations/0015_planes_comerciales.sql", "supabase/migrations/0016_pagos.sql", "supabase/migrations/0017_cron_suscripciones.sql", "apps/web/src/server/pagos/", "apps/web/src/app/api/pagos/flow/", "apps/web/src/app/api/cron/suscripciones/route.ts", "apps/web/src/app/[org]/configuracion/plan/", "apps/web/src/lib/planes.ts", "apps/web/src/server/folios/plan.ts", "apps/web/src/app/[org]/emitir/logica.ts", "apps/web/src/server/env.ts", "packages/correos/src/suscripcion.ts"]
---

# Planes, suscripciones y pagos (Flow)

> **Úsalo cuando:** tocas Configuración → Plan, el cobro con Flow, las rutas
> `/api/pagos/flow/*` o `/api/cron/suscripciones`, o necesitas explicar por qué una
> organización no puede emitir en producción, agregar empresas o sumar usuarios.

**Estado (2026-11-17).** Fase 10 con el código escrito y las migraciones `0015`, `0016` y
`0017` probadas en PGlite. **Pendiente:** aplicar las migraciones en producción (la `0015` y
la `0016` antes del deploy, la `0017` después), cargar las credenciales de Flow sandbox en
`.env.local` y en Vercel *Production*, desplegar y probar el criterio de aceptación en el
sandbox. Nada de esta guía se ha probado todavía contra Flow ni contra la base de
producción. También quedan fuera: cambiar la tarjeta registrada y emitir una boleta propia de
Boletéame por cada cobro (cumplimiento tributario del SaaS, antes del lanzamiento).

Decisiones (PLAN-SAAS §9): **D4**, la pasarela es Flow (suscripciones nativas en CLP:
planes, cliente con tarjeta registrada, cobro recurrente con reintentos, cambio de plan con
prorrateo, callback servidor a servidor). **D5**, la grilla y los precios, la cuota como
bloqueo duro con aviso al 80 % y al 100 %, y Certificación gratis y sin plazo.

## Dónde vive

| Pieza | Archivo |
|---|---|
| Cliente de Flow (firma HMAC-SHA256, sin SDK) | `apps/web/src/server/pagos/flow.ts`: `llamarFlow`, `firmarFlow` |
| Interfaz de la pasarela | `server/pagos/pasarela.ts` (`Pasarela`, `SuscripcionExterna`, `FacturaExterna`…; estados con nombres de la app) |
| Implementación con Flow y normalizadores | `server/pagos/flow-pasarela.ts`: `pasarelaFlow`, `normalizarSuscripcion`, `normalizarFactura`, `instanteFlow`, `diaFlow`, `idPlanFlow`; `DIAS_HASTA_VENCER = 7`, `REINTENTOS_COBRO = 3` |
| Dominio | `server/pagos/suscripciones.ts`: contratar, retorno del registro, sincronizar, cambiar, cancelar, aviso de pago, idempotencia |
| Entrada y dependencias | `server/pagos/index.ts`: `dependenciasPagos()` (`null` sin Flow), `pasarelaConfigurada()` |
| Uso, lectura y mensajes | `server/pagos/uso.ts` (`leerUso`), `lectura.ts` (`leerVistaPlan`, con la sesión), `errores.ts` (`mensajeFallaPagos`, `mensajeRetornoPago`) |
| Correo de mora | `server/pagos/avisos.ts` (`avisarMorosas`) y la plantilla `packages/correos/src/suscripcion.ts` (`correoSuscripcionMorosa`) |
| Constantes del cron | `server/pagos/constantes.ts`: `HORARIO_SUSCRIPCIONES = '41 * * * *'`, `MONITOR_SUSCRIPCIONES = 'cron-suscripciones'`, `LIMITE_POR_CORRIDA = 200`, `PRESUPUESTO_MS = 90_000` |
| Rutas | `app/api/pagos/flow/registro/route.ts`, `app/api/pagos/flow/confirmacion/route.ts`, `app/api/pagos/flow/token.ts` (`leerTokenFlow`), `app/api/cron/suscripciones/route.ts` |
| Página | `app/[org]/configuracion/plan/`: `page.tsx`, `Planes.tsx` (grilla y diálogos), `BarraUso.tsx`, `acciones.ts` (Server Actions) |
| Planes y cuotas (puro) | `apps/web/src/lib/planes.ts`: `nivelCuota`, `UMBRAL_AVISO_CUOTA = 0.8`, `limitesExcedidos`, `caracteristicasPlan`, `ETIQUETA_ESTADO_SUSCRIPCION` |
| Cupo de producción para Emitir | `server/folios/plan.ts`: `cuotaProduccion`; `app/[org]/emitir/logica.ts` (`bloqueoEmision`) y `page.tsx` (aviso) |
| Esquema | migraciones `0015_planes_comerciales`, `0016_pagos`, `0017_cron_suscripciones` ([objetos](../04-objetos/objetos-tenancy.md#planes), [RPC](../03-api-reference/rpc-backend.md#activar_suscripcion-migración-0016)) |
| Pruebas | `server/pagos/{flow,flow-pasarela,suscripciones,avisos}.test.ts`, `app/api/pagos/flow/{registro,confirmacion}/route.test.ts`, `token.test.ts`, `app/api/cron/suscripciones/route.test.ts`, `lib/planes.test.ts`, `app/[org]/emitir/logica.test.ts`, `packages/correos/src/suscripcion.test.ts`; SQL en `supabase/verificaciones/` ([probar el esquema](../05-pruebas/probar-el-esquema.md#13-simulación-de-planes-y-pagos-de-la-fase-10-rls-fase10-pagossql)) |

## La grilla

Montos en pesos, **IVA incluido**, mensuales. Valores de la `0015` (pendiente de aplicar):

| `codigo` | Nombre | $/mes | Empresas | Usuarios | Boletas de producción al mes | API y webhooks | Se contrata en la app |
|---|---|--:|--:|--:|--:|:-:|:-:|
| `certificacion` | Certificación | 0 | 1 | 2 | 0 (sin producción) | no | no: es el plan con que nace toda organización, **sin plazo**, y al que vuelve al cancelar |
| `pyme` | Pyme | 14.990 | 1 | 3 | 1.000 | no | sí |
| `contador` | Contador | 49.990 | 15 | 10 | 10.000, compartidas por toda la organización | no | sí |
| `api` | API | 39.990 | 3 | 5 | 20.000 | sí | sí |
| `empresa` | Empresa | a medida | sin límite | sin límite | sin límite | sí | no: sin precio público, la asigna `service_role` («Hablar con ventas») |

`emprendedor` (de la `0001`) queda con `activo = false`: se fusiona con Pyme. Las columnas
`planes.autoservicio` (se contrata desde la app) y `planes.orden` (orden de la grilla) son de
la `0015`. La grilla muestra los planes de autoservicio más el actual
(`p.autoservicio || p.codigo === planActual`). El cobro por excedente de boletas queda para
después: hoy la cuota es un bloqueo duro.

En Flow cada plan se llama `boleteame-<codigo>` (`idPlanFlow`) y se crea **bajo demanda**
(`asegurarPlan`, en la primera contratación o cambio): `currency = CLP`, `amount =
precio_mensual_clp`, `interval = 3` (mensual), `interval_count = 1`, `trial_period_days = 0`,
`days_until_due = 7`, `charges_retries_number = 3` y `urlCallback =
<NEXT_PUBLIC_APP_URL>/api/pagos/flow/confirmacion`. Si el plan ya existe en Flow con otro
monto, `asegurarPlan` falla y no se contrata nada
([trampa](../07-referencia/trampas-conocidas.md#pagos-y-suscripciones-fase-10)).

## Estados de la suscripción

| `estado` | Cuándo | `plan_vigente()` | UI |
|---|---|---|---|
| `prueba` | Certificación (nace así; vuelve así al terminar una cancelación) | el plan | «Gratis» |
| `activa` | pagada en Flow; **también durante la gracia**, mientras Flow reintenta el cobro | el plan | «Activa» |
| `morosa` | Flow informó `morose = 1` (importe vencido) | **nulo**: sin producción, sin empresas ni usuarios nuevos; la certificación sigue | «Pago vencido» |
| `cancelada` | reemplazada por otra o terminada | — | — |

Una sola vigente (`prueba`, `activa` o `morosa`) por organización
(`suscripciones_vigente_unica`). Los cambios de una suscripción a otra los hace siempre
`activar_suscripcion()` en una transacción.

## Contratar (desde Certificación)

Solo propietarios y administradores. En la grilla, «Cambiar a <plan>» abre un diálogo que
avisa que Flow pedirá la tarjeta y cobrará el primer mes; «Ir a Flow» llama a la Server
Action `contratar`.

```
Administrador         App (Server Action / ruta)               Flow                        Base (service_role)
     |                          |                                 |                               |
  1  |-- «Ir a Flow» ---------->| contratar(slug, 'pyme')         |                               |
     |                          | exigirMembresia + puedeAdministrar + getUser()                  |
     |                          | plan activo y de autoservicio; limitesExcedidos (¿cabe?)        |
  2  |                          |-- plans/get boleteame-pyme ---->|                               |
     |                          |<-- no existe → plans/create ----|  (si existe con otro monto: falla)
  3  |                          |-- customer/create ------------->|  (solo si no hay cliente)     |
     |                          |<-- customerId ------------------|                               |
     |                          |---------------------------------------- insert clientes_pago -->|
  4  |                          |------------------------------ plan_pendiente_id = pyme -------->|
  5  |                          |-- customer/register (url_return = /api/pagos/flow/registro) -->|
     |<-- url?token ------------|<-- url + token -----------------|                               |
  6  |-- registra la tarjeta en flow.cl ------------------------->|                               |
  7  |<-- POST /api/pagos/flow/registro (solo token, SIN cookies) |                               |
     |                          | reclamar evento (registro, token) ------------------------------>| eventos_pasarela
  8  |                          |-- customer/getRegisterStatus -->|                               |
     |                          |<-- customerId, status, tarjeta -|                               |
     |                          | organización = clientes_pago por customerId; plan = plan_pendiente_id
     |                          |---------------------------------------- tarjeta (marca, 4) ---->|
  9  |                          |-- plans/get (asegurarPlan) ---->|                               |
     |                          |-- subscription/create --------->|  (cobra el primer mes)        |
     |                          |<-- subscriptionId, período -----|                               |
     |                          |------------------------- datos.suscripcion_externa = id ------->| eventos_pasarela
 10  |                          |------- activar_suscripcion(org, pyme, 'activa', 'flow', id) --->| cancela Certificación,
     |                          |                                 |                               | inserta la de Flow
     |                          |------------------------------------------- upsert pagos ------->|
     |                          |------------------------------ limpia plan_pendiente_* --------->|
     |                          |---------------------- evento procesado (resultado, plan) ------>|
 11  |<-- 303 /<slug>/configuracion/plan?pago=suscrita (GET, con cookies)                         |
```

Notas:

- **Paso 7, sin cookies.** El retorno es un POST desde `flow.cl`: las cookies de sesión
  (`SameSite=Lax`) no viajan. Por eso el plan elegido se guarda antes (paso 4) en
  `clientes_pago.plan_pendiente_id`, con la sesión de un administrador, y la ruta identifica
  a la organización por el `customerId` que Flow confirma con el token firmado. La ruta
  también acepta GET con `?token=`.
- **Paso 1, ¿cabe?** `limitesExcedidos` compara empresas y usuarios actuales con el plan
  elegido; si no cabe, `no_cabe` con el motivo («El plan Pyme permite 1 empresa y tienes
  2.») y no se llama a Flow. La grilla deshabilita el botón con el mismo texto.
- Si la organización **ya tiene** una suscripción de Flow vigente, `contratar` responde
  `cambio` y la UI solo refresca (la página estaba desactualizada): se usa el cambio de plan.
- Si en el retorno la tarjeta no quedó registrada, `?pago=tarjeta_rechazada` y no se crea
  nada. Si no había plan pendiente, solo se guarda la tarjeta (`tarjeta_actualizada`). Si ya
  había una suscripción de Flow con otro plan, se cambia de plan (`plan_cambiado`).
- Si `subscription/create` responde pero `activar_suscripcion` falla, el evento queda
  `fallido` con `datos.suscripcion_externa`; el reintento del mismo token la reusa (no crea
  otra) y Sentry recibe «pagos: suscripción creada en Flow sin activar en la base».

Resultados de `?pago=` y su aviso en la página (`mensajeRetornoPago`): `suscrita` («Tu
suscripción quedó activa»), `plan_cambiado`, `tarjeta_actualizada`, `tarjeta_rechazada`
(«La tarjeta no quedó registrada… no se hizo ningún cobro»), `en_proceso` («Estamos
activando tu suscripción», otro retorno con el mismo token está en curso) y `error` («No
pudimos completar la suscripción… Si Flow te cobró y el plan no cambió, escríbenos»).

## Cambiar de plan

Con una suscripción de Flow vigente, sin volver a pedir la tarjeta:

1. Al elegir un plan, la Server Action `vistaPreviaCambio` (`previsualizarCambio`) valida
   que el plan sea de autoservicio, distinto del actual y que el uso quepa, asegura el plan
   en Flow y llama a `subscription/changePlanPreview`. El diálogo muestra el prorrateo de
   Flow: «Flow cobrará ahora $ X por la diferencia del período en curso», «Te queda un saldo
   a favor de $ X, que Flow descuenta de los próximos cobros» o «No hay diferencia…», y la
   fecha del próximo cobro.
2. «Cambiar de plan» llama a `cambiarPlan` (`cambiarDePlan`): repite las validaciones,
   `subscription/changePlan` y sincroniza la suscripción. Flow conserva el mismo
   `subscriptionId`, así que **no** se llama a `activar_suscripcion`: la sincronización
   actualiza `plan_id` en la misma fila.
3. Si Flow ya informa el plan nuevo: «Cambiaste al plan X. Los nuevos límites se aplican
   desde la próxima emisión.» Si no: «Flow programó el cambio al plan X para el <fecha>.
   Hasta entonces rige tu plan actual.»

## Cancelar

«Cancelar la suscripción» (solo con una suscripción de Flow y sin cancelación pedida) llama
a `cancelarPlan` (`cancelarSuscripcion`): `subscription/cancel` con `at_period_end = 1`.
**Siempre al fin del período pagado**: la suscripción sigue `activa` con
`cancelar_al_fin_periodo = true` y la página dice «Pedida. Rige hasta el <fecha>; después
vuelves al plan Certificación». Flow no avisa cuando la cancelación se cumple: la próxima
sincronización ve `status = 4` y vuelve la organización a Certificación con
`activar_suscripcion(org, certificacion, 'prueba')` (sin proveedor), en una transacción.

## Sincronización y mora

La fuente de verdad del cobro es Flow; la base guarda una copia que es la que leen los
triggers por `plan_vigente()`. `sincronizarSuscripcion` lee `subscription/get`, hace upsert
de los importes en `pagos` y aplica el estado:

| Flow | App |
|---|---|
| `status = 4` | cancelada en Flow → `activar_suscripcion` a `certificacion`/`prueba` (si no estaba cancelada ya) |
| `morose = 1` (importe vencido: pasó `due_date`, 7 días, tras los reintentos) | `morosa` |
| `morose = 0` o `2` (al día, o impago dentro de plazo) | `activa` (gracia) |
| `planId` `boleteame-<codigo>` | `plan_id` de ese código |
| `period_start`, `period_end`, `cancel_at_period_end` | `periodo_inicio`, `periodo_fin`, `cancelar_al_fin_periodo`; además `sincronizada_en = now()` |

Importes (`invoices`) → `pagos`: `status = 1` pagado, `2` anulado; si no, `vencido` cuando
`due_date` ya pasó en hora de Chile, o `pendiente`. Se guardan monto, período, vencimiento,
fecha de pago, medio, `paymentLink` (solo si es `https://`), intentos y el error de Flow.

**La gracia** (D4) es justamente esto: mientras Flow reintenta el cobro (3 reintentos dentro
de los 7 días de `days_until_due`) la suscripción sigue `activa` y la organización trabaja
normal. Recién con `morose = 1` pasa a `morosa`. Al pagar (con el enlace de pago de Flow o
cuando un reintento resulta), la siguiente sincronización la vuelve a `activa` en la misma
fila.

Con la suscripción `morosa`, la página de plan muestra «Tu suscripción tiene un pago
vencido» y, a los administradores, «Pagar $ X en Flow» con el `enlace_pago` del importe
vencido; el historial de pagos tiene «Pagar en Flow» en cada importe impago.

## Callback de pago

`POST /api/pagos/flow/confirmacion` es el `urlCallback` de los planes: Flow avisa cada pago
de una suscripción con un POST servidor a servidor que trae **solo** `token`, sin firma. La
autenticidad la da consultar con ese token por la API firmada. `procesarAvisoPago`:

1. Reclama el evento `(flow, pago, token)` en `eventos_pasarela`; si ya estaba procesado o
   en curso, termina (`repetido`).
2. `payment/getStatus` con el token. Si `commerceOrder` es numérico, se asume que es el id
   del importe y `invoice/get` dice de qué suscripción es.
3. Con la suscripción: la busca por `(proveedor_pago, id_externo)` y la sincroniza; si no
   existe en la base, el evento queda `ignorado`.
4. Sin poder asociarla: sincroniza hasta 20 suscripciones vigentes (las menos recientes),
   con un presupuesto de 10 s. El cron hace lo mismo cada hora, así que esto solo adelanta
   el cambio.

Responde **200 `{ ok: true }` siempre que el token tenga forma válida**, aunque el proceso
falle (Sentry recibe «pagos: aviso de pago no procesado»): Flow no reintenta el estado por un
5xx y exige respuesta en menos de 15 s.

Flow envía el comprobante de cada cobro al correo del pagador. Boletéame no manda un correo
propio de comprobante, y todavía no emite una boleta propia por cada cobro (pendiente).

## Cron

`/api/cron/suscripciones` (`POST` o `GET`, Bearer `CRON_SECRET`, `maxDuration = 120`). Lo
llama `pg_cron` cada hora en el minuto 41 UTC (job `sincronizar-suscripciones` de la
`0017`, **pendiente**, se aplica después del deploy), con el *cron monitor*
`cron-suscripciones` de Sentry (`conMonitorCron`, máximo 3 minutos).

1. `sincronizarTodas`: las suscripciones de Flow `activa` o `morosa` con id externo, las
   menos sincronizadas primero (`sincronizada_en` nulos primero), hasta 200 o 90 s.
2. `avisarMorosas` con los resultados de esa corrida.
3. Responde solo conteos: `{ revisadas, cambiadas, morosas, canceladas, errores, avisos: {
   candidatas, enviadas, omitidas, fallidas, correoConfigurado } }`. Con errores, un aviso a
   Sentry («suscripciones: corrida con errores»).

Es lo que aplica lo que Flow no avisa: los cobros fallidos (mora), el fin de una
cancelación y lo que se perdió en el callback. Una hora de demora no cambia nada: la mora de
Flow se mide en días.

## Correo de mora

`avisarMorosas` (`server/pagos/avisos.ts`), mismo esquema que las alertas de la Fase 8:

- Un correo por **importe vencido**: tipo `suscripcion.morosa`, clave
  `suscripcion.morosa:<suscripcion_id>:<factura_id>` en `notificaciones`
  (`reclamar_notificacion`). Si la mora sigue, el cron la vuelve a ver cada hora sin
  reenviar; el importe vencido del mes siguiente es otra clave y otro correo.
- `Idempotency-Key` de Resend `suscripcion.morosa/<suscripcion>/<factura>`, guardada también
  en `notificaciones.grupo`.
- Para propietarios y administradores, sin repetir. Plantilla `correoSuscripcionMorosa`:
  «Tu plan tiene un pago vencido: <organización>», con plan, monto, vencimiento, el enlace de
  pago de Flow (si es `https://`) y el enlace a Configuración → Plan. Sin datos de la tarjeta.
- Hasta 20 correos por corrida y sin empezar otro pasados 20 s. Sin Resend o sin
  `NEXT_PUBLIC_APP_URL` no reclama nada (el aviso sale en la primera corrida con correo).
  Nunca registra correos, enlaces ni montos en los logs.

## Idempotencia de los avisos (`eventos_pasarela`)

Flow puede mandar el mismo aviso más de una vez, y el usuario puede recargar el retorno.

- El `insert` en `eventos_pasarela` con `(proveedor, tipo, token)` único **es** el reclamo.
  Si choca (`23505`), se lee la fila: `procesado` o `ignorado` → no se repite (el retorno
  devuelve el `resultado` que quedó en `datos`); `recibido` de hace menos de 2 minutos → en
  curso (`en_proceso`); `fallido` o abandonado → se retoma (`intentos + 1`), conservando
  `datos`.
- `datos.suscripcion_externa` se guarda **apenas** Flow crea la suscripción, antes de
  activarla: un reintento la reusa con `subscription/get` en vez de crear otra (que cobraría
  dos veces).
- `activar_suscripcion` es idempotente con el mismo id externo y rechaza (`22023`) uno de una
  suscripción ya cancelada, así que un aviso tardío no revive nada.

## Cuotas y dónde avisa la UI

La autoridad son los triggers de la base (bloqueo duro); la UI avisa antes y explica.

| Límite | Lo aplica la base | Aviso en la UI |
|---|---|---|
| Boletas de producción del mes (`max_boletas_mes`, toda la organización, mes calendario en hora de Chile, `uso_mensual.boletas_produccion`) | `tg_contar_uso_documento` rechaza la boleta que pasa el cupo | **Emitir**: alerta al 80 % («Te quedan pocas boletas en producción este mes») y al 100 % («Se alcanzó el límite…»), con «Revisa tu plan» para administradores; al 100 % bloquea el envío en producción (`bloqueoEmision`). **Plan**: barra de uso que cambia de tono al 80 % y al 100 % (`BarraUso`, `nivelCuota`) |
| Producción (`permite_produccion`; nulo si `morosa`) | `tg_validar_documento` | Emitir: motivo `plan_sin_produccion`, «Tu plan no incluye producción o tiene un pago vencido», con enlace a la página de plan |
| Empresas (`max_empresas`) | `tg_limite_empresas` | Empresas: sin botón «Agregar empresa» y aviso del plan (desde la Fase 3); Plan: barra |
| Usuarios (`max_usuarios`) | `exigir_cupo_usuarios` al aceptar y `tg_limite_usuarios` | Equipo: aviso de cupo lleno y, sin plan vigente, «La organización no tiene un plan vigente (por ejemplo, por un pago vencido)…»; Plan: barra |
| Bajar de plan | — | `limitesExcedidos`: no deja elegir un plan donde no caben las empresas o los usuarios actuales (las boletas del mes no lo impiden) |

El cupo de Emitir sale de `cuotaProduccion` (`server/folios/plan.ts`, con `service_role`:
`plan_vigente` + `uso_mensual`). Si no se puede leer, Emitir no bloquea y decide la base al
emitir. Las boletas de certificación no cuentan.

## Permisos

- Ver el plan, el uso y la grilla: cualquier miembro (`leerVistaPlan` con la sesión).
- Contratar, cambiar, cancelar y ver la tarjeta y los pagos: **propietarios y
  administradores** (`puedeAdministrar` en la página y en las acciones; RLS `es_admin` en
  `clientes_pago` y `pagos`). Las acciones confirman la sesión con `getUser()` antes de
  llamar a Flow (operación con cobro).
- Todo lo que escribe va con `service_role` desde `server/pagos/`; los usuarios no escriben
  ninguna tabla de pagos ([acceso por tabla](../03-api-reference/acceso-por-tabla.md)).

Errores de las acciones (`mensajeFallaPagos`): `sin_configuracion` («Los pagos todavía no
están habilitados»), `plan_invalido`, `no_cabe`, `ya_en_plan`, `sin_suscripcion`,
`pasarela_red` («Flow no respondió. No se hizo ningún cobro desde Boletéame…»), `pasarela`
(«Flow rechazó la operación») y `base` («No pudimos guardar el cambio. Recarga la página antes
de reintentar…»). El detalle técnico de Flow va a los logs (servicio, código y mensaje; nunca
la `apiKey`, la firma ni los parámetros), no a la UI.

## Variables de entorno

| Variable | Valor | Notas |
|---|---|---|
| `FLOW_API_KEY` | *apiKey* de la cuenta de Flow | *sensitive*; mínimo 10 caracteres |
| `FLOW_SECRET_KEY` | *secretKey* de la misma cuenta | *sensitive*; firma cada llamada (`s`) |
| `FLOW_API_URL` | `https://sandbox.flow.cl/api` (Fase 10) o `https://www.flow.cl/api` (lanzamiento) | cualquier otro valor se rechaza |
| `NEXT_PUBLIC_APP_URL` | `https://boleteame.dev` | de aquí salen `url_return` y `urlCallback`; ya existe |
| `CRON_SECRET` | el mismo que `cron_token` en Vault | ya existe (Fase 8) |

`envFlow()` devuelve `null` si falta cualquiera de las tres `FLOW_*`: la página muestra la
grilla sin contratar, las acciones responden «Los pagos todavía no están habilitados» y las
tres rutas responden 503. Durante la Fase 10, las de *Production* apuntan al sandbox. Al
2026-11-17 **no están cargadas** ni en `.env.local` ni en Vercel, y `apps/web/.env.example`
no las lista. Detalle en
[ambientes y credenciales](../01-fundamentos/ambientes-y-credenciales.md#pasarela-de-pagos-flow_-fase-10).

## Qué responde cada ruta

`/api/*` es público para el proxy de sesión (`lib/rutas.ts`); las tres corren en Node.js
(`runtime = 'nodejs'`, `force-dynamic`).

**`POST` y `GET /api/pagos/flow/registro`** (retorno del registro de tarjeta, `maxDuration
= 60`). El token sale de la query o del formulario (`leerTokenFlow`: `^[A-Za-z0-9._-]{1,200}$`).

| Caso | Respuesta |
|---|---|
| Sin token o con forma inválida | **303** a `/bienvenida` |
| Token válido, Flow sin configurar | **503** `{ "error": "pasarela_sin_configurar" }` |
| Procesado (con cualquier resultado) | **303** a `/<slug>/configuracion/plan?pago=<suscrita\|plan_cambiado\|tarjeta_actualizada\|tarjeta_rechazada\|en_proceso\|error>` |
| No se pudo identificar la organización, o excepción | **303** a `/bienvenida` (excepción a Sentry) |

**`POST /api/pagos/flow/confirmacion`** (callback de los planes, `maxDuration = 15`).

| Caso | Respuesta |
|---|---|
| Sin token o con forma inválida | **400** `{ "ok": false }` |
| Flow sin configurar | **503** `{ "ok": false }` |
| Token válido (procesado, repetido, ignorado, fallido o excepción) | **200** `{ "ok": true }`, `Cache-Control: no-store` |

**`POST` y `GET /api/cron/suscripciones`** (`maxDuration = 120`).

| Caso | Respuesta |
|---|---|
| Sin `CRON_SECRET` configurado | **503** `{ "error": "cron_sin_configurar" }` |
| Bearer ausente o distinto | **401** `{ "error": "no_autorizado" }` |
| Flow sin configurar | **503** `{ "error": "pasarela_sin_configurar" }` |
| Corrida terminada (aunque con errores por suscripción) | **200** con los conteos, `Cache-Control: no-store` |
| Excepción | **500** `{ "error": "suscripciones_fallidas" }` |

Ninguna devuelve datos del pago, de la tarjeta ni de la organización.

## Probar en el sandbox de Flow

**Todavía no se ha hecho.** Criterio de aceptación de la fase: cambiar de plan en el sandbox
actualiza `suscripciones` y los límites se aplican en la siguiente emisión.

Requisitos: las migraciones `0015` y `0016` aplicadas, las `FLOW_*` del sandbox cargadas y
la Fase 10 desplegada en *Production*. Conviene probar en el deploy de *Production* y no
desde `localhost`: Flow no puede llamar al callback de un equipo local, y el primer plan
que se crea en Flow guarda el `urlCallback` que tenga `NEXT_PUBLIC_APP_URL` en ese momento.

Tarjeta de prueba del sandbox de Flow:

| Dato | Valor |
|---|---|
| Número | `4051885600446623` |
| CVV | `123` |
| RUT (si lo pide) | `11111111-1` |
| Clave (si la pide) | `123` |

Recorrido:

1. Con una organización de prueba en Certificación y su propietario, abrir Configuración →
   Plan: «Tu plan» Certificación («Gratis»), las barras de uso y la grilla con Pyme, Contador
   y API.
2. «Cambiar a Pyme» → «Ir a Flow». Registrar la tarjeta de prueba en el sandbox.
3. Al volver: aviso «Tu suscripción quedó activa» (`?pago=suscrita`), «Tu plan» Pyme
   «Activa», con período y «Tarjeta … terminada en 6623», y un cobro en «Pagos». En la base:
   - `suscripciones`: la de Certificación `cancelada` con `periodo_fin`; una `pyme`/`activa`
     con `proveedor_pago = 'flow'`, `id_externo` y `sincronizada_en`;
   - `clientes_pago`: `cliente_externo`, `tarjeta_ultimos4 = '6623'` y `plan_pendiente_id`
     nulo;
   - `eventos_pasarela`: un `registro` `procesado` con `datos.resultado = 'suscrita'`;
   - `pagos`: el importe del primer mes.
4. En Flow (panel del sandbox o el MCP `flow` del repo, que apunta al sandbox), revisar con
   `plans/get` que `boleteame-pyme` cobra 14.990 y tiene el `urlCallback` de *Production*, y
   con `subscription/get` la suscripción.
5. «Cambiar a Contador»: el diálogo muestra el prorrateo; confirmar. La misma fila de
   `suscripciones` pasa a `plan_id` de `contador` (o queda programado, según Flow). Comprobar
   el cupo nuevo: `select codigo, max_boletas_mes from public.plan_vigente('<org>')` (como
   `postgres`) da `contador` y 10.000, y la barra de la página dice «de 10.000». La siguiente
   emisión en producción usa ese cupo; una emisión de producción es **real** (⚠️: sale al
   SII y usa un folio): hacerla solo con una empresa autorizada y con la decisión del usuario.
6. Callback: después de un cobro, una fila `pago` en `eventos_pasarela` (`procesado`) y
   200 en los logs de la ruta en Vercel.
7. Cron: después del minuto 41 (con la `0017` aplicada), `cron.job_run_details` `succeeded`,
   `net._http_response` con 200 y el monitor `cron-suscripciones` en verde.
8. «Cancelar la suscripción»: `cancelar_al_fin_periodo = true` y el aviso «Pedida. Rige
   hasta…». La vuelta a Certificación ocurre cuando Flow termine el período (o al cancelar
   de inmediato desde el panel de Flow y esperar la siguiente sincronización).
9. Limpiar: cancelar en Flow las suscripciones de prueba y comprobar que la organización
   quedó en Certificación.

La mora no se puede forzar fácil en el sandbox (hace falta un cobro que falle y que pasen los
7 días); el comportamiento de `activar_suscripcion` con una `morosa` lo cubre
`rls-fase10-pagos.sql` (11), y la lógica de `morose`, `suscripciones.test.ts` y
`flow-pasarela.test.ts`.
