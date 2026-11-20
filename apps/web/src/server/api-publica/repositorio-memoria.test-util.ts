import 'server-only';
import { vi } from 'vitest';
import type { DocumentoApi } from '@/lib/api-publica';
import type { ResultadoEmision } from '@/lib/emision';
import type { ResultadoFolios } from '@/lib/folios';
import type { Json } from '../supabase/tipos';
import { hashClave } from './autenticacion';
import { condicionCursor } from './cursor';
import type { DependenciasApi } from './dependencias';
import type {
  ClaveAutenticada,
  FilaCafApi,
  FilaDocumentoApi,
  FilaEmpresaApi,
  FilaEnvioApi,
  FilaLineaApi,
  FilaRechazoApi,
  MotivoRechazoClave,
  RecursoIdempotente,
  RepositorioApi,
} from './repositorio';

// Repositorio en memoria de la API pública (pruebas de `server/api-publica/` y de las
// rutas de `/api/v1`), con la semántica de las RPC de la 0018: `autenticar_api_key`
// (motivos), `reclamar_idempotencia` (nueva / retomada / en_curso / terminada / conflicto,
// con arriendo), `terminar_idempotencia` y `soltar_idempotencia`. Nada sale a la red.

export const ORG = '11111111-1111-4111-8111-111111111111';
export const OTRA_ORG = '99999999-9999-4999-8999-999999999999';
export const EMPRESA = '22222222-2222-4222-8222-222222222222';
export const EMPRESA_2 = '55555555-5555-4555-8555-555555555555';
export const API_KEY = '66666666-6666-4666-8666-666666666666';
export const RUT_EMPRESA = '76123456-0';
export const RUT_EMPRESA_2 = '77777777-7';
export const HEX = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90';
export const CLAVE_TEST = `sk_test_${HEX}`;
export const CLAVE_LIVE = `sk_live_${HEX.split('').reverse().join('')}`;

interface FilaIdempotencia {
  organizacionId: string;
  clave: string;
  recurso: RecursoIdempotente;
  huella: string;
  estado: 'en_curso' | 'terminada';
  statusHttp: number | null;
  respuesta: Json | null;
  recursoId: string | null;
  reclamadaEn: number;
}

export interface DocumentoMemoria extends FilaDocumentoApi {
  organizacion_id: string;
  lineas?: FilaLineaApi[];
}

export interface EnvioMemoria extends FilaEnvioApi {
  organizacion_id: string;
}

export function filaDocumento(cambios: Partial<DocumentoMemoria> = {}): DocumentoMemoria {
  return {
    id: crypto.randomUUID(),
    organizacion_id: ORG,
    empresa_id: EMPRESA,
    ambiente: 'certificacion',
    tipo_dte: 39,
    folio: 43,
    estado: 'enviado',
    fecha_emision: '2026-11-18',
    receptor_rut: '66666666-6',
    receptor_razon_social: 'Cliente General',
    metadata: { receptor_correo: null },
    mnt_neto: 1000,
    mnt_exe: 0,
    iva: 190,
    mnt_total: 1190,
    descuento_aplicado: 0,
    envio_id: null,
    origen: 'api',
    clave_idempotencia: null,
    creado_en: '2026-11-18T12:00:00.000000+00:00',
    actualizado_en: '2026-11-18T12:00:00.000000+00:00',
    lineas: [
      {
        nro_linea: 1,
        nombre: 'Café',
        cantidad: 1,
        unidad: null,
        precio: 1190,
        exento: false,
        descuento_monto: 0,
        monto_item: 1190,
      },
    ],
    ...cambios,
  };
}

