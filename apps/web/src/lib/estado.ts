// Estado del servicio para la página pública `/estado` (PLAN-SAAS Fase 12). Puro: decide
// el nivel de cada fila a partir de agregados (conteos y fechas) que lee
// `server/estado/`. Nunca recibe ids, organizaciones, mensajes ni errores.

export type NivelEstado = 'operativo' | 'demoras' | 'problemas' | 'sin_datos';

export type AmbienteEstado = 'certificacion' | 'produccion';

export const ETIQUETA_NIVEL: Readonly<Record<NivelEstado, string>> = {
  operativo: 'Operativo',
  demoras: 'Con demoras',
  problemas: 'Con problemas',
  sin_datos: 'Sin datos',
};

/** Tono del design system para cada nivel. */
export const TONO_NIVEL: Readonly<Record<NivelEstado, 'exito' | 'aviso' | 'error' | 'neutro'>> = {
  operativo: 'exito',
  demoras: 'aviso',
  problemas: 'error',
  sin_datos: 'neutro',
};

export const ETIQUETA_AMBIENTE: Readonly<Record<AmbienteEstado, string>> = {
  certificacion: 'Certificación',
  produccion: 'Producción',
};

// --- Umbrales ---------------------------------------------------------------------

/** Ventana en la que se miran las operaciones con el SII. */
export const VENTANA_SII_MINUTOS = 60;

/** Proporción de fallas de conexión desde la que el SII queda «Con demoras». */
export const PROPORCION_DEMORAS_SII = 0.1;

/** Proporción de fallas desde la que queda «Con problemas» (con al menos `MIN_FALLAS_PROBLEMAS`). */
export const PROPORCION_PROBLEMAS_SII = 0.5;

/** Fallas mínimas para «Con problemas»: una o dos fallas sueltas no bastan. */
export const MIN_FALLAS_PROBLEMAS = 3;

/** Latencia de la lectura de prueba desde la que la base queda «Con demoras». */
export const LATENCIA_DEMORAS_MS = 1500;

/**
 * Un envío con Track ID que lleva más de estos minutos sin su primera consulta está
 * atrasado: el seguimiento corre cada 5 minutos y consulta primero los nunca consultados.
 * Un atrasado solo no basta para marcar la fila: puede ser de un cliente puntual (por
 * ejemplo, con el certificado vencido). Ver `nivelSeguimiento`.
 */
export const MINUTOS_ATRASO_SEGUIMIENTO = 15;

/** Solo cuentan los envíos de las últimas horas (uno más antiguo no describe el presente). */
export const HORAS_VENTANA_SEGUIMIENTO = 24;

/**
 * Con envíos atrasados, si la última corrida del seguimiento terminada con `ok` es más
 * antigua que esto, el seguimiento no está funcionando para nadie.
 */
export const MINUTOS_CORRIDA_VIGENTE = 60;

// --- Filas ------------------------------------------------------------------------

export interface FilaEstado {
  nivel: NivelEstado;
  /** Una frase que explica el nivel, sin datos de ninguna organización. */
  detalle: string;
}

/** Lectura de prueba de la base: `null` si no se pudo intentar (configuración). */
export interface MedicionBaseDatos {
  ok: boolean;
  ms: number;
}

export function estadoBaseDatos(medicion: MedicionBaseDatos | null): FilaEstado {
  if (!medicion) {
    return { nivel: 'sin_datos', detalle: 'No pudimos medir la base de datos en este momento.' };
  }
  if (!medicion.ok) {
    return {
      nivel: 'problemas',
      detalle: 'La base de datos no respondió a la lectura de prueba.',
    };
  }
  if (medicion.ms >= LATENCIA_DEMORAS_MS) {
    return {
      nivel: 'demoras',
      detalle: 'La base de datos responde, pero más lento de lo normal.',
    };
  }
  return { nivel: 'operativo', detalle: 'La base de datos responde con normalidad.' };
}

/**
 * Operaciones con el SII de un ambiente en la ventana. `respondidas`: el SII contestó
 * (`ok` o `rechazo_sii`, códigos 0 y 5). `fallas`: no hubo respuesta o se cortó
 * (`transporte` e `incierto`, códigos 4 y 6). Los errores de datos, uso o configuración
 * (1, 2, 3) y la verificación del portal (7) no dicen nada de la conexión y no cuentan.
 */
export interface ConteoSii {
  respondidas: number;
  fallas: number;
}

export function nivelSii(conteo: ConteoSii | null): NivelEstado {
  if (!conteo) return 'sin_datos';
  const respondidas = Math.max(0, conteo.respondidas);
  const fallas = Math.max(0, conteo.fallas);
  const total = respondidas + fallas;
  if (total === 0) return 'sin_datos';
  if (fallas === 0) return 'operativo';
  const proporcion = fallas / total;
  if (fallas >= MIN_FALLAS_PROBLEMAS && proporcion >= PROPORCION_PROBLEMAS_SII) return 'problemas';
  if (proporcion >= PROPORCION_DEMORAS_SII) return 'demoras';
  return 'operativo';
}

