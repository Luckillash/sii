import { escapar, estilo } from './html';
import { COLOR, FUENTE, RADIO } from './tokens';

// Piezas comunes de las alertas de la Fase 8 (documento rechazado, envío por verificar y
// certificado por vencer): una lista de filas con estilos en línea y el pie de siempre.

export const PIE_ALERTA = 'Boletéame · Boletas electrónicas y certificación ante el SII.';

export function contextoAdministrador(organizacion: string): string {
  return `Te avisamos porque administras ${organizacion} en Boletéame.`;
}

export interface FilaLista {
  /** Primera línea, en negrita (p. ej. «Boleta electrónica N.º 41»). */
  titulo: string;
  /** Líneas siguientes, en texto normal. */
  lineas: string[];
  /** Enlace opcional al detalle (ya validado con `enlaceSeguro`). */
  enlace?: { href: string; texto: string };
}

/** Lista en una tabla (los clientes de correo respetan tablas, no `<ul>` con estilos). */
export function listaHtml(filas: FilaLista[]): string {
  const tabla = estilo({
    width: '100%',
    margin: '0 0 20px',
    borderCollapse: 'separate',
    borderSpacing: 0,
    border: `1px solid ${COLOR.line}`,
    borderRadius: RADIO.md,
    background: COLOR.surface,
  });
  const celda = (ultima: boolean) =>
    estilo({
      padding: '12px 14px',
      fontFamily: FUENTE,
      fontSize: '14px',
      lineHeight: '20px',
      color: COLOR.ink,
      borderBottom: ultima ? 'none' : `1px solid ${COLOR.line}`,
    });
  const enlace = estilo({ color: COLOR.sello, fontFamily: FUENTE, textDecoration: 'underline' });
  const filasHtml = filas.map((f, i) => {
    const partes = [
      `<strong>${escapar(f.titulo)}</strong>`,
      ...f.lineas.map((l) => escapar(l)),
      ...(f.enlace
        ? [
            `<a href="${escapar(f.enlace.href)}" style="${enlace}" target="_blank" rel="noopener">${escapar(f.enlace.texto)}</a>`,
          ]
        : []),
    ];
    return `<tr><td style="${celda(i === filas.length - 1)}">${partes.join('<br>')}</td></tr>`;
  });
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="${tabla}">${filasHtml.join('')}</table>`;
}

/** La misma lista en texto plano: una fila por bloque, con guion. */
export function listaTexto(filas: FilaLista[]): string[] {
  return filas.flatMap((f) => [
    `- ${f.titulo}`,
    ...f.lineas.map((l) => `  ${l}`),
    ...(f.enlace ? [`  ${f.enlace.texto}: ${f.enlace.href}`] : []),
  ]);
}