export function filaEnvio(cambios: Partial<EnvioMemoria> = {}): EnvioMemoria {
  return {
    id: crypto.randomUUID(),
    organizacion_id: ORG,
    empresa_id: EMPRESA,
    ambiente: 'certificacion',
    canal: 'rest',
    proposito: 'emision',
    track_id: '34015200',
    estado_sii: 'REC',
    glosa_sii: null,
    clasificacion: 'en_proceso',
    incierto: false,
    informados: 0,
    aceptados: 0,
    rechazados: 0,
    reparos: 0,
    rut_envia: '12345678-5',
    nro_resol: 0,
    fch_resol: '2026-11-06',
    consultas: 0,
    enviado_en: '2026-11-18T12:00:01+00:00',
    ultima_consulta_en: null,
    creado_en: '2026-11-18T12:00:00+00:00',
    actualizado_en: '2026-11-18T12:00:00+00:00',
    ...cambios,
  };
}

export interface OpcionesMemoria {
  /** Claves válidas: texto de la clave → datos (por defecto `CLAVE_TEST` con todo). */
  claves?: Record<string, Partial<ClaveAutenticada> | MotivoRechazoClave>;
  empresas?: (FilaEmpresaApi & { organizacion_id?: string })[];
  documentos?: DocumentoMemoria[];
  envios?: EnvioMemoria[];
  rechazos?: (FilaRechazoApi & { envio_id: string })[];
  cafs?: (FilaCafApi & { empresa_id?: string; solicitud_id?: string | null })[];
  operaciones?: { id: string; solicitud_id: string | null }[];
}

export function claveCompleta(cambios: Partial<ClaveAutenticada> = {}): ClaveAutenticada {
  return {
    apiKeyId: API_KEY,
    organizacionId: ORG,
    empresaId: null,
    alcances: [
      'documentos:leer',
      'documentos:emitir',
      'folios:leer',
      'folios:solicitar',
      'envios:leer',
    ],
    ambiente: 'certificacion',
    ...cambios,
  };
}

