import 'server-only';
import {
  type AmbienteEstado,
  type ConteoSii,
  estadoBaseDatos,
  estadoSeguimiento,
  estadoSii,
  type FilaEstado,
  HORAS_VENTANA_SEGUIMIENTO,
  type MedicionBaseDatos,
  type MedicionSeguimiento,
  MINUTOS_ATRASO_SEGUIMIENTO,
  type NivelEstado,
  nivelResumen,
  VENTANA_SII_MINUTOS,
} from '@/lib/estado';
import { type ClienteServicio, clienteServicio } from '../supabase/service';

// Lectura del estado del servicio para la página pública `/estado` (PLAN-SAAS Fase 12).
//
// Usa service_role porque `operaciones_sii` y `envios` tienen RLS por organización y la
// página no tiene sesión. Por eso este módulo SOLO devuelve niveles y frases fijas: lee
// conteos con `head: true` (sin filas) y una fecha suelta, y no devuelve ni conteos ni
// horas (no revela la actividad de los clientes). Nunca ids, organizaciones, empresas,
// mensajes, detalles ni errores crudos; a los logs va solo el código de error.
//
// Nunca lanza: una consulta que falla deja su fila en «Sin datos» (o, en la base de
// datos, «Con problemas») y el resto de la página se muestra igual.
//
// Sin migraciones: todo sale de columnas que ya existen. `operaciones_sii` no tiene
// índice por fecha sin organización, así que los conteos recorren la tabla; con la
// página revalidada cada 60 s son 7 lecturas por minuto como mucho.

/** Tope de cada lectura: la página no se queda esperando a una base lenta. */
const TIMEOUT_MS = 5000;

const AMBIENTES: readonly AmbienteEstado[] = ['certificacion', 'produccion'];

/** El SII contestó: códigos 0 y 5. */
const RESULTADOS_RESPONDIDAS = ['ok', 'rechazo_sii'] as const;

/** No hubo respuesta o se cortó: códigos 4 y 6. */
const RESULTADOS_FALLAS = ['transporte', 'incierto'] as const;

export interface FilaSii extends FilaEstado {
  ambiente: AmbienteEstado;
}

export interface EstadoServicio {
  /** Cuándo se midió (ISO). */
  medidoEn: string;
  plataforma: FilaEstado;
  baseDatos: FilaEstado;
  sii: FilaSii[];
  seguimiento: FilaEstado;
  /** Resumen: sin la fila Plataforma y nunca «Operativo» si no se pudo medir la base. */
  general: NivelEstado;
}

interface ErrorConCodigo {
  code?: unknown;
}

function avisar(consulta: string, error: unknown): void {
  // Solo el código (de PostgREST o el nombre del error): nunca el mensaje ni el detalle.
  const codigo =
    error instanceof Error
      ? error.name
      : typeof (error as ErrorConCodigo | null)?.code === 'string'
        ? String((error as ErrorConCodigo).code)
        : 'desconocido';
  console.warn(`estado: lectura fallida (${consulta}, ${codigo})`);
}

function senal(): AbortSignal {
  return AbortSignal.timeout(TIMEOUT_MS);
}

function haceMinutos(ahora: Date, minutos: number): string {
  return new Date(ahora.getTime() - minutos * 60_000).toISOString();
}

/** Un conteo con `head: true`, o `null` si falló. */
async function conteo(
  consulta: string,
  promesa: PromiseLike<{ count: number | null; error: unknown }>,
): Promise<number | null> {
  try {
    const { count, error } = await promesa;
    if (error || typeof count !== 'number') {
      avisar(consulta, error);
      return null;
    }
    return count;
  } catch (error) {
    avisar(consulta, error);
    return null;
  }
}

/** La fecha `terminada_en` de una fila, `null` si no hay fila; `undefined` si falló. */
async function fecha(
  consulta: string,
  promesa: PromiseLike<{ data: { terminada_en: string | null } | null; error: unknown }>,
): Promise<string | null | undefined> {
  try {
    const { data, error } = await promesa;
    if (error) {
      avisar(consulta, error);
      return undefined;
    }
    const valor = data?.terminada_en ?? null;
    return valor && !Number.isNaN(Date.parse(valor)) ? new Date(valor).toISOString() : null;
  } catch (error) {
    avisar(consulta, error);
    return undefined;
  }
}

async function medirBaseDatos(cliente: ClienteServicio): Promise<MedicionBaseDatos> {
  const inicio = performance.now();
  try {
    // `planes` es una tabla chica y sin datos de clientes; `head` no trae filas.
    const { error } = await cliente
      .from('planes')
      .select('codigo', { head: true })
      .limit(1)
      .abortSignal(senal());
    const ms = Math.round(performance.now() - inicio);
    if (error) {
      avisar('base', error);
      return { ok: false, ms };
    }
    return { ok: true, ms };
  } catch (error) {
    avisar('base', error);
    return { ok: false, ms: Math.round(performance.now() - inicio) };
  }
}

