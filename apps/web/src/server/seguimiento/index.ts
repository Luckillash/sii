import 'server-only';

// API del seguimiento de envíos (PLAN-SAAS Fase 8) que consumen la ruta
// `/api/cron/seguimiento` y la Server Action «Consultar estado en el SII» del panel.
// Contrato con la UI en `@/lib/seguimiento`.
//
// Cada función acepta un último parámetro opcional `dependencias` solo para las pruebas
// (la ruta y la UI no lo pasan). La implementación vive en los módulos de esta carpeta:
//
//   cron.ts             ejecutarSeguimiento: la corrida del cron (lotes, backoff, grupos)
//   consultar-envio.ts  consultarEnvio: un envío a pedido desde el panel
//   consulta.ts         cliente de estado por canal (REST/SOAP) y renovación del token
//   persistencia.ts     qué se escribe por consulta y en qué orden (triggers)

export { consultarEnvio, SEGUNDOS_ENTRE_CONSULTAS } from './consultar-envio';
export { ErrorSeguimiento, ejecutarSeguimiento, TOPE_ENVIOS } from './cron';
export type { DependenciasSeguimiento } from './dependencias';
export type { ContextoConsultaEnvio } from './tipos';
