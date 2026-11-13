---
title: "Librería: contrato del backend"
description: "Responsabilidades del backend con service_role y API de la capa SII (apps/web/src/server/sii/): credenciales, TokenStore, sesiones, bloqueo, transporte, ejecutarOperacion, errores y almacén, y cómo se compone una operación."
keywords: [server/sii, service_role, clienteServicio, server-only, runtime nodejs, crearCredenciales, Credenciales, CredencialesCertificado, certificadoDeEmpresa, certificadoPorId, representante, ErrorCredenciales, MotivoCredenciales, RESULTADO_DEL_MOTIVO, TokenStoreSupabase, SesionesSupabase, conSesionReutilizada, conBloqueoCertificado, crearTransporte, TransporteInvocacion, await using, TransporteUndici, TransporteFalso, ejecutarOperacion, ContextoOperacion, HerramientasOperacion, agregarDetalle, ResultadoEjecucion, DependenciasOperacion, RegistroOperacion, registrarEnSentry, marcarInciertaRevisada, AlmacenDocumentos, caché por invocación, leer_secreto, leerLlave, SII_TOKENS_KEY]
related: ["01-fundamentos/errores-y-resultados.md", "01-fundamentos/autenticacion-sii.md", "03-api-reference/rpc-backend.md", "06-integraciones/realtime-y-storage.md", "09-libreria/mapeo-libreria-tablas.md", "07-referencia/trampas-conocidas.md"]
source: ["supabase_saas_sii.sql", "apps/web/src/server/sii/", "certificacion-node/docs/canales.md", "PLAN-SAAS.md §2 §4.4 (Fase 4)"]
---

# Librería: contrato del backend

> **Úsalo cuando:** vas a implementar el backend que habla con el SII.

La capa de servicio SII vive en `apps/web/src/server/sii/` (Fase 4). Es lo único que abre
un certificado, habla con el SII o escribe en `operaciones_sii`. Las pantallas de las
Fases 5 a 8 (certificación, folios, emisión, seguimiento), los cron y la API pública la
llaman desde Server Actions o route handlers; ninguna llama a la librería directo.

## Reglas para todo el código de la capa

1. **Solo servidor, solo Node.js.** Cada archivo empieza con `import 'server-only'`; las
   rutas que la usan declaran `export const runtime = 'nodejs'` (la librería usa
   `node-forge`, `undici` y TLS mutuo). Nunca Edge runtime ni Edge Functions de Supabase.
2. **`service_role` filtra siempre por `organizacion_id`.** El cliente
   (`clienteServicio()` de `server/supabase/service.ts`) salta RLS. El `organizacionId`
   sale de la membresía verificada (`exigirMembresia()`), **nunca** del formulario o de
   la URL sin validar. Quien llama comprueba antes el rol necesario.
3. **Todo por invocación, nada global.** Credenciales, transporte y almacenes se crean
   dentro de la petición y mueren con ella. Una variable de módulo dejaría la llave
   privada de una organización al alcance de otra (en Vercel una instancia atiende a
   varios usuarios).
4. **Toda llamada al SII va dentro de `ejecutarOperacion`**, también la carga de
   credenciales: así un certificado vencido queda auditado como `config`.
5. **Ningún secreto sale de la capa.** Ni .pfx, clave, llave privada, token, cookies ni
   PEM en mensajes, logs, Sentry o `operaciones_sii`. Los errores de Supabase se informan
   solo con su `code`.
6. **Paridad con la librería.** No se reimplementa firma, TED, sobres, clientes ni
   asistentes: la capa solo adapta persistencia, secretos y errores.

## Módulos

