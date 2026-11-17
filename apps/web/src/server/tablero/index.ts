import 'server-only';

// API del Tablero (PLAN-SAAS Fase 9).
//
//   cifras.ts   filtros de la URL, cifras, textos y alertas de folios (puro)
//   lectura.ts  ventas y documentos por estado del período (sesión, RLS)
//
// Los medidores de folios salen de `leerResumenFolios` (`@/server/folios`) y los últimos
// documentos de `listarDocumentos` (`@/server/documentos`): no se duplican aquí.

export {
  type AlertaFolios,
  alertasFolios,
  type CifrasDocumentos,
  type ConteoEstados,
  cifrasDocumentos,
  detalleExento,
  detalleVentas,
  type FiltrosTablero,
  leerFiltrosTablero,
  type MedidorTablero,
  medidorFoliosTablero,
  opcionesPeriodoTablero,
  type Ventas,
} from './cifras';
export { type CifrasPeriodo, type ContextoTablero, leerCifras } from './lectura';
