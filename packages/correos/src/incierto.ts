import {
  contextoAdministrador,
  type FilaLista,
  listaHtml,
  listaTexto,
  PIE_ALERTA,
} from './alertas-comun';
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

// Alerta `envio.incierto` (PLAN-SAAS §4.6 y Fase 8, principio 3) para propietarios y
// administradores: un envío al SII no devolvió Track ID y no se sabe si llegó. Boletéame
// nunca lo reintenta solo; el correo explica que no hay que volver a emitir ni enviar
// hasta revisarlo en el SII. Español de Chile con tú, sin exclamaciones ni emoji.

export interface DocumentoIncierto {
  /** «Boleta electrónica N.º 41». */
  documento: string;
  /** `$ 1.190`. */
  total: string;
}

export interface DatosEnvioIncierto {
  organizacion: string;
  empresa: string;
  /** `76.354.771-K`. */
  rut: string;
  /** «producción» o «certificación». */
  ambiente: string;
  /** Cuándo se intentó enviar, `16-11-2026 10:15` (24 h, hora de Chile). */
  fecha: string;
  /** Documentos del envío (puede venir vacío si no se pudieron leer). */
  documentos: DocumentoIncierto[];
  /** `${NEXT_PUBLIC_APP_URL}/${slug}/envios/<id>` */
  enlace: string;
}

const SITIO_SII = 'https://www.sii.cl';

export function correoEnvioIncierto(datos: DatosEnvioIncierto): Correo {
  const enlace = enlaceSeguro(datos.enlace);
  const titulo = 'Envío por verificar en el SII';
  const asunto = `${titulo}: ${datos.empresa}`;
  const cuantos =
    datos.documentos.length === 1
      ? `la ${datos.documentos[0]?.documento ?? 'boleta'}`
      : datos.documentos.length > 1
        ? `${datos.documentos.length} documentos`
        : 'documentos';
  const intro = `El envío de ${cuantos} de ${datos.empresa} (RUT ${datos.rut}) al SII en ${datos.ambiente}, el ${datos.fecha}, no devolvió Track ID: la comunicación falló después de enviarlo y no sabemos si llegó.`;
  const noRepitas =
    'No vuelvas a emitir ni a enviar estos documentos todavía: si el envío sí llegó, quedarían dos veces en el SII. Boletéame no lo reintenta solo.';
  const queHacer =
    'Revisa en www.sii.cl, en la consulta de boletas electrónicas emitidas, con el RUT de la empresa y los folios de este envío, si quedaron recibidos. Después pulsa «Ya lo revisé» en el detalle del envío en Boletéame. Si los folios aparecen, el envío llegó y no tienes que emitir nada más. Si no aparecen, el envío no llegó: emite los documentos de nuevo.';
  const contexto = contextoAdministrador(datos.organizacion);

  const filas: FilaLista[] = datos.documentos.map((d) => ({
    titulo: d.documento,
    lineas: [d.total],
  }));

  const enlaceSii = estilo({ color: COLOR.sello, fontFamily: FUENTE, textDecoration: 'underline' });
  const queHacerHtml = escapar(queHacer).replace(
    'www.sii.cl',
    `<a href="${SITIO_SII}" style="${enlaceSii}" target="_blank" rel="noopener">www.sii.cl</a>`,
  );

  const cuerpo = [
    `<h1 style="${ESTILO_TITULO}">${escapar(titulo)}</h1>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(intro)}</p>`,
    ...(filas.length > 0 ? [listaHtml(filas)] : []),
    `<p style="${ESTILO_PARRAFO}">${escapar(noRepitas)}</p>`,
    `<p style="${ESTILO_PARRAFO}">${queHacerHtml}</p>`,
    boton(enlace, 'Ver el envío'),
    `<p style="${ESTILO_NOTA}">${escapar(contexto)}</p>`,
  ].join('\n');

  const html = documento({ titulo: asunto, previa: intro, cuerpo, pie: escapar(PIE_ALERTA) });

  const texto = [
    titulo,
    '',
    intro,
    ...(filas.length > 0 ? ['', ...listaTexto(filas)] : []),
    '',
    noRepitas,
    '',
    queHacer,
    SITIO_SII,
    '',
    'Revisa el envío en Boletéame en este enlace:',
    enlace,
    '',
    contexto,
    '',
    '--',
    PIE_ALERTA,
  ].join('\n');

  return { asunto, html, texto };
}
