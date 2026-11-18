import 'server-only';
import {
  type AmbienteEmision,
  type BorradorGuardado,
  type FoliosEmision,
  RECEPTOR_GENERICO,
  type VistaEmision,
} from '@/lib/emision';
import {
  AMBIENTES_FOLIO,
  type AmbienteSii,
  disponibilidadDe,
  estadoDisponibilidad,
  TIPOS_FOLIO,
} from '@/lib/folios';
import { fallaBase } from '../certificacion/comun';
import { leerCafs } from '../folios/disponibles';
import { cuotaProduccion, planPermiteProduccion } from '../folios/plan';
import { ErrorUso } from '../sii/errores';
import { aBorrador, UUID } from './borradores';
import { type DependenciasEmision, resolverDependenciasEmision } from './dependencias';
import { motivoAmbiente } from './preparar';
import type { ContextoEmision } from './tipos';

// Lectura de `/[org]/emitir` (PLAN-SAAS Fase 7) con el cliente de SESIÓN: todo pasa por
// RLS (lectura para cualquier miembro) y cada consulta filtra además por organización y
// empresa. El plan sale de `plan_vigente()` (solo service_role, con la organización de la
// membresía), como en Folios: si falla, la vista no bloquea por el plan y decide el
// servidor. Los folios usan la regla de `disponibilidadDe` (la de `asignar_folio`). Nada de
// secretos: ni `caf_secret_id` ni los ids de Vault del certificado.

const MAXIMO_BORRADORES = 10;

