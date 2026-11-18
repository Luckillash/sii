import 'server-only';
import { createHash } from 'node:crypto';
import { correoSuscripcionMorosa } from '@sii/correos';
import { formatearFecha, formatearMonto } from '@/lib/formatos';
import { LARGO_MAXIMO_ERROR, PAUSA_ENTRE_CORREOS_MS } from '../alertas/constantes';
import { ErrorDatosAlertas, type RepositorioAlertas, repositorioSupabase } from '../alertas/datos';
import { enviarCorreo, type MensajeCorreo, type ResultadoEnvio } from '../correo/resend';
import { envAuth, envCorreo } from '../env';
import type { ClienteServicio } from '../supabase/service';
import type { ResultadoSincronizacion } from './suscripciones';

// Aviso por correo de «suscripción con pago vencido» (PLAN-SAAS Fase 10). Lo dispara
// `/api/cron/suscripciones` después de sincronizar con Flow, con los resultados de esa
// corrida. Mismo esquema que las alertas de la Fase 8 (`server/alertas`):
//
//   - Candidatas: resultados `ok` que quedaron `morosa` y traen el importe vencido.
//   - Un aviso por importe vencido: tipo `suscripcion.morosa`, clave
//     `suscripcion.morosa:<suscripcion_id>:<factura_id>` en `notificaciones` (0013; el
//     `check` exige `tipo` con formato `a.b` y que la clave empiece por `<tipo>:`, y la
//     acepta tal cual). Si la mora sigue, el cron vuelve a verla cada hora, pero
//     `reclamar_notificacion` no devuelve fila y no se reenvía. Si Flow genera otro
//     importe vencido (el mes siguiente), es otra clave y otro aviso.
//   - `Idempotency-Key` de Resend estable (`suscripcion.morosa/<suscripcion>/<factura>`),
//     guardada también en `notificaciones.grupo`: un reintento de una fila `fallida` o
//     abandonada no duplica un correo que sí salió.
//   - Destinatarios: propietarios y administradores (los mismos que las alertas, con el
//     mismo repositorio), sin repetir. Sin destinatarios no se reclama.
//   - Sin Resend o sin NEXT_PUBLIC_APP_URL no se reclama nada: la suscripción sigue
//     morosa y el aviso sale en la primera corrida con correo configurado.
//   - Volumen: hasta MAX_CORREOS por corrida, con la pausa de Resend entre uno y otro y
//     sin empezar otro pasado PRESUPUESTO_MS (la sincronización ya usó parte del tiempo
//     de la ruta). Lo que no alcanza queda sin reclamar y sale en la corrida siguiente.
//   - Nunca lanza y nunca registra correos, enlaces de pago ni montos: solo códigos.
//
// Resumen: `candidatas = enviadas + omitidas + fallidas`. `omitidas` son las que no
// necesitaban o no podían salir (ya avisadas, sin destinatarios o datos, sin correo
// configurado, sin cupo); `fallidas`, las que Resend no aceptó o fallaron en la base.

export const TIPO_MOROSA = 'suscripcion.morosa';

/** Tope de correos por corrida (las morosas son pocas; el resto sale en la siguiente). */
export const MAX_CORREOS = 20;
/** Después de esto (desde que empieza el aviso) no se empieza otro correo. */
export const PRESUPUESTO_MS = 20_000;

export interface CorreoAvisos {
  enviar(mensaje: MensajeCorreo): Promise<ResultadoEnvio>;
}

export interface RepositorioAvisos
  extends Pick<
    RepositorioAlertas,
    'organizaciones' | 'destinatarios' | 'reclamar' | 'fijarGrupo' | 'cerrar'
  > {
  /** Nombre del plan de cada suscripción (`suscripciones.plan_id` → `planes.nombre`). */
  planes(suscripcionIds: string[]): Promise<Map<string, string>>;
}

export interface DependenciasAvisos {
  repositorio: RepositorioAvisos;
  correo: CorreoAvisos;
  /** `envCorreo() !== null`: si es false no se reclama ni se envía nada. */
  correoConfigurado: boolean;
  /** Origen público de la app (`NEXT_PUBLIC_APP_URL`, sin `/` final) o null. */
  urlApp: string | null;
  ahora: () => Date;
  /** Pausa entre correos (en las pruebas, sin espera). */
  esperar: (ms: number) => Promise<void>;
}

export interface ResumenAvisos {
  candidatas: number;
  enviadas: number;
  omitidas: number;
  fallidas: number;
  correoConfigurado: boolean;
}

type Candidata = Extract<ResultadoSincronizacion, { ok: true }> & {
  vencido: NonNullable<Extract<ResultadoSincronizacion, { ok: true }>['vencido']>;
};

/**
 * Id del importe para la clave: tal cual si es corto y simple (Flow usa números); si no,
 * su huella (la clave tiene un máximo de 200 caracteres en la 0013).
 */
