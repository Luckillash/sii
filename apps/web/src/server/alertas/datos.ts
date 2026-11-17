import 'server-only';
import type { ClienteServicio } from '../supabase/service';
import type { Json } from '../supabase/tipos';
import { LARGO_MAXIMO_MOTIVO, LIMITE_POR_LECTURA, type UmbralCertificado } from './constantes';

// Lecturas y escrituras de las alertas (service_role: el cron no tiene sesión, así que
// cada consulta va acotada por lo que detecta y cada correo por la organización del
// objeto). Detrás de una interfaz para que `ejecutarAlertas` se pruebe sin base.
//
// Los candidatos salen de las funciones de la 0013 (`alertas_documentos_rechazados`,
// `alertas_envios_inciertos`, `alertas_certificados_por_vencer`), que ya excluyen lo
// avisado y reparten por turnos entre organizaciones: con un `.order().limit()` global
// desde aquí, una organización con muchos eventos tapaba a las demás.
//
// Ninguna función devuelve ni registra secretos: ids, RUT, montos, estados y el motivo
// del SII acotado. Ante un error de la base lanzan `ErrorDatosAlertas` con el código de
// PostgREST, nunca con el mensaje (puede traer valores de la fila).

export type Ambiente = 'certificacion' | 'produccion';

export interface OrganizacionAlerta {
  id: string;
  nombre: string;
  slug: string;
}

export interface EmpresaAlerta {
  id: string;
  razonSocial: string;
  rut: string;
}

export interface DocumentoRechazadoFila {
  id: string;
  organizacionId: string;
  empresaId: string;
  ambiente: Ambiente;
  tipoDte: number;
  folio: number | null;
  mntTotal: number;
  fechaEmision: string;
  envioId: string | null;
  /** Primer error de rechazo que informó el SII (o la glosa del envío), acotado. */
  motivo: string | null;
}

export interface EnvioInciertoFila {
  id: string;
  organizacionId: string;
  empresaId: string;
  ambiente: Ambiente;
  creadoEn: string;
  documentos: { tipoDte: number; folio: number | null; mntTotal: number }[];
}

export interface CertificadoPorVencerFila {
  id: string;
  organizacionId: string;
  titular: string;
  rut: string;
  venceEn: string;
  /** `dias_restantes` de `v_certificados_estado` (días completos; 0 = menos de 24 h). */
  dias: number;
  /** Umbral que calculó la base para esos días (el mismo que `umbralCertificado`). */
  umbral: UmbralCertificado;
  /** Razones sociales de las empresas asociadas. */
  empresas: string[];
}

export interface NuevaNotificacion {
  organizacionId: string;
  tipo: string;
  clave: string;
  referenciaId: string | null;
  datos: Record<string, Json>;
}

/** Lo que entrega `reclamar_notificacion` cuando hay que enviar. */
export interface Reclamada {
  id: string;
  /** 1 = nueva; más = reintento. */
  intentos: number;
  /** `Idempotency-Key` del correo que ya la llevó (reintento), o null si es nueva. */
  grupo: string | null;
}

export type CierreNotificacion =
  | { estado: 'enviada'; resendId: string; destinatarios: string[]; enviadoEn: string }
  | { estado: 'fallida'; error: string; destinatarios: string[] };

export interface RepositorioAlertas {
  /** Rechazados en la ventana, sin los ya avisados, por turnos entre organizaciones. */
  documentosRechazados(desde: string): Promise<DocumentoRechazadoFila[]>;
  /** Inciertos de emisión en la ventana, sin los ya avisados, por turnos. */
  enviosInciertos(desde: string): Promise<EnvioInciertoFila[]>;
  /**
   * Por vencer con su umbral, sin el aviso de ese umbral ya enviado y sin los ya
   * reemplazados por uno vigente que no son predeterminados de nadie.
   */
  certificadosPorVencer(): Promise<CertificadoPorVencerFila[]>;
  organizaciones(ids: string[]): Promise<Map<string, OrganizacionAlerta>>;
  empresas(ids: string[]): Promise<Map<string, EmpresaAlerta>>;
  /** Correos de propietarios y administradores por organización (sin repetir). */
  destinatarios(organizaciones: string[]): Promise<Map<string, string[]>>;
  /** `reclamar_notificacion`: la fila si hay que enviarla, null si ya salió o está en curso. */
  reclamar(n: NuevaNotificacion): Promise<Reclamada | null>;
  /** Fija la `Idempotency-Key` del correo en las filas antes de enviarlo. */
  fijarGrupo(ids: string[], grupo: string): Promise<void>;
  cerrar(ids: string[], cierre: CierreNotificacion): Promise<void>;
}

