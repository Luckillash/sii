import 'server-only';
import { X509Certificate } from 'node:crypto';
import {
  Certificado,
  FirmaElectronica,
  huellaCertificado,
  type Reloj,
  relojSistema,
} from '@winex/certificacion';
import { formatearFecha } from '@/lib/formatos';
import type { MensajeError } from '@/server/equipo-errores';
import type { ClienteServicio } from '../supabase/service';

// Credenciales del SII de una empresa (PLAN-SAAS Fase 4): lee el .pfx (base64) y su
// clave desde Vault con `leer_secreto()` (solo service_role) y los abre con
// `Certificado.desdeContenido` de la librería (principio 4). Todo queda en memoria:
// ni el .pfx ni la clave ni la llave privada se escriben a disco, a logs o a Sentry.
//
// Caché POR INVOCACIÓN: `crearCredenciales()` se llama una vez por petición (Server
// Action, ruta o cron) y su caché muere con ella. Nunca se guarda en una variable de
// módulo: en Vercel una instancia atiende a varios usuarios y la llave privada de una
// organización no puede quedar al alcance de otra.
//
// service_role salta RLS: cada consulta filtra por `organizacion_id` (principio 2).
// Los certificados con `revocado_en` no se usan (decisión de la Fase 3).

/**
 * Por qué no se pudo cargar el certificado.
 *
 *   sin_certificado    No existe en la organización, o la empresa no tiene uno
 *                      predeterminado.
 *   sin_representante  Se pidió un representante electrónico y la empresa no tiene
 *                      ninguno vigente asociado.
 *   revocado           El certificado tiene `revocado_en`.
 *   vencido            Pasó su `vigente_hasta`.
 *   no_vigente         Todavía no empieza a regir.
 *   huella_distinta    El .pfx de Vault no es el certificado de la fila.
 *   ilegible           El .pfx de Vault no abre con su clave.
 *   vault              Falta un secreto en Vault (o está vacío).
 *   base               Supabase no respondió (lectura de la fila o de Vault).
 */
export type MotivoCredenciales =
  | 'sin_certificado'
  | 'sin_representante'
  | 'revocado'
  | 'vencido'
  | 'no_vigente'
  | 'huella_distinta'
  | 'ilegible'
  | 'vault'
  | 'base';

/**
 * Resultado de `operaciones_sii` que le corresponde a cada motivo: todos son
 * configuración (código 3, nada salió al SII) salvo `base`, que es una falla
 * pasajera de Supabase (código 1, se puede reintentar).
 */
export const RESULTADO_DEL_MOTIVO: Readonly<Record<MotivoCredenciales, 'config' | 'error'>> = {
  sin_certificado: 'config',
  sin_representante: 'config',
  revocado: 'config',
  vencido: 'config',
  no_vigente: 'config',
  huella_distinta: 'config',
  ilegible: 'config',
  vault: 'config',
  base: 'error',
};

interface DatosMensaje {
  /** `empresa`: se buscó el certificado de una empresa; `certificado`: por id. */
  readonly ambito: 'empresa' | 'certificado';
  readonly vigenteDesde?: Date;
  readonly vigenteHasta?: Date;
  /** Código de PostgREST (solo `base`). */
  readonly codigo?: string;
}

const RUTA_CERTIFICADOS = 'Configuración → Certificados';
const RUTA_EMPRESA = 'Configuración → Empresas → Certificados';

