---
title: "Esquema: RLS y privilegios"
description: "Políticas por tabla, grants de columnas y funciones, y protección de campos del sistema."
keywords: [registrar_certificado, registrar_resolucion, fijar_certificado_predeterminado, security definer, security invoker, grant execute]
related: ["03-api-reference/acceso-por-tabla.md"]
source: ["supabase_saas_sii.sql §17"]
---

# Esquema: RLS y privilegios

> **Úsalo cuando:** necesitas modificar o auditar los permisos.

<!-- TODO: redactar contenido -->

## Funciones de la migración 0005 (aplicada el 2026-11-13)

| Función | Seguridad | `execute` | Por qué |
|---|---|---|---|
| `registrar_certificado(...)` | `security definer`, `search_path = ''` | solo `service_role` (`revoke` a `public`, `anon`, `authenticated`) | escribe en Vault (`guardar_secreto`) y en `certificados`, que no tiene políticas de escritura; no revisa membresía, así que solo la llama el backend tras validar rol y .pfx |
| `registrar_resolucion(uuid, ambiente_sii, integer, date)` | `security invoker`, `search_path = ''` | `authenticated`, `service_role` | corre con el RLS de quien llama (escritura de administradores en `resoluciones` y candado `for no key update` sobre `empresas`) |
| `fijar_certificado_predeterminado(uuid, uuid)` | `security invoker`, `search_path = ''` | `authenticated`, `service_role` | ídem, sobre `empresa_certificados` |

No agrega grants de tablas: `authenticated` ya tenía `select`/`insert`/`update` sobre
`empresas`, `resoluciones` y `empresa_certificados` (RLS decide las filas) y `execute`
sobre `es_admin`. `certificados` sigue sin políticas de escritura. Lo comprueba
`supabase/verificaciones/0005_certificados_resoluciones.sql` (comprobaciones 4–10 y 13).
Contratos en [RPC de organización](../03-api-reference/rpc-organizacion.md#empresa-resolución-y-certificado-predeterminado-migración-0005)
y [RPC del backend](../03-api-reference/rpc-backend.md#registrar_certificado-migración-0005).
