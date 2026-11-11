// Deriva de winex/certificacion v1.9.1 (src/Certificacion/GeneradorConsumoFolios.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript,
// hora inyectable y entradas tipadas y validadas (pend. 6.4).
//
// Reporte de Consumo de Folios (RCOF, `ConsumoFolios`) de las boletas. La salida
// es byte a byte la del PHP (golden tests paridad/casos/rcof-*). Se firma aparte,
// con `FirmaElectronica.firmarDte(rcof, '#RCOF')`.
//
// El SII eliminó la obligación de enviar el RCOF (hoy "Resumen de Ventas Diarias") a
// partir del 1 de agosto de 2022; sigue solo para períodos hasta julio de 2022. Se
// conserva por paridad con el PHP y para esos períodos (PLAN-MIGRACION.md §1).

import { ErrorValidacion } from '../comun/errores.ts';
import { fechaHoraSii, type Reloj, relojSistema } from '../comun/reloj.ts';
import { crearDocumento, crearElemento, fijarAtributo, serializarXml } from '../comun/xml.ts';

/**
 * `<Caratula>` del RCOF. Equivale al array `$caratula` del PHP (`rut_emisor`,
 * `rut_envia`, ...).
 *
 * Los textos se insertan sin escapar, como el PHP (pasan por `createElement`,
 * que interpreta las referencias `&...;`). Los números se escriben en decimal.
 */
export interface CaratulaRcof {
  /** `<RutEmisor>`: RUT de la empresa (`76123456-0`). */
  rutEmisor: string;
  /** `<RutEnvia>`: RUT de la persona dueña del certificado que firma. */
  rutEnvia: string;
  /** `<FchResol>`: fecha de resolución `YYYY-MM-DD`. */
  fchResol: string;
  /** `<NroResol>`: número de resolución (`0` en certificación). */
  nroResol: string | number;
  /** `<FchInicio>`: primer día informado `YYYY-MM-DD`. */
  fchInicio: string;
  /** `<FchFinal>`: último día informado `YYYY-MM-DD`. */
  fchFinal: string;
  /** `<SecEnvio>`: secuencia del envío para el mismo período (1, 2, ...). */
  secEnvio: number;
}

/** Rango de folios `[inicial, final]` (`<RangoUtilizados>` / `<RangoAnulados>`). */
export interface RangoFolios {
  inicial: number;
  final: number;
}

/**
 * Un `<Resumen>` por tipo de documento. Equivale a cada elemento de `$resumenes`
 * del PHP (`tipo`, `neto`, `iva`, `tasa_iva`, ...).
 *
 * Montos, cantidades y folios son enteros no negativos.
 */
export interface ResumenRcof {
  /** `<TipoDocumento>`: 39 (boleta afecta), 41 (boleta exenta)... */
  tipo: string | number;
  /** `<MntNeto>`: se omite si es 0. */
  neto: number;
  /** `<MntIva>` y `<TasaIVA>`: se omiten si el IVA es 0. */
  iva: number;
  /** `<TasaIVA>`, tal cual (p. ej. `'19.00'`). Solo se escribe si `iva > 0`. Por defecto `'19.00'`. */
  tasaIva?: string;
  /** `<MntExento>`: se omite si es 0. */
  exento: number;
  /** `<MntTotal>`. */
  total: number;
  /** `<FoliosEmitidos>`. */
  foliosEmitidos: number;
  /** `<FoliosAnulados>`. */
  foliosAnulados: number;
  /** `<FoliosUtilizados>`. */
  foliosUtilizados: number;
  /** Un `<RangoUtilizados>` por rango, en este orden. */
  rangosUtilizados: readonly RangoFolios[];
  /** Un `<RangoAnulados>` por rango, después de los utilizados. */
  rangosAnulados?: readonly RangoFolios[];
}

export interface OpcionesConsumoFolios {
  /** Reloj para el `<TmstFirmaEnv>` (hora de Chile). Por defecto, el del sistema. */
  reloj?: Reloj;
}

const TASA_IVA = '19.00';

/**
 * Genera el XML del RCOF (sin firmar).
 *
 * ```ts
 * const rcof = new GeneradorConsumoFolios().generar(caratula, [resumen39, resumen41]);
 * const firmado = firmador.firmarDte(rcof, '#RCOF');
 * ```
 */
export class GeneradorConsumoFolios {
  readonly #reloj: Reloj;

  constructor(opciones: OpcionesConsumoFolios = {}) {
    this.#reloj = opciones.reloj ?? relojSistema;
  }

