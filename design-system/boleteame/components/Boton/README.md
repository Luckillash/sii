# Boton

Botón de acción en cuatro variantes: una sola `primario` por pantalla, el resto `secundario` o `discreto`, y `peligro` solo para acciones irreversibles.

**Le pasas:** el texto como `children` (verbo + objeto: «Emitir factura», «Reenviar al SII»), `variante`, `tamano` (`md` 36px en formularios, `sm` 28px dentro de tablas y alertas), un `icono` Lucide opcional y cualquier atributo de `<button>` (`onClick`, `disabled`, `type`).

- **Primario** (`sello` con `on-sello`): la acción que avanza el flujo — emitir, firmar, enviar al SII.
- **Secundario**: guardar borrador, previsualizar PDF, descargar XML.
- **Discreto**: acciones terciarias en barras y filas (ver detalle, copiar Track ID).
- **Peligro** (`error` con `on-error`): anular con nota de crédito, revocar certificado. Pide siempre confirmación.

No uses dos primarios juntos ni pongas un primario dentro de una fila de tabla. No escribas «Aceptar» o «OK»: nombra lo que pasa.