| Archivo | Exporta | Responsabilidad |
|---|---|---|
| `credenciales.ts` | `crearCredenciales`, `ErrorCredenciales`, `RESULTADO_DEL_MOTIVO` | .pfx y clave desde Vault → `Certificado` + `FirmaElectronica` en memoria, caché por invocación |
| `token-store-supabase.ts` | `TokenStoreSupabase`, `ErrorTokenStore`, `contextoToken` | `TokenStore` de la librería sobre `token_*`, cifrado con `SII_TOKENS_KEY` |
| `sesiones.ts` | `SesionesSupabase`, `conSesionReutilizada`, `claveSesion`, `contextoSesion`, `ErrorSesiones` | cookies AUT2000 cifradas en `sesiones_sii`; reutilizar antes de volver a autenticar |
| `bloqueos.ts` | `conBloqueoCertificado`, `BloqueoOcupadoError`, `ErrorBloqueo`, `SEGUNDOS_ARRIENDO`, `ESPERA_MS`, `INTERVALO_MS`, `BLOQUEO_OCUPADO` | bloqueo con arriendo por certificado y ambiente (migración 0007) |
| `transporte.ts` | `crearTransporte`, `TransporteInvocacion` | un `TransporteUndici` por invocación, cerrado con `await using` |
| `operacion.ts` | `ejecutarOperacion`, `marcarInciertaRevisada`, `registrarEnSentry`, `OPERACIONES_QUE_GRABAN`, `OPERACIONES_EFECTO_GLOBAL`, `MINUTOS_EN_CURSO_ABANDONADA`, `MENSAJE_SESION_INVALIDA` | auditoría en `operaciones_sii`, `getUser()`, regla del incierto, Sentry |
| `errores.ts` | `resultadoDeError`, `mensajeParaUsuario`, `mensajeEnTexto`, `detalleSeguro`, `sanearTexto`, `sanearDetalle`, `hostDelError`, `CODIGO_DE_RESULTADO`, `MENSAJE_INESPERADO`, `ErrorUso`, `ErrorConfig`, `ErrorVerificacion`, `ErrorIncierto` | traducción error → resultado (paridad con la CLI), mensajes del design system, saneado |
| `almacen.ts` | `AlmacenDocumentos`, `rutaDocumento`, `ErrorAlmacen`, `BUCKET_DOCUMENTOS`, `MAXIMO_BYTES`, `MAXIMO_SEGUNDOS_URL` | XML y PDF en el bucket `documentos-xml`, URLs firmadas |

Cada uno tiene su `*.test.ts` al lado, sin red ni base (Vitest).

### `credenciales.ts`

```ts
crearCredenciales(cliente: ClienteServicio, opciones?: { reloj?: Reloj }): Credenciales

interface Credenciales {
  certificadoDeEmpresa(p: { organizacionId: string; empresaId: string; representante?: boolean })
    : Promise<CredencialesCertificado>;
  certificadoPorId(p: { organizacionId: string; certificadoId: string })
    : Promise<CredencialesCertificado>;
}

interface CredencialesCertificado {
  readonly certificadoId: string;
  readonly organizacionId: string;
  readonly rutTitular: string;      // formato SII, '12345678-5'
  readonly huellaSha256: string;    // huellaCertificado() de la librería: clave de tokens_sii
  readonly vigenteHasta: Date;      // la del certificado X.509, no la de la fila
  readonly certificado: Certificado;
  readonly firma: FirmaElectronica; // new FirmaElectronica(llavePrivada, certificado), como la CLI
}
```

**Cómo elige el certificado de una empresa** (`empresa_certificados`, filtrado por
organización y empresa):

- Sin `representante`: el **predeterminado**. Si está revocado o vencido, error: no se
  cambia de firmante sin avisar.
- `representante: true` (lo exige la solicitud de folios: el titular tiene que ser
  representante electrónico de la empresa ante el SII): el predeterminado si es
  representante y vigente; si no, el representante sin revocar y vigente (según la fila)
  que vence más tarde.

**Cómo lo carga** (`cargar`): lee la fila de `certificados` por `organizacion_id` + `id`;
rechaza revocados y vencidos según la fila **antes** de tocar Vault; lee los dos secretos
con `leer_secreto` (en paralelo); abre el .pfx con `Certificado.desdeContenido`; exige que
la huella calce con `huella_sha256` de la fila; y revisa la vigencia **real** del X.509.

**Caché por invocación.** Dos mapas de promesas (por certificado y por empresa): dos
llamadas simultáneas leen Vault una sola vez; si la carga falla, la promesa sale del
caché y un reintento vuelve a leer. Se crea uno por petición y nunca en una variable de
módulo.

**Errores.** Cualquier método lanza **solo** `ErrorCredenciales`, con `motivo`,
`resultado` y `mensaje: MensajeError` (listo para mostrar), sin `cause` (el error de
node-forge o de PostgREST no se propaga) y sin datos de la fila:

