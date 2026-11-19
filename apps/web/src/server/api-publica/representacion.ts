import 'server-only';
import type {
  CafApi,
  DocumentoApi,
  EnvioApi,
  ErrorSiiApi,
  LineaApi,
  RechazoApi,
} from '@/lib/api-publica';
import { leerMetadata } from '../emision/borradores';
import type { Json } from '../supabase/tipos';
import { empresaRef } from './empresas';
import type {
  FilaCafApi,
  FilaDocumentoApi,
  FilaDocumentoEnvioApi,
  FilaEmpresaApi,
  FilaEnvioApi,
  FilaEnvioCortaApi,
  FilaLineaApi,
  FilaRechazoApi,
} from './repositorio';

// Filas de la base → formas del contrato (`@/lib/api-publica`). Puras: sin red ni base.
// Nada de rutas de Storage, TED, metadatos internos ni secretos: solo lo que el cliente
// necesita para conciliar (id, folio, estado, totales, Track ID).

/** Aviso cuando el estado no es definitivo y el cliente tiene que hacer algo. */
export function avisoDeEstado(estado: DocumentoApi['estado']): DocumentoApi['aviso'] {
  if (estado === 'incierto') {
    return {
      titulo: 'No sabemos si el SII recibió la boleta',
      detalle:
        'La comunicación con el SII falló después de enviarla: pudo haber llegado. No la vuelvas a emitir con otra Idempotency-Key: revisa su folio en el portal del SII o espera el webhook documento.incierto.',
    };
  }
  if (estado === 'firmado') {
    return {
      titulo: 'La boleta quedó firmada pero sin Track ID',
      detalle:
        'Se firmó y se asignó su folio, pero no tenemos el Track ID del envío. No la vuelvas a emitir con otra Idempotency-Key: consulta el documento en unos minutos o escríbenos a soporte.',
    };
  }
  return undefined;
}

export function representarLinea(l: FilaLineaApi): LineaApi {
  return {
    nro: l.nro_linea,
    nombre: l.nombre,
    cantidad: Number(l.cantidad),
    unidad: l.unidad,
    precio: Number(l.precio),
    exento: l.exento,
    descuento: l.descuento_monto,
    monto: l.monto_item,
  };
}

export function representarDocumento(
  d: FilaDocumentoApi,
  empresa: Pick<FilaEmpresaApi, 'id' | 'rut' | 'razon_social'>,
  envio: FilaEnvioCortaApi | null,
  lineas?: readonly FilaLineaApi[],
): DocumentoApi {
  const aviso = avisoDeEstado(d.estado);
  return {
    objeto: 'documento',
    id: d.id,
    empresa: empresaRef(empresa),
    ambiente: d.ambiente,
    tipo_dte: d.tipo_dte === 41 ? 41 : 39,
    folio: d.folio,
    estado: d.estado,
    fecha_emision: d.fecha_emision,
    receptor: {
      rut: d.receptor_rut,
      razon_social: d.receptor_razon_social,
      correo: leerMetadata(d.metadata).receptor_correo ?? null,
    },
    totales: {
      neto: d.mnt_neto,
      exento: d.mnt_exe,
      iva: d.iva,
      total: d.mnt_total,
      descuento: d.descuento_aplicado,
    },
    ...(lineas ? { lineas: lineas.map(representarLinea) } : {}),
    envio: envio ? { id: envio.id, track_id: envio.track_id, estado_sii: envio.estado_sii } : null,
    origen: d.origen,
    clave_idempotencia: d.clave_idempotencia,
    ...(aviso ? { aviso } : {}),
    creado_en: d.creado_en,
    actualizado_en: d.actualizado_en,
  };
}

function textoONulo(v: unknown): string | null {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : null;
}

/** `envio_rechazos.errores` (`{ seccion, linea, nivel, codigo, descripcion, detalle }[]`). */
export function representarErrores(errores: Json): ErrorSiiApi[] {
  if (!Array.isArray(errores)) return [];
  return errores.flatMap((e) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) return [];
    const x = e as Record<string, unknown>;
    const linea = typeof x.linea === 'number' ? x.linea : Number(x.linea);
    return [
      {
        seccion: textoONulo(x.seccion),
        linea: Number.isFinite(linea) && x.linea !== null && x.linea !== '' ? linea : null,
        nivel: textoONulo(x.nivel),
        codigo: textoONulo(x.codigo),
        descripcion: textoONulo(x.descripcion),
        detalle: textoONulo(x.detalle),
      },
    ];
  });
}

export function representarRechazo(r: FilaRechazoApi): RechazoApi {
  return {
    tipo_dte: r.tipo_dte,
    folio: r.folio,
    documento_id: r.documento_id,
    estado: r.estado,
    tipo_observacion: r.tipo_observacion,
    descripcion: r.descripcion,
    errores: representarErrores(r.errores),
  };
}

export function representarEnvio(
  e: FilaEnvioApi,
  empresa: Pick<FilaEmpresaApi, 'id' | 'rut' | 'razon_social'>,
  documentos: readonly FilaDocumentoEnvioApi[],
  rechazos: readonly FilaRechazoApi[],
): EnvioApi {
  return {
    objeto: 'envio',
    id: e.id,
    empresa: empresaRef(empresa),
    ambiente: e.ambiente,
    canal: e.canal,
    proposito: e.proposito,
    track_id: e.track_id,
    estado_sii: e.estado_sii,
    glosa_sii: e.glosa_sii,
    clasificacion: e.clasificacion,
    incierto: e.incierto,
    conteos: {
      informados: e.informados,
      aceptados: e.aceptados,
      rechazados: e.rechazados,
      reparos: e.reparos,
    },
    caratula: { rut_envia: e.rut_envia, nro_resol: e.nro_resol, fch_resol: e.fch_resol },
    documentos: documentos.map((d) => ({
      id: d.id,
      tipo_dte: d.tipo_dte,
      folio: d.folio,
      estado: d.estado,
    })),
    rechazos: rechazos.map(representarRechazo),
    consultas: e.consultas,
    enviado_en: e.enviado_en,
    ultima_consulta_en: e.ultima_consulta_en,
    creado_en: e.creado_en,
    actualizado_en: e.actualizado_en,
  };
}

export function representarCaf(c: FilaCafApi): CafApi {
  const disponibles =
    c.estado === 'activo' ? Math.max(0, c.folio_hasta - c.siguiente_folio + 1) : 0;
  return {
    id: c.id,
    folio_desde: c.folio_desde,
    folio_hasta: c.folio_hasta,
    siguiente_folio: c.siguiente_folio,
    disponibles,
    estado: c.estado,
    fecha_autorizacion: c.fecha_autorizacion,
  };
}
