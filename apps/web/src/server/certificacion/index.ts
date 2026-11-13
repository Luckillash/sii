// API de la capa de certificación ante el SII (PLAN-SAAS Fase 5) que consumen la página
// y las Server Actions de `/[org]/certificacion`. Todo es solo de servidor (cada módulo
// importa `server-only`). El contrato con la UI y las reglas comunes están en
// `comun.ts` y en `@/lib/certificacion`.

export { guardarDatosDeclaracion, guardarDatosPostulacion } from './datos';
export {
  consultarEstadoDeclaracion,
  declarar,
  solicitarRevision,
} from './declaracion';
export type { DependenciasCertificacion } from './dependencias';
export { consultarEstadoSet, enviarSet } from './envio-set';
export { solicitarFoliosSet } from './folios';
export { leerAsistente } from './lectura';
export { marcarRevisada } from './operaciones';
export { postular } from './postulacion';
export { descargarSet } from './set';
export type {
  CafSet,
  CasoSet,
  ContextoCertificacion,
  DatosDeclaracionForm,
  DatosPostulacionForm,
  EnvioSet,
  FilaProceso,
  OperacionAsistente,
  VistaAsistente,
} from './tipos';
