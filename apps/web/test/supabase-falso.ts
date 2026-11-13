// Cliente de Supabase FALSO para las pruebas de la capa de certificación (Fase 5): tablas
// en memoria, el subconjunto del query builder de supabase-js que usa la app, las RPC del
// backend y Storage. Imita, en JavaScript, lo que hace la base y que la capa necesita ver:
//
//   - defaults de columnas (ids, fechas, estados) y `organizacion_id` heredado;
//   - el índice único parcial `operaciones_sii_efecto_global_en_curso` (0007, 23505);
//   - `tg_proteger_proceso` (con rol `authenticated`), `tg_certificacion_autorizada` y
//     `tg_resolucion_autoriza_produccion` (0009);
//   - la columna generada `envios.clasificacion` y la sincronización de documentos de
//     `sincronizar_documentos_envio` (triggers de envíos y rechazos);
//   - `asignar_folio`, `registrar_caf`, `guardar_set_pruebas`, `registrar_resolucion`,
//     `leer_secreto`, los bloqueos y el TokenStore.
//
// No pretende ser Postgres: solo lo suficiente para probar la capa sin red ni base. Todo
// lo que se escribe queda en `escrituras` para buscar secretos.

import { randomUUID } from 'node:crypto';
import type { ClienteServicio } from '../src/server/supabase/service';

export type Fila = Record<string, unknown>;
type Filtro = (fila: Fila) => boolean;
type ErrorPg = { code: string; message: string };
type Respuesta = { data: unknown; error: ErrorPg | null; count?: number | null };

export interface Escritura {
  tabla: string;
  accion: 'insert' | 'update' | 'upsert' | 'delete' | 'rpc' | 'storage';
  datos: unknown;
}

const ETAPAS = [
  'borrador',
  'postulada',
  'set_descargado',
  'set_enviado',
  'set_aceptado',
  'revision_solicitada',
  'por_declarar',
  'autorizada',
];

const EFECTO_GLOBAL = ['solicitar_folios', 'postular', 'declarar'];

/** Igual que `public.clasificar_envio()`. */
export function clasificarEnvio(e: Fila): string {
  if (e.incierto) return 'incierto';
  const estado = (e.estado_sii as string | null) ?? '';
  if (estado === '') return 'pendiente';
  if (['REC', 'SOK', 'CRT', 'FOK', 'PRD'].includes(estado)) return 'en_proceso';
  if (estado === 'EPR') {
    const inf = Number(e.informados ?? 0);
    const ace = Number(e.aceptados ?? 0);
    const rec = Number(e.rechazados ?? 0);
    const rep = Number(e.reparos ?? 0);
    if (rec > 0) return 'rechazado';
    if (inf > 0 && ace === inf && rep === 0) return 'aceptado';
    if (inf > 0 && rep > 0) return 'aceptado_con_reparos';
    return 'inconsistente';
  }
  return 'rechazado';
}

const DEFAULTS: Record<string, () => Fila> = {
  operaciones_sii: () => ({
    detalle: {},
    resultado: 'en_curso',
    mensaje: null,
    terminada_en: null,
    envio_id: null,
    solicitud_id: null,
    documento_id: null,
  }),
  procesos_certificacion: () => ({
    etapa: 'borrador',
    avisos_postulacion: [],
    boleta_exenta: true,
    codigo_estado_sii: null,
    glosa_estado_sii: null,
    paso_sii: null,
    envio_set_id: null,
    set_descargado_en: null,
    revision_solicitada_en: null,
    postulada_en: null,
    declarada_en: null,
    correo_proveedor_set: null,
    set_pruebas_texto: null,
    estado_consultado_en: null,
    rut_administrador: null,
    correo_administrador: null,
    correo_contacto_sii: null,
    correo_intercambio: null,
    nombre_software: null,
    url: null,
    link_consulta: null,
    rut_proveedor: null,
    nombre_proveedor: null,
    correo_proveedor: null,
  }),
  envios: () => ({
    incierto: false,
    track_id: null,
    estado_sii: null,
    glosa_sii: null,
    informados: 0,
    aceptados: 0,
    rechazados: 0,
    reparos: 0,
    consultas: 0,
    error: null,
    enviado_en: null,
    ultima_consulta_en: null,
    xml_path: null,
  }),
  documentos: () => ({ estado: 'borrador', envio_id: null }),
  solicitudes_folios: () => ({
    estado: 'en_curso',
    caf_id: null,
    folio_desde: null,
    folio_hasta: null,
  }),
  cafs: () => ({ estado: 'activo', solicitud_id: null }),
  set_pruebas_casos: () => ({ referencia_codigo: 'SET', documento_id: null }),
  resoluciones: () => ({ vigente: true }),
};

