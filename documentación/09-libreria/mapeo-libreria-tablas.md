---
title: "Librería: mapeo con las tablas"
description: "Qué clase o método de @winex/certificacion corresponde a cada tabla y columna, y qué módulo de la capa SII hace la traducción."
keywords: [mapeo, TokenStore, ClaveToken, TokenGuardado, tokens_sii, SesionSii, aArreglo, desdeArreglo, sesiones_sii, Certificado, desdeContenido, FirmaElectronica, huellaCertificado, certificados, empresa_certificados, Vault, SiiError, resultado_operacion, operaciones_sii, detalle, ErrorTransporte, ErrorRespuestaSii, FoliosSinCafError, FolioInicialRequeridoError, DeclaracionInciertaError, TransporteUndici, documentos-xml, xml_path, CODIGOS]
related: ["03-api-reference/servicios-sii.md", "09-libreria/backend-service-role.md", "04-objetos/objetos-empresas-y-credenciales.md", "04-objetos/objetos-auditoria-e-integraciones.md"]
source: ["supabase_saas_sii.sql (cabecera)", "certificacion-node/docs/core.md", "apps/web/src/server/sii/", "packages/certificacion/packages/core/src/comun/errores.ts", "packages/certificacion/apps/cli/src/errores.ts"]
---

# Librería: mapeo con las tablas

> **Úsalo cuando:** necesitas saber dónde guardar lo que devuelve la librería.

La cabecera de `supabase_saas_sii.sql` ya relaciona cada pieza de la librería con su tabla.
Esta página dice, además, **qué módulo de `apps/web/src/server/sii/` hace la traducción**,
para que nadie escriba esas tablas a mano.

## Credenciales y autenticación (Fase 4)

| Librería | Capa SII | Tabla y columnas |
|---|---|---|
| `Certificado.desdeContenido(pfx, clave)`, `FirmaElectronica`, `huellaCertificado()` | `crearCredenciales()` (`credenciales.ts`) | lee `certificados` (`pfx_secret_id`, `clave_secret_id` → Vault con `leer_secreto`; `huella_sha256`, `rut_titular`, `vigente_desde`/`vigente_hasta`, `revocado_en`) y `empresa_certificados` (`predeterminado`, `es_representante_electronico`) |
| `TokenStore` (`ClaveToken` → `TokenGuardado`) | `TokenStoreSupabase` (`token-store-supabase.ts`) | `tokens_sii`: `canal`, `ambiente`, `rut_empresa` (`ClaveToken.rutEmpresa`), `huella_certificado` (`huellaCertificado`), `token_cifrado` (`token`, cifrado), `vence_en` (`venceEn`) |
| `SesionSii.aArreglo()` / `SesionSii.desdeArreglo()` | `SesionesSupabase` (`sesiones.ts`) | `sesiones_sii`: `certificado_id` (de las credenciales), `ambiente`, `cookies_cifradas` (el arreglo, cifrado), `expira_en`, `ultimo_uso_en` |
| `SolicitudFolios.autenticar()` / `PostulacionSii.autenticar()` | `conSesionReutilizada()` dentro de `conBloqueoCertificado()` | `sesiones_sii` (arriba) y `bloqueos_sii` (`certificado_id`, `ambiente`, `titular`, `vence_en`) |
| `TransporteUndici` (`TransporteHttp`) | `crearTransporte()` (`transporte.ts`) | — (por invocación, nunca persistido) |

## Errores → auditoría

| Librería | Capa SII | `operaciones_sii` |
|---|---|---|
| `SiiError` y derivados; `CODIGOS` de la CLI | `resultadoDeError()`, `CODIGO_DE_RESULTADO` (`errores.ts`) | `resultado` (enum `resultado_operacion`, 0–7) |
| `message` de un `SiiError` | `mensajeParaUsuario()` + `mensajeEnTexto()` | `mensaje` |
| `ErrorTransporte.status`, `.url` | `detalleSeguro()` / `hostDelError()` | `detalle.error.status`, `detalle.error.host` (sin ruta ni query); etiqueta `host_sii` en Sentry |
| `ErrorRespuestaSii.estado`, `.glosa` | `detalleSeguro()` | `detalle.error.estado` (solo si mide ≤ 10), `detalle.error.glosa` |
| `FoliosSinCafError.folioDesde`, `.folioHasta`, `.ambiente` | `detalleSeguro()` | `detalle.error.folio_desde`, `folio_hasta`, `ambiente` |
| `FolioInicialRequeridoError.folioSugerido`, `.ambiente` | `detalleSeguro()` | `detalle.error.folio_sugerido`, `ambiente` |
| `DeclaracionInciertaError.rutEmpresa` | `detalleSeguro()` | `detalle.error.rut_empresa` |
| `cause` de cualquier error | — | **nunca** se guarda ni se muestra |

Tabla completa error → resultado en
[errores y resultados](../01-fundamentos/errores-y-resultados.md#error--resultado--qué-ve-el-usuario--sentry).

## Archivos

| Librería | Capa SII | Dónde |
|---|---|---|
| XML firmado (`Buffer` en ISO-8859-1): DTE, `EnvioBOLETA`, RCOF | `AlmacenDocumentos.subirXml()` (`almacen.ts`) | bucket `documentos-xml`, ruta `<org>/<empresa>/<ambiente>/<archivo>.xml`; la ruta devuelta va a `documentos.xml_path` / `envios.xml_path` |
| Representación impresa (PDF) | `AlmacenDocumentos.subirPdf()` | mismo bucket, `<archivo>.pdf` |

<!-- TODO (Fases 5–8): CAF (cafs + Vault), solicitudes_folios, documentos y documento_detalles, envios y estadísticas, procesos_certificacion y set_pruebas_casos. -->
