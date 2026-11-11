# TablaDTE

Tabla de documentos emitidos o recibidos, con columnas fijas — Tipo, Folio, Receptor, Emisión, Total, Estado — en el orden en que un contador las busca.

**Le pasas:** `documentos`, una lista de `{ id, tipo, folio, receptor, rut, fecha, total, moneda?, estado }` (fecha ya formateada `10-11-2026`; RUT en cualquier formato, se normaliza), un `titulo` opcional, y para filas seleccionables `seleccionado` + `onSeleccionar(id)`. `vacio` reemplaza el texto cuando no hay filas.

- Filas de 40px aprox., filete `line` entre ellas, cabecera en `surface-sunken` con texto `label` en `ink-muted`.
- Total alineado a la derecha con `Monto`; folio y RUT en `mono`.
- La fila seleccionada se pinta `sello-soft`; con teclado, Enter o Espacio la seleccionan y el foco se ve como un contorno `sello`.
- Pon filtros (período, tipo, estado) y paginación fuera de la tabla, arriba y abajo; el componente no pagina.
- Para acciones por fila (descargar PDF, reenviar), ábrelas en el panel de detalle al seleccionar, no como botones en cada fila.
