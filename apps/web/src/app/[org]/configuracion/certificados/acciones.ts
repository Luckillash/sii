'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { formatearFecha, formatearRut, rutSii, rutValidoSii, validarRut } from '@/lib/formatos';
import { puedeAdministrar } from '@/lib/permisos';
import { confirmarSesion } from '@/server/certificados/acceso';
import { type AnalisisCertificado, analizarCertificado } from '@/server/certificados/analizar';
import { asociarCertificado } from '@/server/certificados/asociaciones';
import { obtenerEmpresaBasica } from '@/server/certificados/consultas';
import {
  CAMPO_DEL_MOTIVO,
  DATOS_INVALIDOS,
  ErrorAnalisisCertificado,
  MENSAJE_GENERICO_CERTIFICADO,
  type MensajeError,
  type OperacionCertificado,
  SESION_VENCIDA,
  SIN_EFECTO,
  SIN_PERMISO,
  traducirErrorCertificado,
} from '@/server/certificados/errores';
import { exigirMembresia } from '@/server/sesion';
import { clienteServicio } from '@/server/supabase/service';

// Carga, revocación y borrado de certificados digitales (PLAN-SAAS Fase 3, punto 2).
//
// - Solo administradores (`puedeAdministrar`) y con la sesión confirmada contra Auth
//   (`getUser()`), porque son operaciones sensibles.
// - `certificados` no tiene políticas de escritura: se escribe con service_role, y
//   siempre con el `organizacion_id` de la membresía, nunca uno del formulario.
// - El .pfx y la clave solo viven en esta petición: se validan con la librería y van
//   a Vault por `registrar_certificado()`. Nunca a disco, a Storage, a logs, a Sentry
//   ni de vuelta al navegador. Tampoco el nombre del archivo (suele llevar el RUT).

/** Un .pfx real pesa pocos KB; el límite de las Server Actions es 2 MB (next.config.ts). */
const TAMANO_MAXIMO = 100 * 1024;
const LARGO_MAXIMO_CLAVE = 256;

export type CampoSubida = 'pfx' | 'clave' | 'rut_titular' | 'empresa_id';

/** Lo que el formulario recupera tras un error. Nunca la clave ni el archivo. */
export interface ValoresSubida {
  rut_titular: string;
  empresa_id: string;
  representante: boolean;
  predeterminado: boolean;
}

export type ResultadoSubida =
  | { ok: true; mensaje: string; aviso?: MensajeError }
  | {
      ok: false;
      error: MensajeError;
      errores?: Partial<Record<CampoSubida, string>>;
      /** Mostrar el campo del RUT del titular (el certificado no lo trae, o no coincide). */
      pedirRut?: boolean;
      /** `aviso` cuando no es un error sino un paso más (pedir el RUT). Por omisión, error. */
      tono?: 'aviso';
      valores: ValoresSubida;
    };

export type ResultadoAccion = { ok: true; mensaje: string } | { ok: false; error: MensajeError };

const esquemaId = z.uuid();

function leerValores(formulario: FormData): ValoresSubida {
  const texto = (campo: string) => {
    const valor = formulario.get(campo);
    return typeof valor === 'string' ? valor.trim().slice(0, 64) : '';
  };
  return {
    rut_titular: texto('rut_titular'),
    empresa_id: texto('empresa_id'),
    representante: formulario.get('representante') === 'on',
    predeterminado: formulario.get('predeterminado') === 'on',
  };
}

function falloBase(error: { code?: string | null }, operacion: OperacionCertificado): MensajeError {
  const traducido = traducirErrorCertificado(error, operacion);
  if (traducido === MENSAJE_GENERICO_CERTIFICADO) {
    // Solo el código: el mensaje o los detalles de PostgREST podrían traer datos.
    console.error(`Certificados: ${operacion} falló`, { codigo: error.code ?? null });
  }
  return traducido;
}

function rutasAfectadas(slug: string, empresaId?: string) {
  revalidatePath(`/${slug}/configuracion/certificados`);
  revalidatePath(`/${slug}/tablero`);
  if (empresaId) revalidatePath(`/${slug}/configuracion/empresas/${empresaId}/certificados`);
}

/**
 * Los tipos generados marcan todos los argumentos de una función como `string`, pero
 * `registrar_certificado()` acepta NULL en nombre, CN y emisor (columnas nulas).
 */
function textoONulo(valor: string | null): string {
  return valor as string;
}

