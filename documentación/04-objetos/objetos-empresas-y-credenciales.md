---
title: "Objetos: empresas y credenciales"
description: "Columnas de empresas, resoluciones, certificados, empresa_certificados, tokens_sii y sesiones_sii, quién escribe cada una y la vista v_certificados_estado."
keywords: [empresas, resoluciones, certificados, empresa_certificados, tokens_sii, sesiones_sii, v_certificados_estado, autorizada_produccion, activa, huella_sha256, pfx_secret_id, clave_secret_id, pfx_legacy, revocado_en, es_representante_electronico, predeterminado, vigente, resoluciones_vigente_unica, empresa_certificados_predeterminado_unico, por_vencer, dias_restantes, registrar_certificado, registrar_resolucion, fijar_certificado_predeterminado]
related: ["02-guias/onboarding-organizacion.md", "03-api-reference/acceso-por-tabla.md", "03-api-reference/rpc-organizacion.md", "03-api-reference/rpc-backend.md", "08-esquema-supabase/vault-y-secretos.md", "01-fundamentos/formatos-y-validaciones.md"]
source: ["supabase_saas_sii.sql §6 §15 §16 §17", "supabase/migrations/0005_certificados_resoluciones.sql", "apps/web/src/server/empresas.ts", "apps/web/src/server/certificados/"]
---

# Objetos: empresas y credenciales

> **Úsalo cuando:** necesitas los campos de una empresa o credencial.

Las seis tablas vienen de la sección 6 del esquema (`0001_esquema_inicial.sql`). La
migración `0005_certificados_resoluciones` no cambia ninguna columna: solo agrega las
tres RPC con que la app las escribe (`registrar_certificado`, `registrar_resolucion` y
`fijar_certificado_predeterminado`). La 0005 se aplicó en producción el 2026-11-13; en
una base sin ella, la carga de certificados, el registro de resoluciones y el cambio de
predeterminado fallan con `42883` (`function … does not exist`).

Leyenda: ✔ obligatoria (`not null` sin default útil) · 🔒 solo `service_role`.

## Resumen: quién escribe cada tabla

| Tabla | Lee | Escribe | Por dónde (app) |
|---|---|---|---|
| `empresas` | todo miembro | administradores (RLS) | Server Actions de `configuracion/empresas/acciones.ts`, con la sesión del usuario |
| `resoluciones` | todo miembro | administradores (RLS) | `registrar_resolucion()` (0005), con la sesión del usuario |
| `certificados` | todo miembro | 🔒 solo `service_role` (sin políticas de escritura) | `registrar_certificado()` (0005), y `update`/`delete` directos, desde `configuracion/certificados/acciones.ts` |
| `empresa_certificados` | todo miembro | administradores (RLS) | `server/certificados/asociaciones.ts` y `fijar_certificado_predeterminado()` (0005), con la sesión |
| `tokens_sii` 🔒 | solo `service_role` | solo `service_role` | `TokenStoreSupabase` sobre `token_obtener` / `token_guardar` / `token_borrar` |
| `sesiones_sii` 🔒 | solo `service_role` | solo `service_role` | capa SII de la Fase 4 (`sesiones.ts`, aún sin código) |

Matriz completa por rol en [acceso por tabla](../03-api-reference/acceso-por-tabla.md).

---

## `empresas`

Contribuyente que emite: `EmisorBoleta` de la librería y datos de la carátula. Un mismo
RUT puede estar en más de una organización (la empresa y su contador), pero solo una
vez por organización.

| Columna | Tipo | Regla | Notas |
|---|---|---|---|
| `id` | `uuid` | PK, `gen_random_uuid()` | |
| `organizacion_id` ✔ | `uuid` | FK `organizaciones`, `on delete cascade` | la pone quien inserta; el `WITH CHECK` de RLS exige `es_admin` sobre ella |
| `rut` ✔ | `rut` (dominio) | `unique (organizacion_id, rut)` | `<RUTEmisor>`. Formato `76354771-K`. La app no permite cambiarlo después del alta |
| `razon_social` ✔ | `text` | `length` entre 1 y 100 | `<RznSocEmisor>` |
| `giro` ✔ | `text` | `length` entre 1 y 80 | `<GiroEmisor>`, sin abreviaciones |
| `direccion` ✔ | `text` | `length` entre 1 y 70 | `<DirOrigen>` |
| `comuna` ✔ | `text` | `length` entre 1 y 20 | `<CmnaOrigen>` |
| `correo_intercambio` | `correo_sii` (dominio) | nulo o regla `esValidoMail2` | opcional |
| `autorizada_produccion` | `boolean` | default `false` | la marca el sistema con P91 (`tg_certificacion_autorizada`). Sin ella, `tg_validar_documento` rechaza documentos de producción |
| `autorizada_en` | `timestamptz` | | se llena junto con la anterior |
| `activa` | `boolean` | default `true` | la app la usa para «desactivar» en vez de borrar. **Ninguna regla de la base la exige todavía** (ver abajo) |
| `creado_en`, `actualizado_en` | `timestamptz` | default `now()` | `actualizado_en` lo mantiene `trg_90_actualizado_en` |

