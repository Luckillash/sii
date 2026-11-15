import 'server-only';
import {
  type AmbienteSii,
  enAmbiente,
  esAmbiente,
  nombreTipoFolio,
  type ResultadoFolios,
  TAMANO_MAXIMO_CAF,
  textoRango,
} from '@/lib/folios';
import { formatearFechaHora } from '@/lib/formatos';
import { fallaBase, ok } from '../certificacion/comun';
import {
  type DependenciasCertificacion,
  resolverDependencias,
} from '../certificacion/dependencias';
import { confirmarSesion as confirmarSesionConAuth } from '../certificados/acceso';
import { ErrorUso } from '../sii/errores';
import { marcarInciertaRevisada } from '../sii/operacion';
import type { ClienteServicio } from '../supabase/service';
import { validarCaf } from './caf';
import {
  codigoPg,
  ErrorFolios,
  errorEmpresaDesactivada,
  errorEmpresaNoEncontrada,
  errorTraslape,
  falloSinEjecutar,
  MENSAJE_SESION_INVALIDA,
} from './errores';
import type { ContextoFolios } from './tipos';

// Subir un CAF existente (PLAN-SAAS Fase 6, puntos 3 y 4), solo administradores. Para un
// CAF que la empresa ya tiene: el que se bajó de «Folios ya autorizados» después de una
// solicitud `incierta`, o uno timbrado en el portal del SII.
//
//   - No es una operación del SII (no sale a la red ni va a `operaciones_sii`).
//   - Valida con la librería (`validarCaf`): CAF del SII, tipo 39/41, IDK del ambiente
//     elegido, RUT emisor = RUT de la empresa, `<RSASK>` legible y del par de `<RSAPK>`.
//   - Traslape con otro CAF de la empresa (mismo ambiente y tipo): se revisa aquí para dar
//     el rango, y la base lo rechaza igual con 23P01 (trigger de la 0011).
//   - Repetir el mismo CAF (mismo rango) es idempotente: «Ese CAF ya estaba cargado».
//   - El XML completo va a Vault SOLO por `registrar_caf` (service_role, con la
//     organización de la membresía). Nunca a logs, Sentry ni de vuelta al navegador.
//   - Si calza (ambiente, tipo y rango) con una solicitud `incierta` de la empresa, se
//     pasa como `p_solicitud`: `registrar_caf` (0008) acepta cualquier estado y la deja
//     `timbrada` con el CAF enlazado. Además se marca revisada la operación incierta que
//     la originó, para que se pueda volver a pedir folios.
//   - Confirma la sesión con Auth (`getUser()`) antes de escribir, como la carga de
//     certificados.
//   - Exige la empresa activa, con el mismo mensaje que pedir folios.

export interface EntradaSubida {
  ambiente: AmbienteSii;
  contenido: Uint8Array;
}

async function resolverIncierta(
  cliente: ClienteServicio,
  ctx: ContextoFolios,
  solicitudId: string,
  reloj: () => Date,
): Promise<boolean> {
  const { data, error } = await cliente
    .from('operaciones_sii')
    .select('id')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('solicitud_id', solicitudId)
    .in('resultado', ['incierto', 'en_curso']);
  if (error) {
    console.warn(`folios: no se pudo leer la operación incierta (código ${error.code})`);
    return false;
  }
  let marcada = false;
  for (const op of data) {
    const r = await marcarInciertaRevisada(
      cliente,
      { organizacionId: ctx.organizacionId, operacionId: op.id, usuarioId: ctx.usuarioId },
      reloj,
    );
    marcada ||= r.ok;
  }
  return marcada;
}

