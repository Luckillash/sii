import { createPrivateKey, createPublicKey, type KeyObject, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import bwipjs from 'bwip-js/node';
import { beforeAll, describe, expect, it } from 'vitest';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
import { boletaPrueba } from './boleta-prueba';
import {
  AREA_MAXIMA_TIMBRE,
  dimensionesPng,
  MODULO_MINIMO_MM,
  pngPdf417,
  timbreParaArea,
} from './timbre';

// Criterio de aceptación de la Fase 7: el PDF417 lleva los bytes EXACTOS del TED y su
// `<FRMT>` verifica contra la llave del CAF. Se arma una boleta real con la librería, se
// genera el PNG, se DECODIFICA con zxing-cpp (zxing-wasm, sin red: el .wasm se lee del
// paquete instalado) y se verifica la firma como `sii util verificar-ted`.

beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const wasm = readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm'));
  await prepareZXingModule({
    overrides: {
      // Sin esto, zxing-wasm descarga el .wasm desde jsDelivr.
      wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength),
    },
    fireImmediately: true,
  });
});

/** Bytes que lee un lector de PDF417 del PNG. */
async function decodificar(png: Buffer): Promise<Buffer> {
  const resultados = await readBarcodes(new Uint8Array(png), {
    formats: ['PDF417'],
    tryHarder: true,
  });
  expect(resultados).toHaveLength(1);
  const [r] = resultados;
  expect(r?.isValid).toBe(true);
  return Buffer.from(r?.bytes ?? new Uint8Array());
}

/** Forma de un TED del SII (la misma expresión de `verificar-ted.ts`). */
const PARTES_TED =
  /^<TED version="1\.0">(<DD>[\s\S]*<\/DD>)<FRMT algoritmo="SHA1withRSA">([^<]*)<\/FRMT><\/TED>$/;

/** Llave pública del par de `<RSASK>`, reconstruyendo el PEM como `verificar-ted.ts`. */
function publicaDeRsask(caf: string): KeyObject {
  const rsask = /<RSASK>([\s\S]*?)<\/RSASK>/.exec(caf)?.[1] ?? '';
  const cuerpo = rsask
    .replaceAll('-----BEGIN RSA PRIVATE KEY-----', '')
    .replaceAll('-----END RSA PRIVATE KEY-----', '')
    .replace(/[\r\n \t]/g, '');
  const lineas = cuerpo.match(/[\s\S]{1,64}/g) ?? [];
  const pem = `-----BEGIN RSA PRIVATE KEY-----\n${lineas.join('\n')}\n-----END RSA PRIVATE KEY-----`;
  return createPublicKey(createPrivateKey(pem));
}

/** Llave de la `<RSAPK>` del CAF (la que usa el SII). */
function publicaDeRsapk(caf: string): KeyObject {
  const m = /<RSAPK><M>([^<]+)<\/M><E>([^<]+)<\/E><\/RSAPK>/.exec(caf);
  const b64url = (v: string) => Buffer.from(v.replace(/\s/g, ''), 'base64').toString('base64url');
  return createPublicKey({
    key: { kty: 'RSA', n: b64url(m?.[1] ?? ''), e: b64url(m?.[2] ?? '') },
    format: 'jwk',
  });
}

/** `verificar-ted`: la `<FRMT>` sobre los bytes del `<DD>` (texto `latin1`). */
function frmtVerifica(ted: Buffer, llave: KeyObject): boolean {
  const partes = PARTES_TED.exec(ted.toString('latin1'));
  if (!partes?.[1] || partes[2] === undefined) return false;
  const firma = Buffer.from(partes[2].replace(/\s/g, ''), 'base64');
  return verify('sha1', Buffer.from(partes[1], 'latin1'), llave, firma);
}

