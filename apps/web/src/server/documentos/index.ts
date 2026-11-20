import 'server-only';

// API de lectura de `/[org]/documentos`, `/[org]/envios/[id]` y del Tablero, más «Reenviar
// al receptor» (PLAN-SAAS Fase 8). La consulta al SII («Consultar estado en el SII») NO
// vive aquí: es `consultarEnvio` de `@/server/seguimiento`.
//
//   filtros.ts       filtros desde la URL y armado de la consulta (puro)
//   @/lib/documentos-presentacion  estados, errores del SII y avisos (puro, también cliente)
//   lectura.ts       listado paginado, detalle de documento y de envío, inciertos (sesión, RLS)
//   reenviar.ts      reenvío del PDF al receptor (Resend)

export {
  ambientePorDefecto,
  type ConsultaBitacora,
  type DetalleDocumento,
  type DetalleEnvio,
  type EnvioIncierto,
  type EnvioResumen,
  type EstadisticaEnvio,
  empresaDelDocumento,
  enviosInciertos,
  type FilaDocumento,
  type LineaDocumento,
  type ListaDocumentos,
  leerDetalleDocumento,
  leerEnvio,
  leerEnvioMinimo,
  listarDocumentos,
  type ObservacionSii,
} from './lectura';
export { type ResultadoReenvio, reenviarAlReceptor } from './reenviar';
export { marcarEnvioRevisado, type ResultadoRevision } from './revisar';
