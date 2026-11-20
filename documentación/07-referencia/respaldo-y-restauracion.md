---
title: "Respaldo, restauración y rotación de SII_TOKENS_KEY"
description: "Estado real de los respaldos de Supabase (PITR apagado, respaldos físicos diarios de 7 días), qué restaura y qué no (Storage, Auth, Vault, pg_cron), los peligros de restaurar en el mismo proyecto para Boletéame (folios, envíos, idempotencia), el simulacro seguro de restauración a un proyecto nuevo con supabase/verificaciones/, y la rotación de SII_TOKENS_KEY sin caída."
keywords: [respaldo, backup, PITR, point in time recovery, WAL-G, restaurar, restore to new project, clonar proyecto, supabase backups list, pitr_enabled, RPO, RTO, Storage, documentos-xml, Vault, Auth, pg_cron, pg_net, cron.unschedule, siguiente_folio, folios duplicados, api_idempotencia, SII_TOKENS_KEY, rotación, AES-256-GCM, tokens_sii, sesiones_sii, ErrorCifrado, Fase 13]
related: ["07-referencia/runbooks.md", "07-referencia/checklist-produccion.md", "08-esquema-supabase/vault-y-secretos.md", "08-esquema-supabase/despliegue.md", "01-fundamentos/ambientes-y-credenciales.md", "01-fundamentos/autenticacion-sii.md"]
source: ["PLAN-SAAS.md §4.4, §10 y Fase 13", "supabase backups list (CLI 3.1.0), 2026-11-19", "https://supabase.com/docs/guides/platform/backups", "https://supabase.com/docs/guides/platform/clone-project", "https://supabase.com/docs/guides/database/vault", "apps/web/src/server/cifrado.ts", "apps/web/src/server/sii/token-store-supabase.ts", "apps/web/src/server/sii/sesiones.ts", "apps/web/src/server/certificacion/dependencias.ts", "apps/web/src/server/seguimiento/dependencias.ts", "supabase/migrations/0014_cron.sql"]
---

# Respaldo, restauración y rotación de `SII_TOKENS_KEY`

> **Úsalo cuando:** vas a activar PITR, probar o hacer una restauración, migrar con
> respaldo previo, o rotar la llave de cifrado de los tokens del SII.

Hay **una sola base, la de producción** (principio 6 del plan): un error de desarrollo o
una migración mala toca datos reales. Por eso el respaldo es parte del lanzamiento
(Fase 13, punto 3).

## Estado actual (comprobado el 2026-11-19)

Con `npx supabase backups list --remote=rbrntkztzijaxsnpgpqn` (solo lectura):

| Dato | Valor |
|---|---|
| Proyecto | `SII` (`rbrntkztzijaxsnpgpqn`), región `us-east-1`, Postgres 17.11 |
| Respaldos físicos (WAL-G) | sí (`walg_enabled: true`) |
| **PITR** | **apagado** (`pitr_enabled: false`) |
| Respaldos diarios | 8, uno por día a las ~10:12 UTC, del 12-11 al 19-11 (retención de 7 días: plan Pro) |
| Tamaño de la base | 17 MB |
| Storage | 1 bucket privado, `documentos-xml` (12 objetos) |
| Vault | 5 secretos |
| pg_cron | 8 jobs: `alertas`, `entregar-webhooks`, `limpiar-api-idempotencia`, `limpiar-historial-cron`, `limpiar-tokens-sii`, `limpiar-webhook-entregas`, `seguimiento-envios`, `sincronizar-suscripciones` |

**Consecuencia: hoy se puede perder hasta un día de datos** (RPO ≈ 24 h). Las «horas
previas para PITR» anotadas antes de las migraciones de las Fases 10 y 11 (p. ej.
2026-11-18 17:01:47 UTC) **no sirven** mientras PITR esté apagado: solo se puede volver al
respaldo diario anterior.

**Cómo comprobarlo de nuevo:** el comando de arriba (`pitr_enabled`), o el panel →
*Database → Backups* (pestañas *Scheduled backups* y *Point in time*), o
`GET https://api.supabase.com/v1/projects/<ref>/database/backups` con un token de la
cuenta.

## PITR