Triggers:

| Trigger | Cuándo | Qué hace |
|---|---|---|
| `trg_05_proteger_autorizacion` | `before insert or update` | para usuarios (no `service_role` ni `postgres`): en el `insert` fuerza `autorizada_produccion = false` y `autorizada_en = null`; en un `update` que los cambie lanza `autorizada_produccion solo la cambia el sistema (estado P91 del SII)` |
| `trg_10_limite_empresas` | `before insert` | solo para administradores y `service_role`: `La organización no tiene una suscripción vigente` o `El plan <nombre> permite como máximo <n> empresa(s)`. Cuenta **todas** las empresas, también las desactivadas |
| `trg_90_actualizado_en` | `before update` | `actualizado_en = now()` |

Lo que hace la app (Fase 3):

- **Alta** (`crearEmpresa`): valida con `esquemaEmpresa` (espejo de los checks, más la
  regla ISO-8859-1, ver [formatos](../01-fundamentos/formatos-y-validaciones.md)),
  avisa antes si el plan no tiene cupo y hace el `insert` con la sesión. Redirige a la
  ficha con `?creada=1`.
- **Edición** (`editarEmpresa`): todo menos el RUT.
- **Desactivar / activar** (`cambiarEstadoEmpresa`): solo cambia `activa`.
- **No hay «eliminar empresa»** en la app, aunque RLS se lo permite a un administrador:
  el `delete` arrastraría en cascada resoluciones, asociaciones, CAF, documentos, envíos
  y el proceso de certificación.

`activa = false` todavía no lo exige ninguna regla de la base: ni `tg_validar_documento`
ni `asignar_folio` la miran. La UI dice que una empresa desactivada «no se puede elegir
para emitir ni pedir folios»; cuando existan esas operaciones (Fases 6 y 7) el filtro
tiene que ir en el backend o en una migración.

## `resoluciones`

Resolución del SII que va en la carátula de cada envío (`<NroResol>`, `<FchResol>`).
Una vigente por empresa y ambiente; las anteriores quedan como historial.

| Columna | Tipo | Regla | Notas |
|---|---|---|---|
| `id` | `uuid` | PK | |
| `organizacion_id` ✔ | `uuid` | FK `organizaciones`, cascade | la hereda `trg_00_organizacion` desde la empresa: lo que venga en la fila se pisa |
| `empresa_id` ✔ | `uuid` | FK `empresas`, cascade | |
| `ambiente` ✔ | `ambiente_sii` | | `certificacion` o `produccion` |
| `numero` ✔ | `integer` | `numero >= 0`; `check (ambiente = 'produccion' or numero = 0)` | en certificación siempre 0 |
| `fecha` ✔ | `date` | | la entrega el SII |
| `vigente` | `boolean` | default `true` | índice único parcial `resoluciones_vigente_unica (empresa_id, ambiente) where vigente` |
| `creado_en` | `timestamptz` | default `now()` | no hay `actualizado_en` |

