---
title: "Design system «Timbre» en la app"
description: "Tokens, componentes TSX con CSS Modules, layouts, catálogo /_ds y pruebas de accesibilidad."
keywords: ["design system", "tokens", "CSS Modules", "EstadoDTE", "incierto", "Por verificar", "BannerAmbiente", "Dialogo", "LayoutApp", "axe", "/_ds", "stylelint"]
related: ["01-fundamentos/formatos-y-validaciones.md", "01-fundamentos/errores-y-resultados.md", "07-referencia/trampas-conocidas.md"]
source: ["PLAN-SAAS.md §4.2 y Fase 1", "design-system/timbre/"]
---

# Design system «Timbre» en la app

> **Úsalo cuando:** vas a construir una pantalla, agregar un componente o cambiar un color, una fuente o un texto de estado.

## Dónde está cada cosa

| Pieza | Ruta | Nota |
|---|---|---|
| Fuente de verdad (copia del artifact) | `design-system/timbre/` | `tokens.json`, `README.md` (tono y reglas), `components/` (bundle original, `index.d.ts`, guía y `preview.html` por componente), `plantillas/` (pantallas de referencia). Solo referencia: **no se carga en la app** (H8). |
| Generador de tokens | `scripts/generar-tokens.ts` | `pnpm --filter web tokens` |
| Tokens CSS (generado) | `apps/web/src/styles/tokens.css` | No editar a mano; Biome y stylelint lo ignoran |
| Estilos base | `apps/web/src/app/globals.css` | Importa `tokens.css`; foco global con `--focus-ring` |
| Fuentes | `apps/web/src/app/layout.tsx` | IBM Plex Sans 400/500/600 y Plex Mono 400/500 con `next/font` (`--fuente-plex-*`, que alimentan `--font-sans` / `--font-mono`) |
| Componentes | `apps/web/src/components/timbre/` | Importar siempre desde `@/components/timbre` |
| Formatos | `apps/web/src/lib/formatos.ts` | RUT, montos, fechas y tipos de DTE; los usa también el servidor |
| Catálogo | `/_ds` (carpeta `src/app/%5Fds/`) | Solo en desarrollo; en producción responde 404 |
| Pruebas e2e y axe | `apps/web/e2e/design-system.spec.ts` | `pnpm --filter web test:e2e` |

## Tokens

`tokens.css` define, para tema claro y oscuro:

- **Color:** `--surface`, `--surface-raised`, `--surface-sunken`, `--line`, `--line-strong`, `--ink`, `--ink-muted`, `--sello`, `--sello-strong`, `--sello-soft`, `--on-sello`, `--ocre`, `--on-ocre`, `--exito(-soft)`, `--aviso(-soft)`, `--error(-soft)`, `--on-error`, `--info(-soft)`, `--link` (alias de `--sello`).
- **Tipografía:** `--font-sans`, `--font-mono` y `--text-<estilo>-size|line|weight|tracking` para `display`, `title`, `heading`, `body`, `label`, `caption`, `monto` y `folio`.
- **Escala:** `--space-1|2|3|4|6|8`, `--radius-sm|md|full`, `--shadow-sm|lg`, `--focus-ring`.
- **Movimiento:** `--duracion-rapida` (120 ms) y `--duracion-menu` (200 ms); ambas valen 0 con `prefers-reduced-motion`.

**Temas.** Sin `data-theme` se sigue el sistema (`prefers-color-scheme`). `<html data-theme="dark">` o `"light"` fija el tema (lo usará la preferencia `perfiles.tema` de la Fase 2).

**Cambiar un token:** se edita `design-system/timbre/tokens.json` (idealmente primero en el artifact del design system), se corre `pnpm --filter web tokens` y se versionan los dos archivos.

## Reglas para escribir estilos

1. CSS Modules en todo componente o página. Nada de Tailwind ni estilos en línea salvo valores calculados (p. ej. el ancho de la barra de folios).
2. **Ningún color literal fuera de `tokens.css`.** `apps/web/.stylelintrc.json` rechaza hex, colores con nombre, `rgb()`/`hsl()`/`oklch()` y `!important` (`pnpm --filter web lint:css`). Se permiten `transparent`, `currentColor` y `color-mix()` sobre tokens.
3. Montos, RUT, folios y Track ID en `--font-mono` con `font-variant-numeric: tabular-nums`; montos alineados a la derecha.
4. Una sola acción `primario` por pantalla. `radius-full` solo para estados y la barra de folios.
5. Íconos `lucide-react`: 16 px en texto, 20 px en navegación, `strokeWidth={1.5}`, `aria-hidden`. Los glifos de estado están en `Glifo` y no se duplican con Lucide.

## Componentes

Los ocho del design system mantienen la API de `design-system/timbre/components/index.d.ts`:

| Componente | Cliente | Notas |
|---|---|---|
| `Boton` | no | `variante` primario/secundario/discreto/peligro, `tamano` md/sm, `icono`. `clasesBoton()` da el mismo aspecto a un `Link`. |
| `EstadoDTE` | no | Estados del documento, **más `incierto`** (ver abajo). `textoEstadoDte()` devuelve la palabra oficial para filtros. |
| `TipoDTE` | no | `corto`, `soloCodigo`. |
| `Monto` | no | CLP sin decimales; USD/UF con dos decimales; `destacado`, `tenue`. |
| `CampoRut` | sí | Formatea al salir del campo y valida el dígito verificador. Las estáticas `CampoRut.formatear/validar` no cruzan al servidor: ahí se usa `@/lib/formatos`. |
| `Alerta` | no | `error` → `role="alert"`; el resto `role="status"`. |
| `MedidorFolios` | no | Aviso bajo el 15 % (`UMBRAL_AVISO_FOLIOS`). `calcularFolios()` es puro y sirve en el servidor para bloquear la emisión con el CAF agotado. |
| `TablaDTE` | sí | Selección con clic, Enter o Espacio (`aria-selected`). |

