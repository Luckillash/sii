# Folios: login AUT2000 y solicitud de CAF

Pide folios (CAF) replicando el asistente web legacy `cvc_cgi/dte/of_*` del SII. La sesión
de esta parte (`SesionSii`) también la usan la postulación y la declaración
([postulacion.md](postulacion.md)).

Lo que se envía al SII (URLs, cabeceras, campos y su orden) es idéntico al PHP: lo comparan
los casos `http-folios-*` con el servidor de captura ([tests.md](tests.md)). Validado en
certificación: CAF de boleta obtenido con Node (fase 5, folios 31–35, y fase 7 con la CLI,
folios 36–40).

## Hosts

| Uso | Host |
|---|---|
| Login AUT2000 con certificado (los dos ambientes) | `https://herculesr.sii.cl` (`HOST_AUTENTICACION`) |
| `Origin` / `Referer` del login | `https://zeusr.sii.cl` (`HOST_SESION`) |
| Asistente de timbraje, certificación | `https://maullin.sii.cl` (IDK `100`) |
| Asistente de timbraje, producción | `https://palena.sii.cl` (IDK `300`) |

## `SolicitudFolios`

`new SolicitudFolios(opciones: OpcionesSolicitudFolios)`, con `{ ambiente, transporte?,
reloj? }`. Sin `transporte`, crea un `TransporteUndici` propio. `reloj` fija `FECHA` y la
expiración de las cookies. La propiedad `ambiente` devuelve el ambiente con que se construyó.

**La librería soporta los dos ambientes**: `'certificacion'` timbra en maullin y
`'produccion'` en palena (**folios reales**). El ambiente es obligatorio y va fijo en el
código de la app, no en configuración: timbrar en el ambiente equivocado gasta folios reales
o deja un CAF que no sirve. Los candados de abajo dependen del ambiente, no de nada que
mande el SII. La CLI usaba solo certificación; por decisión del usuario, también va a
permitir pedir folios en producción.

### `autenticar(certificado: Certificado): Promise<SesionSii>`

- `POST https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?{referencia}`, con `referencia
  = {portal}/cvc_cgi/dte/of_solicita_folios` (también como campo), `Origin`/`Referer` de
  zeusr. El host de login es el mismo en los dos ambientes; solo cambia la URL de vuelta.
- TLS mutuo con `certificado.identidadTls()`: la **cadena completa** (sin los intermedios
  el SII corta con "tlsv1 alert unknown ca"). Tope 45 s (`MS_LOGIN`).
- Las redirecciones solo pueden ir a `https://*.sii.cl`, sin usuario en la URL.
- Toma las cookies `NETSCAPE_LIVEWIRE.*` que el SII pone por JavaScript.
- Exige HTTP 200 y que quede la cookie `TOKEN`.
- Errores: `ErrorSolicitudFolios` (el SII no aceptó el certificado: vencido, o el RUT no es
  representante electrónico de la empresa; o redirección fuera de sii.cl), `ErrorTransporte`
  (red o código inesperado).
- **Freno de re-login:** el SII corta tras unos 5 inicios de sesión seguidos (error
  `01.01.215.500.771.52`). Si se piden folios a menudo, guardar la sesión (cifrada) y
  reutilizarla hasta que salte `SesionCaducaError`.

### `solicitar(sesion, rutEmpresa: string | Rut, tipoDte: number, cantidad: number, opciones?: OpcionesSolicitar): Promise<Buffer>`

Devuelve el XML del CAF con los bytes tal como llegaron (ISO-8859-1), ya revisado contra el
ambiente. Antes de enviar nada valida `cantidad`, `tipoDte` y `opciones.folioInicial`
(enteros ≥ 1; `ErrorSolicitudFolios`) y el RUT con su DV (`ErrorValidacion`; el PHP no
validaba el DV).

**Primer timbraje (`opciones.folioInicial`, nuevo en Node).** Cuando la empresa no tiene
timbrajes anteriores de ese tipo de documento en el ambiente, el SII intercala la página
"Ingrese Folio Inicial" (botón "Confirmar Folio Inicial"; visto en palena el 2026-11-10).
El PHP mandaba `FOLIO_INICIAL=0` y el SII repetía la página. En Node:
- con `folioInicial` (normalmente 1), solo esa página va con `FOLIO_INICIAL=<n>` y el
  `ACEPTAR` de la propia página; los demás pasos no cambian;
