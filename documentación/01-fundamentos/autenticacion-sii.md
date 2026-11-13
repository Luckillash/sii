---
title: "Autenticación ante el SII: semilla/token y sesión AUT2000"
description: "Obtención y caché del token (tokens_sii, TokenStoreSupabase), sesión AUT2000 reutilizable (sesiones_sii, conSesionReutilizada) y bloqueo con arriendo por certificado (bloqueos_sii)."
keywords: [semilla, token, TokenStore, TokenStoreSupabase, ClaveToken, TokenGuardado, SEGUNDOS_VIGENCIA_TOKEN, obtenerToken, olvidarToken, huellaCertificado, contextoToken, token_obtener, token_guardar, token_borrar, ErrorTokenStore, AUT2000, SesionSii, aArreglo, desdeArreglo, SesionesSupabase, AlmacenSesiones, claveSesion, contextoSesion, conSesionReutilizada, SesionCaducaError, ErrorSesiones, expira_en, ultimo_uso_en, 01.01.215.500.771.52, re-login, bloqueo, arriendo, conBloqueoCertificado, BloqueoOcupadoError, ErrorBloqueo, tomar_bloqueo_certificado, liberar_bloqueo_certificado, bloqueos_sii, advisory lock, pg_try_advisory_xact_lock, reentrante, SII_TOKENS_KEY, AAD]
related: ["01-fundamentos/ambientes-y-credenciales.md", "09-libreria/backend-service-role.md", "03-api-reference/rpc-backend.md", "04-objetos/objetos-empresas-y-credenciales.md", "08-esquema-supabase/vault-y-secretos.md", "07-referencia/trampas-conocidas.md"]
source: ["supabase_saas_sii.sql §6 §15", "supabase/migrations/0007_bloqueos_sii.sql", "apps/web/src/server/sii/token-store-supabase.ts", "apps/web/src/server/sii/sesiones.ts", "apps/web/src/server/sii/bloqueos.ts", "packages/certificacion/packages/core/src/comun/token-store.ts", "packages/certificacion/packages/core/src/folios/solicitud-folios.ts", "certificacion-node/docs/canales.md", "certificacion-node/docs/folios.md"]
---

# Autenticación ante el SII: semilla/token y sesión AUT2000

> **Úsalo cuando:** implementas o depuras tokens o la sesión de folios y certificación.

El SII tiene dos formas de autenticar, según el canal:

| Mecanismo | Para qué | Quién lo hace | Dónde se guarda | Clave de la fila |
|---|---|---|---|---|
| **Semilla → token** | REST de boleta (envío y consulta) y SOAP DTEWS | `ClienteBoletaRest` / `ClienteDtews` de la librería, con un `TokenStore` (opción `tokenStore`) | `tokens_sii` 🔒 (cifrado) | `(canal, ambiente, rut_empresa, huella_certificado)` |
| **Sesión AUT2000** (cookies, login con certificado por TLS mutuo) | asistentes del portal: solicitud de folios, postulación, set de pruebas, declaración | `SolicitudFolios.autenticar()` / `PostulacionSii.autenticar()` de la librería | `sesiones_sii` 🔒 (cifrado) | `(certificado_id, ambiente)` |

