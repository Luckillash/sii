import 'server-only';

// API de la capa de emisión (PLAN-SAAS Fase 7) que consumen la página y las Server
// Actions de `/[org]/emitir`. Contrato con la UI en `@/lib/emision`.
//
// Las firmas de este archivo son el contrato entre el backend y la UI (si una tiene que
// cambiar, se coordina). Cada función acepta un último parámetro opcional `dependencias`
// solo para las pruebas (la UI no lo pasa). La implementación vive en los módulos de esta
// carpeta:
//
//   lectura.ts     leerVistaEmision (sesión, RLS)
//   emitir.ts      emitirDocumento: ensayo y emisión ⚠️ (ejecutarOperacion('emitir'))
//   borradores.ts  guardarBorrador / borrarBorrador (sesión, RLS)
//   catalogo.ts    buscarReceptores / buscarProductos (sesión, ilike saneado)
//   enlaces.ts     enlaceDocumento (URL firmada; regenera el PDF si falta)

export { borrarBorrador, guardarBorrador } from './borradores';
export { buscarProductos, buscarReceptores } from './catalogo';
export type { DependenciasEmision } from './dependencias';
export { emitirDocumento } from './emitir';
export { enlaceDocumento } from './enlaces';
export { leerVistaEmision } from './lectura';
export type { ContextoEmision, EntradaEmision } from './tipos';
