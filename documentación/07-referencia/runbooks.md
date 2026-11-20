---
title: "Runbooks de operación"
description: "Qué hacer, paso a paso, ante los incidentes previstos: envío u operación incierta (código 6), caída o lentitud del SII (código 4), CAF agotado, verificación fallida (código 7), cron que no corre, Flow caído o cliente moroso, Resend caído, certificado vencido, secreto expuesto y restauración de la base. Cada uno con cómo te enteras, qué ve el cliente, diagnóstico de solo lectura y qué no hacer."
keywords: [runbook, incidente, incierto, código 6, Ya lo revisé, marcarInciertaRevisada, transporte, código 4, host_sii, /estado, SII caído, rahue, api.sii.cl, palena, herculesr, zeusr, CAF agotado, sin_folios, folios.por_agotarse, verificacion_fallida, código 7, cron caído, cron-seguimiento, net._http_response, cron.job_run_details, CRON_SECRET, cron_token, Flow, mora, morosa, suscripciones, Resend, notificaciones, certificado vencido, v_certificados_estado, secreto expuesto, rotación, Fase 13]
related: ["07-referencia/observabilidad-sentry.md", "07-referencia/respaldo-y-restauracion.md", "01-fundamentos/errores-y-resultados.md", "02-guias/seguimiento-envios.md", "02-guias/folios-caf.md", "02-guias/emision-boletas.md", "02-guias/planes-y-pagos.md", "07-referencia/trampas-conocidas.md"]
source: ["PLAN-SAAS.md §4.8, §10 y Fase 13", "apps/web/src/server/sii/operacion.ts", "apps/web/src/server/emision/emitir.ts", "apps/web/src/server/seguimiento/cron.ts", "apps/web/src/server/estado/index.ts", "apps/web/src/lib/estado.ts", "apps/web/src/server/folios/", "apps/web/src/server/cron/autorizacion.ts", "apps/web/src/app/api/cron/", "apps/web/src/server/pagos/suscripciones.ts", "apps/web/src/server/alertas/index.ts", "certificacion-node/docs/piloto-produccion.md"]
---

# Runbooks de operación

> **Úsalo cuando:** salta una alerta de Sentry, llega un correo de alerta o un cliente
> reporta un problema, y necesitas saber qué revisar y qué hacer (y qué no).

Reglas que valen para todos:

- **Las consultas de diagnóstico son de solo lectura** (SQL Editor o MCP `execute_sql`).
  Hay una sola base y es la de producción: ningún `update` ni `delete` a mano sin el OK del
  responsable y, si se puede, dentro de `begin … rollback` primero.
- **Nunca copies secretos** (tokens, cookies, `.pfx`, CAF, claves) a un ticket, a Sentry
  ni a un chat. Las consultas de abajo no los leen.
