# EstadoDTE

Badge que muestra en qué punto de su vida está un documento tributario: siempre la palabra oficial, un glifo y su color, en píldora `radius-full`.

**Le pasas:** `estado` (`borrador`, `firmado`, `enviado`, `aceptado`, `reparos`, `rechazado`, `anulado`) y opcionalmente `detalle`, que aparece como tooltip (la glosa que devolvió el SII, el Track ID o la fecha de respuesta).

| estado | texto | tono | cuándo |
| --- | --- | --- | --- |
| `borrador` | Borrador | neutro, círculo punteado | Guardado, sin folio ni firma. |
| `firmado` | Firmado | `sello` | Tiene folio del CAF y timbre electrónico, aún no se envía. |
| `enviado` | Enviado | `info`, reloj | El SII recibió el envío y entregó Track ID; espera validación. |
| `aceptado` | Aceptado | `exito`, check | El SII lo validó. |
| `reparos` | Aceptado con reparos | `aviso`, exclamación | Válido, pero el SII informó observaciones. |
| `rechazado` | Rechazado | `error`, cruz | El SII lo rechazó; hay que corregir y emitir de nuevo. |
| `anulado` | Anulado (tachado) | neutro | Una nota de crédito lo dejó sin efecto. |

No cambies los textos, no lo uses como botón y no lo pongas solo por color en una celda: el badge completo va siempre.
