import 'server-only';
import {
  type CafRango,
  LARGO_MAXIMO_MOTIVO,
  nombreTipoFolio,
  type ResultadoFolios,
  textoRango,
  validarRangoAnulacion,
} from '@/lib/folios';
import { formatearMiles } from '@/lib/formatos';
import { fallaBase, ok } from '../certificacion/comun';
import {
  type DependenciasCertificacion,
  resolverDependencias,
} from '../certificacion/dependencias';
import { confirmarSesion as confirmarSesionConAuth } from '../certificados/acceso';
import { alertarSiCruza } from './alertas';
import { disponibilidad } from './disponibles';
import {
  ErrorFolios,
  falloSinEjecutar,
  MENSAJE_SESION_INVALIDA,
  traducirErrorAnulacion,
} from './errores';
import type { ClaveFolios, ContextoFolios } from './tipos';

// Anular folios no usados de un CAF (PLAN-SAAS Fase 6, punto 5), solo administradores.
// Dos acciones desde el historial de CAF:
//   - folios asignados que no se usaron (rango completo bajo `siguiente_folio`);
//   - «Anular los folios que quedan»: la cola, desde `siguiente_folio` hasta
//     `folio_hasta`, que además deja el CAF `anulado` (`asignar_folio` ya no lo usa).
//
// Llama a `anular_folios` (migración 0011) con el cliente de SESIÓN del usuario: el
// permiso (`es_admin`) lo verifica la base con `auth.uid()`, y `anulado_por` queda con su
// id. La app valida antes el rango (para dar el mensaje con los folios) y traduce los
// errores de la base (P0002, 42501, 22023, 23503) a mensajes del design system.
// Después de anular la cola revisa la alerta `folios.por_agotarse` (la disponibilidad
// baja). No es una operación del SII (no va a `operaciones_sii`).

export interface EntradaAnular {
  cafId: string;
  desde: number;
  hasta: number;
  motivo: string;
}

export async function anularFolios(
  ctx: ContextoFolios,
  entrada: EntradaAnular,
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoFolios> {
  const deps = resolverDependencias(dependencias);
  try {
    const motivo = entrada.motivo.trim();
    if (motivo === '' || motivo.length > LARGO_MAXIMO_MOTIVO) {
      throw new ErrorFolios(
        'rango_invalido',
        {
          titulo: 'Escribe el motivo de la anulación',
          detalle: `El motivo es obligatorio y puede tener hasta ${LARGO_MAXIMO_MOTIVO} caracteres. No se anuló nada.`,
        },
        { campo: 'motivo' },
      );
    }

    const sesion = await deps.sesion();
    const fila = await sesion
      .from('cafs')
      .select('id, ambiente, tipo_dte, folio_desde, folio_hasta, siguiente_folio, estado')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('empresa_id', ctx.empresaId)
      .eq('id', entrada.cafId)
      .maybeSingle();
    if (fila.error && fila.error.code !== '22P02') throw fallaBase('leer el CAF', fila.error);
    if (!fila.data) {
      return {
        tipo: 'error',
        mensaje: traducirErrorAnulacion({ code: 'P0002' }),
        motivo: 'caf_no_encontrado',
        operacionId: null,
      };
    }
    const caf: CafRango = {
      id: fila.data.id,
      desde: fila.data.folio_desde,
      hasta: fila.data.folio_hasta,
      siguiente: fila.data.siguiente_folio,
      estado: fila.data.estado,
    };
    const problema = validarRangoAnulacion(caf, entrada.desde, entrada.hasta);
    if (problema) {
      throw new ErrorFolios(
        'rango_invalido',
        { titulo: 'Revisa el rango a anular', detalle: `${problema} No se anuló nada.` },
        { campo: 'desde' },
      );
    }

    const confirmar = deps.operacion.confirmarSesion ?? confirmarSesionConAuth;
    if (!(await confirmar(ctx.usuarioId).catch(() => false))) {
      return {
        tipo: 'error',
        mensaje: { ...MENSAJE_SESION_INVALIDA },
        motivo: 'sesion_invalida',
        operacionId: null,
      };
    }

    const cola = entrada.hasta >= caf.siguiente;
    const servicio = deps.servicio();
    const clave: ClaveFolios = {
      organizacionId: ctx.organizacionId,
      empresaId: ctx.empresaId,
      ambiente: fila.data.ambiente,
      tipoDte: fila.data.tipo_dte,
    };
    const antes = cola ? await disponibilidad(servicio, clave).catch(() => null) : null;

    const { data, error } = await sesion.rpc('anular_folios', {
      p_caf: caf.id,
      p_desde: entrada.desde,
      p_hasta: entrada.hasta,
      p_motivo: motivo,
    });
    if (error) {
      return {
        tipo: 'error',
        mensaje: traducirErrorAnulacion(error),
        motivo: error.code === '42501' ? 'sin_permiso' : 'rechazo_base',
        operacionId: null,
      };
    }

    if (cola && antes) {
      try {
        const despues = await disponibilidad(servicio, clave);
        await alertarSiCruza(deps, servicio, clave, antes, despues);
      } catch {
        // La alerta nunca frena la anulación, que ya quedó hecha.
        console.warn('folios: no se pudo revisar la alerta después de anular');
      }
    }

    const cantidad = typeof data === 'number' ? data : 0;
    const rango = textoRango(entrada.desde, entrada.hasta);
    const tipo = nombreTipoFolio(fila.data.tipo_dte);
    if (cantidad === 0) {
      return ok(
        {
          titulo: 'Esos folios ya estaban anulados',
          detalle: `Los folios ${rango} de ${tipo} ya figuraban como anulados. No cambiamos nada.`,
        },
        null,
        [],
        { tono: 'info' },
      ) as ResultadoFolios;
    }
    return ok(
      {
        titulo: cantidad === 1 ? 'Anulamos 1 folio' : `Anulamos ${formatearMiles(cantidad)} folios`,
        detalle: `Folios ${rango} de ${tipo}. Se informan como anulados en el resumen diario de boletas (RCOF).${cola ? ' El CAF quedó anulado: ya no se usa para emitir.' : ''}`,
      },
      null,
    ) as ResultadoFolios;
  } catch (error) {
    return falloSinEjecutar(error);
  }
}