export class ErrorDatosAlertas extends Error {
  constructor(
    readonly operacion: string,
    readonly codigo: string,
  ) {
    super(`alertas: falló ${operacion} (código ${codigo})`);
    this.name = 'ErrorDatosAlertas';
  }
}

function revisar<T>(operacion: string, r: { data: T | null; error: { code?: string } | null }): T {
  if (r.error) throw new ErrorDatosAlertas(operacion, r.error.code || 'desconocido');
  return (r.data ?? []) as T;
}

const unicos = (valores: (string | null | undefined)[]) => [
  ...new Set(valores.filter((v): v is string => typeof v === 'string' && v.length > 0)),
];

// biome-ignore lint/suspicious/noControlCharactersInRegex: se quitan justamente los controles.
const CONTROLES = /[\u0000-\u001f\u007f]+/g;

/** Texto del SII para el correo: una línea, sin controles y acotado. */
export function acotarMotivo(texto: unknown): string | null {
  if (typeof texto !== 'string') return null;
  const limpio = texto.replace(CONTROLES, ' ').replace(/\s+/g, ' ').trim();
  if (!limpio) return null;
  return limpio.length > LARGO_MAXIMO_MOTIVO
    ? `${limpio.slice(0, LARGO_MAXIMO_MOTIVO - 1).trimEnd()}…`
    : limpio;
}

/** Primer `descripcion` de `envio_rechazos.errores` o, si no hay, la `descripcion` de la fila. */
function motivoDeRechazo(fila: { descripcion: string | null; errores: Json }): string | null {
  if (Array.isArray(fila.errores)) {
    for (const e of fila.errores) {
      if (e && typeof e === 'object' && !Array.isArray(e)) {
        const m = acotarMotivo((e as Record<string, unknown>).descripcion);
        if (m) return m;
      }
    }
  }
  return acotarMotivo(fila.descripcion);
}

const UMBRALES_VALIDOS = new Set<number>([1, 7, 15, 30]);