Se escribe con `registrar_resolucion(empresa, ambiente, numero, fecha)` (0005): apaga la
vigente de ese ambiente y crea la nueva en la misma transacción, con un candado sobre la
empresa. Un `insert` directo con `vigente = true` cuando ya hay una vigente choca con el
índice (`23505`); por eso la app no lo hace a mano
([contrato](../03-api-reference/rpc-organizacion.md#registrar_resolucion-migración-0005)).

La app es más estricta que la base: en producción exige número ≥ 1 (la base acepta 0) y
la fecha no puede ser posterior a hoy en hora de Chile (la base no la limita).

## `certificados`

Certificado digital (.pfx) de una **persona** (el titular), no de la empresa. La fila
guarda solo datos públicos (`InfoCertificado`) y la huella; el .pfx en base64 y su
clave van en Vault ([vault y secretos](../08-esquema-supabase/vault-y-secretos.md)).

| Columna | Tipo | Regla | Notas |
|---|---|---|---|
| `id` | `uuid` | PK; además `unique (organizacion_id, id)` para la FK compuesta de `empresa_certificados` | |
| `organizacion_id` ✔ | `uuid` | FK `organizaciones`, cascade | la de la membresía de quien sube, nunca una del formulario |
| `rut_titular` ✔ | `rut` (dominio) | | `<RutEnvia>`: quien firma. Sale del certificado o, si no lo trae, del formulario |
| `nombre_titular` | `text` | | la app guarda el CN del sujeto (en los certificados chilenos es el nombre) |
| `cn` | `text` | | CN del sujeto (`Certificado.info().cn`) |
| `emisor_ca` | `text` | | CN del emisor o, si no tiene, su O |
| `vigente_desde`, `vigente_hasta` | `timestamptz` | | de la hoja X.509. Nulas solo si se insertó a mano |
| `huella_sha256` ✔ | `text` | `^[0-9a-f]{64}$`; `unique (organizacion_id, huella_sha256)` | `huellaCertificado()` de la librería: sha256 del DER de la hoja. Es la clave de `tokens_sii`. La misma huella puede estar en dos organizaciones |
| `pfx_secret_id` ✔ | `uuid` | | id en `vault.secrets` del .pfx en base64 |
| `clave_secret_id` ✔ | `uuid` | | id en `vault.secrets` de la clave |
| `pfx_legacy` | `boolean` | default `false` | el PKCS#12 usa un cifrado que OpenSSL 3 solo lee con el proveedor legacy (RC2-40 de los .pfx del SII, RC4, DES). **3DES no cuenta** (ver [trampas](../07-referencia/trampas-conocidas.md)) |
| `subido_por` | `uuid` | FK `auth.users`, `on delete set null` | |
| `revocado_en` | `timestamptz` | | lo fija «Revocar» en la app; manda sobre la vigencia en `v_certificados_estado` |
| `creado_en`, `actualizado_en` | `timestamptz` | | `trg_90_actualizado_en` |

Escrituras (todas con `service_role`, siempre filtrando por `organizacion_id`):

| Operación | Cómo |
|---|---|
| Alta | `registrar_certificado(...)`: Vault + fila en una transacción ([contrato](../03-api-reference/rpc-backend.md#registrar_certificado-migración-0005)) |
| Revocar | `update certificados set revocado_en = now() where organizacion_id = … and id = … and revocado_en is null` |
| Eliminar | `delete from certificados where organizacion_id = … and id = …` |

Al borrar una fila:

- `trg_borrar_secretos` (`after delete`) borra de `vault.secrets` el .pfx y la clave.
- En cascada se borran sus filas de `empresa_certificados` y `sesiones_sii`.
- `solicitudes_folios.certificado_id` y `envios.certificado_id` quedan en `null`.
- `tokens_sii` **no** se toca: no tiene FK a `certificados` (su clave es la huella). Esos
  tokens vencen solos (~50 min).

Revocar no quita las asociaciones ni el predeterminado: la capa SII tiene que descartar
los certificados revocados o vencidos al elegir con cuál firmar.

## `empresa_certificados`

Qué certificados firman por qué empresa. La clave es `(empresa_id, certificado_id)`.

| Columna | Tipo | Regla | Notas |
|---|---|---|---|
| `organizacion_id` ✔ | `uuid` | FK `organizaciones`, cascade | heredada de la empresa (`trg_00_organizacion`) |
| `empresa_id` ✔ | `uuid` | FK `empresas`, cascade | |
| `certificado_id` ✔ | `uuid` | FK `certificados`, cascade; FK compuesta `(organizacion_id, certificado_id)` → `certificados (organizacion_id, id)` | la FK compuesta impide asociar un certificado de otra organización (`23503`) |
| `es_representante_electronico` | `boolean` | default `false` | el SII solo entrega folios si el titular está registrado como representante electrónico de la empresa en sii.cl. La base no lo comprueba: lo declara el administrador |
| `predeterminado` | `boolean` | default `false` | índice único parcial `empresa_certificados_predeterminado_unico (empresa_id) where predeterminado` |
| `creado_en` | `timestamptz` | | |

Lo que hace la app: asociar inserta siempre con `predeterminado = false` y, si se pidió,
llama después a `fijar_certificado_predeterminado()` (son dos pasos: si el segundo falla,
la asociación queda sin predeterminado). «Dejar de ser predeterminado» y «representante»
son `update` directos; «quitar» es un `delete`. Solo se ofrecen para asociar los
certificados no revocados ni vencidos.

## `tokens_sii` 🔒

Implementación del `TokenStore` de la librería. La clave es la misma de `ClaveToken`.
RLS activo, sin políticas, y `revoke all` a `anon` y `authenticated`.

| Columna | Tipo | Notas |
|---|---|---|
| `canal` ✔ | `canal_sii` | `rest` o `soap` |
| `ambiente` ✔ | `ambiente_sii` | |
| `rut_empresa` ✔ | `rut` | |
| `huella_certificado` ✔ | `text` (`^[0-9a-f]{64}$`) | la del certificado que firmó la semilla. **Sin FK** a `certificados` |
| `token_cifrado` ✔ | `bytea` | AES-256-GCM `iv (12) ‖ ciphertext ‖ tag (16)`, con `SII_TOKENS_KEY` y el contexto de la fila como AAD |
| `vence_en` ✔ | `timestamptz` | obtención + `SEGUNDOS_VIGENCIA_TOKEN` (3000 s) |
| `actualizado_en` | `timestamptz` | lo actualiza `token_guardar` (no hay trigger) |

PK `(canal, ambiente, rut_empresa, huella_certificado)`; índice en `vence_en` para la
limpieza. La vigencia la valida la app con su reloj, como la librería. Los tokens
vencidos no se borran solos: el job de limpieza comentado al final de `0001`
(`delete … where vence_en < now() - interval '1 day'`) todavía no está programado.

## `sesiones_sii` 🔒

Cookies de `SesionSii` (AUT2000), para reutilizar la sesión: el SII frena el re-login
seguido (unos 5 ciclos, error `01.01.215.500.771.52`). Mismo blindaje que `tokens_sii`.

| Columna | Tipo | Notas |
|---|---|---|
| `certificado_id` ✔ | `uuid` | FK `certificados`, `on delete cascade` |
| `ambiente` ✔ | `ambiente_sii` | |
| `cookies_cifradas` ✔ | `bytea` | AES-256-GCM, igual que el token |
| `expira_en` | `timestamptz` | |
| `ultimo_uso_en`, `creado_en` | `timestamptz` | default `now()` |

PK `(certificado_id, ambiente)`. La escribe la capa SII de la Fase 4; hoy ningún código
la usa.

---

## Vista `v_certificados_estado`

`security_invoker`: aplica el RLS de quien consulta (cada organización ve solo los
suyos). Columnas: `id`, `organizacion_id`, `rut_titular`, `nombre_titular`, `cn`,
`vigente_desde`, `vigente_hasta`, `estado`, `dias_restantes`. No expone los
`*_secret_id`.

| `estado` | Condición (en este orden) |
|---|---|
| `revocado` | `revocado_en is not null` |
| `vencido` | `vigente_hasta < now()` |
| `por_vencer` | `vigente_hasta < now() + 30 días` |
| `vigente` | el resto (también si `vigente_hasta` es nulo) |

`dias_restantes = greatest(0, extract(day from vigente_hasta - now()))`: días completos
(trunca), nunca negativo; nulo si `vigente_hasta` es nulo.

Quién la usa: la página de certificados (`listarCertificados`, que completa con
`emisor_ca`, `pfx_legacy` y `revocado_en` desde `certificados`) y el Tablero
(`estadosCertificados`, solo `por_vencer` y `vencido`). `alertasCertificados()` arma un
`Alerta` `error` si hay vencidos y uno `aviso` si hay por vencer (el más próximo
primero); los revocados no avisan. Las alertas por correo (30, 15, 7 y 1 días) son de la
Fase 8.

## Verificación

- `supabase/verificaciones/0005_certificados_resoluciones.sql` (solo lectura): firmas,
  `security definer`/`invoker`, `search_path`, privilegios, que `certificados` siga sin
  políticas de escritura, `trg_borrar_secretos` y los índices parciales.
- `supabase/verificaciones/rls-fase3-empresas.sql` (escribe con `rollback`): 43
  comprobaciones por rol sobre estas tablas
  ([cómo correrla](../05-pruebas/probar-el-esquema.md)).

Las dos requieren la 0005 aplicada. Corridas en producción el 2026-11-13: 15/15 y 43/43.