| `motivo` | `resultado` | `titulo` del mensaje |
|---|---|---|
| `sin_certificado` | `config` | «La empresa no tiene un certificado predeterminado» / «No encontramos el certificado» |
| `sin_representante` | `config` | «La empresa no tiene un representante electrónico con certificado vigente» |
| `revocado` | `config` | «El certificado predeterminado de la empresa está revocado» / «El certificado está revocado» |
| `vencido` | `config` | «El certificado está vencido» (con «Venció el 10-11-2026.») |
| `no_vigente` | `config` | «El certificado todavía no está vigente» |
| `huella_distinta` | `config` | «El certificado guardado no coincide con su registro» |
| `ilegible` | `config` | «No pudimos abrir el certificado guardado» |
| `vault` | `config` | «Falta el archivo o la contraseña del certificado» |
| `base` | `error` | «No pudimos leer el certificado» (con el código de PostgREST) |

Los `detalle` dicen dónde arreglarlo (`Configuración → Certificados` o
`Configuración → Empresas → Certificados`).

### `token-store-supabase.ts`, `sesiones.ts`, `bloqueos.ts`

Firmas y comportamiento en [autenticación ante el SII](../01-fundamentos/autenticacion-sii.md):
`TokenStoreSupabase` (token REST/SOAP), `SesionesSupabase` + `conSesionReutilizada`
(cookies AUT2000, reintento único ante `SesionCaducaError`) y `conBloqueoCertificado`
(arriendo de 300 s, espera de 20 s, **no reentrante**).

### `transporte.ts`

```ts
crearTransporte(opciones?: OpcionesTransporteUndici & { transporte?: TransporteHttp })
  : TransporteInvocacion          // TransporteHttp & AsyncDisposable
```

- Sin `transporte`: un `TransporteUndici` nuevo de la librería (TLS siempre verificado,
  solo https, conexión 10 s y petición 45 s por defecto).
- Con `transporte` (p. ej. `TransporteFalso` en pruebas): lo envuelve; al cerrar no cierra
  el inyectado (su dueño es quien lo inyectó), pero rechaza peticiones nuevas con
  `ErrorTransporte`.
- Se usa con `await using transporte = crearTransporte();`. Nunca se comparte entre
  peticiones (cada `Agent` de undici guarda en memoria la llave privada del certificado
  del TLS mutuo) ni se deja abierto (las conexiones keep-alive mantendrían viva la
  función).

### `operacion.ts`: `ejecutarOperacion`

```ts
ejecutarOperacion<T>(
  ctx: ContextoOperacion,
  fn: (herramientas: { operacionId: string; agregarDetalle(datos: Record<string, unknown>): void }) => Promise<T>,
): Promise<ResultadoEjecucion<T>>

interface ContextoOperacion {
  cliente: ClienteServicio;           // service_role
  organizacionId: string;             // de la membresía
  empresaId?: string | null;          // obligatoria en solicitar_folios, postular y declarar
  usuarioId?: string | null;          // null en cron y API pública
  apiKeyId?: string | null;
  operacion: OperacionSii;            // enum operacion_sii
  ambiente: AmbienteSii;              // 'certificacion' | 'produccion'
  canal?: CanalSii | null;            // 'rest' | 'soap'
  confirmada: boolean;                // false = ensayo (sin --confirmar)
  envioId?: string | null;
  solicitudId?: string | null;
  documentoId?: string | null;
  dependencias?: Partial<DependenciasOperacion>;  // pruebas
}

interface DependenciasOperacion {
  confirmarSesion: (usuarioId: string) => Promise<boolean>;  // por defecto getUser() (certificados/acceso.ts)
  registrar: (registro: RegistroOperacion) => void;          // por defecto registrarEnSentry
  reloj: () => Date;
}
```

