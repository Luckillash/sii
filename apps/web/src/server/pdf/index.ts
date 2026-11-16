import 'server-only';
import type { AmbienteSii, TipoFolio } from '@/lib/folios';
import { pdfCarta } from './carta';
import { ANCHO_TIMBRE_ROLLO_PT, pdfRollo } from './rollo';
import { AREA_MAXIMA_TIMBRE, timbreParaArea } from './timbre';

// Representación impresa de la boleta (PLAN-SAAS Fase 7): PDF con `pdfkit` y el timbre
// PDF417 del TED con `bwip-js`, en formato carta y rollo de 80 mm.
//
// Estas firmas son el contrato con `server/emision`. La implementación vive en los
// módulos de esta carpeta: `timbre.ts` (PDF417 y requisitos del SII para el timbre),
// `carta.ts`, `rollo.ts` y `comun.ts` (textos y cifras compartidos).
//
// Decisión: el receptor se imprime solo si está identificado (RUT distinto del genérico
// 66.666.666-6 «Cliente General»), ver `receptorIdentificado` en `comun.ts`.

export type FormatoPdf = 'carta' | 'rollo';

export interface DatosRepresentacion {
  ambiente: AmbienteSii;
  tipoDte: TipoFolio;
  folio: number;
  /** `AAAA-MM-DD` (`<FchEmis>`). */
  fechaEmision: string;
  emisor: { rut: string; razonSocial: string; giro: string; direccion: string; comuna: string };
  receptor: { rut: string; razonSocial: string | null };
  lineas: {
    nombre: string;
    cantidad: number;
    unidad: string | null;
    /** Precio unitario bruto. */
    precio: number;
    exento: boolean;
    /** `<DescuentoMonto>` de la línea. */
    descuento: number;
    /** `<MontoItem>`. */
    montoItem: number;
  }[];
  totales: { neto: number; exento: number; iva: number; total: number; descuentoAplicado: number };
  /** Resolución de la carátula («Res. N.º 80 de 2014»; certificación: número 0). */
  resolucion: { numero: number; fecha: string };
  /**
   * El `<TED>` tal como va en el DTE firmado, con sus bytes ISO-8859-1 representados como
   * texto `latin1` (un carácter por byte). El PDF417 codifica esos bytes exactos: si se
   * reconvierten, la firma `<FRMT>` deja de verificar.
   */
  tedXml: string;
}

/** PDF de la representación impresa. Lanza si el TED no se puede codificar. */
export async function generarPdf(datos: DatosRepresentacion, formato: FormatoPdf): Promise<Buffer> {
  if (formato === 'carta') {
    return pdfCarta(datos, await timbreParaArea(datos.tedXml, AREA_MAXIMA_TIMBRE));
  }
  if (formato === 'rollo') {
    const area = {
      anchoPt: Math.min(ANCHO_TIMBRE_ROLLO_PT, AREA_MAXIMA_TIMBRE.anchoPt),
      altoPt: AREA_MAXIMA_TIMBRE.altoPt,
    };
    return pdfRollo(datos, await timbreParaArea(datos.tedXml, area));
  }
  throw new Error(`Formato de PDF desconocido: ${String(formato)}`);
}