/** Tabla padre de la que se hereda `organizacion_id` (trg_00_organizacion). */
const PADRE: Record<string, [string, string]> = {
  procesos_certificacion: ['empresas', 'empresa_id'],
  set_pruebas_casos: ['procesos_certificacion', 'proceso_id'],
  cafs: ['empresas', 'empresa_id'],
  solicitudes_folios: ['empresas', 'empresa_id'],
  envios: ['empresas', 'empresa_id'],
  documentos: ['empresas', 'empresa_id'],
  documento_detalles: ['documentos', 'documento_id'],
  folios_anulados: ['cafs', 'caf_id'],
  envio_estadisticas: ['envios', 'envio_id'],
  envio_rechazos: ['envios', 'envio_id'],
  consultas_envio: ['envios', 'envio_id'],
  resoluciones: ['empresas', 'empresa_id'],
};

export interface OpcionesFalso {
  /** Rol del cliente: `service_role` (por defecto) o `authenticated` (aplica tg_proteger_proceso). */
  rol?: 'service_role' | 'authenticated';
  tablas?: Record<string, Fila[]>;
  /** Comparte las tablas de otro falso (el cliente de sesión y el de servicio: misma base). */
  db?: Record<string, Fila[]>;
  secretos?: Map<string, string>;
}

