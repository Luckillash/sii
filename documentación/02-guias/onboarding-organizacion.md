---
title: "Onboarding: organización, miembros, plan, empresa y certificado"
description: "Alta del tenant, invitaciones, plan y límites, empresa emisora, certificado en Vault y resolución: pasos en la UI, qué pasa en el servidor y en la base, y errores típicos."
keywords: [onboarding, bienvenida, crear_organizacion, invitar, crear_invitacion, aceptar_invitacion, empresa, crearEmpresa, editarEmpresa, cambiarEstadoEmpresa, desactivar, registrarResolucion, registrar_resolucion, subirCertificado, registrar_certificado, analizarCertificado, revocarCertificado, eliminarCertificado, asociarCertificadoEmpresa, fijar_certificado_predeterminado, representante electrónico, predeterminado, tg_limite_empresas, getUser, confirmarSesion, pfx, p12, Vault]
related: ["01-fundamentos/tenancy-y-roles.md", "03-api-reference/rpc-organizacion.md", "03-api-reference/rpc-backend.md", "04-objetos/objetos-empresas-y-credenciales.md", "08-esquema-supabase/vault-y-secretos.md", "01-fundamentos/formatos-y-validaciones.md"]
source: ["supabase_saas_sii.sql §3 §4 §6", "supabase/migrations/0005_certificados_resoluciones.sql", "apps/web/src/app/bienvenida/", "apps/web/src/app/[org]/configuracion/", "apps/web/src/server/certificados/", "PLAN-SAAS.md Fases 2 y 3"]
---

# Onboarding: organización, miembros, plan, empresa y certificado

> **Úsalo cuando:** implementas el alta de un cliente o la carga del certificado.

Recorrido de un cliente nuevo hasta tener una empresa lista para certificarse ante el
SII. Las partes de organización y equipo son de la Fase 2 (en producción); las de
empresa, resolución y certificado son de la Fase 3: el código está escrito pero **sin
desplegar**; la migración `0005_certificados_resoluciones` (de la que dependen la
resolución, el certificado y el predeterminado) se aplicó en producción el 2026-11-13.

## Resumen

| # | Paso (UI) | Quién | Servidor | Base |
|---|---|---|---|---|
| 1 | Crear cuenta (`/crear-cuenta`) | cualquiera | `crearCuenta` (Turnstile + `signUp`) | `auth.users` → `trg_nuevo_usuario` crea `perfiles` |
| 2 | Crear organización (`/bienvenida`) | usuario sin organización | `crearOrganizacion` | `crear_organizacion()`: organización, suscripción `certificacion` en `prueba` (30 días), propietario |
| 3 | Invitar al equipo (`/<org>/configuracion/equipo`) | administradores | `invitar` (+ correo por Resend) | `crear_invitacion()`; al aceptar, `aceptar_invitacion()` |
| 4 | Agregar empresa (`/<org>/configuracion/empresas/nueva`) | administradores | `crearEmpresa` | `insert` en `empresas` (RLS + `tg_limite_empresas`) |
| 5 | Registrar resolución (ficha de la empresa) | administradores | `registrarResolucion` | `registrar_resolucion()` (0005) |
| 6 | Subir certificado (`/<org>/configuracion/certificados`) | administradores | `subirCertificado` (librería + `getUser()`) | `registrar_certificado()` (0005, `service_role`): Vault + fila |
| 7 | Asociar certificado a la empresa (`/<org>/configuracion/empresas/<id>/certificados`) | administradores | `asociarCertificadoEmpresa` | `insert` en `empresa_certificados` + `fijar_certificado_predeterminado()` (0005) |

El plan sugería un asistente `/bienvenida` de organización → empresa → certificado
(PLAN-SAAS §3.1). En el código, `/bienvenida` solo crea la organización y lleva al
Tablero; empresa, resolución y certificado se cargan desde **Configuración**, en
cualquier orden (el certificado puede subirse antes que la empresa y asociarse después).

Todas las Server Actions empiezan con `exigirMembresia(slug)` (sesión con `getClaims()`
y membresía) y revisan el rol con `puedeAdministrar()` para responder antes y con un
mensaje claro. La autoridad es la base: RLS, triggers y las RPC.

