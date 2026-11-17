// Plantillas de correo de Boletéame (PLAN-SAAS §4.6). Funciones puras: datos → asunto,
// HTML con estilos en línea y texto plano. El envío está en apps/web/src/server/correo.

export { type CorreoAuth, PLANTILLAS_AUTH, type PlantillaAuth } from './auth';
export { correoBoleta, type DatosBoleta } from './boleta';
export { correoCertificacion, type DatosCertificacion } from './certificacion';
export { correoCertificadoPorVencer, type DatosCertificadoPorVencer } from './certificado';
export { correoFoliosPorAgotarse, type DatosFoliosPorAgotarse } from './folios';
export { correoEnvioIncierto, type DatosEnvioIncierto, type DocumentoIncierto } from './incierto';
export { correoInvitacion, type DatosInvitacion } from './invitacion';
export type { Correo } from './plantilla';
export {
  correoDocumentosRechazados,
  type DatosDocumentosRechazados,
  type DocumentoRechazado,
} from './rechazo';