export function repositorioSupabase(cliente: ClienteServicio): RepositorioAlertas {
  async function empresas(ids: string[]): Promise<Map<string, EmpresaAlerta>> {
    const mapa = new Map<string, EmpresaAlerta>();
    const lista = unicos(ids);
    if (lista.length === 0) return mapa;
    const filas = revisar(
      'leer empresas',
      await cliente.from('empresas').select('id, razon_social, rut').in('id', lista),
    );
    for (const e of filas) mapa.set(e.id, { id: e.id, razonSocial: e.razon_social, rut: e.rut });
    return mapa;
  }

  return {
    async documentosRechazados(desde) {
      const docs = revisar(
        'leer documentos rechazados',
        await cliente.rpc('alertas_documentos_rechazados', {
          p_desde: desde,
          p_limite: LIMITE_POR_LECTURA,
        }),
      );
      if (docs.length === 0) return [];

      const motivos = new Map<string, string>();
      const observaciones = revisar(
        'leer rechazos',
        await cliente
          .from('envio_rechazos')
          .select('documento_id, descripcion, errores')
          .in(
            'documento_id',
            docs.map((d) => d.id),
          )
          .eq('tipo_observacion', 'rechazo'),
      );
      for (const o of observaciones) {
        if (!o.documento_id || motivos.has(o.documento_id)) continue;
        const m = motivoDeRechazo(o);
        if (m) motivos.set(o.documento_id, m);
      }
      // Un rechazo del sobre completo (RSC, RFR, RCT, RCH) no trae filas por documento:
      // el motivo es la glosa del envío.
      const sinMotivo = unicos(docs.filter((d) => !motivos.has(d.id)).map((d) => d.envio_id));
      const glosas = new Map<string, string>();
      if (sinMotivo.length > 0) {
        const envios = revisar(
          'leer envíos rechazados',
          await cliente.from('envios').select('id, glosa_sii').in('id', sinMotivo),
        );
        for (const e of envios) {
          const g = acotarMotivo(e.glosa_sii);
          if (g) glosas.set(e.id, g);
        }
      }

      return docs.map((d) => ({
        id: d.id,
        organizacionId: d.organizacion_id,
        empresaId: d.empresa_id,
        ambiente: d.ambiente,
        tipoDte: d.tipo_dte,
        folio: d.folio,
        mntTotal: d.mnt_total,
        fechaEmision: d.fecha_emision,
        envioId: d.envio_id,
        motivo: motivos.get(d.id) ?? (d.envio_id ? (glosas.get(d.envio_id) ?? null) : null),
      }));
    },

    async enviosInciertos(desde) {
      const envios = revisar(
        'leer envíos inciertos',
        await cliente.rpc('alertas_envios_inciertos', {
          p_desde: desde,
          p_limite: LIMITE_POR_LECTURA,
        }),
      );
      if (envios.length === 0) return [];
      const docs = revisar(
        'leer documentos de envíos inciertos',
        await cliente
          .from('documentos')
          .select('envio_id, tipo_dte, folio, mnt_total')
          .in(
            'envio_id',
            envios.map((e) => e.id),
          ),
      );
      return envios.map((e) => ({
        id: e.id,
        organizacionId: e.organizacion_id,
        empresaId: e.empresa_id,
        ambiente: e.ambiente,
        creadoEn: e.creado_en,
        documentos: docs
          .filter((d) => d.envio_id === e.id)
          .map((d) => ({ tipoDte: d.tipo_dte, folio: d.folio, mntTotal: d.mnt_total }))
          .sort((a, b) => (a.folio ?? 0) - (b.folio ?? 0)),
      }));
    },

    async certificadosPorVencer() {
      const filas = revisar(
        'leer certificados por vencer',
        await cliente.rpc('alertas_certificados_por_vencer', { p_limite: LIMITE_POR_LECTURA }),
      );
      const porVencer = filas.filter((f) => UMBRALES_VALIDOS.has(f.umbral));
      if (porVencer.length === 0) return [];

      const asociaciones = revisar(
        'leer empresas de los certificados',
        await cliente
          .from('empresa_certificados')
          .select('certificado_id, empresa_id, predeterminado')
          .in(
            'certificado_id',
            porVencer.map((c) => c.id),
          ),
      );
      const nombres = await empresas(asociaciones.map((a) => a.empresa_id));

      // ¿Ya subieron el reemplazo? Otro certificado del mismo titular en la organización,
      // no revocado y vigente por más de 30 días. Si además el que vence ya no es el
      // predeterminado de ninguna empresa, el aviso sobra. Sin RUT del titular no se puede
      // emparejar: nunca se da por reemplazado (un nulo no calza con otro nulo).
      const conRut = porVencer.filter((c) => Boolean(c.rut_titular?.trim()));
      const renovado = new Set<string>();
      if (conRut.length > 0) {
        const limite = new Date(Date.now() + 30 * 86_400_000).toISOString();
        const reemplazos = revisar(
          'leer certificados de reemplazo',
          await cliente
            .from('certificados')
            .select('id, organizacion_id, rut_titular')
            .in('organizacion_id', unicos(conRut.map((c) => c.organizacion_id)))
            .in('rut_titular', unicos(conRut.map((c) => c.rut_titular)))
            .is('revocado_en', null)
            .gt('vigente_hasta', limite),
        );
        for (const r of reemplazos) {
          if (r.rut_titular?.trim()) renovado.add(`${r.organizacion_id}:${r.rut_titular.trim()}`);
        }
      }

      return porVencer
        .filter((c) => {
          const predeterminado = asociaciones.some(
            (a) => a.certificado_id === c.id && a.predeterminado,
          );
          const rut = c.rut_titular?.trim();
          return predeterminado || !rut || !renovado.has(`${c.organizacion_id}:${rut}`);
        })
        .map((c) => ({
          id: c.id,
          organizacionId: c.organizacion_id,
          titular: c.nombre_titular?.trim() || c.cn?.trim() || 'el titular',
          rut: c.rut_titular?.trim() ?? '',
          venceEn: c.vigente_hasta,
          dias: Math.max(0, c.dias_restantes ?? 0),
          umbral: c.umbral as UmbralCertificado,
          empresas: unicos(
            asociaciones
              .filter((a) => a.certificado_id === c.id)
              .map((a) => nombres.get(a.empresa_id)?.razonSocial),
          ).sort((a, b) => a.localeCompare(b, 'es')),
        }));
    },

    async organizaciones(ids) {
      const mapa = new Map<string, OrganizacionAlerta>();
      const lista = unicos(ids);
      if (lista.length === 0) return mapa;
      const filas = revisar(
        'leer organizaciones',
        await cliente.from('organizaciones').select('id, nombre, slug').in('id', lista),
      );
      for (const o of filas) mapa.set(o.id, { id: o.id, nombre: o.nombre, slug: o.slug });
      return mapa;
    },

    empresas,

    async destinatarios(organizaciones) {
      const mapa = new Map<string, string[]>();
      const lista = unicos(organizaciones);
      if (lista.length === 0) return mapa;
      // Los mismos destinatarios que la alerta de folios (`server/folios/alertas.ts`):
      // propietarios y administradores, con el correo de su perfil.
      const miembros = revisar(
        'leer administradores',
        await cliente
          .from('miembros_organizacion')
          .select('organizacion_id, usuario_id')
          .in('organizacion_id', lista)
          .in('rol', ['propietario', 'administrador']),
      );
      const usuarios = unicos(miembros.map((m) => m.usuario_id));
      const correos = new Map<string, string>();
      if (usuarios.length > 0) {
        const perfiles = revisar(
          'leer correos',
          await cliente.from('perfiles').select('id, correo').in('id', usuarios),
        );
        for (const p of perfiles) {
          const correo = p.correo?.trim().toLowerCase() ?? '';
          if (correo.includes('@')) correos.set(p.id, correo);
        }
      }
      for (const org of lista) {
        mapa.set(
          org,
          unicos(
            miembros.filter((m) => m.organizacion_id === org).map((m) => correos.get(m.usuario_id)),
          ),
        );
      }
      return mapa;
    },

    async reclamar(n) {
      const filas = revisar(
        'reclamar la notificación',
        await cliente.rpc('reclamar_notificacion', {
          p_organizacion: n.organizacionId,
          p_tipo: n.tipo,
          p_clave: n.clave,
          ...(n.referenciaId ? { p_referencia: n.referenciaId } : {}),
          p_datos: n.datos,
        }),
      );
      const fila = Array.isArray(filas) ? filas[0] : undefined;
      if (!fila || typeof fila.id !== 'string' || fila.id.length === 0) return null;
      return { id: fila.id, intentos: fila.intentos ?? 1, grupo: fila.grupo ?? null };
    },

    async fijarGrupo(ids, grupo) {
      if (ids.length === 0) return;
      revisar(
        'fijar el grupo de la notificación',
        await cliente
          .from('notificaciones')
          .update({ grupo })
          .in('id', ids)
          .eq('estado', 'pendiente'),
      );
    },

    async cerrar(ids, cierre) {
      if (ids.length === 0) return;
      const cambios =
        cierre.estado === 'enviada'
          ? {
              estado: 'enviada',
              enviado_en: cierre.enviadoEn,
              resend_id: cierre.resendId,
              destinatarios: cierre.destinatarios,
              error: null,
            }
          : { estado: 'fallida', error: cierre.error, destinatarios: cierre.destinatarios };
      revisar(
        'cerrar la notificación',
        await cliente
          .from('notificaciones')
          .update(cambios)
          .in('id', ids)
          // Solo la que esta corrida reclamó: no pisa una que otra corrida ya cerró.
          .eq('estado', 'pendiente'),
      );
    },
  };
}
