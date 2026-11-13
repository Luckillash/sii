# MedidorFolios

Muestra cuántos folios quedan en el Código de Autorización de Folios (CAF) vigente de un tipo de DTE, con una barra que pasa de `sello` a `aviso` cuando quedan pocos y a `error` cuando se agotó.

**Le pasas:** `codigo` del tipo de DTE, `desde` y `hasta` (el rango autorizado del CAF), `siguiente` (el próximo folio que se asignará) y opcionalmente `umbralAviso` (fracción restante bajo la cual avisa; por defecto 0.15).

- Úsalo en el tablero y en la configuración de folios, un medidor por tipo de documento activo.
- El estado nunca depende solo del color: la nota bajo la barra cambia de texto y lleva glifo en aviso y error.
- Calcula `siguiente` en el servidor; el medidor no reserva folios.
- Cuando el CAF esté agotado, deshabilita el `Boton` primario de emisión de ese tipo y explica por qué.
