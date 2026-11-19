import 'server-only';

// API pública `/api/v1` (PLAN-SAAS Fase 11). Lo que usan las rutas de `app/api/v1/`; el
// contrato con los clientes (alcances, errores, formas) está en `@/lib/api-publica`.
//
//   manejar.ts         autenticación (API key → sha256 → autenticar_api_key), alcance y errores
//   documentos.ts      POST /documentos (idempotencia), GET /documentos y /documentos/{id}
//   lote.ts            POST /documentos/lote (N emisiones independientes)
//   archivos.ts        GET /documentos/{id}/xml|pdf (reenvía los bytes de Storage)
//   folios.ts          GET /folios y POST /folios/solicitudes
//   envios.ts          GET /envios/{id}
//   repositorio.ts     acceso a la base (service_role, siempre filtrando por organización)

export { formatoPdf, manejarArchivo } from './archivos';
export type { DependenciasApi } from './dependencias';
export { manejarDocumento, manejarEmision, manejarListado } from './documentos';
export { manejarEnvio } from './envios';
export { manejarFolios, manejarSolicitudFolios } from './folios';
export { manejarLote } from './lote';
export { type ContextoApi, manejarApi } from './manejar';
