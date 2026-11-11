// Todo lo que la CLI toma del mundo exterior, inyectable para los tests.

import {
  type Reloj,
  relojSistema,
  type TransporteHttp,
  TransporteUndici,
} from '@winex/certificacion';

export interface Contexto {
  /** Carpeta contra la que se resuelven las rutas relativas de los argumentos y el `.env`. */
  readonly cwd: string;
  /** Variables del entorno del proceso. Ganan sobre las del archivo `.env`. */
  readonly entorno: Readonly<Record<string, string | undefined>>;
  /** Reloj de las marcas de tiempo (boletas, nombres de archivo). */
  readonly reloj: Reloj;
  /** Escribe una línea en la salida estándar (agrega el salto de línea). */
  readonly imprimir: (linea: string) => void;
  /** Escribe una línea en la salida de errores (agrega el salto de línea). */
  readonly imprimirError: (linea: string) => void;
  /**
   * Transporte HTTP de toda la ejecución. Se crea al primer uso y se cierra al
   * terminar. En los tests es un `TransporteFalso`: nunca sale a la red.
   */
  readonly transporte: () => TransporteHttp;
}

/** Contexto real: proceso, consola, reloj del sistema y undici. */
export function contextoDelProceso(): Contexto & AsyncDisposable {
  let transporte: TransporteUndici | undefined;
  return {
    cwd: process.cwd(),
    entorno: process.env,
    reloj: relojSistema,
    imprimir: (linea) => process.stdout.write(`${linea}\n`),
    imprimirError: (linea) => process.stderr.write(`${linea}\n`),
    transporte: () => {
      transporte ??= new TransporteUndici();
      return transporte;
    },
    [Symbol.asyncDispose]: async () => {
      await transporte?.[Symbol.asyncDispose]();
    },
  };
}
