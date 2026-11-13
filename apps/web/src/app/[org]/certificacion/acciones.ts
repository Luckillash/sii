'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import type { ResultadoPaso } from '@/lib/certificacion';
import { puedeAdministrar } from '@/lib/permisos';
import * as certificacion from '@/server/certificacion';
import { obtenerEmpresa } from '@/server/empresas';
import { MENSAJE_GENERICO, type MensajeError } from '@/server/equipo-errores';
import { exigirMembresia } from '@/server/sesion';
import {
  camposDe,
  DATOS_INVALIDOS,
  EMPRESA_NO_ENCONTRADA,
  esquemaCorreoProveedorSet,
  esquemaFolioInicial,
  SIN_PERMISO,
  validarDeclaracion,
  validarPostulacion,
} from './logica';

// Server Actions del asistente de certificación (PLAN-SAAS Fase 5). Finas: verifican la
// membresía y el rol, validan ids y formularios con zod y llaman a la API de
// `server/certificacion` (que valida de nuevo, ejecuta en el SII y persiste). La
// autoridad final es RLS. `maxDuration = 300` lo fija `page.tsx`: en Next 16 el valor de
// la página aplica a todas las Server Actions que se usan en ella.
//
// Cada acción ⚠️ recibe `confirmada`: con `false` el backend devuelve el ensayo sin salir
// al SII ni registrar nada; la UI lo muestra en un `Dialogo` y solo al confirmar vuelve a
// llamar con `true`.

const esquemaId = z.uuid();

type Previo =
  | { ok: true; ctx: certificacion.ContextoCertificacion }
  | { ok: false; resultado: ResultadoPaso };

function error(mensaje: MensajeError, extra: { errores?: Record<string, string> } = {}) {
  return { ok: false as const, resultado: fallo(mensaje, extra) };
}

function fallo(
  mensaje: MensajeError,
  extra: { errores?: Record<string, string> } = {},
): ResultadoPaso {
  return { tipo: 'error', mensaje, operacionId: null, motivo: 'no_ejecutada', ...extra };
}

async function preparar(slug: string, empresaId: string): Promise<Previo> {
  const { organizacion, usuario, rol } = await exigirMembresia(slug);
  if (!puedeAdministrar(rol)) return error(SIN_PERMISO);
  if (!esquemaId.safeParse(empresaId).success) return error(EMPRESA_NO_ENCONTRADA);
  // La empresa tiene que ser de esta organización (RLS además oculta las de otras).
  const empresa = await obtenerEmpresa(organizacion.id, empresaId);
  if (!empresa) return error(EMPRESA_NO_ENCONTRADA);
  return {
    ok: true,
    ctx: { organizacionId: organizacion.id, empresaId: empresa.id, usuarioId: usuario.id },
  };
}

/** Llama al backend; un error inesperado vuelve como mensaje (sin detalles técnicos). */
async function ejecutar(
  slug: string,
  nombre: string,
  llamada: () => Promise<ResultadoPaso>,
): Promise<ResultadoPaso> {
  let r: ResultadoPaso;
  try {
    r = await llamada();
  } catch (e) {
    // Solo el tipo de error: el mensaje podría traer datos de la petición.
    console.error(`Certificación: falló ${nombre}`, { tipo: e instanceof Error ? e.name : null });
    revalidatePath(`/${slug}/certificacion`);
    return fallo(MENSAJE_GENERICO);
  }
  // El ensayo no cambia nada; lo demás puede haber cambiado la etapa o las operaciones.
  if (r.tipo !== 'ensayo') revalidatePath(`/${slug}/certificacion`);
  return r;
}

// --- Formularios (no salen al SII) -----------------------------------------------------

export async function guardarPostulacion(
  slug: string,
  empresaId: string,
  _anterior: ResultadoPaso | null,
  formulario: FormData,
): Promise<ResultadoPaso> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  const v = validarPostulacion(camposDe(formulario));
  if (!v.ok) return fallo(DATOS_INVALIDOS, { errores: v.errores });
  return ejecutar(slug, 'guardarDatosPostulacion', () =>
    certificacion.guardarDatosPostulacion(previo.ctx, v.datos),
  );
}

