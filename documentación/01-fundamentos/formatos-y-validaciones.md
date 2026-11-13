---
title: "Formatos y validaciones: RUT, correo, montos, IVA y fechas"
description: "Dominios rut y correo_sii, montos enteros, cálculo neto/IVA, hora de Chile y largos del SII."
keywords: ["formatearRut", "validarRut", "calcularDv", "rutSii", "rutValidoSii", "correoSiiValido", "LARGO_MAXIMO_CORREO_SII", "cabeEnIso88591", "caracteresFueraDeIso88591", "hoyEnChile", "formatearMonto", "formatearFecha", "formatearFechaHora", "TIPOS_DTE", "lib/formatos", "rut_valido", "correo_sii_valido", "dominio rut", "dominio correo_sii", "esValidoMail2", "ISO-8859-1", "razón social", "giro", "dirección", "comuna", "comillas tipográficas", "largoEnCaracteres", "esquemaEmpresa"]
related: ["04-objetos/objetos-documentos.md", "04-objetos/objetos-empresas-y-credenciales.md", "07-referencia/reglas-y-limites.md", "07-referencia/design-system.md"]
source: ["supabase_saas_sii.sql §2 §6 §10", "certificacion-node/docs/core.md", "design-system/boleteame/README.md", "apps/web/src/lib/formatos.ts", "apps/web/src/app/[org]/configuracion/empresas/esquemas.ts"]
---

# Formatos y validaciones: RUT, correo, montos, IVA y fechas

> **Úsalo cuando:** vas a escribir un RUT, correo o monto, o reproducir los totales de una boleta.

## Formatos de presentación (`apps/web/src/lib/formatos.ts`)

Funciones puras, sin React ni APIs del navegador: las usan los componentes y el servidor
(correos, PDF, API). Probadas en `formatos.test.ts`.

| Función | Entrada → salida | Regla |
|---|---|---|
| `formatearMonto(valor, moneda = 'CLP')` | `1190000` → `$ 1.190.000` · `-238000` → `−$ 238.000` · `(12400.5, 'USD')` → `US$ 12.400,50` · `(35.2, 'UF')` → `UF 35,20` | CLP sin decimales (redondeo); otras monedas con dos decimales y coma; negativo con signo menos tipográfico (U+2212) |
| `formatearMiles(n)` | `18244` → `18.244` | Punto de miles, entero |
| `limpiarRut(rut)` | ` 76.354.771-k ` → `76354771K` | Solo dígitos y K mayúscula |
| `calcularDv(cuerpo)` | `76354771` → `K` | Módulo 11 |
| `validarRut(rut)` | `76.354.771-K` → `true` | Al menos 2 caracteres, cuerpo sin K, DV correcto |
| `formatearRut(rut)` | `76354771k` → `76.354.771-K` | Para mostrar; quita ceros a la izquierda |
| `rutSii(rut)` | `76.354.771-k` → `76354771-K` | Formato que piden el SII y la base (sin puntos, con guion) |
| `rutValidoSii(rut)` | `76354771-K` → `true` · `76.354.771-K` → `false` | Igual que `rut_valido()` de la base: formato estricto `12345678-K` (1 a 8 dígitos) y DV. Normaliza antes con `rutSii` |
| `correoSiiValido(correo)` / `LARGO_MAXIMO_CORREO_SII` | `dte@empresa.cl` → `true` | Igual que `correo_sii_valido()` (regla `esValidoMail2`, máx. 50). No recorta espacios |
| `caracteresFueraDeIso88591(texto)` | `'“Andes” – €'` → `['“', '”', '–', '€']` | Caracteres con código mayor que U+00FF, sin repetir y en orden |
| `cabeEnIso88591(texto)` | `'Ñuñoa'` → `true` · `'😀'` → `false` | Todo el texto cabe en ISO-8859-1 |
| `hoyEnChile(ahora?)` | → `2026-11-13` | Fecha de hoy en `America/Santiago` como `AAAA-MM-DD` (columna `date`, `<input type="date">`) |
| `formatearFecha(fecha)` | `'2026-11-10'` → `10-11-2026` | Una columna `date` (`AAAA-MM-DD`) se formatea sin zona horaria; un instante, en hora de Chile (`America/Santiago`) |
| `formatearFechaHora(fecha)` | `'2026-11-10T19:18:00Z'` → `10-11-2026 16:18` | 24 h, hora de Chile |
| `nombreTipoDte(codigo, corto?)` / `TIPOS_DTE` | `39` → `Boleta electrónica` / `Boleta` | Nombres oficiales del SII; código desconocido → `Documento tributario` |

Reglas de tono asociadas (design system): montos siempre con `Monto` o `formatearMonto`,
RUT con puntos y guion al mostrar, fechas `dd-mm-aaaa` y horas en 24 h. Nunca escribas un
formato a mano en una pantalla.

`validarRut` es permisiva (acepta puntos, minúscula y cuerpos de más de 8 dígitos):
sirve para validar lo que escribe una persona. Antes de escribir en la base, normaliza
con `rutSii` y valida con `rutValidoSii`, que es exactamente lo que exige el dominio.

## Dominios del esquema: `rut` y `correo_sii`

Definidos en la §2 de `0001_esquema_inicial.sql`. Un valor que no pasa el `check` del
dominio falla con `23514` (`value for domain … violates check constraint …`). Las
funciones son `immutable strict`: con `null` devuelven `null` y el dominio deja pasar el
nulo (lo controla el `not null` de cada columna).

