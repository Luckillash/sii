# Alerta

Mensaje en bloque, a todo el ancho de su contenedor, para avisos que afectan la emisión: certificado digital por vencer, CAF por agotarse, rechazo del SII, ambiente de certificación activo.

**Le pasas:** `tono` (`info`, `exito`, `aviso`, `error`), `titulo` (una frase que dice qué pasa), `children` con el detalle y qué hacer, y opcionalmente `accion`: un `Boton` `secundario` o `discreto` en tamaño `sm`.

- `error` se anuncia como `role="alert"`; los demás como `role="status"`.
- Va arriba del contenido al que se refiere, no flotando. Para confirmaciones breves («Factura guardada») usa un aviso efímero de la aplicación, no una Alerta.
- Ambiente de certificación: muestra siempre una Alerta `info` fija arriba de la página («Estás en el ambiente de certificación del SII. Los documentos no tienen validez tributaria.»). Es lo que más confusión evita durante la certificación.
- Una sola Alerta por zona; si hay varias, prioriza la de mayor gravedad.