Las dos credenciales se cifran en la app con AES-256-GCM y `SII_TOKENS_KEY`, con el
contexto de la fila como datos autenticados (AAD): una copiada a otra fila no descifra
([cifrado](ambientes-y-credenciales.md#cifrado-de-tokens-y-cookies)). Las dos son un
**caché**: si no descifra o venció, se pide de nuevo sin pérdida. Ninguna aparece en
mensajes de error, logs, Sentry ni `operaciones_sii`.

Todo vive en `apps/web/src/server/sii/` (`import 'server-only'`, runtime Node.js) y usa el
cliente `service_role`.

## Token del SII (`TokenStoreSupabase`)

`server/sii/token-store-supabase.ts` implementa el `TokenStore` de la librería sobre las
RPC `token_obtener` / `token_guardar` / `token_borrar` (solo `service_role`,
[RPC del backend](../03-api-reference/rpc-backend.md#token_obtener-token_guardar-token_borrar)).

```ts
new TokenStoreSupabase(cliente: ClienteServicio, llave: Buffer)
  obtener(clave: ClaveToken): Promise<TokenGuardado | undefined>
  guardar(clave: ClaveToken, guardado: TokenGuardado): Promise<void>
  borrar(clave: ClaveToken): Promise<void>

contextoToken(clave: ClaveToken): string   // AAD: JSON.stringify([canal, ambiente, rutEmpresa, huellaCertificado])
```

`ClaveToken` (librería): `canal` (`'rest' | 'soap'`), `ambiente`, `rutEmpresa` (con guion y
DV en mayúscula, `76354771-K`) y `huellaCertificado` (sha256 hex del DER de la hoja,
`huellaCertificado()` de la librería; es la misma `huellaSha256` que entrega
`credenciales.ts`). El token queda atado al certificado que firmó la semilla.

**Ciclo** (lo hace la librería en `obtenerToken(rutEmpresa)`, no la app):

1. `tokenStore.obtener(clave)`. Si hay token y el reloj está antes de `venceEn`, lo usa.
2. Si no: pide semilla, la firma, pide token y lo guarda con
   `venceEn = ahora + SEGUNDOS_VIGENCIA_TOKEN` (3000 s, 50 min).
3. Dos llamadas simultáneas **en el mismo cliente** comparten el pedido. Entre
   peticiones HTTP distintas no hay coordinación: cada una puede pedir su token (no
   hace daño; gana el último `guardar`).
4. Si el SII rechaza un token antes de que venza, `olvidarToken(rutEmpresa)` lo borra.

Comportamiento de `TokenStoreSupabase`:

- `obtener` devuelve `undefined` si no hay fila, si `vence_en` no es una fecha válida o si
  no descifra (llave rotada, fila alterada o copiada de otra clave). **No valida la
  vigencia**: eso lo hace la librería con su reloj.
- Los errores de Supabase lanzan `ErrorTokenStore` con un mensaje fijo y, como mucho, el
  código de PostgREST (`No se pudo leer el token del SII en Supabase (código 57014).`):
  nunca el token ni el `details` de la fila. En `ejecutarOperacion` eso termina en
  `error` (código 1) con mensaje genérico.

Cuidados:

- `tokens_sii` **no tiene `organizacion_id` ni FK a `certificados`**: dos organizaciones
  con la misma empresa y el mismo certificado comparten la fila; eliminar un
  certificado no borra sus tokens (vencen solos en 50 min). La limpieza periódica de
  tokens vencidos todavía no está programada
  ([despliegue](../08-esquema-supabase/despliegue.md#tareas-programadas)).
- La llave se lee con `leerLlave(process.env.SII_TOKENS_KEY)` de `server/cifrado.ts`
  (exige 32 bytes en base64 y no incluye la llave en sus mensajes).

## Sesión AUT2000 (`sesiones.ts`)

El login AUT2000 (`herculesr.sii.cl` / `zeusr.sii.cl`, compartidos entre ambientes) se hace
con el certificado como cliente TLS. **El SII frena el re-login seguido** con el mismo
certificado (unos 5 ciclos, error `01.01.215.500.771.52`): la sesión se guarda y se
reutiliza mientras sirva, como recomienda `SolicitudFolios.autenticar` de la librería.

Las cookies son una credencial: con ellas se timbran folios **sin el certificado**.

### `SesionesSupabase`

```ts
new SesionesSupabase(cliente: ClienteServicio, llave: Buffer, opciones?: { reloj?: Reloj })
  obtener(clave: ClaveSesion): Promise<SesionSii | undefined>
  guardar(clave: ClaveSesion, sesion: SesionSii, expiraEn?: Date | null): Promise<void>
  descartar(clave: ClaveSesion): Promise<void>

claveSesion(credenciales: { certificadoId: string }, ambiente: Ambiente): ClaveSesion
contextoSesion(clave: ClaveSesion): string   // AAD: JSON.stringify(['sesiones_sii', certificadoId, ambiente])
```

`AlmacenSesiones` es la interfaz que implementa (la que recibe `conSesionReutilizada`; en
pruebas se reemplaza por un almacén en memoria).

| Método | Qué hace |
|---|---|
| `obtener` | lee `cookies_cifradas` y `expira_en`. Devuelve `undefined` si no hay fila, si `expira_en` ya pasó, si no descifra, si el JSON no es un arreglo o si quedan 0 cookies. Si sirve, actualiza `ultimo_uso_en` (informativo: si falla, la sesión se entrega igual) |
| `guardar` | cifra `sesion.aArreglo()` y hace `upsert` por `(certificado_id, ambiente)`. `expiraEn`: un `Date` o `null` lo fijan; `undefined` conserva el de la fila (o `null` si es nueva). Una sesión **sin cookies no se guarda**: se descarta la fila |
| `descartar` | borra la fila |

Los errores de Supabase lanzan `ErrorSesiones` con mensaje fijo y solo el código
(`No se pudo guardar la sesión del SII en Supabase (código …).`).

**Por qué `claveSesion` recibe las credenciales y no un id suelto.** `sesiones_sii` no
tiene `organizacion_id`: su clave es el certificado. El `certificadoId` tiene que venir de
un certificado ya cargado con `crearCredenciales()`, que lo leyó filtrando por
organización. Así nadie arma la clave con un id que llegó de un formulario.

### `conSesionReutilizada`

```ts
conSesionReutilizada<T>(opciones: {
  sesiones: AlmacenSesiones;
  clave: ClaveSesion;
  autenticar: () => Promise<SesionSii>;          // p. ej. () => folios.autenticar(cred.certificado)
  usar: (sesion: SesionSii) => Promise<T>;       // p. ej. (s) => folios.solicitar(s, rut, 39, 5)
  expiraEn?: () => Date | null;                  // expira_en de una sesión nueva; sin él, null
}): Promise<T>
```

Flujo:

1. `sesiones.obtener(clave)`. Si hay sesión guardada, `usar(guardada)`.
2. Si `usar` lanza **`SesionCaducaError`** con la guardada: la descarta, **autentica una
   vez** y reintenta con la nueva. Cualquier otro error sube tal cual (y las cookies se
   guardan al día: la sesión no se invalida por un rechazo).
3. Sin sesión guardada: `autenticar()`, guarda **apenas autentica** (si la función se
   corta, la próxima petición no vuelve a hacer login) y `usar(nueva)`.
4. Después de `usar` vuelve a guardar: el SII puede renovar cookies en la navegación.
5. Con la sesión recién creada no hay reintento: si también caduca, el error sube.

Por qué reintentar es seguro: la librería lanza `SesionCaducaError` **solo antes** de la
orden irreversible (timbrar, grabar la declaración); desde ahí cualquier falla llega como
`FoliosSinCafError` o `DeclaracionInciertaError` (resultado `incierto`). Si
`SesionCaducaError` llegara a escapar, es `rechazo_sii` (hereda de
`ErrorSolicitudFolios`).

Los guardados y el descarte **nunca lanzan**: si `usar` ya timbró folios, perder el
resultado por un caché sería peor que volver a autenticar la próxima vez. Sí lanzan
`sesiones.obtener`, `autenticar` y `usar`.

`conSesionReutilizada` **debe correr dentro del bloqueo del certificado** (abajo): si no,
dos peticiones sin sesión vigente autentican a la vez y gastan intentos, o una pisa las
cookies de la otra.

## Bloqueo con arriendo por certificado (`bloqueos.ts`)

`conBloqueoCertificado()` serializa **entre peticiones HTTP** las operaciones que abren o
reutilizan una sesión AUT2000 con el mismo certificado y ambiente. Dos pestañas, un doble
clic o un cron y un usuario a la vez quedan en fila.

```ts
conBloqueoCertificado<T>(
  cliente: ClienteServicio,
  clave: { certificadoId: string; ambiente: AmbienteSii },
  fn: () => Promise<T>,
  opciones?: {
    segundos?: number;     // arriendo, entero 1..900 (por defecto SEGUNDOS_ARRIENDO = 300)
    esperaMs?: number;     // espera total (por defecto ESPERA_MS = 20_000; 0 = un intento)
    intervaloMs?: number;  // pausa entre intentos (por defecto INTERVALO_MS = 1_000)
    titular?: string;      // uuid del titular (por defecto randomUUID() por llamada)
    dormir?: (ms: number) => Promise<void>;  // pruebas
  },
): Promise<T>
```

1. Valida `segundos` (fuera de 1..900: `RangeError`, sin llamar a Supabase).
2. Llama a `tomar_bloqueo_certificado` hasta `floor(esperaMs / intervaloMs) + 1` veces,
   con una pausa de `intervaloMs` entre intentos.
3. Si nunca lo obtiene: **`BloqueoOcupadoError`** sin ejecutar `fn` ni liberar. Se traduce
   a `transporte` (código 4: nada salió al SII y basta con reintentar en un momento),
   con su propio mensaje: «Hay otra operación con el SII en curso con este certificado.
   El SII no permite usar el mismo certificado en dos operaciones a la vez. Espera a que
   termine la otra (puede tardar unos minutos) y vuelve a intentarlo.»
4. Si la RPC devuelve error: **`ErrorBloqueo`** (solo el código de PostgREST), sin
   ejecutar `fn`. Termina en `error` (código 1).
5. Ejecuta `fn` y, **siempre** (también si lanza), llama a `liberar_bloqueo_certificado`
   con el mismo titular. Si soltarlo falla, solo se avisa por consola
   (`bloqueos: no se pudo soltar…`) y se mantiene el resultado o el error de `fn`: el
   arriendo vence solo. Si la RPC devuelve `false`, el arriendo venció antes de terminar
   y quizás otro ya lo tomó: no se le quita, y la consola avisa
   (`bloqueos: el arriendo del bloqueo venció antes de terminar la operación`).

**No es reentrante.** Cada llamada usa un titular aleatorio: una operación que ya tiene el
bloqueo y vuelve a pedirlo para el mismo certificado y ambiente espera los 20 s y termina
en `BloqueoOcupadoError`. Tómalo una vez, en el nivel más externo de la operación.

El mismo certificado en el otro ambiente es otro bloqueo (la clave es
`(certificado_id, ambiente)`).

### Por qué un arriendo y no advisory locks

El plan proponía `bloquear_certificado(uuid)` con `pg_try_advisory_xact_lock`. No sirve:

- `pg_try_advisory_xact_lock` se suelta al terminar la transacción, y **cada RPC de
  PostgREST es una transacción**: el candado dura lo que dura la llamada a la RPC, no la
  operación con el SII (segundos o minutos, en otra petición HTTP). No serializa nada.
- `pg_try_advisory_lock` (de sesión) queda pegado a la conexión de Postgres, que
  PostgREST y Supavisor reparten entre peticiones: lo soltaría (o lo heredaría)
  cualquier otra petición que use esa conexión, y si la función de Vercel muere a la
  mitad nadie lo suelta.

En su lugar, la migración 0007 crea una fila por `(certificado, ambiente)` con un titular y
un vencimiento (arriendo) en `bloqueos_sii`. Quien la toma la suelta con su titular; si la
función muere sin soltarla, el arriendo vence solo y otro la puede tomar. El arriendo por
defecto (300 s) es el `maxDuration` más largo de las funciones de Vercel en el plan
actual: mientras la función que lo tomó siga viva, no vence. Contrato de las RPC en
[RPC del backend](../03-api-reference/rpc-backend.md#tomar_bloqueo_certificado-y-liberar_bloqueo_certificado-migración-0007);
tabla en [objetos](../04-objetos/objetos-empresas-y-credenciales.md#bloqueos_sii-).

> **Migración 0007 aplicada en producción el 2026-11-13** (verificaciones 14/14 y
> simulación 21/21). En una base que no la tenga, `tomar_bloqueo_certificado` no existe:
> `conBloqueoCertificado` lanza `ErrorBloqueo` (con el código de función inexistente:
> `PGRST202` por PostgREST, `42883` en SQL directo) y la operación termina en `error` sin
> salir al SII.

## Orden de una operación con sesión AUT2000

```
ejecutarOperacion           fila en operaciones_sii, getUser(), regla del incierto
└─ crearCredenciales        .pfx y clave desde Vault (filtrado por organización)
   └─ conBloqueoCertificado (certificadoId, ambiente)
      └─ conSesionReutilizada
         ├─ autenticar      login AUT2000 (solo si no hay sesión o caducó)
         └─ usar            folios.solicitar(...), postulación, declaración
```

El transporte (`crearTransporte()`, `await using`) se crea dentro de la función de la
operación y se cierra al salir. Ejemplo completo en
[contrato del backend](../09-libreria/backend-service-role.md#cómo-se-compone-una-operación).
