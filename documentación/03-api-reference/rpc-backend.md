---
title: "RPC del backend (service_role)"
description: "registrar_certificado, token_*, leer_secreto, tomar/liberar_bloqueo_certificado, asignar_folio, guardar_secreto, sincronizar_documentos_envio, encolar_evento, plan_vigente."
keywords: [service_role, registrar_certificado, Vault, vault.create_secret, guardar_secreto, leer_secreto, pfx_secret_id, clave_secret_id, huella_sha256, "certificado:<huella>:pfx", 23503, 22023, 23505, 22004, "El certificado ya está registrado en la organización", "permission denied for function", token_obtener, token_guardar, token_borrar, TokenStoreSupabase, tomar_bloqueo_certificado, liberar_bloqueo_certificado, bloqueos_sii, arriendo, titular, conBloqueoCertificado, "La duración del bloqueo debe estar entre 1 y 900 segundos", migración 0007]
related: ["09-libreria/backend-service-role.md", "08-esquema-supabase/vault-y-secretos.md", "04-objetos/objetos-empresas-y-credenciales.md", "02-guias/onboarding-organizacion.md", "01-fundamentos/autenticacion-sii.md"]
source: ["supabase_saas_sii.sql §15 §17", "supabase/migrations/0005_certificados_resoluciones.sql", "supabase/migrations/0007_bloqueos_sii.sql", "apps/web/src/server/sii/"]
---

# RPC del backend (service_role)

> **Úsalo cuando:** escribes el backend y necesitas una función reservada a service_role.

Estas funciones no las ejecuta `authenticated` ni `anon` (`permission denied for
function …`, `42501`). Se llaman con el cliente de `src/server/supabase/service.ts`
(`clienteServicio()`, `import 'server-only'`), que salta RLS: **quien llama filtra
siempre por `organizacion_id`** y comprueba antes que el usuario tenga el rol necesario.

<!-- TODO: redactar asignar_folio, guardar_secreto, sincronizar_documentos_envio, encolar_evento y plan_vigente -->

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

Vienen en `supabase/migrations/0007_bloqueos_sii.sql`, **pendiente de aplicar en
producción** (2026-11-13). Sin ella, `conBloqueoCertificado` falla con `ErrorBloqueo`
(con el código de función inexistente: `PGRST202` por PostgREST, `42883` en SQL directo)
y la operación termina en `error` sin salir al SII.

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
`rollback`; 17–21 son del índice)
([cómo correrlas](../05-pruebas/probar-el-esquema.md#5-simulación-del-bloqueo-de-la-fase-4-rls-fase4-bloqueossql)).

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
