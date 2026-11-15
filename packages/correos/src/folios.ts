import { enlaceSeguro, escapar } from './html';
import {
  boton,
  type Correo,
  documento,
  ESTILO_NOTA,
  ESTILO_PARRAFO,
  ESTILO_TITULO,
} from './plantilla';

// Alerta `folios.por_agotarse` (PLAN-SAAS §4.6 y Fase 6) para los propietarios y
// administradores de la organización: quedan pocos folios de un tipo en un ambiente
// (cruzó el 15 % del `MedidorFolios`) o se acabaron. Español de Chile con tú, sin
// exclamaciones ni emoji. Sin secretos: empresa, tipo, ambiente, cifras y enlace.

export interface DatosFoliosPorAgotarse {
  /** Nombre de la organización. */
  organizacion: string;
  /** Razón social de la empresa. */
  empresa: string;
  /** RUT de la empresa como se muestra (`76.354.771-K`). */
  rut: string;
  /** Nombre oficial del tipo con su código: «Boleta electrónica (39)». */
  tipo: string;
  /** «producción» o «certificación». */
  ambiente: string;
  /** Folios que quedan, ya formateados (`1.190`). */
  disponibles: string;
  /** Tamaño de los CAF vigentes (denominador del 15 %), ya formateado. */
  total: string;
  /** `true`: no queda ninguno. */
  agotado: boolean;
  /** `${NEXT_PUBLIC_APP_URL}/${slug}/folios?empresa=…` */
  enlace: string;
}

export function correoFoliosPorAgotarse(datos: DatosFoliosPorAgotarse): Correo {
  const enlace = enlaceSeguro(datos.enlace);
  const titulo = datos.agotado
    ? `Sin folios de ${datos.tipo}`
    : `Quedan pocos folios de ${datos.tipo}`;
  const asunto = `${titulo} en ${datos.ambiente}: ${datos.empresa}`;
  const intro = datos.agotado
    ? `${datos.empresa} (RUT ${datos.rut}) se quedó sin folios de ${datos.tipo} en ${datos.ambiente}.`
    : `A ${datos.empresa} (RUT ${datos.rut}) le quedan ${datos.disponibles} folios de ${datos.tipo} en ${datos.ambiente}, el 15 % o menos de los ${datos.total} de sus CAF vigentes.`;
  const queHacer = datos.agotado
    ? 'No se pueden emitir documentos de este tipo hasta que solicites un nuevo CAF en Boletéame.'
    : 'Solicita un nuevo CAF antes de que se agoten: sin folios no se pueden emitir documentos de este tipo.';
  const contexto = `Te avisamos porque administras ${datos.organizacion} en Boletéame.`;
  const pie = 'Boletéame · Boletas electrónicas y certificación ante el SII.';

  const cuerpo = [
    `<h1 style="${ESTILO_TITULO}">${escapar(titulo)}</h1>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(intro)}</p>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(queHacer)}</p>`,
    boton(enlace, 'Ver los folios'),
    `<p style="${ESTILO_NOTA}">${escapar(contexto)}</p>`,
  ].join('\n');

  const html = documento({ titulo: asunto, previa: intro, cuerpo, pie: escapar(pie) });

  const texto = [
    titulo,
    '',
    intro,
    queHacer,
    '',
    'Revisa los folios de la empresa en este enlace:',
    enlace,
    '',
    contexto,
    '',
    '--',
    pie,
  ].join('\n');

  return { asunto, html, texto };
}
