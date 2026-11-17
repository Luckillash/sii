// Escenario de prueba del seguimiento (Fase 8). Solo lo importan los `*.test.ts` de esta
// carpeta (no entra al build de Next: nadie de la app lo importa).
//
// Arma sobre el escenario de la certificación (organización, empresa y un certificado de
// MENTIRA en el «Vault» del Supabase falso):
//
//   - la vista `v_envios_por_consultar` sobre la tabla `envios` del falso (que no conoce
//     vistas), con `order(..., { nullsFirst })` como Postgres;
//   - el `ClienteBoletaRest` REAL de la librería sobre un `TransporteFalso` que responde la
//     semilla, el token y el estado por Track ID (nunca sale a la red);
//   - un doble del `ClienteDtews` para el canal SOAP;
//   - un historial de los estados por los que pasa cada documento (para probar que los
//     triggers nunca dejan un estado final intermedio).

import {
  ErrorTransporte,
  EstadoEnvio,
  type Reloj,
  RespuestaHttp,
  TokenStoreMemoria,
  TransporteFalso,
} from '@winex/certificacion';
import { vi } from 'vitest';
import {
  AHORA,
  CERTIFICADO,
  EMPRESA,
  escenario,
  ORG,
  TOKEN_SII,
} from '../../../test/certificacion-prueba';
import { clasificarEnvio, type Fila } from '../../../test/supabase-falso';
import type { RegistroOperacion } from '../sii/operacion';
import { crearTransporte } from '../sii/transporte';
import type { ClienteServicio } from '../supabase/service';
import type { ClienteEstadoSoap, DependenciasSeguimiento } from './dependencias';

export { AHORA, EMPRESA, ORG, TOKEN_SII };
export const EMPRESA_2 = '77777777-7777-4777-8777-777777777777';
export const RUT_EMPRESA_2 = '77777777-7';
export const ORG_2 = '88888888-8888-4888-8888-888888888888';
export const EMPRESA_ORG_2 = '99999999-9999-4999-8999-999999999999';

/** Respuesta del SII para un Track ID: JSON, un código HTTP o una falla de red. */
export type RespuestaPrueba = Record<string, unknown> | { http: number } | 'red';

let correlativo = 0;
function uuid(prefijo: string): string {
  correlativo++;
  return `${prefijo}-0000-4000-8000-${String(correlativo).padStart(12, '0')}`;
}

/** Un envío como lo deja la emisión (con la clasificación que calcularía la base). */
export function filaEnvio(datos: Partial<Fila> = {}): Fila {
  const fila: Fila = {
    id: uuid('aaaaaaaa'),
    organizacion_id: ORG,
    empresa_id: EMPRESA,
    ambiente: 'certificacion',
    canal: 'rest',
    proposito: 'emision',
    track_id: String(1000 + correlativo),
    incierto: false,
    error: null,
    estado_sii: 'REC',
    glosa_sii: null,
    informados: 0,
    aceptados: 0,
    rechazados: 0,
    reparos: 0,
    consultas: 0,
    ultima_consulta_en: null,
    enviado_en: new Date(AHORA.getTime() - 3_600_000).toISOString(),
    respuesta_estado: null,
    ...datos,
  };
  fila.clasificacion = clasificarEnvio(fila);
  return fila;
}

export function filaDocumento(envio: Fila, folio: number, datos: Partial<Fila> = {}): Fila {
  return {
    id: uuid('dddddddd'),
    organizacion_id: envio.organizacion_id,
    empresa_id: envio.empresa_id,
    ambiente: envio.ambiente,
    tipo_dte: 39,
    folio,
    estado: 'enviado',
    envio_id: envio.id,
    ...datos,
  };
}

/** JSON de `boleta.electronica.envio` (la forma documentada en la librería). */
export function jsonEstado(
  estado: string,
  conteos: { informados?: number; aceptados?: number; rechazados?: number; reparos?: number } = {},
  detalle: unknown[] = [],
): Record<string, unknown> {
  const c = { informados: 0, aceptados: 0, rechazados: 0, reparos: 0, ...conteos };
  return {
    rut_emisor: '76123456-0',
    rut_envia: '12345678-5',
    trackid: 0,
    fecha_recepcion: '2026-11-13 12:00:00',
    estado,
    estadistica: c.informados > 0 ? [{ tipo: 39, ...c }] : [],
    detalle_rep_rech: detalle,
  };
}

