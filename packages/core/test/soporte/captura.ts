// Soporte para la paridad de requests HTTP (PLAN-MIGRACION.md §5.3).
//
// Levanta en el mismo proceso el servidor de captura que usa `pnpm
// paridad:generar` para el PHP (paridad/http/servidor-captura.mjs) y normaliza lo
// grabado con las MISMAS reglas: el resultado se compara con `exigirIdentico`
// contra paridad/esperados/<caso>.bin. Uso, en un test de test/paridad/:
//
//   const captura = usarServidorCaptura();
//
//   for (const caso of casos<Entrada>('miOperacionHttp')) {
//     it(caso.nombre, async () => {
//       const { peticiones } = await captura.ejecutar(caso.entrada.http, ({ origenes, transporte }) =>
//         cliente(transporte, origenes.https).hacerAlgo(),
//       );
//       exigirIdentico(peticiones, esperado(caso.nombre).bytes, caso.nombre);
//     });
//   }

import { afterAll, beforeAll } from 'vitest';
import {
  type CasoHttp,
  iniciarServidorCaptura,
  type Origen,
  type ServidorCaptura,
} from '../../../../paridad/http/servidor-captura.mjs';
import { TransporteUndici } from '../../src/comun/http/transporte-undici.ts';

export type { CasoHttp, Origen } from '../../../../paridad/http/servidor-captura.mjs';

export interface ContextoCaptura {
  /** URLs base sin `/` final de cada origen (ver servidor-captura.mjs). */
  readonly origenes: Readonly<Record<Origen, string>>;
  /** Transporte real que confía en la CA de prueba y acepta `http:`. Se cierra al terminar. */
  readonly transporte: TransporteUndici;
  /** PEM de la CA de prueba (para armar otro transporte si hace falta). */
  readonly ca: string;
}

export interface ResultadoCaptura<T> {
  /** Peticiones grabadas, normalizadas: se comparan con el esperado del PHP. */
  readonly peticiones: Buffer;
  /** Lo que devolvió la función (p. ej. el trackId que el cliente leyó de la respuesta). */
  readonly resultado: T;
}

export interface CapturaHttp {
  /**
   * Carga el caso HTTP (respuestas grabadas y normalización), ejecuta `funcion` con
   * un transporte nuevo (el PHP abre una conexión por petición) y devuelve las
   * peticiones normalizadas. Si `funcion` lanza, el error sigue de largo; para
   * comparar un camino de error, capturarlo dentro de `funcion`.
   */
  ejecutar<T>(
    caso: CasoHttp | undefined,
    funcion: (contexto: ContextoCaptura) => Promise<T> | T,
  ): Promise<ResultadoCaptura<T>>;
  /** El servidor, para lo que `ejecutar` no cubra (capturas crudas, etc.). */
  readonly servidor: ServidorCaptura;
}

/**
 * Registra `beforeAll`/`afterAll` que levantan y cierran un servidor de captura
 * para el archivo de test. Llamar en el nivel superior del archivo (o de un
 * `describe`). Los casos de un mismo archivo corren en serie, así que comparten el
 * servidor sin mezclar capturas.
 */
export function usarServidorCaptura(): CapturaHttp {
  let servidor: ServidorCaptura | undefined;

  beforeAll(async () => {
    servidor = await iniciarServidorCaptura();
  });
  afterAll(async () => {
    await servidor?.cerrar();
  });

  const activo = (): ServidorCaptura => {
    if (servidor === undefined) {
      throw new Error('El servidor de captura no está levantado (¿se usó fuera de un test?).');
    }
    return servidor;
  };

  return {
    get servidor() {
      return activo();
    },
    async ejecutar(caso, funcion) {
      const s = activo();
      s.cargarCaso(caso ?? {});
      const transporte = new TransporteUndici({ ca: s.ca, permitirHttp: true });
      try {
        const resultado = await funcion({ origenes: s.origenes, transporte, ca: s.ca });
        return { peticiones: s.normalizado(), resultado };
      } finally {
        await transporte.close();
      }
    },
  };
}

/**
 * Cabeceras de un caso escritas como `CURLOPT_HTTPHEADER` ("Nombre: valor") a un
 * objeto para `PeticionHttp.cabeceras`, con la semántica de cURL: "Nombre:" sin
 * valor QUITA esa cabecera (p. ej. "Expect:"), así que no se envía. Antepone
 * `Accept: *\/*`, que cURL agrega siempre (undici no).
 */
export function cabecerasComoCurl(lineas: readonly string[] = []): Record<string, string> {
  const salida: Record<string, string> = { Accept: '*/*' };
  for (const linea of lineas) {
    const dos = linea.indexOf(':');
    if (dos <= 0) throw new Error(`Cabecera sin ':': ${linea}`);
    const nombre = linea.slice(0, dos).trim();
    const valor = linea.slice(dos + 1).trim();
    for (const existente of Object.keys(salida)) {
      if (existente.toLowerCase() === nombre.toLowerCase()) delete salida[existente];
    }
    if (valor !== '') salida[nombre] = valor;
  }
  return salida;
}
