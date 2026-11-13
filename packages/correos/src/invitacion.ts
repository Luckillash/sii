import { enlaceSeguro, escapar, estilo, formatearFecha } from './html';
import {
  boton,
  type Correo,
  documento,
  ESTILO_NOTA,
  ESTILO_PARRAFO,
  ESTILO_TITULO,
} from './plantilla';
import { COLOR, FUENTE_MONO, RADIO } from './tokens';

// Invitación a una organización (PLAN-SAAS §4.6, Fase 2). Español de Chile con tú,
// sin exclamaciones ni emoji. El enlace lleva el token que `crear_invitacion()` entrega
// una sola vez: esta función no lo guarda ni lo registra.

export interface DatosInvitacion {
  /** Nombre de la organización. */
  organizacion: string;
  /** Rol tal como se muestra («Emisor», «Lector»). */
  rol: string;
  /** Quien invita (nombre o correo); se omite si no se conoce. */
  invitadoPor?: string | null;
  /** Correo invitado: debe ingresar o crear su cuenta con él. */
  correo: string;
  /** `${NEXT_PUBLIC_APP_URL}/invitacion/${token}` */
  enlace: string;
  /** Vencimiento de la invitación (7 días después de crearla). */
  expiraEn: Date;
}

export function correoInvitacion(datos: DatosInvitacion): Correo {
  const enlace = enlaceSeguro(datos.enlace);
  const fecha = formatearFecha(datos.expiraEn);
  const quien = datos.invitadoPor?.trim();

  const asunto = `Invitación a ${datos.organizacion} en Boletéame`;
  const intro = quien
    ? `${quien} te invitó a unirte a ${datos.organizacion} en Boletéame con el rol ${datos.rol}.`
    : `Te invitaron a unirte a ${datos.organizacion} en Boletéame con el rol ${datos.rol}.`;
  const contexto =
    'Boletéame emite boletas electrónicas y lleva la certificación ante el SII en un solo lugar.';
  const instrucciones = `Para aceptarla, ingresa o crea tu cuenta con ${datos.correo}. El enlace vence el ${fecha} y sirve una sola vez.`;
  const respaldo = 'Si el botón no funciona, copia este enlace en tu navegador:';
  const ignorar =
    'Si no esperabas esta invitación, ignora este correo: nadie se unirá en tu nombre.';
  const pie = 'Boletéame · Boletas electrónicas y certificación ante el SII.';

  const estiloEnlace = estilo({
    margin: '0 0 16px',
    padding: '8px 12px',
    background: COLOR.surfaceSunken,
    borderRadius: RADIO.sm,
    fontFamily: FUENTE_MONO,
    fontSize: '12px',
    lineHeight: '18px',
    color: COLOR.ink,
    wordBreak: 'break-all',
  });

  const cuerpo = [
    `<h1 style="${ESTILO_TITULO}">Te invitaron a ${escapar(datos.organizacion)}</h1>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(intro)}</p>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(contexto)}</p>`,
    boton(enlace, 'Aceptar la invitación'),
    `<p style="${ESTILO_NOTA}">${escapar(instrucciones)}</p>`,
    `<p style="${ESTILO_NOTA}">${escapar(respaldo)}</p>`,
    `<p style="${estiloEnlace}">${escapar(enlace)}</p>`,
    `<p style="${ESTILO_NOTA}">${escapar(ignorar)}</p>`,
  ].join('\n');

  const html = documento({ titulo: asunto, previa: intro, cuerpo, pie: escapar(pie) });

  const texto = [
    `Te invitaron a ${datos.organizacion}`,
    '',
    intro,
    contexto,
    '',
    'Acepta la invitación en este enlace:',
    enlace,
    '',
    instrucciones,
    ignorar,
    '',
    '--',
    pie,
  ].join('\n');

  return { asunto, html, texto };
}
