---
title: "Errores, resultados de operación y la regla del incierto"
description: "Jerarquía de errores de la librería, resultado_operacion, códigos de salida de la CLI, qué ve el usuario, qué llega a Sentry y el bloqueo de reintento por incierto."
keywords: [resultado_operacion, codigoDeError, resultadoDeError, CODIGO_DE_RESULTADO, ejecutarOperacion, ResultadoEjecucion, ejecutada, motivo, sesion_invalida, incierto_sin_revisar, en_curso, sin_registro, marcarInciertaRevisada, revisada_en, revisada_por, abandonada, MINUTOS_EN_CURSO_ABANDONADA, OPERACIONES_QUE_GRABAN, OPERACIONES_EFECTO_GLOBAL, confirmada, ensayo, getUser, confirmarSesion, SiiError, ErrorTransporte, ErrorRespuestaSii, ErrorSolicitudFolios, SesionCaducaError, FolioInicialRequeridoError, FoliosSinCafError, ErrorPostulacion, DeclaracionInciertaError, SetSinDescargarError, ErrorCertificado, ErrorUso, ErrorConfig, ErrorVerificacion, ErrorIncierto, ErrorCredenciales, BloqueoOcupadoError, mensajeParaUsuario, detalleSeguro, sanearTexto, sanearDetalle, Sentry, ErrorRegistroOperacion, host_sii, carrera, doble timbraje, operaciones_sii_efecto_global_en_curso, 23505, control previo, control posterior, uso]
related: ["04-objetos/objetos-auditoria-e-integraciones.md", "09-libreria/backend-service-role.md", "01-fundamentos/autenticacion-sii.md", "07-referencia/trampas-conocidas.md", "04-objetos/codigos-y-enumeraciones.md", "08-esquema-supabase/solucion-de-problemas.md"]
source: ["supabase_saas_sii.sql §1 §13", "apps/web/src/server/sii/errores.ts", "apps/web/src/server/sii/operacion.ts", "supabase/migrations/0007_bloqueos_sii.sql", "packages/certificacion/apps/cli/src/errores.ts", "packages/certificacion/packages/core/src/comun/errores.ts", "PLAN-SAAS.md §2 §4.8 (Fase 4)"]
---

# Errores, resultados de operación y la regla del incierto

> **Úsalo cuando:** necesitas decidir si reintentar o interpretar un error.

Toda llamada al SII pasa por `ejecutarOperacion()` (`apps/web/src/server/sii/operacion.ts`),
que deja una fila en `operaciones_sii` y cierra con un `resultado` del enum
`resultado_operacion`. Ese resultado **equivale al código de salida de la CLI `sii`
(0–7)**: `resultadoDeError()` de `server/sii/errores.ts` tiene paridad exacta con
`codigoDeError()` de `packages/certificacion/apps/cli/src/errores.ts`, y `errores.test.ts`
lo comprueba error por error (PLAN-SAAS §2, principios 3 y 5).

## `resultado_operacion` y los códigos de la CLI