export function repositorioMemoria(opciones: OpcionesMemoria = {}) {
  let ahora = Date.parse('2026-11-18T12:00:00Z');
  const claves = new Map<string, ClaveAutenticada | MotivoRechazoClave>();
  for (const [texto, datos] of Object.entries(opciones.claves ?? { [CLAVE_TEST]: {} })) {
    claves.set(hashClave(texto), typeof datos === 'string' ? datos : claveCompleta(datos));
  }
  const empresas = (
    opciones.empresas ?? [
      { id: EMPRESA, rut: RUT_EMPRESA, razon_social: 'EMPRESA DE PRUEBA SPA', activa: true },
      { id: EMPRESA_2, rut: RUT_EMPRESA_2, razon_social: 'OTRA EMPRESA SPA', activa: true },
    ]
  ).map((e) => ({ organizacion_id: ORG, ...e }));
  const documentos: DocumentoMemoria[] = opciones.documentos ?? [];
  const envios: EnvioMemoria[] = opciones.envios ?? [];
  const rechazos = opciones.rechazos ?? [];
  const cafs = (opciones.cafs ?? []).map((c) => ({ empresa_id: EMPRESA, ...c }));
  const operaciones = opciones.operaciones ?? [];
  const idempotencia = new Map<string, FilaIdempotencia>();
  const llamadas: string[] = [];

  const sinLineas = ({ lineas: _l, organizacion_id: _o, ...d }: DocumentoMemoria) =>
    structuredClone(d);
  const empresaPublica = ({ organizacion_id: _o, ...e }: (typeof empresas)[number]) => ({ ...e });

  const repo: RepositorioApi = {
    async autenticar(hash) {
      llamadas.push('autenticar');
      const c = claves.get(hash);
      if (!c) return { ok: false, motivo: 'invalida' };
      if (typeof c === 'string') return { ok: false, motivo: c };
      return { ok: true, clave: structuredClone(c) };
    },
    async empresaPorId(org, id) {
      const e = empresas.find((x) => x.organizacion_id === org && x.id === id);
      return e ? empresaPublica(e) : null;
    },
    async empresaPorRut(org, rut) {
      const e = empresas.find((x) => x.organizacion_id === org && x.rut === rut);
      return e ? empresaPublica(e) : null;
    },
    async empresas(org, ids) {
      return empresas
        .filter((e) => e.organizacion_id === org && ids.includes(e.id))
        .map(empresaPublica);
    },
    async reclamarIdempotencia(d) {
      llamadas.push(`reclamar:${d.clave}`);
      const llave = `${d.organizacionId}:${d.clave}`;
      const fila = idempotencia.get(llave);
      if (!fila) {
        idempotencia.set(llave, {
          organizacionId: d.organizacionId,
          clave: d.clave,
          recurso: d.recurso,
          huella: d.huella,
          estado: 'en_curso',
          statusHttp: null,
          respuesta: null,
          recursoId: null,
          reclamadaEn: ahora,
        });
        return { resultado: 'nueva', statusHttp: null, respuesta: null, recursoId: null };
      }
      if (fila.huella !== d.huella || fila.recurso !== d.recurso) {
        return { resultado: 'conflicto', statusHttp: null, respuesta: null, recursoId: null };
      }
      if (fila.estado === 'terminada') {
        return {
          resultado: 'terminada',
          statusHttp: fila.statusHttp,
          respuesta: structuredClone(fila.respuesta),
          recursoId: fila.recursoId,
        };
      }
      if (fila.reclamadaEn < ahora - d.arriendoSegundos * 1000) {
        fila.reclamadaEn = ahora;
        return {
          resultado: 'retomada',
          statusHttp: null,
          respuesta: null,
          recursoId: fila.recursoId,
        };
      }
      return { resultado: 'en_curso', statusHttp: null, respuesta: null, recursoId: null };
    },
    async terminarIdempotencia(d) {
      llamadas.push(`terminar:${d.clave}`);
      const fila = idempotencia.get(`${d.organizacionId}:${d.clave}`);
      if (fila?.estado !== 'en_curso') return;
      Object.assign(fila, {
        estado: 'terminada',
        statusHttp: d.statusHttp,
        respuesta: structuredClone(d.respuesta),
        recursoId: d.recursoId ?? fila.recursoId,
      });
    },
    async soltarIdempotencia(d) {
      llamadas.push(`soltar:${d.clave}`);
      const fila = idempotencia.get(`${d.organizacionId}:${d.clave}`);
      if (fila?.estado !== 'en_curso') return;
      fila.reclamadaEn = Number.NEGATIVE_INFINITY;
      if (d.recursoId) fila.recursoId = d.recursoId;
    },
    async documentoPorClave(org, clave) {
      const d = documentos.find((x) => x.organizacion_id === org && x.clave_idempotencia === clave);
      return d
        ? { id: d.id, estado: d.estado, empresa_id: d.empresa_id, ambiente: d.ambiente }
        : null;
    },
    async documento(ambito, id) {
      const d = documentos.find(
        (x) =>
          x.organizacion_id === ambito.organizacionId &&
          x.ambiente === ambito.ambiente &&
          x.id === id &&
          (!ambito.empresaId || x.empresa_id === ambito.empresaId),
      );
      return d ? sinLineas(d) : null;
    },
    async lineas(org, id) {
      return structuredClone(
        documentos.find((x) => x.organizacion_id === org && x.id === id)?.lineas ?? [],
      );
    },
    async listarDocumentos(ambito, f) {
      // Valida el cursor como lo haría PostgREST con la condición armada.
      if (f.cursor) condicionCursor(f.cursor);
      const empresa = ambito.empresaId ?? f.empresaId;
      return documentos
        .filter(
          (d) =>
            d.organizacion_id === ambito.organizacionId &&
            d.ambiente === ambito.ambiente &&
            d.origen !== 'set_pruebas' &&
            (!empresa || d.empresa_id === empresa) &&
            (f.estados ? f.estados.includes(d.estado) : d.estado !== 'borrador') &&
            (f.tipoDte === undefined || d.tipo_dte === f.tipoDte) &&
            (!f.desde || d.fecha_emision >= f.desde) &&
            (!f.hasta || d.fecha_emision <= f.hasta) &&
            (f.folio === undefined || d.folio === f.folio) &&
            (!f.receptorRut || d.receptor_rut === f.receptorRut) &&
            (!f.claveIdempotencia || d.clave_idempotencia === f.claveIdempotencia) &&
            (!f.origen || d.origen === f.origen) &&
            (!f.cursor ||
              d.creado_en < f.cursor.creadoEn ||
              (d.creado_en === f.cursor.creadoEn && d.id < f.cursor.id)),
        )
        .sort((a, b) =>
          a.creado_en === b.creado_en
            ? b.id.localeCompare(a.id)
            : b.creado_en.localeCompare(a.creado_en),
        )
        .slice(0, f.limite + 1)
        .map(sinLineas);
    },
    async enviosCortos(org, ids) {
      return envios
        .filter((e) => e.organizacion_id === org && ids.includes(e.id))
        .map((e) => ({ id: e.id, track_id: e.track_id, estado_sii: e.estado_sii }));
    },
    async envio(ambito, id) {
      const e = envios.find(
        (x) =>
          x.organizacion_id === ambito.organizacionId &&
          x.ambiente === ambito.ambiente &&
          x.proposito !== 'rcof' &&
          x.id === id &&
          (!ambito.empresaId || x.empresa_id === ambito.empresaId),
      );
      if (!e) return null;
      const { organizacion_id: _o, ...resto } = e;
      return structuredClone(resto);
    },
    async documentosDeEnvio(org, envioId) {
      return documentos
        .filter((d) => d.organizacion_id === org && d.envio_id === envioId)
        .map((d) => ({ id: d.id, tipo_dte: d.tipo_dte, folio: d.folio, estado: d.estado }));
    },
    async rechazosDeEnvio(_org, envioId) {
      return rechazos
        .filter((r) => r.envio_id === envioId)
        .map(({ envio_id: _e, ...r }) => structuredClone(r));
    },
    async cafs(_org, empresaId, ambiente) {
      return cafs
        .filter((c) => c.empresa_id === empresaId && c.ambiente === ambiente)
        .map(({ empresa_id: _e, solicitud_id: _s, ...c }) => ({ ...c }));
    },
    async cafDeOperacion(_org, operacionId) {
      const op = operaciones.find((o) => o.id === operacionId);
      const caf = op?.solicitud_id ? cafs.find((c) => c.solicitud_id === op.solicitud_id) : null;
      if (!caf) return null;
      const { empresa_id: _e, solicitud_id: _s, ...c } = caf;
      return { ...c };
    },
  };

  return {
    repo,
    documentos,
    envios,
    cafs,
    operaciones,
    idempotencia,
    llamadas,
    /** Avanza el reloj del repositorio (vence arriendos). */
    avanzar(ms: number) {
      ahora += ms;
    },
  };
}

