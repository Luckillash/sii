import { escapar, estilo } from './html';
import { type Correo, documento, ESTILO_NOTA, ESTILO_PARRAFO, ESTILO_TITULO } from './plantilla';
import { COLOR, FUENTE } from './tokens';

// Envío de la boleta emitida al correo del receptor (PLAN-SAAS §4.6 y Fase 7), con el PDF
// de la representación impresa adjunto (el adjunto lo agrega quien envía). Español de
// Chile con tú, sin exclamaciones ni emoji. Sin secretos ni enlaces a la app: el
// receptor no es usuario de Boletéame; solo los datos de la boleta y cómo verificarla.

export interface DatosBoleta {
  /** Razón social del emisor. */
  empresa: string;
  /** RUT del emisor como se muestra (`76.354.771-K`). */
  rut: string;
  /** Nombre oficial del tipo, en minúscula inicial: «boleta electrónica». */
  tipo: string;
  /** Folio, sin separador de miles (`41`). */
  folio: string;
  /** Total ya formateado (`$ 14.865`). */
  total: string;
  /** Fecha de emisión ya formateada (`13-11-2026`). */
  fecha: string;
}

const SITIO_SII = 'https://www.sii.cl';

export function correoBoleta(datos: DatosBoleta): Correo {
  const documentoNombre = `${datos.tipo} N.º ${datos.folio}`;
  const titulo = documentoNombre.charAt(0).toUpperCase() + documentoNombre.slice(1);
  const asunto = `Tu ${documentoNombre} de ${datos.empresa}`;
  const intro = `${datos.empresa} (RUT ${datos.rut}) te envía tu ${documentoNombre} por ${datos.total}, emitida el ${datos.fecha}.`;
  const adjunto = 'La representación impresa va adjunta en PDF a este correo.';
  const verificar =
    'Para verificarla en el SII, entra a www.sii.cl, en la verificación de documentos electrónicos, con el RUT del emisor, el tipo de documento, el folio, la fecha de emisión y el monto total. El timbre electrónico impreso en el PDF trae esos mismos datos.';
  const contexto = `Recibes este correo porque ${datos.empresa} indicó tu dirección al emitir la boleta. Si tienes dudas sobre la compra, escríbele directamente a ${datos.empresa}.`;
  const pie = 'Boletéame · Boletas electrónicas y certificación ante el SII.';

  const enlaceSii = estilo({ color: COLOR.sello, fontFamily: FUENTE, textDecoration: 'underline' });
  const verificarHtml = escapar(verificar).replace(
    'www.sii.cl',
    `<a href="${SITIO_SII}" style="${enlaceSii}" target="_blank" rel="noopener">www.sii.cl</a>`,
  );

  const cuerpo = [
    `<h1 style="${ESTILO_TITULO}">${escapar(titulo)}</h1>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(intro)}</p>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(adjunto)}</p>`,
    `<p style="${ESTILO_PARRAFO}">${verificarHtml}</p>`,
    `<p style="${ESTILO_NOTA}">${escapar(contexto)}</p>`,
  ].join('\n');

  const html = documento({ titulo: asunto, previa: intro, cuerpo, pie: escapar(pie) });

  const texto = [
    titulo,
    '',
    intro,
    adjunto,
    '',
    verificar,
    SITIO_SII,
    '',
    contexto,
    '',
    '--',
    pie,
  ].join('\n');

  return { asunto, html, texto };
}
