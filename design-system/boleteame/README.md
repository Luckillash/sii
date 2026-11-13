Boletéame es una plataforma SaaS para emitir, firmar y enviar documentos tributarios electrónicos (DTE) al Servicio de Impuestos Internos de Chile, y para llevar a una empresa por el proceso de certificación ante el SII. Quien la usa es un contador, un administrativo de una pyme o un desarrollador que integra la API: gente que necesita certeza, no entusiasmo. La interfaz se parece a un buen formulario impreso: papel cálido, tinta oscura, cifras alineadas y un solo color de sello que indica dónde actuar.

## Contenido y tono

- Escribe en español de Chile, en segunda persona con **tú**, frases cortas y verbos concretos: «Emitir factura», «Reenviar al SII», «Descargar PDF». Nunca «¡Genial!», nunca signos de exclamación, nunca emoji.
- Usa los nombres oficiales del SII tal como aparecen en la normativa: *Factura electrónica*, *Nota de crédito electrónica*, *Guía de despacho electrónica*, *Código de Autorización de Folios (CAF)*, *Track ID*, *Libro de Compras y Ventas*. No inventes sinónimos («invoice», «comprobante») para lo que ya tiene nombre legal.
- Los estados del documento son siempre estas palabras, en este orden de vida: **Borrador → Firmado → Enviado → Aceptado / Aceptado con reparos / Rechazado**, más **Anulado** cuando una nota de crédito lo deja sin efecto y **Por verificar** cuando un envío salió sin Track ID y no se sabe si llegó al SII. Son el componente `EstadoDTE`; no escribas variantes («Aprobado», «OK», «Error»).
- Un mensaje de error dice qué pasó y qué hacer: «El SII rechazó el documento: el RUT del receptor no existe. Corrígelo y vuelve a emitir.» No culpes al usuario ni muestres el XML crudo como mensaje principal; ofrécelo como detalle.
- Mayúscula solo al inicio de frase y en nombres propios (*Servicio de Impuestos Internos*, siglas *SII*, *DTE*, *CAF*, *IVA*). Botones y títulos en tipo oración: «Cargar certificado digital», no «Cargar Certificado Digital».
- Formatos chilenos siempre: montos `$ 1.190.000` (punto de miles, sin decimales en CLP), RUT `76.354.771-K` con puntos y guion, fechas `10-11-2026`, horas en 24 h. El componente `Monto` y el `CampoRut` ya los aplican.

## Color

- Pinta la página en `surface`; tarjetas, tablas y campos en `surface-raised`; cabeceras de tabla y pozos de totales en `surface-sunken`.
- Texto en `ink`; metadatos y etiquetas de columna en `ink-muted`. Ambos son legibles sobre las tres superficies y sobre `sello-soft`, en los dos temas.
- `sello` es el único color de acción: botón primario, fila seleccionada, enlaces (`link` es su alias). Una pantalla tiene una sola acción en `sello` relleno; el resto son botones secundarios. Sobre un relleno `sello` el texto es `on-sello`, nunca blanco literal (en el tema oscuro es tinta oscura).
- `ocre` es acento de identidad (portada, ilustraciones, el marcador del folio actual). No es texto ni significa un estado; encima va `on-ocre`.
- Los estados usan pares texto/fondo: `exito`/`exito-soft` para Aceptado, `aviso`/`aviso-soft` para Aceptado con reparos, Por verificar y vencimientos, `error`/`error-soft` para Rechazado y validaciones, `info`/`info-soft` para Enviado. Un estado lleva siempre su palabra y su glifo, nunca solo el color: así lo distingue quien no ve rojo y verde.
- Los bordes de controles son `line-strong` (3:1 sobre las superficies); `line` es solo para filetes decorativos entre filas.

## Tipografía

- Toda la interfaz va en **IBM Plex Sans** (familia `sans`, Google Fonts, pesos 400/500/600). Los estilos son `display` (un título por pantalla), `title`, `heading`, `body` (texto corrido y celdas), `label` (etiquetas de campo, columnas, botones) y `caption` (metadatos).
- Todo dato que se compara o se copia va en **IBM Plex Mono** (familia `mono`): montos en `monto`, RUT, folios, Track ID y códigos de tipo en `folio`. Activa cifras tabulares (`font-variant-numeric: tabular-nums`) y alinea los montos a la derecha para que las columnas cuadren como en un libro contable.
- No uses cursiva para énfasis; usa peso 600. No uses mayúsculas sostenidas salvo en siglas.

## Espaciado, forma y elevación

- Base de 4px: `space-1` a `space-8`. Dentro de tablas y formularios usa `space-2`/`space-3`; entre campos `space-4`; entre secciones `space-6`; margen de página `space-8`.
- Esquinas casi rectas: `radius-sm` en campos y chips, `radius-md` en botones, tarjetas, tablas y alertas. `radius-full` se reserva para los badges de estado y la barra de folios: la píldora significa «estado».
- Bordes antes que sombras. Tarjetas y tablas: borde `line` más `shadow-sm`. Solo lo que flota (menús, modales) lleva `shadow-lg`.
- El foco de teclado es el token `focus-ring`: 2px del color de fondo y 2px de `sello` sólido, aplicado con `box-shadow` para que siga el radio. Nunca quites el foco sin reemplazarlo.

## Movimiento

- Transiciones de 120 ms en hover y foco; 200 ms al abrir menús. Sin rebotes ni animaciones decorativas. Respeta `prefers-reduced-motion`.
- Mientras un envío espera respuesta del SII, el badge `Enviado` basta; no agregues spinners en cada fila.

## Iconografía

- No hay set de íconos propio todavía. Usa **Lucide** (código abierto) a 16px dentro de texto y 20px en navegación, trazo 1.5px, en `currentColor`. Sin íconos rellenos ni a color.
- Los glifos de estado (círculo, reloj, check, signo de exclamación, signo de interrogación, cruz) vienen dibujados dentro de `EstadoDTE` y `Alerta`; no los dupliques al lado.
- Logotipo: aún no existe una marca gráfica. Escribe «Boletéame» en IBM Plex Sans 600 en `ink`. No dibujes un logotipo aproximado ni uses el logo del SII o del Gobierno de Chile como si fuera propio.

## Componentes

Los componentes viven en `components/bundle.js` como `window.Boleteame` y necesitan React 18 en la página, más `tokens.css` y `components/bundle.css`. Hay ocho: `Boton`, `EstadoDTE`, `TipoDTE`, `Monto`, `CampoRut`, `Alerta`, `MedidorFolios` y `TablaDTE`. Cada uno tiene su guía con qué datos le pasas y cuándo usarlo.
