import { escapar, estilo } from './html';
import { type Correo, documento, ESTILO_NOTA, ESTILO_PARRAFO, ESTILO_TITULO } from './plantilla';
import { COLOR, FUENTE, RADIO } from './tokens';

// Formulario de contacto del sitio público (PLAN-SAAS Fase 12, punto 4). Una sola
// plantilla, `correoContacto`: el mensaje que llega al equipo (a `CORREO_CONTACTO`, con
// `reply_to` de la persona). Lleva todo lo que escribió.
//
// No hay acuse a la persona, a propósito: el correo de destino lo escribe cualquiera en
// un formulario público, y un correo automático a esa dirección serviría para mandar
// spam a terceros con nuestro remitente (el mismo de Auth).
//
// Todo lo que viene de la persona se limpia también para el texto plano (sin caracteres
// de control ni de dirección bidi, que permiten disfrazar el texto) y se escapa en el
// HTML. Español de Chile con tú, sin exclamaciones ni emoji.

/** Largo máximo de una línea (nombre, empresa) dentro del correo y del asunto. */
const LARGO_MAXIMO_LINEA = 200;
/** Tope de seguridad del mensaje (la app ya lo limita antes, en su validación). */
const LARGO_MAXIMO_MENSAJE = 10_000;

// Controles C0 (salvo tab y salto de línea), DEL, controles C1 y los de dirección bidi
// (U+200E, U+200F, U+202A–U+202E, U+2066–U+2069), más los separadores de línea Unicode.
const CONTROLES =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: se quitan justamente los controles.
  /[\u{0}-\u{8}\u{B}-\u{1F}\u{7F}-\u{9F}\u{200E}\u{200F}\u{202A}-\u{202E}\u{2066}-\u{2069}]/gu;

/**
 * Texto libre de varias líneas para un correo: saltos de línea normalizados a `\n`, sin
 * caracteres de control ni bidi, sin más de dos líneas en blanco seguidas y recortado.
 */
export function limpiarTextoLibre(texto: string, largo = LARGO_MAXIMO_MENSAJE): string {
  return texto
    .replace(/\r\n?|[\u{2028}\u{2029}]/gu, '\n')
    .replace(CONTROLES, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, largo);
}

/** Una sola línea (nombre, empresa, asunto): todo espacio o salto seguido queda en un espacio. */
export function limpiarLinea(texto: string, largo = LARGO_MAXIMO_LINEA): string {
  return texto
    .replace(CONTROLES, '')
    .replace(/[\s\u{2028}\u{2029}]+/gu, ' ')
    .trim()
    .slice(0, largo);
}

/** Texto libre en HTML: escapado y con los saltos de línea como `<br>`. */
function htmlMultilinea(texto: string): string {
  return escapar(texto).replace(/\n/g, '<br>');
}

export interface DatosContacto {
  /** Motivo como se muestra («Ventas / plan Empresa»), de la lista fija del formulario. */
  motivo: string;
  /** Versión corta para el asunto («Ventas»); si falta, se usa `motivo`. */
  motivoAsunto?: string | null;
  nombre: string;
  /** Correo de la persona: el equipo le responde ahí (va también en `reply_to`). */
  correo: string;
  empresa?: string | null;
  /** RUT de la empresa ya validado y formateado (`76.354.771-K`). */
  rut?: string | null;
  mensaje: string;
}

export function correoContacto(datos: DatosContacto): Correo {
  const motivo = limpiarLinea(datos.motivo);
  const nombre = limpiarLinea(datos.nombre);
  const correo = limpiarLinea(datos.correo);
  const empresa = datos.empresa ? limpiarLinea(datos.empresa) : '';
  const rut = datos.rut ? limpiarLinea(datos.rut) : '';
  const mensaje = limpiarTextoLibre(datos.mensaje);

  const motivoAsunto = datos.motivoAsunto ? limpiarLinea(datos.motivoAsunto) : motivo;
  const asunto = limpiarLinea(`[Contacto · ${motivoAsunto}] ${nombre}`, 250);
  const titulo = `Mensaje de contacto: ${motivo}`;
  const previa = `${nombre} escribió desde el formulario de contacto.`;
  const responder = `Responde a este correo para contestarle a ${correo}.`;
  const pie = 'Boletéame · Formulario de contacto del sitio público.';

  const filas: [string, string][] = [
    ['Motivo', motivo],
    ['Nombre', nombre],
    ['Correo', correo],
    ...(empresa ? ([['Empresa', empresa]] as [string, string][]) : []),
    ...(rut ? ([['RUT de la empresa', rut]] as [string, string][]) : []),
  ];

  const tabla = estilo({
    width: '100%',
    margin: '0 0 20px',
    borderCollapse: 'collapse',
  });
  const celdaEtiqueta = estilo({
    padding: '6px 12px 6px 0',
    fontFamily: FUENTE,
    fontSize: '13px',
    lineHeight: '18px',
    color: COLOR.inkMuted,
    verticalAlign: 'top',
    whiteSpace: 'nowrap',
  });
  const celdaValor = estilo({
    padding: '6px 0',
    fontFamily: FUENTE,
    fontSize: '14px',
    lineHeight: '20px',
    color: COLOR.ink,
    wordBreak: 'break-word',
  });
  const caja = estilo({
    margin: '0 0 20px',
    padding: '14px 16px',
    background: COLOR.surfaceSunken,
    borderRadius: RADIO.md,
    fontFamily: FUENTE,
    fontSize: '15px',
    lineHeight: '22px',
    color: COLOR.ink,
    wordBreak: 'break-word',
  });

  const filasHtml = filas
    .map(
      ([etiqueta, valor]) =>
        `<tr><td style="${celdaEtiqueta}">${escapar(etiqueta)}</td><td style="${celdaValor}">${escapar(valor)}</td></tr>`,
    )
    .join('');

  const cuerpo = [
    `<h1 style="${ESTILO_TITULO}">${escapar(titulo)}</h1>`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${tabla}">${filasHtml}</table>`,
    `<p style="${ESTILO_NOTA}">Mensaje</p>`,
    `<div style="${caja}">${htmlMultilinea(mensaje)}</div>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(responder)}</p>`,
  ].join('\n');

  const html = documento({ titulo: asunto, previa, cuerpo, pie: escapar(pie) });

  const texto = [
    titulo,
    '',
    ...filas.map(([etiqueta, valor]) => `${etiqueta}: ${valor}`),
    '',
    'Mensaje:',
    mensaje,
    '',
    responder,
    '',
    '--',
    pie,
  ].join('\n');

  return { asunto, html, texto };
}