export async function guardarDeclaracion(
  slug: string,
  empresaId: string,
  _anterior: ResultadoPaso | null,
  formulario: FormData,
): Promise<ResultadoPaso> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  const v = validarDeclaracion(camposDe(formulario));
  if (!v.ok) return fallo(DATOS_INVALIDOS, { errores: v.errores });
  return ejecutar(slug, 'guardarDatosDeclaracion', () =>
    certificacion.guardarDatosDeclaracion(previo.ctx, v.datos),
  );
}

// --- Acciones ⚠️ (ensayo y confirmación) ------------------------------------------------

export async function postular(
  slug: string,
  empresaId: string,
  confirmada: boolean,
): Promise<ResultadoPaso> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  return ejecutar(slug, 'postular', () =>
    certificacion.postular(previo.ctx, { confirmada: confirmada === true }),
  );
}

export async function descargarSet(
  slug: string,
  empresaId: string,
  confirmada: boolean,
  correoProveedorSet?: string,
): Promise<ResultadoPaso> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  const correo = esquemaCorreoProveedorSet.safeParse(correoProveedorSet ?? '');
  if (!correo.success) {
    return fallo(DATOS_INVALIDOS, {
      errores: { correoProveedorSet: correo.error.issues[0]?.message ?? 'Revisa el correo.' },
    });
  }
  return ejecutar(slug, 'descargarSet', () =>
    certificacion.descargarSet(previo.ctx, {
      confirmada: confirmada === true,
      ...(correo.data ? { correoProveedorSet: correo.data } : {}),
    }),
  );
}

export async function solicitarFolios(
  slug: string,
  empresaId: string,
  confirmada: boolean,
  folioInicial?: number,
): Promise<ResultadoPaso> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  let folio: number | undefined;
  if (folioInicial !== undefined) {
    const r = esquemaFolioInicial.safeParse(folioInicial);
    if (!r.success) {
      return fallo(DATOS_INVALIDOS, {
        errores: { folioInicial: r.error.issues[0]?.message ?? 'Revisa el folio inicial.' },
      });
    }
    folio = r.data;
  }
  return ejecutar(slug, 'solicitarFoliosSet', () =>
    certificacion.solicitarFoliosSet(previo.ctx, {
      confirmada: confirmada === true,
      ...(folio !== undefined ? { folioInicial: folio } : {}),
    }),
  );
}

export async function enviarSet(
  slug: string,
  empresaId: string,
  confirmada: boolean,
): Promise<ResultadoPaso> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  return ejecutar(slug, 'enviarSet', () =>
    certificacion.enviarSet(previo.ctx, { confirmada: confirmada === true }),
  );
}

export async function solicitarRevision(
  slug: string,
  empresaId: string,
  confirmada: boolean,
): Promise<ResultadoPaso> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  return ejecutar(slug, 'solicitarRevision', () =>
    certificacion.solicitarRevision(previo.ctx, { confirmada: confirmada === true }),
  );
}

export async function declarar(
  slug: string,
  empresaId: string,
  confirmada: boolean,
): Promise<ResultadoPaso> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  return ejecutar(slug, 'declarar', () =>
    certificacion.declarar(previo.ctx, { confirmada: confirmada === true }),
  );
}

// --- Consultas de solo lectura al SII (sin ensayo) --------------------------------------

export async function consultarEstadoSet(slug: string, empresaId: string): Promise<ResultadoPaso> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  return ejecutar(slug, 'consultarEstadoSet', () => certificacion.consultarEstadoSet(previo.ctx));
}

export async function consultarEstadoDeclaracion(
  slug: string,
  empresaId: string,
): Promise<ResultadoPaso> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  return ejecutar(slug, 'consultarEstadoDeclaracion', () =>
    certificacion.consultarEstadoDeclaracion(previo.ctx),
  );
}

// --- Operación incierta -----------------------------------------------------------------

export async function marcarRevisada(
  slug: string,
  empresaId: string,
  operacionId: string,
): Promise<ResultadoPaso> {
  const previo = await preparar(slug, empresaId);
  if (!previo.ok) return previo.resultado;
  if (!esquemaId.safeParse(operacionId).success) return fallo(DATOS_INVALIDOS);
  return ejecutar(slug, 'marcarRevisada', () =>
    certificacion.marcarRevisada(previo.ctx, operacionId),
  );
}