/** Estado de `/[org]/emitir` para una empresa. Lanza `ErrorUso` si no es de la organización. */
export async function leerVistaEmision(
  ctx: Omit<ContextoEmision, 'usuarioId'>,
  opciones: { borradorId?: string } = {},
  dependencias?: Partial<DependenciasEmision>,
): Promise<VistaEmision> {
  if (!UUID.test(ctx.organizacionId) || !UUID.test(ctx.empresaId)) {
    throw new ErrorUso('No encontramos la empresa en esta organización.');
  }
  const deps = resolverDependenciasEmision(dependencias);
  const sesion = await deps.sesion();
  const { organizacionId, empresaId } = ctx;

  const empresa = await sesion
    .from('empresas')
    .select('id, rut, razon_social, activa, autorizada_produccion')
    .eq('organizacion_id', organizacionId)
    .eq('id', empresaId)
    .maybeSingle();
  if (empresa.error) throw fallaBase('leer la empresa', empresa.error);
  const fila = empresa.data;
  if (!fila) throw new ErrorUso('No encontramos la empresa en esta organización.');

  const clave = (ambiente: AmbienteSii, tipoDte: number) => ({
    organizacionId,
    empresaId,
    ambiente,
    tipoDte,
  });
  const combinaciones = AMBIENTES_FOLIO.flatMap((ambiente) =>
    TIPOS_FOLIO.map((tipoDte) => ({ ambiente, tipoDte })),
  );

  const [resoluciones, predeterminado, borradores, cafs, plan, cuota] = await Promise.all([
    sesion
      .from('resoluciones')
      .select('ambiente, numero, fecha')
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .eq('vigente', true),
    sesion
      .from('empresa_certificados')
      .select('certificado_id')
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .eq('predeterminado', true)
      .maybeSingle(),
    sesion
      .from('documentos')
      .select(
        'id, tipo_dte, ambiente, receptor_rut, receptor_razon_social, mnt_total, actualizado_en',
      )
      .eq('organizacion_id', organizacionId)
      .eq('empresa_id', empresaId)
      .eq('estado', 'borrador')
      .order('actualizado_en', { ascending: false })
      .limit(MAXIMO_BORRADORES),
    Promise.all(combinaciones.map((c) => leerCafs(sesion, clave(c.ambiente, c.tipoDte)))),
    planPermiteProduccion(deps.servicio(), organizacionId).catch(() => null),
    cuotaProduccion(deps.servicio(), organizacionId, deps.reloj.ahora()).catch(() => null),
  ]);
  if (resoluciones.error) throw fallaBase('leer las resoluciones', resoluciones.error);
  if (predeterminado.error) throw fallaBase('leer los certificados', predeterminado.error);
  if (borradores.error) throw fallaBase('leer los borradores', borradores.error);

  // Certificado predeterminado vigente (no revocado ni vencido): el que usa la emisión.
  let certificado: VistaEmision['certificado'] = null;
  if (predeterminado.data) {
    const c = await sesion
      .from('certificados')
      .select('nombre_titular, cn, rut_titular, vigente_hasta, revocado_en')
      .eq('organizacion_id', organizacionId)
      .eq('id', predeterminado.data.certificado_id)
      .maybeSingle();
    if (c.error) throw fallaBase('leer el certificado', c.error);
    const ahora = deps.reloj.ahora().getTime();
    if (
      c.data &&
      !c.data.revocado_en &&
      (!c.data.vigente_hasta || new Date(c.data.vigente_hasta).getTime() > ahora)
    ) {
      certificado = {
        titular: c.data.nombre_titular ?? c.data.cn ?? c.data.rut_titular,
        rut: c.data.rut_titular,
        vigenteHasta: c.data.vigente_hasta ?? '',
      };
    }
  }

  const ambientes: AmbienteEmision[] = AMBIENTES_FOLIO.map((ambiente) => {
    const r = resoluciones.data.find((x) => x.ambiente === ambiente);
    const motivo = motivoAmbiente(ambiente, {
      activa: fila.activa,
      autorizadaProduccion: fila.autorizada_produccion,
      planPermiteProduccion: plan,
      conResolucion: Boolean(r),
      conCertificado: certificado !== null,
    });
    return {
      ambiente,
      habilitado: motivo === null,
      motivo,
      resolucion: r ? { numero: r.numero, fecha: r.fecha } : null,
    };
  });

  const folios: FoliosEmision[] = combinaciones.map(({ ambiente, tipoDte }, i) => {
    const rangos = cafs[i] ?? [];
    const d = disponibilidadDe(rangos);
    const enUso = rangos.find((c) => c.id === d.cafEnUso);
    return {
      ambiente,
      tipoDte,
      siguiente: enUso ? enUso.siguiente : null,
      disponibles: d.restante,
      total: d.total,
      estado: estadoDisponibilidad(d),
      puedeEmitir: d.restante > 0,
    };
  });

  const listaBorradores: BorradorGuardado[] = borradores.data.map((b) => ({
    id: b.id,
    tipoDte: b.tipo_dte === 41 ? 41 : 39,
    ambiente: b.ambiente,
    receptorRut: b.receptor_rut,
    receptorRazonSocial:
      b.receptor_rut === RECEPTOR_GENERICO.rut
        ? (b.receptor_razon_social ?? RECEPTOR_GENERICO.razonSocial)
        : b.receptor_razon_social,
    total: b.mnt_total,
    actualizadoEn: b.actualizado_en,
  }));

  let borrador: VistaEmision['borrador'] = null;
  if (opciones.borradorId && UUID.test(opciones.borradorId)) {
    const [doc, lineas] = await Promise.all([
      sesion
        .from('documentos')
        .select(
          'id, tipo_dte, ambiente, receptor_id, receptor_rut, receptor_razon_social, descuento_tipo, descuento_valor, descuento_glosa, metadata',
        )
        .eq('organizacion_id', organizacionId)
        .eq('empresa_id', empresaId)
        .eq('id', opciones.borradorId)
        .eq('estado', 'borrador')
        .maybeSingle(),
      sesion
        .from('documento_detalles')
        .select('nro_linea, producto_id, nombre, cantidad, precio, exento, unidad')
        .eq('organizacion_id', organizacionId)
        .eq('documento_id', opciones.borradorId)
        .order('nro_linea', { ascending: true }),
    ]);
    if (doc.error) throw fallaBase('leer el borrador', doc.error);
    if (lineas.error) throw fallaBase('leer las líneas del borrador', lineas.error);
    if (doc.data) borrador = { id: doc.data.id, datos: aBorrador(doc.data, lineas.data) };
  }

  return {
    empresa: {
      id: fila.id,
      rut: fila.rut,
      razonSocial: fila.razon_social,
      activa: fila.activa,
      autorizadaProduccion: fila.autorizada_produccion,
    },
    certificado,
    ambientes,
    folios,
    borradores: listaBorradores,
    borrador,
    cuotaProduccion: cuota,
  };
}
