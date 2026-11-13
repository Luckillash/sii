---
title: "RPC del backend (service_role)"
description: "registrar_certificado, asignar_folio, token_*, guardar/leer_secreto, sincronizar_documentos_envio, encolar_evento, plan_vigente."
keywords: [service_role, registrar_certificado, Vault, vault.create_secret, guardar_secreto, leer_secreto, pfx_secret_id, clave_secret_id, huella_sha256, "certificado:<huella>:pfx", 23503, 22023, 23505, "El certificado ya está registrado en la organización", "permission denied for function"]
related: ["09-libreria/backend-service-role.md", "08-esquema-supabase/vault-y-secretos.md", "04-objetos/objetos-empresas-y-credenciales.md", "02-guias/onboarding-organizacion.md"]
source: ["supabase_saas_sii.sql §15 §17", "supabase/migrations/0005_certificados_resoluciones.sql"]
---

# RPC del backend (service_role)

> **Úsalo cuando:** escribes el backend y necesitas una función reservada a service_role.

Estas funciones no las ejecuta `authenticated` ni `anon` (`permission denied for
function …`, `42501`). Se llaman con el cliente de `src/server/supabase/service.ts`
(`clienteServicio()`, `import 'server-only'`), que salta RLS: **quien llama filtra
siempre por `organizacion_id`** y comprueba antes que el usuario tenga el rol necesario.

<!-- TODO: redactar asignar_folio, token_obtener/token_guardar/token_borrar, guardar_secreto/leer_secreto, sincronizar_documentos_envio, encolar_evento y plan_vigente -->

## `registrar_certificado` (migración 0005)

Viene en `supabase/migrations/0005_certificados_resoluciones.sql`, **pendiente de
aplicar en producción**. Sin ella, subir un certificado en la app falla con `42883`
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
