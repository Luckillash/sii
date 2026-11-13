import 'server-only';
import { DatosPostulacion, ErrorValidacion, type ResultadoPostulacion } from '@winex/certificacion';
import type { ResultadoPaso } from '@/lib/certificacion';
import { formatearRut, hoyEnChile } from '@/lib/formatos';
import { ErrorConfig, ErrorUso } from '../sii/errores';
import type { ClienteServicio } from '../supabase/service';
import {
  AMBIENTE,
  actualizarProceso,
  cargarEmpresaPorCertificar,
  conSesionSii,
  EXPLICACION_ASCII,
  ejecutar,
  ensayar,
  errorDeEjecucion,
  etapaEntre,
  exigirProceso,
  type FilaEmpresaDb,
  type FilaProcesoDb,
  ok,
  primerNoAscii,
  resumenCertificado,
  validarAntes,
} from './comun';
import { type DependenciasCertificacion, resolverDependencias } from './dependencias';
import { notificarCambioEtapa } from './notificar';
import { verificarPortalAntes } from './portal';
import type { ContextoCertificacion } from './tipos';

// Paso 1: postulación a boleta electrónica en certificación (asistente `pe_*` de
// maullin), con paridad con `sii certificacion postular` de la CLI:
//   - los datos salen de `procesos_certificacion` (guardados con el formulario) y se
//     validan con `DatosPostulacion` de la librería; los textos en ASCII imprimible;
//   - `verificar_portal` antes (código 7 bloquea el paso);
//   - login AUT2000 con el certificado predeterminado (sesión reutilizada, bajo el
//     bloqueo del certificado) y `PostulacionSii.postular`;
//   - OK: etapa `postulada` (si estaba en `borrador`), `postulada_en` y los avisos del
//     SII; si la empresa no tiene resolución de certificación, se registra (número 0,
//     fecha del día de la postulación en Chile: es la `FchResol` de certificación).
//
// Se puede repetir (la librería y el SII lo permiten: deja a la empresa en
// certificación con los datos nuevos) hasta que la empresa está lista para declarar.

/** Los datos de la postulación del proceso, validados. Lanza `ErrorConfig` / `ErrorUso`. */
function datosPostulacion(empresa: FilaEmpresaDb, proceso: FilaProcesoDb): DatosPostulacion {
  const requeridos = {
    'el RUT del administrador': proceso.rut_administrador,
    'el correo del administrador': proceso.correo_administrador,
    'el correo de contacto con el SII': proceso.correo_contacto_sii,
    'el correo de intercambio': proceso.correo_intercambio,
    'el nombre del software': proceso.nombre_software,
  };
  const faltan = Object.entries(requeridos)
    .filter(([, valor]) => typeof valor !== 'string' || valor.trim() === '')
    .map(([nombre]) => nombre);
  if (faltan.length > 0) {
    throw new ErrorUso(
      `Faltan datos de la postulación: ${faltan.join(', ')}. Complétalos en el paso 1 y guárdalos.`,
    );
  }
  const textos = [
    proceso.correo_administrador,
    proceso.correo_contacto_sii,
    proceso.correo_intercambio,
    proceso.nombre_software,
    proceso.url,
  ];
  if (textos.some((t) => t !== null && primerNoAscii(t) !== undefined)) {
    throw new ErrorConfig(
      `Los datos de la postulación tienen caracteres que el SII no acepta. ${EXPLICACION_ASCII}`,
    );
  }
  try {
    return new DatosPostulacion({
      rutEmpresa: empresa.rut,
      rutAdministrador: proceso.rut_administrador ?? '',
      correoAdministrador: proceso.correo_administrador ?? '',
      correoContactoSii: proceso.correo_contacto_sii ?? '',
      correoIntercambio: proceso.correo_intercambio ?? '',
      nombreSoftware: proceso.nombre_software ?? '',
      boletaExenta: proceso.boleta_exenta,
      ...(proceso.url ? { url: proceso.url } : {}),
    });
  } catch (error) {
    if (error instanceof ErrorValidacion) {
      throw new ErrorConfig(
        `Los datos de la postulación no son válidos: ${error.message} Corrígelos en el paso 1.`,
      );
    }
    throw error;
  }
}

async function preparar(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  credenciales: ReturnType<DependenciasCertificacion['credenciales']>,
) {
  const empresa = await cargarEmpresaPorCertificar(cliente, ctx);
  const proceso = await exigirProceso(cliente, ctx);
  if (!etapaEntre(proceso.etapa, 'borrador', 'revision_solicitada')) {
    throw new ErrorUso(
      'La empresa ya está lista para declarar o autorizada: no hace falta volver a postular.',
    );
  }
  const datos = datosPostulacion(empresa, proceso);
  const certificado = await credenciales.certificadoDeEmpresa({
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
  });
  return { empresa, proceso, datos, certificado };
}

