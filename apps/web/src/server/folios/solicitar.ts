import 'server-only';
import {
  type AmbienteSii,
  CANTIDAD_MAXIMA,
  ETIQUETA_AMBIENTE,
  enAmbiente,
  esAmbiente,
  esTipoFolio,
  MINUTOS_REVISION_VIGENTE,
  type NivelSolicitud,
  nombreTipoFolio,
  type ResultadoFolios,
  type TipoFolio,
  textoRango,
} from '@/lib/folios';
import { formatearMiles, formatearRut } from '@/lib/formatos';
import {
  ejecutar,
  errorDeEjecucion,
  fallaBase,
  ok,
  resumenCertificado,
} from '../certificacion/comun';
import {
  type DependenciasCertificacion,
  resolverDependencias,
} from '../certificacion/dependencias';
import { confirmarSesion as confirmarSesionConAuth } from '../certificados/acceso';
import { ErrorUso } from '../sii/errores';
import { MENSAJE_SESION_INVALIDA, revisarOperacionPendiente } from '../sii/operacion';
import type { ClienteServicio } from '../supabase/service';
import { foliosDisponibles } from './disponibles';
import {
  ErrorFolios,
  errorEmpresaDesactivada,
  errorEmpresaNoEncontrada,
  errorPlanSinProduccion,
  errorRevisionRequerida,
  errorRevisionUsada,
  errorSinAutorizacion,
  falloSinEjecutar,
} from './errores';
import { planPermiteProduccion } from './plan';
import { type SalidaSolicitud, solicitarEnSii } from './sii';
import type { ContextoFolios } from './tipos';

// Solicitar folios (CAF) de boleta, 39 o 41, en certificación o producción (PLAN-SAAS
// Fase 6, punto 2). Tres niveles, de menos a más:
//
//   1. ENSAYO (`nivel: 'ensayo'`): valida todo y devuelve el resumen para el `Dialogo`
//      (empresa, tipo, ambiente, cantidad, certificado, folios disponibles hoy, avisos).
//      Sin red ni filas (principio 3).
//   2. REVISIÓN CON EL SII (`nivel: 'revision'`, paridad con la CLI sin `--confirmar`):
//      `ejecutarOperacion('solicitar_folios', confirmada: false)` recorre el asistente
//      `of_*` sin la orden de timbrar y deja la solicitud `simulada` con el rango que
//      asignaría el SII. OBLIGATORIA antes de timbrar en producción; opcional en
//      certificación. Como sale al SII con el certificado de la empresa, antes de abrir la
//      operación confirma la sesión con Auth (`getUser()`) y aplica el control previo de
//      `ejecutarOperacion` (`revisarOperacionPendiente`): no corre con un `incierto` sin
//      revisar ni con una confirmada en curso de la misma empresa y ambiente.
//   3. TIMBRAR (`nivel: 'timbrar'`): `ejecutarOperacion('solicitar_folios', confirmada:
//      true)` (bloquea si hay un incierto sin revisar), fila `en_curso` → `registrar_caf`
//      → `timbrada`. Ver `sii.ts` para los cierres (`incierta`, `rechazada`, `error`).
//
// Criterio de la revisión obligatoria (producción), verificado también en el servidor: el
// timbraje trae `revisionId`, una solicitud `simulada` de la misma empresa, ambiente,
// tipo, cantidad y folio inicial, de hace menos de 30 minutos, y sin ninguna solicitud
// confirmada del mismo tipo después de ella (una revisión sirve para un solo timbraje).
//
// Requisitos (validados antes de abrir la operación, sin salir al SII ni dejar filas):
// tipo 39/41, cantidad entera 1–10.000 (sin valor por defecto), empresa activa, en
// producción la empresa `autorizada_produccion` y un plan vigente que `permite_produccion`,
// y el certificado de un representante electrónico (`representante: true`).

export interface OpcionesSolicitud {
  nivel: NivelSolicitud;
  tipoDte: TipoFolio;
  ambiente: AmbienteSii;
  cantidad: number;
  folioInicial?: number;
  /** Solicitud `simulada` que habilita timbrar en producción. */
  revisionId?: string;
}