/** Sube un CAF que la empresa ya tiene (ver el encabezado). */
export async function subirCaf(
  ctx: ContextoFolios,
  entrada: EntradaSubida,
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoFolios> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  try {
    if (!esAmbiente(entrada.ambiente)) {
      throw new ErrorUso('Elige el ambiente del CAF: certificación o producción.');
    }
    if (entrada.contenido.byteLength === 0) {
      throw new ErrorFolios(
        'archivo_vacio',
        { titulo: 'Elige el archivo del CAF', detalle: 'El archivo está vacío o no se subió.' },
        { campo: 'caf' },
      );
    }
    if (entrada.contenido.byteLength > TAMANO_MAXIMO_CAF) {
      throw new ErrorFolios(
        'archivo_grande',
        {
          titulo: 'El archivo es demasiado grande para ser un CAF',
          detalle:
            'Un CAF del SII pesa unos pocos KB y este pasa de 64 KB. Revisa que sea el archivo XML que bajaste de «Folios ya autorizados».',
        },
        { campo: 'caf' },
      );
    }

    const empresa = await cliente
      .from('empresas')
      .select('id, rut, activa')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('id', ctx.empresaId)
      .maybeSingle();
    if (empresa.error) throw fallaBase('leer la empresa', empresa.error);
    if (!empresa.data) throw errorEmpresaNoEncontrada();
    if (!empresa.data.activa) throw errorEmpresaDesactivada();

    const { datos, xml } = validarCaf(entrada.contenido, {
      ambiente: entrada.ambiente,
      rutEmpresa: empresa.data.rut,
    });
    const tipo = nombreTipoFolio(datos.tipoDte);
    const rango = textoRango(datos.desde, datos.hasta);

    const existentes = await cliente
      .from('cafs')
      .select('id, folio_desde, folio_hasta')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('empresa_id', ctx.empresaId)
      .eq('ambiente', entrada.ambiente)
      .eq('tipo_dte', datos.tipoDte);
    if (existentes.error) throw fallaBase('leer los CAF de la empresa', existentes.error);
    if (
      existentes.data.some((c) => c.folio_desde === datos.desde && c.folio_hasta === datos.hasta)
    ) {
      return ok(
        {
          titulo: 'Ese CAF ya estaba cargado',
          detalle: `La empresa ya tiene el CAF de ${tipo} con los folios ${rango} ${enAmbiente(entrada.ambiente)}. No cambiamos nada.`,
        },
        null,
        [],
        { tono: 'info' },
      ) as ResultadoFolios;
    }
    const cruce = existentes.data.find(
      (c) => c.folio_desde <= datos.hasta && datos.desde <= c.folio_hasta,
    );
    if (cruce) throw errorTraslape({ desde: cruce.folio_desde, hasta: cruce.folio_hasta });

    const confirmar = deps.operacion.confirmarSesion ?? confirmarSesionConAuth;
    if (!(await confirmar(ctx.usuarioId).catch(() => false))) {
      return {
        tipo: 'error',
        mensaje: { ...MENSAJE_SESION_INVALIDA },
        motivo: 'sesion_invalida',
        operacionId: null,
      };
    }

    // ¿Resuelve una solicitud incierta? Misma empresa, ambiente, tipo y rango, sin CAF.
    const inciertas = await cliente
      .from('solicitudes_folios')
      .select('id, creado_en')
      .eq('organizacion_id', ctx.organizacionId)
      .eq('empresa_id', ctx.empresaId)
      .eq('ambiente', entrada.ambiente)
      .eq('tipo_dte', datos.tipoDte)
      .eq('estado', 'incierta')
      .eq('folio_desde', datos.desde)
      .eq('folio_hasta', datos.hasta)
      .is('caf_id', null)
      .order('creado_en', { ascending: false })
      .limit(1);
    if (inciertas.error) throw fallaBase('leer las solicitudes inciertas', inciertas.error);
    const incierta = inciertas.data[0] ?? null;

    const registro = await cliente.rpc('registrar_caf', {
      p_organizacion: ctx.organizacionId,
      p_empresa: ctx.empresaId,
      p_ambiente: entrada.ambiente,
      p_tipo_dte: datos.tipoDte,
      p_folio_desde: datos.desde,
      p_folio_hasta: datos.hasta,
      p_fecha_autorizacion: datos.fechaAutorizacion,
      p_idk: datos.idk,
      p_rut_emisor: datos.rutEmisor,
      p_razon_social: datos.razonSocial,
      p_caf_xml: xml,
      // Los tipos generados marcan el argumento como obligatorio; la RPC acepta NULL.
      p_solicitud: incierta?.id ?? (null as unknown as string),
    });
    if (registro.error || typeof registro.data !== 'string') {
      const codigo = codigoPg(registro.error);
      if (codigo === '23P01' || codigo === '23505') throw errorTraslape();
      if (codigo === 'P0002') throw errorEmpresaNoEncontrada();
      if (codigo === '22023') {
        throw new ErrorFolios(
          'no_es_caf',
          {
            titulo: 'El CAF no calza con la empresa o el ambiente',
            detalle:
              'Revisa que el CAF sea de esta empresa y del ambiente que elegiste, y vuelve a subirlo.',
          },
          { campo: 'caf' },
        );
      }
      throw fallaBase('guardar el CAF', registro.error);
    }

    const avisos: string[] = [];
    if (incierta) {
      const marcada = await resolverIncierta(cliente, ctx, incierta.id, () => deps.reloj.ahora());
      avisos.push(
        `Con este CAF queda resuelta la solicitud por verificar del ${formatearFechaHora(incierta.creado_en)}${marcada ? ': la marcamos como revisada y ya puedes volver a pedir folios.' : '.'}`,
      );
    }
    return ok(
      {
        titulo: 'Cargamos el CAF',
        detalle: `Folios ${rango} de ${tipo} ${enAmbiente(entrada.ambiente)}. Ya se pueden usar para emitir.`,
      },
      null,
      avisos,
    ) as ResultadoFolios;
  } catch (error) {
    return falloSinEjecutar(error);
  }
}