function mensajeDelMotivo(motivo: MotivoCredenciales, datos: DatosMensaje): MensajeError {
  switch (motivo) {
    case 'sin_certificado':
      return datos.ambito === 'empresa'
        ? {
            titulo: 'La empresa no tiene un certificado predeterminado',
            detalle: `Asocia un certificado vigente a la empresa y márcalo como predeterminado en ${RUTA_EMPRESA}.`,
          }
        : {
            titulo: 'No encontramos el certificado',
            detalle: `Puede que lo hayan eliminado. Revisa la lista en ${RUTA_CERTIFICADOS}.`,
          };
    case 'sin_representante':
      return {
        titulo: 'La empresa no tiene un representante electrónico con certificado vigente',
        detalle: `Para pedir folios, el titular del certificado tiene que ser representante electrónico de la empresa ante el SII. Asocia su certificado y marca «Representante electrónico» en ${RUTA_EMPRESA}.`,
      };
    case 'revocado':
      return datos.ambito === 'empresa'
        ? {
            titulo: 'El certificado predeterminado de la empresa está revocado',
            detalle: `Marca otro certificado como predeterminado en ${RUTA_EMPRESA}.`,
          }
        : {
            titulo: 'El certificado está revocado',
            detalle: `Elige otro certificado o sube uno nuevo en ${RUTA_CERTIFICADOS}.`,
          };
    case 'vencido':
      return {
        titulo: 'El certificado está vencido',
        detalle: `${datos.vigenteHasta ? `Venció el ${formatearFecha(datos.vigenteHasta)}. ` : ''}Renuévalo con tu entidad certificadora y sube el nuevo en ${RUTA_CERTIFICADOS}.`,
      };
    case 'no_vigente':
      return {
        titulo: 'El certificado todavía no está vigente',
        detalle: `${datos.vigenteDesde ? `Empieza a regir el ${formatearFecha(datos.vigenteDesde)}. ` : ''}Vuelve a intentarlo desde esa fecha o usa otro certificado.`,
      };
    case 'huella_distinta':
      return {
        titulo: 'El certificado guardado no coincide con su registro',
        detalle: `Vuelve a subir el archivo .pfx en ${RUTA_CERTIFICADOS}. Si sigue pasando, escríbenos a soporte.`,
      };
    case 'ilegible':
      return {
        titulo: 'No pudimos abrir el certificado guardado',
        detalle: `Vuelve a subir el archivo .pfx con su contraseña en ${RUTA_CERTIFICADOS}.`,
      };
    case 'vault':
      return {
        titulo: 'Falta el archivo o la contraseña del certificado',
        detalle: `Vuelve a subir el archivo .pfx con su contraseña en ${RUTA_CERTIFICADOS}.`,
      };
    case 'base':
      return {
        titulo: 'No pudimos leer el certificado',
        detalle: `Inténtalo de nuevo en unos minutos. Si sigue fallando, escríbenos a soporte${datos.codigo ? ` (código ${datos.codigo})` : ''}.`,
      };
  }
}

/**
 * Error de `crearCredenciales()`. El mensaje es fijo (no lleva la clave, el .pfx, su
 * base64, la llave privada ni datos de la fila) y nunca tiene `cause`: el error de
 * node-forge o de PostgREST no se propaga.
 *
 * `operacion.ts` lo traduce con `error.resultado`: `config` (código 3, nada salió al
 * SII; no reintentar hasta corregir la configuración) para todos los motivos salvo
 * `base`, que es `error` (código 1). `error.mensaje` ya está en el formato del design
 * system (qué pasó y qué hacer) y se puede mostrar tal cual.
 */
export class ErrorCredenciales extends Error {
  override name = 'ErrorCredenciales';
  readonly motivo: MotivoCredenciales;
  readonly mensaje: MensajeError;
  readonly resultado: 'config' | 'error';

  constructor(motivo: MotivoCredenciales, datos: DatosMensaje) {
    const mensaje = mensajeDelMotivo(motivo, datos);
    super(mensaje.titulo);
    this.motivo = motivo;
    this.mensaje = mensaje;
    this.resultado = RESULTADO_DEL_MOTIVO[motivo];
  }
}

/** Certificado abierto y listo para firmar o para el TLS mutuo. Solo en memoria. */
export interface CredencialesCertificado {
  readonly certificadoId: string;
  readonly organizacionId: string;
  /** `<RutEnvia>` / quien firma, formato SII (`12345678-9`). */
  readonly rutTitular: string;
  /** `huellaCertificado()` de la librería (clave de los tokens del SII). */
  readonly huellaSha256: string;
  readonly vigenteHasta: Date;
  readonly certificado: Certificado;
  /** `new FirmaElectronica(llavePrivada, certificado)`, como la CLI. */
  readonly firma: FirmaElectronica;
}

export interface OpcionesCertificadoEmpresa {
  /**
   * `true`: exige que el titular sea representante electrónico de la empresa (lo
   * necesita la solicitud de folios). Se prefiere el predeterminado si lo es; si no,
   * el representante vigente que vence más tarde.
   */
  readonly representante?: boolean;
}

