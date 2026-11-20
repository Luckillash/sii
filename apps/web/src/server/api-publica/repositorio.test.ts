import { beforeEach, describe, expect, it } from 'vitest';
import type { ClienteServicio } from '../supabase/service';
import { type Ambito, type RepositorioApi, repositorioSupabase } from './repositorio';

// La API pública corre con service_role (salta RLS): el aislamiento entre organizaciones lo
// da que CADA consulta del repositorio filtre por la organización de la clave autenticada
// (PLAN-SAAS §2 y Fase 13, punto 1: «ninguna ruta de /api/v1 lee o escribe sin filtrar por
// la organización de la clave»). Esta prueba recorre todos los métodos con un cliente que
// registra la cadena de cada consulta y falla si alguna no lleva ese filtro.

const ORG = '11111111-1111-4111-8111-111111111111';
const EMPRESA = '22222222-2222-4222-8222-222222222222';
const ID = '33333333-3333-4333-8333-333333333333';

interface Consulta {
  tabla: string;
  cadena: [string, ...unknown[]][];
}

interface LlamadaRpc {
  nombre: string;
  args: Record<string, unknown>;
}

let consultas: Consulta[] = [];
let rpcs: LlamadaRpc[] = [];

/** Datos que devuelve cada tabla (para que los métodos de dos pasos sigan al segundo). */
const DATOS: Record<string, unknown> = {
  operaciones_sii: { solicitud_id: ID },
};