function idFactura(id: string): string {
  const limpio = id.trim();
  return /^[A-Za-z0-9_.-]{1,64}$/.test(limpio)
    ? limpio
    : createHash('sha256').update(id).digest('hex').slice(0, 32);
}

export const claveMorosa = (suscripcionId: string, facturaId: string) =>
  `${TIPO_MOROSA}:${suscripcionId}:${idFactura(facturaId)}`;
export const claveIdempotenciaMorosa = (suscripcionId: string, facturaId: string) =>
  `${TIPO_MOROSA}/${suscripcionId}/${idFactura(facturaId)}`;

/** El enlace de pago solo si es https absoluto (si no, el correo va sin él). */
function enlacePagoSeguro(enlace: string | null): string | null {
  if (!enlace?.startsWith('https://')) return null;
  try {
    return new URL(enlace).protocol === 'https:' ? enlace : null;
  } catch {
    return null;
  }
}

/** Correos sin repetir (sin distinguir mayúsculas) y con forma de correo. */
function sinRepetir(correos: string[]): string[] {
  return [...new Set(correos.map((c) => c.trim().toLowerCase()).filter((c) => c.includes('@')))];
}

function errorDeEnvio(r: Exclude<ResultadoEnvio, { ok: true }>): string {
  return `${r.motivo}: ${r.detalle}`.slice(0, LARGO_MAXIMO_ERROR);
}

function avisar(texto: string, error: unknown) {
  console.warn(`avisos de mora: ${texto}`, {
    tipo: error instanceof Error ? error.name : typeof error,
    ...(error instanceof ErrorDatosAlertas
      ? { operacion: error.operacion, codigo: error.codigo }
      : {}),
  });
}

function candidatasDe(resultados: ResultadoSincronizacion[]): Candidata[] {
  const vistas = new Set<string>();
  const lista: Candidata[] = [];
  for (const r of resultados) {
    if (!r.ok || r.estadoNuevo !== 'morosa' || r.vencido === null) continue;
    const clave = claveMorosa(r.suscripcionId, r.vencido.id);
    if (vistas.has(clave)) continue;
    vistas.add(clave);
    lista.push(r as Candidata);
  }
  return lista;
}

/** Avisa por correo las suscripciones que quedaron morosas. Nunca lanza. */
export async function avisarMorosas(
  db: ClienteServicio,
  resultados: ResultadoSincronizacion[],
  opciones: Partial<DependenciasAvisos> = {},
): Promise<ResumenAvisos> {
  const candidatas = candidatasDe(resultados);
  let deps: DependenciasAvisos;
  try {
    deps = resolverDependenciasAvisos(db, opciones);
  } catch (error) {
    avisar('no se pudieron armar las dependencias', error);
    return {
      candidatas: candidatas.length,
      enviadas: 0,
      omitidas: 0,
      fallidas: candidatas.length,
      correoConfigurado: false,
    };
  }
  const resumen: ResumenAvisos = {
    candidatas: candidatas.length,
    enviadas: 0,
    omitidas: 0,
    fallidas: 0,
    correoConfigurado: deps.correoConfigurado,
  };
  const terminar = () => {
    resumen.omitidas = resumen.candidatas - resumen.enviadas - resumen.fallidas;
    return resumen;
  };

  if (candidatas.length === 0 || !deps.correoConfigurado) return terminar();
  if (!deps.urlApp) {
    console.warn('avisos de mora: falta NEXT_PUBLIC_APP_URL; no se avisa');
    return terminar();
  }
  const urlApp = deps.urlApp;
  const { repositorio } = deps;

  let organizaciones: Awaited<ReturnType<RepositorioAvisos['organizaciones']>>;
  let destinatarios: Awaited<ReturnType<RepositorioAvisos['destinatarios']>>;
  let planes: Map<string, string>;
  try {
    const orgIds = candidatas.map((c) => c.organizacionId);
    [organizaciones, destinatarios, planes] = await Promise.all([
      repositorio.organizaciones(orgIds),
      repositorio.destinatarios(orgIds),
      repositorio.planes(candidatas.map((c) => c.suscripcionId)),
    ]);
  } catch (error) {
    avisar('no se pudieron leer organizaciones, destinatarios o planes', error);
    resumen.fallidas = candidatas.length;
    return terminar();
  }

  const inicio = deps.ahora().getTime();
  let intentados = 0;
  for (const c of candidatas) {
    const organizacion = organizaciones.get(c.organizacionId);
    const plan = planes.get(c.suscripcionId);
    const para = sinRepetir(destinatarios.get(c.organizacionId) ?? []);
    if (!organizacion || !plan || para.length === 0) continue;
    if (intentados >= MAX_CORREOS || deps.ahora().getTime() - inicio >= PRESUPUESTO_MS) break;

    try {
      // El correo se arma antes de reclamar: si algo no calza, no queda una fila tomada.
      const correo = correoSuscripcionMorosa({
        organizacion: organizacion.nombre,
        plan,
        monto: formatearMonto(c.vencido.monto),
        vence: c.vencido.venceEn ? formatearFecha(c.vencido.venceEn) : null,
        enlacePago: enlacePagoSeguro(c.vencido.enlacePago),
        enlacePlan: `${urlApp}/${encodeURIComponent(organizacion.slug)}/configuracion/plan`,
      });
      const reclamada = await repositorio.reclamar({
        organizacionId: c.organizacionId,
        tipo: TIPO_MOROSA,
        clave: claveMorosa(c.suscripcionId, c.vencido.id),
        referenciaId: c.suscripcionId,
        datos: {
          factura: c.vencido.id,
          monto: c.vencido.monto,
          vence_en: c.vencido.venceEn,
        },
      });
      if (!reclamada) continue;

      const grupo = claveIdempotenciaMorosa(c.suscripcionId, c.vencido.id);
      if (reclamada.grupo !== grupo) {
        try {
          await repositorio.fijarGrupo([reclamada.id], grupo);
        } catch (error) {
          // La clave es determinista: un reintento la vuelve a calcular igual. Se envía.
          avisar('no se pudo guardar el grupo', error);
        }
      }

      if (intentados > 0) await deps.esperar(PAUSA_ENTRE_CORREOS_MS);
      intentados += 1;
      let resultado: ResultadoEnvio;
      try {
        resultado = await deps.correo.enviar({
          para,
          asunto: correo.asunto,
          html: correo.html,
          texto: correo.texto,
          claveIdempotencia: grupo,
        });
      } catch (error) {
        avisar('el envío del correo lanzó una excepción', error);
        resultado = { ok: false, motivo: 'red', detalle: 'Excepción al enviar el correo.' };
      }
      if (resultado.ok) {
        resumen.enviadas += 1;
      } else {
        resumen.fallidas += 1;
        console.warn(`avisos de mora: el correo no salió (${resultado.motivo})`);
      }

      try {
        await repositorio.cerrar(
          [reclamada.id],
          resultado.ok
            ? {
                estado: 'enviada',
                resendId: resultado.id,
                destinatarios: para,
                enviadoEn: deps.ahora().toISOString(),
              }
            : { estado: 'fallida', error: errorDeEnvio(resultado), destinatarios: para },
        );
      } catch (error) {
        // Queda `pendiente`: a los 15 min se puede volver a reclamar y la
        // `Idempotency-Key` evita el duplicado.
        avisar('no se pudo cerrar la notificación', error);
      }
    } catch (error) {
      resumen.fallidas += 1;
      avisar('falló el aviso de una suscripción morosa', error);
    }
  }
  return terminar();
}