Componentes de soporte (equivalen a las clases `tb-*` de las plantillas):

| Componente | Cliente | Uso |
|---|---|---|
| `Campo` + `Input` / `Select` | sí | `Campo` pone etiqueta, ayuda o error y pasa `id`, `aria-describedby` y `aria-invalid` al control por contexto. `useCampo()` para controles propios. |
| `Tarjeta` | no | `as`, `relleno` (`ninguno`/`md`/`lg`), `variante` (`elevada`/`plana`/`tenue`). |
| `Tabla`, `Th`, `Td`, `TablaVacia` | no | Tablas genéricas con el aspecto de `TablaDTE`; `num` y `mono` en celdas. Con `etiqueta`, el marco desplazable es una región accesible. |
| `NavItem` | no | `Link` con `icono` y `activo` (`aria-current="page"`). |
| `Dialogo` | sí | Confirmación de operaciones ⚠️. `<dialog>` nativo; foco inicial en «Cancelar»; Escape cierra salvo `cargando`; el clic en el fondo no cierra. |
| `PanelDetalle` | no | Panel lateral del detalle; se cierra con `hrefCerrar` (URL) u `onCerrar`. |
| `Paginacion` | no | «Mostrando 1–8 de 128» y enlaces Anterior/Siguiente con `hrefPagina(n)`. |
| `BannerAmbiente` | no | En `certificacion` muestra la `Alerta` info fija «Estás en el ambiente de certificación del SII»; en `produccion` no muestra nada. Toda página de la app la recibe en `aviso`. |

Layouts:

- **`LayoutApp`**: menú lateral (marca, empresa activa o `selectorEmpresa`, navegación, usuario) y `main`. Props `org`, `activo`, `empresa`, `usuario`, `aviso`, `banderas`. Incluye el enlace «Ir al contenido».
- **`LayoutIngreso`**: panel `sello` con borde perforado y la columna del formulario (pantallas de la Fase 2).

**Navegación** (`navegacion.ts`): Tablero, Emitir documento, Documentos emitidos, Folios (CAF), Certificación y Configuración. «Documentos recibidos» y «Libro de Compras y Ventas» están ocultos por las banderas `dteRecibidos` y `libroComprasVentas` hasta la Fase 14 (H2).

## Estado `incierto` (decisión D3)

Un envío sin Track ID no se sabe si llegó al SII (`estado_documento = 'incierto'`). En la UI:

- Palabra **«Por verificar»**, tono `aviso`, glifo de signo de interrogación.
- Nunca ofrece «Reenviar»: va acompañado de una `Alerta` `aviso` que pide revisar el estado en el SII antes de volver a enviar (principio 3 del plan).

El estado está en la app y en el design system (artifact y copia en `design-system/timbre/`, 2026-11-12): `EstadoDTE` lo lista con su glifo, `index.d.ts` lo incluye en `EstadoDte` y el manual de marca lo nombra entre los estados.

## Accesibilidad y verificación

`e2e/design-system.spec.ts` corre en tres proyectos (claro, oscuro y móvil) contra `/_ds`, `/_ds/app` y `/_ds/ingreso`:

- axe con WCAG 2.1 A/AA (incluye contraste 4,5:1) sin violaciones, también con `data-theme="dark"` y con el `Dialogo` abierto.
- Sin desborde horizontal (móvil incluido).
- Foco visible con `--focus-ring`, selección de `TablaDTE` con teclado, `Dialogo` devuelve el foco y cierra con Escape, `CampoRut` formatea y avisa un dígito malo.
- Guarda capturas por componente en `apps/web/test-results/capturas/` para compararlas con los `preview.html`.

**Contra un deploy** (solo lectura, no toca el SII): `E2E_URL=https://<deploy> pnpm --filter web test:e2e` corre solo `e2e/despliegue.spec.ts`, sin levantar servidor. Comprueba que la portada carga con código 200, sin errores de consola y sin violaciones de axe; que los tokens y las fuentes Plex llegan en claro y oscuro; que `/_ds` responde 404; y que la portada no desborda en móvil.

## Trampas

- Una carpeta `_ds` en App Router es **privada** (no genera ruta): por eso la carpeta se llama `%5Fds`.
- `%5Fds` **no tiene `layout.tsx`**: `next dev` tipa el layout de una carpeta `%5F…` como `"/%5Fds"` y `next build` como `"/_ds"`, y como `tsconfig.json` incluye los dos directorios de tipos (`.next/types` y `.next/dev/types`), el typecheck falla. Cada página llama a `soloDesarrollo()` y exporta `metadataDs` (`%5Fds/solo-desarrollo.ts`).
- Un componente `'use client'` no puede recibir funciones desde un Server Component (p. ej. `onSeleccionar` de `TablaDTE`): la página que lo usa con callbacks debe ser cliente o envolverlo.