/** Frase neutra de «Sin datos»: no distingue una lectura fallida de una hora sin actividad. */
export const SIN_MEDICIONES = 'Sin mediciones recientes.';

/**
 * Fila del SII de un ambiente. Muestra solo el nivel: la frase es fija por nivel y no
 * dice si hubo operaciones, cuántas ni cuándo (la página es pública y no debe revelar la
 * actividad de los clientes).
 */
export function estadoSii(conteo: ConteoSii | null): FilaEstado {
  const nivel = nivelSii(conteo);
  switch (nivel) {
    case 'sin_datos':
      return { nivel, detalle: SIN_MEDICIONES };
    case 'operativo':
      return { nivel, detalle: 'La conexión con el SII funciona con normalidad.' };
    case 'demoras':
      return {
        nivel,
        detalle:
          'Parte de las conexiones con el SII están fallando. Los envíos y consultas pueden tardar más.',
      };
    case 'problemas':
      return {
        nivel,
        detalle:
          'La mayoría de las conexiones con el SII están fallando. Los envíos se pueden demorar o quedar por verificar.',
      };
  }
}

/** Agregados del seguimiento automático de envíos. */
export interface MedicionSeguimiento {
  /** Envíos con Track ID sin ninguna consulta, enviados hace más de `MINUTOS_ATRASO_SEGUIMIENTO`. */
  atrasados: number;
  /** Término de la última corrida del seguimiento con resultado `ok`, o `null` si no hay. */
  ultimaCorridaOk: Date | null;
}

/**
 * Salud del seguimiento automático. Se mide por el cron, no por los envíos de un cliente:
 *
 * - sin envíos atrasados → «Operativo»;
 * - con atrasados y alguna corrida `ok` en los últimos `MINUTOS_CORRIDA_VIGENTE` →
 *   «Operativo» (el cron funciona; los atrasados son de clientes puntuales, por ejemplo
 *   con el certificado vencido, y se ven en su propio panel);
 * - con atrasados y ninguna corrida `ok` reciente → «Con problemas».
 */
export function nivelSeguimiento(
  medicion: MedicionSeguimiento | null,
  ahora: Date = new Date(),
): NivelEstado {
  if (!medicion) return 'sin_datos';
  if (medicion.atrasados <= 0) return 'operativo';
  const corrida = medicion.ultimaCorridaOk?.getTime();
  if (corrida === undefined || Number.isNaN(corrida)) return 'problemas';
  const minutos = (ahora.getTime() - corrida) / 60_000;
  return minutos > MINUTOS_CORRIDA_VIGENTE ? 'problemas' : 'operativo';
}

export function estadoSeguimiento(
  medicion: MedicionSeguimiento | null,
  ahora: Date = new Date(),
): FilaEstado {
  const nivel = nivelSeguimiento(medicion, ahora);
  switch (nivel) {
    case 'sin_datos':
      return { nivel, detalle: SIN_MEDICIONES };
    case 'problemas':
      return {
        nivel,
        detalle:
          'El seguimiento automático no está consultando los envíos en el SII. El estado de tus boletas puede no estar actualizándose.',
      };
    default:
      return {
        nivel: 'operativo',
        detalle: 'Los envíos nuevos se consultan en el SII a los pocos minutos.',
      };
  }
}

const GRAVEDAD: Readonly<Record<NivelEstado, number>> = {
  sin_datos: 0,
  operativo: 1,
  demoras: 2,
  problemas: 3,
};

/** El peor nivel entre las filas medidas. «Sin datos» solo si ninguna tiene datos. */
export function nivelGeneral(niveles: readonly NivelEstado[]): NivelEstado {
  let peor: NivelEstado = 'sin_datos';
  for (const nivel of niveles) {
    if (GRAVEDAD[nivel] > GRAVEDAD[peor]) peor = nivel;
  }
  return peor;
}

/**
 * Nivel del resumen de la página. La fila Plataforma no cuenta (siempre es «Operativo»:
 * si la página se generó, el sitio responde). Si no se pudo medir la base, el resumen
 * nunca es «Operativo» («Todo funciona con normalidad»): queda en «Sin datos», salvo que
 * otra fila muestre demoras o problemas.
 */
export function nivelResumen(baseDatos: NivelEstado, otras: readonly NivelEstado[]): NivelEstado {
  const peor = nivelGeneral([baseDatos, ...otras]);
  return baseDatos === 'sin_datos' && peor === 'operativo' ? 'sin_datos' : peor;
}

export const RESUMEN_GENERAL: Readonly<Record<NivelEstado, string>> = {
  operativo: 'Todo funciona con normalidad.',
  demoras: 'Hay demoras en parte del servicio.',
  problemas: 'Hay problemas en parte del servicio.',
  sin_datos: 'Sin datos: no pudimos medir el estado del servicio en este momento.',
};
