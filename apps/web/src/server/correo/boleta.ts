import 'server-only';
import { correoBoleta } from '@sii/correos';
import type { TipoFolio } from '@/lib/folios';
import { formatearFecha, formatearMonto, formatearRut, nombreTipoDte } from '@/lib/formatos';
import { enviarCorreo, type OpcionesEnvio, type ResultadoEnvio } from './resend';

// Envío de la boleta emitida al correo del receptor (PLAN-SAAS Fase 7, §4.6): plantilla
// `correoBoleta` de `@sii/correos` y el PDF adjunto por Resend.
//
// Esta firma es el contrato con `server/emision`. Nunca lanza: cualquier falla vuelve como
// `ResultadoEnvio` (la boleta ya está emitida; el correo es un extra). Nunca pone el PDF
// en un detalle de error.

export interface DatosCorreoBoleta {
  para: string;
  emisor: { rut: string; razonSocial: string };
  tipoDte: TipoFolio;
  folio: number;
  /** `AAAA-MM-DD`. */
  fechaEmision: string;
  total: number;
  /** PDF (carta) de la representación impresa. */
  pdf: Buffer;
  /** Determinista por documento (p. ej. `boleta-<documentoId>`): no envía dos veces en 24 h. */
  claveIdempotencia: string;
}

/** `boleta-39-F41.pdf`. */
export function nombreAdjuntoBoleta(tipoDte: TipoFolio, folio: number): string {
  return `boleta-${tipoDte}-F${folio}.pdf`;
}

/** Forma mínima de una dirección: algo@dominio.tld, sin blancos, hasta 254 caracteres. */
function correoPlausible(correo: string): boolean {
  return correo.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo);
}

/**
 * Envía la boleta al receptor. `opciones` solo existe para las pruebas (`fetch` y
 * configuración de Resend); `server/emision` lo llama con los datos.
 */
export async function enviarBoletaPorCorreo(
  datos: DatosCorreoBoleta,
  opciones?: OpcionesEnvio,
): Promise<ResultadoEnvio> {
  try {
    const para = datos.para.trim();
    if (!correoPlausible(para)) {
      return { ok: false, motivo: 'rechazado', detalle: 'El correo del receptor no es válido.' };
    }
    if (!Buffer.isBuffer(datos.pdf) || datos.pdf.length === 0) {
      return { ok: false, motivo: 'rechazado', detalle: 'Falta el PDF de la boleta.' };
    }
    const tipo = nombreTipoDte(datos.tipoDte);
    const correo = correoBoleta({
      empresa: datos.emisor.razonSocial,
      rut: formatearRut(datos.emisor.rut),
      tipo: tipo.charAt(0).toLowerCase() + tipo.slice(1),
      folio: String(datos.folio),
      total: formatearMonto(datos.total),
      fecha: formatearFecha(datos.fechaEmision),
    });
    return await enviarCorreo(
      {
        para,
        asunto: correo.asunto,
        html: correo.html,
        texto: correo.texto,
        claveIdempotencia: datos.claveIdempotencia,
        adjuntos: [
          {
            nombre: nombreAdjuntoBoleta(datos.tipoDte, datos.folio),
            contenido: datos.pdf,
            tipo: 'application/pdf',
          },
        ],
      },
      opciones,
    );
  } catch {
    // `enviarCorreo` no lanza; esto cubre datos inesperados al armar la plantilla.
    return { ok: false, motivo: 'rechazado', detalle: 'No se pudo armar el correo de la boleta.' };
  }
}
