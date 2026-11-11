// Set de pruebas de punta a punta (criterio de salida de la fase 3): el
// EnvioBOLETA y el RCOF del set real, idénticos a los del PHP. Ver
// paridad/php/operaciones/set-completo.php.

import { createHash, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GeneradorConsumoFolios } from '../../src/certificacion/consumo-folios.ts';
import { resumirParaRcof } from '../../src/certificacion/resumen-rcof.ts';
import { parsearSetPruebas } from '../../src/certificacion/set-pruebas.ts';
import { decodificarUtf8OIso } from '../../src/comun/codificacion.ts';
import { instanteSii, relojFijo } from '../../src/comun/reloj.ts';
import { parsearDocumento } from '../../src/comun/xml.ts';
import { ArmadorBoleta } from '../../src/core/armador-boleta.ts';
import { EnvioBoleta } from '../../src/core/envio-boleta.ts';
import { FirmaElectronica } from '../../src/core/firma-electronica.ts';
import { llavePublicaRsapk, partesTed, tedsEn } from '../soporte/caf.ts';
import {
  type CasoParidad,
  casos,
  esperado,
  exigirIdentico,
  leerMaterial,
  material,
  RAIZ_PARIDAD,
} from '../soporte/paridad.ts';
import { ultimaFirmaHija, verificarFirma, verificarFirmaAgregada } from './verificar-firma.ts';

interface EntradaSetCompleto {
  ahora: string;
  archivo: string;
  caf: string;
  folioInicial: number;
  emisor: { rut: string; razon_social: string; giro: string; direccion: string; comuna: string };
  receptor: { rut: string; razon_social: string };
  rutEnvia: string;
  nroResol: string;
  fchResol: string;
  fchResolRcof: string;
  secEnvio: number;
}

function caso(operacion: string): CasoParidad<EntradaSetCompleto> {
  const [unico, ...otros] = casos<EntradaSetCompleto>(operacion);
  if (unico === undefined || otros.length > 0) throw new Error(`Se esperaba un caso ${operacion}`);
  return unico;
}

const set = caso('set-completo');
const rcof = caso('rcof-set-completo');
const { llave, certificado } = material('base');
const firmador = new FirmaElectronica(llave, certificado);

/** Los DTE del set armados en Node, como el bucle del bin (folios consecutivos). */
function armarSet(entrada: EntradaSetCompleto, marca: string): Buffer[] {
  const contenido = readFileSync(join(RAIZ_PARIDAD, '..', entrada.archivo));
  const caf = leerMaterial(entrada.caf);
  const armador = new ArmadorBoleta(firmador, { reloj: relojFijo(instanteSii(marca)) });
  const { emisor, receptor } = entrada;
  return parsearSetPruebas(contenido, '39').map((c, i) =>
    armador.armar(
      {
        emisor: {
          rut: emisor.rut,
          razonSocial: emisor.razon_social,
          giro: emisor.giro,
          direccion: emisor.direccion,
          comuna: emisor.comuna,
        },
        receptor: { rut: receptor.rut, razonSocial: receptor.razon_social },
        folio: String(entrada.folioInicial + i),
        detalles: c.detalles,
        tipoDte: c.tipo,
        referencia: c.referencia,
      },
      caf,
    ),
  );
}

function marca(meta: { marcas: Record<string, string> }, nombre: string): string {
  const valor = meta.marcas[nombre];
  if (valor === undefined) throw new Error(`El meta no trae la marca ${nombre}`);
  return valor;
}