Fuente: [documentación de respaldos de Supabase](https://supabase.com/docs/guides/platform/backups).

- **Qué es.** Respaldo físico diario + archivo continuo del WAL (WAL-G). Permite restaurar
  a cualquier segundo dentro de la ventana. RPO en el peor caso: **2 minutos** (el WAL se
  sube cada 2 minutos, o antes si hay mucho movimiento).
- **Requisitos.** Plan Pro o superior (lo hay) y **compute Small o mayor** (revisar en
  *Settings → Compute and Disk*; si es Micro, hay que subirlo y se cobra aparte).
- **Ventana y costo** (add-on, aprox.): 7 días ≈ US$ 100/mes; 14 días ≈ US$ 200/mes; 28
  días ≈ US$ 400/mes. Para el piloto basta con 7 días.
- **Al activarlo, Supabase deja de tomar los respaldos diarios** (PITR los reemplaza).
- **Restaurar a una hora** (en el mismo proyecto): panel → *Database → Backups → Point in
  time → Start a restore*, elegir fecha y hora dentro de la ventana y confirmar. Por API:
  `POST /v1/projects/<ref>/database/backups/restore-pitr` con
  `{"recovery_time_target_unix": "<epoch>"}`. **El proyecto queda inaccesible** mientras
  dura (depende del tamaño).
- **Restaurar en un proyecto nuevo**: panel → *Database → Backups → Restore to a New
  Project*, elegir un respaldo (o la hora, con PITR). Crea un proyecto nuevo en la misma
  región con el mismo compute y disco (se cobra aparte) y deja intacto el original.
  Un proyecto restaurado no puede ser a su vez origen de otra restauración
  ([clonar](https://supabase.com/docs/guides/platform/clone-project)).

## Qué restaura y qué no

| Pieza | Restauración en el mismo proyecto | Restauración en un proyecto nuevo |
|---|---|---|
| Tablas, funciones, RLS, triggers, datos | sí, al punto elegido | sí |
| `auth.users` y demás del esquema `auth` | sí, al punto: las cuentas creadas después **se pierden** | sí |
| Configuración de Auth (SMTP de Resend, plantillas, Turnstile, URLs, claves API, llaves JWT) | no se toca (no vive en la base) | **no se copia**: hay que configurarla a mano; las claves API y llaves JWT son otras |
| **Storage** (archivos de `documentos-xml`) | **no**: los respaldos solo tienen los metadatos (`storage.objects`). Lo borrado después del respaldo no vuelve, y lo subido después queda como archivo sin metadatos (huérfano, no se lista por la API) | **no se copia** (ni archivos ni configuración del bucket) |
| Vault (`vault.secrets`) | sí, y descifra (misma llave del proyecto, que Supabase guarda fuera de la base) | las filas se copian; **comprobar que descifran** en el simulacro (abajo) |
| pg_cron y pg_net (`cron.job`) | sí, los jobs del punto elegido | sí, **y empiezan a correr**: llaman a `https://boleteame.dev/api/cron/*` con el `cron_token` copiado. Hay que apagarlos al tiro |
| `tokens_sii`, `sesiones_sii` | sí; descifran si `SII_TOKENS_KEY` no cambió (si no, se piden de nuevo) | ídem |
| Variables de Vercel, Sentry, Flow, Resend | no se tocan | no se tocan |

## Restaurar en el mismo proyecto: peligros para Boletéame

Es el **último recurso** (p. ej. la base quedó inutilizable). Todo lo escrito después del
punto elegido se pierde, y eso no es neutro en este sistema:

1. **Folios.** `cafs.siguiente_folio` vuelve atrás. Si se reabre la emisión, la app
   reasigna folios **que ya se enviaron al SII** después del punto: boletas duplicadas o
   rechazadas. Antes de volver a emitir en producción, por cada CAF activo con movimiento
   después del punto hay que saber el último folio usado (portal del SII o registros del
   cliente). Si no se puede saber, anular la cola completa del CAF y timbrar uno nuevo. No
   existe una RPC para adelantar `siguiente_folio` (**pendiente de decidir** si se agrega).
2. **Envíos y documentos.** Las boletas emitidas después del punto desaparecen de la base
   (el SII sí las tiene) y sus XML/PDF quedan huérfanos en Storage. El seguimiento no las
   consulta y los clientes no las ven.
3. **Idempotencia de la API.** `api_idempotencia` vuelve atrás: un cliente que repita una
   petición con la misma `Idempotency-Key` **emitiría de nuevo**. Avisar a los clientes de
   la API.
4. **Inciertos.** Las operaciones `incierto` posteriores se pierden y con ellas sus
   bloqueos.
5. **Suscripciones y pagos.** Flow es la fuente de verdad: la corrida horaria corrige el
   estado de las suscripciones que existen en la base, pero una contratación hecha después
   del punto (con su `id_externo`) se pierde y hay que reconciliarla con Flow a mano.
6. **Cuentas y organizaciones** creadas después del punto: se pierden (tienen que volver a
   registrarse).
7. **Webhooks**: las entregas pendientes posteriores se pierden; algunas ya entregadas se
   pueden volver a encolar.

Hoy no hay modo mantenimiento para cortar la emisión mientras se reconcilia
(**pendiente**). Mientras tanto, la opción es pausar el proyecto de Vercel durante la
restauración y la reconciliación.

Para un error **lógico** acotado (una tabla borrada, una migración mala) es mejor
restaurar en un proyecto nuevo y **copiar de vuelta solo lo dañado**, con una migración o un
script revisado.

## Simulacro de restauración (a un proyecto nuevo)

Procedimiento seguro para probar que el respaldo sirve, sin tocar producción. **Lo hace el
usuario** (crea un proyecto que se cobra mientras exista). Duración estimada: menos de una
hora con una base de 17 MB.

1. **Anotar** la hora de inicio y el respaldo elegido (id de `supabase backups list`).
   Antes, contar filas en producción para comparar (solo lectura):

   ```sql
   select 'organizaciones' t, count(*) from public.organizaciones
   union all select 'empresas', count(*) from public.empresas
   union all select 'cafs', count(*) from public.cafs
   union all select 'documentos', count(*) from public.documentos
   union all select 'envios', count(*) from public.envios
   union all select 'operaciones_sii', count(*) from public.operaciones_sii
   union all select 'auth.users', count(*) from auth.users
   union all select 'vault.secrets', count(*) from vault.secrets
   union all select 'storage.objects', count(*) from storage.objects;
   ```

2. Panel del proyecto `SII` → *Database → Backups → Restore to a New Project* → elegir el
   respaldo más reciente → revisar el costo → *Restore*.
3. **Apenas exista el proyecto nuevo**, en su SQL Editor, apagar los jobs (llaman a
   producción con un Bearer válido):

   ```sql
   select cron.alter_job(jobid, active := false) from cron.job;
   select count(*) from cron.job where active;  -- 0
   ```

   Se desactivan en vez de borrarlos para que las verificaciones de los jobs sigan
   pudiendo revisar sus definiciones.

   El proyecto nuevo contiene los secretos de Vault (certificados `.pfx` y sus claves, CAF
   con su llave privada, `cron_token`): tratarlo como producción. No conectarle Vercel, no
   compartir sus claves y borrarlo al terminar.
4. **Verificaciones del esquema** (solo lectura), contra el proyecto nuevo:

   ```sh
   npx supabase db query --remote=<ref-nuevo> --read-only -f supabase/verificaciones/0001_esquema.sql
   ```

   Repetir con cada `supabase/verificaciones/00NN_*.sql` (de `0001` a `0019`). Todas
   deben dar `ok = true`, salvo lo esperado: la comprobación de jobs `active` de
   `0014_cron.sql` y `0019_cron_webhooks.sql` falla porque se acaban de desactivar (y la 10
   de `0014` ya da `false` en producción), y las que descifran `cron_token` necesitan el rol
   `postgres` (SQL Editor), como en producción: esas, además, prueban que Vault descifra.
   Las simulaciones `rls-*.sql` (con `rollback`) son opcionales.
5. **Integridad**: los mismos conteos del paso 1 (iguales o menores, según la hora del
   respaldo) y que Vault descifra, sin leer valores:

   ```sql
   select count(*) as total,
          count(*) filter (where decrypted_secret is not null) as descifran
   from vault.decrypted_secrets;
   ```

   Si `descifran` < `total`, una restauración a un proyecto nuevo **no sirve para los
   certificados ni los CAF**: anotarlo, porque cambia el plan de recuperación (habría que
   restaurar en el mismo proyecto o volver a subir certificados y CAF).
6. **Anotar** la duración total (es el RTO real), el respaldo usado y los resultados en
   el [checklist](checklist-produccion.md#lanzamiento-fase-13).
7. **Borrar el proyecto nuevo** (*Settings → General → Delete project*).

## Respaldo de Storage (pendiente)

Ningún respaldo de la base incluye los archivos de `documentos-xml` (XML de cada DTE, sobres
`EnvioBOLETA` y PDF). Supabase los guarda de forma durable, pero un borrado es definitivo.
El emisor está obligado a conservar sus documentos tributarios hasta seis años
([revisión legal](revision-legal.md)); aunque la obligación es del contribuyente, perderlos
sería grave. Opciones, por decidir: copia periódica con la API compatible con S3 de Supabase
Storage (claves S3 del proyecto, p. ej. con `rclone`) a un bucket externo con versionado, o
un job que la haga. **Pendiente de decisión del usuario.**

## Rotación de `SII_TOKENS_KEY`

### Qué cifra

`apps/web/src/server/cifrado.ts`: AES-256-GCM, `iv (12) ‖ ciphertext ‖ tag (16)`, con el
contexto de la fila como datos autenticados. La llave sale de `SII_TOKENS_KEY` (32 bytes en
base64; `leerLlave` exige el largo) y la leen `server/certificacion/dependencias.ts` y
`server/seguimiento/dependencias.ts`. Cifra **solo** dos cosas:

| Columna | Qué es | Vida |
|---|---|---|
| `tokens_sii.token_cifrado` | token REST o SOAP del SII (`TokenStoreSupabase`, `server/sii/token-store-supabase.ts`) | 50 min (`SEGUNDOS_VIGENCIA_TOKEN`); el job `limpiar-tokens-sii` borra los vencidos cada hora |
| `sesiones_sii.cookies_cifradas` | cookies AUT2000 (`SesionesSupabase`, `server/sii/sesiones.ts`) | hasta `expira_en` |

No cifra los `.pfx`, las claves, los CAF, el `cron_token` ni los secretos de webhooks (están
en **Vault**, con la llave de Supabase), ni las API keys (solo su SHA-256).

### Por qué se puede rotar sin caída

Los dos son **cachés descartables**: si una fila no descifra, `obtener()` devuelve
`undefined` (`catch` en `token-store-supabase.ts` y en `sesiones.ts`, «Llave rotada…: es un
caché») y la capa pide un token nuevo o vuelve a hacer login, y guarda la fila cifrada con la
llave actual. No hay anillo de llaves: durante el cambio conviven instancias con la llave vieja
y con la nueva, y cada una ve las filas de la otra como ausentes y las reemplaza. Se arregla
solo. Lo único que cuesta es pedir semillas y tokens otra vez y repetir los login AUT2000; el
SII puede frenar muchos re-login seguidos (riesgo de §10), así que conviene rotar en un
horario tranquilo y no en medio de un paso de certificación o de un timbraje.

**Importante:** el desarrollo local usa la misma base. Si `apps/web/.env.local` queda con la
llave vieja, cada ejecución local invalida los cachés de producción (y al revés). Las dos se
cambian juntas.

### Pasos (los hace el usuario)

1. Generar la llave nueva en una terminal propia (no pegarla en chats, tickets ni logs):

   ```sh
   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
   ```

2. Vercel → proyecto `sii` → *Settings → Environment Variables* → `SII_TOKENS_KEY`
   (*Production*, *Sensitive*) → reemplazar el valor.
3. Redesplegar *Production* (una variable nueva solo se aplica en un deploy nuevo):
   *Deployments* → el deploy actual → *Redeploy*.
4. Cambiar la misma variable en `apps/web/.env.local`.
5. No hace falta borrar `tokens_sii` ni `sesiones_sii` (se reemplazan solas). Borrarlas es
   una escritura en producción: solo con OK y no aporta.
6. Verificar: la siguiente corrida de `seguimiento` queda `ok`
   (`select resultado, terminada_en from public.operaciones_sii where operacion = 'seguimiento' order by iniciada_en desc limit 3;`)
   y no aparece en Sentry un `ErrorCifrado` «SII_TOKENS_KEY debe tener 32 bytes…» (llave mal
   copiada: falla toda operación con el SII y hay que corregirla y redesplegar).

No hay vuelta atrás que hacer: si la llave nueva estuviera mal, se pone otra correcta y se
redespliega; los cachés se regeneran igual.

**Cuándo rotar:** sospecha de filtración (la llave sola no basta: hace falta además leer la
base, y un token robado dura 50 minutos), salida de alguien con acceso a las variables de
Vercel, o una vez al año.

## Pendientes del usuario

- [ ] Decidir y activar PITR (7 días) y, si hace falta, subir el compute a Small.
- [ ] Hacer el [simulacro](#simulacro-de-restauración-a-un-proyecto-nuevo) y anotar el
      resultado (incluido si Vault descifra en el proyecto nuevo).
- [ ] Decidir el respaldo de Storage.
- [ ] Decidir si se agrega un modo mantenimiento y una forma de adelantar `siguiente_folio`
      para una restauración en el mismo proyecto.
