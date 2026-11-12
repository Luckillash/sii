import { escapar, estilo } from './html';
import { COLOR, FUENTE, RADIO } from './tokens';

// Armazón común de los correos: tablas (lo único que todos los clientes respetan),
// ancho máximo de 560 px, estilos en línea y un texto de vista previa oculto.

export interface Correo {
  asunto: string;
  html: string;
  /** Versión en texto plano (multipart/alternative): mismos datos, sin HTML. */
  texto: string;
}

export interface OpcionesDocumento {
  /** Va en `<title>`; normalmente el asunto. */
  titulo: string;
  /** Texto que algunos clientes muestran junto al asunto en la bandeja. */
  previa: string;
  /** HTML ya escapado de las filas del cuerpo. */
  cuerpo: string;
  /** Pie (HTML ya escapado). */
  pie: string;
}

export const ESTILO_PARRAFO = estilo({
  margin: '0 0 16px',
  fontFamily: FUENTE,
  fontSize: '15px',
  lineHeight: '22px',
  color: COLOR.ink,
});

export const ESTILO_NOTA = estilo({
  margin: '0 0 12px',
  fontFamily: FUENTE,
  fontSize: '13px',
  lineHeight: '18px',
  color: COLOR.inkMuted,
});

export const ESTILO_TITULO = estilo({
  margin: '0 0 16px',
  fontFamily: FUENTE,
  fontSize: '22px',
  lineHeight: '28px',
  fontWeight: 600,
  color: COLOR.ink,
});

/** Botón primario «a prueba de clientes»: un enlace con relleno dentro de una celda. */
export function boton(href: string, texto: string): string {
  const celda = estilo({ borderRadius: RADIO.md, background: COLOR.sello });
  const enlace = estilo({
    display: 'inline-block',
    padding: '12px 20px',
    fontFamily: FUENTE,
    fontSize: '15px',
    lineHeight: '20px',
    fontWeight: 600,
    color: COLOR.onSello,
    textDecoration: 'none',
    borderRadius: RADIO.md,
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 24px"><tr><td style="${celda}"><a href="${escapar(href)}" style="${enlace}" target="_blank" rel="noopener">${escapar(texto)}</a></td></tr></table>`;
}

export function documento({ titulo, previa, cuerpo, pie }: OpcionesDocumento): string {
  const fondo = estilo({ margin: 0, padding: 0, background: COLOR.surface });
  const tarjeta = estilo({
    background: COLOR.surfaceRaised,
    border: `1px solid ${COLOR.line}`,
    borderRadius: RADIO.md,
    padding: '32px 28px',
  });
  const marca = estilo({
    fontFamily: FUENTE,
    fontSize: '20px',
    lineHeight: '28px',
    fontWeight: 600,
    color: COLOR.sello,
    padding: '0 4px 16px',
  });
  const oculto = estilo({
    display: 'none',
    maxHeight: 0,
    overflow: 'hidden',
    opacity: 0,
    color: 'transparent',
  });
  const estiloPie = estilo({
    padding: '16px 4px 0',
    fontFamily: FUENTE,
    fontSize: '12px',
    lineHeight: '16px',
    color: COLOR.inkMuted,
  });

  return [
    '<!DOCTYPE html>',
    '<html lang="es-CL">',
    '<head>',
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light">',
    '<meta name="supported-color-schemes" content="light">',
    `<title>${escapar(titulo)}</title>`,
    '</head>',
    `<body style="${fondo}">`,
    `<div style="${oculto}">${escapar(previa)}</div>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="${fondo}">`,
    '<tr><td align="center" style="padding:32px 16px">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">',
    `<tr><td style="${marca}">Timbre</td></tr>`,
    `<tr><td style="${tarjeta}">${cuerpo}</td></tr>`,
    `<tr><td style="${estiloPie}">${pie}</td></tr>`,
    '</table>',
    '</td></tr>',
    '</table>',
    '</body>',
    '</html>',
  ].join('\n');
}