function revisar<T>(operacion: string, r: { data: T | null; error: { code?: string } | null }): T {
  if (r.error) throw new ErrorDatosAlertas(operacion, r.error.code || 'desconocido');
  return (r.data ?? []) as T;
}

/** El repositorio de las alertas más el nombre del plan de cada suscripción. */
export function repositorioAvisosSupabase(db: ClienteServicio): RepositorioAvisos {
  const base = repositorioSupabase(db);
  return {
    organizaciones: base.organizaciones,
    destinatarios: base.destinatarios,
    reclamar: base.reclamar,
    fijarGrupo: base.fijarGrupo,
    cerrar: base.cerrar,
    async planes(suscripcionIds) {
      const mapa = new Map<string, string>();
      const ids = [...new Set(suscripcionIds)];
      if (ids.length === 0) return mapa;
      const suscripciones = revisar(
        'leer suscripciones',
        await db.from('suscripciones').select('id, plan_id').in('id', ids),
      );
      const planIds = [...new Set(suscripciones.map((s) => s.plan_id))];
      if (planIds.length === 0) return mapa;
      const planes = revisar(
        'leer planes',
        await db.from('planes').select('id, nombre').in('id', planIds),
      );
      const nombres = new Map(planes.map((p) => [p.id, p.nombre]));
      for (const s of suscripciones) {
        const nombre = nombres.get(s.plan_id);
        if (nombre) mapa.set(s.id, nombre);
      }
      return mapa;
    },
  };
}

function urlAppPorDefecto(): string | null {
  try {
    return envAuth().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Dependencias reales, armadas por invocación (nada en variables de módulo). */
export function resolverDependenciasAvisos(
  db: ClienteServicio,
  parciales: Partial<DependenciasAvisos> = {},
): DependenciasAvisos {
  return {
    repositorio: parciales.repositorio ?? repositorioAvisosSupabase(db),
    correo: parciales.correo ?? { enviar: (m) => enviarCorreo(m) },
    correoConfigurado: parciales.correoConfigurado ?? envCorreo() !== null,
    urlApp: parciales.urlApp !== undefined ? parciales.urlApp : urlAppPorDefecto(),
    ahora: parciales.ahora ?? (() => new Date()),
    esperar: parciales.esperar ?? ((ms) => new Promise((resolver) => setTimeout(resolver, ms))),
  };
}
