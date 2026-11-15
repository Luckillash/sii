---
title: "RPC del backend (service_role)"
description: "registrar_certificado, registrar_caf, guardar_set_pruebas, anular_folios (también administradores) y el trigger trg_20_caf_sin_traslape, token_*, leer_secreto, tomar/liberar_bloqueo_certificado, asignar_folio, guardar_secreto, encolar_evento, plan_vigente."
keywords: [service_role, registrar_certificado, registrar_caf, guardar_set_pruebas, migración 0008, CAF, RSASK, "caf:<rut>", idempotente, for no key update, set_pruebas_casos, set_descargado, P0002, "La empresa no existe en la organización", "El IDK del CAF no corresponde al ambiente", "Ya hay un CAF que empieza en el folio", Vault, vault.create_secret, guardar_secreto, leer_secreto, pfx_secret_id, clave_secret_id, huella_sha256, "certificado:<huella>:pfx", 23503, 22023, 23505, 22004, "El certificado ya está registrado en la organización", "permission denied for function", token_obtener, token_guardar, token_borrar, TokenStoreSupabase, tomar_bloqueo_certificado, liberar_bloqueo_certificado, bloqueos_sii, arriendo, titular, conBloqueoCertificado, "La duración del bloqueo debe estar entre 1 y 900 segundos", migración 0007, anular_folios, migración 0011, folios_anulados, cola completa, "El CAF no existe", "Solo un administrador de la organización puede anular folios", "ya tiene un documento emitido", tg_caf_sin_traslape, trg_20_caf_sin_traslape, 23P01, "se traslapa con otro CAF", asignar_folio, "No quedan folios", encolar_evento, folios.por_agotarse]
related: ["09-libreria/backend-service-role.md", "08-esquema-supabase/vault-y-secretos.md", "04-objetos/objetos-empresas-y-credenciales.md", "04-objetos/objetos-folios.md", "02-guias/folios-caf.md", "02-guias/onboarding-organizacion.md", "01-fundamentos/autenticacion-sii.md"]
source: ["supabase_saas_sii.sql §15 §17", "supabase/migrations/0005_certificados_resoluciones.sql", "supabase/migrations/0007_bloqueos_sii.sql", "supabase/migrations/0008_certificacion.sql", "supabase/migrations/0011_folios.sql", "apps/web/src/server/sii/", "apps/web/src/server/certificacion/", "apps/web/src/server/folios/"]
---

# RPC del backend (service_role)

> **Úsalo cuando:** escribes el backend y necesitas una función reservada a service_role.

Estas funciones no las ejecuta `authenticated` ni `anon` (`permission denied for
function …`, `42501`). Se llaman con el cliente de `src/server/supabase/service.ts`
(`clienteServicio()`, `import 'server-only'`), que salta RLS: **quien llama filtra
siempre por `organizacion_id`** y comprueba antes que el usuario tenga el rol necesario.

Una excepción: [`anular_folios`](#anular_folios-migración-0011) (migración 0011,
**aplicada el 2026-11-15**) también la ejecuta `authenticated`, porque un administrador la
llama con su sesión y la función revisa el rol por dentro. Está aquí porque escribe en
`cafs`, tabla del backend.

<!-- TODO (Fase 8): sincronizar_documentos_envio. -->

## `guardar_secreto`

Viene en la §15 de `0001`.

```sql
public.guardar_secreto(p_secreto text, p_descripcion text default '')
  returns uuid                                   -- sql · security definer · search_path = ''
```

- Llama a `vault.create_secret(p_secreto, null, p_descripcion)`: el secreto queda **sin
  nombre** (`name = null`) y con la descripción como etiqueta. Devuelve el id que va en la
  columna `*_secret_id`.
- Solo `service_role`. En la práctica no se llama sola: la usan `registrar_certificado`
  (`certificado:<huella>:pfx` y `certificado:<huella>:clave`, migración `0005`) y
  `registrar_caf` (migración `0008`), que crean el secreto y la fila en la misma
  transacción, así que un error no deja secretos huérfanos.
