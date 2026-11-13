import 'server-only';
import {
  DatosDeclaracion,
  DeclaracionInciertaError,
  ErrorValidacion,
  type EstadoDeclaracion,
  SetSinDescargarError,
} from '@winex/certificacion';
import type { ResultadoPaso } from '@/lib/certificacion';
import { formatearRut } from '@/lib/formatos';
import { ErrorConfig, ErrorUso } from '../sii/errores';
import type { ClienteServicio } from '../supabase/service';
import {
  AMBIENTE,
  actualizarProceso,
  cargarEmpresa,
  conIndicacion,
  conSesionSii,
  ejecutar,
  ensayar,
  errorDeEjecucion,
  exigirProceso,
  type FilaEmpresaDb,
  type FilaProcesoDb,
  fallaBase,
  ok,
  resumenCertificado,
  validarAntes,
} from './comun';
import { type DependenciasCertificacion, resolverDependencias } from './dependencias';
import { notificarCambioEtapa } from './notificar';
import { verificarPortalAntes } from './portal';
import { guardarEstadoDeclaracion } from './set';
import type { ContextoCertificacion } from './tipos';

// Pasos 4 y 5: revisión del set, estado de la declaración y declaración de cumplimiento
// en el portal de la declaración (www4, GWT-RPC), con paridad con
// `sii certificacion solicitar-revision`, `estado-declaracion` y `declarar`:
//   - la revisión se pide con el Track ID del envío del set aceptado;
//     `SetSinDescargarError` lleva la indicación de qué hacer;
//   - el estado (P90 / P91) se guarda en el proceso y el trigger
//     `tg_certificacion_autorizada` mueve la etapa y marca la empresa autorizada;
//   - declarar: `verificar_portal` antes; la librería solo declara en P90;
//     `DeclaracionInciertaError` → `incierto` con la indicación de consultar el estado
//     (P91 = quedó autorizada; P90 = se puede volver a declarar).

const INDICACION_SET_SIN_DESCARGAR =
  'Qué hacer: descarga un set de pruebas nuevo (paso 2), envía las boletas de ESE set y pide la revisión con el Track ID de ese envío.';

const INDICACION_DECLARACION_INCIERTA =
  'No repitas la declaración a ciegas: consulta antes el estado de la declaración (P91 = quedó autorizada; P90 = se puede volver a declarar).';

function lineaEstado(estado: EstadoDeclaracion): string {
  if (estado.codigo === null) {
    return 'El SII no muestra un trámite pendiente: la empresa ya está autorizada, no está postulada o el titular del certificado no la representa.';
  }
  const glosa = estado.glosa !== '' ? ` ${estado.glosa}` : '';
  return `Estado ${estado.codigo}${glosa}.`;
}

// --- Revisión del set --------------------------------------------------------------------

async function prepararRevision(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  credenciales: ReturnType<DependenciasCertificacion['credenciales']>,
) {
  const empresa = await cargarEmpresa(cliente, ctx);
  const proceso = await exigirProceso(cliente, ctx);
  if (proceso.etapa !== 'set_aceptado' && proceso.etapa !== 'revision_solicitada') {
    throw new ErrorUso(
      'La revisión se pide cuando el SII aceptó el set sin reparos: consulta antes el estado del envío del set (paso 3).',
    );
  }
  const { data: envio, error } = proceso.envio_set_id
    ? await cliente
        .from('envios')
        .select('id, track_id, clasificacion')
        .eq('organizacion_id', ctx.organizacionId)
        .eq('id', proceso.envio_set_id)
        .maybeSingle()
    : { data: null, error: null };
  if (error) throw fallaBase('leer el envío del set', error);
  if (!envio?.track_id || envio.clasificacion !== 'aceptado') {
    throw new ErrorUso(
      'El envío del set no está aceptado sin reparos: consulta su estado en el paso 3 antes de pedir la revisión.',
    );
  }
  const certificado = await credenciales.certificadoDeEmpresa({
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
  });
  return { empresa, proceso, trackId: envio.track_id, certificado };
}