  /**
   * @returns el `ConsumoFolios` formateado, en bytes ISO-8859-1, con la
   *   declaración y el salto de línea final (como `saveXML()` del PHP).
   * @throws {ErrorValidacion} si un monto, cantidad, folio o `secEnvio` no es un
   *   entero no negativo.
   */
  generar(caratula: CaratulaRcof, resumenes: readonly ResumenRcof[]): Buffer {
    // Se valida todo antes de armar: no hay salida parcial.
    entero(caratula.secEnvio, 'secEnvio');
    for (const r of resumenes) validarResumen(r);

    const doc = crearDocumento('1.0', 'ISO-8859-1');
    const el = (nombre: string, valor = '') => crearElemento(doc, nombre, valor);

    const consumoFolios = el('ConsumoFolios');
    fijarAtributo(consumoFolios, 'xmlns', 'http://www.sii.cl/SiiDte');
    fijarAtributo(consumoFolios, 'xmlns:xsi', 'http://www.w3.org/2001/XMLSchema-instance');
    fijarAtributo(
      consumoFolios,
      'xsi:schemaLocation',
      'http://www.sii.cl/SiiDte ConsumoFolio_v10.xsd',
    );
    fijarAtributo(consumoFolios, 'version', '1.0');
    doc.appendChild(consumoFolios);

    const documento = el('DocumentoConsumoFolios');
    fijarAtributo(documento, 'ID', 'RCOF');
    consumoFolios.appendChild(documento);

    const nodoCaratula = el('Caratula');
    fijarAtributo(nodoCaratula, 'version', '1.0');
    nodoCaratula.appendChild(el('RutEmisor', caratula.rutEmisor));
    nodoCaratula.appendChild(el('RutEnvia', caratula.rutEnvia));
    nodoCaratula.appendChild(el('FchResol', caratula.fchResol));
    nodoCaratula.appendChild(el('NroResol', String(caratula.nroResol)));
    nodoCaratula.appendChild(el('FchInicio', caratula.fchInicio));
    nodoCaratula.appendChild(el('FchFinal', caratula.fchFinal));
    nodoCaratula.appendChild(el('SecEnvio', String(caratula.secEnvio)));
    nodoCaratula.appendChild(el('TmstFirmaEnv', fechaHoraSii(this.#reloj.ahora())));
    documento.appendChild(nodoCaratula);

    for (const r of resumenes) {
      const resumen = el('Resumen');
      resumen.appendChild(el('TipoDocumento', String(r.tipo)));

      if (r.neto > 0) resumen.appendChild(el('MntNeto', String(r.neto)));
      if (r.iva > 0) {
        resumen.appendChild(el('MntIva', String(r.iva)));
        resumen.appendChild(el('TasaIVA', r.tasaIva ?? TASA_IVA));
      }
      if (r.exento > 0) resumen.appendChild(el('MntExento', String(r.exento)));

      resumen.appendChild(el('MntTotal', String(r.total)));
      resumen.appendChild(el('FoliosEmitidos', String(r.foliosEmitidos)));
      resumen.appendChild(el('FoliosAnulados', String(r.foliosAnulados)));
      resumen.appendChild(el('FoliosUtilizados', String(r.foliosUtilizados)));

      const rangos: [string, readonly RangoFolios[]][] = [
        ['RangoUtilizados', r.rangosUtilizados],
        ['RangoAnulados', r.rangosAnulados ?? []],
      ];
      for (const [nombre, lista] of rangos) {
        for (const rango of lista) {
          const nodo = el(nombre);
          nodo.appendChild(el('Inicial', String(rango.inicial)));
          nodo.appendChild(el('Final', String(rango.final)));
          resumen.appendChild(nodo);
        }
      }

      documento.appendChild(resumen);
    }

    return serializarXml(doc, { formatear: true });
  }
}

function validarResumen(r: ResumenRcof): void {
  const campos = [
    'neto',
    'iva',
    'exento',
    'total',
    'foliosEmitidos',
    'foliosAnulados',
    'foliosUtilizados',
  ] as const;
  for (const campo of campos) entero(r[campo], campo);
  for (const rango of [...r.rangosUtilizados, ...(r.rangosAnulados ?? [])]) {
    entero(rango.inicial, 'inicial');
    entero(rango.final, 'final');
  }
}

/** Entero no negativo: así se escribe en decimal igual que `(string) $int` en PHP. */
function entero(valor: number, campo: string): void {
  if (!Number.isSafeInteger(valor) || valor < 0) {
    throw new ErrorValidacion(
      `RCOF: ${campo} debe ser un entero no negativo (se recibió ${String(valor)}).`,
    );
  }
}
