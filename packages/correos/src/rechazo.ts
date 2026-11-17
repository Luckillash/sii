import {
  contextoAdministrador,
  type FilaLista,
  listaHtml,
  listaTexto,
  PIE_ALERTA,
} from './alertas-comun';
import { enlaceSeguro, escapar } from './html';
import {
  boton,
  type Correo,
  documento,
  ESTILO_NOTA,
  ESTILO_PARRAFO,
  ESTILO_TITULO,
} from './plantilla';

// Alerta `documento.rechazado` (PLAN-SAAS §4.6 y Fase 8) para propietarios y
// administradores: el SII rechazó uno o más documentos. Los de una misma corrida del cron
// y organización van juntos en un correo. Español de Chile con tú, sin exclamaciones ni
// emoji. Qué pasó (documento, empresa, motivo del SII) y qué hacer.

export interface DocumentoRechazado {
  /** Nombre oficial con folio: «Boleta electrónica N.º 41». */
  documento: string;
  /** Razón social del emisor. */
  empresa: string;
  /** RUT del emisor como se muestra (`76.354.771-K`). */
  rut: string;
  /** Total ya formateado (`$ 1.190`). */
  total: string;
  /** Fecha de emisión ya formateada (`16-11-2026`). */
  fecha: string;
  /** «producción» o «certificación». */
  ambiente: string;
  /** Motivo que dio el SII (texto acotado), o null si no lo informó. */
  motivo: string | null;
  /** `${NEXT_PUBLIC_APP_URL}/${slug}/envios/<id>` (detalle con los errores del SII). */
  enlace: string;
}

export interface DatosDocumentosRechazados {
  /** Nombre de la organización. */
  organizacion: string;
  /** Al menos uno. */
  documentos: DocumentoRechazado[];
  /** `${NEXT_PUBLIC_APP_URL}/${slug}/documentos?estado=rechazado…` */
  enlace: string;
}

export function correoDocumentosRechazados(datos: DatosDocumentosRechazados): Correo {
  const [primero] = datos.documentos;
  if (!primero) throw new Error('El correo de rechazo necesita al menos un documento.');
  const enlace = enlaceSeguro(datos.enlace);
  const varios = datos.documentos.length > 1;

  const titulo = varios
    ? `El SII rechazó ${datos.documentos.length} documentos`
    : `El SII rechazó la ${primero.documento}`;
  const asunto = varios ? `${titulo} de ${datos.organizacion}` : `${titulo} de ${primero.empresa}`;
  const intro = varios
    ? `El SII rechazó estos ${datos.documentos.length} documentos de ${datos.organizacion}. Un documento rechazado no es válido tributariamente: para el SII no se emitió.`
    : `El SII rechazó la ${primero.documento} de ${primero.empresa} (RUT ${primero.rut}). Un documento rechazado no es válido tributariamente: para el SII no se emitió.`;
  const queHacer =
    'Revisa el motivo que informó el SII en el detalle del envío, corrige lo que indica y vuelve a emitir el documento. Si ya entregaste el documento a tu cliente, avísale que no es válido.';
  const contexto = contextoAdministrador(datos.organizacion);

  const filas: FilaLista[] = datos.documentos.map((d) => ({
    titulo: d.documento,
    lineas: [
      `${d.empresa} · RUT ${d.rut}`,
      `${d.total} · emitida el ${d.fecha} · ${d.ambiente}`,
      d.motivo ? `Motivo del SII: ${d.motivo}` : 'El SII no informó el motivo en la respuesta.',
    ],
    enlace: { href: enlaceSeguro(d.enlace), texto: 'Ver el detalle del envío' },
  }));

  const cuerpo = [
    `<h1 style="${ESTILO_TITULO}">${escapar(titulo)}</h1>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(intro)}</p>`,
    listaHtml(filas),
    `<p style="${ESTILO_PARRAFO}">${escapar(queHacer)}</p>`,
    boton(enlace, varios ? 'Ver los documentos rechazados' : 'Ver el documento'),
    `<p style="${ESTILO_NOTA}">${escapar(contexto)}</p>`,
  ].join('\n');

  const html = documento({ titulo: asunto, previa: intro, cuerpo, pie: escapar(PIE_ALERTA) });

  const texto = [
    titulo,
    '',
    intro,
    '',
    ...listaTexto(filas),
    '',
    queHacer,
    '',
    'Revisa los documentos rechazados en este enlace:',
    enlace,
    '',
    contexto,
    '',
    '--',
    PIE_ALERTA,
  ].join('\n');

  return { asunto, html, texto };
}
