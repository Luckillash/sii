// Traducción de errores de Postgres/PostgREST a mensajes del design system (qué pasó y
// qué hacer) para el equipo y las invitaciones. Puro, sin `server-only`: se prueba con
// Vitest. Cada caso sale de supabase/migrations/0001_esquema_inicial.sql:
//
//   42501  RLS (WITH CHECK) o `raise ... errcode '42501'` en crear_invitacion(),
//          aceptar_invitacion() («Invitación inválida o vencida») y crear_organizacion().
//   P0001  `raise exception` sin código: tg_proteger_ultimo_propietario («La
//          organización debe tener al menos un propietario») y exigir_cupo_usuarios
//          («El plan X permite como máximo N usuario(s)»).
//   23505  índice único invitaciones_pendiente_unica (dos invitaciones simultáneas al
//          mismo correo; crear_invitacion() borra la anterior, así que es una carrera).
//   23514  checks (correo en minúsculas con @, rol <> 'propietario').

export interface ErrorBase {
  code?: string | null;
  message?: string | null;
}

export interface MensajeError {
  titulo: string;
  detalle: string;
}

export type OperacionEquipo =
  | 'invitar'
  | 'reenviar'
  | 'revocar'
  | 'cambiar_rol'
  | 'quitar'
  | 'salir'
  | 'aceptar';

const PATRON_CUPO = /El plan (.+?) permite como máximo (\d+) usuario/;

export const MENSAJE_GENERICO: MensajeError = {
  titulo: 'No pudimos completar la operación',
  detalle: 'Inténtalo de nuevo en unos minutos. Si sigue fallando, escríbenos a soporte.',
};

/** Cuando un UPDATE o DELETE no afecta filas: RLS lo filtró o la fila ya no existe. */
export const MENSAJE_SIN_EFECTO: MensajeError = {
  titulo: 'No se aplicó el cambio',
  detalle:
    'Puede que ya no exista o que tu rol no lo permita. Recarga la página para ver el estado actual.',
};

export function mensajeCupo(
  plan: string,
  maximo: number,
  operacion: OperacionEquipo,
): MensajeError {
  const usuarios = maximo === 1 ? '1 usuario' : `${maximo} usuarios`;
  return {
    titulo: `El plan ${plan} permite hasta ${usuarios}`,
    detalle:
      operacion === 'aceptar'
        ? 'La organización ya completó su cupo. Pide a un administrador que libere un cupo o cambie de plan, y vuelve a abrir este enlace.'
        : 'Quita a un miembro o cambia de plan para sumar a otra persona.',
  };
}

function sinPropietario(operacion: OperacionEquipo): MensajeError {
  switch (operacion) {
    case 'salir':
      return {
        titulo: 'Eres el único propietario',
        detalle:
          'Nombra a otro propietario en la tabla de miembros antes de salir de la organización.',
      };
    case 'quitar':
      return {
        titulo: 'No puedes quitar al único propietario',
        detalle: 'Nombra a otro propietario primero y vuelve a intentarlo.',
      };
    default:
      return {
        titulo: 'La organización quedaría sin propietario',
        detalle: 'Nombra a otro propietario antes de cambiar este rol.',
      };
  }
}

export function traducirErrorEquipo(
  error: ErrorBase | null | undefined,
  operacion: OperacionEquipo,
): MensajeError {
  const mensaje = error?.message ?? '';
  const codigo = error?.code ?? '';

  if (/al menos un propietario/i.test(mensaje)) return sinPropietario(operacion);

  const cupo = PATRON_CUPO.exec(mensaje);
  if (cupo?.[1] && cupo[2]) return mensajeCupo(cupo[1], Number(cupo[2]), operacion);

  // 0004_cupo_sin_suscripcion: exigir_cupo_usuarios() sin plan vigente.
  if (/no tiene una suscripción vigente/i.test(mensaje)) {
    return {
      titulo: 'La organización no tiene un plan vigente',
      detalle:
        operacion === 'aceptar'
          ? 'Pide a un propietario que renueve el plan y vuelve a abrir este enlace.'
          : 'Renueva el plan para sumar personas al equipo.',
    };
  }

  if (/Invitación inválida o vencida/i.test(mensaje)) {
    return {
      titulo: 'La invitación venció, ya se usó o no corresponde a tu correo',
      detalle:
        'Ingresa con el correo invitado o pide a quien te invitó que te envíe una nueva invitación.',
    };
  }

  if (codigo === '42501') {
    return {
      titulo: 'No tienes permiso para hacer esto',
      detalle:
        'Tu rol en la organización no lo permite. Pide ayuda a un propietario o administrador.',
    };
  }

  if (codigo === '23505' && (operacion === 'invitar' || operacion === 'reenviar')) {
    return {
      titulo: 'Ya hay una invitación pendiente para ese correo',
      detalle: 'Reenvíala o revócala desde Invitaciones pendientes.',
    };
  }

  if (codigo === '23514' || codigo === '22P02') {
    return {
      titulo: 'Los datos no son válidos',
      detalle: 'Revisa el correo y el rol, y vuelve a intentarlo.',
    };
  }

  return MENSAJE_GENERICO;
}
