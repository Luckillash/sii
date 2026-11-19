import 'server-only';
import {
  CABECERAS_WEBHOOK,
  type CuerpoWebhook,
  type EstadoEntregaWebhook,
} from '@/lib/api-publica';
import { depurarTexto } from '@/lib/sentry/depurar';
import {
  ARRIENDO_SEGUNDOS,
  CONCURRENCIA,
  LARGO_MAXIMO_RESPUESTA,
  LIMITE_RECLAMO,
  PRESUPUESTO_MS,
  USER_AGENT,
} from './constantes';
import type { EnviarHttp, ResultadoHttp } from './entregar';
import { cabeceraFirma } from './firma';

// Corrida de `/api/cron/webhooks` (PLAN-SAAS Fase 11): entrega las filas de
// `webhook_entregas` que encolaron los triggers (`encolar_evento`).
//
//   1. `reclamar_entregas_webhook(32, 120)` (0018): descarta lo que ya no corresponde
//      (webhook inactivo, plan sin webhooks, 8 intentos), elige por turnos entre
//      organizaciones con `for update skip locked`, suma el intento y deja la fila
//      arrendada 120 s. Dos corridas a la vez nunca toman la misma entrega.
//   2. Por entrega: lee el secreto de Vault (`leer_secreto`, con caché por webhook en la
//      corrida), firma y hace el POST (`entregar.ts`, con la protección SSRF).
//   3. `cerrar_entrega_webhook`: 2xx → `entregado`; URL bloqueada → `descartado` sin
//      reintentos; lo demás → `fallido` con la espera que calcula la base (o
//      `descartado` en el intento 8).
//
// Hasta 8 entregas en paralelo y ninguna nueva después de 45 s. El cuerpo es el mismo en
// todos los intentos (el receptor deduplica por `id`); `t` de la firma es nuevo en cada
// intento. Nunca se guarda ni se devuelve el secreto, la firma ni el cuerpo enviado.

export interface EntregaReclamada {
  id: number;
  organizacion_id: string;
  webhook_id: string;
  evento: string;
  payload: unknown;
  /** Ya incluye este intento (la RPC lo suma al reclamar): 1 en el primero. */
  intentos: number;
  url: string;
  secreto_secret_id: string;
}

export interface CierreEntrega {
  id: number;
  /** `intentos` que devolvió el reclamo: la base solo cierra si la fila sigue en ese intento. */
  intento: number;
  entregada: boolean;
  statusHttp: number | null;
  respuesta: string | null;
  /** `true`: se descarta sin reintentos (URL bloqueada). */
  definitiva: boolean;
}

export interface AvisoWebhooks {
  mensaje: string;
  /** Solo conteos o ids técnicos: nunca URL, secretos ni cuerpos. */
  extra?: Record<string, string | number>;
  error?: unknown;
}

export interface DependenciasWebhooks {
  reclamar: (limite: number, arriendoSegundos: number) => Promise<EntregaReclamada[]>;
  leerSecreto: (secretId: string) => Promise<string>;
  /** Devuelve el estado final, o `null` si la fila ya no estaba por entregar. */
  cerrar: (cierre: CierreEntrega) => Promise<EstadoEntregaWebhook | null>;
  enviar: EnviarHttp;
  reloj: () => Date;
  /** Falla nuestra (no del receptor): va a Sentry como aviso. */
  avisar: (aviso: AvisoWebhooks) => void;
}

export interface ResumenWebhooks {
  reclamadas: number;
  entregadas: number;
  fallidas: number;
  descartadas: number;
  /** Reclamadas que no se empezaron por el presupuesto: salen al vencer el arriendo. */
  postergadas: number;
  /** Fallas nuestras: secreto ilegible, cierre fallido o reclamo fallido. */
  errores: number;
}

/** Cuerpo del POST: estable entre intentos. */
export function cuerpoEntrega(entrega: EntregaReclamada): string {
  const payload =
    entrega.payload && typeof entrega.payload === 'object'
      ? (entrega.payload as Record<string, unknown>)
      : {};
  const cuerpo: CuerpoWebhook = {
    id: String(entrega.id),
    evento: entrega.evento as CuerpoWebhook['evento'],
    creado_en: typeof payload.creado_en === 'string' ? payload.creado_en : '',
    datos:
      payload.datos && typeof payload.datos === 'object'
        ? (payload.datos as Record<string, unknown>)
        : {},
  };
  return JSON.stringify(cuerpo);
}

/** Texto para `ultima_respuesta`: sin `\u0000` (Postgres lo rechaza), depurado y acotado. */
export function sanearRespuesta(texto: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: se quita justamente el NUL.
  const sinNul = texto.replace(/\u0000/g, '');
  return depurarTexto(sinNul).slice(0, LARGO_MAXIMO_RESPUESTA);
}