---

## 1. Cuenta (Fase 2)

`/crear-cuenta` pide nombre, correo y contraseña, verifica Turnstile y llama a
`supabase.auth.signUp` con `options.data.nombre` (lo copia `trg_nuevo_usuario` a
`perfiles.nombre`). Con «Confirm email» activo no hay sesión: la pantalla dice que
revises tu correo, y el enlace pasa por `/auth/callback` y termina en `/bienvenida`.
Si el correo ya tenía cuenta, Supabase responde igual que con uno nuevo y la app muestra
lo mismo (no revela qué correos existen).

## 2. Organización (Fase 2)

`/bienvenida`:

- Si el usuario ya es miembro de alguna organización, no ve el formulario: va a la última
  que abrió (`perfiles.ultima_organizacion`) o a la primera.
- Si llega con `?invitacion=<token>`, va a `/invitacion/<token>`.
- Si no, ve «Crea tu organización» (nombre y dirección). La dirección (slug) se sugiere
  desde el nombre (`sugerirSlug`) y se valida con el mismo patrón que la base
  (`^[a-z0-9][a-z0-9-]{1,62}$`), más una lista de direcciones reservadas.

`crearOrganizacion` llama a `crear_organizacion(p_nombre, p_slug)`, que en una
transacción crea la organización, la suscripción al plan **Certificación** en estado
`prueba` por 30 días y la membresía de **propietario**. Luego redirige a
`/<slug>/tablero`.

| Error | Mensaje en la UI |
|---|---|
| `23505` (slug repetido, es único en todo el SaaS) | «Esa dirección ya la usa otra organización. Prueba con otra.» |
| `23514` (check de slug o nombre) | «La dirección no es válida. Usa solo minúsculas sin tilde, números y guiones.» |
| `42501` (sin sesión) | «Tu sesión expiró. Vuelve a ingresar y crea la organización de nuevo.» |

## 3. Equipo (Fase 2)

En `/<org>/configuracion/equipo` un administrador invita con correo y rol (nunca
`propietario`). `invitar` revisa antes que la persona no sea ya miembro y que el plan
tenga cupo (aviso temprano: la base lo exige recién al aceptar), y llama a
`crear_invitacion()`. El token vuelve una sola vez y viaja en el enlace del correo
(Resend). Si no hay Resend configurado o el envío falla, la app muestra el enlace **una
vez** para copiarlo. El token nunca va a logs ni a Sentry.