interface Preparado {
  empresa: { rut: string; razon_social: string; autorizada_produccion: boolean };
  disponibles: Awaited<ReturnType<typeof foliosDisponibles>>;
  certificado: Awaited<
    ReturnType<ReturnType<DependenciasCertificacion['credenciales']>['certificadoDeEmpresa']>
  >;
  revision: { id: string; desde: number | null; hasta: number | null } | null;
}

async function cargarEmpresa(cliente: ClienteServicio, ctx: ContextoFolios) {
  const { data, error } = await cliente
    .from('empresas')
    .select('id, rut, razon_social, activa, autorizada_produccion')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', ctx.empresaId)
    .maybeSingle();
  if (error) throw fallaBase('leer la empresa', error);
  if (!data) throw errorEmpresaNoEncontrada();
  if (!data.activa) throw errorEmpresaDesactivada();
  return data;
}

/** La revisión con el SII que habilita timbrar en producción (ver el encabezado). */
async function exigirRevision(
  cliente: ClienteServicio,
  ctx: ContextoFolios,
  op: OpcionesSolicitud,
  ahora: Date,
): Promise<Preparado['revision']> {
  if (!op.revisionId) throw errorRevisionRequerida();
  const { data, error } = await cliente
    .from('solicitudes_folios')
    .select(
      'id, empresa_id, ambiente, tipo_dte, cantidad, folio_inicial, confirmada, estado, folio_desde, folio_hasta, creado_en',
    )
    .eq('organizacion_id', ctx.organizacionId)
    .eq('id', op.revisionId)
    .maybeSingle();
  if (error && error.code !== '22P02') throw fallaBase('leer la revisión de folios', error);
  if (
    !data ||
    data.empresa_id !== ctx.empresaId ||
    data.ambiente !== op.ambiente ||
    data.tipo_dte !== op.tipoDte ||
    data.cantidad !== op.cantidad ||
    (data.folio_inicial ?? null) !== (op.folioInicial ?? null) ||
    data.confirmada ||
    data.estado !== 'simulada'
  ) {
    throw errorRevisionRequerida();
  }
  if (ahora.getTime() - new Date(data.creado_en).getTime() > MINUTOS_REVISION_VIGENTE * 60_000) {
    throw errorRevisionUsada();
  }
  const posterior = await cliente
    .from('solicitudes_folios')
    .select('id')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('ambiente', op.ambiente)
    .eq('tipo_dte', op.tipoDte)
    .eq('confirmada', true)
    .gt('creado_en', data.creado_en)
    .limit(1);
  if (posterior.error) throw fallaBase('leer las solicitudes de folios', posterior.error);
  if (posterior.data.length > 0) throw errorRevisionUsada();
  return { id: data.id, desde: data.folio_desde, hasta: data.folio_hasta };
}

function validarEntrada(op: OpcionesSolicitud): void {
  if (!esTipoFolio(op.tipoDte)) {
    throw new ErrorFolios(
      'tipo_no_permitido',
      {
        titulo: 'Ese tipo de documento no se puede pedir aquí',
        detalle:
          'Por ahora Boletéame emite boleta electrónica (39) y boleta exenta electrónica (41). No se envió nada al SII.',
      },
      { campo: 'tipoDte' },
    );
  }
  if (!esAmbiente(op.ambiente))
    throw new ErrorUso('Elige el ambiente: certificación o producción.');
  if (!Number.isSafeInteger(op.cantidad) || op.cantidad < 1 || op.cantidad > CANTIDAD_MAXIMA) {
    throw new ErrorUso(
      `La cantidad de folios tiene que ser un número entero entre 1 y ${formatearMiles(CANTIDAD_MAXIMA)}.`,
    );
  }
  if (
    op.folioInicial !== undefined &&
    (!Number.isSafeInteger(op.folioInicial) || op.folioInicial < 1)
  ) {
    throw new ErrorUso('El folio inicial tiene que ser un número entero mayor que 0.');
  }
}

