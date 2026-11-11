// Transporte HTTP común a todos los clientes del SII (PLAN-MIGRACION.md §4, `comun/http/*`).

export {
  type CamposFormulario,
  codificarFormulario,
  codificarUrl,
  type ValorFormulario,
} from './formulario.ts';
export {
  armarMultipart,
  boundaryAleatorio,
  type CampoMultipart,
  type MultipartArmado,
} from './multipart.ts';
export {
  type CabecerasEntrada,
  exigirStatus,
  hostDe,
  RespuestaHttp,
  urlSinQuery,
} from './respuesta.ts';
export {
  ACCEPT_ENCODING,
  type CuerpoHttp,
  type IdentidadTls,
  type MetodoHttp,
  MS_CONEXION_POR_DEFECTO,
  MS_RESPUESTA_POR_DEFECTO,
  type PeticionHttp,
  type PeticionPreparada,
  prepararPeticion,
  type TransporteHttp,
} from './transporte.ts';
export {
  type PeticionRegistrada,
  type RespuestaFalsa,
  TransporteFalso,
} from './transporte-falso.ts';
export { type OpcionesTransporteUndici, TransporteUndici } from './transporte-undici.ts';
