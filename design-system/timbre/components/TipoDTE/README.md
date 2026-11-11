# TipoDTE

Identifica el tipo de documento con su código oficial del SII en una caja `mono` sobre `sello-soft`, seguido del nombre.

**Le pasas:** `codigo` (33, 34, 39, 41, 43, 46, 52, 56, 61, 110, 111, 112) y opcionalmente `corto` para el nombre abreviado en tablas («Nota de crédito» en vez de «Nota de crédito electrónica») o `soloCodigo` cuando el espacio es mínimo (el nombre completo queda en el tooltip y para lectores de pantalla).

- Usa el nombre oficial completo en títulos de documento, selectores de tipo y el PDF; el corto en tablas y listas.
- El código siempre a la vista: contadores y el SII hablan en códigos («una 61 que anula la 33»).
- Un código fuera de la lista se muestra como «Documento tributario»; agrega el tipo al mapa antes de emitirlo.