/** Pide al SII la revisión del set de pruebas enviado (⚠️). */
export async function solicitarRevision(
  ctx: ContextoCertificacion,
  opciones: { confirmada: boolean },
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);
  const prep = () => prepararRevision(cliente, ctx, credenciales);

  if (!opciones.confirmada) {
    return ensayar(async () => {
      const p = await prep();
      return {
        operacion: 'solicitar_revision',
        titulo: 'Pedir la revisión del set de pruebas',
        ambiente: AMBIENTE,
        certificado: await resumenCertificado(cliente, ctx, p.certificado),
        filas: [
          {
            etiqueta: 'Empresa',
            valor: `${p.empresa.razon_social} (${formatearRut(p.empresa.rut)})`,
          },
          { etiqueta: 'Track ID del envío', valor: p.trackId },
        ],
        avisos: [
          'El resultado no es inmediato: el SII lo informa por correo. Si aprueba, el estado de la declaración pasa a P90.',
        ],
        textoConfirmar: 'Pedir la revisión',
      };
    });
  }

  const previo = await validarAntes(prep);
  if (!previo.ok) return previo.resultado;

  const r = await ejecutar(
    deps,
    cliente,
    ctx,
    { operacion: 'solicitar_revision', confirmada: true },
    async ({ agregarDetalle }) => {
      const p = await prep();
      await using transporte = deps.transporte();
      const postulacion = deps.sii.postulacion({ transporte, reloj: deps.reloj });
      const declaracion = deps.sii.declaracion({ transporte, reloj: deps.reloj });
      try {
        await conSesionSii(
          deps,
          cliente,
          p.certificado,
          () => postulacion.autenticar(p.certificado.certificado),
          (sesion) => declaracion.solicitarRevisionSet(sesion, p.empresa.rut, p.trackId),
        );
      } catch (error) {
        if (error instanceof SetSinDescargarError) {
          throw conIndicacion(error, INDICACION_SET_SIN_DESCARGAR);
        }
        throw error;
      }
      agregarDetalle({ track_id: p.trackId });
      return actualizarProceso(cliente, ctx, p.proceso, {
        etapa: 'revision_solicitada',
        revision_solicitada_en: deps.reloj.ahora().toISOString(),
      });
    },
  );
  if (!r.ok) return errorDeEjecucion(r);

  await notificarCambioEtapa(deps, cliente, ctx, r.valor, r.operacionId);
  return ok(
    {
      titulo: 'El SII recibió la solicitud de revisión',
      detalle:
        'El resultado llega por correo. Cuando el SII apruebe, consulta el estado de la declaración: debería mostrar P90.',
    },
    r.operacionId,
  );
}

// --- Estado de la declaración -------------------------------------------------------------

/** Consulta el estado de la declaración en el SII (solo lectura, sin ensayo). */
export async function consultarEstadoDeclaracion(
  ctx: ContextoCertificacion,
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);
  const prep = async () => {
    const empresa = await cargarEmpresa(cliente, ctx);
    const proceso = await exigirProceso(cliente, ctx);
    if (proceso.etapa === 'borrador') {
      throw new ErrorUso('Primero postula la empresa (paso 1).');
    }
    const certificado = await credenciales.certificadoDeEmpresa({
      organizacionId: ctx.organizacionId,
      empresaId: ctx.empresaId,
    });
    return { empresa, proceso, certificado };
  };

  const previo = await validarAntes(prep);
  if (!previo.ok) return previo.resultado;

  const r = await ejecutar(
    deps,
    cliente,
    ctx,
    { operacion: 'estado_declaracion', confirmada: true },
    async ({ agregarDetalle }) => {
      const p = await prep();
      await using transporte = deps.transporte();
      const postulacion = deps.sii.postulacion({ transporte, reloj: deps.reloj });
      const declaracion = deps.sii.declaracion({ transporte, reloj: deps.reloj });
      const estado = await conSesionSii(
        deps,
        cliente,
        p.certificado,
        () => postulacion.autenticar(p.certificado.certificado),
        (sesion) => declaracion.estado(sesion, p.empresa.rut),
      );
      agregarDetalle({ codigo_estado: estado.codigo, paso: estado.paso });
      const cambio = await guardarEstadoDeclaracion(
        cliente,
        ctx,
        p.proceso,
        estado,
        deps.reloj.ahora(),
      );
      return { estado, cambio };
    },
  );
  if (!r.ok) return errorDeEjecucion(r);

  const { estado, cambio } = r.valor;
  await notificarCambioEtapa(deps, cliente, ctx, cambio, r.operacionId);
  if (estado.autorizada()) {
    return ok(
      {
        titulo: 'La empresa está autorizada en producción (P91)',
        detalle: 'Ya puede emitir boletas electrónicas en producción.',
      },
      r.operacionId,
    );
  }
  if (estado.porDeclarar()) {
    return ok(
      {
        titulo: 'La empresa está lista para declarar (P90)',
        detalle:
          'El SII aprobó la revisión del set. Declara el cumplimiento para quedar autorizada en producción.',
      },
      r.operacionId,
    );
  }
  return ok(
    { titulo: 'Consultamos el estado de la declaración', detalle: lineaEstado(estado) },
    r.operacionId,
  );
}

// --- Declaración de cumplimiento ----------------------------------------------------------