async function medirSii(
  cliente: ClienteServicio,
  ambiente: AmbienteEstado,
  ahora: Date,
): Promise<ConteoSii | null> {
  const desde = haceMinutos(ahora, VENTANA_SII_MINUTOS);
  const contarResultados = (
    resultados: readonly ('ok' | 'rechazo_sii' | 'transporte' | 'incierto')[],
  ) =>
    cliente
      .from('operaciones_sii')
      .select('id', { count: 'exact', head: true })
      .eq('ambiente', ambiente)
      .in('resultado', resultados)
      .gte('terminada_en', desde)
      .abortSignal(senal());

  const [respondidas, fallas] = await Promise.all([
    conteo(`sii ${ambiente} respondidas`, contarResultados(RESULTADOS_RESPONDIDAS)),
    conteo(`sii ${ambiente} fallas`, contarResultados(RESULTADOS_FALLAS)),
  ]);

  return respondidas === null || fallas === null ? null : { respondidas, fallas };
}

async function medirSeguimiento(
  cliente: ClienteServicio,
  ahora: Date,
): Promise<MedicionSeguimiento | null> {
  const [atrasados, ultimaCorridaOk] = await Promise.all([
    // Envíos con Track ID que esperan respuesta del SII (la vista del cron) y que nunca se
    // consultaron, enviados entre hace 24 h y hace 15 min.
    conteo(
      'seguimiento atrasados',
      cliente
        .from('v_envios_por_consultar')
        .select('id', { count: 'exact', head: true })
        .is('ultima_consulta_en', null)
        .eq('incierto', false)
        .lte('enviado_en', haceMinutos(ahora, MINUTOS_ATRASO_SEGUIMIENTO))
        .gte('enviado_en', haceMinutos(ahora, HORAS_VENTANA_SEGUIMIENTO * 60))
        .abortSignal(senal()),
    ),
    // La salud del cron: la última corrida que terminó bien (de cualquier cliente). Una
    // corrida con `config` (certificado vencido de un cliente) no cuenta ni en contra.
    fecha(
      'seguimiento ultima ok',
      cliente
        .from('operaciones_sii')
        .select('terminada_en')
        .eq('operacion', 'seguimiento')
        .eq('resultado', 'ok')
        .not('terminada_en', 'is', null)
        .order('terminada_en', { ascending: false })
        .limit(1)
        .abortSignal(senal())
        .maybeSingle(),
    ),
  ]);

  if (atrasados === null || ultimaCorridaOk === undefined) return null;
  return { atrasados, ultimaCorridaOk: ultimaCorridaOk ? new Date(ultimaCorridaOk) : null };
}

const PLATAFORMA: FilaEstado = {
  nivel: 'operativo',
  detalle: 'El sitio y el panel responden: esta página se generó sin problemas.',
};

/**
 * Mide el estado del servicio. `cliente` solo se pasa en las pruebas; sin él usa el de
 * service_role (si falta su configuración, todo lo que depende de la base queda en
 * «Sin datos»).
 */
export async function leerEstadoServicio(
  opciones: { cliente?: ClienteServicio; ahora?: Date } = {},
): Promise<EstadoServicio> {
  const ahora = opciones.ahora ?? new Date();

  let cliente: ClienteServicio | null = opciones.cliente ?? null;
  if (!cliente) {
    try {
      cliente = clienteServicio();
    } catch (error) {
      avisar('cliente', error);
    }
  }

  if (!cliente) {
    // Sin configuración no se puede medir nada que dependa de la base.
    const baseDatos = estadoBaseDatos(null);
    const sii = AMBIENTES.map((ambiente) => ({ ...estadoSii(null), ambiente }));
    const seguimiento = estadoSeguimiento(null, ahora);
    return {
      medidoEn: ahora.toISOString(),
      plataforma: PLATAFORMA,
      baseDatos,
      sii,
      seguimiento,
      general: nivelResumen(baseDatos.nivel, [...sii.map((fila) => fila.nivel), seguimiento.nivel]),
    };
  }

  const conCliente = cliente;
  const [base, siiMedido, seg] = await Promise.all([
    medirBaseDatos(conCliente),
    Promise.all(AMBIENTES.map((ambiente) => medirSii(conCliente, ambiente, ahora))),
    medirSeguimiento(conCliente, ahora),
  ]);

  const baseDatos = estadoBaseDatos(base);
  const sii: FilaSii[] = AMBIENTES.map((ambiente, i) => ({
    ...estadoSii(siiMedido[i] ?? null),
    ambiente,
  }));
  const seguimiento = estadoSeguimiento(seg, ahora);

  return {
    medidoEn: ahora.toISOString(),
    plataforma: PLATAFORMA,
    baseDatos,
    sii,
    seguimiento,
    general: nivelResumen(baseDatos.nivel, [...sii.map((fila) => fila.nivel), seguimiento.nivel]),
  };
}