| `resultado` | Código CLI | Significado | ¿Salió algo al SII? | ¿Reintentar? |
|---|---|---|---|---|
| `en_curso` | — | fila abierta, la operación todavía corre (o la función murió) | quizás | no: ver [abandonada](#en_curso-abandonada) |
| `ok` | 0 | terminó bien | sí | — |
| `error` | 1 | no clasificado: dato que no cumple las reglas del SII, firma, timbre, falla de Supabase, un bug | depende | revisar antes |
| `uso` | 2 | faltan datos o no son válidos | **no** | corrigiendo los datos |
| `config` | 3 | falta o no sirve el certificado, la resolución, el CAF o algo de la empresa | **no** | corrigiendo la configuración |
| `transporte` | 4 | falla de red o HTTP inesperado; también el certificado ocupado por otra operación | nada irreversible: en folios y declaración la librería lo lanza solo **antes** del paso irreversible (después lanza un error incierto), y el certificado ocupado no llegó a salir | **sí**, en unos minutos |
| `rechazo_sii` | 5 | el SII respondió y rechazó, o devolvió algo que no se entiende | sí, y lo rechazó | corrigiendo la causa |
| `incierto` | 6 | llegó al SII y **no se sabe** si quedó hecho | sí | **no, a ciegas**: revisar en el SII |
| `verificacion_fallida` | 7 | una verificación local no pasó (p. ej. un TED que no calza con el CAF) | depende de la operación | corrigiendo la causa |

`CODIGO_DE_RESULTADO` (exportado por `errores.ts`) es esa tabla en código; `ResultadoFinal`
es el enum sin `en_curso`. La columna lleva la misma tabla como comentario en la base
(`comment on column public.operaciones_sii.resultado`).

## Error → resultado → qué ve el usuario → Sentry

`resultadoDeError(error)` revisa en este orden (los errores de la app van primero; no se
cruzan con los de la librería). La columna «Qué ve el usuario» es el `titulo` de
`mensajeParaUsuario()`; el `detalle` es el `message` del error (ya escrito para el
usuario, igual pasa por `sanearTexto()`) más el cierre de la última columna de la tabla
siguiente.

| Error | Origen | `resultado` | Código | Qué ve el usuario | Sentry |
|---|---|---|---|---|---|
| `ErrorUso` | app (`errores.ts`) | `uso` | 2 | «Faltan datos para la operación» | breadcrumb `warning` |
| `ErrorConfig` | app | `config` | 3 | «Falta configurar algo antes de operar con el SII» | breadcrumb `warning` |
| `ErrorVerificacion` | app | `verificacion_fallida` | 7 | «La verificación no pasó» | evento `error` |
| `ErrorIncierto` | app | `incierto` | 6 | «No sabemos si el SII completó la operación» | evento `error` |
| `ErrorCredenciales` | `credenciales.ts` | `config` (motivo `base`: `error`) | 3 (1) | su propio `mensaje` (p. ej. «El certificado está vencido» + qué hacer) | breadcrumb `warning` (`error`: excepción) |
| `BloqueoOcupadoError` | `bloqueos.ts` | `transporte` | 4 | su propio `mensajeUsuario`: «Hay otra operación con el SII en curso con este certificado» | evento `warning`, sin `host_sii` |
| `ErrorCertificado` | librería | `config` | 3 | «Falta configurar algo…» | breadcrumb `warning` |
| `DeclaracionInciertaError`, `FoliosSinCafError` | librería | `incierto` | 6 | «No sabemos si el SII completó la operación» + la instrucción del error (revisar «Folios ya autorizados» / consultar P90–P91) | evento `error` |
| `ErrorTransporte` | librería | `transporte` | 4 | «No pudimos comunicarnos con el SII» | evento `warning` con etiqueta `host_sii` |
| `ErrorRespuestaSii`, `ErrorPostulacion` (y `SetSinDescargarError`), `ErrorSolicitudFolios` (y `SesionCaducaError`, `FolioInicialRequeridoError`) | librería | `rechazo_sii` | 5 | «El SII rechazó la operación» | breadcrumb `warning` |
| `ErrorValidacion`, `ErrorFirma`, `ErrorTimbre` (otros `SiiError`) | librería | `error` | 1 | «No pudimos completar la operación» + su mensaje | excepción `error` (saneada) |
| `ErrorTokenStore`, `ErrorSesiones`, `ErrorBloqueo`, `ErrorAlmacen`, cualquier otro | capa SII / desconocido | `error` | 1 | genérico: «No pudimos completar la operación. Ocurrió un error inesperado y quedó registrado…» | excepción `error` (saneada) |

Cierre que se agrega al `detalle` según el resultado (si el mensaje no lo trae ya; los
mensajes propios de `ErrorCredenciales` y `BloqueoOcupadoError` van tal cual, sin cierre):

| `resultado` | Cierre |
|---|---|
| `uso`, `config` | «No se envió nada al SII.» |
| `transporte` | «Puedes reintentar en unos minutos.» |
| `incierto` | «No la repitas hasta revisar en el SII si quedó hecha.» |

Notas:

- Los errores de otros módulos de la capa SII (`ErrorCredenciales`, `BloqueoOcupadoError`)
  se reconocen **por `name` y por su forma**, sin importarlos. Si traen su propio
  `MensajeError` (`mensaje` o `mensajeUsuario`), se muestra ese; si traen `resultado`
  válido (`ErrorCredenciales.resultado`), manda sobre el de la tabla.
- Un error desconocido **nunca** muestra su `message` (podría traer cualquier cosa):
  ve el texto genérico. Un objeto cualquiera con forma de `MensajeError` tampoco se
  muestra.
- `FolioInicialRequeridoError` queda en `rechazo_sii` por paridad con `codigoDeError()`,
  aunque el comando `solicitar-folios` de la CLI lo atrapa y devuelve 3 (ver
  [trampas](../07-referencia/trampas-conocidas.md#capa-de-servicio-sii-fase-4)).
- Un rechazo que detecta la app (no la librería) se lanza como `ErrorRespuestaSii`: así
  hay un solo camino de traducción.
- `ErrorIncierto` cubre los dos casos en que la CLI devuelve 6 sin error de la librería:
  el CAF se timbró pero no se pudo guardar, y no se sabe si una boleta de `emitir` llegó
  (sin Track ID).

### Qué llega a Sentry

`registrarEnSentry()` (implementación por defecto de `registrar`) usa `@sentry/nextjs`, que
además depura en `beforeSend`
([qué filtra](../08-esquema-supabase/vault-y-secretos.md#sentry-appswebsrclibsentrydepurarts)).

| Resultado | Tipo | Nivel |
|---|---|---|
| `ok` | breadcrumb (`category: 'operacion_sii'`) | `info` |
| `uso`, `config`, `rechazo_sii` | breadcrumb | `warning` |
| `transporte` | `captureMessage` con etiqueta `host_sii` (solo el host, sin ruta ni query) | `warning` |
| `incierto`, `verificacion_fallida` | `captureMessage` | `error` |
| `error` | `captureException` con una **copia saneada** del error | `error` |
| no ejecutada (sesión inválida, incierto pendiente, otra en curso, choque 23505, control posterior) | breadcrumb | `warning` |
| no ejecutada por `uso` (operación de efecto global sin empresa: bug de quien llama) | `captureException` de un `ErrorUsoOperacion` | `error` |
| falla de `operaciones_sii` (consultar, insertar, cerrar) | `captureException` de un `ErrorRegistroOperacion` + `console.error` con solo el código | `error` |

- Etiquetas: `organizacion`, `empresa` (si hay), `ambiente`, `operacion_sii`, `resultado`.
  Usuario **solo por id**. Contexto `operacion_sii`: `operacion_id`, `confirmada`, `canal`
  y el `detalleSeguro()` del error.
- Los `captureMessage` llevan *fingerprint* `['operacion_sii', <operacion>, <resultado>]`:
  todos los `incierto` de `solicitar_folios` se agrupan en un issue, separados de los de
  `declarar`. El mensaje es `Operación SII <operacion> terminó en <resultado>`.
- La copia saneada de un `error` lleva `name` y `message` pasados por `sanearTexto()`,
  los marcos `at …` del stack y **nunca `cause`**.
- Si `registrar` lanza, se ignora: Sentry nunca tapa el resultado.

Alertas previstas en PLAN-SAAS §4.8 (se configuran en Sentry, no en el código): tasa de
`transporte` por `host_sii`, cualquier `incierto`, cualquier `verificacion_fallida`.

## `ejecutarOperacion`: los pasos

```ts
ejecutarOperacion<T>(ctx: ContextoOperacion, fn: (h: HerramientasOperacion) => Promise<T>)
  : Promise<ResultadoEjecucion<T>>
```

Firma completa y ejemplo en
[contrato del backend](../09-libreria/backend-service-role.md#operacionts-ejecutaroperacion).

0. **Empresa obligatoria.** Una operación de `OPERACIONES_EFECTO_GLOBAL` sin `empresaId`
   (confirmada o ensayo) no inserta ni llama a `fn`: `motivo: 'uso'` («Falta la empresa de
   la operación… No se envió nada al SII.») y excepción en Sentry. En un índice único los
   NULL no chocan: sin empresa, el paso 3 no la protegería.
1. **Sesión viva.** Si `confirmada`, hay `usuarioId` y la operación está en
   `OPERACIONES_QUE_GRABAN`, confirma la sesión con `getUser()` (ver
   [getUser](#getuser-antes-de-las-operaciones-)). Si no pasa (o `confirmarSesion` lanza):
   no inserta fila ni llama a `fn`; `motivo: 'sesion_invalida'`.
2. **Control previo** (efecto global confirmada). Mira la última fila confirmada de la
   misma organización, empresa, operación y ambiente que pudo llegar al SII (ver
   [regla del incierto](#la-regla-del-incierto)); si bloquea, no inserta. Si no puede
   consultarla: `motivo: 'sin_registro'`. No basta contra la
   [carrera](#carrera-entre-dos-peticiones-iguales); está para no dejar filas que nacen
   bloqueadas (ni avisos de Realtime) en el caso común.
3. **Fila `en_curso`.** Inserta en `operaciones_sii` (`iniciada_en` la pone la base). **Sin
   fila no se llama al SII**: si el `insert` falla, `motivo: 'sin_registro'` («No pudimos
   registrar la operación. No se envió nada al SII…»). Si falla con `23505` (el índice
   único de la 0007: otra igual entró primero), no ejecuta: `motivo: 'en_curso'` apuntando a
   la otra fila, o `incierto_sin_revisar` si esa otra está abandonada.
4. **Control posterior** (efecto global confirmada). Repite el control del paso 2 sin
   contar la fila propia. Si encuentra un `incierto` sin revisar (apareció entre el paso 2 y
   el 3), cierra la fila propia como `uso` con `detalle.motivo` y `operacion_pendiente_id`,
   y no ejecuta.
5. **Ejecuta `fn`.** Todo lo que no sea `ok` tiene que **lanzar**. `fn` recibe
   `{ operacionId, agregarDetalle }`; lo que se pasa a `agregarDetalle` pasa por
   `sanearDetalle()`.
6. **Cierra la fila** con `resultado`, `mensaje` (una línea: `titulo. detalle`), `detalle`
   (lo acumulado + `error: detalleSeguro(error)`) y `terminada_en`. Si el cierre falla, se
   reporta a Sentry y a la consola, pero **manda el resultado de la operación**: la fila
   queda `en_curso` y, pasados 15 min, cuenta como abandonada.
7. **Sentry** según la tabla de arriba.

`ejecutarOperacion` **nunca lanza** por un error de la operación. Devuelve:

| Forma | Cuándo |
|---|---|
| `{ ok: true, valor, operacionId }` | `fn` terminó |
| `{ ok: false, ejecutada: true, resultado, mensaje, operacionId }` | `fn` lanzó; `resultado` es uno de los 7 que no son `ok` |
| `{ ok: false, ejecutada: false, motivo, mensaje, operacionId, operacionPendienteId? }` | no se llamó a `fn`. `operacionId` es `null` si no se insertó fila, o el id de la fila propia si la bloqueó el control posterior (paso 4; queda cerrada como `uso`) |

| `motivo` | Causa | Mensaje (`titulo`) |
|---|---|---|
| `uso` | operación de efecto global sin `empresaId` (paso 0) | «Falta la empresa de la operación» |
| `sesion_invalida` | `getUser()` no confirmó la sesión | «Tu sesión ya no es válida» (`MENSAJE_SESION_INVALIDA`) |
| `incierto_sin_revisar` | la anterior quedó `incierto` (o abandonada) y nadie la revisó (paso 2, 3 o 4) | «Hay una operación anterior sin confirmar en el SII» + cómo revisar |
| `en_curso` | hay otra igual en curso desde hace menos de 15 min (paso 2), o el insert chocó con el índice único (paso 3) | «Ya hay una operación igual en curso» |
| `sin_registro` | no se pudo consultar o insertar en `operaciones_sii` | «No pudimos registrar la operación» |

`operacionPendienteId` (en `incierto_sin_revisar` y `en_curso`) es el id de la fila que
bloquea, para enlazar la acción «Marcar como revisada». Falta solo cuando el insert chocó
(23505) y la otra fila ya terminó antes de poder leerla.

## Ensayo y confirmada

`ContextoOperacion.confirmada` equivale a pasar `--confirmar` en la CLI:

| | `confirmada: false` (ensayo) | `confirmada: true` |
|---|---|---|
| Qué hace `fn` | valida y arma lo que haría, **sin grabar en el SII** (lo decide `fn`) | ejecuta de verdad |
| Fila en `operaciones_sii` | sí, con `confirmada = false` | sí, con `confirmada = true` |
| `getUser()` | no | sí, si hay persona y la operación graba |
| Bloqueo por incierto | no (ni se consulta ni bloquea a otros) | sí, en las de efecto global |

`ejecutarOperacion` no sabe qué hace `fn`: la responsabilidad de no grabar nada en un
ensayo es de quien escribe `fn` (con la librería, el equivalente a no pasar
`--confirmar`). Toda operación ⚠️ tiene ensayo y confirmación explícita (principio 3).

**El asistente de certificación (Fase 5) no usa esta columna de la tabla.** Sus ensayos no
llaman a `ejecutarOperacion`: validan en la base y devuelven `{ tipo: 'ensayo', resumen }`
**sin salir al SII y sin fila** en `operaciones_sii` (como la CLI sin `--confirmar`, que
tampoco registra nada). Solo las confirmadas pasan por `ejecutarOperacion`
([guía](../02-guias/certificacion-empresa.md#ensayo-y-confirmación)).

`OPERACIONES_QUE_GRABAN` (⚠️): `postular`, `descargar_set`, `solicitar_folios`,
`enviar_set`, `solicitar_revision`, `declarar`, `enviar_rcof`, `emitir`. El resto del
enum `operacion_sii` (`autenticar`, `obtener_token`, `estado_envio`, `verificar_portal`,
`estado_declaracion`, `consultar_envio`, `seguimiento`) es de lectura 🔁. También lo será
`verificar_autorizacion`, previsto en la migración `0010_verificar_autorizacion`.

## `getUser()` antes de las operaciones ⚠️

`getClaims()` verifica el JWT localmente y no se entera de una sesión revocada, un usuario
baneado o borrado hasta el `exp` (≤ 1 h,
[sesiones y revocación](ambientes-y-credenciales.md#sesiones-de-usuario-y-revocación)).
Por eso el paso 1 llama a `confirmarSesion(usuarioId)` de
`server/certificados/acceso.ts`, que hace `supabase.auth.getUser()` con el cliente de
cookies (le pregunta a Auth) y exige que el usuario devuelto sea `usuarioId`.

- Solo aplica con `confirmada: true`, `usuarioId` no nulo y operación ⚠️.
- **Cron y API pública** (`usuarioId: null`, con `apiKeyId` en la API) no pasan por
  `getUser()`: no hay sesión de navegador. La API valida su clave por su cuenta (Fase 11).
- Si falla, no se inserta fila: la operación no existió.

## La regla del incierto

`incierto` (código 6) significa que la orden llegó al SII y no se sabe si quedó hecha.
Repetirla a ciegas puede quemar otro rango de folios o duplicar una postulación.

**Qué bloquea.** Solo las operaciones de `OPERACIONES_EFECTO_GLOBAL`:
`solicitar_folios`, `postular` y `declarar` (siempre con empresa). Antes de una
confirmada, y otra vez después de insertar la fila propia, se busca la **última** fila con
`confirmada = true` de la misma **organización + empresa + operación + ambiente** que pudo
llegar al SII: se saltan `uso` y `config` (nada salió), así la fila que cierra el control
posterior no tapa el `incierto` que la bloqueó. Si esa fila:

| Estado de la última fila | Resultado |
|---|---|
| no existe, o tiene `detalle.revisada_en` | se ejecuta |
| `incierto` | `motivo: 'incierto_sin_revisar'` |
| `en_curso` desde hace ≤ 15 min | `motivo: 'en_curso'` |
| `en_curso` desde hace más de 15 min | abandonada: `motivo: 'incierto_sin_revisar'` |
| cualquier otro resultado | se ejecuta |

Solo cuenta la última: si después de un `incierto` hubo un `ok` (alguien lo repitió tras
revisarlo), ya no bloquea. Certificación y producción son independientes, igual que dos
empresas de la misma organización.

`emitir` **no** se bloquea aquí: su incierto es por documento (`envios.incierto`, Fase 7).

`enviar_set` (Fase 5) tampoco se bloquea aquí: lo bloquea el asistente con
`bloqueoEnvioSet` (`server/certificacion/operaciones.ts`), que aplica la misma tabla de
arriba (sin revisar: `incierto` o `en_curso` abandonada → `incierto_sin_revisar`;
`en_curso` reciente → `en_curso`) al último `enviar_set` confirmado de la empresa, antes
del ensayo y de la confirmación. No hay índice único: la carrera la cierra el bloqueo del
certificado, dentro del cual se repite el control
([trampa](../07-referencia/trampas-conocidas.md#envío-del-set)).

El mensaje dice cómo revisar según la operación (fecha en formato `13-11-2026 14:30`):

| Operación | Cómo revisar |
|---|---|
| `solicitar_folios` | revisar «Folios ya autorizados» en el portal del SII y, si se timbraron, bajar el CAF desde ahí en vez de volver a pedirlos |
| `postular` | revisar en el portal de certificación si la postulación quedó registrada |
| `declarar` | consultar el estado de la declaración (P91 autorizada: no repetir; P90: se puede volver a declarar) |

El asistente de certificación muestra además su propio texto de qué revisar por operación
(`comoRevisar` de `app/[org]/certificacion/logica.ts`), en el aviso y en el diálogo de
«Marcar como revisada» ([guía](../02-guias/certificacion-empresa.md#operaciones-inciertas-y-cómo-revisarlas)).

### Carrera entre dos peticiones iguales

Consultar la última fila e insertar la propia no es atómico: dos `solicitar_folios`
simultáneas (doble clic, dos pestañas, un cron y una persona) pasarían las dos el control
previo, y el bloqueo del certificado solo las pondría en fila: la segunda timbraría otro
rango al soltarse (doble timbraje). Lo cierran dos piezas:

| Pieza | Qué cubre |
|---|---|
| Índice único parcial `operaciones_sii_efecto_global_en_curso` (migración 0007) sobre `(empresa_id, operacion, ambiente)` `where resultado = 'en_curso' and confirmada and operacion in ('solicitar_folios', 'postular', 'declarar')` | dos iguales **en curso a la vez**: el insert de la segunda falla con 23505 y no se ejecuta (`motivo: 'en_curso'`) |
| Control posterior (paso 4) | la primera **ya terminó en `incierto`** (y soltó el índice) entre el control previo y el insert de la segunda: la segunda cierra su fila como `uso` y no se ejecuta (`motivo: 'incierto_sin_revisar'`) |

Con la fila propia `en_curso`, ninguna otra igual puede entrar: toda otra fila de la llave
terminó antes, así que el control posterior no necesita comparar fechas con la propia.

La lista del predicado es `OPERACIONES_EFECTO_GLOBAL`: si cambia una, cambia la otra (con
una migración nueva) y las comprobaciones 13–14 de `verificaciones/0007_bloqueos_sii.sql`.
Los ensayos, las demás operaciones y las filas cerradas no entran al índice; los NULL de
`empresa_id` no chocan (por eso el paso 0). Comportamiento probado en
`verificaciones/rls-fase4-bloqueos.sql` (17–21) y en `operacion.test.ts` (el cliente falso
imita el índice).

### `en_curso` abandonada

`MINUTOS_EN_CURSO_ABANDONADA = 15`. Una fila `en_curso` más vieja que eso quedó así porque
la función murió a mitad de camino (el máximo de Vercel es 800 s) o porque falló el
cierre. Se trata como `incierto`: no se sabe si el SII alcanzó a hacerla. La fila
**no cambia sola** en la base; sigue `en_curso` (y ocupa el índice único: un insert igual
choca con 23505 y recibe `incierto_sin_revisar` con su id) hasta que alguien la marca como
revisada, lo que la pasa a `incierto` y la saca del índice.

### `marcarInciertaRevisada`

```ts
marcarInciertaRevisada(
  cliente: ClienteServicio,
  datos: { organizacionId: string; operacionId: string; usuarioId: string },
  reloj?: () => Date,
): Promise<{ ok: true } | { ok: false; mensaje: MensajeError }>
```

- Lee la fila filtrando por `id` **y** `organizacion_id` (una de otra organización: «No
  encontramos la operación»).
- Solo acepta `incierto` o una `en_curso` abandonada. Cualquier otra: «Esta operación no
  necesita revisión». Una `en_curso` de menos de 15 min tampoco se puede marcar.
- Agrega a `detalle` (sin borrar lo que había) `revisada_en` (ISO) y `revisada_por`
  (id del usuario). Si estaba abandonada, además `abandonada: true`, y pasa la fila a
  `resultado = 'incierto'` con `terminada_en` y el mensaje «La operación quedó sin
  terminar y no se sabe si el SII la completó. Se marcó como revisada.».
- ⚠️ **No verifica membresía ni rol**: usa `service_role`. Quien la llama (la Server
  Action de las Fases 5 y 6) tiene que haber comprobado antes que el usuario es miembro
  de la organización y tiene el rol para repetir esa operación. Marcar como revisada es
  lo que desbloquea un reintento que puede quemar folios.

## Qué se guarda de un error (y qué nunca)

`detalleSeguro(error)` arma `operaciones_sii.detalle.error` solo con campos tipados:

| Error | Campos |
|---|---|
| cualquiera | `nombre` (`error.name`; si no es `Error`, el `typeof`) |
| `ErrorTransporte` | `status` (o `null`) y `host` (sin ruta ni query) |
| `ErrorRespuestaSii` | `estado` (solo si calza con `^[A-Za-z0-9-]{1,10}$`, como `EPR`, `RCH`, `-11`, `P91`; si no, `[Filtrado]`) y `glosa` |
| `FoliosSinCafError` | `folio_desde`, `folio_hasta`, `ambiente` |
| `FolioInicialRequeridoError` | `folio_sugerido`, `ambiente` |
| `DeclaracionInciertaError` | `rut_empresa` |

**Nunca** `cause`, stack ni el `message` de un error desconocido. Todo pasa además por
`sanearDetalle()`. Las reglas del saneado (qué claves y patrones filtra) están en
[vault y secretos](../08-esquema-supabase/vault-y-secretos.md#capa-sii-serversiierrorests).

## Errores de la base

Los errores de PostgREST y de las RPC (códigos `22004`, `22023`, `23503`, `23505`,
`42501`, `42883`…) se documentan con cada función en `03-api-reference/rpc-*.md` y en
[solución de problemas](../08-esquema-supabase/solucion-de-problemas.md). La capa SII solo
informa su `code`, nunca el `message` ni el `details` (podrían traer la fila).

<!-- TODO: códigos de error propios de la base (tg_validar_documento, asignar_folio, cuotas) cuando se documenten sus fases. -->
