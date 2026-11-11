import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { instanteSii, relojFijo } from '../../src/comun/reloj.ts';
import { type DatosBoleta, GeneradorBoleta } from '../../src/core/generador-boleta.ts';
import { casos, esperado, exigirIdentico } from '../soporte/paridad.ts';

/** Los arrays de generarBoleta() con las claves del PHP. */
interface EntradaBoleta {
  ahora: string;
  emisor: { rut: string; razon_social: string; giro: string; direccion: string; comuna: string };
  receptor: { rut: string; razon_social?: string };
  folio: string | number;
  tipo_dte?: string | number;
  detalles: {
    nombre: string;
    cantidad: number;
    precio: number;
    exento?: boolean;
    unidad?: string;
  }[];
  referencia?: { codigo: string; razon: string };
  descuento?: { tipo?: 'porcentaje' | 'monto'; valor: number; glosa?: string };
}

const lista = casos<EntradaBoleta>('generar-boleta');

function datosBoleta(e: EntradaBoleta): DatosBoleta {
  const datos: DatosBoleta = {
    emisor: {
      rut: e.emisor.rut,
      razonSocial: e.emisor.razon_social,
      giro: e.emisor.giro,
      direccion: e.emisor.direccion,
      comuna: e.emisor.comuna,
    },
    receptor: { rut: e.receptor.rut },
    folio: e.folio,
    detalles: e.detalles,
  };
  if (e.receptor.razon_social !== undefined) datos.receptor.razonSocial = e.receptor.razon_social;
  if (e.tipo_dte !== undefined) datos.tipoDte = e.tipo_dte;
  if (e.referencia !== undefined) datos.referencia = e.referencia;
  if (e.descuento !== undefined) datos.descuento = e.descuento;
  return datos;
}

describe('paridad: GeneradorBoleta::generarBoleta', () => {
  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    const { bytes, meta } = esperado(caso.nombre);
    const fchEmis = meta.marcas.FchEmis;

    it('el esperado corresponde a su meta', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
      // FchEmis es la fecha de Chile de `ahora` (no la de UTC).
      expect(fchEmis).toBe(caso.entrada.ahora.slice(0, 10));
    });

    it('Node produce los mismos bytes que el PHP (con la hora exacta del caso)', () => {
      const generador = new GeneradorBoleta({ reloj: relojFijo(instanteSii(caso.entrada.ahora)) });
      exigirIdentico(generador.generarBoleta(datosBoleta(caso.entrada)), bytes, caso.nombre);
    });

    it('Node produce los mismos bytes que el PHP (con la marca FchEmis del meta)', () => {
      if (fchEmis === undefined) throw new Error('El meta no trae la marca FchEmis');
      const generador = new GeneradorBoleta({ reloj: relojFijo(instanteSii(fchEmis)) });
      exigirIdentico(generador.generarBoleta(datosBoleta(caso.entrada)), bytes, caso.nombre);
    });
  });
});
