import { contextoAdministrador, PIE_ALERTA } from './alertas-comun';
import { enlaceSeguro, escapar, estilo } from './html';
import {
  boton,
  type Correo,
  documento,
  ESTILO_NOTA,
  ESTILO_PARRAFO,
  ESTILO_TITULO,
} from './plantilla';
import { COLOR, FUENTE } from './tokens';

// Alerta `suscripcion.morosa` (PLAN-SAAS Fase 10) para propietarios y administradores:
// Flow tiene un importe del plan vencido sin pagar. Mientras siga así, la organización
// no emite en producción ni suma empresas o usuarios (la certificación sigue). Un correo
// por importe vencido. Español de Chile con tú, sin exclamaciones ni emoji. Sin datos de
// la tarjeta: plan, monto, fecha y enlaces.

export interface DatosSuscripcionMorosa {
  organizacion: string;
  /** Nombre del plan contratado («Básico»). */
  plan: string;
  /** Monto vencido, `$ 14.990`. */
  monto: string;
  /** Fecha de vencimiento, `10-11-2026`, o null si Flow no la informó. */
  vence?: string | null;
  /** Enlace de pago de Flow (https), si lo hay. */
  enlacePago?: string | null;
  /** `${NEXT_PUBLIC_APP_URL}/${slug}/configuracion/plan` */
  enlacePlan: string;
}

export function correoSuscripcionMorosa(datos: DatosSuscripcionMorosa): Correo {
  const enlacePlan = enlaceSeguro(datos.enlacePlan);
  const enlacePago = datos.enlacePago ? enlaceSeguro(datos.enlacePago) : null;
  const titulo = 'Tu plan tiene un pago vencido';
  const asunto = `${titulo}: ${datos.organizacion}`;
  const intro = datos.vence
    ? `El cobro de ${datos.monto} del plan ${datos.plan} de ${datos.organizacion} venció el ${datos.vence} sin pagarse.`
    : `El cobro de ${datos.monto} del plan ${datos.plan} de ${datos.organizacion} venció sin pagarse.`;
  const bloqueos =
    'Mientras siga pendiente, no se pueden emitir boletas en producción, agregar empresas ni sumar usuarios nuevos. La certificación sigue funcionando.';
  const queHacer = enlacePago
    ? 'Paga el monto con el enlace de Flow, o revisa la tarjeta registrada en Configuración → Plan. Cuando Flow confirme el pago, todo vuelve a funcionar.'
    : 'Paga el monto o revisa la tarjeta registrada en Configuración → Plan. Cuando Flow confirme el pago, todo vuelve a funcionar.';
  const contexto = contextoAdministrador(datos.organizacion);

  const estiloEnlace = estilo({
    color: COLOR.sello,
    fontFamily: FUENTE,
    textDecoration: 'underline',
  });
  const acciones = enlacePago
    ? [
        boton(enlacePago, 'Pagar con Flow'),
        `<p style="${ESTILO_PARRAFO}"><a href="${escapar(enlacePlan)}" style="${estiloEnlace}" target="_blank" rel="noopener">Ver mi plan en Boletéame</a></p>`,
      ]
    : [boton(enlacePlan, 'Ver mi plan')];

  const cuerpo = [
    `<h1 style="${ESTILO_TITULO}">${escapar(titulo)}</h1>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(intro)}</p>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(bloqueos)}</p>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(queHacer)}</p>`,
    ...acciones,
    `<p style="${ESTILO_NOTA}">${escapar(contexto)}</p>`,
  ].join('\n');

  const html = documento({ titulo: asunto, previa: intro, cuerpo, pie: escapar(PIE_ALERTA) });

  const texto = [
    titulo,
    '',
    intro,
    bloqueos,
    '',
    queHacer,
    '',
    ...(enlacePago ? ['Paga con Flow en este enlace:', enlacePago, ''] : []),
    'Revisa tu plan en Boletéame en este enlace:',
    enlacePlan,
    '',
    contexto,
    '',
    '--',
    PIE_ALERTA,
  ].join('\n');

  return { asunto, html, texto };
}