async function preparar(
  deps: DependenciasCertificacion,
  cliente: ClienteServicio,
  credenciales: ReturnType<DependenciasCertificacion['credenciales']>,
  ctx: ContextoFolios,
  op: OpcionesSolicitud,
): Promise<Preparado> {
  validarEntrada(op);
  const empresa = await cargarEmpresa(cliente, ctx);
  if (op.ambiente === 'produccion') {
    if (!empresa.autorizada_produccion) throw errorSinAutorizacion();
    if (!(await planPermiteProduccion(cliente, ctx.organizacionId))) {
      throw errorPlanSinProduccion();
    }
  }
  const revision =
    op.nivel === 'timbrar' && op.ambiente === 'produccion'
      ? await exigirRevision(cliente, ctx, op, deps.reloj.ahora())
      : null;
  const disponibles = await foliosDisponibles(cliente, {
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
    ambiente: op.ambiente,
    tipoDte: op.tipoDte,
  });
  const certificado = await credenciales.certificadoDeEmpresa({
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
    representante: true,
  });
  return { empresa, disponibles, certificado, revision };
}

async function ensayo(
  cliente: ClienteServicio,
  ctx: ContextoFolios,
  op: OpcionesSolicitud,
  p: Preparado,
): Promise<ResultadoFolios> {
  const produccion = op.ambiente === 'produccion';
  const tipo = nombreTipoFolio(op.tipoDte);
  const avisos: string[] = [];
  if (produccion) {
    avisos.push(
      'Los folios de producción son reales: al timbrarlos quedan autorizados para la empresa ante el SII y no se devuelven (solo se pueden anular).',
      'Antes de timbrar, revisa con el SII el rango que asignaría. La revisión no gasta folios.',
    );
  } else {
    avisos.push(
      'Se timbran folios de certificación (IDK 100): sirven para pruebas, no para emitir en producción.',
      'Si quieres, revisa antes con el SII el rango que asignaría. La revisión no gasta folios.',
    );
  }
  avisos.push(
    'El titular del certificado tiene que ser representante electrónico de la empresa ante el SII.',
  );
  if (p.disponibles.total > 0 && p.disponibles.primero) {
    avisos.unshift(
      `Ya tienes ${formatearMiles(p.disponibles.total)} folios de ${tipo} disponibles ${enAmbiente(op.ambiente)}.`,
    );
  }
  if (op.folioInicial !== undefined) {
    avisos.push(
      `Informas el folio inicial ${formatearMiles(op.folioInicial)}: el SII lo pide solo en el primer timbraje del tipo de documento.`,
    );
  }
  return {
    tipo: 'ensayo',
    resumen: {
      operacion: 'solicitar_folios',
      titulo: produccion ? 'Pedir folios de producción' : 'Pedir folios de certificación',
      ambiente: op.ambiente,
      tipoDte: op.tipoDte,
      cantidad: op.cantidad,
      folioInicial: op.folioInicial ?? null,
      revisionObligatoria: produccion,
      certificado: await resumenCertificado(cliente, ctx, p.certificado),
      filas: [
        {
          etiqueta: 'Empresa',
          valor: `${p.empresa.razon_social} (${formatearRut(p.empresa.rut)})`,
        },
        { etiqueta: 'Tipo de documento', valor: tipo },
        { etiqueta: 'Ambiente', valor: ETIQUETA_AMBIENTE[op.ambiente] },
        { etiqueta: 'Cantidad', valor: formatearMiles(op.cantidad) },
        ...(op.folioInicial !== undefined
          ? [{ etiqueta: 'Folio inicial', valor: formatearMiles(op.folioInicial) }]
          : []),
        { etiqueta: 'Folios disponibles hoy', valor: formatearMiles(p.disponibles.total) },
      ],
      avisos,
      textoConfirmar: produccion ? 'Revisar con el SII' : 'Timbrar folios',
    },
  };
}