- Lo inverso es `leer_secreto(p_id uuid) returns text` (`stable security definer`, lee
  `vault.decrypted_secrets`). El borrado lo hace `trg_borrar_secretos` al eliminar la fila
  ([triggers](../08-esquema-supabase/triggers-y-logica.md#transversales)). Detalle en
  [Vault y secretos](../08-esquema-supabase/vault-y-secretos.md).
- Nunca registres en logs ni en Sentry el argumento `p_secreto`.

## `plan_vigente`

Viene en la §15 de `0001`.

```sql
public.plan_vigente(p_organizacion uuid)
  returns public.planes                          -- sql · stable · security definer · search_path = ''
```

- Devuelve la fila de `planes` de la suscripción **más reciente** de la organización en
  estado `prueba` o `activa`. Una organización `morosa` o `cancelada` no tiene plan
  vigente: devuelve **`null`** (todas las columnas nulas).
- Quién la usa: `tg_limite_empresas` (`max_empresas`), `exigir_cupo_usuarios` y
  `tg_limite_usuarios` (`max_usuarios`), `tg_validar_documento` (`permite_produccion`),
  `tg_contar_uso_documento` (`max_boletas_mes`), `crear_api_key` (`incluye_api`) y
  `crear_webhook` (`incluye_webhooks`).
- **Cuidado con el `null`**: un límite nulo en `planes` significa «ilimitado», pero un plan
  nulo significa «sin suscripción». `tg_limite_empresas` revisa `v_plan.id is null` («La
  organización no tiene una suscripción vigente») antes de leer el límite; los demás usos de
  la `0001` envuelven los booleanos en `coalesce(..., false)`; la migración `0004_cupo_sin_suscripcion` corrigió
  `exigir_cupo_usuarios`, que leía `max_usuarios` nulo como ilimitado y dejaba aceptar
  miembros sin suscripción vigente. Al usarla en código nuevo, distingue los dos casos.

## `token_obtener`, `token_guardar`, `token_borrar`

Vienen en la §15 de `0001`. Son el almacenamiento del `TokenStore` de la librería; las usa
solo `TokenStoreSupabase` (`server/sii/token-store-supabase.ts`,
[autenticación](../01-fundamentos/autenticacion-sii.md#token-del-sii-tokenstoresupabase)).

```sql
public.token_obtener(p_canal canal_sii, p_ambiente ambiente_sii, p_rut text, p_huella text)
  returns table (token_cifrado bytea, vence_en timestamptz)        -- sql · stable · security definer
public.token_guardar(p_canal canal_sii, p_ambiente ambiente_sii, p_rut text, p_huella text,
                     p_token_cifrado bytea, p_vence_en timestamptz)
  returns void                                                     -- upsert por la PK; actualizado_en = now()
public.token_borrar(p_canal canal_sii, p_ambiente ambiente_sii, p_rut text, p_huella text)
  returns void
-- search_path = '' · solo service_role
```

- La clave es la de `ClaveToken`: canal, ambiente, RUT de la empresa (`76354771-K`) y huella
  sha256 del certificado que firmó la semilla.
- `p_token_cifrado` llega ya cifrado (AES-256-GCM con `SII_TOKENS_KEY`; por PostgREST viaja
  como `\x<hex>`, `aBytea`). La base nunca ve el token.
- `token_obtener` **no filtra por vigencia**: devuelve la fila aunque esté vencida y la
  librería decide con su reloj.
- `token_guardar` valida el RUT (dominio `rut`) y el formato de la huella (`check`) de la
  tabla: un dato inválido falla con el error del dominio o del `check`.

## `leer_secreto` (Vault)

```sql
public.leer_secreto(p_id uuid) returns text   -- decrypted_secret de vault.decrypted_secrets · solo service_role
```

Desde la Fase 4 la llama `crearCredenciales()` (`server/sii/credenciales.ts`) para el .pfx
en base64 y su clave, por los ids `pfx_secret_id` / `clave_secret_id` de una fila de
`certificados` **ya filtrada por organización**. Un error de la RPC se traduce a
`ErrorCredenciales('base')`; un valor vacío o nulo, a `ErrorCredenciales('vault')`.
Detalle en [vault y secretos](../08-esquema-supabase/vault-y-secretos.md#quién-lee).

## `tomar_bloqueo_certificado` y `liberar_bloqueo_certificado` (migración 0007)

Vienen en `supabase/migrations/0007_bloqueos_sii.sql`, **aplicada en
producción el 2026-11-13**. En una base que no la tenga, `conBloqueoCertificado` falla con
`ErrorBloqueo` (con el código de función inexistente: `PGRST202` por PostgREST, `42883` en
SQL directo) y la operación termina en `error` sin salir al SII.

```sql
public.tomar_bloqueo_certificado(
  p_certificado uuid,
  p_ambiente    public.ambiente_sii,
  p_titular     uuid,
  p_segundos    integer
) returns boolean

public.liberar_bloqueo_certificado(
  p_certificado uuid,
  p_ambiente    public.ambiente_sii,
  p_titular     uuid
) returns boolean
-- plpgsql · security definer · search_path = ''
-- revoke execute from public, anon, authenticated · grant execute to service_role
```

**Para qué:** un bloqueo con arriendo por `(certificado, ambiente)` en `bloqueos_sii`, para
que dos peticiones no abran sesiones AUT2000 en paralelo con el mismo certificado (el SII
frena el re-login, error `01.01.215.500.771.52`). Reemplaza al `bloquear_certificado` con
`pg_try_advisory_xact_lock` que proponía el plan, que no serializa nada a través de
PostgREST ([por qué](../01-fundamentos/autenticacion-sii.md#por-qué-un-arriendo-y-no-advisory-locks)).

**`tomar_bloqueo_certificado`.** Un solo `insert … on conflict (certificado_id, ambiente)
do update … where b.vence_en <= now() or b.titular = excluded.titular` (atómico):

| Situación | Efecto | Devuelve |
|---|---|---|
| No hay fila | la crea con `vence_en = now() + p_segundos` | `true` |
| Hay fila vencida (de cualquiera) | la toma: titular nuevo, `tomado_en = now()` | `true` |
| Hay fila del mismo titular | renueva `vence_en` y **conserva `tomado_en`** | `true` |
| Hay fila vigente de otro titular | nada | `false` |

Dos llamadas simultáneas se ordenan en el índice de la llave primaria: la segunda espera a
que la primera termine y evalúa el `where` sobre la fila que dejó.

**`liberar_bloqueo_certificado`.** Borra la fila solo si `titular = p_titular`, vencida o
no. `true` si la borró; `false` si no había bloqueo o era de otro (p. ej. el arriendo
venció y otro lo tomó: no se le quita).

**Por qué `security definer` y solo `service_role`:** `bloqueos_sii` no tiene políticas ni
privilegios para `anon` y `authenticated`; la capa SII llama con el cliente de servicio
después de validar a quien pide la operación. Las funciones no revisan membresía: el
`certificadoId` tiene que venir de un certificado cargado con `crearCredenciales()`.

**Errores**

| Código | Mensaje | Causa |
|---|---|---|
| `22004` | `Faltan el certificado, el ambiente o el titular del bloqueo` | `p_certificado`, `p_ambiente` o `p_titular` nulo (solo en `tomar_…`) |
| `22023` | `La duración del bloqueo debe estar entre 1 y 900 segundos` | `p_segundos` nulo o fuera de 1..900 |
| `23503` | `insert or update on table "bloqueos_sii" violates foreign key constraint …` | el certificado no existe (FK) |
| `42501` | `permission denied for function …` | llamada sin `service_role` |
| `42883` (SQL) / `PGRST202` (PostgREST) | `function … does not exist` / `Could not find the function … in the schema cache` | la base no tiene la 0007 |

`liberar_…` con nulos no lanza: no borra nada y devuelve `false`.

**Cómo la llama la app** (`server/sii/bloqueos.ts`, `conBloqueoCertificado`): titular
`randomUUID()` por llamada, `p_segundos = 300` por defecto, reintentos cada 1 s hasta 20 s;
libera siempre en un `finally`. `bloqueos.ts` valida 1..900 antes de llamar, así que el
`22023` no debería verse desde la app
([contrato](../01-fundamentos/autenticacion-sii.md#bloqueo-con-arriendo-por-certificado-bloqueosts)).

Verificación: `supabase/verificaciones/0007_bloqueos_sii.sql` (14 comprobaciones de solo
lectura: tabla, PK, FK en cascada, RLS sin políticas, privilegios, firmas, nombres de
parámetros, `security definer`, `search_path`, condición del arriendo, migración
registrada y, 13–14, el índice único parcial `operaciones_sii_efecto_global_en_curso` que
la misma migración agrega a `operaciones_sii`) y `rls-fase4-bloqueos.sql` (21, con
`rollback`; 17–21 son del índice). Corridas en producción el 2026-11-13: 14/14 y 21/21 `ok`
([cómo correrlas](../05-pruebas/probar-el-esquema.md#5-simulación-del-bloqueo-de-la-fase-4-rls-fase4-bloqueossql)).

## `registrar_caf` (migración 0008)

Viene en `supabase/migrations/0008_certificacion.sql`, aplicada en producción el
2026-11-13 ([despliegue](../08-esquema-supabase/despliegue.md#fase-5-migración-0008)).
En una base sin ella, `cliente.rpc('registrar_caf', …)` falla con la función inexistente
(`PGRST202` por PostgREST; `42883` en SQL) **después** de que el SII timbró los folios: la
solicitud queda `incierta` y la operación `incierto`.

```sql
public.registrar_caf(
  p_organizacion       uuid,
  p_empresa            uuid,
  p_ambiente           public.ambiente_sii,
  p_tipo_dte           smallint,
  p_folio_desde        integer,
  p_folio_hasta        integer,
  p_fecha_autorizacion date,
  p_idk                smallint,
  p_rut_emisor         text,
  p_razon_social       text,
  p_caf_xml            text,
  p_solicitud          uuid          -- nulo si el CAF no viene de una solicitud
) returns uuid                       -- id de la fila de cafs
-- plpgsql · security definer · search_path = ''
-- revoke execute from public, anon, authenticated · grant execute to service_role
```

**Para qué:** guardar el XML **completo** del CAF (con `<RSASK>`, la llave con que se
timbra) en Vault y crear la fila de `cafs` con el id del secreto, en una sola
transacción; y, si se pasa `p_solicitud`, enlazar `cafs.solicitud_id` y dejar la fila de
`solicitudes_folios` como `timbrada` con el rango y el `caf_id`. La bitácora y el CAF no
pueden quedar desalineados: si una parte falla, se deshace todo (también el
`vault.create_secret`).

**Efectos, en orden**

1. Busca la empresa por `id` **y** `organizacion_id` (si no, `P0002`).
2. Valida, **sin tocar Vault**: XML no vacío; ambiente, tipo, fecha e IDK presentes; rango
   `1 ≤ desde ≤ hasta`; IDK del ambiente (100 en certificación, 300 en producción, el mismo
   candado que el `check` de `cafs` y que `SolicitudFolios`); RUT del emisor
   (normalizado: sin puntos, mayúsculas) igual al de la empresa; si hay solicitud, que sea
   de la organización, la empresa, el ambiente y el tipo.
3. `for no key update` sobre la fila de la empresa: dos llamadas simultáneas para la misma
   empresa se ordenan (la segunda ve lo que dejó la primera) en vez de crear dos secretos y
   chocar en la llave única. `no key update` no bloquea las FK que apuntan a la empresa.
4. Busca un CAF con la llave única de `cafs` (empresa, ambiente, tipo, `folio_desde`):
   - **existe con el mismo `folio_hasta`** → idempotente: devuelve su id **sin crear otro
     secreto** (un reintento tras un corte no deja secretos huérfanos); si no tenía
     `solicitud_id`, lo enlaza;
   - **existe con otro `folio_hasta`** → `23505`;
   - **no existe** → `guardar_secreto(p_caf_xml, 'caf:<rut>:<ambiente>:<tipo>:<desde>-<hasta>')`
     e `insert` en `cafs` con `siguiente_folio = folio_desde`. Un `unique_violation` en el
     insert se relanza como `23505` y aborta la transacción completa (el secreto también se
     deshace).
5. Con solicitud: si ya estaba enlazada a **otro** CAF, `22023`; si no, la deja
   `estado = 'timbrada'`, `confirmada = true`, `folio_desde`/`folio_hasta`, `caf_id` y
   `terminado_en = coalesce(terminado_en, now())`.

La descripción del secreto lleva solo datos públicos del CAF (RUT, ambiente, tipo y
rango). Ningún mensaje de error incluye el XML: nombran el dato, nunca su valor.

**Errores**

| Código | Mensaje | Causa |
|---|---|---|
| `P0002` | `La empresa no existe en la organización` | empresa de otra organización o inexistente |
| `22023` | `Falta el XML del CAF` | `p_caf_xml` nulo o en blanco |
| `22023` | `Faltan el ambiente, el tipo, la fecha de autorización o el IDK del CAF` | alguno nulo |
| `22023` | `El rango de folios del CAF no es válido` | nulo, `desde < 1` o `hasta < desde` |
| `22023` | `El IDK del CAF no corresponde al ambiente` | IDK 300 en certificación o 100 en producción |
| `22023` | `El CAF es de otra empresa (RUT del emisor distinto)` | `<RE>` ≠ `empresas.rut` |
| `22023` | `La solicitud de folios no es de esta empresa, ambiente y tipo` | solicitud de otra organización, empresa, ambiente o tipo |
| `22023` | `La solicitud de folios ya está enlazada a otro CAF` | `solicitudes_folios.caf_id` apunta a otro CAF |
| `23505` | `Ya hay un CAF que empieza en el folio N con otro rango` | mismo `folio_desde`, otro `folio_hasta` |
| `23P01` | `El CAF de folios D a H se traslapa con otro CAF de la empresa (folios … a …) del mismo tipo y ambiente` | con la migración 0011 (**aplicada el 2026-11-15**): el rango se cruza con otro CAF; lo lanza el trigger [`trg_20_caf_sin_traslape`](#trg_20_caf_sin_traslape-migración-0011) en el `insert` y aborta la transacción completa, también el secreto de Vault |
| `42501` | `permission denied for function registrar_caf` | llamada sin `service_role` |

**Por qué `security definer` y solo `service_role`:** `guardar_secreto` y la tabla `cafs`
(sin políticas de escritura) son del backend. La función no valida el XML como CAF (no
revisa la firma del SII): eso lo hizo `SolicitudFolios` de la librería, que ya revisó IDK,
RUT y tipo antes de devolverlo, o `validarCaf` en la carga manual (Fase 6).

**Nota (Fase 6, 0011).** `registrar_caf` no cambia: sigue idempotente (con el mismo CAF
devuelve antes de insertar y solo actualiza `solicitud_id`, que no dispara el trigger). Lo
nuevo es el `23P01` de arriba. `p_solicitud` acepta una solicitud en **cualquier** estado:
la carga manual (`subirCaf`) la usa para resolver una solicitud `incierta` que calza con el
CAF (misma empresa, ambiente, tipo y rango), que queda `timbrada` con el CAF enlazado. En el
timbrado, cualquier error de esta RPC (también el `23P01`) deja la solicitud `incierta` y la
operación `incierto`: los folios ya se timbraron.

**Quién la llama** (siempre `service_role`, con la organización de la membresía):

| Llamador | Cuándo | `p_ambiente` | `p_solicitud` |
|---|---|---|---|
| `solicitarEnSii` (`server/folios/sii.ts`), desde `solicitarFoliosSet` (Fase 5) y `solicitarFolios` (Fase 6) | dentro de `ejecutarOperacion`, después de que el SII timbró | `certificacion` o `produccion` | la solicitud `en_curso` |
| `subirCaf` (`server/folios/subir.ts`, Fase 6) | carga manual, después de `validarCaf` y de confirmar la sesión | el que eligió el administrador | la `incierta` que calza, o `null` |

En el timbrado:

```ts
const datos = leerDatosCaf(caf);              // <DA>: RE, RS, TD, RNG D/H, FA, IDK; nunca la llave
const registro = await cliente.rpc('registrar_caf', {
  p_organizacion: ctx.organizacionId,         // de la membresía verificada
  p_empresa: ctx.empresaId,
  p_ambiente: ambiente,                       // el de la solicitud
  p_tipo_dte: datos.tipoDte,
  p_folio_desde: datos.desde,
  p_folio_hasta: datos.hasta,
  p_fecha_autorizacion: datos.fechaAutorizacion,
  p_idk: datos.idk,
  p_rut_emisor: datos.rutEmisor,
  p_razon_social: datos.razonSocial,
  p_caf_xml: decodificarUtf8OIso(caf),        // texto Unicode: Vault guarda texto
  p_solicitud: solicitudId,
});
// cualquier falla (incluida la de leerDatosCaf) → solicitud 'incierta' (con el rango) + ErrorIncierto
```

El XML del CAF solo viaja a la RPC: no se registra en logs, `operaciones_sii` ni Sentry.
Quien lo lee después es `enviarSet`, con `leer_secreto(caf_secret_id)` filtrando antes la
fila de `cafs` por organización
([Vault](../08-esquema-supabase/vault-y-secretos.md#caf-registrar_caf-migración-0008)).

## `anular_folios` (migración 0011)

Viene en `supabase/migrations/0011_folios.sql`, **aplicada el 2026-11-15** en producción
([despliegue](../08-esquema-supabase/despliegue.md#fase-6-migración-0011)).
En una base sin ella, la llamada falla con `PGRST202` y la app muestra «No pudimos anular
los folios».

```sql
public.anular_folios(
  p_caf    uuid,
  p_desde  integer,
  p_hasta  integer,
  p_motivo text
) returns integer                    -- folios que quedaron anulados en esta llamada
-- plpgsql · security definer · search_path = ''
-- revoke execute from public, anon · grant execute to authenticated, service_role
```

**Para qué:** anular un rango de folios **no usados** de un CAF (van a `folios_anulados`,
que el RCOF informa en `<RangoAnulados>`) validando el rango contra el CAF y contra los
documentos, y cerrar el CAF si se anula su cola, todo en una transacción. Con inserts
sueltos no se valida nada ni se bloquea el CAF, y `cafs` no tiene políticas de escritura.
Por eso la misma 0011 borra la política `alta` de `folios_anulados` (0001), que dejaba
insertar directo a un administrador, y revoca a `authenticated` `insert`, `update`,
`delete` y `truncate`: la tabla solo se escribe con esta RPC o con `service_role`.

**Permiso.** `service_role` (`auth.role()`, igual que `asignar_folio`) o un administrador
(`es_admin`) de la organización del CAF. Se revisa **antes** de bloquear y validar: un CAF
de otra organización se comporta igual que uno inexistente (`P0002`, sin revelar que
existe); un miembro que no es administrador (emisor, lector) recibe `42501`.

**Efectos, en orden**

1. Permiso (arriba).
2. `select … for update` del CAF, el mismo candado que `asignar_folio`: una emisión
   simultánea espera y cada una ve el `siguiente_folio` que dejó la otra.
3. Valida (`22023`): folios no nulos, `p_desde ≤ p_hasta`, rango dentro del CAF, motivo
   (sin espacios a los lados) entre 1 y 500 caracteres.
4. Dos casos válidos:
   - **a.** todo el rango **bajo** `siguiente_folio` (folios asignados que no se usaron):
     solo inserta;
   - **b.** el rango llega a `siguiente_folio` o más arriba (folios que aún no se asignan):
     solo si es la **cola completa**, `p_desde ≤ siguiente_folio` y `p_hasta =
     folio_hasta`. Si no, `22023`. Una cola parcial dejaría a `asignar_folio` entregando un
     folio anulado (avanza de uno en uno sin mirar `folios_anulados`); una que empieza más
     arriba del siguiente dejaría folios ni emitidos ni anulados al cerrar el CAF.
5. Busca documentos de la empresa, ambiente y tipo con folio en el rango y `estado <>
   'anulado'` (la llave única de `documentos`): si hay, `23503` con el primer folio. Un
   folio usado se corrige con nota de crédito.
6. `insert` en `folios_anulados` de cada folio del rango (`motivo`, `anulado_por =
   auth.uid()`, nulo si llama el backend sin usuario) con `on conflict (caf_id, folio) do
   nothing`. Devuelve cuántos entraron: repetir da 0, y un rango que repite folios cuenta
   solo los nuevos.
7. Caso b: deja el CAF con `siguiente_folio = folio_hasta + 1` y `estado = 'anulado'`, así
   `asignar_folio` ya no lo usa.

**Errores**

| Código | Mensaje | Causa |
|---|---|---|
| `P0002` | `El CAF no existe` | CAF inexistente o de una organización de la que quien llama no es miembro |
| `42501` | `Solo un administrador de la organización puede anular folios` | miembro emisor o lector |
| `42501` | `permission denied for function anular_folios` | `anon` |
| `22023` | `Faltan el folio inicial o el final del rango a anular` | `p_desde` o `p_hasta` nulo |
| `22023` | `El folio inicial (N) es mayor que el final (M)` | `p_desde > p_hasta` |
| `22023` | `El rango N a M no está dentro del CAF (folios D a H)` | fuera del CAF |
| `22023` | `Falta el motivo de la anulación` / `El motivo de la anulación no puede pasar de 500 caracteres` | motivo nulo, en blanco o largo |
| `22023` | `Para anular folios que aún no se usan hay que anular desde el folio S hasta el último del CAF (H)` | cola parcial o que empieza más arriba del siguiente |
| `23503` | `El folio N ya tiene un documento emitido: no se puede anular` (hint: nota de crédito) | folio con documento no anulado |

**Cómo la llama la app** (`server/folios/anular.ts`, `anularFolios`), con el cliente de
**sesión** del administrador, después de validar el rango con `validarRangoAnulacion`
(`@/lib/folios`, mismas reglas) y confirmar la sesión con `getUser()`:

```ts
const { data, error } = await sesion.rpc('anular_folios', {
  p_caf: caf.id,             // leído con RLS, filtrado por organización y empresa
  p_desde: entrada.desde,
  p_hasta: entrada.hasta,
  p_motivo: motivo,          // ya recortado
});
// error → traducirErrorAnulacion(error): P0002 / 42501 / 22023 / 23503 → MensajeError
```

Después de anular una cola revisa la alerta `folios.por_agotarse`
([guía](../02-guias/folios-caf.md#anular-folios)).

**Riesgo para la Fase 7.** La búsqueda del paso 5 solo ve documentos que ya existen: un
folio asignado por `asignar_folio` cuyo documento todavía no se inserta se puede anular.
Asignar e insertar en una transacción, o rechazar en `tg_validar_documento` los folios que
estén en `folios_anulados`.

Verificación: `supabase/verificaciones/0011_folios.sql` (18, solo lectura) y
`rls-fase6-folios.sql` (27, con `rollback`)
([cómo correrlas](../05-pruebas/probar-el-esquema.md#9-simulación-de-folios-de-la-fase-6-rls-fase6-foliossql)).
En producción (2026-11-15, con la 0011 aplicada): 18/18 y 27/27, y la limpieza en 0
(también en PGlite).

## `trg_20_caf_sin_traslape` (migración 0011)

Trigger de la misma `0011_folios.sql`, **aplicada el 2026-11-15**.

```sql
public.tg_caf_sin_traslape() returns trigger
-- plpgsql · security definer · search_path = ''
-- revoke execute from public, anon, authenticated
create trigger trg_20_caf_sin_traslape
  before insert or update of folio_desde, folio_hasta, ambiente, tipo_dte, empresa_id
  on public.cafs for each row execute function public.tg_caf_sin_traslape();
```

- Rechaza con **`23P01`** (`El CAF de folios D a H se traslapa con otro CAF de la empresa
  (folios … a …) del mismo tipo y ambiente`) un CAF cuyo rango se cruza con otro de la
  misma empresa, ambiente y tipo, **en cualquier estado** (el SII nunca timbra dos veces el
  mismo folio: un cruce es un CAF equivocado o cargado dos veces). La llave única de la
  0001 solo atrapa el mismo `folio_desde`; sin el trigger, `asignar_folio` podría entregar
  dos veces el mismo folio.
- Antes de buscar toma `for no key update` sobre la fila de la empresa (lo mismo que
  `registrar_caf`, que ya lo tiene tomado): dos inserts simultáneos de la misma empresa se
  ordenan y el segundo ve al primero.
- No lo disparan `asignar_folio` ni `anular_folios` (`siguiente_folio`, `estado`) ni el
  enlace de `solicitud_id` de `registrar_caf`.
- Por dónde puede salir: `registrar_caf` (timbrado → solicitud `incierta`; carga manual →
  «El CAF se cruza con otro ya cargado», aunque `subirCaf` ya lo revisa antes para dar el
  rango) o un `update` de rango con `service_role`.
- Nombre `trg_20_…`: los triggers `before` del mismo evento corren en orden alfabético,
  después de `trg_00_organizacion` y `trg_10_caf_inicial`.

## `asignar_folio`

Viene en la §15 de `0001`. Solo `service_role` en la práctica (con otro rol exige
`puede_emitir`).

```sql
public.asignar_folio(p_empresa uuid, p_ambiente public.ambiente_sii, p_tipo_dte smallint)
  returns table (caf_id uuid, folio integer)     -- plpgsql · security definer · search_path = ''
```

- Toma el CAF `activo` con `siguiente_folio <= folio_hasta` de `folio_desde` más bajo, con
  `for update`; devuelve `siguiente_folio` y lo avanza; al pasar de `folio_hasta` deja el CAF
  `agotado`.
- `P0002` `No quedan folios de tipo T en A para la empresa` (hint «Solicite un nuevo CAF»)
  si no hay CAF con folios libres (también si todos están `anulado`). `42501` si quien llama
  no es `service_role` y no `puede_emitir`.
- No mira `folios_anulados`: por eso `anular_folios` solo deja anular la cola completa.
- Hoy la llama `enviarSet` (Fase 5). La emisión (Fase 7) tiene que llamar después a
  `alertaDespuesDeAsignar` (alerta `folios.por_agotarse`).

## `encolar_evento`

Viene en la §15 de `0001`. Solo `service_role`.

```sql
public.encolar_evento(p_organizacion uuid, p_evento text, p_payload jsonb) returns void
-- sql · security definer · search_path = ''
```

Inserta una fila en `webhook_entregas` por cada webhook activo de la organización suscrito
a `p_evento`, con payload `{ evento, creado_en, datos: p_payload }`; sin suscritos, nada. La
llaman los triggers de documentos, envíos y certificación, y desde la Fase 6 la app para
`folios.por_agotarse` (`server/folios/alertas.ts`, con `service_role`)
([webhooks](../06-integraciones/webhooks.md)).

## `guardar_set_pruebas` (migración 0008)

Viene en la misma `0008_certificacion.sql`, aplicada en producción el 2026-11-13. En
una base sin ella, descargar el set termina en `error` **después** de que el SII registró
la descarga: el usuario ve el mensaje genérico y a Sentry llega `ErrorBaseCertificacion`
(«No se pudo guardar el set de pruebas en Supabase (código PGRST202).»).

```sql
public.guardar_set_pruebas(
  p_organizacion     uuid,
  p_proceso          uuid,
  p_texto            text,           -- el .txt del set tal como lo entregó el SII
  p_correo_proveedor text,           -- nulo = conserva el que había
  p_casos            jsonb           -- lo que devuelve parsearSetPruebas, en snake_case
) returns integer                    -- casos guardados
-- plpgsql · security definer · search_path = ''
-- revoke execute from public, anon, authenticated · grant execute to service_role
```

`p_casos` es un arreglo de objetos:

```json
[
  {
    "numero_caso": 1,
    "tipo_dte": 39,
    "detalles": [{ "nombre": "<NmbItem del caso>", "cantidad": 1, "precio": 1000, "exento": true }],
    "referencia_codigo": "SET",
    "referencia_razon": "CASO-1"
  }
]
```

**Para qué:** reemplazar los `set_pruebas_casos` del proceso y dejar el proceso en
`set_descargado` **en una transacción**. Sin esto, una falla entre el borrado de los
casos y la actualización del proceso dejaría el asistente con un texto de set que no calza
con sus casos (o sin casos).

**Efectos, en orden**

1. Lee el proceso por `id` **y** `organizacion_id` con `for update` (si no, `P0002`).
2. Si la etapa es `por_declarar` o `autorizada`, `22023`: un set nuevo reiniciaría la
   certificación (la librería ya frena la descarga en P90).
3. Valida los casos, uno por uno: arreglo no vacío; cada caso es un objeto con
   `numero_caso` entero positivo (hasta 9 dígitos), `detalles` arreglo **no vacío**,
   `referencia_razon` no en blanco y `tipo_dte` numérico si viene; números de caso sin
   repetir.
4. `delete` de todos los casos del proceso e `insert` de los nuevos (`tipo_dte` 39 si no
   viene; `referencia_codigo` `'SET'` si viene vacío). `organizacion_id` lo hereda
   `trg_00_organizacion` desde el proceso.
5. `update` del proceso: `etapa = 'set_descargado'`, `set_pruebas_texto`,
   `correo_proveedor_set = coalesce(p_correo_proveedor, correo_proveedor_set)`,
   `set_descargado_en = now()` y **borra** `envio_set_id` y `revision_solicitada_en` (un set
   nuevo deja sin valor los envíos hechos con el anterior).

La etapa la escribe la propia función (`security definer`, `current_user = postgres`), así
que `tg_proteger_proceso` no la frena. `tg_certificacion_autorizada` corre igual: no mueve
la etapa (un proceso con P90/P91 ya está en `por_declarar` o más, y ahí la función
rechaza el reemplazo), pero sí encola el webhook `certificacion.actualizada` si la etapa
cambió.

**Errores**

| Código | Mensaje | Causa |
|---|---|---|
| `P0002` | `El proceso de certificación no existe en la organización` | proceso de otra organización o inexistente |
| `22023` | `La empresa ya está lista para declarar o autorizada: no se reemplaza el set` | etapa ≥ `por_declarar` |
| `22023` | `El set no trae casos` | `p_casos` nulo, no arreglo o vacío |
| `22023` | `Un caso del set no trae número, detalles o referencia` | caso que no es objeto, número inválido, `detalles` que no es arreglo, razón en blanco o tipo no numérico |
| `22023` | `Un caso del set no trae detalles` | `detalles` vacío |
| `22023` | `El set trae números de caso repetidos` | dos casos con el mismo `numero_caso` |
| `42501` | `permission denied for function guardar_set_pruebas` | llamada sin `service_role` |

**Cómo la llama la app** (`server/certificacion/set.ts`, `descargarSet`): `casosJson()`
pasa cada `CasoSetPruebas` a ese formato; `numero_caso` sale de `CASO-N` en la razón de la
referencia (o del orden, si no calza). Si el texto no se puede leer
(`parsearSetPruebas` lanza), la app **no** llama a esta RPC: borra los casos y guarda el
texto con `update` directos ([set ilegible](../05-pruebas/set-de-pruebas.md#set-ilegible)).

Verificación de las dos: `supabase/verificaciones/0008_certificacion.sql` (10, solo
lectura) y `rls-fase5-certificacion.sql` (16, con `rollback`)
([cómo correrlas](../05-pruebas/probar-el-esquema.md#6-simulación-de-las-rpc-de-la-fase-5-rls-fase5-certificacionsql)).
Corridas en producción el 2026-11-13: 10/10 y 16/16 `ok`.

## `registrar_certificado` (migración 0005)

Viene en `supabase/migrations/0005_certificados_resoluciones.sql`, aplicada en
producción el 2026-11-13. Sin ella, subir un certificado en la app falla con `42883`
(`function … does not exist`) y el usuario ve «No pudimos completar la operación».

```sql
public.registrar_certificado(
  p_organizacion   uuid,
  p_rut_titular    text,
  p_nombre_titular text,
  p_cn             text,
  p_emisor_ca      text,
  p_vigente_desde  timestamptz,
  p_vigente_hasta  timestamptz,
  p_huella_sha256  text,
  p_pfx_base64     text,
  p_clave          text,
  p_pfx_legacy     boolean,
  p_subido_por     uuid
) returns uuid
-- plpgsql · security definer · search_path = ''
-- revoke execute from public, anon, authenticated · grant execute to service_role
```

**Para qué:** guardar el .pfx (en base64) y su clave en Vault y crear la fila de
`certificados` con los dos ids, **en una sola transacción**. Si la fila no entra (huella
repetida, RUT inválido, lo que sea), la excepción deshace también los
`vault.create_secret`: no quedan secretos huérfanos.

**Por qué es `security definer` y solo `service_role`:** `guardar_secreto` y las
escrituras en `certificados` (tabla sin políticas de escritura) son del backend. La
validación real del .pfx (abrirlo con la clave, leer la hoja, la vigencia) la hace la
Server Action con la librería **antes** de llamar; la función no abre el .pfx y tampoco
revisa membresía ni rol. Si `authenticated` la ejecutara, podría registrar certificados
en cualquier organización y con datos que nadie validó.

**Efectos**

1. Normaliza la huella: `lower(btrim(p_huella_sha256))`.
2. Valida, **sin tocar Vault** (ver errores).
3. Revisión temprana: si la huella ya está en la organización, `23505` antes de crear
   secretos que se iban a deshacer.
4. `guardar_secreto(p_pfx_base64, 'certificado:<huella>:pfx')` y
   `guardar_secreto(p_clave, 'certificado:<huella>:clave')`. Las descripciones llevan
   solo la huella, que es pública: identifica el certificado, no lo abre.
5. Inserta en `certificados` con `pfx_legacy = coalesce(p_pfx_legacy, false)`. Si el
   `unique (organizacion_id, huella_sha256)` salta igual (dos subidas simultáneas), se
   relanza como `23505` con el mismo mensaje y la transacción completa se deshace.

Devuelve el `id` del certificado.

**Errores.** Los mensajes nombran el dato, nunca su valor: un error que llegue a logs o
a Sentry no arrastra nada del .pfx ni de la clave (la comprobación 27 de
`rls-fase3-empresas.sql` lo verifica).

| Código | Mensaje | Causa |
|---|---|---|
| `23503` | `La organización no existe` | `p_organizacion` nulo o inexistente |
| `23503` | `insert or update on table "certificados" violates foreign key constraint …` | `p_subido_por` no es un usuario de `auth.users` (lo lanza la FK) |
| `22023` | `La huella del certificado debe ser un sha256 en hexadecimal (64 caracteres)` | huella nula o que no calza con `^[0-9a-f]{64}$` tras normalizar |
| `22023` | `El RUT del titular no es válido` | `rut_valido(p_rut_titular)` no es `true` (también si es nulo). Formato `12345678-K` |
| `22023` | `Falta el archivo del certificado` | `p_pfx_base64` nulo o vacío |
| `22023` | `Falta la clave del certificado` | `p_clave` nula. Una clave **vacía** sí se acepta (hay .pfx sin contraseña) |
| `23505` | `El certificado ya está registrado en la organización` | misma huella en la misma organización. En otra organización sí se puede |
| `42501` | `permission denied for function registrar_certificado` | llamada sin `service_role` |

`p_nombre_titular`, `p_cn`, `p_emisor_ca`, `p_vigente_desde` y `p_vigente_hasta` aceptan
`null` (columnas nulas), aunque los tipos generados de Supabase los declaren `string`;
la app los pasa con un cast (`textoONulo`).

**Cómo la llama la app** (`apps/web/src/app/[org]/configuracion/certificados/acciones.ts`,
`subirCertificado`), después de: comprobar que el rol es administrador, validar el
formulario, abrir el .pfx con `analizarCertificado()` (librería), resolver el RUT del
titular, comprobar que la empresa elegida (si hay) es de la organización y confirmar la
sesión con `getUser()`:

```ts
const { data: certificadoId, error } = await clienteServicio().rpc('registrar_certificado', {
  p_organizacion: ctx.organizacion.id, // de la membresía, nunca del formulario
  p_rut_titular: rutTitular,           // '12345678-5'
  p_nombre_titular: analisis.nombreTitular,
  p_cn: analisis.cn,
  p_emisor_ca: analisis.emisorCa,
  p_vigente_desde: analisis.vigenteDesde.toISOString(),
  p_vigente_hasta: analisis.vigenteHasta.toISOString(),
  p_huella_sha256: analisis.huellaSha256,
  p_pfx_base64: Buffer.from(bytes).toString('base64'),
  p_clave: clave,
  p_pfx_legacy: analisis.pfxLegacy,
  p_subido_por: ctx.usuario.id,
});
// error → traducirErrorCertificado(error, 'subir'); al log va solo error.code
```

Después de la llamada la app sobrescribe con ceros su copia de los bytes
(`bytes.fill(0)`). Revocar y eliminar no tienen RPC: son `update`/`delete` directos con
`service_role` filtrados por `organizacion_id` e `id`; al borrar, `trg_borrar_secretos`
borra los dos secretos ([vault y secretos](../08-esquema-supabase/vault-y-secretos.md)).

Verificación: comprobaciones 6–7 de `0005_certificados_resoluciones.sql` (privilegios) y
21–30 y 40–41 de `rls-fase3-empresas.sql` (alta, secretos, errores, que `authenticated`
no la ejecute ni escriba en `certificados`, borrado de secretos).