export type RepositorioMemoria = ReturnType<typeof repositorioMemoria>;

/**
 * Doble de `emitirDocumento`: inserta el documento en el repositorio en memoria con el
 * estado que se pida y devuelve el `ResultadoEmision` correspondiente.
 */
export function emisorFalso(
  m: RepositorioMemoria,
  resultado: 'ok' | 'incierto' | 'anulado' | ResultadoEmision = 'ok',
) {
  let folio = 43;
  return vi.fn(async (ctx, entrada): Promise<ResultadoEmision> => {
    if (typeof resultado === 'object') return resultado;
    if (entrada.nivel === 'ensayo') {
      return {
        tipo: 'ensayo',
        resumen: {
          operacion: 'emitir',
          titulo: 'Emitir boleta electrónica en certificación',
          ambiente: entrada.borrador.ambiente,
          certificado: { titular: 'Titular', rut: '12345678-5', vigenteHasta: '2028-01-01' },
          filas: [],
          avisos: ['Es una boleta de certificación.'],
          textoConfirmar: 'Emitir boleta',
          folioPrevisto: folio,
          totales: {
            lineas: [],
            afectoBruto: 1190,
            descuentoAplicado: 0,
            neto: 1000,
            exento: 0,
            iva: 190,
            total: 1190,
          },
        },
      };
    }
    let doc = entrada.borradorId
      ? m.documentos.find((d) => d.id === entrada.borradorId)
      : undefined;
    if (!doc) {
      doc = filaDocumento({
        empresa_id: ctx.empresaId,
        ambiente: entrada.borrador.ambiente,
        estado: 'borrador',
        folio: null,
        clave_idempotencia: entrada.claveIdempotencia ?? null,
        origen: 'api',
        creado_en: `2026-11-18T12:00:${String(m.documentos.length).padStart(2, '0')}.000000+00:00`,
      });
      m.documentos.push(doc);
    }
    doc.folio = folio++;
    const envio = filaEnvio({ empresa_id: ctx.empresaId, ambiente: entrada.borrador.ambiente });
    m.envios.push(envio);
    doc.envio_id = envio.id;
    const base = {
      id: doc.id,
      tipoDte: 39 as const,
      ambiente: entrada.borrador.ambiente,
      folio: doc.folio,
      total: 1190,
      conPdf: true,
      correoEnviado: false,
    };
    if (resultado === 'ok') {
      doc.estado = 'enviado';
      return {
        tipo: 'ok',
        mensaje: { titulo: 'Emitimos la boleta', detalle: 'El SII la recibió.' },
        documento: { ...base, estado: 'enviado', trackId: '34015200' },
        operacionId: 'op-1',
      };
    }
    doc.estado = resultado;
    return {
      tipo: 'error',
      mensaje:
        resultado === 'incierto'
          ? { titulo: 'No sabemos si el SII recibió la boleta', detalle: 'Revisa en el SII.' }
          : { titulo: 'El SII no recibió la boleta', detalle: 'El SII rechazó el envío.' },
      resultado: resultado === 'incierto' ? 'incierto' : 'rechazo_sii',
      operacionId: 'op-1',
      documento: { ...base, estado: resultado, trackId: null },
    };
  });
}