/** Solicita folios: ensayo, revisión con el SII o timbraje (ver el encabezado). */
export async function solicitarFolios(
  ctx: ContextoFolios,
  op: OpcionesSolicitud,
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoFolios> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);
  const prep = () => preparar(deps, cliente, credenciales, ctx, op);

  let previo: Preparado;
  try {
    previo = await prep();
  } catch (error) {
    return falloSinEjecutar(error);
  }
  if (op.nivel === 'ensayo') {
    try {
      return await ensayo(cliente, ctx, op, previo);
    } catch (error) {
      return falloSinEjecutar(error);
    }
  }

  const simular = op.nivel === 'revision';
  if (simular) {
    // La revisión sale al SII con el certificado de la empresa, pero `ejecutarOperacion`
    // no la vigila (`confirmada: false`): se le aplican aquí, antes de abrir la
    // operación, la confirmación de la sesión con Auth y el mismo control de un
    // `incierto` sin revisar o de una confirmada en curso que tiene el timbraje.
    const confirmar = deps.operacion.confirmarSesion ?? confirmarSesionConAuth;
    if (!(await confirmar(ctx.usuarioId).catch(() => false))) {
      return {
        tipo: 'error',
        mensaje: { ...MENSAJE_SESION_INVALIDA },
        motivo: 'sesion_invalida',
        operacionId: null,
      };
    }
    const bloqueo = await revisarOperacionPendiente(
      {
        cliente,
        organizacionId: ctx.organizacionId,
        empresaId: ctx.empresaId,
        operacion: 'solicitar_folios',
        ambiente: op.ambiente,
      },
      deps.reloj.ahora(),
    );
    if (bloqueo.tipo === 'fallo') {
      return falloSinEjecutar(
        fallaBase('consultar la solicitud de folios anterior', { code: bloqueo.codigo }),
      );
    }
    if (bloqueo.tipo === 'bloqueada') {
      return {
        tipo: 'error',
        mensaje: { ...bloqueo.mensaje },
        motivo: bloqueo.motivo,
        operacionId: null,
        operacionPendienteId: bloqueo.operacionPendienteId,
      };
    }
  }
  const salida: SalidaSolicitud = {};
  const r = await ejecutar(
    deps,
    cliente,
    ctx,
    { operacion: 'solicitar_folios', confirmada: !simular, ambiente: op.ambiente },
    async (herramientas) => {
      // Se valida otra vez dentro de la operación (puede haber cambiado entre medio).
      const p = await prep();
      return solicitarEnSii(
        deps,
        cliente,
        ctx,
        {
          ambiente: op.ambiente,
          tipoDte: op.tipoDte,
          cantidad: op.cantidad,
          ...(op.folioInicial !== undefined ? { folioInicial: op.folioInicial } : {}),
          certificado: p.certificado,
          rutEmpresa: p.empresa.rut,
        },
        { simular },
        herramientas,
        salida,
      );
    },
  );
  if (!r.ok) {
    return errorDeEjecucion(
      r,
      salida.folioSugerido
        ? { requiere: { folioInicial: { sugerido: salida.folioSugerido } } }
        : {},
    ) as ResultadoFolios;
  }

  const tipo = nombreTipoFolio(op.tipoDte);
  const desenlace = r.valor;
  if (desenlace.tipo === 'simulada') {
    return {
      tipo: 'revision',
      mensaje: {
        titulo: `El SII asignaría los folios ${textoRango(desenlace.desde, desenlace.hasta)}`,
        detalle: `Revisamos la solicitud de ${formatearMiles(op.cantidad)} folios de ${tipo} ${enAmbiente(op.ambiente)} con el SII: no se timbraron. Si el rango está bien, ya puedes timbrarlos.`,
      },
      revision: {
        revisionId: desenlace.solicitudId,
        ambiente: op.ambiente,
        tipoDte: op.tipoDte,
        cantidad: op.cantidad,
        folioInicial: op.folioInicial ?? null,
        desde: desenlace.desde,
        hasta: desenlace.hasta,
      },
      operacionId: r.operacionId,
    };
  }
  const avisos: string[] = [];
  const rev = previo.revision;
  if (
    rev &&
    rev.desde !== null &&
    (rev.desde !== desenlace.desde || rev.hasta !== desenlace.hasta)
  ) {
    avisos.push(
      `En la revisión el SII indicó los folios ${textoRango(rev.desde, rev.hasta ?? rev.desde)}; al timbrar asignó ${textoRango(desenlace.desde, desenlace.hasta)}. Es normal si alguien timbró entre medio.`,
    );
  }
  return ok(
    {
      titulo: 'El SII timbró los folios',
      detalle: `Guardamos el CAF de ${tipo} con los folios ${textoRango(desenlace.desde, desenlace.hasta)} ${enAmbiente(op.ambiente)}. Ya se pueden usar para emitir.`,
    },
    r.operacionId,
    avisos,
  ) as ResultadoFolios;
}
