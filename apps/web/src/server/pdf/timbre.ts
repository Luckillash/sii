import 'server-only';
import bwipjs from 'bwip-js/node';

// Timbre electrónico (PDF417 del `<TED>`) de la representación impresa.
//
// Requisitos del SII para el timbre impreso (instructivo técnico de la representación
// impresa de los DTE, que no está copiado en `documentación/`):
//   - Simbología PDF417, nivel de seguridad (corrección de errores) 5.
//   - Ancho mínimo del módulo (dimensión X): 0,0067" ≈ 0,17 mm.
//   - Alto de cada fila igual a 3 veces la dimensión X (proporción Y:X = 3).
//   - Área del timbre entre 2 × 5 cm y 4 × 9 cm (alto × ancho).
//   - Debajo: «Timbre Electrónico SII», la resolución y «Verifique documento: www.sii.cl».
//
// BYTES: la `<FRMT>` es una firma sobre los bytes ISO-8859-1 del `<DD>`. El código lleva
// esos bytes EXACTOS: `tedXml` llega como texto `latin1` (un carácter por byte) y
// `binarytext: true` le dice a bwip-js que use cada carácter como un byte, en lugar de
// pasarlo a UTF-8 (lo que hace por defecto). Una «ñ» queda como 0xF1, no como C3 B1.
// bwip-js elige la compactación (texto para lo ASCII, byte para lo demás); un lector
// devuelve la misma secuencia de bytes en cualquier caso, y la prueba lo comprueba
// decodificando el PNG.

/** Nivel de corrección de errores que exige el SII. */
export const NIVEL_SEGURIDAD = 5;
/** Dimensión X mínima del SII: 0,0067 pulgadas. */
export const MODULO_MINIMO_MM = 0.0067 * 25.4;
/** Alto de fila en módulos (Y:X = 3). */
const MODULOS_POR_FILA = 3;
/** Zona de silencio a cada lado, en módulos (la norma pide al menos 2). */
const ZONA_SILENCIO = 2;
/** Columnas de datos que se prueban para encajar el código en el área. */
const COLUMNAS_POSIBLES = [10, 11, 12, 13, 14, 15, 16, 17, 18] as const;
/** Píxeles por módulo del PNG final: con 9 cm de ancho quedan unos 300 ppp. */
const PIXELES_POR_MODULO = 3;

const PUNTOS_POR_MM = 72 / 25.4;

/** Área máxima del timbre del SII, en puntos PDF. */
export const AREA_MAXIMA_TIMBRE = { anchoPt: 90 * PUNTOS_POR_MM, altoPt: 40 * PUNTOS_POR_MM };

export interface OpcionesPdf417 {
  /** Columnas de datos del símbolo (bwip-js elige las filas). */
  columnas?: number;
  /** Píxeles por módulo. */
  escala?: number;
}

/**
 * Comprueba que `tedXml` sea un `<TED>` completo en texto `latin1`. Un carácter sobre
 * U+00FF significa que alguien lo decodificó como Unicode y no hay un byte que lo
 * represente: mejor fallar que imprimir un timbre que no verifica.
 */
function validarTed(tedXml: string): void {
  if (!/^<TED\b[\s\S]*<\/TED>$/.test(tedXml)) {
    throw new Error('El TED no tiene la forma <TED>…</TED>.');
  }
  for (let i = 0; i < tedXml.length; i++) {
    if (tedXml.charCodeAt(i) > 0xff) {
      throw new Error('El TED trae caracteres fuera de ISO-8859-1: no viene como texto latin1.');
    }
  }
}

/**
 * PNG (fondo blanco, módulos negros) del PDF417 del TED, con nivel de seguridad 5,
 * filas de 3 módulos de alto y zona de silencio. Codifica los bytes de `tedXml` tal
 * cual (texto `latin1`, un carácter por byte).
 */
export async function pngPdf417(tedXml: string, opciones: OpcionesPdf417 = {}): Promise<Buffer> {
  validarTed(tedXml);
  const opcionesBwip: OpcionesBwipPdf417 = {
    bcid: 'pdf417',
    text: tedXml,
    binarytext: true,
    eclevel: NIVEL_SEGURIDAD,
    rowmult: MODULOS_POR_FILA,
    ...(opciones.columnas ? { columns: opciones.columnas } : {}),
    scale: opciones.escala ?? PIXELES_POR_MODULO,
    padding: ZONA_SILENCIO,
    backgroundcolor: 'FFFFFF',
  };
  return bwipjs.toBuffer(opcionesBwip);
}

/** Opciones propias del PDF417 de BWIPP, que los tipos de bwip-js no declaran. */
type OpcionesBwipPdf417 = bwipjs.RenderOptions & {
  eclevel: number;
  rowmult: number;
  columns?: number;
};

/** Ancho y alto en píxeles de un PNG (cabecera IHDR). */
export function dimensionesPng(png: Buffer): { ancho: number; alto: number } {
  return { ancho: png.readUInt32BE(16), alto: png.readUInt32BE(20) };
}

export interface TimbreImpreso {
  png: Buffer;
  /** Tamaño con que se dibuja en el PDF, en puntos. */
  anchoPt: number;
  altoPt: number;
  /** Dimensión X resultante, en milímetros (≥ 0,17). */
  moduloMm: number;
  columnas: number;
}

/**
 * El PDF417 del TED al mayor tamaño que cabe en el área (por defecto, el máximo del SII:
 * 4 × 9 cm), probando entre 10 y 18 columnas. El módulo queda entero en píxeles del PNG y
 * la imagen se escala completa (sin deformarla), así que la proporción Y:X se mantiene.
 * Lanza si ni así se llega a la dimensión X mínima.
 */
export async function timbreParaArea(
  tedXml: string,
  area: { anchoPt: number; altoPt: number } = AREA_MAXIMA_TIMBRE,
): Promise<TimbreImpreso> {
  validarTed(tedXml);
  let mejor: { columnas: number; puntosPorModulo: number } | undefined;
  for (const columnas of COLUMNAS_POSIBLES) {
    const { ancho, alto } = dimensionesPng(await pngPdf417(tedXml, { columnas, escala: 1 }));
    const puntosPorModulo = Math.min(area.anchoPt / ancho, area.altoPt / alto);
    if (!mejor || puntosPorModulo > mejor.puntosPorModulo) mejor = { columnas, puntosPorModulo };
  }
  if (!mejor || mejor.puntosPorModulo / PUNTOS_POR_MM < MODULO_MINIMO_MM) {
    throw new Error('El TED no cabe en el área del timbre con el módulo mínimo del SII.');
  }
  const png = await pngPdf417(tedXml, { columnas: mejor.columnas });
  const { ancho, alto } = dimensionesPng(png);
  const puntosPorPixel = mejor.puntosPorModulo / PIXELES_POR_MODULO;
  return {
    png,
    anchoPt: ancho * puntosPorPixel,
    altoPt: alto * puntosPorPixel,
    moduloMm: mejor.puntosPorModulo / PUNTOS_POR_MM,
    columnas: mejor.columnas,
  };
}
