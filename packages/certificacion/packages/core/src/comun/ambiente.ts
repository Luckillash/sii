// Deriva de winex/certificacion v1.9.1 (src/Folios/Ambiente.php),
// © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a TypeScript.

/**
 * Ambiente del SII.
 *
 * Es un parámetro obligatorio y no un string configurable a propósito: cada app
 * fija el suyo en código. Timbrar en el ambiente equivocado gasta folios reales o
 * deja al cliente con un CAF que no sirve.
 */
export type Ambiente = 'certificacion' | 'produccion';

export const AMBIENTES: readonly Ambiente[] = ['certificacion', 'produccion'];

export interface DatosAmbiente {
  /** Host del asistente de timbraje (cvc_cgi/dte). */
  readonly host: string;
  /** `https://` + host. */
  readonly portal: string;
  /**
   * IDK que trae el `<DA>` de los CAF de este ambiente. Sirve de candado: un CAF
   * con otro IDK salió del ambiente equivocado.
   */
  readonly idk: string;
}

const DATOS: Readonly<Record<Ambiente, DatosAmbiente>> = Object.freeze({
  certificacion: Object.freeze({
    host: 'maullin.sii.cl',
    portal: 'https://maullin.sii.cl',
    idk: '100',
  }),
  produccion: Object.freeze({
    host: 'palena.sii.cl',
    portal: 'https://palena.sii.cl',
    idk: '300',
  }),
});

export function esAmbiente(valor: unknown): valor is Ambiente {
  return valor === 'certificacion' || valor === 'produccion';
}

/** Host, portal e IDK del ambiente. Lanza si `ambiente` no es válido (p. ej. viene de JS sin tipos). */
export function datosAmbiente(ambiente: Ambiente): DatosAmbiente {
  if (!esAmbiente(ambiente)) {
    throw new TypeError(`Ambiente desconocido: ${String(ambiente)}`);
  }
  return DATOS[ambiente];
}