export async function subirCertificado(
  slug: string,
  _anterior: ResultadoSubida | null,
  formulario: FormData,
): Promise<ResultadoSubida> {
  const ctx = await exigirMembresia(slug);
  const valores = leerValores(formulario);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO, valores };

  // 1. Forma de los datos.
  const archivo = formulario.get('pfx');
  const clave = formulario.get('clave');
  const errores: Partial<Record<CampoSubida, string>> = {};
  if (!(archivo instanceof File) || archivo.size === 0) {
    errores.pfx = 'Elige el archivo .pfx o .p12 del certificado.';
  } else if (archivo.size > TAMANO_MAXIMO) {
    errores.pfx =
      'El archivo pesa más de 100 KB y un certificado .pfx pesa unos pocos KB. Revisa que sea el archivo correcto.';
  } else if (!/\.(pfx|p12)$/i.test(archivo.name)) {
    errores.pfx = 'El archivo debe terminar en .pfx o .p12.';
  }
  if (typeof clave !== 'string' || clave.length === 0) {
    errores.clave = 'Escribe la contraseña del certificado.';
  } else if (clave.length > LARGO_MAXIMO_CLAVE) {
    errores.clave = 'La contraseña es demasiado larga. Revisa que sea la del certificado.';
  }
  if (valores.rut_titular && !validarRut(valores.rut_titular)) {
    errores.rut_titular = 'El dígito verificador no corresponde a este RUT.';
  } else if (valores.rut_titular && !rutValidoSii(rutSii(valores.rut_titular))) {
    // El dominio `rut` del SQL admite hasta 8 dígitos en el cuerpo; validarRut, más.
    errores.rut_titular = 'El RUT tiene más dígitos de los que acepta el SII. Revísalo.';
  }
  if (valores.empresa_id && !esquemaId.safeParse(valores.empresa_id).success) {
    errores.empresa_id = 'Elige una empresa de la lista.';
  }
  if (Object.keys(errores).length > 0 || !(archivo instanceof File) || typeof clave !== 'string') {
    return {
      ok: false,
      error: {
        titulo: 'Revisa los datos del certificado',
        detalle: 'Corrige los campos marcados.',
      },
      errores,
      valores,
    };
  }

  // 2. Abrir el .pfx con la librería (valida la clave, la estructura y la vigencia).
  const bytes = new Uint8Array(await archivo.arrayBuffer());
  try {
    let analisis: AnalisisCertificado;
    try {
      analisis = analizarCertificado(bytes, clave);
    } catch (error) {
      if (error instanceof ErrorAnalisisCertificado) {
        return {
          ok: false,
          error: error.mensaje,
          errores: { [CAMPO_DEL_MOTIVO[error.motivo]]: error.mensaje.titulo },
          valores,
        };
      }
      // No debería pasar (analizarCertificado solo lanza ErrorAnalisisCertificado).
      // No se registra el error: podría arrastrar material del .pfx.
      console.error('Certificados: error inesperado al leer un .pfx');
      return { ok: false, error: MENSAJE_GENERICO_CERTIFICADO, valores };
    }

    // 3. RUT del titular: el del certificado manda; si no lo trae, se pide.
    let rutTitular: string;
    if (analisis.rutTitular) {
      if (valores.rut_titular && rutSii(valores.rut_titular) !== analisis.rutTitular) {
        return {
          ok: false,
          error: {
            titulo: 'El RUT no coincide con el del certificado',
            detalle: `El certificado es de ${formatearRut(analisis.rutTitular)}. Borra el RUT que escribiste o elige el certificado correcto.`,
          },
          errores: { rut_titular: 'No coincide con el RUT del certificado.' },
          pedirRut: true,
          valores,
        };
      }
      rutTitular = analisis.rutTitular;
    } else if (valores.rut_titular) {
      rutTitular = rutSii(valores.rut_titular);
    } else {
      return {
        ok: false,
        error: {
          titulo: 'Escribe el RUT del titular',
          detalle:
            'El certificado no trae el RUT de la persona titular. Escríbelo, vuelve a escribir la contraseña y envía de nuevo.',
        },
        errores: { rut_titular: 'Escribe el RUT de la persona titular del certificado.' },
        pedirRut: true,
        tono: 'aviso',
        valores,
      };
    }

    // 4. La empresa (opcional) tiene que ser de esta organización.
    if (valores.empresa_id) {
      const empresa = await obtenerEmpresaBasica(ctx.organizacion.id, valores.empresa_id);
      if (!empresa) {
        return {
          ok: false,
          error: DATOS_INVALIDOS,
          errores: { empresa_id: 'Elige una empresa de la lista.' },
          valores,
        };
      }
    }

    // 5. Operación sensible: la sesión tiene que seguir viva en Auth.
    if (!(await confirmarSesion(ctx.usuario.id))) {
      return { ok: false, error: SESION_VENCIDA, valores };
    }

    // 6. Vault + fila, en una transacción (service_role).
    const { data: certificadoId, error } = await clienteServicio().rpc('registrar_certificado', {
      p_organizacion: ctx.organizacion.id,
      p_rut_titular: rutTitular,
      p_nombre_titular: textoONulo(analisis.nombreTitular),
      p_cn: textoONulo(analisis.cn),
      p_emisor_ca: textoONulo(analisis.emisorCa),
      p_vigente_desde: analisis.vigenteDesde.toISOString(),
      p_vigente_hasta: analisis.vigenteHasta.toISOString(),
      p_huella_sha256: analisis.huellaSha256,
      p_pfx_base64: Buffer.from(bytes).toString('base64'),
      p_clave: clave,
      p_pfx_legacy: analisis.pfxLegacy,
      p_subido_por: ctx.usuario.id,
    });
    if (error || !certificadoId) {
      return { ok: false, error: falloBase(error ?? {}, 'subir'), valores };
    }

    const quien = analisis.nombreTitular ?? formatearRut(rutTitular);
    const mensaje = `Cargaste el certificado de ${quien}. Vence el ${formatearFecha(analisis.vigenteHasta)}.`;

    // 7. Asociación opcional a una empresa (RLS de administrador).
    let aviso: MensajeError | undefined;
    if (valores.empresa_id) {
      const asociacion = await asociarCertificado(
        ctx.organizacion.id,
        valores.empresa_id,
        certificadoId,
        { representante: valores.representante, predeterminado: valores.predeterminado },
      );
      if (!asociacion.ok) {
        aviso = {
          titulo: 'El certificado quedó cargado, pero no pudimos asociarlo a la empresa',
          detalle: `${asociacion.error.titulo}. Asócialo desde la página de certificados de la empresa.`,
        };
      }
    }

    rutasAfectadas(slug, valores.empresa_id || undefined);
    return aviso ? { ok: true, mensaje, aviso } : { ok: true, mensaje };
  } finally {
    // La copia en memoria del archivo no se necesita más.
    bytes.fill(0);
  }
}

