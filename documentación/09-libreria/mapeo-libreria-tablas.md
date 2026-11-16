---
title: "Librería: mapeo con las tablas"
description: "Qué clase o método de @winex/certificacion corresponde a cada tabla y columna, y qué módulo de la capa SII hace la traducción."
keywords: [mapeo, TokenStore, ClaveToken, TokenGuardado, tokens_sii, SesionSii, aArreglo, desdeArreglo, sesiones_sii, Certificado, desdeContenido, FirmaElectronica, huellaCertificado, certificados, empresa_certificados, Vault, SiiError, resultado_operacion, operaciones_sii, detalle, ErrorTransporte, ErrorRespuestaSii, FoliosSinCafError, FolioInicialRequeridoError, DeclaracionInciertaError, TransporteUndici, documentos-xml, xml_path, CODIGOS, DatosPostulacion, DatosDeclaracion, EstadoDeclaracion, parsearSetPruebas, CasoSetPruebas, ArmadorBoleta, EnvioBoleta, EstadoEnvioRest, procesos_certificacion, set_pruebas_casos, registrar_caf, guardar_set_pruebas, server/folios, solicitarEnSii, TransporteSinTimbrar, simulada, validarCaf, Timbre, RSAPK, datosAmbiente, anular_folios, folios_anulados]
related: ["03-api-reference/servicios-sii.md", "09-libreria/backend-service-role.md", "04-objetos/objetos-empresas-y-credenciales.md", "04-objetos/objetos-auditoria-e-integraciones.md", "04-objetos/objetos-folios.md"]
source: ["supabase_saas_sii.sql (cabecera)", "certificacion-node/docs/core.md", "apps/web/src/server/sii/", "packages/certificacion/packages/core/src/comun/errores.ts", "packages/certificacion/apps/cli/src/errores.ts", "apps/web/src/server/certificacion/", "apps/web/src/server/folios/", "apps/web/src/server/emision/"]
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

## Certificación (Fase 5)

Lo traduce `apps/web/src/server/certificacion/` (no `server/sii/`). Lo que cambia `etapa`
o el estado SII del proceso se escribe con `service_role` filtrando por organización
(`actualizarProceso` de `comun.ts`).

