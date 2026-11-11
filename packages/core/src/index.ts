// API pública de @winex/certificacion.
// Port a Node.js de winex/certificacion v1.9.1 (Apache-2.0).

export {
  type CaratulaRcof,
  GeneradorConsumoFolios,
  type OpcionesConsumoFolios,
  type RangoFolios,
  type ResumenRcof,
} from './certificacion/consumo-folios.ts';
export {
  type ArchivoDte,
  ClienteDtews,
  type CredencialesDtews,
  type OpcionesClienteDtews,
  USER_AGENT_DTEUPLOAD,
} from './certificacion/dtews-soap.ts';
export {
  type CodigoEstadoEnvio,
  type DatosEstadoEnvio,
  EstadoEnvio,
} from './certificacion/estado-envio.ts';
export { firmarSemillaDtews, sobreGetToken } from './certificacion/firma-semilla-dtews.ts';
export {
  type ResumenDtes,
  rangosConsecutivos,
  resumirParaRcof,
} from './certificacion/resumen-rcof.ts';
export {
  type CasoSetPruebas,
  type DetalleSetPruebas,
  parsearSetPruebas,
} from './certificacion/set-pruebas.ts';
export {
  AMBIENTES,
  type Ambiente,
  type DatosAmbiente,
  datosAmbiente,
  esAmbiente,
} from './comun/ambiente.ts';
export { c14n, c14nPorEtiqueta, elementoPorEtiqueta } from './comun/c14n.ts';
export {
  aIso88591,
  decodificarUtf8OIso,
  desdeIso88591,
  escaparXml,
  esUtf8Valido,
  largoCodePoints,
  type ModoEscape,
  minusculasAscii,
  trimPhp,
  truncarCodePoints,
} from './comun/codificacion.ts';
export { decodificarEntidadesHtml } from './comun/entidades-html.ts';
export {
  DeclaracionInciertaError,
  ErrorCertificado,
  ErrorFirma,
  ErrorPostulacion,
  ErrorRespuestaSii,
  ErrorSolicitudFolios,
  ErrorTimbre,
  ErrorTransporte,
  ErrorValidacion,
  FolioInicialRequeridoError,
  FoliosSinCafError,
  SesionCaducaError,
  SetSinDescargarError,
  SiiError,
} from './comun/errores.ts';
export {
  atributo,
  type ElementoHtml,
  elementosPorNombre,
  parsearHtml,
  textoHtml,
} from './comun/html.ts';
export * from './comun/http/index.ts';
export {
  exigirSesionVigente,
  MARCADORES_LOGIN,
  MAX_REDIRECCIONES,
  navegar,
  type PeticionNavegacion,
  resolverUrl,
  type SesionNavegacion,
  USER_AGENT_NAVEGADOR,
} from './comun/navegacion-sii.ts';
export {
  fechaHoraSii,
  fechaSii,
  instanteSii,
  type Reloj,
  relojFijo,
  relojSistema,
  ZONA_SII,
} from './comun/reloj.ts';
export { calcularDv, Rut } from './comun/rut.ts';
export {
  type ClaveToken,
  huellaCertificado,
  type TokenGuardado,
  type TokenStore,
  TokenStoreArchivo,
  TokenStoreMemoria,
} from './comun/token-store.ts';
export {
  crearDocumento,
  crearElemento,
  type DeclaracionXml,
  declaracionXml,
  fijarAtributo,
  type OpcionesSerializacion,
  parsearDocumento,
  parsearXml,
  serializarXml,
} from './comun/xml.ts';
export { ArmadorBoleta, type OpcionesArmadorBoleta } from './core/armador-boleta.ts';
export { Certificado, type InfoCertificado } from './core/certificado.ts';
export {
  type DatosEnvioBoleta,
  EnvioBoleta,
  type OpcionesEnvioBoleta,
} from './core/envio-boleta.ts';
export { FirmaElectronica } from './core/firma-electronica.ts';
export {
  type DatosBoleta,
  type DescuentoGlobal,
  type DetalleBoleta,
  type EmisorBoleta,
  GeneradorBoleta,
  type OpcionesGeneradorBoleta,
  type ReceptorBoleta,
  type ReferenciaBoleta,
} from './core/generador-boleta.ts';
export { type DatosTed, type OpcionesTimbre, Timbre } from './core/timbre.ts';
export { type CookieSii, SesionSii } from './folios/sesion-sii.ts';
export {
  type CamposForm,
  type FormularioFolios,
  formularioFolios,
  HOST_AUTENTICACION,
  HOST_SESION,
  MS_ASISTENTE,
  MS_LOGIN,
  type OpcionesSolicitar,
  type OpcionesSolicitudFolios,
  SolicitudFolios,
} from './folios/solicitud-folios.ts';
export {
  DatosDeclaracion,
  DatosPostulacion,
  type EntradaDeclaracion,
  type EntradaPostulacion,
  validarCorreo,
} from './postulacion/datos-postulacion.ts';
// NavegadorSii y GwtRpc son internos (como en el PHP, @internal): no se exportan.
export {
  BASE_DECLARACION,
  DeclaracionBoletas,
  HOST_DECLARACION,
  MS_DECLARACION,
  type OpcionesDeclaracionBoletas,
  PASO_DECLARACION,
  PERMUTACION_DECLARACION,
  POLICY_DECLARACION,
} from './postulacion/declaracion-boletas.ts';
export { EstadoDeclaracion } from './postulacion/estado-declaracion.ts';
export {
  HOST_POSTULACION,
  MS_POSTULACION,
  type OpcionesPostulacionSii,
  PostulacionSii,
  type ResultadoPostulacion,
} from './postulacion/postulacion-sii.ts';
export {
  ClienteBoletaRest,
  type DetalleRepRechRest,
  type ErrorDocumentoRest,
  type EstadisticaEnvioRest,
  EstadoEnvioRest,
  NOMBRE_ARCHIVO_BOLETA,
  NOMBRE_ARCHIVO_RCOF,
  type OpcionesClienteBoletaRest,
  type OpcionesSubida,
  type RespuestaEnvioRest,
  SEGUNDOS_VIGENCIA_TOKEN,
  URLS_BOLETA_REST,
  type UrlsBoletaRest,
  USER_AGENT_BOLETA_REST,
} from './produccion/boleta-rest.ts';