async function prepararAccionSensible(
  slug: string,
  certificadoId: string,
): Promise<{ ok: true; organizacionId: string } | { ok: false; error: MensajeError }> {
  const ctx = await exigirMembresia(slug);
  if (!puedeAdministrar(ctx.rol)) return { ok: false, error: SIN_PERMISO };
  if (!esquemaId.safeParse(certificadoId).success) return { ok: false, error: DATOS_INVALIDOS };
  if (!(await confirmarSesion(ctx.usuario.id))) return { ok: false, error: SESION_VENCIDA };
  return { ok: true, organizacionId: ctx.organizacion.id };
}

/**
 * Marca el certificado como revocado (`revocado_en`): deja de usarse para firmar,
 * pero queda en la lista. Con service_role porque `certificados` no tiene política
 * de UPDATE para usuarios; por eso se filtra SIEMPRE por la organización de la
 * membresía además del id.
 */
export async function revocarCertificado(
  slug: string,
  certificadoId: string,
): Promise<ResultadoAccion> {
  const previo = await prepararAccionSensible(slug, certificadoId);
  if (!previo.ok) return previo;

  const { error, count } = await clienteServicio()
    .from('certificados')
    .update({ revocado_en: new Date().toISOString() }, { count: 'exact' })
    .eq('organizacion_id', previo.organizacionId)
    .eq('id', certificadoId)
    .is('revocado_en', null);
  if (error) return { ok: false, error: falloBase(error, 'revocar') };
  if (!count) return { ok: false, error: SIN_EFECTO };

  rutasAfectadas(slug);
  return { ok: true, mensaje: 'Revocaste el certificado. Ya no se usará para firmar.' };
}

/**
 * Borra el certificado. `trg_borrar_secretos` borra de Vault el .pfx y la clave; la
 * cascada borra sus asociaciones y sesiones del SII (`sesiones_sii`). `tokens_sii` no
 * tiene FK a `certificados` (su clave es la huella): esos tokens no se borran y vencen
 * solos (~50 min). Los documentos ya firmados no cambian; `envios.certificado_id` y
 * `solicitudes_folios.certificado_id` quedan nulos.
 */
export async function eliminarCertificado(
  slug: string,
  certificadoId: string,
): Promise<ResultadoAccion> {
  const previo = await prepararAccionSensible(slug, certificadoId);
  if (!previo.ok) return previo;

  const { error, count } = await clienteServicio()
    .from('certificados')
    .delete({ count: 'exact' })
    .eq('organizacion_id', previo.organizacionId)
    .eq('id', certificadoId);
  if (error) return { ok: false, error: falloBase(error, 'eliminar') };
  if (!count) return { ok: false, error: SIN_EFECTO };

  rutasAfectadas(slug);
  return { ok: true, mensaje: 'Eliminaste el certificado, su archivo y su contraseña.' };
}
