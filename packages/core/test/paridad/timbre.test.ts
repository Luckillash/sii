import { createHash, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodificarUtf8OIso } from '../../src/comun/codificacion.ts';
import { instanteSii, relojFijo } from '../../src/comun/reloj.ts';
import { type DatosTed, Timbre } from '../../src/core/timbre.ts';
import { llavePublicaRsapk, partesTed } from '../soporte/caf.ts';
import { casos, esperado, exigirIdentico, leerMaterial } from '../soporte/paridad.ts';

/** El array de generarTed() con las claves del PHP. */
interface DatosPhp {
  rut_emisor: string;
  tipo_dte: string | number;
  folio: string | number;
  fecha: string;
  rut_receptor: string;
  razon_social_receptor: string;
  monto_total: string | number;
  nombre_item_1: string;
}

interface EntradaTimbre {
  caf: string;
  ahora: string;
  datos: DatosPhp;
}

const lista = casos<EntradaTimbre>('timbre');

function datosTed(d: DatosPhp): DatosTed {
  return {
    rutEmisor: d.rut_emisor,
    tipoDte: d.tipo_dte,
    folio: d.folio,
    fecha: d.fecha,
    rutReceptor: d.rut_receptor,
    razonSocialReceptor: d.razon_social_receptor,
    montoTotal: d.monto_total,
    nombreItem1: d.nombre_item_1,
  };
}

describe('paridad: Timbre::generarTed', () => {
  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    const caf = leerMaterial(caso.entrada.caf);
    const { bytes, meta } = esperado(caso.nombre);
    const tsted = meta.marcas.TSTED;

    it('el esperado corresponde a su meta', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
      expect(tsted).toBe(caso.entrada.ahora);
    });

    it('Node produce los mismos bytes que el PHP', () => {
      if (tsted === undefined) throw new Error('El meta no trae la marca TSTED');
      const timbre = new Timbre(caf, { reloj: relojFijo(instanteSii(tsted)) });
      exigirIdentico(timbre.generarTed(datosTed(caso.entrada.datos)), bytes, caso.nombre);
    });

    it('verificación cruzada: Node verifica la FRMT del PHP con el <RSAPK> del CAF', () => {
      const { dd, firma } = partesTed(bytes);
      const llave = llavePublicaRsapk(decodificarUtf8OIso(caf));
      expect(verify('sha1', dd, llave, firma)).toBe(true);
    });
  });
});
