// Design system «Timbre» en la app (PLAN-SAAS Fase 1). Los formatos (RUT, montos,
// fechas, tipos de DTE) están en `@/lib/formatos`, que también usa el servidor.

export { Alerta, type AlertaProps } from './Alerta';
export { BannerAmbiente, type BannerAmbienteProps } from './BannerAmbiente';
export { Boton, type BotonProps, clasesBoton, type TamanoBoton, type VarianteBoton } from './Boton';
export { Campo, type CampoProps, unirIds, useCampo } from './Campo';
export { CampoRut, type CampoRutProps } from './CampoRut';
export { Dialogo, type DialogoProps } from './Dialogo';
export { EstadoDTE, type EstadoDTEProps, textoEstadoDte } from './EstadoDTE';
export { Glifo, type GlifoProps, type NombreGlifo } from './Glifo';
export { Input, type InputProps } from './Input';
export {
  type EmpresaActiva,
  LayoutApp,
  type LayoutAppProps,
  type UsuarioActivo,
} from './LayoutApp';
export { LayoutIngreso, type LayoutIngresoProps } from './LayoutIngreso';
export {
  calcularFolios,
  type EstadoFolios,
  MedidorFolios,
  type MedidorFoliosProps,
  UMBRAL_AVISO_FOLIOS,
} from './MedidorFolios';
export { Monto, type MontoProps } from './Monto';
export { NavItem, type NavItemProps } from './NavItem';
export {
  BANDERAS_POR_DEFECTO,
  type BanderaFuncion,
  type ClaveNavegacion,
  hrefNavegacion,
  type ItemNavegacion,
  NAVEGACION,
  navegacionVisible,
} from './navegacion';
export { Paginacion, type PaginacionProps } from './Paginacion';
export { PanelDetalle, type PanelDetalleProps } from './PanelDetalle';
export { Select, type SelectProps } from './Select';
export { Tabla, type TablaProps, TablaVacia, Td, Th } from './Tabla';
export { TablaDTE, type TablaDTEProps } from './TablaDTE';
export { Tarjeta, type TarjetaProps } from './Tarjeta';
export { TipoDTE, type TipoDTEProps } from './TipoDTE';
export type { CodigoDte, DocumentoFila, EstadoDte, Tono } from './tipos';
