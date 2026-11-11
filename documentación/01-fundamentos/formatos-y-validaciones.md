---
title: "Formatos y validaciones: RUT, correo, montos, IVA y fechas"
description: "Dominios rut y correo_sii, montos enteros, cálculo neto/IVA, hora de Chile y largos del SII."
keywords: ["formatearRut", "validarRut", "calcularDv", "rutSii", "formatearMonto", "formatearFecha", "formatearFechaHora", "TIPOS_DTE", "lib/formatos"]
related: ["04-objetos/objetos-documentos.md", "07-referencia/reglas-y-limites.md", "07-referencia/design-system.md"]
source: ["supabase_saas_sii.sql §2 §10", "certificacion-node/docs/core.md", "design-system/timbre/README.md"]
---

# Formatos y validaciones: RUT, correo, montos, IVA y fechas

> **Úsalo cuando:** vas a escribir un RUT, correo o monto, o reproducir los totales de una boleta.

## Formatos de presentación (`apps/web/src/lib/formatos.ts`)

Funciones puras, sin React ni APIs del navegador: las usan los componentes y el servidor
(correos, PDF, API). Probadas en `formatos.test.ts`.

| Función | Entrada → salida | Regla |
|---|---|---|
| `formatearMonto(valor, moneda = 'CLP')` | `1190000` → `$ 1.190.000` · `-238000` → `−$ 238.000` · `(12400.5, 'USD')` → `US$ 12.400,50` · `(35.2, 'UF')` → `UF 35,20` | CLP sin decimales (redondeo); otras monedas con dos decimales y coma; negativo con signo menos tipográfico (U+2212) |
| `formatearMiles(n)` | `18244` → `18.244` | Punto de miles, entero |
| `limpiarRut(rut)` | ` 76.354.771-k ` → `76354771K` | Solo dígitos y K mayúscula |
| `calcularDv(cuerpo)` | `76354771` → `K` | Módulo 11 |
| `validarRut(rut)` | `76.354.771-K` → `true` | Al menos 2 caracteres, cuerpo sin K, DV correcto |
| `formatearRut(rut)` | `76354771k` → `76.354.771-K` | Para mostrar; quita ceros a la izquierda |
| `rutSii(rut)` | `76.354.771-k` → `76354771-K` | Formato que piden el SII y la base (sin puntos, con guion) |
| `formatearFecha(fecha)` | `'2026-11-10'` → `10-11-2026` | Una columna `date` (`AAAA-MM-DD`) se formatea sin zona horaria; un instante, en hora de Chile (`America/Santiago`) |
| `formatearFechaHora(fecha)` | `'2026-11-10T19:18:00Z'` → `10-11-2026 16:18` | 24 h, hora de Chile |
| `nombreTipoDte(codigo, corto?)` / `TIPOS_DTE` | `39` → `Boleta electrónica` / `Boleta` | Nombres oficiales del SII; código desconocido → `Documento tributario` |

Reglas de tono asociadas (design system): montos siempre con `Monto` o `formatearMonto`,
RUT con puntos y guion al mostrar, fechas `dd-mm-aaaa` y horas en 24 h. Nunca escribas un
formato a mano en una pantalla.

<!-- TODO (Fase 3): dominios `rut` y `correo_sii` del esquema y largos del SII (razón social, giro, dirección, comuna). -->
<!-- TODO (Fase 7): cálculo neto/IVA de boleta (precio bruto; neto = round(bruto / 1,19); IVA = bruto − neto) y montos enteros. -->
