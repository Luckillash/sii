// Reloj inyectable y formato de fechas en la hora de Chile.
//
// El PHP estampa la hora con date() y la zona del proceso (FchEmis, TSTED,
// TmstFirma, TmstFirmaEnv). Aquí todo pasa por un `Reloj` (para tests
// deterministas y paridad, PLAN-MIGRACION.md §5.1) y se formatea siempre en
// America/Santiago, sin depender de la zona del servidor (pend. 6.2 / 6.4).

export const ZONA_SII = 'America/Santiago';

export interface Reloj {
  ahora(): Date;
}

/** Reloj real del sistema. */
export const relojSistema: Reloj = Object.freeze({ ahora: () => new Date() });

/** Reloj detenido en un instante (tests). */
export function relojFijo(instante: Date | string | number): Reloj {
  const ms = new Date(instante).getTime();
  if (Number.isNaN(ms)) {
    throw new TypeError(`Instante inválido: ${String(instante)}`);
  }
  return Object.freeze({ ahora: () => new Date(ms) });
}

interface PartesFecha {
  anio: string;
  mes: string;
  dia: string;
  hora: string;
  minuto: string;
  segundo: string;
}

const formateador = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONA_SII,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function partes(instante: Date): PartesFecha {
  if (Number.isNaN(instante.getTime())) {
    throw new TypeError('Fecha inválida');
  }
  const p: Record<string, string> = {};
  for (const { type, value } of formateador.formatToParts(instante)) p[type] = value;
  return {
    anio: (p.year ?? '').padStart(4, '0'),
    mes: p.month ?? '',
    dia: p.day ?? '',
    hora: p.hour ?? '',
    minuto: p.minute ?? '',
    segundo: p.second ?? '',
  };
}

/** `YYYY-MM-DD` en hora de Chile (como `date('Y-m-d')`): FchEmis, FchResol... */
export function fechaSii(instante: Date): string {
  const p = partes(instante);
  return `${p.anio}-${p.mes}-${p.dia}`;
}

/** `YYYY-MM-DDTHH:MM:SS` en hora de Chile (como `date('Y-m-d\TH:i:s')`): TSTED, TmstFirma... */
export function fechaHoraSii(instante: Date): string {
  const p = partes(instante);
  return `${p.anio}-${p.mes}-${p.dia}T${p.hora}:${p.minuto}:${p.segundo}`;
}

const MARCA = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2}))?$/;

/**
 * Instante que corresponde a una marca de hora de Chile (`YYYY-MM-DD` o
 * `YYYY-MM-DDTHH:MM:SS`). Es el inverso de `fechaHoraSii`: sirve para inyectar
 * en Node las marcas que extrae el generador de paridad del PHP.
 *
 * En el cambio de hora de otoño una misma hora local ocurre dos veces; se
 * devuelve la primera. Una hora que no existe (salto de primavera) lanza.
 */
export function instanteSii(marca: string): Date {
  const m = MARCA.exec(marca);
  if (m === null) {
    throw new TypeError(`Marca de hora inválida: ${marca}`);
  }
  const [anio, mes, dia, hora = '00', minuto = '00', segundo = '00'] = m.slice(1);
  const comoUtc = Date.UTC(
    Number(anio),
    Number(mes) - 1,
    Number(dia),
    Number(hora),
    Number(minuto),
    Number(segundo),
  );
  const objetivo = m[4] === undefined ? `${anio}-${mes}-${dia}` : marca;
  const formatear = m[4] === undefined ? fechaSii : fechaHoraSii;

  // Chile continental usa UTC-4 o UTC-3. Se prueban desfases enteros con margen,
  // de menor a mayor (= del instante más temprano al más tardío), y se toma el
  // primero que calce.
  for (let horas = 2; horas <= 6; horas++) {
    const candidato = new Date(comoUtc + horas * 3_600_000);
    if (formatear(candidato) === objetivo) return candidato;
  }
  throw new RangeError(`La hora ${marca} no existe en ${ZONA_SII} (cambio de hora).`);
}