export function supabaseFalso(opciones: OpcionesFalso = {}) {
  const rol = opciones.rol ?? 'service_role';
  const db: Record<string, Fila[]> = opciones.db ?? {};
  for (const [tabla, filas] of Object.entries(opciones.tablas ?? {})) {
    db[tabla] = filas.map((f) => ({ ...f }));
  }
  const secretos = opciones.secretos ?? new Map<string, string>();
  /** `<certificado>:<ambiente>` → titular del bloqueo. */
  const bloqueos = new Map<string, string>();
  const storage = new Map<string, { bytes: Buffer; contentType: string }>();
  const escrituras: Escritura[] = [];
  const rpcs: { nombre: string; args: Record<string, unknown> }[] = [];
  /** `tabla:accion` o `rpc:nombre` → error que se devuelve. */
  const fallas = new Map<string, ErrorPg>();
  let reloj = Date.parse('2026-11-13T15:00:00Z');
  const ahora = () => {
    reloj += 1000;
    return new Date(reloj).toISOString();
  };

  const tabla = (nombre: string): Fila[] => {
    db[nombre] ??= [];
    return db[nombre];
  };
  const porId = (nombre: string, id: unknown) => tabla(nombre).find((f) => f.id === id);

  function sincronizarDocumentos(envioId: unknown) {
    const e = porId('envios', envioId);
    if (!e || e.proposito === 'rcof') return;
    const clase = e.clasificacion;
    for (const d of tabla('documentos')) {
      if (d.envio_id !== e.id || d.estado === 'anulado') continue;
      if (clase === 'incierto') d.estado = 'incierto';
      else if (clase === 'en_proceso' || clase === 'inconsistente') d.estado = 'enviado';
      else if (clase === 'pendiente') continue;
      else if (e.estado_sii === 'EPR') {
        const obs = tabla('envio_rechazos').filter(
          (r) => r.envio_id === e.id && r.tipo_dte === d.tipo_dte && r.folio === d.folio,
        );
        d.estado = obs.some((r) => r.tipo_observacion === 'rechazo')
          ? 'rechazado'
          : obs.some((r) => r.tipo_observacion === 'reparo')
            ? 'aceptado_con_reparos'
            : 'aceptado';
      } else d.estado = 'rechazado';
    }
  }

  /** Triggers BEFORE (pueden lanzar) y columnas calculadas. */
  function antes(nombre: string, nueva: Fila, anterior: Fila | undefined): ErrorPg | null {
    const padre = PADRE[nombre];
    if (padre) {
      const [tablaPadre, columna] = padre;
      const p = porId(tablaPadre, nueva[columna]);
      if (!p) return { code: '23503', message: `No existe ${tablaPadre}` };
      nueva.organizacion_id = p.organizacion_id;
    }
    if (nombre === 'procesos_certificacion') {
      if (rol === 'authenticated') {
        if (!anterior) {
          nueva.etapa = 'borrador';
          nueva.codigo_estado_sii = null;
        } else if (
          nueva.etapa !== anterior.etapa ||
          nueva.codigo_estado_sii !== anterior.codigo_estado_sii ||
          nueva.paso_sii !== anterior.paso_sii
        ) {
          return { code: 'P0001', message: 'La etapa y el estado SII solo los cambia el sistema' };
        }
      }
      if (nueva.codigo_estado_sii === 'P91') nueva.etapa = 'autorizada';
      else if (
        nueva.codigo_estado_sii === 'P90' &&
        ETAPAS.indexOf(String(nueva.etapa)) < ETAPAS.indexOf('por_declarar')
      ) {
        nueva.etapa = 'por_declarar';
      }
      if (nueva.etapa === 'autorizada' && anterior?.etapa !== 'autorizada') {
        const empresa = porId('empresas', nueva.empresa_id);
        if (empresa) empresa.autorizada_produccion = true;
      }
    }
    if (nombre === 'cafs') nueva.siguiente_folio ??= nueva.folio_desde;
    if (nombre === 'envios') {
      if (nueva.incierto && nueva.track_id) {
        return { code: '23514', message: 'envios: incierto con track_id' };
      }
      nueva.clasificacion = clasificarEnvio(nueva);
    }
    if (nombre === 'documentos') {
      if (
        nueva.origen === 'set_pruebas' &&
        (nueva.ambiente !== 'certificacion' || nueva.caso_set == null)
      ) {
        return { code: '23514', message: 'documentos: set_pruebas' };
      }
      const total =
        Number(nueva.mnt_neto ?? 0) + Number(nueva.iva ?? 0) + Number(nueva.mnt_exe ?? 0);
      if (Number(nueva.mnt_total ?? 0) !== total) {
        return { code: '23514', message: 'documentos: mnt_total' };
      }
    }
    if (nombre === 'envio_rechazos' && nueva.documento_id == null) {
      const e = porId('envios', nueva.envio_id);
      const d = tabla('documentos').find(
        (x) =>
          x.empresa_id === e?.empresa_id &&
          x.tipo_dte === nueva.tipo_dte &&
          x.folio === nueva.folio,
      );
      nueva.documento_id = d?.id ?? null;
    }
    if (nombre === 'operaciones_sii' && !anterior) {
      const enIndice = (f: Fila) =>
        f.resultado === 'en_curso' &&
        f.confirmada === true &&
        f.empresa_id != null &&
        EFECTO_GLOBAL.includes(String(f.operacion));
      if (
        enIndice(nueva) &&
        tabla(nombre).some(
          (o) =>
            enIndice(o) &&
            o.empresa_id === nueva.empresa_id &&
            o.operacion === nueva.operacion &&
            o.ambiente === nueva.ambiente,
        )
      ) {
        return { code: '23505', message: 'operaciones_sii_efecto_global_en_curso' };
      }
    }
    return null;
  }

  /** Triggers AFTER. */
  function despues(nombre: string, nueva: Fila, anterior: Fila | undefined) {
    if (nombre === 'envios' && anterior) {
      const cambio = [
        'estado_sii',
        'incierto',
        'informados',
        'aceptados',
        'rechazados',
        'reparos',
      ].some((c) => nueva[c] !== anterior[c]);
      if (cambio) sincronizarDocumentos(nueva.id);
    }
    if (nombre === 'envio_rechazos') sincronizarDocumentos(nueva.envio_id);
    // tg_resolucion_autoriza_produccion (0009): la de producción vigente autoriza la empresa.
    if (nombre === 'resoluciones' && nueva.ambiente === 'produccion' && nueva.vigente) {
      const empresa = porId('empresas', nueva.empresa_id);
      if (empresa && empresa.organizacion_id === nueva.organizacion_id) {
        empresa.autorizada_produccion = true;
        empresa.autorizada_en ??= ahora();
      }
    }
  }

  function insertarFila(nombre: string, datos: Fila): { fila?: Fila; error?: ErrorPg } {
    const fila: Fila = {
      id: randomUUID(),
      creado_en: ahora(),
      ...(nombre === 'operaciones_sii' ? { iniciada_en: ahora() } : {}),
      ...(DEFAULTS[nombre]?.() ?? {}),
      ...structuredClone(datos),
    };
    const error = antes(nombre, fila, undefined);
    if (error) return { error };
    tabla(nombre).push(fila);
    despues(nombre, fila, undefined);
    return { fila };
  }

  function from(nombre: string) {
    let accion: 'select' | 'insert' | 'update' | 'upsert' | 'delete' = 'select';
    let datos: unknown;
    let conflicto: string[] = [];
    let devolver = false;
    let cabecera = false;
    let contar = false;
    const filtros: Filtro[] = [];
    let orden: { columna: string; asc: boolean } | undefined;
    let limite: number | undefined;
    const cumple = (f: Fila) => filtros.every((p) => p(f));

    function ejecutar(): Respuesta {
      const falla = fallas.get(`${nombre}:${accion}`);
      if (falla) return { data: null, error: falla };
      if (accion === 'insert' || accion === 'upsert') {
        escrituras.push({ tabla: nombre, accion, datos: structuredClone(datos) });
        const lista = (Array.isArray(datos) ? datos : [datos]) as Fila[];
        const salida: Fila[] = [];
        for (const d of lista) {
          if (accion === 'upsert' && conflicto.length > 0) {
            const existente = tabla(nombre).find((f) => conflicto.every((c) => f[c] === d[c]));
            if (existente) {
              const anterior = { ...existente };
              Object.assign(existente, structuredClone(d));
              const error = antes(nombre, existente, anterior);
              if (error) return { data: null, error };
              despues(nombre, existente, anterior);
              salida.push(existente);
              continue;
            }
          }
          const { fila, error } = insertarFila(nombre, d);
          if (error) return { data: null, error };
          if (fila) salida.push(fila);
        }
        return { data: devolver ? salida.map((f) => structuredClone(f)) : null, error: null };
      }
      if (accion === 'update') {
        escrituras.push({ tabla: nombre, accion, datos: structuredClone(datos) });
        const salida: Fila[] = [];
        for (const fila of tabla(nombre).filter(cumple)) {
          const anterior = { ...fila };
          Object.assign(fila, structuredClone(datos as Fila));
          const error = antes(nombre, fila, anterior);
          if (error) {
            Object.keys(fila).forEach((k) => {
              delete fila[k];
            });
            Object.assign(fila, anterior);
            return { data: null, error };
          }
          despues(nombre, fila, anterior);
          salida.push(fila);
        }
        return { data: devolver ? salida.map((f) => structuredClone(f)) : null, error: null };
      }
      if (accion === 'delete') {
        escrituras.push({ tabla: nombre, accion, datos: null });
        db[nombre] = tabla(nombre).filter((f) => !cumple(f));
        return { data: null, error: null };
      }
      let resultado = tabla(nombre).filter(cumple);
      if (orden) {
        const { columna, asc } = orden;
        resultado = [...resultado].sort((a, b) => {
          const x = a[columna];
          const y = b[columna];
          const c =
            typeof x === 'number' && typeof y === 'number'
              ? x - y
              : String(x).localeCompare(String(y));
          return asc ? c : -c;
        });
      }
      if (limite !== undefined) resultado = resultado.slice(0, limite);
      if (cabecera) return { data: null, error: null, count: resultado.length };
      return {
        data: resultado.map((f) => structuredClone(f)),
        error: null,
        ...(contar ? { count: resultado.length } : {}),
      };
    }

    const builder = {
      select(_columnas?: string, opciones?: { count?: string; head?: boolean }) {
        if (accion !== 'select') devolver = true;
        if (opciones?.head) cabecera = true;
        if (opciones?.count) contar = true;
        return builder;
      },
      insert(d: unknown) {
        accion = 'insert';
        datos = d;
        return builder;
      },
      upsert(d: unknown, o?: { onConflict?: string }) {
        accion = 'upsert';
        datos = d;
        conflicto = o?.onConflict?.split(',').map((c) => c.trim()) ?? [];
        return builder;
      },
      update(d: unknown) {
        accion = 'update';
        datos = d;
        return builder;
      },
      delete() {
        accion = 'delete';
        return builder;
      },
      eq(c: string, v: unknown) {
        filtros.push((f) => f[c] === v);
        return builder;
      },
      neq(c: string, v: unknown) {
        filtros.push((f) => f[c] !== v);
        return builder;
      },
      in(c: string, valores: unknown[]) {
        filtros.push((f) => valores.includes(f[c]));
        return builder;
      },
      is(c: string, v: unknown) {
        filtros.push((f) => (v === null ? f[c] == null : f[c] === v));
        return builder;
      },
      not(c: string, operador: string, valor: string) {
        if (operador !== 'in') throw new Error(`not ${operador} no implementado`);
        const lista = valor.replace(/^\(|\)$/g, '').split(',');
        filtros.push((f) => !lista.includes(String(f[c])));
        return builder;
      },
      order(columna: string, o: { ascending: boolean }) {
        orden = { columna, asc: o.ascending };
        return builder;
      },
      limit(n: number) {
        limite = n;
        return builder;
      },
      async single() {
        const r = ejecutar();
        const lista = r.data as Fila[] | null;
        if (!r.error && lista?.length !== 1) {
          return { data: null, error: { code: 'PGRST116', message: 'no es una sola fila' } };
        }
        return { data: lista?.[0] ?? null, error: r.error };
      },
      async maybeSingle() {
        const r = ejecutar();
        return { data: (r.data as Fila[] | null)?.[0] ?? null, error: r.error };
      },
      // biome-ignore lint/suspicious/noThenProperty: imita el builder thenable de supabase-js.
      then<A, B>(bien: (v: Respuesta) => A, mal?: (e: unknown) => B) {
        return Promise.resolve()
          .then(() => ejecutar())
          .then(bien, mal);
      },
    };
    return builder;
  }

  // --- RPC -------------------------------------------------------------------------

  const rpcImpl: Record<string, (a: Record<string, unknown>) => Respuesta> = {
    leer_secreto: (a) => ({ data: secretos.get(String(a.p_id)) ?? null, error: null }),
    guardar_secreto: (a) => {
      const id = randomUUID();
      secretos.set(id, String(a.p_secreto));
      return { data: id, error: null };
    },
    // Bloqueo con arriendo (0007) sin vencimiento: un titular por certificado y ambiente.
    tomar_bloqueo_certificado: (a) => {
      const llave = `${String(a.p_certificado)}:${String(a.p_ambiente)}`;
      const titular = bloqueos.get(llave);
      if (titular !== undefined && titular !== a.p_titular) return { data: false, error: null };
      bloqueos.set(llave, String(a.p_titular));
      return { data: true, error: null };
    },
    liberar_bloqueo_certificado: (a) => {
      const llave = `${String(a.p_certificado)}:${String(a.p_ambiente)}`;
      if (bloqueos.get(llave) !== a.p_titular) return { data: false, error: null };
      bloqueos.delete(llave);
      return { data: true, error: null };
    },
    token_obtener: () => ({ data: [], error: null }),
    token_guardar: () => ({ data: null, error: null }),
    token_borrar: () => ({ data: null, error: null }),
    asignar_folio: (a) => {
      const caf = tabla('cafs')
        .filter(
          (c) =>
            c.empresa_id === a.p_empresa &&
            c.ambiente === a.p_ambiente &&
            c.tipo_dte === a.p_tipo_dte &&
            c.estado === 'activo' &&
            Number(c.siguiente_folio) <= Number(c.folio_hasta),
        )
        .sort((x, y) => Number(x.folio_desde) - Number(y.folio_desde))[0];
      if (!caf) return { data: null, error: { code: 'P0002', message: 'No quedan folios' } };
      const folio = Number(caf.siguiente_folio);
      caf.siguiente_folio = folio + 1;
      if (folio + 1 > Number(caf.folio_hasta)) caf.estado = 'agotado';
      return { data: [{ caf_id: caf.id, folio }], error: null };
    },
    registrar_caf: (a) => {
      const empresa = porId('empresas', a.p_empresa);
      if (!empresa || empresa.organizacion_id !== a.p_organizacion) {
        return { data: null, error: { code: 'P0002', message: 'La empresa no existe' } };
      }
      if (String(a.p_rut_emisor).toUpperCase() !== empresa.rut) {
        return { data: null, error: { code: '22023', message: 'otra empresa' } };
      }
      const existente = tabla('cafs').find(
        (c) =>
          c.empresa_id === a.p_empresa &&
          c.ambiente === a.p_ambiente &&
          c.tipo_dte === a.p_tipo_dte &&
          c.folio_desde === a.p_folio_desde,
      );
      let id: string;
      if (existente) {
        if (existente.folio_hasta !== a.p_folio_hasta) {
          return { data: null, error: { code: '23505', message: 'otro rango' } };
        }
        id = String(existente.id);
      } else {
        const secreto = randomUUID();
        secretos.set(secreto, String(a.p_caf_xml));
        const { fila, error } = insertarFila('cafs', {
          organizacion_id: a.p_organizacion,
          empresa_id: a.p_empresa,
          ambiente: a.p_ambiente,
          tipo_dte: a.p_tipo_dte,
          folio_desde: a.p_folio_desde,
          folio_hasta: a.p_folio_hasta,
          fecha_autorizacion: a.p_fecha_autorizacion,
          idk: a.p_idk,
          rut_emisor: a.p_rut_emisor,
          razon_social: a.p_razon_social || null,
          caf_secret_id: secreto,
          solicitud_id: a.p_solicitud ?? null,
        });
        if (error || !fila) return { data: null, error: error ?? null };
        id = String(fila.id);
      }
      const solicitud = porId('solicitudes_folios', a.p_solicitud);
      if (solicitud) {
        Object.assign(solicitud, {
          estado: 'timbrada',
          folio_desde: a.p_folio_desde,
          folio_hasta: a.p_folio_hasta,
          caf_id: id,
          terminado_en: solicitud.terminado_en ?? ahora(),
        });
      }
      return { data: id, error: null };
    },
    guardar_set_pruebas: (a) => {
      const proceso = porId('procesos_certificacion', a.p_proceso);
      if (!proceso || proceso.organizacion_id !== a.p_organizacion) {
        return { data: null, error: { code: 'P0002', message: 'no existe el proceso' } };
      }
      if (ETAPAS.indexOf(String(proceso.etapa)) >= ETAPAS.indexOf('por_declarar')) {
        return { data: null, error: { code: '22023', message: 'por declarar' } };
      }
      const casos = a.p_casos as Fila[];
      if (!Array.isArray(casos) || casos.length === 0) {
        return { data: null, error: { code: '22023', message: 'sin casos' } };
      }
      db.set_pruebas_casos = tabla('set_pruebas_casos').filter((c) => c.proceso_id !== proceso.id);
      for (const c of casos) {
        insertarFila('set_pruebas_casos', {
          proceso_id: proceso.id,
          numero_caso: c.numero_caso,
          tipo_dte: c.tipo_dte ?? 39,
          detalles: c.detalles,
          referencia_codigo: c.referencia_codigo || 'SET',
          referencia_razon: c.referencia_razon,
        });
      }
      const anterior = { ...proceso };
      Object.assign(proceso, {
        etapa: 'set_descargado',
        set_pruebas_texto: a.p_texto,
        correo_proveedor_set: a.p_correo_proveedor ?? proceso.correo_proveedor_set,
        set_descargado_en: ahora(),
        envio_set_id: null,
        revision_solicitada_en: null,
      });
      antes('procesos_certificacion', proceso, anterior);
      return { data: casos.length, error: null };
    },
    registrar_resolucion: (a) => {
      for (const r of tabla('resoluciones')) {
        if (r.empresa_id === a.p_empresa && r.ambiente === a.p_ambiente) r.vigente = false;
      }
      const { fila, error } = insertarFila('resoluciones', {
        empresa_id: a.p_empresa,
        ambiente: a.p_ambiente,
        numero: a.p_numero,
        fecha: a.p_fecha,
        vigente: true,
      });
      return { data: fila?.id ?? null, error: error ?? null };
    },
  };

  async function rpc(nombre: string, args: Record<string, unknown>): Promise<Respuesta> {
    rpcs.push({ nombre, args: structuredClone(args) });
    if (nombre !== 'leer_secreto' && !nombre.startsWith('token_') && !nombre.includes('bloqueo')) {
      escrituras.push({ tabla: nombre, accion: 'rpc', datos: structuredClone(args) });
    }
    const falla = fallas.get(`rpc:${nombre}`);
    if (falla) return { data: null, error: falla };
    const impl = rpcImpl[nombre];
    if (!impl) throw new Error(`RPC no implementada en el falso: ${nombre}`);
    return impl(args);
  }

  // --- Storage ----------------------------------------------------------------------

  const almacenamiento = {
    from(bucket: string) {
      return {
        async upload(ruta: string, cuerpo: Buffer, o: { contentType: string; upsert?: boolean }) {
          const clave = `${bucket}/${ruta}`;
          const falla = fallas.get('storage:upload');
          if (falla) return { data: null, error: { status: 500, message: falla.message } };
          if (storage.has(clave) && !o.upsert) {
            return { data: null, error: { status: 409, message: 'existe' } };
          }
          storage.set(clave, { bytes: Buffer.from(cuerpo), contentType: o.contentType });
          escrituras.push({ tabla: bucket, accion: 'storage', datos: ruta });
          return { data: { path: ruta }, error: null };
        },
        async createSignedUrl(ruta: string) {
          return { data: { signedUrl: `https://falso/${ruta}` }, error: null };
        },
      };
    },
  };

  return {
    cliente: { from, rpc, storage: almacenamiento } as unknown as ClienteServicio,
    db,
    tabla,
    secretos,
    storage,
    escrituras,
    rpcs,
    fallas,
  };
}

export type SupabaseFalso = ReturnType<typeof supabaseFalso>;
