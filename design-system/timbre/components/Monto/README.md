# Monto

Muestra un monto con formato chileno en IBM Plex Mono y cifras tabulares, para que las columnas cuadren.

**Le pasas:** `valor` (número; negativo para notas de crédito y descuentos) y opcionalmente `moneda` (`CLP` por defecto, sin decimales: `$ 1.190.000`; `USD` → `US$ 12.400,50`; `UF` → `UF 35,20`), `destacado` para el total de un documento o de un tablero (28px) y `tenue` para subtotales en `ink-muted`.

- Alinea siempre a la derecha en tablas (la celda con clase `tb-num`).
- El signo negativo es el menos tipográfico (−), no un guion.
- En el detalle de un documento muestra Neto, IVA (19%) y Total como tres `Monto` alineados; solo el Total va `destacado`.
- No redondees en la vista lo que el XML no redondea: calcula los montos en el servidor y pásale el valor final.