- sin `folioInicial`, esa página lanza `FolioInicialRequeridoError` (subclase de
  `ErrorSolicitudFolios`, con `folioSugerido`, el valor que propone el SII) **sin
  enviarla**: no se timbró nada y se puede reintentar;
- si el SII no la pide, `folioInicial` no cambia ningún byte (paridad con el PHP).
Tope 70 s por paso (`MS_ASISTENTE`); cada petición lleva el `Referer` del paso anterior.

| Paso | Petición | Qué pasa |
|---|---|---|
| 1 | `GET of_solicita_folios` | revisa que la sesión siga viva |
| 2 | `POST` al `action` del formulario (hasta 4 veces) | los campos del SII + `RUT_EMP`, `DV_EMP`, `FOLIO_INICIAL=0`, `COD_DOCTO`, `CANT_DOCTOS`, `ACEPTAR=Continuar`; sale cuando el formulario apunta a `of_genera_folio` |
| 3 | (lectura) | la confirmación debe traer `FOLIO_INI`, `FOLIO_FIN` y `NOMUSU` no vacíos |
| 4 | `POST of_genera_folio` (`ACEPTAR=Obtener Folios`) | **timbra los folios (irreversible)**. Antes se revisa el candado del ambiente; va con `conexionNueva` |
| 5 | `POST` al formulario de descarga (`of_genera_archivo`) | `RUT_EMP`, `DV_EMP`, `COD_DOCTO`, `FOLIO_INI`, `FOLIO_FIN`, `FECHA` (hoy en Chile), `ACEPTAR=AQUI` |

`FECHA` va en hora de Chile a propósito: el SII la usa como `<FA>` del CAF. Con la hora del
servidor en UTC, desde las 21:00 el CAF saldría con fecha de mañana y cada boleta timbrada
ese día quedaría con reparo `TED-1-646`.

`formularioFolios(html)` (exportada) es la regla de lectura del formulario: primer
`<form>`, todos los `<input>` con `name` salvo `button`/`reset` (incluye `submit`,
checkbox sin marcar y deshabilitados) y cada `<select>` (opción `selected` o el primer
`value` no vacío). Es distinta de la regla de la postulación, a propósito.

### Candados

- **Ambiente:** cada URL del asistente, cada redirección y cada `action` que manda el SII
  tiene que ser `https` al host exacto del ambiente, sin puerto ni usuario. Se revisa antes
  de enviar. Si no: `ErrorSolicitudFolios` "Solicitud de folios detenida: el SII apuntó
  fuera del ambiente…". Puerto y usuario son más estrictos que el PHP.
- **Sesión:** si la URL o la página trae un marcador del login (`autInicioDTE`,
  `IngresoCertificado`, `InicioAutenticacion`, `CAutInicio.cgi`, `CAutValida`):
  `SesionCaducaError`. Se lanza antes de timbrar.
- **Rechazo del SII** (pasos 2 y 4): "El código de este mensaje es", "no se encuentra
  autorizado", "no está autorizado", "Usted no tiene", "no es representante", "excede", "no
  puede solicitar" → `ErrorSolicitudFolios` con el texto del SII (máx. 300).
- **CAF descargado:** debe traer el `<IDK>` del ambiente (`100` o `300`), `<RE>` = la
  empresa y `<TD>` = el tipo pedido. Si no, no se devuelve (ver errores).
- **HTTP:** exige 200 en la respuesta final de cada paso (el PHP no miraba el código).
- Redirecciones a mano, máximo 10 (`MAX_REDIRECCIONES`): 301/302/303 pasan a `GET` sin
  cuerpo, 307/308 conservan método y cuerpo.

### Errores

| Error | Cuándo | Qué hacer |
|---|---|---|
| `SesionCaducaError` | la sesión no sirve; antes de timbrar | descartar la sesión guardada, `autenticar()` y reintentar. No se gastaron folios |
| `FoliosSinCafError` | la orden de timbrar salió y no se obtuvo un CAF válido: red, HTTP ≠ 200, rechazo, formulario ausente, respuesta sin `<AUTORIZACION`/`<CAF`, o un CAF que no pasa la revisión | **no** reintentar (timbraría otro rango). Bajar el CAF `folioDesde`–`folioHasta` desde "Folios ya autorizados" del portal. El mensaje trae el rango y el host; `ambiente` también va en el error |
| `ErrorSolicitudFolios` "El SII rechazó la solicitud…" | rechazo antes de timbrar | leer el texto del SII, corregir y reintentar. No se timbró nada |
| `ErrorSolicitudFolios` "…detenida: … fuera del ambiente / de sii.cl" | el SII apuntó a otro host | no reintentar automáticamente; revisar a mano |
| `ErrorSolicitudFolios` "El SII no aceptó el certificado…" | login | vigencia del certificado y representación electrónica; si se repite tras varios logins, esperar |
| `ErrorTransporte` | red o HTTP inesperado **antes** de timbrar | reintentar más tarde (no gasta folios) |
| `ErrorValidacion` / `ErrorSolicitudFolios` de validación | RUT, cantidad o tipo | corregir los datos |

