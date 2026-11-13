import 'server-only';
import {
  type CasoSetPruebas,
  ErrorValidacion,
  type EstadoDeclaracion,
  parsearSetPruebas,
  validarCorreo,
} from '@winex/certificacion';
import type { ResultadoPaso } from '@/lib/certificacion';
import { formatearFechaHora, formatearRut } from '@/lib/formatos';
import { ErrorUso, sanearTexto } from '../sii/errores';
import type { ClienteServicio } from '../supabase/service';
import type { Json, TablesUpdate } from '../supabase/tipos';
import {
  AMBIENTE,
  actualizarProceso,
  type CambioEtapa,
  cargarEmpresa,
  conSesionSii,
  ejecutar,
  ensayar,
  errorDeEjecucion,
  etapaEntre,
  exigirProceso,
  type FilaProcesoDb,
  fallaBase,
  ok,
  resumenCertificado,
  TIPO_BOLETA,
  validarAntes,
} from './comun';
import { type DependenciasCertificacion, resolverDependencias } from './dependencias';
import { notificarCambioEtapa } from './notificar';
import type { ContextoCertificacion } from './tipos';

// Paso 2: descarga del set de pruebas de boletas en el portal de la declaración (www4),
// con paridad con `sii certificacion descargar-set`:
//   - el SII REGISTRA la descarga y entrega un set NUEVO (los envíos hechos con uno
//     anterior dejan de servir para la revisión);
//   - candados: en P90 la librería no descarga (un set nuevo reiniciaría la
//     certificación); en P91 (ya autorizada) la app tampoco (la CLI exige
//     `--aunque-autorizada`, que aquí no existe);
//   - `parsearSetPruebas` (tipo 39) y la RPC `guardar_set_pruebas` (migración 0008)
//     reemplazan los casos y dejan el proceso en `set_descargado`, en una transacción.
// El estado de la declaración que se lee antes de descargar también se guarda (puede
// mover la etapa por el trigger: P91 → autorizada).

function correoValido(correo: string): string {
  try {
    validarCorreo(correo, 'correo del proveedor de software');
  } catch (error) {
    if (error instanceof ErrorValidacion) {
      throw new ErrorUso(`${error.message} Corrígelo y vuelve a intentarlo.`);
    }
    throw error;
  }
  return correo;
}

async function preparar(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  credenciales: ReturnType<DependenciasCertificacion['credenciales']>,
  correoOpcion: string | undefined,
) {
  const empresa = await cargarEmpresa(cliente, ctx);
  const proceso = await exigirProceso(cliente, ctx);
  if (proceso.etapa === 'borrador') {
    throw new ErrorUso(
      'Primero postula la empresa (paso 1): el SII entrega el set después de la postulación.',
    );
  }
  if (!etapaEntre(proceso.etapa, 'postulada', 'revision_solicitada')) {
    throw new ErrorUso(
      'La empresa ya está lista para declarar o autorizada: un set nuevo reiniciaría su certificación, así que no se descarga.',
    );
  }
  const correo = correoOpcion?.trim() || proceso.correo_proveedor_set;
  if (!correo) {
    throw new ErrorUso(
      'Falta el correo del proveedor de software: el SII lo pide para entregar el set. Escríbelo y vuelve a intentarlo.',
    );
  }
  const certificado = await credenciales.certificadoDeEmpresa({
    organizacionId: ctx.organizacionId,
    empresaId: ctx.empresaId,
  });
  return { empresa, proceso, correo: correoValido(correo), certificado };
}

/** Los casos como los guarda `guardar_set_pruebas`. */
function casosJson(casos: readonly CasoSetPruebas[]): Json {
  return casos.map((caso, i) => {
    const numero = /CASO-(\d+)/.exec(caso.referencia.razon)?.[1];
    return {
      numero_caso: numero ? Number(numero) : i + 1,
      tipo_dte: Number(caso.tipo),
      detalles: caso.detalles.map((d) => ({
        nombre: d.nombre,
        cantidad: d.cantidad,
        precio: d.precio,
        ...(d.exento === true ? { exento: true } : {}),
        ...(d.unidad !== undefined && d.unidad !== '' ? { unidad: d.unidad } : {}),
      })),
      referencia_codigo: caso.referencia.codigo,
      referencia_razon: caso.referencia.razon,
    };
  });
}

/** Guarda el estado de la declaración leído del SII (el trigger mueve la etapa en P90/P91). */
export async function guardarEstadoDeclaracion(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  proceso: Pick<FilaProcesoDb, 'id' | 'etapa'>,
  estado: EstadoDeclaracion,
  ahora: Date,
  extra: TablesUpdate<'procesos_certificacion'> = {},
): Promise<CambioEtapa> {
  return actualizarProceso(cliente, ctx, proceso, {
    codigo_estado_sii: estado.codigo,
    glosa_estado_sii: estado.glosa !== '' ? estado.glosa : null,
    paso_sii: estado.paso,
    estado_consultado_en: ahora.toISOString(),
    ...extra,
  });
}

type ValorDescarga =
  | { tipo: 'autorizada'; cambio: CambioEtapa }
  | { tipo: 'guardado'; casos: number; cambio: CambioEtapa }
  | { tipo: 'ilegible'; motivo: string; cambio: CambioEtapa };