describe('PDF417 del TED', () => {
  it('decodifica a los bytes exactos del TED y su <FRMT> verifica contra el CAF', async () => {
    const b = boletaPrueba({
      receptor: { rut: '12345678-5', razonSocial: 'Peñalolén Ñandú e Hijos Ltda.' },
    });
    // El TED trae bytes ISO-8859-1 fuera de ASCII (ñ = 0xF1), que es lo que se prueba.
    const bytesTed = Buffer.from(b.tedXml, 'latin1');
    expect(bytesTed.includes(Buffer.from([0xf1]))).toBe(true);
    expect(bytesTed.includes(Buffer.from('ñ', 'utf8'))).toBe(false);
    // Y es el mismo TED que va dentro del DTE firmado.
    expect(b.dte.includes(bytesTed)).toBe(true);

    const leidos = await decodificar(await pngPdf417(b.tedXml));
    expect(leidos.equals(bytesTed)).toBe(true);

    const rsask = publicaDeRsask(b.caf);
    const rsapk = publicaDeRsapk(b.caf);
    expect(
      rsask
        .export({ type: 'spki', format: 'der' })
        .equals(rsapk.export({ type: 'spki', format: 'der' })),
    ).toBe(true);
    expect(frmtVerifica(leidos, rsask)).toBe(true);
    expect(frmtVerifica(leidos, rsapk)).toBe(true);
  });

  it('el timbre en el tamaño de la carta y del rollo también se lee igual', async () => {
    const b = boletaPrueba({ tipoDte: 41, folio: 7 });
    for (const area of [AREA_MAXIMA_TIMBRE, { anchoPt: 204, altoPt: AREA_MAXIMA_TIMBRE.altoPt }]) {
      const t = await timbreParaArea(b.tedXml, area);
      expect(t.anchoPt).toBeLessThanOrEqual(area.anchoPt + 1e-6);
      expect(t.altoPt).toBeLessThanOrEqual(area.altoPt + 1e-6);
      expect(t.moduloMm).toBeGreaterThanOrEqual(MODULO_MINIMO_MM);
      // Al menos 2 × 5 cm (el mínimo del SII) en la carta.
      if (area === AREA_MAXIMA_TIMBRE) {
        expect(t.anchoPt).toBeGreaterThanOrEqual((50 * 72) / 25.4);
        expect(t.altoPt).toBeGreaterThanOrEqual((20 * 72) / 25.4);
      }
      const leidos = await decodificar(t.png);
      expect(leidos.equals(Buffer.from(b.tedXml, 'latin1'))).toBe(true);
      expect(frmtVerifica(leidos, publicaDeRsask(b.caf))).toBe(true);
    }
  });

  it('control: si el TED se codificara en UTF-8, la firma ya no verificaría', async () => {
    const b = boletaPrueba({ receptor: { rut: '12345678-5', razonSocial: 'Panadería Ñandú SpA' } });
    // Lo que hace bwip-js sin `binarytext`: pasa el texto a UTF-8 (ñ → C3 B1).
    const opciones: bwipjs.RenderOptions & { eclevel: number } = {
      bcid: 'pdf417',
      text: b.tedXml,
      eclevel: 5,
      scale: 3,
      padding: 2,
      backgroundcolor: 'FFFFFF',
    };
    const png = await bwipjs.toBuffer(opciones);
    const leidos = await decodificar(png);
    expect(leidos.equals(Buffer.from(b.tedXml, 'latin1'))).toBe(false);
    expect(frmtVerifica(leidos, publicaDeRsask(b.caf))).toBe(false);
  });

  it('filas de 3 módulos de alto y zona de silencio en el PNG', async () => {
    const b = boletaPrueba();
    const png = await pngPdf417(b.tedXml, { columnas: 12, escala: 1 });
    const { ancho, alto } = dimensionesPng(png);
    // 17 × columnas + 69 módulos (arranque, indicadores y parada) + 2 de silencio por lado.
    expect(ancho).toBe(17 * 12 + 69 + 4);
    expect((alto - 4) % 3).toBe(0);
  });

  it('rechaza un TED que no es texto latin1 o no tiene forma de TED', async () => {
    await expect(pngPdf417('<TED version="1.0">€</TED>')).rejects.toThrow(/ISO-8859-1/);
    await expect(pngPdf417('<DD></DD>')).rejects.toThrow(/<TED>/);
  });
});
