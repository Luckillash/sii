import 'server-only';
import { type Alcance, type AmbienteSii, esAlcance } from '@/lib/api-publica';
import { fallaBase } from '../certificacion/comun';
import type { ClienteServicio } from '../supabase/service';
import type { Json, Tables } from '../supabase/tipos';
import { type Cursor, condicionCursor } from './cursor';

// Acceso a la base de la API pública (PLAN-SAAS Fase 11). Todo con service_role (la API
// no tiene sesión) y SIEMPRE filtrando por `organizacion_id` de la clave autenticada
// (principio 2), y además por ambiente (el de la clave) y, si corresponde, por empresa.
// Las fallas de PostgREST salen solo con su código (`fallaBase`): el detalle podría traer
// la fila. Las rutas y los manejadores usan esta interfaz; las pruebas, una en memoria.

export type MotivoRechazoClave = 'invalida' | 'revocada' | 'vencida' | 'plan_sin_api';

export interface ClaveAutenticada {
  apiKeyId: string;
  organizacionId: string;
  /** `null` = la clave sirve para todas las empresas de la organización. */
  empresaId: string | null;
  alcances: Alcance[];
  ambiente: AmbienteSii;
}

export type ResultadoAutenticacion =
  | { ok: true; clave: ClaveAutenticada }
  | { ok: false; motivo: MotivoRechazoClave };

export type RecursoIdempotente = 'documento' | 'lote' | 'solicitud_folios';

export interface ReclamoIdempotencia {
  resultado: 'nueva' | 'retomada' | 'en_curso' | 'terminada' | 'conflicto';
  statusHttp: number | null;
  respuesta: Json | null;
  recursoId: string | null;
}

export type FilaEmpresaApi = Pick<Tables<'empresas'>, 'id' | 'rut' | 'razon_social' | 'activa'>;

export const COLUMNAS_DOCUMENTO =
  'id, empresa_id, ambiente, tipo_dte, folio, estado, fecha_emision, receptor_rut, receptor_razon_social, metadata, mnt_neto, mnt_exe, iva, mnt_total, descuento_aplicado, envio_id, origen, clave_idempotencia, creado_en, actualizado_en';

export type FilaDocumentoApi = Pick<
  Tables<'documentos'>,
  | 'id'
  | 'empresa_id'
  | 'ambiente'
  | 'tipo_dte'
  | 'folio'
  | 'estado'
  | 'fecha_emision'
  | 'receptor_rut'
  | 'receptor_razon_social'
  | 'metadata'
  | 'mnt_neto'
  | 'mnt_exe'
  | 'iva'
  | 'mnt_total'
  | 'descuento_aplicado'
  | 'envio_id'
  | 'origen'
  | 'clave_idempotencia'
  | 'creado_en'
  | 'actualizado_en'
>;

export type FilaLineaApi = Pick<
  Tables<'documento_detalles'>,
  | 'nro_linea'
  | 'nombre'
  | 'cantidad'
  | 'unidad'
  | 'precio'
  | 'exento'
  | 'descuento_monto'
  | 'monto_item'
>;

export type FilaEnvioCortaApi = Pick<Tables<'envios'>, 'id' | 'track_id' | 'estado_sii'>;

export const COLUMNAS_ENVIO =
  'id, empresa_id, ambiente, canal, proposito, track_id, estado_sii, glosa_sii, clasificacion, incierto, informados, aceptados, rechazados, reparos, rut_envia, nro_resol, fch_resol, consultas, enviado_en, ultima_consulta_en, creado_en, actualizado_en';

export type FilaEnvioApi = Pick<
  Tables<'envios'>,
  | 'id'
  | 'empresa_id'
  | 'ambiente'
  | 'canal'
  | 'proposito'
  | 'track_id'
  | 'estado_sii'
  | 'glosa_sii'
  | 'clasificacion'
  | 'incierto'
  | 'informados'
  | 'aceptados'
  | 'rechazados'
  | 'reparos'
  | 'rut_envia'
  | 'nro_resol'
  | 'fch_resol'
  | 'consultas'
  | 'enviado_en'
  | 'ultima_consulta_en'
  | 'creado_en'
  | 'actualizado_en'
>;

export type FilaRechazoApi = Pick<
  Tables<'envio_rechazos'>,
  'tipo_dte' | 'folio' | 'documento_id' | 'estado' | 'tipo_observacion' | 'descripcion' | 'errores'