/** Orden por código (como `text` con collation C): las fechas ISO comparan bien. */
function orden(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Parte una lista de PostgREST por las comas de primer nivel (respeta paréntesis y comillas). */
function partir(lista: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let comillas = false;
  let actual = '';
  for (const c of lista) {
    if (c === '"') comillas = !comillas;
    if (!comillas && c === '(') nivel++;
    if (!comillas && c === ')') nivel--;
    if (!comillas && nivel === 0 && c === ',') {
      partes.push(actual);
      actual = '';
    } else actual += c;
  }
  if (actual !== '') partes.push(actual);
  return partes;
}

/**
 * Evalúa el árbol lógico de un `.or(...)` de PostgREST sobre una fila: `and(...)`, `or(...)`
 * y `columna.operador.valor` con is, eq, lt, lte, gt, gte (valores entre comillas o no).
 * Independiente de `debeConsultar`: así la prueba verifica el texto que va a la base.
 */
export function evaluarFiltro(lista: string, fila: Fila, modo: 'or' | 'and' = 'or'): boolean {
  const resultados = partir(lista).map((parte) => {
    const grupo = /^(and|or)\((.*)\)$/s.exec(parte);
    if (grupo) return evaluarFiltro(grupo[2] as string, fila, grupo[1] as 'and' | 'or');
    const m = /^([a-z_]+)\.([a-z]+)\.(.*)$/.exec(parte);
    if (!m) throw new Error(`filtro no reconocido: ${parte}`);
    const [, columna, operador, crudo] = m as unknown as [string, string, string, string];
    const valor = crudo.replace(/^"(.*)"$/, '$1');
    const actual = fila[columna];
    if (operador === 'is') return valor === 'null' ? actual == null : String(actual) === valor;
    if (actual == null) return false;
    const comparar =
      typeof actual === 'number' ? actual - Number(valor) : orden(String(actual), valor);
    switch (operador) {
      case 'eq':
        return comparar === 0;
      case 'lt':
        return comparar < 0;
      case 'lte':
        return comparar <= 0;
      case 'gt':
        return comparar > 0;
      case 'gte':
        return comparar >= 0;
      default:
        throw new Error(`operador no implementado: ${operador}`);
    }
  });
  return modo === 'or' ? resultados.some(Boolean) : resultados.every(Boolean);
}

export interface OpcionesEscenarioSeguimiento {
  envios?: Fila[];
  documentos?: Fila[];
  /** Por Track ID. Sin entrada: EPR aceptado con un documento. */
  respuestas?: Record<string, RespuestaPrueba | RespuestaPrueba[]>;
  /** El token falla (HTTP 500) en ese host (`apicert.sii.cl` o `api.sii.cl`). */
  tokenFallaEn?: string;
  /** Se llama en cada consulta de estado (p. ej. para adelantar el reloj). */
  alConsultar?: () => void;
  /** Reloj propio (por defecto fijo en AHORA). */
  reloj?: Reloj;
}

export function escenarioSeguimiento(opciones: OpcionesEscenarioSeguimiento = {}) {
  const base = escenario({
    tablas: {
      empresas: [
        {
          id: EMPRESA,
          organizacion_id: ORG,
          rut: '76123456-0',
          razon_social: 'EMPRESA DE PRUEBA SPA',
          activa: true,
        },
        {
          id: EMPRESA_2,
          organizacion_id: ORG,
          rut: RUT_EMPRESA_2,
          razon_social: 'OTRA EMPRESA SPA',
          activa: true,
        },
        // Otra organización, sin certificado: sus credenciales fallan.
        {
          id: EMPRESA_ORG_2,
          organizacion_id: ORG_2,
          rut: '22222222-2',
          razon_social: 'AJENA SPA',
          activa: true,
        },
      ],
      empresa_certificados: [
        {
          organizacion_id: ORG,
          empresa_id: EMPRESA,
          certificado_id: CERTIFICADO,
          es_representante_electronico: true,
          predeterminado: true,
        },
        {
          organizacion_id: ORG,
          empresa_id: EMPRESA_2,
          certificado_id: CERTIFICADO,
          es_representante_electronico: true,
          predeterminado: true,
        },
      ],
      envios: opciones.envios ?? [],
      documentos: opciones.documentos ?? [],
    },
  });
  const { falso } = base;

  // Historial de estados por documento (folio → estados). Los triggers del falso asignan
  // `d.estado` directo sobre la fila; un Proxy lo anota.
  const historial = new Map<number, string[]>();
  falso.db.documentos = falso.tabla('documentos').map((d) => {
    historial.set(Number(d.folio), [String(d.estado)]);
    return new Proxy(d, {
      set(objetivo, clave, valor) {
        if (clave === 'estado' && objetivo.estado !== valor) {
          historial.get(Number(objetivo.folio))?.push(String(valor));
        }
        return Reflect.set(objetivo, clave, valor);
      },
    });
  });

  // Respuestas por Track ID (una lista se consume en orden: la última se repite).
  const respuestas = new Map<string, RespuestaPrueba[]>();
  for (const [track, r] of Object.entries(opciones.respuestas ?? {})) {
    respuestas.set(track, Array.isArray(r) ? [...r] : [r]);
  }
  const siguiente = (track: string): RespuestaPrueba => {
    const lista = respuestas.get(track);
    if (!lista || lista.length === 0) return jsonEstado('EPR', { informados: 1, aceptados: 1 });
    return (lista.length > 1 ? lista.shift() : lista[0]) as RespuestaPrueba;
  };

  const token = (host: string) => () =>
    opciones.tokenFallaEn === host
      ? new RespuestaHttp(500, {}, 'error interno')
      : `<?xml version="1.0"?><SII:RESPUESTA><SII:RESP_BODY><TOKEN>${TOKEN_SII}</TOKEN></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>`;
  const estado = (peticion: { url: string }) => {
    const track = /-([0-9]+)$/.exec(new URL(peticion.url).pathname)?.[1] ?? '';
    opciones.alConsultar?.();
    const r = siguiente(track);
    if (r === 'red') {
      throw new ErrorTransporte(
        `Falló la conexión con ${new URL(peticion.url).host}.`,
        peticion.url,
      );
    }
    if ('http' in r && typeof r.http === 'number') return new RespuestaHttp(r.http, {}, '');
    return JSON.stringify({ ...r, trackid: Number(track) });
  };
  const semilla =
    '<?xml version="1.0"?><SII:RESPUESTA><SII:RESP_BODY><SEMILLA>012345678901</SEMILLA></SII:RESP_BODY><SII:RESP_HDR><ESTADO>00</ESTADO></SII:RESP_HDR></SII:RESPUESTA>';
  const transporteFalso = new TransporteFalso([
    ['apicert.sii.cl/recursos/v1/boleta.electronica.semilla', semilla],
    ['api.sii.cl/recursos/v1/boleta.electronica.semilla', semilla],
    ['apicert.sii.cl/recursos/v1/boleta.electronica.token', token('apicert.sii.cl')],
    ['api.sii.cl/recursos/v1/boleta.electronica.token', token('api.sii.cl')],
    ['*/boleta.electronica.envio/*', estado],
  ]);

  // El falso no conoce vistas ni los `or(...)` anidados de PostgREST: las lecturas de la
  // vista y las de `envios` con `or` se resuelven aquí, evaluando el filtro de verdad
  // (`evaluarFiltro`), con nulls first como Postgres. Todo lo demás va al falso tal cual.
  const motor = (nombre: string, llamadas: [string, unknown[]][]) => {
    let filas =
      nombre === 'v_envios_por_consultar'
        ? falso
            .tabla('envios')
            .filter(
              (e) =>
                e.clasificacion === 'en_proceso' ||
                (e.clasificacion === 'pendiente' && e.track_id != null),
            )
        : falso.tabla(nombre);
    let limite = Number.POSITIVE_INFINITY;
    for (const [metodo, args] of llamadas) {
      if (metodo === 'eq') filas = filas.filter((f) => f[args[0] as string] === args[1]);
      else if (metodo === 'or') filas = filas.filter((f) => evaluarFiltro(args[0] as string, f));
      else if (metodo === 'limit') limite = args[0] as number;
      else if (metodo !== 'select' && metodo !== 'order') {
        throw new Error(`motor de prueba: ${metodo} no implementado`);
      }
    }
    const falla = falso.fallas.get(`${nombre}:select`);
    if (falla) return { data: null, error: falla };
    const ordenadas = filas
      .map((e) => ({ ...e }))
      .sort((x, y) => {
        const a = x.ultima_consulta_en as string | null;
        const c = y.ultima_consulta_en as string | null;
        if (a === c) return 0;
        if (a == null) return -1;
        if (c == null) return 1;
        return orden(a, c);
      });
    return { data: ordenadas.slice(0, limite), error: null };
  };
  const original = falso.cliente as unknown as { from: (n: string) => Record<string, unknown> };
  const from = (nombre: string) => {
    const llamadas: [string, unknown[]][] = [];
    const propio = () =>
      nombre === 'v_envios_por_consultar' ||
      (llamadas[0]?.[0] === 'select' && llamadas.some(([m]) => m === 'or'));
    const repetir = () => {
      let b = original.from(nombre);
      for (const [metodo, args] of llamadas) {
        b = (b[metodo] as (...a: unknown[]) => Record<string, unknown>)(...args);
      }
      return b;
    };
    const terminal = (cual: 'then' | 'single' | 'maybeSingle') => {
      if (!propio()) return repetir()[cual];
      const r = motor(nombre, llamadas);
      if (cual === 'then') {
        return <A, B>(bien: (v: unknown) => A, mal?: (e: unknown) => B) =>
          Promise.resolve(r).then(bien, mal);
      }
      return async () => ({ data: (r.data as unknown[] | null)?.[0] ?? null, error: r.error });
    };
    const proxy: Record<string, unknown> = new Proxy(
      {},
      {
        get(_o, clave: string) {
          if (clave === 'then' || clave === 'single' || clave === 'maybeSingle') {
            return terminal(clave);
          }
          return (...args: unknown[]) => {
            llamadas.push([clave, args]);
            return proxy;
          };
        },
      },
    );
    return proxy;
  };
  const cliente = {
    ...(falso.cliente as unknown as Record<string, unknown>),
    from,
  } as unknown as ClienteServicio;

  const soap = {
    obtenerToken: vi.fn(async () => TOKEN_SII),
    olvidarToken: vi.fn(async () => {}),
    estadoEnvio: vi.fn(
      async (_t: string, _r: unknown, trackId: string) =>
        new EstadoEnvio({
          trackId,
          estado: 'EPR',
          glosa: 'Envio Procesado',
          informados: 1,
          aceptados: 1,
        }),
    ),
  } satisfies ClienteEstadoSoap;

  const registros: RegistroOperacion[] = [];
  const tokenStore = new TokenStoreMemoria();
  const deps: Partial<DependenciasSeguimiento> = {
    servicio: () => cliente,
    reloj: opciones.reloj ?? { ahora: () => new Date(AHORA) },
    transporte: () => crearTransporte({ transporte: transporteFalso }),
    tokenStore: () => tokenStore,
    soap: () => soap,
    operacion: {
      confirmarSesion: async () => true,
      registrar: (r) => {
        registros.push(r);
      },
    },
  };

  /** Peticiones de token por host. */
  const tokensPedidos = (host?: string) =>
    transporteFalso.enviadas.filter(
      (p) => p.url.includes('boleta.electronica.token') && (!host || p.url.includes(host)),
    ).length;
  const consultasHechas = () =>
    transporteFalso.enviadas.filter((p) => p.url.includes('boleta.electronica.envio/'));

  /** Todo lo escrito en la base, las operaciones y lo que recibió «Sentry». */
  const todoLoEscrito = () =>
    JSON.stringify([falso.escrituras, falso.tabla('operaciones_sii'), registros]);

  return {
    ...base,
    falso,
    cliente,
    deps,
    soap,
    registros,
    historial,
    transporteFalso,
    tokensPedidos,
    consultasHechas,
    todoLoEscrito,
    envio: (id: unknown) => falso.tabla('envios').find((e) => e.id === id),
    consultas: (id: unknown) => falso.tabla('consultas_envio').filter((c) => c.envio_id === id),
  };
}

export type EscenarioSeguimiento = ReturnType<typeof escenarioSeguimiento>;
