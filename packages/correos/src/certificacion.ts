import { enlaceSeguro, escapar } from './html';
import {
  boton,
  type Correo,
  documento,
  ESTILO_NOTA,
  ESTILO_PARRAFO,
  ESTILO_TITULO,
} from './plantilla';

// Aviso de cambio de etapa de la certificación ante el SII (PLAN-SAAS §4.6 y Fase 5),
// para los propietarios y administradores de la organización. Español de Chile con tú,
// sin exclamaciones ni emoji. No lleva secretos: solo la empresa, la etapa y el enlace
// al asistente.

export interface DatosCertificacion {
  /** Nombre de la organización. */
  organizacion: string;
  /** Razón social de la empresa. */
  empresa: string;
  /** RUT de la empresa como se muestra (`76.354.771-K`). */
  rut: string;
  /** Etapa nueva tal como se muestra («Set aceptado»). */
  etapa: string;
  /** Qué hacer ahora (una o dos frases). */
  siguientePaso: string;
  /** `${NEXT_PUBLIC_APP_URL}/${slug}/certificacion` */
  enlace: string;
}

export function correoCertificacion(datos: DatosCertificacion): Correo {
  const enlace = enlaceSeguro(datos.enlace);
  const asunto = `Certificación de ${datos.empresa}: ${datos.etapa}`;
  const intro = `La certificación ante el SII de ${datos.empresa} (RUT ${datos.rut}) avanzó a la etapa «${datos.etapa}».`;
  const contexto = `Te avisamos porque administras ${datos.organizacion} en Boletéame.`;
  const pie = 'Boletéame · Boletas electrónicas y certificación ante el SII.';

  const cuerpo = [
    `<h1 style="${ESTILO_TITULO}">${escapar(datos.etapa)}</h1>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(intro)}</p>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(datos.siguientePaso)}</p>`,
    boton(enlace, 'Abrir el asistente de certificación'),
    `<p style="${ESTILO_NOTA}">${escapar(contexto)}</p>`,
  ].join('\n');

  const html = documento({ titulo: asunto, previa: intro, cuerpo, pie: escapar(pie) });

  const texto = [
    datos.etapa,
    '',
    intro,
    datos.siguientePaso,
    '',
    'Abre el asistente de certificación en este enlace:',
    enlace,
    '',
    contexto,
    '',
    '--',
    pie,
  ].join('\n');

  return { asunto, html, texto };
}