function datosDeclaracion(empresa: FilaEmpresaDb, proceso: FilaProcesoDb): DatosDeclaracion {
  const requeridos = {
    'el enlace de consulta': proceso.link_consulta,
    'el RUT del proveedor de software': proceso.rut_proveedor,
    'el nombre del proveedor de software': proceso.nombre_proveedor,
    'el correo del proveedor de software': proceso.correo_proveedor,
  };
  const faltan = Object.entries(requeridos)
    .filter(([, valor]) => typeof valor !== 'string' || valor.trim() === '')
    .map(([nombre]) => nombre);
  if (faltan.length > 0) {
    throw new ErrorUso(
      `Faltan datos de la declaración: ${faltan.join(', ')}. Complétalos en el paso 5 y guárdalos.`,
    );
  }
  try {
    return new DatosDeclaracion({
      rutEmpresa: empresa.rut,
      linkConsulta: proceso.link_consulta ?? '',
      rutProveedor: proceso.rut_proveedor ?? '',
      nombreProveedor: proceso.nombre_proveedor ?? '',
      correoProveedor: proceso.correo_proveedor ?? '',
    });
  } catch (error) {
    if (error instanceof ErrorValidacion) {
      throw new ErrorConfig(
        `Los datos de la declaración no son válidos: ${error.message} Corrígelos en el paso 5.`,
      );
    }
    throw error;
  }
}

async function prepararDeclaracion(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  credenciales: ReturnType<DependenciasCertificacion['credenciales']>,
) {
  const empresa = await cargarEmpresa(cliente, ctx);
  const proceso = await exigirProceso(cliente, ctx);
  if (proceso.etapa === 'autorizada') {
    throw new ErrorUso(
      'La empresa ya está autorizada en producción: no hace falta declarar otra vez.',
    );
  }
  if (proceso.etapa !== 'por_declarar') {
    throw new ErrorUso(
      'Solo se declara cuando el SII muestra la empresa en P90: consulta antes el estado de la declaración (paso 4).',
    );
  }
  const datos = datosDeclaracion(empresa, proceso);
  const certificado = await credenciales.certificadoDeEmpresa({
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
  });
  return { empresa, proceso, datos, certificado };
}

/** Declara el cumplimiento: deja a la empresa AUTORIZADA EN PRODUCCIÓN (⚠️). */
export async function declarar(
  ctx: ContextoCertificacion,
  opciones: { confirmada: boolean },
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);
  const prep = () => prepararDeclaracion(cliente, ctx, credenciales);

  if (!opciones.confirmada) {
    return ensayar(async () => {
      const p = await prep();
      return {
        operacion: 'declarar',
        titulo: 'Declarar el cumplimiento',
        ambiente: AMBIENTE,
        certificado: await resumenCertificado(cliente, ctx, p.certificado),
        filas: [
          {
            etiqueta: 'Empresa',
            valor: `${p.empresa.razon_social} (${formatearRut(p.empresa.rut)})`,
          },
          { etiqueta: 'Enlace de consulta', valor: p.datos.linkConsulta },
          {
            etiqueta: 'Proveedor de software',
            valor: `${p.datos.nombreProveedor} (${formatearRut(p.datos.proveedor.toString())})`,
          },
          { etiqueta: 'Correo del proveedor', valor: p.datos.correoProveedor },
        ],
        avisos: [
          'Declarar deja a la empresa AUTORIZADA EN PRODUCCIÓN para emitir boletas electrónicas.',
          'El titular del certificado firma la declaración como representante legal.',
        ],
        textoConfirmar: 'Declarar el cumplimiento',
      };
    });
  }

  const previo = await validarAntes(prep);
  if (!previo.ok) return previo.resultado;

  const bloqueo = await verificarPortalAntes(deps, cliente, ctx);
  if (bloqueo) return bloqueo;

  const r = await ejecutar(
    deps,
    cliente,
    ctx,
    { operacion: 'declarar', confirmada: true },
    async ({ agregarDetalle }) => {
      const p = await prep();
      await using transporte = deps.transporte();
      const postulacion = deps.sii.postulacion({ transporte, reloj: deps.reloj });
      const declaracion = deps.sii.declaracion({ transporte, reloj: deps.reloj });
      let estado: EstadoDeclaracion;
      try {
        estado = await conSesionSii(
          deps,
          cliente,
          p.certificado,
          () => postulacion.autenticar(p.certificado.certificado),
          (sesion) => declaracion.declarar(sesion, p.datos),
        );
      } catch (error) {
        if (error instanceof DeclaracionInciertaError) {
          throw conIndicacion(error, INDICACION_DECLARACION_INCIERTA);
        }
        throw error;
      }
      agregarDetalle({ codigo_estado: estado.codigo });
      const ahora = deps.reloj.ahora();
      const cambio = await guardarEstadoDeclaracion(cliente, ctx, p.proceso, estado, ahora, {
        declarada_en: ahora.toISOString(),
      });
      return { estado, cambio };
    },
  );
  if (!r.ok) return errorDeEjecucion(r);

  const { estado, cambio } = r.valor;
  await notificarCambioEtapa(deps, cliente, ctx, cambio, r.operacionId);
  return ok(
    {
      titulo: 'Declaraste el cumplimiento',
      detalle: estado.autorizada()
        ? 'La empresa quedó autorizada en producción (P91): ya puede emitir boletas electrónicas.'
        : `El SII recibió la declaración. ${lineaEstado(estado)} Consulta el estado de la declaración para confirmarlo.`,
    },
    r.operacionId,
  );
}
