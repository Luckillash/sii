// API de la capa de folios (CAF) (PLAN-SAAS Fase 6) que consumen la página y las Server
// Actions de `/[org]/folios`, y los puntos de enganche de la Fase 7 (emisión). Todo es
// solo de servidor (cada módulo importa `server-only`). El contrato con la UI está en
// `@/lib/folios`.

export {
  alertaDespuesDeAsignar,
  alertarSiCruza,
  claveIdempotenciaAlerta,
  EVENTO_FOLIOS_POR_AGOTARSE,
} from './alertas';
export { anularFolios, type EntradaAnular } from './anular';
export { type DatosCaf, leerDatosCaf, validarCaf } from './caf';
export { disponibilidad, foliosDisponibles, puedeEmitir } from './disponibles';
export { leerFolios } from './lectura';
export { type OpcionesSolicitud, solicitarFolios } from './solicitar';
export { type EntradaSubida, subirCaf } from './subir';
export type {
  ClaveFolios,
  ContextoFolios,
  FilaCaf,
  FilaSolicitud,
  OperacionFolios,
  ResumenTipo,
  VistaFolios,
} from './tipos';