Diferencia con el PHP (pend. 1.2): un CAF que no cuadra después de timbrar es
`FoliosSinCafError`. El PHP lanzaba una excepción común, que invitaba a reintentar.

Jerarquía: `SesionCaducaError` y `FoliosSinCafError` heredan de `ErrorSolicitudFolios`, que
hereda de `SiiError`. Atrapar de la más específica a la más general.

## `SesionSii`

Cookies de la sesión AUT2000 en `*.sii.cl`. **Es una credencial**: con ella se timbran
folios sin el certificado. Si se guarda, cifrada. `console.log`, `util.inspect` y
`JSON.stringify` no muestran los valores.

| Miembro | |
|---|---|
| `new SesionSii({ reloj? })` | sesión vacía |
| `static desdeArreglo(cookies, { reloj? })` / `aArreglo(): CookieSii[]` | serialización `[{ name, value, domain, host_only }]`, el mismo formato que `toArray()` del PHP: una sesión guardada por uno se carga en el otro. Ignora entradas sin `name`, `value` o `domain` |
| `tiene(nombre)`, `valor(nombre)` | primer valor no vacío (`null` si no está) |
| `cabeceraPara(url)` | valor de `Cookie:` para esa URL, o `null` |
| `recibir(url, respuesta)` | aplica los `Set-Cookie` |
| `recibirDesdeHtml(html)` | aplica `document.cookie = "…"` con dominio `sii.cl`; pasar el cuerpo decodificado como latin1 |

Reglas: una cookie solo se fija para su host o un dominio padre, y nunca fuera de `sii.cl`.
`Max-Age <= 0`, `Expires` pasado (según el reloj) o valor vacío la borran. `Path`, `Secure`
y `HttpOnly` se ignoran. Las cookies se manejan como bytes (latin1), igual que el PHP.

## Probar sin red

`autenticar()` necesita un certificado real reconocido por el SII. En tests se parte de
`solicitar()` con una sesión armada a mano y un `TransporteFalso`:

```ts
import { SesionSii, SolicitudFolios, TransporteFalso } from '@winex/certificacion';

const caf =
  '<?xml version="1.0"?><AUTORIZACION><CAF version="1.0"><DA>' +
  '<RE>76123456-0</RE><TD>39</TD><RNG><D>1</D><H>10</H></RNG><IDK>100</IDK>' +
  '</DA></CAF></AUTORIZACION>';
const dte = 'maullin.sii.cl/cvc_cgi/dte';
const transporte = new TransporteFalso({
  [`${dte}/of_solicita_folios`]: '<form action="of_solicita_folios_dcto"><input name="RUT_EMP"></form>',
  [`${dte}/of_solicita_folios_dcto`]:
    '<form action="of_genera_folio"><input type="hidden" name="FOLIO_INI" value="1">' +
    '<input type="hidden" name="FOLIO_FIN" value="10"><input type="hidden" name="NOMUSU" value="USUARIO"></form>',
  [`${dte}/of_genera_folio`]: '<form action="of_genera_archivo"></form>',
  [`${dte}/of_genera_archivo`]: caf,
});
const sesion = SesionSii.desdeArreglo([
  { name: 'TOKEN', value: 'X', domain: 'sii.cl', host_only: false },
]);

const bytes = await new SolicitudFolios({ ambiente: 'certificacion', transporte }).solicitar(
  sesion,
  '76123456-0',
  39,
  10,
);
// transporte.urls() tiene las 4 peticiones; transporte.enviadas[0].cabeceras.Cookie === 'TOKEN=X'
```

Para simular una falla después de timbrar, la respuesta de `of_genera_archivo` puede ser una
función que lanza un `ErrorTransporte`: `solicitar` termina en `FoliosSinCafError` con
`folioDesde` 1 y `folioHasta` 10. Para redirecciones, `new RespuestaHttp(302, { location:
'https://…' })`; para cookies, `{ 'set-cookie': ['NOMBRE=valor; Domain=.sii.cl'] }`. Los
unitarios del repo están en `packages/core/test/unitarios/folios/`.