>;

export type FilaDocumentoEnvioApi = Pick<
  Tables<'documentos'>,
  'id' | 'tipo_dte' | 'folio' | 'estado'
>;

export type FilaCafApi = Pick<
  Tables<'cafs'>,
  | 'id'
  | 'ambiente'
  | 'tipo_dte'
  | 'folio_desde'
  | 'folio_hasta'
  | 'siguiente_folio'
  | 'estado'
  | 'fecha_autorizacion'
>;

/** Alcance de lectura: la clave ve solo su ambiente y, si tiene empresa, solo esa. */
export interface Ambito {
  organizacionId: string;
  ambiente: AmbienteSii;
  empresaId: string | null;
}

export interface FiltrosDocumentos {
  empresaId?: string;
  tipoDte?: number;
  estados?: string[];
  desde?: string;
  hasta?: string;
  folio?: number;
  receptorRut?: string;
  claveIdempotencia?: string;
  origen?: 'panel' | 'api';
  cursor?: Cursor;
  /** Se piden `limite + 1` filas para saber si hay más. */
  limite: number;
}

export interface RepositorioApi {
  autenticar(claveHash: string): Promise<ResultadoAutenticacion>;
  empresaPorId(organizacionId: string, id: string): Promise<FilaEmpresaApi | null>;
  empresaPorRut(organizacionId: string, rut: string): Promise<FilaEmpresaApi | null>;
  empresas(organizacionId: string, ids: readonly string[]): Promise<FilaEmpresaApi[]>;

  reclamarIdempotencia(datos: {
    organizacionId: string;
    clave: string;
    recurso: RecursoIdempotente;
    huella: string;
    apiKeyId: string;
    arriendoSegundos: number;
  }): Promise<ReclamoIdempotencia>;
  terminarIdempotencia(datos: {
    organizacionId: string;
    clave: string;
    statusHttp: number;
    respuesta: Json;
    recursoId?: string | null;
  }): Promise<void>;
  soltarIdempotencia(datos: {
    organizacionId: string;
    clave: string;
    recursoId?: string | null;
  }): Promise<void>;

  documentoPorClave(
    organizacionId: string,
    clave: string,
  ): Promise<Pick<Tables<'documentos'>, 'id' | 'estado' | 'empresa_id' | 'ambiente'> | null>;
  documento(ambito: Ambito, id: string): Promise<FilaDocumentoApi | null>;
  lineas(organizacionId: string, documentoId: string): Promise<FilaLineaApi[]>;
  listarDocumentos(ambito: Ambito, filtros: FiltrosDocumentos): Promise<FilaDocumentoApi[]>;
  enviosCortos(organizacionId: string, ids: readonly string[]): Promise<FilaEnvioCortaApi[]>;

  envio(ambito: Ambito, id: string): Promise<FilaEnvioApi | null>;
  documentosDeEnvio(organizacionId: string, envioId: string): Promise<FilaDocumentoEnvioApi[]>;
  rechazosDeEnvio(organizacionId: string, envioId: string): Promise<FilaRechazoApi[]>;

  cafs(organizacionId: string, empresaId: string, ambiente: AmbienteSii): Promise<FilaCafApi[]>;
  cafDeOperacion(organizacionId: string, operacionId: string): Promise<FilaCafApi | null>;
}

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNAS_CAF =
  'id, ambiente, tipo_dte, folio_desde, folio_hasta, siguiente_folio, estado, fecha_autorizacion';
const MOTIVOS: readonly MotivoRechazoClave[] = ['invalida', 'revocada', 'vencida', 'plan_sin_api'];
const RESULTADOS_RECLAMO: readonly ReclamoIdempotencia['resultado'][] = [
  'nueva',
  'retomada',
  'en_curso',
  'terminada',
  'conflicto',
];

