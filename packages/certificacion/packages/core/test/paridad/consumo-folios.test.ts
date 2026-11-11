// Golden tests de GeneradorConsumoFolios::generar (RCOF). Ver
// paridad/php/operaciones/consumo-folios.php.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  type CaratulaRcof,
  GeneradorConsumoFolios,
  type ResumenRcof,
} from '../../src/certificacion/consumo-folios.ts';
import { instanteSii, relojFijo } from '../../src/comun/reloj.ts';
import { FirmaElectronica } from '../../src/core/firma-electronica.ts';
import { casos, esperado, exigirIdentico, material } from '../soporte/paridad.ts';
import { verificarFirmaAgregada } from './verificar-firma.ts';

/** Los arrays del PHP, con sus claves. */
interface CaratulaPhp {
  rut_emisor: string;
  rut_envia: string;
  fch_resol: string;
  nro_resol: string | number;
  fch_inicio: string;
  fch_final: string;
  sec_envio: number;
}

interface RangoPhp {
  inicial: number;
  final: number;
}

interface ResumenPhp {
  tipo: string | number;
  neto: number;
  iva: number;
  tasa_iva: string;
  exento: number;
  total: number;
  folios_emitidos: number;
  folios_anulados: number;
  folios_utilizados: number;
  rangos_utilizados: RangoPhp[];
  rangos_anulados?: RangoPhp[];
}

interface EntradaRcof {
  ahora: string;
  caratula: CaratulaPhp;
  resumenes: ResumenPhp[];
  firmar?: boolean;
}

const lista = casos<EntradaRcof>('consumoFolios');

function caratulaRcof(c: CaratulaPhp): CaratulaRcof {
  return {
    rutEmisor: c.rut_emisor,
    rutEnvia: c.rut_envia,
    fchResol: c.fch_resol,
    nroResol: c.nro_resol,
    fchInicio: c.fch_inicio,
    fchFinal: c.fch_final,
    secEnvio: c.sec_envio,
  };
}

function resumenRcof(r: ResumenPhp): ResumenRcof {
  return {
    tipo: r.tipo,
    neto: r.neto,
    iva: r.iva,
    tasaIva: r.tasa_iva,
    exento: r.exento,
    total: r.total,
    foliosEmitidos: r.folios_emitidos,
    foliosAnulados: r.folios_anulados,
    foliosUtilizados: r.folios_utilizados,
    rangosUtilizados: r.rangos_utilizados,
    ...(r.rangos_anulados === undefined ? {} : { rangosAnulados: r.rangos_anulados }),
  };
}

describe('paridad: GeneradorConsumoFolios::generar', () => {
  it('hay casos de paridad, al menos uno firmado', () => {
    expect(lista.length).toBeGreaterThanOrEqual(7);
    expect(lista.some((caso) => caso.entrada.firmar === true)).toBe(true);
  });

  describe.each(lista)('$nombre', (caso) => {
    const { bytes, meta } = esperado(caso.nombre);

    it('el esperado corresponde a su meta', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
      expect(meta.marcas.TmstFirmaEnv).toBe(caso.entrada.ahora);
    });

    it('Node produce los mismos bytes que el PHP', () => {
      const marca = meta.marcas.TmstFirmaEnv;
      if (marca === undefined) throw new Error('El meta no trae la marca TmstFirmaEnv');
      const generador = new GeneradorConsumoFolios({ reloj: relojFijo(instanteSii(marca)) });
      let obtenido = generador.generar(
        caratulaRcof(caso.entrada.caratula),
        caso.entrada.resumenes.map(resumenRcof),
      );
      if (caso.entrada.firmar === true) {
        const { llave, certificado } = material(caso.material ?? 'base');
        obtenido = new FirmaElectronica(llave, certificado).firmarDte(obtenido, '#RCOF');
      }
      exigirIdentico(obtenido, bytes, caso.nombre);
    });

    if (caso.entrada.firmar === true) {
      it('verificación cruzada: Node verifica la firma del RCOF del PHP', () => {
        const { certificado } = material(caso.material ?? 'base');
        const r = verificarFirmaAgregada(bytes, 'DocumentoConsumoFolios', certificado);
        expect(r.uri).toBe('#RCOF');
        expect(r.digestFirma).toBe(r.digestCalculado);
        expect(r.firmaValida).toBe(true);
      });
    }
  });
});