Pasos, formas de `ResultadoEjecucion`, `motivo`s, Sentry y la regla del incierto en
[errores y resultados](../01-fundamentos/errores-y-resultados.md#ejecutaroperacion-los-pasos).
Lo esencial para escribir `fn`:

- **Todo lo que no sea `ok` lanza.** Errores de la librería tal cual; los de la app con
  `ErrorUso` (2), `ErrorConfig` (3), `ErrorVerificacion` (7) o `ErrorIncierto` (6); un
  rechazo detectado por la app, como `ErrorRespuestaSii`. Nunca devolver un «resultado
  fallido» como valor: quedaría auditado como `ok`.
- **Los mensajes de esos errores se muestran al usuario.** Escríbelos con el formato del
  design system (qué pasó y qué hacer) y sin valores de secretos, solo nombres de campos.
  No pongas datos crudos del SII en el `message` de un error propio.
- `agregarDetalle()` acumula datos para `operaciones_sii.detalle` (se sanean). Úsalo solo
  con campos conocidos y acotados (tipo de documento, cantidad, rango de folios, Track
  ID), nunca con respuestas crudas del SII.
- El ensayo (`confirmada: false`) lo implementa `fn`: no debe grabar nada en el SII.
- Dos peticiones iguales de efecto global no se ejecutan las dos: lo impiden el índice
  único de la 0007 y el control posterior al insert
  ([carrera](../01-fundamentos/errores-y-resultados.md#carrera-entre-dos-peticiones-iguales)).
  Quien llama trata `ejecutada: false` como «no pasó nada en el SII» y muestra `mensaje`.

`marcarInciertaRevisada(cliente, { organizacionId, operacionId, usuarioId }, reloj?)`
desbloquea un incierto; **no verifica el rol** (ver
[regla del incierto](../01-fundamentos/errores-y-resultados.md#marcarinciertarevisada)).

### `almacen.ts`

```ts
new AlmacenDocumentos(cliente: ClienteServicio, organizacionId: string)
  subirXml(destino: { empresaId; ambiente; archivo }, xml: Uint8Array, opciones?: { sobrescribir?: boolean }): Promise<string>
  subirPdf(destino, pdf: Uint8Array, opciones?): Promise<string>
  urlFirmada(ruta: string, segundos = 60): Promise<string>     // 1..3600

rutaDocumento(organizacionId, destino, tipo?: 'xml' | 'pdf'): string   // '<org>/<empresa>/<ambiente>/<archivo>'
```

Detalle (rutas, `content-type`, ISO-8859-1, errores) en
[Realtime y Storage](../06-integraciones/realtime-y-storage.md#storage-documentos-xml).

## Cómo se compone una operación

Orden: **`ejecutarOperacion` → credenciales → bloqueo → sesión o token → transporte →
librería**. La auditoría envuelve todo para que cualquier falla (también un certificado
vencido o el bloqueo ocupado) quede en `operaciones_sii` con su resultado.

Ejemplo: solicitar 5 folios de boleta (39) en certificación desde una Server Action. La
action ya verificó membresía y rol; la Fase 6 hará la versión real.

```ts
import { SolicitudFolios } from '@winex/certificacion';
import { leerLlave } from '@/server/cifrado';
import { conBloqueoCertificado } from '@/server/sii/bloqueos';
import { crearCredenciales } from '@/server/sii/credenciales';
import { ejecutarOperacion } from '@/server/sii/operacion';
import { claveSesion, conSesionReutilizada, SesionesSupabase } from '@/server/sii/sesiones';
import { crearTransporte } from '@/server/sii/transporte';
import { clienteServicio } from '@/server/supabase/service';

const cliente = clienteServicio();
const ambiente = 'certificacion';

const r = await ejecutarOperacion(
  {
    cliente,
    organizacionId: ctx.organizacion.id, // de exigirMembresia(), nunca del formulario
    empresaId: empresa.id,
    usuarioId: ctx.usuario.id,           // activa getUser() (operación ⚠️ confirmada)
    operacion: 'solicitar_folios',
    ambiente,
    confirmada: true,                    // false = ensayo: fn no debe timbrar
  },
  async ({ agregarDetalle }) => {
    const cred = await crearCredenciales(cliente).certificadoDeEmpresa({
      organizacionId: ctx.organizacion.id,
      empresaId: empresa.id,
      representante: true,
    });
    await using transporte = crearTransporte();
    const folios = new SolicitudFolios({ ambiente, transporte });
    const sesiones = new SesionesSupabase(cliente, leerLlave(process.env.SII_TOKENS_KEY));

    const caf = await conBloqueoCertificado(cliente, { certificadoId: cred.certificadoId, ambiente }, () =>
      conSesionReutilizada({
        sesiones,
        clave: claveSesion(cred, ambiente),
        autenticar: () => folios.autenticar(cred.certificado),
        usar: (sesion) => folios.solicitar(sesion, empresa.rut, 39, 5),
      }),
    );
    agregarDetalle({ tipo_dte: 39, cantidad: 5 });
    // Guardar el CAF (Vault + cafs, Fase 6). Si eso falla, el CAF ya se timbró:
    // throw new ErrorIncierto('Los folios se timbraron pero no pudimos guardar el CAF. …')
    return caf;
  },
);

if (!r.ok) return { error: r.mensaje };  // MensajeError listo para <Alerta>; r.operacionPendienteId si hay incierto
```

Para un cliente con token (REST o SOAP), en vez de la sesión:

```ts
const tokens = new TokenStoreSupabase(cliente, leerLlave(process.env.SII_TOKENS_KEY));
await using transporte = crearTransporte();
const rest = new ClienteBoletaRest(cred.certificado, { ambiente, transporte, tokenStore: tokens });
```

Los clientes REST/SOAP no necesitan el bloqueo del certificado: el token no tiene el
límite de re-login de AUT2000.

## Pruebas

- **Sin red:** `TransporteFalso` de la librería, inyectado con
  `crearTransporte({ transporte })` o directo en el cliente.
- **Sin base:** cada módulo recibe el `ClienteServicio`; las pruebas pasan un cliente
  falso que registra las llamadas.
- **Sin Auth ni Sentry:** `ctx.dependencias` reemplaza `confirmarSesion`, `registrar` y
  `reloj`.
- `operacion.test.ts` cubre los 8 resultados y busca patrones de secretos (token, cookie,
  PEM, JWT, clave) en lo que llega a `operaciones_sii`, al registro de Sentry y a
  `console.*`.
- Una prueba contra certificación real se hace a mano, nunca automática:
  `src/server/sii/integracion-certificacion.test.ts`, que se omite sin `SII_INTEGRACION=1`.
  Con el certificado real de una empresa (Vault), corre `ejecutarOperacion('obtener_token')`
  en certificación por REST con `TokenStoreSupabase`, comprueba que ni la fila de
  `operaciones_sii` ni lo que recibe Sentry contienen el token, que la segunda vez sale del
  caché (`tokens_sii` no cambia) y que el bloqueo con arriendo rechaza a un segundo titular
  por PostgREST. Escribe en producción una fila de `operaciones_sii` por operación y el
  token cifrado en `tokens_sii`. Desde `apps/web`, con `.env.local` completo:
  `SII_INTEGRACION=1 SII_INTEGRACION_ORG=<uuid> SII_INTEGRACION_EMPRESA=<uuid> pnpm vitest run src/server/sii/integracion-certificacion.test.ts`.
  Primera corrida el 2026-11-13: en verde en 7,6 s (token en 1,54 s; desde el caché, 0,74 s).
- `sanearDetalle` filtra toda clave que contenga `token`, aunque el valor sea inocuo (p. ej.
  `largo_token` queda `[Filtrado]`): es a propósito, preferimos perder un dato a guardar una
  credencial. Para datos así, usa nombres sin esas palabras.

## Quién usa la capa: el asistente de certificación (Fase 5)

`apps/web/src/server/certificacion/` es el primer consumidor de esta capa. No la
reemplaza: cada acción confirmada pasa por `ejecutarOperacion` (`ejecutar` de `comun.ts`,
con `ambiente: 'certificacion'`), abre la sesión AUT2000 con `conBloqueoCertificado` +
`conSesionReutilizada` (`conSesionSii`), crea el transporte con `await using`, carga el
certificado con `crearCredenciales` y sube los XML con `AlmacenDocumentos`. Lo que agrega:

- **Dependencias inyectables** (`dependencias.ts`, `resolverDependencias()`): clientes de
  Supabase, reloj, transporte, credenciales, sesiones, `TokenStore`, fábricas de los
  clientes de la librería (`FABRICAS_SII`) y correo. Se arman en cada llamada, nunca en
  una variable de módulo; las pruebas reemplazan lo que necesitan.
- **Ensayo sin `ejecutarOperacion`**: con `confirmada: false` no hay fila ni salida al SII.
- **Bloqueo propio de `enviar_set`** (`bloqueoEnvioSet`), que no es de efecto global.
- **Guardado del CAF en Vault** con la RPC `registrar_caf` (migración 0008,
  aplicada el 2026-11-13).

Detalle en [certificación de la empresa](../02-guias/certificacion-empresa.md).

<!-- TODO (Fases 6–8 y 11): workers y cron (seguimiento, webhooks), CAF de producción, uso desde la API pública (apiKeyId). -->