/** Las dependencias de la API con el repositorio en memoria y dobles de todo lo demás. */
export function dependenciasPrueba(
  m: RepositorioMemoria,
  cambios: Partial<DependenciasApi> = {},
): DependenciasApi & { capturar: ReturnType<typeof vi.fn> } {
  const capturar = vi.fn();
  return {
    repo: m.repo,
    emitir: emisorFalso(m),
    solicitarFolios: vi.fn(
      async (): Promise<ResultadoFolios> => ({
        tipo: 'error',
        mensaje: { titulo: 'x', detalle: 'x' },
        operacionId: null,
      }),
    ),
    enlace: vi.fn(async () => ({ ok: true as const, url: 'https://storage.falso/archivo' })),
    descargar: vi.fn(async () => new Response('<DTE/>', { status: 200 })),
    reloj: () => new Date('2026-11-18T12:00:00Z'),
    capturar,
    ...cambios,
  } as DependenciasApi & { capturar: ReturnType<typeof vi.fn> };
}

/** Una petición a `/api/v1` con la clave de prueba. */
export function peticion(
  ruta: string,
  opciones: {
    metodo?: string;
    cuerpo?: unknown;
    clave?: string | null;
    idempotencia?: string;
    cabeceras?: Record<string, string>;
  } = {},
): Request {
  const cabeceras: Record<string, string> = { ...opciones.cabeceras };
  const clave = opciones.clave === undefined ? CLAVE_TEST : opciones.clave;
  if (clave !== null) cabeceras.authorization = `Bearer ${clave}`;
  if (opciones.idempotencia) cabeceras['idempotency-key'] = opciones.idempotencia;
  if (opciones.cuerpo !== undefined) cabeceras['content-type'] ??= 'application/json';
  return new Request(`https://boleteame.dev/api/v1${ruta}`, {
    method: opciones.metodo ?? (opciones.cuerpo === undefined ? 'GET' : 'POST'),
    headers: cabeceras,
    ...(opciones.cuerpo !== undefined
      ? {
          body:
            typeof opciones.cuerpo === 'string' ? opciones.cuerpo : JSON.stringify(opciones.cuerpo),
        }
      : {}),
  });
}

export const BOLETA = {
  empresa: RUT_EMPRESA,
  tipo_dte: 39,
  lineas: [{ nombre: 'Café', cantidad: 1, precio: 1190 }],
};

export type { DocumentoApi };
