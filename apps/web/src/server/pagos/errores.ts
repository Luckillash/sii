import 'server-only';
import type { MensajeError } from '@/lib/equipo-errores';
import type { FallaPagos } from './suscripciones';

// Mensajes para el usuario de las fallas de pagos (formato del design system: qué pasó y
// qué hacer). El detalle técnico de Flow nunca se muestra tal cual, salvo `no_cabe`, que
// es un texto armado por la app (`limitesExcedidos`).

export function mensajeFallaPagos(falla: FallaPagos): MensajeError {
  switch (falla.codigo) {
    case 'sin_configuracion':
      return {
        titulo: 'Los pagos todavía no están habilitados',
        detalle: 'La pasarela de pagos no está configurada. Vuelve a intentarlo más tarde.',
      };
    case 'plan_invalido':
      return {
        titulo: 'Ese plan no se puede contratar desde aquí',
        detalle: 'Recarga la página y elige uno de los planes de la lista.',
      };
    case 'no_cabe':
      return {
        titulo: 'Tu organización no cabe en ese plan',
        detalle: `${falla.detalle ?? ''} Quita lo que sobra o elige un plan más grande.`.trim(),
      };
    case 'ya_en_plan':
      return {
        titulo: 'Ya estás en ese plan',
        detalle: 'Recarga la página para ver tu plan actual.',
      };
    case 'sin_suscripcion':
      return {
        titulo: 'No tienes una suscripción pagada',
        detalle: 'Elige un plan para registrar tu tarjeta en Flow.',
      };
    case 'pasarela_red':
      return {
        titulo: 'Flow no respondió',
        detalle:
          'No se hizo ningún cobro desde Boletéame. Espera unos minutos y vuelve a intentarlo.',
      };
    case 'pasarela':
      // La cuenta de comercio de Flow sin el contrato de cargos automáticos rechaza
      // `customer/register` («Commerce has not automatic charge contract»): no es un
      // problema de la tarjeta del usuario, sino de la configuración de Boletéame en Flow.
      if (/automatic charge contract/i.test(falla.detalle ?? '')) {
        return {
          titulo: 'Los pagos con tarjeta todavía no están habilitados',
          detalle:
            'No se hizo ningún cobro y tu plan no cambió. Vuelve a intentarlo más tarde; si se repite, escríbenos.',
        };
      }
      return {
        titulo: 'Flow rechazó la operación',
        detalle:
          'Revisa tu tarjeta o vuelve a intentarlo más tarde. Si se repite, escríbenos con la hora en que pasó.',
      };
    case 'base':
      return {
        titulo: 'No pudimos guardar el cambio',
        detalle:
          'Recarga la página antes de reintentar, para no repetir una operación que sí se hizo.',
      };
  }
}

/** Resultado del retorno de Flow (`?pago=` en la página de plan) → aviso para el usuario. */
export function mensajeRetornoPago(
  resultado: string | undefined,
): { tono: 'exito' | 'aviso' | 'error' | 'info'; titulo: string; detalle: string } | null {
  switch (resultado) {
    case 'suscrita':
      return {
        tono: 'exito',
        titulo: 'Tu suscripción quedó activa',
        detalle:
          'Registraste tu tarjeta y el nuevo plan ya rige. Flow te enviará el comprobante del cobro por correo.',
      };
    case 'plan_cambiado':
      return {
        tono: 'exito',
        titulo: 'Cambiaste de plan',
        detalle: 'Los nuevos límites se aplican desde la próxima emisión.',
      };
    case 'tarjeta_actualizada':
      return {
        tono: 'exito',
        titulo: 'Registraste tu tarjeta',
        detalle: 'Los próximos cobros se harán con esta tarjeta.',
      };
    case 'tarjeta_rechazada':
      return {
        tono: 'aviso',
        titulo: 'La tarjeta no quedó registrada',
        detalle:
          'Flow no confirmó el registro y no se hizo ningún cobro. Vuelve a intentarlo con otra tarjeta.',
      };
    case 'en_proceso':
      return {
        tono: 'info',
        titulo: 'Estamos activando tu suscripción',
        detalle: 'Recarga la página en unos segundos para ver tu plan.',
      };
    case 'error':
      return {
        tono: 'error',
        titulo: 'No pudimos completar la suscripción',
        detalle:
          'Recarga la página para ver si tu plan cambió antes de reintentar. Si Flow te cobró y el plan no cambió, escríbenos con la hora en que pasó.',
      };
    default:
      return null;
  }
}
