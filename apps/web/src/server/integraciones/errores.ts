import 'server-only';
import type { MensajeError } from '@/lib/equipo-errores';

// Traducción de errores de Postgres/PostgREST a mensajes del design system (qué pasó y
// qué hacer) para Configuración → API y Webhooks (PLAN-SAAS Fase 11). Puro, sin
// `server-only`: lo usan las Server Actions y se prueba con Vitest. Cada caso sale de las
// migraciones:
//
//   42501  `crear_api_key`, `crear_webhook` (0001), `reenviar_entrega_webhook`,
//          `probar_webhook` y `rotar_secreto_webhook` (0018): «Sin permiso»; o RLS.
//   P0001  `raise exception` sin código: «El plan vigente no incluye acceso por API»,
//          «El plan vigente no incluye webhooks» y «La empresa no pertenece a la
//          organización» (0001); con código explícito en la 0018 (plan sin webhooks).
//   P0002  «La entrega no existe» / «El webhook no existe» (0018).
//   22023  «El webhook está desactivado» / «La entrega ya está en cola» (0018), y el
//          trigger de `api_keys` (0018): una clave revocada no se reactiva y su
//          expiración no se alarga.
//   23514  checks: `webhooks_url_permitida` (0018), `webhooks_url_check` (https, 0001),
//          eventos y alcances fuera de la lista (0001).
//   22P02  un id con formato inválido.

export type { MensajeError } from '@/lib/equipo-errores';

export type OperacionIntegracion =
  | 'crear_clave'
  | 'revocar_clave'
  | 'crear_webhook'
  | 'actualizar_webhook'
  | 'cambiar_estado_webhook'
  | 'borrar_webhook'
  | 'probar_webhook'
  | 'rotar_secreto'
  | 'reenviar_entrega';

export interface ErrorBase {
  code?: string | null;
  message?: string | null;
}

export const MENSAJE_GENERICO: MensajeError = {
  titulo: 'No pudimos completar la operación',
  detalle: 'Inténtalo de nuevo en unos minutos. Si sigue fallando, escríbenos a soporte.',
};

export const SIN_PERMISO: MensajeError = {
  titulo: 'No tienes permiso para hacer esto',
  detalle:
    'Solo un propietario o un administrador puede gestionar las API keys y los webhooks. Pide ayuda a uno de ellos.',
};

export const DATOS_INVALIDOS: MensajeError = {
  titulo: 'Los datos no son válidos',
  detalle: 'Recarga la página y vuelve a intentarlo.',
};

export const SESION_VENCIDA: MensajeError = {
  titulo: 'Tu sesión ya no es válida',
  detalle: 'Vuelve a ingresar y repite la operación.',
};

/** Un UPDATE o DELETE sin filas afectadas: RLS lo filtró o la fila ya no existe. */
export const SIN_EFECTO: MensajeError = {
  titulo: 'No se aplicó el cambio',
  detalle:
    'Puede que ya no exista o que ya tuviera ese estado. Recarga la página para ver el estado actual.',
};

export const PLAN_SIN_API: MensajeError = {
  titulo: 'Tu plan no incluye acceso por API',
  detalle: 'Cambia a un plan con API en Configuración → Plan para crear API keys.',
};

export const PLAN_SIN_WEBHOOKS: MensajeError = {
  titulo: 'Tu plan no incluye webhooks',
  detalle: 'Cambia a un plan con webhooks en Configuración → Plan para crearlos y recibir eventos.',
};

export const URL_NO_PERMITIDA: MensajeError = {
  titulo: 'La URL no es válida para un webhook',
  detalle:
    'Usa un dominio público con https, en el puerto 443, sin usuario ni clave, por ejemplo https://tu-sistema.cl/webhooks/boleteame.',
};

const EMPRESA_AJENA: MensajeError = {
  titulo: 'Esa empresa no es de esta organización',
  detalle: 'Elige una empresa de la lista o deja «Todas las empresas».',
};

const WEBHOOK_DESACTIVADO: MensajeError = {
  titulo: 'El webhook está pausado',
  detalle: 'Actívalo primero y vuelve a intentarlo.',
};

const CLAVE_REVOCADA: MensajeError = {
  titulo: 'Esa API key ya está revocada',
  detalle:
    'Revocar es definitivo: una clave revocada no se puede reactivar. Si la necesitas, crea una nueva.',
};

const EXPIRACION_FIJA: MensajeError = {
  titulo: 'No se puede alargar la expiración de una API key',
  detalle: 'Crea una clave nueva con el plazo que necesitas y revoca la anterior.',
};

const ENTREGA_EN_COLA: MensajeError = {
  titulo: 'Esa entrega ya está en cola',
  detalle: 'Saldrá en el próximo minuto. Recarga la página para ver su estado.',
};

function noExiste(operacion: OperacionIntegracion): MensajeError {
  return operacion === 'reenviar_entrega'
    ? {
        titulo: 'No encontramos esa entrega',
        detalle: 'Puede que ya se haya borrado. Recarga la página para ver el historial actual.',
      }
    : {
        titulo: 'No encontramos ese webhook',
        detalle: 'Puede que alguien lo haya borrado. Recarga la página para ver la lista actual.',
      };
}

function contiene(texto: string | null | undefined, patron: RegExp): boolean {
  return typeof texto === 'string' && patron.test(texto);
}

export function traducirErrorIntegracion(
  error: ErrorBase,
  operacion: OperacionIntegracion,
): MensajeError {
  const { code, message } = error;

  if (contiene(message, /no incluye acceso por API/i)) return PLAN_SIN_API;
  if (contiene(message, /no incluye webhooks/i)) return PLAN_SIN_WEBHOOKS;
  if (contiene(message, /empresa no pertenece/i)) return EMPRESA_AJENA;

  switch (code) {
    case '42501':
      return SIN_PERMISO;
    case 'P0002':
      return noExiste(operacion);
    case '22023':
      if (contiene(message, /revocada/i)) return CLAVE_REVOCADA;
      if (contiene(message, /expiraci/i)) return EXPIRACION_FIJA;
      if (contiene(message, /en cola/i)) return ENTREGA_EN_COLA;
      if (contiene(message, /desactivado/i)) return WEBHOOK_DESACTIVADO;
      return DATOS_INVALIDOS;
    case '23514':
      if (contiene(message, /webhooks_url/i)) return URL_NO_PERMITIDA;
      return DATOS_INVALIDOS;
    case '22P02':
      return DATOS_INVALIDOS;
    default:
      return MENSAJE_GENERICO;
  }
}