/** Traduce el resultado HTTP a cómo se cierra la entrega. */
export function cierreDe(id: number, resultado: ResultadoHttp): Omit<CierreEntrega, 'intento'> {
  if (resultado.tipo === 'bloqueada') {
    return {
      id,
      entregada: false,
      statusHttp: null,
      respuesta: sanearRespuesta(resultado.mensaje),
      definitiva: true,
    };
  }
  if (resultado.tipo === 'falla') {
    return {
      id,
      entregada: false,
      statusHttp: null,
      respuesta: sanearRespuesta(resultado.mensaje),
      definitiva: false,
    };
  }
  const { status } = resultado;
  if (status >= 200 && status < 300) {
    return {
      id,
      entregada: true,
      statusHttp: status,
      respuesta: sanearRespuesta(resultado.cuerpo),
      definitiva: false,
    };
  }
  const respuesta =
    status >= 300 && status < 400
      ? `Respondió ${status}: los webhooks no siguen redirecciones. Actualiza la URL.`
      : resultado.cuerpo;
  return {
    id,
    entregada: false,
    statusHttp: status >= 100 && status <= 599 ? status : null,
    respuesta: sanearRespuesta(respuesta),
    definitiva: false,
  };
}

const MENSAJE_SIN_SECRETO =
  'No pudimos leer el secreto de firma del webhook. Lo intentaremos de nuevo; si sigue fallando, rota el secreto.';

export async function ejecutarEntregas(deps: DependenciasWebhooks): Promise<ResumenWebhooks> {
  const resumen: ResumenWebhooks = {
    reclamadas: 0,
    entregadas: 0,
    fallidas: 0,
    descartadas: 0,
    postergadas: 0,
    errores: 0,
  };
  const inicio = deps.reloj().getTime();

  let entregas: EntregaReclamada[];
  try {
    entregas = await deps.reclamar(LIMITE_RECLAMO, ARRIENDO_SEGUNDOS);
  } catch (error) {
    resumen.errores += 1;
    deps.avisar({ mensaje: 'webhooks: no se pudieron reclamar entregas', error });
    return resumen;
  }
  resumen.reclamadas = entregas.length;

  // Caché del secreto por webhook dentro de la corrida (la promesa, para no leerlo dos
  // veces si dos entregas del mismo webhook empiezan juntas).
  const secretos = new Map<string, Promise<string>>();
  const secretoDe = (entrega: EntregaReclamada) => {
    let promesa = secretos.get(entrega.secreto_secret_id);
    if (!promesa) {
      promesa = deps.leerSecreto(entrega.secreto_secret_id);
      secretos.set(entrega.secreto_secret_id, promesa);
    }
    return promesa;
  };

  const cerrar = async (cierre: CierreEntrega) => {
    try {
      const estado = await deps.cerrar(cierre);
      if (estado === 'entregado') resumen.entregadas += 1;
      else if (estado === 'descartado') resumen.descartadas += 1;
      else if (estado === 'fallido' || estado === 'pendiente') resumen.fallidas += 1;
      else {
        // La fila ya no estaba en este intento (la reenviaron, la reclamó otra corrida o ya
        // estaba cerrada): la base no la pisó.
        resumen.errores += 1;
        deps.avisar({ mensaje: 'webhooks: entrega sin cerrar', extra: { entrega: cierre.id } });
      }
    } catch (error) {
      resumen.errores += 1;
      deps.avisar({
        mensaje: 'webhooks: falló el cierre de una entrega',
        extra: { entrega: cierre.id },
        error,
      });
    }
  };

  const procesar = async (entrega: EntregaReclamada) => {
    let secreto: string;
    try {
      secreto = await secretoDe(entrega);
      if (!secreto) throw new Error('secreto vacío');
    } catch (error) {
      resumen.errores += 1;
      deps.avisar({
        mensaje: 'webhooks: no se pudo leer el secreto',
        extra: { webhook: entrega.webhook_id },
        error,
      });
      await cerrar({
        id: entrega.id,
        intento: entrega.intentos,
        entregada: false,
        statusHttp: null,
        respuesta: MENSAJE_SIN_SECRETO,
        definitiva: false,
      });
      return;
    }
    const cuerpo = cuerpoEntrega(entrega);
    const t = Math.floor(deps.reloj().getTime() / 1000);
    let resultado: ResultadoHttp;
    try {
      resultado = await deps.enviar({
        url: entrega.url,
        cuerpo,
        cabeceras: {
          'Content-Type': 'application/json; charset=utf-8',
          'User-Agent': USER_AGENT,
          [CABECERAS_WEBHOOK.evento]: entrega.evento,
          [CABECERAS_WEBHOOK.entrega]: String(entrega.id),
          [CABECERAS_WEBHOOK.intento]: String(entrega.intentos),
          [CABECERAS_WEBHOOK.firma]: cabeceraFirma(secreto, t, cuerpo),
        },
      });
    } catch {
      // `enviar` no debería lanzar; si lo hace, se trata como una falla de red.
      resultado = {
        tipo: 'falla',
        mensaje: 'No pudimos conectarnos con la URL del webhook. Lo intentaremos de nuevo.',
      };
    }
    await cerrar({ ...cierreDe(entrega.id, resultado), intento: entrega.intentos });
  };

  const cola = [...entregas];
  const trabajador = async () => {
    for (;;) {
      const entrega = cola.shift();
      if (!entrega) return;
      if (deps.reloj().getTime() - inicio > PRESUPUESTO_MS) {
        resumen.postergadas += 1 + cola.length;
        cola.length = 0;
        return;
      }
      await procesar(entrega);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCIA, cola.length) }, trabajador));
  return resumen;
}
