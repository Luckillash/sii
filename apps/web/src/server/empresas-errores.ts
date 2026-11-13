// Traducción de errores de Postgres/PostgREST a mensajes del design system (qué pasó y
// qué hacer) para empresas y resoluciones. Puro, sin `server-only`: se prueba con
// Vitest. Cada caso sale de supabase/migrations/0001_esquema_inicial.sql y
// 0005_certificados_resoluciones.sql:
//
//   23505  unique (organizacion_id, rut) de `empresas`: el RUT ya está en la
//          organización. En resoluciones, el índice `resoluciones_vigente_unica` (no
//          debería pasar: registrar_resolucion() toma un candado sobre la empresa).
//   P0001  `raise exception` sin código: tg_limite_empresas («El plan X permite como
//          máximo N empresa(s)», «La organización no tiene una suscripción vigente») y
//          tg_proteger_autorizacion («autorizada_produccion solo la cambia el sistema»).
//   23514  checks de largo de `empresas`, dominios `rut` y `correo_sii`, y en
//          registrar_resolucion() número negativo o distinto de 0 en certificación.
//   42501  RLS (WITH CHECK de `alta`/`edicion`, solo administradores) y
//          registrar_resolucion() («Sin permiso»).
//   P0002  registrar_resolucion(): la empresa no existe o RLS no deja verla.
//   22004  registrar_resolucion(): falta el ambiente, el número o la fecha.
//   22007/22008/22P02  fecha o uuid con formato inválido.

import {
  type ErrorBase,
  MENSAJE_GENERICO,
  MENSAJE_SIN_EFECTO,
  type MensajeError,
} from './equipo-errores';

export { type ErrorBase, MENSAJE_GENERICO, MENSAJE_SIN_EFECTO, type MensajeError };

export type OperacionEmpresa = 'crear' | 'editar' | 'activar' | 'desactivar' | 'resolucion';

const PATRON_CUPO = /El plan (.+?) permite como máximo (\d+) empresa/;

export const SIN_PERMISO: MensajeError = {
  titulo: 'No tienes permiso para hacer esto',
  detalle: 'Tu rol en la organización no lo permite. Pide ayuda a un propietario o administrador.',
};

export const RUT_DUPLICADO: MensajeError = {
  titulo: 'Ese RUT ya está registrado en la organización',
  detalle:
    'Búscalo en la lista de empresas. Si lo escribiste mal, corrígelo y vuelve a intentarlo.',
};

export function mensajeCupoEmpresas(plan: string, maximo: number): MensajeError {
  const empresas = maximo === 1 ? '1 empresa' : `${maximo} empresas`;
  return {
    titulo: `El plan ${plan} permite hasta ${empresas}`,
    detalle:
      'Cambia de plan para agregar otra. Las empresas desactivadas también cuentan para el límite.',
  };
}

export const SIN_PLAN_VIGENTE: MensajeError = {
  titulo: 'La organización no tiene un plan vigente',
  detalle: 'Renueva el plan para agregar empresas.',
};

export function traducirErrorEmpresa(
  error: ErrorBase | null | undefined,
  operacion: OperacionEmpresa,
): MensajeError {
  const mensaje = error?.message ?? '';
  const codigo = error?.code ?? '';

  const cupo = PATRON_CUPO.exec(mensaje);
  if (cupo?.[1] && cupo[2]) return mensajeCupoEmpresas(cupo[1], Number(cupo[2]));

  if (/no tiene una suscripción vigente/i.test(mensaje)) return SIN_PLAN_VIGENTE;

  if (/autorizada_produccion solo la cambia el sistema/i.test(mensaje)) {
    return {
      titulo: 'La autorización a producción la marca el sistema',
      detalle:
        'Queda lista sola cuando el SII autoriza la empresa al terminar la certificación. Recarga la página y vuelve a guardar.',
    };
  }

  if (codigo === '42501') return SIN_PERMISO;

  if (codigo === '23505') {
    if (operacion === 'crear') return RUT_DUPLICADO;
    if (operacion === 'resolucion') {
      return {
        titulo: 'Se registró otra resolución al mismo tiempo',
        detalle: 'Recarga la página para ver la vigente y, si hace falta, vuelve a registrarla.',
      };
    }
    return MENSAJE_GENERICO;
  }

  if (codigo === 'P0002' || codigo === '23503') {
    return {
      titulo: 'No encontramos la empresa',
      detalle:
        'Puede que ya no exista o que tu rol no te deje verla. Recarga la página para ver el estado actual.',
    };
  }

  if (operacion === 'resolucion' && (codigo === '23514' || codigo === '22004')) {
    return {
      titulo: 'Revisa los datos de la resolución',
      detalle:
        'En certificación el número es 0; en producción, el número que te entregó el SII. La fecha es obligatoria.',
    };
  }

  if (codigo === '23514' || codigo === '22P02' || codigo === '22007' || codigo === '22008') {
    return {
      titulo: 'Los datos no son válidos',
      detalle: 'Revisa los campos y vuelve a intentarlo.',
    };
  }

  return MENSAJE_GENERICO;
}