La persona abre `/invitacion/<token>`: `ver_invitacion()` muestra organización, correo y
rol sin pedir sesión. Para aceptar necesita sesión con el **mismo correo**, Turnstile
(verificado en el servidor) y `aceptar_invitacion()`, que revisa el cupo de usuarios del
plan. Cambiar rol, quitar y salir siguen las reglas de
[tenancy y roles](../01-fundamentos/tenancy-y-roles.md#regla-del-último-propietario).
Contratos en [RPC de organización](../03-api-reference/rpc-organizacion.md).

### Plan y límites

La organización parte en Certificación (2 usuarios, 1 empresa, sin producción). El
cambio de plan y el cobro son de la Fase 10: hoy solo `service_role` cambia una
suscripción. Cupos y comportamiento sin suscripción vigente en
[tenancy y roles](../01-fundamentos/tenancy-y-roles.md#cupos-de-usuarios-y-empresas-por-plan).

---

## 4. Empresa (Fase 3)

**UI.** `Configuración → Empresas → Agregar empresa`. Si el plan no tiene cupo (o no hay
suscripción vigente), el botón no aparece y se muestra el aviso del plan. El formulario
pide:

| Campo | Regla (app) | Columna |
|---|---|---|
| RUT de la empresa | con `CampoRut`; acepta `76.354.771-k`, `76354771K`; se guarda `76354771-K`. **No se puede cambiar después** | `rut` |
| Razón social | 1–100 caracteres, solo ISO-8859-1 | `razon_social` |
| Giro | 1–80, sin abreviaciones, solo ISO-8859-1 | `giro` |
| Dirección | 1–70, solo ISO-8859-1 | `direccion` |
| Comuna | 1–20, solo ISO-8859-1 | `comuna` |
| Correo de intercambio (opcional) | regla `esValidoMail2` del SII, hasta 50 | `correo_intercambio` |

Detalle de cada regla en [formatos y validaciones](../01-fundamentos/formatos-y-validaciones.md#campos-de-la-empresa).

**Servidor** (`crearEmpresa`): rol → validación con `esquemaEmpresa` → aviso de cupo
(`cupoEmpresas`, lee la suscripción vigente y cuenta las empresas) → `insert` con el
cliente de sesión y el `organizacion_id` de la membresía. Redirige a la ficha con
`?creada=1` («Agregaste la empresa. Ahora registra su resolución del SII y asocia el
certificado digital…»).

**Base:** RLS `alta` (`es_admin`), `trg_10_limite_empresas` (cupo del plan),
`trg_05_proteger_autorizacion` (fuerza `autorizada_produccion = false`), checks de largo
y dominios.

**Ficha de la empresa** (`/<org>/configuracion/empresas/<id>`): todos los miembros la
ven; solo los administradores ven formularios y botones.

- **Editar** (`editarEmpresa`): todo menos el RUT. Si `count` es 0 (RLS filtró la fila o
  ya no existe): «No se aplicó el cambio».
- **Desactivar / activar** (`cambiarEstadoEmpresa`, con diálogo de confirmación al
  desactivar). No hay «eliminar»: el borrado arrastraría documentos, folios, envíos y
  resoluciones. Una empresa desactivada **sigue contando** para el cupo del plan, y por
  ahora ninguna regla de la base impide usarla (ver
  [trampas](../07-referencia/trampas-conocidas.md)).
- `autorizada_produccion` solo la marca el sistema cuando el SII aprueba la certificación
  (P91, Fase 5).

| Error | Mensaje en la UI |
|---|---|
| `23505` en el alta (RUT repetido en la organización) | «Ese RUT ya está registrado en la organización» (y el campo RUT marcado) |
| `El plan X permite como máximo N empresa(s)` | «El plan X permite hasta N empresa(s)». «Cambia de plan para agregar otra. Las empresas desactivadas también cuentan para el límite.» |
| `La organización no tiene una suscripción vigente` | «La organización no tiene un plan vigente». «Renueva el plan para agregar empresas.» |
| `autorizada_produccion solo la cambia el sistema…` | «La autorización a producción la marca el sistema» |
| `42501` | «No tienes permiso para hacer esto» |
| `23514`, `22P02`, `22007`, `22008` | «Los datos no son válidos». «Revisa los campos y vuelve a intentarlo.» |

## 5. Resolución (Fase 3, requiere la 0005)

**UI.** En la ficha, «Resoluciones del SII»: la vigente por ambiente, el formulario
(solo administradores) y el historial.

- **Certificación:** el SII entrega solo la fecha; el número va fijo en 0 (campo
  deshabilitado, no viaja en el formulario).
- **Producción:** el número y la fecha de la resolución que autoriza a emitir (número
  entero ≥ 1).
- La fecha no puede ser posterior a hoy (hora de Chile).
- Si ya hay una vigente en ese ambiente, el formulario avisa que pasará al historial.

**Servidor** (`registrarResolucion`): rol → `esquemaResolucion` → comprueba que la
empresa sea de la organización → `rpc('registrar_resolucion', …)` con la sesión. Éxito:
«Registraste la resolución N° 80 del 22-08-2014 para Producción. Ahora es la vigente.»

**Base:** `registrar_resolucion()` apaga la vigente de ese ambiente e inserta la nueva en
una transacción, con candado sobre la empresa
([contrato](../03-api-reference/rpc-organizacion.md#registrar_resolucion-migración-0005)).

| Error | Mensaje en la UI |
|---|---|
| `P0002` (empresa inexistente o ajena) | «No encontramos la empresa» |
| `42501` | «No tienes permiso para hacer esto» |
| `23514`, `22004` | «Revisa los datos de la resolución». «En certificación el número es 0; en producción, el número que te entregó el SII. La fecha es obligatoria.» |
| `23505` (carrera con otra resolución) | «Se registró otra resolución al mismo tiempo» |

## 6. Certificado (Fase 3, requiere la 0005)

**UI.** `Configuración → Certificados → Subir un certificado` (solo administradores):

1. Archivo `.pfx` o `.p12` (el navegador corta antes de enviar si pesa más de 100 KB).
2. Contraseña del certificado (`type="password"`, `autocomplete="off"`). Se borra del
   campo después de cada respuesta del servidor.
3. Opcional: empresa a la que asociarlo, con «El titular es representante electrónico» y
   «Usar como certificado predeterminado».
4. Solo si el servidor lo pide: **RUT del titular**.

**Servidor** (`subirCertificado`, página con `runtime = 'nodejs'`):

| Paso | Qué hace | Si falla |
|---|---|---|
| 1 | Rol administrador | «No tienes permiso para hacer esto» |
| 2 | Forma: archivo presente, ≤ 100 KB, extensión `.pfx`/`.p12`; contraseña presente y ≤ 256; RUT (si viene) con DV correcto; empresa (si viene) uuid | «Revisa los datos del certificado» con el campo marcado |
| 3 | `analizarCertificado(bytes, clave)`: comprueba que sea un PKCS#12, lo abre con `Certificado.desdeContenido` de la librería (MAC/clave, llave y certificado), lee la hoja y la vigencia | ver tabla de abajo |
| 4 | RUT del titular: el del certificado (otherName OID `1.3.6.1.4.1.8321.1` del subjectAltName o, si no, `serialNumber` del sujeto con guion) **manda**. Si no lo trae, se pide | «Escribe el RUT del titular» (aviso, no error) o «El RUT no coincide con el del certificado» |
| 5 | La empresa elegida es de la organización | «Los datos no son válidos» |
| 6 | `confirmarSesion()`: `supabase.auth.getUser()` contra Auth (una sesión revocada o un usuario borrado no pasa, aunque su JWT siga vigente) | «Tu sesión ya no es válida». «Por seguridad, vuelve a ingresar y repite la operación.» |
| 7 | `registrar_certificado()` con `service_role` y el `organizacion_id` de la membresía | ver tabla de abajo |
| 8 | Si se eligió empresa: asociación con la sesión (paso 7 del resumen). Si falla, el certificado **queda cargado** y se avisa | «El certificado quedó cargado, pero no pudimos asociarlo a la empresa…» |
| 9 | `bytes.fill(0)` en un `finally` | |

Éxito: «Cargaste el certificado de <titular>. Vence el dd-mm-aaaa.»

Cuando se pide el RUT, el formulario conserva el archivo elegido pero **no** la
contraseña: hay que volver a escribirla. El .pfx, su base64, la clave y el nombre del
archivo no vuelven al navegador, no se escriben en disco ni en Storage, y no van a logs
ni a Sentry (los logs de error llevan solo `error.code`). Detalle en
[vault y secretos](../08-esquema-supabase/vault-y-secretos.md).

Errores de la lectura del .pfx (`ErrorAnalisisCertificado`, mensajes fijos, sin `cause`):

| Motivo | Mensaje | Campo |
|---|---|---|
| `no_es_pfx` | «El archivo no es un certificado .pfx». «Elige el archivo .pfx o .p12 que te entregó la entidad certificadora (por ejemplo, E-Certchile o Acepta).» | archivo |
| `clave_incorrecta` | «La contraseña del certificado no es correcta». «…Respeta mayúsculas y minúsculas.» | contraseña |
| `danado` | «No pudimos leer el certificado». «El archivo está dañado o usa un formato no soportado…» | archivo |
| `vencido` | «El certificado está vencido». «Venció el dd-mm-aaaa. Renuévalo con tu entidad certificadora y sube el nuevo.» | archivo |
| `no_vigente` | «El certificado todavía no está vigente». «Empieza a regir el dd-mm-aaaa. Súbelo desde esa fecha.» | archivo |

Errores de la base (`traducirErrorCertificado(error, 'subir')`):

| Código | Mensaje |
|---|---|
| `23505` (misma huella en la organización) | «Ese certificado ya está cargado en la organización». «Lo encuentras en la lista de certificados…» |
| `23503` | «El certificado o la empresa ya no existen» |
| `42501` | «No tienes permiso para hacer esto» |
| `22023`, `23514`, `22P02` | «Los datos del certificado no son válidos». «Revisa el RUT del titular y vuelve a intentarlo.» |
| otro (incluido `42883` mientras la 0005 no esté aplicada) | «No pudimos completar la operación» |

**Base:** `registrar_certificado()` guarda el .pfx y la clave en Vault y crea la fila en
una transacción ([contrato](../03-api-reference/rpc-backend.md#registrar_certificado-migración-0005)).

### Revocar y eliminar

En la tabla de certificados, solo administradores y con diálogo de confirmación. Las dos
confirman la sesión con `getUser()` y escriben con `service_role` filtrando por
`organizacion_id` e `id`.

- **Revocar** (`revocarCertificado`): `revocado_en = now()` (solo si no estaba revocado).
  Queda en la lista como «Revocado», con su archivo y su contraseña en Vault. No se puede
  deshacer. No quita sus asociaciones con empresas.
- **Eliminar** (`eliminarCertificado`): borra la fila; `trg_borrar_secretos` borra los
  dos secretos de Vault y la cascada, sus asociaciones y `sesiones_sii`. Los tokens del
  SII ya obtenidos con él no se borran: vencen solos en menos de una hora.

Si el `update` o el `delete` no afecta filas: «No se aplicó el cambio».

## 7. Asociar certificado y empresa (Fase 3)

`/<org>/configuracion/empresas/<id>/certificados`. Se pueden asociar los certificados de
la organización que no estén revocados ni vencidos. Opciones:

- **Representante electrónico:** el SII solo entrega folios si el titular está
  registrado como representante electrónico de la empresa en sii.cl. La casilla solo lo
  declara; la app no hace ningún trámite ni lo verifica.
- **Predeterminado:** el certificado que se usará por omisión. Uno por empresa.

Todo va con el cliente de sesión (RLS de administrador en `empresa_certificados`), tras
comprobar que la empresa y el certificado son de la organización. Asociar inserta con
`predeterminado = false` y, si se pidió, llama a `fijar_certificado_predeterminado()`.
«Dejar de ser predeterminado» y «representante» son `update` directos; «quitar» borra la
asociación («El certificado ya no firma por esta empresa. Sigue cargado en la
organización.»).

| Error | Mensaje |
|---|---|
| `23505` (ya asociado) | «Ese certificado ya está asociado a la empresa» |
| `23503` (certificado de otra organización, o borrado) | «El certificado o la empresa ya no existen» |
| `P0002` o 0 filas | «No se aplicó el cambio» |
| `42501` | «No tienes permiso para hacer esto» |

## Avisos de vencimiento

El Tablero y la página de certificados leen `v_certificados_estado` y muestran un
`Alerta` `error` si hay certificados vencidos y uno `aviso` si alguno vence en los
próximos 30 días (con el enlace «Cargar certificado» para administradores o «Ver
certificados» para el resto). Si la lectura falla, el Tablero se muestra igual, sin
avisos. Los correos de aviso (30, 15, 7 y 1 días) llegan en la Fase 8.

## Verificación

- `supabase/verificaciones/rls-fase3-empresas.sql`: simulación por rol con `rollback`
  de empresas, resoluciones, certificados, predeterminado, borrado de secretos y la
  vista ([cómo correrla](../05-pruebas/probar-el-esquema.md)). Requiere la 0005.
- Pruebas de Vitest: `esquemas.test.ts` (empresas y resoluciones),
  `empresas-errores.test.ts`, `certificados/acciones.test.ts`,
  `server/certificados/analizar.test.ts` (con material de prueba de `test/pfx-prueba.ts`
  y los .pfx de `packages/certificacion/paridad/material/`) y `estado.test.ts`.
- Pendiente para cerrar la Fase 3 (criterio del plan): subir un `.pfx` real en
  *Production* y comprobar la fila, los dos secretos en Vault y ningún rastro del archivo
  ni de la clave en logs ni en Sentry.