export interface Credenciales {
  /** Certificado de una empresa: el predeterminado, o un representante electrónico. */
  certificadoDeEmpresa(
    parametros: { organizacionId: string; empresaId: string } & OpcionesCertificadoEmpresa,
  ): Promise<CredencialesCertificado>;
  /** Un certificado de la organización por su id. */
  certificadoPorId(parametros: {
    organizacionId: string;
    certificadoId: string;
  }): Promise<CredencialesCertificado>;
}

export interface OpcionesCredenciales {
  /** Reloj para la vigencia (pruebas). */
  readonly reloj?: Reloj;
}

interface FilaCertificado {
  id: string;
  organizacion_id: string;
  rut_titular: string;
  huella_sha256: string;
  pfx_secret_id: string;
  clave_secret_id: string;
  vigente_desde: string | null;
  vigente_hasta: string | null;
  revocado_en: string | null;
}

const COLUMNAS_CERTIFICADO =
  'id, organizacion_id, rut_titular, huella_sha256, pfx_secret_id, clave_secret_id, vigente_desde, vigente_hasta, revocado_en';

function fecha(valor: string | null): Date | undefined {
  if (valor === null) return undefined;
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

/**
 * Credenciales con caché por invocación. Crear una por petición:
 *
 * ```ts
 * const credenciales = crearCredenciales(clienteServicio());
 * const { certificado, firma } = await credenciales.certificadoDeEmpresa({ organizacionId, empresaId });
 * ```
 *
 * @throws ErrorCredenciales (cualquier método). Nunca otro tipo de error.
 */
export function crearCredenciales(
  cliente: ClienteServicio,
  opciones: OpcionesCredenciales = {},
): Credenciales {
  const reloj = opciones.reloj ?? relojSistema;
  // Promesas, para que dos llamadas simultáneas lean Vault una sola vez.
  const porCertificado = new Map<string, Promise<CredencialesCertificado>>();
  const porEmpresa = new Map<string, Promise<string>>();

  /** Guarda la promesa; si falla, la saca para que un reintento vuelva a leer. */
  function enCache<T>(mapa: Map<string, Promise<T>>, clave: string, crear: () => Promise<T>) {
    const existente = mapa.get(clave);
    if (existente) return existente;
    const promesa = crear();
    mapa.set(clave, promesa);
    promesa.catch(() => mapa.delete(clave));
    return promesa;
  }

  async function leerSecreto(id: string, ambito: DatosMensaje['ambito']): Promise<string> {
    const { data, error } = await cliente.rpc('leer_secreto', { p_id: id });
    if (error) throw new ErrorCredenciales('base', { ambito, codigo: error.code });
    if (typeof data !== 'string' || data === '') throw new ErrorCredenciales('vault', { ambito });
    return data;
  }

  async function cargar(
    organizacionId: string,
    certificadoId: string,
    ambito: DatosMensaje['ambito'],
  ): Promise<CredencialesCertificado> {
    const { data, error } = await cliente
      .from('certificados')
      .select(COLUMNAS_CERTIFICADO)
      .eq('organizacion_id', organizacionId)
      .eq('id', certificadoId)
      .maybeSingle();
    if (error) throw new ErrorCredenciales('base', { ambito, codigo: error.code });
    const fila: FilaCertificado | null = data;
    if (!fila) throw new ErrorCredenciales('sin_certificado', { ambito });
    if (fila.revocado_en !== null) throw new ErrorCredenciales('revocado', { ambito });

    // Antes de tocar Vault: si la fila ya dice que venció, no hace falta abrirlo.
    const ahora = reloj.ahora();
    const hastaFila = fecha(fila.vigente_hasta);
    if (hastaFila && ahora.getTime() > hastaFila.getTime()) {
      throw new ErrorCredenciales('vencido', { ambito, vigenteHasta: hastaFila });
    }

    const [pfxBase64, clave] = await Promise.all([
      leerSecreto(fila.pfx_secret_id, ambito),
      leerSecreto(fila.clave_secret_id, ambito),
    ]);

    let certificado: Certificado;
    let firma: FirmaElectronica;
    let huella: string;
    let x509: X509Certificate;
    try {
      certificado = Certificado.desdeContenido(Buffer.from(pfxBase64, 'base64'), clave);
      huella = huellaCertificado(certificado.certificado);
      x509 = new X509Certificate(certificado.certificado);
      firma = new FirmaElectronica(certificado.llavePrivada, certificado.certificado);
    } catch {
      // Sin `cause`: el error de node-forge no se registra.
      throw new ErrorCredenciales('ilegible', { ambito });
    }

    if (huella !== fila.huella_sha256) throw new ErrorCredenciales('huella_distinta', { ambito });

    // La vigencia real es la del certificado, no la de la fila.
    const vigenteHasta = x509.validToDate;
    const vigenteDesde = x509.validFromDate;
    if (ahora.getTime() > vigenteHasta.getTime()) {
      throw new ErrorCredenciales('vencido', { ambito, vigenteHasta });
    }
    if (ahora.getTime() < vigenteDesde.getTime()) {
      throw new ErrorCredenciales('no_vigente', { ambito, vigenteDesde });
    }

    return {
      certificadoId: fila.id,
      organizacionId: fila.organizacion_id,
      rutTitular: fila.rut_titular,
      huellaSha256: huella,
      vigenteHasta,
      certificado,
      firma,
    };
  }

  function porId(
    organizacionId: string,
    certificadoId: string,
    ambito: DatosMensaje['ambito'],
  ): Promise<CredencialesCertificado> {
    return enCache(porCertificado, `${organizacionId}:${certificadoId}`, () =>
      cargar(organizacionId, certificadoId, ambito),
    );
  }

  /** Id del certificado que corresponde a la empresa (sin abrirlo todavía). */
  async function elegirDeEmpresa(
    organizacionId: string,
    empresaId: string,
    representante: boolean,
  ): Promise<string> {
    const ambito = 'empresa';
    const { data, error } = await cliente
      .from('empresa_certificados')
      .select('certificado_id, es_representante_electronico, predeterminado')
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId);
    if (error) throw new ErrorCredenciales('base', { ambito, codigo: error.code });

    if (!representante) {
      const predeterminado = data.find((a) => a.predeterminado);
      if (!predeterminado) throw new ErrorCredenciales('sin_certificado', { ambito });
      return predeterminado.certificado_id;
    }

    const representantes = data.filter((a) => a.es_representante_electronico);
    if (representantes.length === 0) throw new ErrorCredenciales('sin_representante', { ambito });
    const filas = await cliente
      .from('certificados')
      .select('id, vigente_desde, vigente_hasta, revocado_en')
      .eq('organizacion_id', organizacionId)
      .in(
        'id',
        representantes.map((a) => a.certificado_id),
      );
    if (filas.error) throw new ErrorCredenciales('base', { ambito, codigo: filas.error.code });
    const predeterminado = representantes.find((a) => a.predeterminado)?.certificado_id;
    // El predeterminado si sirve; si no, el representante vigente que vence más tarde.
    const [mejor] = filas.data
      .filter(utilizable)
      .sort(
        (a, b) =>
          Number(b.id === predeterminado) - Number(a.id === predeterminado) ||
          (fecha(b.vigente_hasta)?.getTime() ?? 0) - (fecha(a.vigente_hasta)?.getTime() ?? 0),
      );
    if (!mejor) throw new ErrorCredenciales('sin_representante', { ambito });
    return mejor.id;
  }

  /** Sin revocar y vigente según la fila (la vigencia real se revisa al abrirlo). */
  function utilizable(f: {
    vigente_desde: string | null;
    vigente_hasta: string | null;
    revocado_en: string | null;
  }): boolean {
    if (f.revocado_en !== null) return false;
    const ahora = reloj.ahora().getTime();
    const desde = fecha(f.vigente_desde);
    const hasta = fecha(f.vigente_hasta);
    return (!desde || desde.getTime() <= ahora) && (!hasta || hasta.getTime() >= ahora);
  }

  return {
    async certificadoDeEmpresa({ organizacionId, empresaId, representante = false }) {
      const certificadoId = await enCache(
        porEmpresa,
        `${organizacionId}:${empresaId}:${representante ? 'representante' : 'predeterminado'}`,
        () => elegirDeEmpresa(organizacionId, empresaId, representante),
      );
      return porId(organizacionId, certificadoId, 'empresa');
    },
    certificadoPorId({ organizacionId, certificadoId }) {
      return porId(organizacionId, certificadoId, 'certificado');
    },
  };
}