| Librería | Módulo | Tabla y columnas |
|---|---|---|
| `DatosPostulacion` (validación) | `datos.ts`, `postulacion.ts` | `procesos_certificacion`: `rut_administrador`, `correo_administrador`, `correo_contacto_sii`, `correo_intercambio`, `nombre_software`, `boleta_exenta`, `url` |
| `ResultadoPostulacion.avisos` | `postulacion.ts` | `procesos_certificacion.avisos_postulacion` (arreglo JSON de textos), `postulada_en`; `etapa = 'postulada'` si estaba en `borrador` |
| (primera postulación) | `postulacion.ts` | `resoluciones` vía `registrar_resolucion` (número 0, fecha del día en Chile) si la empresa no tiene una vigente de certificación |
| `EstadoDeclaracion` (`codigo`, `glosa`, `paso`) | `set.ts` (`guardarEstadoDeclaracion`), `declaracion.ts` | `procesos_certificacion.codigo_estado_sii`, `glosa_estado_sii` (nula si viene vacía), `paso_sii`, `estado_consultado_en`. P90/P91 los traduce el trigger `tg_certificacion_autorizada` a `etapa` y `empresas.autorizada_produccion` |
| `descargarSetPruebas()` (texto) + `parsearSetPruebas(texto, '39')` → `CasoSetPruebas[]` | `set.ts` (`casosJson`) | `guardar_set_pruebas` 🔒: `set_pruebas_casos` (`numero_caso` de `CASO-N`, `tipo_dte`, `detalles` = `DetalleSetPruebas[]`, `referencia_codigo`, `referencia_razon`) y `procesos_certificacion` (`set_pruebas_texto`, `correo_proveedor_set`, `set_descargado_en`, `etapa = 'set_descargado'`) |
| `SolicitudFolios.solicitar()` → CAF (`Buffer`) | `folios.ts` → `server/folios/sii.ts` (`solicitarEnSii`, desde la Fase 6) | `solicitudes_folios` (bitácora: `cantidad`, `folio_inicial`, `estado`, `mensaje`, `certificado_id`, `solicitado_por`); el `<DA>` del CAF (`leerDatosCaf`) y el XML completo → `registrar_caf` 🔒 → Vault + `cafs` (`folio_desde`, `folio_hasta`, `fecha_autorizacion`, `idk`, `rut_emisor`, `razon_social`, `caf_secret_id`, `solicitud_id`) |
| `FoliosSinCafError.folioDesde` / `.folioHasta` | `server/folios/sii.ts` (`cierreDeError`) | `solicitudes_folios.estado = 'incierta'` con `folio_desde`/`folio_hasta` |
| `ErrorSolicitudFolios` / `ErrorTransporte` (antes de timbrar) | `server/folios/sii.ts` | `solicitudes_folios.estado = 'rechazada'` / `'error'`, `mensaje` saneado |
| `asignar_folio` (base) | `envio-set.ts` | `cafs.siguiente_folio`; si el envío no sale, `folios_anulados` (`caf_id`, `folio`, `motivo`, `anulado_por`) |
| `ArmadorBoleta.armar()` → DTE firmado | `envio-set.ts` (`leerDte`) | Storage `DTE-39-F<folio>.xml`; `documentos` (`folio`, `caf_id`, `fecha_emision`, montos `MntNeto`/`MntExe`/`IVA`/`MntTotal`, `ted_xml`, `xml_path`, `origen = 'set_pruebas'`, `caso_set`, `referencia_*`, `estado = 'firmado'`); `documento_detalles` (de cada `<Detalle>`); `set_pruebas_casos.documento_id` |
| `EnvioBoleta.empaquetar()` → sobre | `envio-set.ts` | Storage `EnvioBOLETA-set-<envio>.xml`; `envios` (`proposito = 'set_pruebas'`, `canal = 'rest'`, `rut_envia`, `certificado_id`, `nro_resol`, `fch_resol`, `tmst_firma`, `nombre_archivo = NOMBRE_ARCHIVO_BOLETA`, `xml_path`) |
| `RespuestaEnvioRest` (`trackId`, `estado`, `json`) | `envio-set.ts` | `envios.track_id`, `enviado_en`, `respuesta_subida`, `estado_sii` (solo si es `REC`, `SOK`, `CRT`, `FOK`, `PRD` o `EPR`); `procesos_certificacion.envio_set_id`, `etapa = 'set_enviado'` |
| `ErrorTransporte` después de salir | `envio-set.ts` | `envios.incierto = true`, `envios.error` (el trigger deja los documentos `incierto`) |
| `EstadoEnvioRest` (`estado`, conteos, `fechaRecepcion`, `json`) | `envio-set.ts` (`guardarEstado`) | `envios` (`estado_sii`, `informados`, `aceptados`, `rechazados`, `reparos`, `fecha_recepcion` solo si trae zona horaria, `respuesta_estado`, `ultima_consulta_en`, `consultas + 1`); `consultas_envio` (una fila por consulta) |
| `EstadoEnvioRest.estadistica[]` | `envio-set.ts` | `envio_estadisticas` (upsert por `envio_id, tipo_dte`) |
| `EstadoEnvioRest.detalleRepRech[]` | `envio-set.ts` | `envio_rechazos` (se borran y se reinsertan en cada consulta; `tipo_observacion = 'reparo'` si el estado es `RPR`, `REP` o `RLV`, si no `'rechazo'`; `errores` JSON) |
| `EstadoEnvioRest.limpio()` | `envio-set.ts` | `procesos_certificacion.etapa = 'set_aceptado'` (solo desde `set_enviado`) |
| `solicitarRevisionSet()` | `declaracion.ts` | `procesos_certificacion.revision_solicitada_en`, `etapa = 'revision_solicitada'` |
| `DatosDeclaracion` + `declarar()` → `EstadoDeclaracion` | `datos.ts`, `declaracion.ts` | `procesos_certificacion`: `link_consulta`, `rut_proveedor`, `nombre_proveedor`, `correo_proveedor`; al declarar, `declarada_en` y el estado SII |

Lo que **nunca** se guarda: el XML del CAF fuera de Vault (ni en `operaciones_sii`,
`solicitudes_folios.mensaje` o logs), la llave `<RSASK>`, el token REST ni las cookies.
Columnas en [objetos de certificación](../04-objetos/objetos-certificacion.md).

## Folios (Fase 6)

Lo traduce `apps/web/src/server/folios/`, en certificación o producción. Columnas en
[objetos de folios](../04-objetos/objetos-folios.md).

