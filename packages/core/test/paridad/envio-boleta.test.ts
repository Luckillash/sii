// Golden tests de EnvioBoleta::empaquetar. Ver paridad/php/operaciones/envio-boleta.php.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { aIso88591, desdeIso88591 } from '../../src/comun/codificacion.ts';
import { instanteSii, relojFijo } from '../../src/comun/reloj.ts';
import { EnvioBoleta } from '../../src/core/envio-boleta.ts';
import { FirmaElectronica } from '../../src/core/firma-electronica.ts';
import { casos, esperado, exigirIdentico, material } from '../soporte/paridad.ts';
import { verificarFirmaAgregada } from './verificar-firma.ts';

type DteCaso = { xml: string; uri: string } | { crudo: string } | { crudo_base64: string };

interface EntradaEnvioBoleta {
  ahora: string;
  rutEmisor: string;
  rutEnvia: string;
  nroResol: string | number;
  fchResol: string;
  dtes: DteCaso[];
}

const lista = casos<EntradaEnvioBoleta>('envioBoleta');

/** Los bytes de cada DTE, como los arma la operación PHP (sin el "\n" que sigue). */
function bytesDtes(firmador: FirmaElectronica, dtes: DteCaso[]): Buffer[] {
  return dtes.map((dte) => {
    if ('xml' in dte) return firmador.firmarDte(aIso88591(dte.xml), dte.uri);
    if ('crudo' in dte) return aIso88591(dte.crudo);
    return Buffer.from(dte.crudo_base64, 'base64');
  });
}

describe('paridad: EnvioBoleta::empaquetar', () => {
  it('hay casos de paridad', () => {
    // envio-boleta-vacio se retiró (2026-11-06): sin DTE, Node lanza ErrorValidacion
    // (ver el unitario); el PHP armaba un sobre que no valida contra el XSD.
    expect(lista.length).toBeGreaterThanOrEqual(6);
  });

  describe.each(lista)('$nombre', (caso) => {
    const { llave, certificado } = material(caso.material ?? 'base');
    const { bytes, meta } = esperado(caso.nombre);
    const firmador = new FirmaElectronica(llave, certificado);
    const { rutEmisor, rutEnvia, nroResol, fchResol } = caso.entrada;
    const datos = { rutEmisor, rutEnvia, nroResol, fchResol };

    const envio = () => {
      const marca = meta.marcas.TmstFirmaEnv;
      if (marca === undefined) throw new Error('El meta no trae la marca TmstFirmaEnv');
      return new EnvioBoleta(firmador, datos, { reloj: relojFijo(instanteSii(marca)) });
    };

    it('el esperado corresponde a su meta', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
      expect(meta.marcas.TmstFirmaEnv).toBe(caso.entrada.ahora);
    });

    it('Node produce los mismos bytes que el PHP (arreglo de Buffer)', () => {
      const dtes = bytesDtes(firmador, caso.entrada.dtes);
      exigirIdentico(envio().empaquetar(dtes), bytes, caso.nombre);
    });

    it('un Buffer concatenado (como el bin del PHP) da lo mismo', () => {
      const dtes = bytesDtes(firmador, caso.entrada.dtes).flatMap((b) => [b, Buffer.from('\n')]);
      exigirIdentico(envio().empaquetar(Buffer.concat(dtes)), bytes, caso.nombre);
    });

    it('los DTE como texto Unicode (string) dan lo mismo', () => {
      const dtes = bytesDtes(firmador, caso.entrada.dtes).map((b) => desdeIso88591(b));
      exigirIdentico(envio().empaquetar(dtes), bytes, caso.nombre);
    });

    it('verificación cruzada: Node verifica la firma del sobre del PHP', () => {
      const r = verificarFirmaAgregada(bytes, 'SetDTE', certificado);
      expect(r.uri).toBe('#SetDoc');
      expect(r.digestFirma).toBe(r.digestCalculado);
      expect(r.firmaValida).toBe(true);
    });
  });
});