- **Una operación ⚠️ no se repite a ciegas.** Ante la duda, es un incierto
  ([regla](../01-fundamentos/errores-y-resultados.md#la-regla-del-incierto)).
- Las alertas de Sentry y su especificación están en
  [observabilidad](observabilidad-sentry.md). El estado público está en `/estado`.

| Incidente | Cómo te enteras | Gravedad |
|---|---|---|
| [Envío u operación incierta (6)](#envío-u-operación-incierta-código-6) | Sentry A2, correo «envío incierto», Tablero | alta: riesgo de duplicado |
| [Caída o lentitud del SII (4)](#caída-o-lentitud-del-sii-código-4) | Sentry M1, `/estado` | alta si dura y es en el envío |
| [CAF agotado](#caf-agotado) | correo y webhook `folios.por_agotarse`, error `sin_folios` | media: bloquea un tipo de una empresa |
| [Verificación fallida (7)](#verificación-fallida-código-7) | Sentry A3 | media |
| [Cron que no corre](#cron-que-no-corre) | Sentry A1, `/estado` (seguimiento) | alta si es el seguimiento |
| [Flow caído o cliente moroso](#flow-caído-o-cliente-moroso) | Sentry (`suscripciones: corrida con errores`), correo de mora | media |
| [Resend caído](#resend-caído) | correos que no llegan, `notificaciones` fallidas | media |
| [Certificado vencido](#certificado-vencido-o-por-vencer) | correos 30/15/7/1 días, error `config` | alta para esa empresa |
| [Secreto expuesto](#secreto-expuesto) | revisión, aviso de un proveedor | crítica |
| [Restaurar la base](respaldo-y-restauracion.md) | pérdida o corrupción de datos | crítica |

---

## Envío u operación incierta (código 6)

**Qué es.** La orden salió al SII y no se sabe si quedó hecha (red o 5xx después de enviar,
o un CAF timbrado que no se pudo guardar). **No se reintenta**: repetir puede duplicar una
boleta o timbrar folios dos veces. Detalle en
[errores y resultados](../01-fundamentos/errores-y-resultados.md#la-regla-del-incierto) y
[trampas](trampas-conocidas.md#regla-del-incierto).

**Cómo te enteras.**

- Sentry, alerta A2: mensaje `Operación SII <operacion> terminó en incierto`, etiquetas
  `organizacion`, `empresa`, `ambiente`, `operacion_sii`; el contexto `operacion_sii` trae
  `operacion_id`.
- Correo «envío incierto» a propietarios y administradores (`cron-alertas`,
  `server/alertas/`), y la `Alerta` del Tablero.
- El cliente vio «No sabemos si el SII recibió la boleta» al emitir, o en la API un
  documento `incierto` (o 409 `incierto_sin_revisar` al pedir folios).

**Qué ve el cliente.** La boleta queda «Por verificar» en Documentos emitidos; la pantalla
de Emitir se bloquea en esa pestaña hasta «Ya la revisé»; en Folios o Certificación, el
botón queda bloqueado con el aviso de la operación pendiente.

**Diagnóstico.**

```sql
-- La operación (id del contexto de Sentry)
select id, organizacion_id, empresa_id, operacion, ambiente, resultado, mensaje,
       detalle, envio_id, solicitud_id, documento_id, iniciada_en, terminada_en
from public.operaciones_sii
where id = '<operacion_id>';

-- Si es `emitir`: folio, tipo, empresa y Track ID (si alcanzó a llegar)
select em.rut, d.tipo_dte, d.folio, d.estado, d.mnt_total, e.id as envio_id, e.track_id,
       e.incierto, e.error, e.creado_en
from public.documentos d
join public.envios e on e.id = d.envio_id
join public.empresas em on em.id = d.empresa_id
where d.envio_id = '<envio_id>';

-- Todos los inciertos sin revisar (lo que muestra el Tablero)
select e.id, e.empresa_id, e.ambiente, e.creado_en, o.resultado,
       o.detalle->>'revisada_en' as revisada_en
from public.envios e
left join public.operaciones_sii o on o.envio_id = e.id and o.resultado in ('incierto', 'en_curso')
where e.incierto and e.proposito <> 'set_pruebas'
order by e.creado_en desc;
```

**Qué hacer, según la operación.**

1. **`emitir` (boleta por verificar).** Con el RUT, tipo y folio, revisar en el sitio del
   SII (Boleta electrónica → consulta de boletas emitidas, con el certificado de la
   empresa; producción en palena, certificación en maullin) si el folio quedó recibido. Si
   el error trae Track ID (el SII lo recibió pero no se pudo guardar), consultar ese Track
   ID en el SII.
   - **Llegó:** el cliente (o soporte con su acuerdo) pulsa «Ya lo revisé» en
     `/<org>/envios/<id>`. No hay que reemitir. El documento sigue `incierto` en la base
     (no se reescribe a mano).
   - **No llegó:** «Ya lo revisé» y emitir la venta de nuevo desde Emitir: usa otro
     folio. El folio dudoso queda tomado por el documento incierto (así no hay riesgo de
     duplicado). Boletéame no lo puede anular (`anular_folios` rechaza un folio con
     documento); si se confirma que nunca llegó, se anula en el portal del SII
     («Anulación de folios»), como en el piloto de la librería
     (`certificacion-node/docs/piloto-produccion.md`, «Envío incierto»).
   - Guía: [seguimiento](../02-guias/seguimiento-envios.md#envíos-inciertos-y-ya-lo-revisé)
     y [emisión](../02-guias/emision-boletas.md#boleta-por-verificar-incierta).
2. **`solicitar_folios`.** Revisar «Folios ya autorizados» en el portal del SII. Si se
   timbró un CAF, bajarlo y subirlo en Folios (resuelve la solicitud y marca la operación);
   si no, «Marcar como revisada». Con traslape, escribir a soporte antes
   ([folios](../02-guias/folios-caf.md#solicitud-incierta)).
3. **`postular`, `declarar`, `enviar_set`.** Consultar el estado en el asistente
   («Consultar el estado en el SII») o en el portal de certificación antes de repetir
   ([certificación](../02-guias/certificacion-empresa.md#operaciones-inciertas-y-cómo-revisarlas)).
4. **`en_curso` de más de 15 minutos** (la función murió): se trata igual que un incierto.
5. Al terminar, **resolver el issue en Sentry** para que el próximo incierto vuelva a
   avisar.

**No hacer.** Reemitir el mismo borrador ni pedir folios otra vez «para probar»; marcar
como revisada sin haber mirado el SII; cambiar `envios.incierto` o el estado del documento
a mano.

**Si se repiten** (varios inciertos en minutos, casi siempre `emitir`): es el SII cortando
la conexión en `rahue.sii.cl`. Seguir también el runbook de
[caída del SII](#caída-o-lentitud-del-sii-código-4).

---

## Caída o lentitud del SII (código 4)

**Qué es.** `transporte`: no hubo respuesta del SII (red, timeout, HTTP 5xx antes de
enviar). Es reintentable, salvo cuando la falla ocurre **después** de enviar una boleta:
ahí es incierto (`envioIncierto()` en `server/emision/emitir.ts`).

**Cómo te enteras.**

- Sentry, alerta M1 (`resultado:transporte has:host_sii ambiente:produccion`) y el widget
  por `host_sii` del tablero.
- `/estado`: la fila del SII de cada ambiente pasa a «Con demoras» (10 % o más de fallas
  en la última hora) o «Con problemas» (50 % o más, con al menos 3 fallas)
  (`server/estado/index.ts`, `lib/estado.ts`). Si además el seguimiento no consulta, su
  fila pasa a «Con problemas».
- Clientes que reportan «No pudimos comunicarnos con el SII».

**Qué ve el cliente, por host** (hosts en
[ambientes](../01-fundamentos/ambientes-y-credenciales.md)):

| Host (producción) | Qué falla | Qué ve |
|---|---|---|
| `api.sii.cl` | semilla y token REST, consulta de estado | Emitir: «No pudimos comunicarnos con el SII» **antes** de usar folio (el token va primero; uno vigente en caché, 50 min, evita la llamada). API: 503 `sii_no_disponible` con `Retry-After: 60`. El seguimiento atrasa los estados (backoff); no se pierde nada |
| `rahue.sii.cl` | envío de boletas | Fallas después de enviar → boletas **inciertas**. Un 4xx → boleta anulada y folio a `folios_anulados` (el SII no la recibió) |
| `palena.sii.cl` | timbraje de folios, consultas del portal | Pedir folios falla (`transporte`); si cae a mitad del timbraje, incierto |
| `herculesr.sii.cl`, `zeusr.sii.cl` | login AUT2000 | Folios y certificación fallan al autenticar |
| `apicert`, `pangal`, `maullin` | certificación | Solo empresas certificándose y pruebas |

Un `transporte` **sin** `host_sii` es `BloqueoOcupadoError`: otra operación con el mismo
certificado está en curso. No es el SII.

**Diagnóstico.**

```sql
-- Proporción por ambiente, operación y resultado en la última hora
select ambiente, operacion, resultado, count(*)
from public.operaciones_sii
where terminada_en > now() - interval '1 hour'
  and resultado in ('ok', 'rechazo_sii', 'transporte', 'incierto')
group by 1, 2, 3
order by 1, 2, 3;

-- Inciertos creados durante la ventana del incidente
select id, organizacion_id, empresa_id, operacion, ambiente, iniciada_en
from public.operaciones_sii
where resultado = 'incierto' and iniciada_en > now() - interval '6 hours'
order by iniciada_en;
```

En Sentry, el issue `Operación SII <op> terminó en transporte` → pestaña de etiquetas →
`host_sii`. Para descartar un bloqueo de las IP de Vercel (riesgo de §10 del plan),
comparar con el sitio del SII desde otra red o con `pnpm humo:tls` (solo certificación).

**Qué hacer.**

1. Confirmar si es general (muchos hosts, muchas organizaciones) o de un host. Revisar los
   avisos del SII en sii.cl.
2. No hay nada que reintentar a mano: el seguimiento vuelve a consultar solo y los clientes
   reintentan (la API ya responde `Retry-After`).
3. Si cae `rahue.sii.cl` y siguen entrando emisiones, cada una puede terminar incierta.
   Hoy no hay un interruptor para pausar la emisión (**pendiente**: modo mantenimiento);
   avisar a los clientes del piloto que esperen.
4. Al volver el SII: listar los inciertos de la ventana (SQL de arriba) y resolverlos con
   el [runbook del incierto](#envío-u-operación-incierta-código-6). Revisar que `/estado`
   vuelva a «Operativo».
5. Si el SII responde a otras redes y no a Vercel durante horas: escalar el plan B del
   riesgo de §10 (worker con IP fija en Chile).

**No hacer.** Reenviar boletas `incierto` ni «empujar» el seguimiento con muchas
consultas manuales (el SII puede frenar más).

---

## CAF agotado

**Qué es.** No quedan folios de un tipo (39 o 41) para una empresa en un ambiente:
`asignar_folio` responde `P0002` y la emisión termina en `config` (`sin_folios`), sin
salir al SII ([emisión](../02-guias/emision-boletas.md),
[folios](../02-guias/folios-caf.md#disponibilidad-y-umbral)).

**Cómo te enteras.** Correo `folios.por_agotarse` a propietarios y administradores al
cruzar el 15 % y al agotarse, más el webhook del mismo nombre
(`server/folios/alertas.ts`); el Tablero y la vista Folios («CAF agotado»); en la API, 422
`sin_folios`.

**Qué bloquea.** Solo la emisión de **ese** tipo para **esa** empresa en **ese** ambiente.
Lo demás sigue (otros tipos, consultas, seguimiento).

**Diagnóstico.**

```sql
select c.ambiente, c.tipo_dte, c.folio_desde, c.folio_hasta, c.siguiente_folio, c.estado,
       greatest(c.folio_hasta - c.siguiente_folio + 1, 0) as restantes, c.creado_en
from public.cafs c
where c.empresa_id = '<empresa_id>'
order by c.ambiente, c.tipo_dte, c.folio_desde;

select estado, confirmada, ambiente, tipo_dte, cantidad, folio_desde, folio_hasta, creado_en
from public.solicitudes_folios
where empresa_id = '<empresa_id>'
order by creado_en desc
limit 10;
```

**Qué hacer** (lo hace un administrador de la organización, en `/<org>/folios`; o la API
`POST /folios/solicitudes`):

1. Revisar que nada bloquee la solicitud: empresa activa y, en producción, autorizada; plan
   con producción; certificado vigente de un **representante electrónico**; sin una
   solicitud por verificar ni otra en curso
   ([qué bloquea](../02-guias/folios-caf.md#qué-bloquea-pedir-folios)).
2. «Preparar la solicitud» (ensayo) → **«Revisar con el SII»** (obligatoria en producción;
   vale 30 minutos y para un solo timbraje) → **«Timbrar N folios»** ⚠️. La cantidad es
   1–10.000; el SII fija el rango (la revisión lo muestra). El primer timbraje del tipo en
   el ambiente pide folio inicial.
3. Si el timbraje termina **incierto**, no repetir: [runbook del incierto](#envío-u-operación-incierta-código-6).
4. Alternativa: timbrar en el portal del SII y subir el CAF en «Subir un CAF».
5. Para que no vuelva a pasar: pedir con holgura al recibir el aviso del 15 %.

**No hacer.** Subir un CAF de otro ambiente o de otra empresa (la validación lo rechaza),
ni anular la cola de un CAF que todavía sirve.

---

## Verificación fallida (código 7)

**Qué es.** Una verificación no pasó: local (un TED que no calza con el CAF) o una
respuesta del SII que la librería no reconoce (`ConsultaAutorizacion`,
`SituacionTributaria`, portal GWT u `of_*` cambiado). Riesgo de §10 del plan: «Cambios del
portal del SII».

**Cómo te enteras.** Sentry, alerta A3 (`resultado:verificacion_fallida`, nivel `error`).

**Qué hacer.**

1. Ver en `operaciones_sii` la operación y su `detalle.error` (saneado):
   `select operacion, ambiente, mensaje, detalle from public.operaciones_sii where id = '<operacion_id>';`
2. Si es una página del SII que cambió: no reintentar en bucle; revisar si la librería
   (`packages/certificacion`, de `certificacion-node`) tiene una versión que lo cubra, y
   avisar a los clientes afectados (solo usan esa operación: verificar autorización,
   certificación o folios).
3. Si es un TED que no calza: detener la emisión de esa empresa y revisar el CAF (`sii
   util verificar-ted`); puede ser un CAF cargado en el ambiente equivocado.
4. Resolver el issue de Sentry al terminar.

---

## Cron que no corre

**Qué es.** pg_cron (Supabase) llama a `/api/cron/*` con `Authorization: Bearer
<cron_token>` (= `CRON_SECRET`). Cada ruta reporta un check-in a su *cron monitor*
(`server/cron/autorizacion.ts`).

| Monitor | Job de pg_cron | Cada | Si se detiene |
|---|---|---|---|
| `cron-seguimiento` | `seguimiento-envios` | 5 min | los estados del SII no se actualizan (no se pierde nada; se pone al día al volver) |
| `cron-alertas` | `alertas` | 10 min | no salen correos de rechazo, incierto ni certificado (los candidatos se miran en una ventana de 48 h: un corte más largo pierde avisos) |
| `cron-webhooks` | `entregar-webhooks` | 1 min | las entregas se acumulan en `webhook_entregas` (salen al volver, con sus 8 intentos) |
| `cron-suscripciones` | `sincronizar-suscripciones` | hora (min 41) | mora y cancelaciones de Flow no se aplican (el plan sigue como estaba) |

**Cómo te enteras.** Sentry, alerta A1 (corrida perdida o fallida); `/estado` muestra el
seguimiento «Con problemas» si hay envíos atrasados y ninguna corrida `ok` en 60 minutos.

**Diagnóstico.**

```sql
select jobname, schedule, active from cron.job order by jobname;

select j.jobname, d.status, d.return_message, d.start_time
from cron.job_run_details d join cron.job j using (jobid)
order by d.start_time desc
limit 20;

select id, status_code, timed_out, error_msg, created, left(content, 200) as respuesta
from net._http_response
order by created desc
limit 20;
```

| Lo que ves | Causa | Arreglo |
|---|---|---|
| `status_code` 401 | `cron_token` (Vault) ≠ `CRON_SECRET` (Vercel) | igualarlos y redesplegar ([dónde vive cada uno](../01-fundamentos/ambientes-y-credenciales.md#dónde-vive-cada-secreto)) |
| 503 `cron_sin_configurar` | falta `CRON_SECRET` en Vercel *Production* | cargarla y redesplegar |
| 503 `pasarela_sin_configurar` (solo suscripciones) | faltan las `FLOW_*` | cargarlas y redesplegar |
| 404 | ruta no desplegada o URL del job distinta de `https://boleteame.dev` | revisar el deploy y `cron.job.command` |
| 500 o `timed_out` | falla de la ruta (ver Sentry) o tiempo excedido | ver el issue de Sentry de esa hora |
| sin filas nuevas en `job_run_details` | job inactivo o borrado (p. ej. después de una restauración) | re-crear con su migración (`0014`, `0017`, `0019`) — es una escritura: con OK |
| check-ins `ok` pero monitor rojo por tiempo | la corrida pasó `max_runtime` | revisar volumen (seguimiento tiene presupuesto de 280 s) |

Para correr una ruta a mano (el mismo efecto que el job; no imprimas el secreto):
`curl -X POST https://boleteame.dev/api/cron/seguimiento -H "Authorization: Bearer $CRON_SECRET"`
(responde solo conteos).

---

## Flow caído o cliente moroso

**Flow caído.** Contratar o cambiar de plan falla con un mensaje de error; los callbacks
pueden no llegar; la corrida horaria cuenta `errores` y avisa a Sentry `suscripciones:
corrida con errores` (etiqueta `cron: cron-suscripciones`). Una suscripción que no se pudo
leer **no cambia de estado** (`sincronizarTodas`, `server/pagos/suscripciones.ts`): los
clientes siguen emitiendo. Al volver Flow, la corrida siguiente repara lo que faltó
(también lo perdido en el callback). Qué hacer: esperar, revisar el estado de Flow y, si el
corte fue largo, comprobar que `sincronizada_en` se puso al día:

```sql
select organizacion_id, estado, plan_id, sincronizada_en, periodo_fin
from public.suscripciones
where proveedor_pago = 'flow' and estado in ('activa', 'morosa')
order by sincronizada_en nulls first;
```

**Cliente moroso.** Flow marca `morose = 1` después de los reintentos (7 días) → la
suscripción pasa a `morosa` → `plan_vigente()` devuelve `null` y **la emisión se bloquea**
(cuota de la base); los administradores reciben el correo de mora y ven «Pagar $ X en
Flow» en Configuración → Plan ([planes y pagos](../02-guias/planes-y-pagos.md#sincronización-y-mora)).
Qué hacer: el cliente paga con el enlace; la corrida siguiente (cada hora) la vuelve a
`activa`. No cambiar la suscripción a mano salvo acuerdo comercial; si hay que hacerlo, es
`activar_suscripcion` con `service_role`, que queda registrado.

---

## Resend caído

| Qué depende de Resend | Qué pasa |
|---|---|
| Correos de Supabase Auth (SMTP personalizado): confirmación, recuperación, cambio de correo | no llegan; el usuario no puede confirmar ni recuperar la clave |
| Invitaciones | la invitación queda creada y el enlace se muestra una vez al administrador para compartirlo por otro canal (`app/[org]/configuracion/equipo/acciones.ts`); también se puede reenviar después |
| Alertas (rechazo, incierto, certificado) y mora | `notificaciones` reintenta hasta 5 veces; después queda `fallida` y **no se reintenta** |
| Folios por agotarse | solo un aviso en consola (no usa `notificaciones`) |
| PDF al receptor después de emitir | la emisión queda `ok` con aviso; se puede reenviar desde el panel |
| Formulario de `/contacto` | «No pudimos enviar tu mensaje» y aviso a Sentry `contacto: no se pudo enviar el mensaje` |

Qué hacer: revisar el estado de Resend; al volver, listar lo que quedó sin enviar y avisar
a mano lo importante (un incierto o un rechazo):

```sql
select tipo, clave, estado, intentos, error, actualizado_en
from public.notificaciones
where estado <> 'enviada'
order by actualizado_en desc
limit 50;
```

---

## Certificado vencido o por vencer

**Cómo te enteras.** Correos a los 30, 15, 7 y 1 días (`cron-alertas`, desde
`v_certificados_estado`); `Alerta` en Configuración → Certificados.

**Qué bloquea.** Con el certificado vencido, toda operación con el SII de esa empresa
termina en `config` («El certificado está vencido»): emitir, pedir folios, certificación y
también el token del **seguimiento**, así que los estados de sus boletas dejan de
actualizarse. Pedir folios exige además que sea de un representante electrónico.

**Diagnóstico.**

```sql
select v.*
from public.v_certificados_estado v
where v.dias_restantes is not null and v.dias_restantes <= 30
order by v.dias_restantes;
```

**Qué hacer.** El cliente renueva con su entidad certificadora, sube el `.pfx` nuevo en
Configuración → Certificados y lo asocia a la empresa como predeterminado
([onboarding](../02-guias/onboarding-organizacion.md)). Los tokens y sesiones guardados
del certificado anterior no se reutilizan (la clave incluye la huella).

---

## Secreto expuesto

Si un secreto pudo haberse filtrado (commit, captura, log): rotarlo de inmediato, en este
orden de gravedad, y anotar fecha y alcance.

| Secreto | Dónde rotarlo | Notas |
|---|---|---|
| `SUPABASE_SECRET_KEY` (`sb_secret_…`) | Supabase → *API Keys*: crear una nueva, cargarla en Vercel, redesplegar y borrar la vieja | salta RLS: es el más grave |
| `.pfx` o clave de un cliente | el cliente revoca el certificado con su entidad y sube uno nuevo | avisar al cliente |
| `SII_TOKENS_KEY` | [respaldo y restauración](respaldo-y-restauracion.md#rotación-de-sii_tokens_key) | sin caída |
| `CRON_SECRET` / `cron_token` | Vault y Vercel a la vez, redesplegar | ver [cron](#cron-que-no-corre) |
| `FLOW_API_KEY` / `FLOW_SECRET_KEY` | panel de Flow, Vercel, redesplegar | las tres `FLOW_*` del mismo ambiente |
| `RESEND_API_KEY`, `TURNSTILE_SECRET_KEY` | panel del proveedor, Vercel (Turnstile también en Supabase Auth), redesplegar | |
| Secreto de un webhook | el cliente lo rota en Configuración → Webhooks | |
| API key de un cliente | el cliente la revoca en Configuración → API | se guarda solo su SHA-256 |

Después: revisar Sentry y los logs de Vercel por accesos raros, y anotar el incidente en el
registro del piloto (el criterio de la Fase 13 es «sin incidentes de seguridad»).