| Librería | Módulo | Tabla y columnas |
|---|---|---|
| `SolicitudFolios.solicitar()` con `TransporteSinTimbrar` → `FoliosSinCafError` (causa `DetenidoAntesDeTimbrar`) | `sii.ts` (revisión) | `solicitudes_folios`: `confirmada = false`, `estado = 'simulada'`, `folio_desde`/`folio_hasta` (el rango que asignaría el SII); `operaciones_sii` con `confirmada = false` y `detalle.nivel = 'revision'` |
| `SolicitudFolios.solicitar()` → CAF (`Buffer`) | `sii.ts` (timbraje) | igual que en la Fase 5 (arriba), con el `ambiente` pedido; `detalle.nivel = 'timbrar'` |
| CAF timbrado que no se pudo guardar | `sii.ts` (`rangoDelCaf`) | `solicitudes_folios.estado = 'incierta'` con el rango leído del `<DA>` (si se pudo) |
| `parsearDocumento`, `new Timbre(xml)`, `datosAmbiente(ambiente).idk`, `Rut` | `caf.ts` (`validarCaf`, carga manual) | nada hasta pasar las 8 validaciones; después `registrar_caf` 🔒 (con `p_solicitud` = la `incierta` que calce, que queda `timbrada`) |
| (la app) `<RSASK>` vs `<RSAPK>` | `caf.ts` (`llavesCoinciden`, como `sii util verificar-ted`) | — |
| (la base) `anular_folios` | `anular.ts` | `folios_anulados` (`caf_id`, `folio`, `motivo`, `anulado_por`); con la cola, `cafs.siguiente_folio = folio_hasta + 1` y `estado = 'anulado'` |
| (la app) alerta `folios.por_agotarse` | `alertas.ts` | `webhook_entregas` vía `encolar_evento` 🔒; correo por Resend |

Lo que **nunca** se guarda tampoco aquí: el XML del CAF subido fuera de Vault (ni su nombre
de archivo), la `<RSASK>` en mensajes de error ni en logs.

## Emisión (Fase 7)

Lo traduce `apps/web/src/server/emision/`, en certificación o producción. Columnas en
[objetos de documentos](../04-objetos/objetos-documentos.md) y
[de envíos](../04-objetos/objetos-envios-y-rcof.md); flujo en la
[guía](../02-guias/emision-boletas.md).

| Librería | Módulo | Tabla y columnas |
|---|---|---|
| (la app) `Borrador` validado con `esquemaBorrador` + `calcularTotales` | `borradores.ts` (`guardarEnSesion`, sesión) | `documentos` (`estado = 'borrador'`, `origen = 'panel'`, receptor, totales, descuento, `metadata.receptor_correo`, `creado_por`); `documento_detalles` (reemplazadas, con `descuento_monto` y `monto_item`); `receptores` (upsert por empresa y RUT) |
| `ClienteBoletaRest.obtenerToken()` | `emitir.ts` | `tokens_sii` (vía `TokenStoreSupabase`) |
| `asignar_folio` (base) | `emitir.ts` | `cafs.siguiente_folio`; si la boleta no llega al SII, `folios_anulados` (`caf_id`, `folio`, `motivo`, `anulado_por`) |
| `ArmadorBoleta.armar()` → DTE firmado | `emitir.ts`, `representacion.ts` (`leerDte`) | Storage `DTE-<tipo>-F<folio>.xml`; en un solo `update`: `documentos.folio`, `caf_id`, `ted_xml` (texto `latin1`), `timbrado_en`, `firmado_en`, `xml_path`, `mnt_neto`/`mnt_exe`/`iva`/`mnt_total` (del DTE), `descuento_aplicado`, `fecha_emision`, `envio_id`, `estado = 'firmado'` |
| `EnvioBoleta.empaquetar()` → sobre | `emitir.ts` | Storage `EnvioBOLETA-<tipo>-F<folio>.xml`; `envios` (`proposito = 'emision'`, `canal = 'rest'`, `rut_envia`, `certificado_id`, `nro_resol`, `fch_resol`, `tmst_firma`, `nombre_archivo = NOMBRE_ARCHIVO_BOLETA`, `xml_path`) |
| `RespuestaEnvioRest` (`trackId`, `estado`, `json`) | `emitir.ts` | `envios.track_id`, `enviado_en`, `respuesta_subida`, `estado_sii` (solo de subida); `documentos.estado = 'enviado'` |
| error después de salir (salvo `ErrorValidacion` y HTTP < 500) | `emitir.ts` (`envioIncierto`) | `envios.incierto = true`, `envios.error` (el trigger deja el documento `incierto`) |
| `ErrorTransporte` HTTP < 500 o `ErrorValidacion` después de salir | `emitir.ts` | `documentos.estado = 'anulado'`, `folios_anulados`, `envios.error`; con 401, `olvidarToken` |
| (la app) `generarPdf` carta y rollo | `representacion.ts`, `server/pdf/` | Storage `DTE-<tipo>-F<folio>-carta.pdf` / `-rollo.pdf`; `documentos.metadata.pdf` |
| (la app) correo con el PDF (Resend) | `representacion.ts`, `server/correo/boleta.ts` | `documentos.metadata.correo` (`id`, `enviado_en`) |

Lo que **nunca** se guarda: el XML del CAF fuera de Vault, la `<RSASK>`, el token ni el
PEM/clave del certificado (ni en `operaciones_sii`, `envios.error` o logs).

<!-- TODO (Fase 8): envíos y estadísticas del seguimiento automático. -->