describe('paridad: set de pruebas completo (EnvioBOLETA)', () => {
  const { bytes, meta } = esperado(set.nombre);
  const tmstFirmaEnv = marca(meta, 'TmstFirmaEnv');
  const dtes = armarSet(set.entrada, tmstFirmaEnv);

  it('el esperado corresponde a su meta (un solo instante en todas las marcas)', () => {
    expect(bytes.length).toBe(meta.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    expect(meta.marcas).toEqual({
      FchEmis: set.entrada.ahora.slice(0, 10),
      TSTED: set.entrada.ahora,
      TmstFirma: set.entrada.ahora,
      TmstFirmaEnv: set.entrada.ahora,
    });
  });

  it('el set real da 5 DTE con folios consecutivos', () => {
    expect(dtes).toHaveLength(5);
  });

  it('Node produce el mismo sobre que el PHP', () => {
    const { rutEnvia, nroResol, fchResol } = set.entrada;
    const envio = new EnvioBoleta(
      firmador,
      { rutEmisor: set.entrada.emisor.rut, rutEnvia, nroResol, fchResol },
      { reloj: relojFijo(instanteSii(tmstFirmaEnv)) },
    );
    exigirIdentico(envio.empaquetar(dtes), bytes, set.nombre);
  });

  it('cada DTE de Node va tal cual en el sobre del PHP (sin su declaración XML)', () => {
    const sobre = bytes.toString('latin1');
    for (const dte of dtes) {
      const sinDeclaracion = dte.toString('latin1').replace(/^<\?xml[^\n]*\?>/, '');
      expect(sobre.includes(`${sinDeclaracion}\n`)).toBe(true);
    }
  });

  it('verificación cruzada: Node verifica la firma del sobre del PHP', () => {
    const r = verificarFirmaAgregada(bytes, 'SetDTE', certificado);
    expect(r.uri).toBe('#SetDoc');
    expect(r.digestFirma).toBe(r.digestCalculado);
    expect(r.firmaValida).toBe(true);
  });

  it('verificación cruzada: Node verifica la firma de cada DTE del sobre del PHP', () => {
    const lista = parsearDocumento(bytes).getElementsByTagName('DTE');
    expect(lista.length).toBe(5);
    for (let i = 0; i < lista.length; i++) {
      const dte = lista.item(i) as Element;
      const documento = dte.getElementsByTagName('Documento').item(0);
      if (documento === null) throw new Error('DTE sin <Documento>');
      const r = verificarFirma(documento, ultimaFirmaHija(dte), certificado);
      expect(r.uri).toBe(`#F${set.entrada.folioInicial + i}T39`);
      expect(r.digestFirma).toBe(r.digestCalculado);
      expect(r.firmaValida).toBe(true);
    }
  });

  it('verificación cruzada: Node verifica la FRMT de cada TED del sobre del PHP', () => {
    const teds = tedsEn(bytes);
    expect(teds).toHaveLength(5);
    const rsapk = llavePublicaRsapk(decodificarUtf8OIso(leerMaterial(set.entrada.caf)));
    for (const ted of teds) {
      const { dd, firma } = partesTed(ted);
      expect(verify('sha1', dd, rsapk, firma)).toBe(true);
    }
  });
});

describe('paridad: RCOF del set de pruebas completo', () => {
  const { bytes, meta } = esperado(rcof.nombre);
  const tmstFirmaEnv = marca(meta, 'TmstFirmaEnv');
  const dtes = armarSet(rcof.entrada, tmstFirmaEnv);

  function rcofNode(fuente: readonly Buffer[]): Buffer {
    const { resumenes, fchInicio, fchFinal } = resumirParaRcof(fuente);
    const { emisor, rutEnvia, fchResolRcof, nroResol, secEnvio } = rcof.entrada;
    const xml = new GeneradorConsumoFolios({ reloj: relojFijo(instanteSii(tmstFirmaEnv)) }).generar(
      {
        rutEmisor: emisor.rut,
        rutEnvia,
        fchResol: fchResolRcof,
        nroResol,
        fchInicio,
        fchFinal,
        secEnvio,
      },
      resumenes,
    );
    return firmador.firmarDte(xml, '#RCOF');
  }

  it('el esperado corresponde a su meta', () => {
    expect(bytes.length).toBe(meta.bytes);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    expect(tmstFirmaEnv).toBe(rcof.entrada.ahora);
    expect(rcof.entrada).toEqual(set.entrada);
  });

  it('Node produce el mismo RCOF que el PHP (resumen desde los DTE armados en Node)', () => {
    exigirIdentico(rcofNode(dtes), bytes, rcof.nombre);
  });

  it('resumir el sobre del PHP da el mismo RCOF', () => {
    exigirIdentico(rcofNode([esperado(set.nombre).bytes]), bytes, rcof.nombre);
  });

  it('los montos son los de la fórmula del bin', () => {
    const { resumenes } = resumirParaRcof(dtes);
    expect(resumenes).toEqual([
      {
        tipo: '39',
        neto: 43831,
        iva: 8329,
        exento: 2000,
        total: 54160,
        foliosEmitidos: 5,
        foliosAnulados: 0,
        foliosUtilizados: 5,
        rangosUtilizados: [{ inicial: 56, final: 60 }],
        rangosAnulados: [],
      },
    ]);
  });

  it('verificación cruzada: Node verifica la firma del RCOF del PHP', () => {
    const r = verificarFirmaAgregada(bytes, 'DocumentoConsumoFolios', certificado);
    expect(r.uri).toBe('#RCOF');
    expect(r.digestFirma).toBe(r.digestCalculado);
    expect(r.firmaValida).toBe(true);
  });
});
