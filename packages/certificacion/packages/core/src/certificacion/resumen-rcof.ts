// Resumen del RCOF a partir de los DTE emitidos (nuevo en el port: el bin
// enviar-consumo-folios.php de winex/certificacion v1.9.1 trae los montos y el
// rango de folios escritos a mano, pend. 5).
//
// Las cuentas dan lo mismo que la fórmula del bin (neto = round(bruto / 1,19)
// e IVA = bruto − neto por boleta, sumados), porque GeneradorBoleta escribe en
// cada DTE exactamente esos montos: golden test paridad/casos/rcof-set-completo.
//
// El RCOF ya no es obligatorio desde el 2022-08-01 (solo para períodos hasta julio de
// 2022): ver consumo-folios.ts.

import { ErrorValidacion } from '../comun/errores.ts';
import { parsearDocumento } from '../comun/xml.ts';
import type { RangoFolios, ResumenRcof } from './consumo-folios.ts';

/** Lo que `resumirParaRcof` saca de los DTE. */
export interface ResumenDtes {
  /**
   * Un `ResumenRcof` por tipo de documento, en orden numérico de tipo (39
   * antes que 41). Sin folios anulados: `foliosEmitidos` = `foliosUtilizados`
   * = cantidad de documentos.
   */
  resumenes: ResumenRcof[];
  /** Menor `<FchEmis>` (para `fchInicio` de la carátula). */
  fchInicio: string;
  /** Mayor `<FchEmis>` (para `fchFinal`; el SII espera un RCOF por día). */
  fchFinal: string;
}

const ENTERO = /^[0-9]+$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

interface Acumulado {
  tipo: string;
  neto: number;
  iva: number;
  exento: number;
  total: number;
  folios: number[];
}

/**
 * Arma los resúmenes del RCOF desde los DTE generados: suma `<MntNeto>`,
 * `<IVA>`, `<MntExe>` y `<MntTotal>` por `<TipoDTE>` (un monto ausente cuenta
 * como 0) y agrupa los folios en rangos consecutivos.
 *
 * ```ts
 * const { resumenes, fchInicio, fchFinal } = resumirParaRcof(dtes);
 * const rcof = new GeneradorConsumoFolios().generar(
 *   { rutEmisor, rutEnvia, fchResol, nroResol, fchInicio, fchFinal, secEnvio: 1 },
 *   resumenes,
 * );
 * ```
 *
 * @param dtes DTE en bytes (lo que devuelve `ArmadorBoleta.armar`) o texto.
 *   Se lee cada `<Documento>` que traigan, así que también sirve un sobre
 *   `EnvioBOLETA` completo.
 * @throws {ErrorValidacion} si no hay documentos, a uno le falta `<TipoDTE>`,
 *   `<Folio>` o `<FchEmis>`, un monto o folio no es un entero no negativo, o un
 *   folio se repite dentro del mismo tipo.
 */
export function resumirParaRcof(dtes: readonly (Buffer | Uint8Array | string)[]): ResumenDtes {
  const porTipo = new Map<string, Acumulado>();
  const fechas: string[] = [];

  for (const dte of dtes) {
    const documentos = parsearDocumento(dte).getElementsByTagName('Documento');
    for (let i = 0; i < documentos.length; i++) {
      const documento = documentos.item(i);
      if (documento === null) continue;

      const tipo = String(entero(documento, 'TipoDTE', true));
      const folio = entero(documento, 'Folio', true);
      const fecha = textoDe(documento, 'FchEmis');
      if (fecha === undefined || !FECHA.test(fecha)) {
        throw new ErrorValidacion(`El DTE ${tipo}/${folio} no trae una <FchEmis> válida.`);
      }
      fechas.push(fecha);

      let acumulado = porTipo.get(tipo);
      if (acumulado === undefined) {
        acumulado = { tipo, neto: 0, iva: 0, exento: 0, total: 0, folios: [] };
        porTipo.set(tipo, acumulado);
      }
      if (acumulado.folios.includes(folio)) {
        throw new ErrorValidacion(`El folio ${folio} del tipo ${tipo} está repetido.`);
      }
      acumulado.folios.push(folio);
      acumulado.neto += entero(documento, 'MntNeto');
      acumulado.iva += entero(documento, 'IVA');
      acumulado.exento += entero(documento, 'MntExe');
      acumulado.total += entero(documento, 'MntTotal');
    }
  }

  if (fechas.length === 0) throw new ErrorValidacion('No hay documentos que resumir.');
  fechas.sort();

  const resumenes = [...porTipo.values()]
    .sort((a, b) => Number(a.tipo) - Number(b.tipo))
    .map(
      (a): ResumenRcof => ({
        tipo: a.tipo,
        neto: a.neto,
        iva: a.iva,
        exento: a.exento,
        total: a.total,
        foliosEmitidos: a.folios.length,
        foliosAnulados: 0,
        foliosUtilizados: a.folios.length,
        rangosUtilizados: rangosConsecutivos(a.folios),
        rangosAnulados: [],
      }),
    );

  return {
    resumenes,
    fchInicio: fechas[0] as string,
    fchFinal: fechas[fechas.length - 1] as string,
  };
}

/** Folios en rangos consecutivos, de menor a mayor: `[56, 57, 59]` → `56–57`, `59–59`. */
export function rangosConsecutivos(folios: readonly number[]): RangoFolios[] {
  const ordenados = [...folios].sort((a, b) => a - b);
  const rangos: RangoFolios[] = [];
  for (const folio of ordenados) {
    const ultimo = rangos.at(-1);
    if (ultimo !== undefined && folio === ultimo.final + 1) ultimo.final = folio;
    else if (ultimo === undefined || folio !== ultimo.final)
      rangos.push({ inicial: folio, final: folio });
  }
  return rangos;
}

/** Texto del primer `<etiqueta>` dentro del documento, o `undefined` si no está. */
function textoDe(documento: Element, etiqueta: string): string | undefined {
  const nodo = documento.getElementsByTagName(etiqueta).item(0);
  return nodo === null ? undefined : (nodo.textContent ?? '');
}

/** Entero no negativo de `<etiqueta>`; si falta, 0 (o error si es obligatorio). */
function entero(documento: Element, etiqueta: string, obligatorio = false): number {
  const valor = textoDe(documento, etiqueta);
  if (valor === undefined) {
    if (obligatorio) throw new ErrorValidacion(`Un DTE no trae <${etiqueta}>.`);
    return 0;
  }
  const numero = Number(valor);
  if (!ENTERO.test(valor) || !Number.isSafeInteger(numero)) {
    throw new ErrorValidacion(`<${etiqueta}> debe ser un entero no negativo (se leyó ${valor}).`);
  }
  return numero;
}