| Dominio | Función | Regla | Columnas |
|---|---|---|---|
| `rut` | `rut_valido(text)` | `^[0-9]{1,8}-[0-9K]$` (sin puntos, con guion, K mayúscula; el `RUTType` del esquema XML del SII) y DV módulo 11 | `empresas.rut`, `certificados.rut_titular`, `tokens_sii.rut_empresa`, `perfiles.rut`, `cafs.rut_emisor`, `receptores.rut`, `envios.rut_envia`, `documentos.receptor_rut` (default `66666666-6`), `procesos_certificacion.rut_administrador` y `rut_proveedor` |
| `correo_sii` | `correo_sii_valido(text)` | regla `esValidoMail2` del SII: máx. 50; ASCII imprimible sin espacios (`^[!-~]+$`); sin `] ! " # $ % & / ( ) = ? + * \| < > [ ;`; un solo `@`, ni al inicio ni al final; sin `@.`; sin empezar ni terminar en `.`; con un punto después del `@` | `empresas.correo_intercambio` y los correos de `procesos_certificacion` |

Las dos funciones las puede ejecutar `anon` y `authenticated` para validar antes de
escribir (`supabase.rpc('rut_valido', { p_rut })`). La app valida en el servidor con sus
espejos en TypeScript (`rutValidoSii`, `correoSiiValido`, probados en
`formatos.test.ts`); la base vuelve a exigirlo al escribir. Si cambia una función SQL,
cambia también su espejo.

## Campos de la empresa

Checks de `empresas` (§6) y su validación en la app (`esquemaEmpresa`, en
`apps/web/src/app/[org]/configuracion/empresas/esquemas.ts`). El largo máximo es el del
campo en el esquema XML del DTE.

| Campo | Base | App | Elemento del DTE |
|---|---|---|---|
| `rut` | dominio `rut`; `unique (organizacion_id, rut)` | `esquemaRut`: solo dígitos, K, puntos, guion y espacios; normaliza con `rutSii` y exige `rutValidoSii`. No se edita después del alta | `<RUTEmisor>` |
| `razon_social` | `length` entre 1 y 100 | recorta espacios; 1–100 caracteres; solo ISO-8859-1 | `<RznSocEmisor>` |
| `giro` | `length` entre 1 y 80 | 1–80; solo ISO-8859-1; el formulario pide escribirlo sin abreviaciones | `<GiroEmisor>` |
| `direccion` | `length` entre 1 y 70 | 1–70; solo ISO-8859-1 | `<DirOrigen>` |
| `comuna` | `length` entre 1 y 20 | 1–20; solo ISO-8859-1 | `<CmnaOrigen>` |
| `correo_intercambio` | dominio `correo_sii`, nulo permitido | vacío → `null`; si no, ≤ 50 y `correoSiiValido` (no recorta espacios internos) | — |

Detalles:

- **Largo en caracteres, no en unidades UTF-16.** `length()` de Postgres cuenta puntos de
  código; `String.length` de JavaScript cuenta unidades UTF-16 (un emoji vale 2). La app
  mide con `largoEnCaracteres(texto)` (`[...texto].length`), no con `.max()` de zod.
- **La app recorta los extremos** (`trim`); la base no. Un texto de solo espacios pasa el
  check de la base pero la app lo rechaza como vacío.
- Mensajes (`MENSAJES_EMPRESA`): p. ej. «El giro puede tener hasta 80 caracteres, el
  máximo que acepta el SII. Si el tuyo es más largo, escribe la actividad principal.»
- Los `maxLength` de los `<input>` usan los mismos topes (`LARGOS_EMPRESA`), pero cuentan
  unidades UTF-16: la autoridad es la validación del servidor.

### Resoluciones

`numero` es `integer ≥ 0` y debe ser 0 en certificación (check de la tabla y de
`registrar_resolucion`). La app (`esquemaResolucion`) es más estricta: en producción,
entero de 1 a 2.147.483.647 escrito sin puntos ni letras; la fecha, `AAAA-MM-DD` que
exista en el calendario y no posterior a `hoyEnChile()`.

## Regla ISO-8859-1

El DTE y los sobres se firman en **ISO-8859-1** (Latin-1): un byte por carácter, del
U+0000 al U+00FF. Las tildes, la ñ, `°`, `º` y `ª` caben; los emoji, `€`, las comillas
tipográficas `“ ” ‘ ’`, las rayas `– —` y los puntos suspensivos `…` no. El generador
de la librería escribe lo que no cabe como referencia `&#N;`, así que el documento no se
rompe, pero la razón social o el giro quedarían distintos de como los tiene el SII.

Por eso la app rechaza esos caracteres en razón social, giro, dirección y comuna (la base
no lo exige). `caracteresFueraDeIso88591` sigue la misma regla que la librería
(`FUERA_DE_ISO` en `core/envio-boleta.ts`, `aIso88591` en `comun/codificacion.ts`), que no
exporta un validador. Un surrogate suelto también cuenta como fuera.

El mensaje nombra hasta 5 caracteres rechazados y dice qué hacer
(`mensajeFueraDeIso`): «Tiene caracteres que no se pueden usar en un documento
tributario: «“», «”», «–», «€». Quita los emoji y símbolos especiales, o cámbialos por
letras, números o signos comunes (por ejemplo, comillas rectas " y guion -).» Pasa sobre
todo con textos pegados desde Word o desde un correo, que cambian las comillas y los
guiones por sus versiones tipográficas.

El correo de intercambio no necesita esta regla: `correo_sii` ya exige ASCII.
<!-- TODO (Fase 7): cálculo neto/IVA de boleta (precio bruto; neto = round(bruto / 1,19); IVA = bruto − neto) y montos enteros. -->