function cadenaConsulta(consulta: Consulta): unknown {
  const proxy: unknown = new Proxy(
    {},
    {
      get(_, prop: string) {
        if (prop === 'then') {
          const fila = DATOS[consulta.tabla];
          const data = consulta.cadena.some(([m]) => m === 'maybeSingle') ? (fila ?? null) : [];
          return (ok: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(ok);
        }
        return (...args: unknown[]) => {
          consulta.cadena.push([prop, ...args]);
          return proxy;
        };
      },
    },
  );
  return proxy;
}

const RESPUESTAS_RPC: Record<string, unknown> = {
  reclamar_idempotencia: [
    { resultado: 'nueva', status_http: null, respuesta: null, recurso_id: null },
  ],
};

const cliente = {
  from(tabla: string) {
    const consulta: Consulta = { tabla, cadena: [] };
    consultas.push(consulta);
    return cadenaConsulta(consulta);
  },
  async rpc(nombre: string, args: Record<string, unknown>) {
    rpcs.push({ nombre, args });
    return { data: RESPUESTAS_RPC[nombre] ?? null, error: null };
  },
} as unknown as ClienteServicio;

const AMBITO: Ambito = { organizacionId: ORG, ambiente: 'certificacion', empresaId: EMPRESA };
const AMBITO_SIN_EMPRESA: Ambito = { ...AMBITO, empresaId: null };

/** Cada método del repositorio (salvo `autenticar`) llamado con la organización ORG. */
const LLAMADAS: Record<
  Exclude<keyof RepositorioApi, 'autenticar'>,
  (r: RepositorioApi) => unknown
> = {
  empresaPorId: (r) => r.empresaPorId(ORG, EMPRESA),
  empresaPorRut: (r) => r.empresaPorRut(ORG, '76354771-K'),
  empresas: (r) => r.empresas(ORG, [EMPRESA]),
  reclamarIdempotencia: (r) =>
    r.reclamarIdempotencia({
      organizacionId: ORG,
      clave: 'clave-1',
      recurso: 'documento',
      huella: 'h',
      apiKeyId: ID,
      arriendoSegundos: 60,
    }),
  terminarIdempotencia: (r) =>
    r.terminarIdempotencia({
      organizacionId: ORG,
      clave: 'clave-1',
      statusHttp: 201,
      respuesta: {},
    }),
  soltarIdempotencia: (r) => r.soltarIdempotencia({ organizacionId: ORG, clave: 'clave-1' }),
  documentoPorClave: (r) => r.documentoPorClave(ORG, 'clave-1'),
  documento: (r) => r.documento(AMBITO_SIN_EMPRESA, ID),
  lineas: (r) => r.lineas(ORG, ID),
  listarDocumentos: (r) =>
    r.listarDocumentos(AMBITO_SIN_EMPRESA, {
      limite: 10,
      cursor: { creadoEn: '2026-11-18T12:00:00.000000+00:00', id: ID },
    }),
  enviosCortos: (r) => r.enviosCortos(ORG, [ID]),
  envio: (r) => r.envio(AMBITO_SIN_EMPRESA, ID),
  documentosDeEnvio: (r) => r.documentosDeEnvio(ORG, ID),
  rechazosDeEnvio: (r) => r.rechazosDeEnvio(ORG, ID),
  cafs: (r) => r.cafs(ORG, EMPRESA, 'certificacion'),
  cafDeOperacion: (r) => r.cafDeOperacion(ORG, ID),
};

const filtraPorOrg = (c: Consulta) =>
  c.cadena.some(([m, col, valor]) => m === 'eq' && col === 'organizacion_id' && valor === ORG);

describe('repositorioSupabase: aislamiento por organización (service_role)', () => {
  beforeEach(() => {
    consultas = [];
    rpcs = [];
  });

  for (const [metodo, llamar] of Object.entries(LLAMADAS)) {
    it(`${metodo} filtra por la organización de la clave`, async () => {
      await llamar(repositorioSupabase(cliente));
      expect(consultas.length + rpcs.length).toBeGreaterThan(0);
      for (const c of consultas) {
        expect(filtraPorOrg(c), `${metodo}: consulta a ${c.tabla} sin organizacion_id`).toBe(true);
      }
      for (const r of rpcs) {
        expect(r.args.p_organizacion, `${metodo}: rpc ${r.nombre} sin p_organizacion`).toBe(ORG);
      }
    });
  }

  it('cafDeOperacion hace las dos lecturas, ambas filtradas', async () => {
    await repositorioSupabase(cliente).cafDeOperacion(ORG, ID);
    expect(consultas.map((c) => c.tabla)).toEqual(['operaciones_sii', 'cafs']);
    expect(consultas.every(filtraPorOrg)).toBe(true);
  });

  it('documento y envio filtran además por ambiente y, si la clave la tiene, por empresa', async () => {
    const repo = repositorioSupabase(cliente);
    await repo.documento(AMBITO, ID);
    await repo.envio(AMBITO, ID);
    await repo.listarDocumentos(AMBITO, { limite: 5 });
    for (const c of consultas) {
      expect(c.cadena).toContainEqual(['eq', 'ambiente', 'certificacion']);
      expect(c.cadena).toContainEqual(['eq', 'empresa_id', EMPRESA]);
    }
  });

  it('listarDocumentos no deja que el filtro de la consulta pise la empresa de la clave', async () => {
    await repositorioSupabase(cliente).listarDocumentos(AMBITO, {
      limite: 5,
      empresaId: '44444444-4444-4444-8444-444444444444',
    });
    const empresas = consultas[0]?.cadena.filter(([m, col]) => m === 'eq' && col === 'empresa_id');
    expect(empresas).toEqual([['eq', 'empresa_id', EMPRESA]]);
  });

  it('un id que no es uuid no consulta la base', async () => {
    const repo = repositorioSupabase(cliente);
    expect(await repo.documento(AMBITO, '1 or 1=1')).toBeNull();
    expect(await repo.envio(AMBITO, '../otro')).toBeNull();
    expect(await repo.empresaPorId(ORG, 'x')).toBeNull();
    expect(consultas).toEqual([]);
  });

  it('autenticar es la única lectura global: por el hash, con la RPC autenticar_api_key', async () => {
    await repositorioSupabase(cliente).autenticar('a'.repeat(64));
    expect(consultas).toEqual([]);
    expect(rpcs).toEqual([
      { nombre: 'autenticar_api_key', args: { p_clave_hash: 'a'.repeat(64) } },
    ]);
  });
});
