// Golden tests de ArmadorBoleta::armar (el armado de cada DTE del bin
// enviar-set-boletas.php). Ver paridad/php/operaciones/armar-boleta.php.

import { createHash, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decodificarUtf8OIso } from '../../src/comun/codificacion.ts';
import { instanteSii, relojFijo } from '../../src/comun/reloj.ts';
import { parsearDocumento } from '../../src/comun/xml.ts';
import { ArmadorBoleta } from '../../src/core/armador-boleta.ts';
import { FirmaElectronica } from '../../src/core/firma-electronica.ts';
import type { DatosBoleta } from '../../src/core/generador-boleta.ts';
import { llavePublicaRsapk, partesTed, tedsEn } from '../soporte/caf.ts';
import { casos, esperado, exigirIdentico, leerMaterial, material } from '../soporte/paridad.ts';
import { ultimaFirmaHija, verificarFirma } from './verificar-firma.ts';

/** Los arrays de generarBoleta() con las claves del PHP, más el CAF. */
interface EntradaArmarBoleta {
  ahora: string;
  caf: string;
  emisor: { rut: string; razon_social: string; giro: string; direccion: string; comuna: string };
  receptor: { rut: string; razon_social: string };
  folio: string | number;
  tipo_dte?: string | number;
  detalles: DatosBoleta['detalles'];
  referencia?: { codigo: string; razon: string };
  descuento?: { tipo?: 'porcentaje' | 'monto'; valor: number };
}

const lista = casos<EntradaArmarBoleta>('armar-boleta');

function datosBoleta(e: EntradaArmarBoleta): DatosBoleta {
  const datos: DatosBoleta = {
    emisor: {
      rut: e.emisor.rut,
      razonSocial: e.emisor.razon_social,
      giro: e.emisor.giro,
      direccion: e.emisor.direccion,
      comuna: e.emisor.comuna,
    },
    receptor: { rut: e.receptor.rut, razonSocial: e.receptor.razon_social },
    folio: e.folio,
    detalles: e.detalles,
  };
  if (e.tipo_dte !== undefined) datos.tipoDte = e.tipo_dte;
  if (e.referencia !== undefined) datos.referencia = e.referencia;
  if (e.descuento !== undefined) datos.descuento = e.descuento;
  return datos;
}

describe('paridad: ArmadorBoleta::armar', () => {
  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThanOrEqual(4);
  });

  describe.each(lista)('$nombre', (caso) => {
    const { llave, certificado } = material(caso.material ?? 'base');
    const { bytes, meta } = esperado(caso.nombre);
    const caf = leerMaterial(caso.entrada.caf);
    const tipo = String(caso.entrada.tipo_dte ?? '39');
    const uri = `#F${caso.entrada.folio}T${tipo}`;

    it('el esperado corresponde a su meta (un solo instante en todas las marcas)', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
      expect(meta.marcas.TSTED).toBe(caso.entrada.ahora);
      expect(meta.marcas.TmstFirma).toBe(caso.entrada.ahora);
      expect(meta.marcas.FchEmis).toBe(caso.entrada.ahora.slice(0, 10));
    });

    it('Node produce los mismos bytes que el PHP (CAF en bytes)', () => {
      const marca = meta.marcas.TmstFirma;
      if (marca === undefined) throw new Error('El meta no trae la marca TmstFirma');
      const armador = new ArmadorBoleta(new FirmaElectronica(llave, certificado), {
        reloj: relojFijo(instanteSii(marca)),
      });
      exigirIdentico(armador.armar(datosBoleta(caso.entrada), caf), bytes, caso.nombre);
    });

    it('el CAF como texto da lo mismo', () => {
      const armador = new ArmadorBoleta(new FirmaElectronica(llave, certificado), {
        reloj: relojFijo(instanteSii(caso.entrada.ahora)),
      });
      const obtenido = armador.armar(datosBoleta(caso.entrada), decodificarUtf8OIso(caf));
      exigirIdentico(obtenido, bytes, caso.nombre);
    });

    it('verificación cruzada: Node verifica la firma del DTE del PHP', () => {
      const doc = parsearDocumento(bytes);
      const raiz = doc.documentElement;
      const documento = doc.getElementsByTagName('Documento').item(0);
      if (raiz === null || documento === null) throw new Error('DTE sin <Documento>');
      const r = verificarFirma(documento, ultimaFirmaHija(raiz), certificado);
      expect(r.uri).toBe(uri);
      expect(r.digestFirma).toBe(r.digestCalculado);
      expect(r.firmaValida).toBe(true);
    });

    it('verificación cruzada: Node verifica la FRMT del TED del PHP con el <RSAPK> del CAF', () => {
      const teds = tedsEn(bytes);
      expect(teds).toHaveLength(1);
      const { dd, firma } = partesTed(teds[0] as Buffer);
      expect(verify('sha1', dd, llavePublicaRsapk(decodificarUtf8OIso(caf)), firma)).toBe(true);
    });
  });
});