/** Descarga un set de pruebas NUEVO (⚠️: el SII registra la descarga). */
export async function descargarSet(
  ctx: ContextoCertificacion,
  opciones: { confirmada: boolean; correoProveedorSet?: string },
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);
  const prep = () => preparar(cliente, ctx, credenciales, opciones.correoProveedorSet);

  if (!opciones.confirmada) {
    return ensayar(async () => {
      const p = await prep();
      const avisos = [
        'El SII registra la descarga y entrega un set NUEVO: los envíos hechos con un set anterior dejan de servir para la revisión.',
      ];
      if (p.proceso.set_descargado_en) {
        avisos.push(
          `Ya descargaste un set el ${formatearFechaHora(p.proceso.set_descargado_en)}. Si descargas otro, tendrás que enviar las boletas de ese set nuevo.`,
        );
      }
      return {
        operacion: 'descargar_set',
        titulo: 'Descargar el set de pruebas',
        ambiente: AMBIENTE,
        certificado: await resumenCertificado(cliente, ctx, p.certificado),
        filas: [
          {
            etiqueta: 'Empresa',
            valor: `${p.empresa.razon_social} (${formatearRut(p.empresa.rut)})`,
          },
          { etiqueta: 'Correo del proveedor de software', valor: p.correo },
          { etiqueta: 'Tipo de documento', valor: `Boleta electrónica (${TIPO_BOLETA})` },
        ],
        avisos,
        textoConfirmar: 'Descargar el set',
      };
    });
  }

  const previo = await validarAntes(prep);
  if (!previo.ok) return previo.resultado;

  const r = await ejecutar(
    deps,
    cliente,
    ctx,
    { operacion: 'descargar_set', confirmada: true },
    async ({ agregarDetalle }): Promise<ValorDescarga> => {
      const p = await prep();
      await using transporte = deps.transporte();
      const postulacion = deps.sii.postulacion({ transporte, reloj: deps.reloj });
      const declaracion = deps.sii.declaracion({ transporte, reloj: deps.reloj });
      const rut = p.empresa.rut;

      return conSesionSii(
        deps,
        cliente,
        p.certificado,
        () => postulacion.autenticar(p.certificado.certificado),
        async (sesion): Promise<ValorDescarga> => {
          const estado = await declaracion.estado(sesion, rut);
          agregarDetalle({ codigo_estado: estado.codigo });
          const cambioEstado = await guardarEstadoDeclaracion(
            cliente,
            ctx,
            p.proceso,
            estado,
            deps.reloj.ahora(),
          );
          if (estado.autorizada()) {
            // Paridad con la CLI: no se descarga (no se sabe si un set nuevo la afecta).
            return { tipo: 'autorizada', cambio: cambioEstado };
          }

          const texto = await declaracion.descargarSetPruebas(sesion, rut, p.correo);
          let casos: CasoSetPruebas[];
          try {
            casos = parsearSetPruebas(texto, String(TIPO_BOLETA));
          } catch (error) {
            // El SII ya registró la descarga: se guarda el texto para revisarlo, sin casos.
            const motivo =
              error instanceof ErrorValidacion ? sanearTexto(error.message) : 'formato desconocido';
            agregarDetalle({ set_ilegible: true });
            const borrado = await cliente
              .from('set_pruebas_casos')
              .delete()
              .eq('organizacion_id', ctx.organizacionId)
              .eq('proceso_id', p.proceso.id);
            if (borrado.error) throw fallaBase('borrar los casos del set anterior', borrado.error);
            await actualizarProceso(
              cliente,
              ctx,
              { ...p.proceso, etapa: cambioEstado.nueva },
              {
                set_pruebas_texto: texto,
                correo_proveedor_set: p.correo,
                set_descargado_en: deps.reloj.ahora().toISOString(),
                envio_set_id: null,
                revision_solicitada_en: null,
              },
            );
            return { tipo: 'ilegible', motivo, cambio: cambioEstado };
          }

          const guardado = await cliente.rpc('guardar_set_pruebas', {
            p_organizacion: ctx.organizacionId,
            p_proceso: p.proceso.id,
            p_texto: texto,
            p_correo_proveedor: p.correo,
            p_casos: casosJson(casos),
          });
          if (guardado.error) throw fallaBase('guardar el set de pruebas', guardado.error);
          agregarDetalle({ casos: casos.length });
          return {
            tipo: 'guardado',
            casos: casos.length,
            cambio: { anterior: p.proceso.etapa, nueva: 'set_descargado' },
          };
        },
      );
    },
  );
  if (!r.ok) return errorDeEjecucion(r);

  await notificarCambioEtapa(deps, cliente, ctx, r.valor.cambio, r.operacionId);
  switch (r.valor.tipo) {
    case 'autorizada':
      return {
        tipo: 'error',
        mensaje: {
          titulo: 'La empresa ya está autorizada en producción',
          detalle:
            'El SII la muestra en P91: no descargamos un set nuevo porque no se sabe si la afecta. No hace falta seguir con la certificación.',
        },
        operacionId: r.operacionId,
        motivo: 'autorizada',
      };
    case 'ilegible':
      return {
        tipo: 'error',
        mensaje: {
          titulo: 'El SII entregó el set, pero no pudimos leer sus casos',
          detalle: `${r.valor.motivo} El set quedó guardado y el SII registró la descarga: no lo vuelvas a descargar todavía y escríbenos a soporte.`,
        },
        operacionId: r.operacionId,
        motivo: 'set_ilegible',
      };
    case 'guardado':
      return ok(
        {
          titulo: 'Descargamos el set de pruebas',
          detalle: `El set trae ${r.valor.casos} casos. El siguiente paso es pedir los folios y enviar el set al SII.`,
        },
        r.operacionId,
      );
  }
}
