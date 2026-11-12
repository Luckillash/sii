// Plantillas de correo de Timbre (PLAN-SAAS §4.6). Funciones puras: datos → asunto,
// HTML con estilos en línea y texto plano. El envío está en apps/web/src/server/correo.

export { type CorreoAuth, PLANTILLAS_AUTH, type PlantillaAuth } from './auth';
export { correoInvitacion, type DatosInvitacion } from './invitacion';
export type { Correo } from './plantilla';