/** Registra la resolución de certificación si la empresa no tiene una vigente. */
async function registrarResolucionSiFalta(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  fecha: string,
): Promise<string | null> {
  const aviso =
    'No pudimos registrar la resolución de certificación (número 0, fecha de hoy). Regístrala en Configuración → Empresas antes de enviar el set.';
  try {
    const { data, error } = await cliente
      .from('resoluciones')
      .select('id')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('empresa_id', ctx.empresaId)
      .eq('ambiente', AMBIENTE)
      .eq('vigente', true)
      .maybeSingle();
    if (error) return aviso;
    if (data) return null;
    const r = await cliente.rpc('registrar_resolucion', {
      p_empresa: ctx.empresaId,
      p_ambiente: AMBIENTE,
      p_numero: 0,
      p_fecha: fecha,
    });
    return r.error ? aviso : null;
  } catch {
    return aviso;
  }
}

/** Postula la empresa a boleta electrónica en certificación (⚠️). */
export async function postular(
  ctx: ContextoCertificacion,
  opciones: { confirmada: boolean },
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);

  if (!opciones.confirmada) {
    return ensayar(async () => {
      const p = await preparar(cliente, ctx, credenciales);
      const avisos = [
        'El titular del certificado tiene que ser representante legal de la empresa ante el SII.',
      ];
      if (p.proceso.etapa !== 'borrador') {
        avisos.push(
          'La empresa ya fue postulada: volver a postular la deja en certificación con los datos nuevos.',
        );
      }
      if (p.datos.administrador.toString() !== p.certificado.rutTitular) {
        avisos.push(
          'El administrador no es el titular del certificado: tiene que ser quien después se autentica para ver el avance y declarar.',
        );
      }
      return {
        operacion: 'postular',
        titulo: 'Postular a boleta electrónica',
        ambiente: AMBIENTE,
        certificado: await resumenCertificado(cliente, ctx, p.certificado),
        filas: [
          {
            etiqueta: 'Empresa',
            valor: `${p.empresa.razon_social} (${formatearRut(p.empresa.rut)})`,
          },
          { etiqueta: 'Administrador', valor: formatearRut(p.datos.administrador.toString()) },
          { etiqueta: 'Correo del administrador', valor: p.datos.correoAdministrador },
          { etiqueta: 'Correo de contacto con el SII', valor: p.datos.correoContactoSii },
          { etiqueta: 'Correo de intercambio', valor: p.datos.correoIntercambio },
          { etiqueta: 'Nombre del software', valor: p.datos.nombreSoftware },
          { etiqueta: 'Boleta exenta', valor: p.datos.boletaExenta ? 'Sí' : 'No' },
          { etiqueta: 'URL', valor: p.datos.url !== '' ? p.datos.url : 'Sin URL' },
        ],
        avisos,
        textoConfirmar: 'Postular',
      };
    });
  }

  const previo = await validarAntes(() => preparar(cliente, ctx, credenciales));
  if (!previo.ok) return previo.resultado;

  const bloqueo = await verificarPortalAntes(deps, cliente, ctx);
  if (bloqueo) return bloqueo;

  const r = await ejecutar(
    deps,
    cliente,
    ctx,
    { operacion: 'postular', confirmada: true },
    async ({ agregarDetalle }) => {
      const p = await preparar(cliente, ctx, credenciales);
      await using transporte = deps.transporte();
      const postulacion = deps.sii.postulacion({ transporte, reloj: deps.reloj });
      const resultado: ResultadoPostulacion = await conSesionSii(
        deps,
        cliente,
        p.certificado,
        () => postulacion.autenticar(p.certificado.certificado),
        (sesion) => postulacion.postular(sesion, p.datos),
      );
      agregarDetalle({ avisos_sii: resultado.avisos.length });
      const ahora = deps.reloj.ahora();
      const cambio = await actualizarProceso(cliente, ctx, p.proceso, {
        postulada_en: ahora.toISOString(),
        avisos_postulacion: [...resultado.avisos],
        ...(p.proceso.etapa === 'borrador' ? { etapa: 'postulada' as const } : {}),
      });
      const avisoResolucion = await registrarResolucionSiFalta(cliente, ctx, hoyEnChile(ahora));
      return { resultado, cambio, avisoResolucion };
    },
  );
  if (!r.ok) return errorDeEjecucion(r);

  const { resultado, cambio, avisoResolucion } = r.valor;
  await notificarCambioEtapa(deps, cliente, ctx, cambio, r.operacionId);
  return ok(
    {
      titulo: 'El SII aceptó la postulación',
      detalle:
        'La empresa quedó postulada a boleta electrónica en certificación. El siguiente paso es descargar el set de pruebas.',
    },
    r.operacionId,
    [...resultado.avisos, ...(avisoResolucion ? [avisoResolucion] : [])],
  );
}