export function repositorioSupabase(cliente: ClienteServicio): RepositorioApi {
  async function empresaPor(organizacionId: string, columna: 'id' | 'rut', valor: string) {
    const { data, error } = await cliente
      .from('empresas')
      .select('id, rut, razon_social, activa')
      .eq('organizacion_id', organizacionId)
      .eq(columna, valor)
      .maybeSingle();
    if (error) throw fallaBase('leer la empresa', error);
    return data;
  }

  return {
    async autenticar(claveHash) {
      const { data, error } = await cliente.rpc('autenticar_api_key', { p_clave_hash: claveHash });
      if (error) throw fallaBase('autenticar la API key', error);
      const fila = data?.[0];
      if (!fila) return { ok: false, motivo: 'invalida' };
      if (fila.motivo !== null) {
        const motivo = MOTIVOS.find((m) => m === fila.motivo) ?? 'invalida';
        return { ok: false, motivo };
      }
      if (!fila.api_key_id || !fila.organizacion_id || !fila.ambiente) {
        return { ok: false, motivo: 'invalida' };
      }
      return {
        ok: true,
        clave: {
          apiKeyId: fila.api_key_id,
          organizacionId: fila.organizacion_id,
          empresaId: fila.empresa_id,
          alcances: (fila.alcances ?? []).filter(esAlcance),
          ambiente: fila.ambiente,
        },
      };
    },

    empresaPorId: (org, id) =>
      PATRON_UUID.test(id) ? empresaPor(org, 'id', id) : Promise.resolve(null),
    empresaPorRut: (org, rut) => empresaPor(org, 'rut', rut),

    async empresas(org, ids) {
      if (ids.length === 0) return [];
      const { data, error } = await cliente
        .from('empresas')
        .select('id, rut, razon_social, activa')
        .eq('organizacion_id', org)
        .in('id', [...new Set(ids)]);
      if (error) throw fallaBase('leer las empresas', error);
      return data;
    },

    async reclamarIdempotencia(d) {
      const { data, error } = await cliente.rpc('reclamar_idempotencia', {
        p_organizacion: d.organizacionId,
        p_clave: d.clave,
        p_recurso: d.recurso,
        p_huella: d.huella,
        p_api_key: d.apiKeyId,
        p_arriendo_segundos: d.arriendoSegundos,
      });
      if (error) throw fallaBase('reclamar la Idempotency-Key', error);
      const fila = data?.[0];
      const resultado = RESULTADOS_RECLAMO.find((r) => r === fila?.resultado);
      if (!fila || !resultado) throw fallaBase('reclamar la Idempotency-Key', null);
      return {
        resultado,
        statusHttp: fila.status_http,
        respuesta: fila.respuesta,
        recursoId: fila.recurso_id,
      };
    },

    async terminarIdempotencia(d) {
      const { error } = await cliente.rpc('terminar_idempotencia', {
        p_organizacion: d.organizacionId,
        p_clave: d.clave,
        p_status_http: d.statusHttp,
        p_respuesta: d.respuesta,
        ...(d.recursoId ? { p_recurso_id: d.recursoId } : {}),
      });
      if (error) throw fallaBase('guardar la respuesta de la Idempotency-Key', error);
    },

    async soltarIdempotencia(d) {
      const { error } = await cliente.rpc('soltar_idempotencia', {
        p_organizacion: d.organizacionId,
        p_clave: d.clave,
        ...(d.recursoId ? { p_recurso_id: d.recursoId } : {}),
      });
      if (error) throw fallaBase('liberar la Idempotency-Key', error);
    },

    async documentoPorClave(org, clave) {
      const { data, error } = await cliente
        .from('documentos')
        .select('id, estado, empresa_id, ambiente')
        .eq('organizacion_id', org)
        .eq('clave_idempotencia', clave)
        .maybeSingle();
      if (error) throw fallaBase('buscar el documento de la Idempotency-Key', error);
      return data;
    },

    async documento(ambito, id) {
      if (!PATRON_UUID.test(id)) return null;
      let q = cliente
        .from('documentos')
        .select(COLUMNAS_DOCUMENTO)
        .eq('organizacion_id', ambito.organizacionId)
        .eq('ambiente', ambito.ambiente)
        .eq('id', id);
      if (ambito.empresaId) q = q.eq('empresa_id', ambito.empresaId);
      const { data, error } = await q.maybeSingle();
      if (error) throw fallaBase('leer el documento', error);
      return data;
    },

    async lineas(org, documentoId) {
      const { data, error } = await cliente
        .from('documento_detalles')
        .select('nro_linea, nombre, cantidad, unidad, precio, exento, descuento_monto, monto_item')
        .eq('organizacion_id', org)
        .eq('documento_id', documentoId)
        .order('nro_linea', { ascending: true });
      if (error) throw fallaBase('leer las líneas del documento', error);
      return data;
    },

    async listarDocumentos(ambito, f) {
      let q = cliente
        .from('documentos')
        .select(COLUMNAS_DOCUMENTO)
        .eq('organizacion_id', ambito.organizacionId)
        .eq('ambiente', ambito.ambiente)
        .neq('origen', 'set_pruebas');
      const empresa = ambito.empresaId ?? f.empresaId;
      if (empresa) q = q.eq('empresa_id', empresa);
      if (f.estados && f.estados.length > 0) {
        q = q.in('estado', f.estados as Tables<'documentos'>['estado'][]);
      } else {
        q = q.neq('estado', 'borrador');
      }
      if (f.tipoDte !== undefined) q = q.eq('tipo_dte', f.tipoDte);
      if (f.desde) q = q.gte('fecha_emision', f.desde);
      if (f.hasta) q = q.lte('fecha_emision', f.hasta);
      if (f.folio !== undefined) q = q.eq('folio', f.folio);
      if (f.receptorRut) q = q.eq('receptor_rut', f.receptorRut);
      if (f.claveIdempotencia) q = q.eq('clave_idempotencia', f.claveIdempotencia);
      if (f.origen) q = q.eq('origen', f.origen);
      if (f.cursor) q = q.or(condicionCursor(f.cursor));
      const { data, error } = await q
        .order('creado_en', { ascending: false })
        .order('id', { ascending: false })
        .limit(f.limite + 1);
      if (error) throw fallaBase('listar los documentos', error);
      return data;
    },

    async enviosCortos(org, ids) {
      if (ids.length === 0) return [];
      const { data, error } = await cliente
        .from('envios')
        .select('id, track_id, estado_sii')
        .eq('organizacion_id', org)
        .in('id', [...new Set(ids)]);
      if (error) throw fallaBase('leer los envíos', error);
      return data;
    },

    async envio(ambito, id) {
      if (!PATRON_UUID.test(id)) return null;
      let q = cliente
        .from('envios')
        .select(COLUMNAS_ENVIO)
        .eq('organizacion_id', ambito.organizacionId)
        .eq('ambiente', ambito.ambiente)
        .neq('proposito', 'rcof')
        .eq('id', id);
      if (ambito.empresaId) q = q.eq('empresa_id', ambito.empresaId);
      const { data, error } = await q.maybeSingle();
      if (error) throw fallaBase('leer el envío', error);
      return data;
    },

    async documentosDeEnvio(org, envioId) {
      const { data, error } = await cliente
        .from('documentos')
        .select('id, tipo_dte, folio, estado')
        .eq('organizacion_id', org)
        .eq('envio_id', envioId)
        .order('folio', { ascending: true });
      if (error) throw fallaBase('leer los documentos del envío', error);
      return data;
    },

    async rechazosDeEnvio(org, envioId) {
      const { data, error } = await cliente
        .from('envio_rechazos')
        .select('tipo_dte, folio, documento_id, estado, tipo_observacion, descripcion, errores')
        .eq('organizacion_id', org)
        .eq('envio_id', envioId)
        .order('folio', { ascending: true });
      if (error) throw fallaBase('leer los rechazos del envío', error);
      return data;
    },

    async cafs(org, empresaId, ambiente) {
      const { data, error } = await cliente
        .from('cafs')
        .select(COLUMNAS_CAF)
        .eq('organizacion_id', org)
        .eq('empresa_id', empresaId)
        .eq('ambiente', ambiente)
        .order('folio_desde', { ascending: true });
      if (error) throw fallaBase('leer los CAF', error);
      return data;
    },

    async cafDeOperacion(org, operacionId) {
      const op = await cliente
        .from('operaciones_sii')
        .select('solicitud_id')
        .eq('organizacion_id', org)
        .eq('id', operacionId)
        .maybeSingle();
      if (op.error) throw fallaBase('leer la operación', op.error);
      if (!op.data?.solicitud_id) return null;
      const caf = await cliente
        .from('cafs')
        .select(COLUMNAS_CAF)
        .eq('organizacion_id', org)
        .eq('solicitud_id', op.data.solicitud_id)
        .maybeSingle();
      if (caf.error) throw fallaBase('leer el CAF timbrado', caf.error);
      return caf.data;
    },
  };
}
