import 'server-only';
import type { ResultadoAutorizacion, ResultadoTimbrajes } from '@winex/certificacion';
import type { ResultadoPaso } from '@/lib/certificacion';
import { formatearFecha } from '@/lib/formatos';
import type { ClienteServicio } from '../supabase/service';
import {
  cargarEmpresa,
  conSesionSii,
  ejecutar,
  errorDeEjecucion,
  type FilaEmpresaDb,
  fallaBase,
  ok,
  validarAntes,
} from './comun';
import { type DependenciasCertificacion, resolverDependencias } from './dependencias';
import type { ContextoCertificacion } from './tipos';

// «Verificar autorización en el SII» (PLAN-SAAS Fase 5): pregunta al SII si la empresa ya
// está autorizada a emitir y con qué resolución, para no escribirla a mano (migración
// 0009: registrar la resolución de producción marca la empresa como autorizada).
//
//   1. `ConsultaAutorizacion` de la librería: página «Actualización de datos del
//      contribuyente» (ad_empresa) de PALENA, con la sesión AUT2000 de producción del
//      certificado predeterminado (bloqueo y sesión de producción). Solo responde si el
//      titular es representante legal: `autorizada` (con la resolución),
//      `sin_representacion` o `no_autorizada`. Nunca envía el formulario que actualiza
//      los datos del contribuyente (es un candado de la librería).
//   2. En la misma operación, `SituacionTributaria` (consulta pública STC, sin
//      certificado): si la empresa ya timbró folios de boleta (39/41). Solo apoya el
//      mensaje: nunca marca ni bloquea, y si falla o hay captcha se omite.
//
// Es 🔁 (no graba nada en el SII) y sin ensayo, como `consultarEstadoDeclaracion`. Se
// registra en `operaciones_sii` como `verificar_autorizacion` (migración 0010) con
// `ambiente = 'produccion'`. No tiene el candado `empresa_autorizada`: sirve también
// para actualizar la resolución de una empresa ya autorizada.
//
// Lo que escribe (service_role, filtrado por organización):
//   - `autorizada` con una resolución distinta de la vigente (o sin vigente):
//     `registrar_resolucion` de producción (la anterior pasa al historial) y el trigger de
//     la 0009 marca la empresa; si la empresa no estaba autorizada, `autorizada_en` queda
//     en la fecha de autorización que informa el SII (a medianoche de Chile).
//   - Nada en los otros casos: la marca nunca se quita.
// En `detalle` solo van la respuesta, la resolución, la fecha de autorización y el
// resultado del STC: nunca correos, URL, nombre del software ni nada más de las páginas.

const AMBIENTE_CONSULTA = 'produccion' as const;
const ZONA_CHILE = 'America/Santiago';

/** Lo que aporta el STC: `boleta` (con el año del último timbraje), `sin_boleta` o `no_disponible`. */
export type ApoyoStc =
  | { tipo: 'boleta'; ultimoAnio: number }
  | { tipo: 'sin_boleta' }
  | { tipo: 'no_disponible' };

export function apoyoStc(r: ResultadoTimbrajes | null): ApoyoStc {
  if (r === null || r.tipo !== 'ok') return { tipo: 'no_disponible' };
  const boleta = r.timbrajes.filter((t) => t.tipoDte === 39 || t.tipoDte === 41);
  if (boleta.length === 0) return { tipo: 'sin_boleta' };
  return { tipo: 'boleta', ultimoAnio: Math.max(...boleta.map((t) => t.ultimoAnio)) };
}

/**
 * Medianoche en Chile de `AAAA-MM-DD`, en ISO (UTC). Chile está a UTC-3 o UTC-4 según la
 * época; el día del cambio de hora la medianoche puede no existir: se usa la primera hora
 * de ese día que sí exista.
 */
export function medianocheChile(fecha: string): string {
  const formato = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_CHILE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  for (const horas of [3, 4, 5]) {
    const candidato = new Date(`${fecha}T0${horas}:00:00Z`);
    if (formato.format(candidato) === `${fecha}, 00:00`) return candidato.toISOString();
  }
  // Día del cambio de hora: 01:00 de Chile.
  for (const horas of [4, 5]) {
    const candidato = new Date(`${fecha}T0${horas}:00:00Z`);
    if (formato.format(candidato) === `${fecha}, 01:00`) return candidato.toISOString();
  }
  return new Date(`${fecha}T04:00:00Z`).toISOString();
}

type Autorizada = Extract<ResultadoAutorizacion, { tipo: 'autorizada' }>;
type ResolucionVigente = { numero: number; fecha: string } | null;
type CambioResolucion = 'igual' | 'registrada' | 'reemplazada';

async function resolucionProduccionVigente(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
): Promise<ResolucionVigente> {
  const { data, error } = await cliente
    .from('resoluciones')
    .select('numero, fecha')
    .eq('organizacion_id', ctx.organizacionId)
    .eq('empresa_id', ctx.empresaId)
    .eq('ambiente', AMBIENTE_CONSULTA)
    .eq('vigente', true)
    .maybeSingle();
  if (error) throw fallaBase('leer la resolución de producción', error);
  return data ? { numero: data.numero, fecha: data.fecha } : null;
}

/** Registra la resolución que informó el SII si no es la vigente. */
async function guardarAutorizacion(
  cliente: ClienteServicio,
  ctx: ContextoCertificacion,
  empresa: FilaEmpresaDb,
  vigente: ResolucionVigente,
  r: Autorizada,
): Promise<CambioResolucion> {
  const igual =
    vigente !== null &&
    vigente.numero === r.resolucion.numero &&
    vigente.fecha === r.resolucion.fecha;
  if (igual) return 'igual';

  // service_role: `registrar_resolucion` salta la revisión de administrador (ya la hizo
  // la Server Action) y el trigger de la 0009 marca la empresa.
  const { error } = await cliente.rpc('registrar_resolucion', {
    p_empresa: ctx.empresaId,
    p_ambiente: AMBIENTE_CONSULTA,
    p_numero: r.resolucion.numero,
    p_fecha: r.resolucion.fecha,
  });
  if (error) throw fallaBase('registrar la resolución de producción', error);

  if (!empresa.autorizada_produccion) {
    // El trigger pone `now()`: la fecha real es la que informa el SII. service_role pasa
    // `tg_proteger_autorizacion`.
    const actualizada = await cliente
      .from('empresas')
      .update({ autorizada_en: medianocheChile(r.fechaAutorizacion) })
      .eq('organizacion_id', ctx.organizacionId)
      .eq('id', ctx.empresaId);
    if (actualizada.error) throw fallaBase('fijar la fecha de autorización', actualizada.error);
  }
  return vigente === null ? 'registrada' : 'reemplazada';
}

const fecha = (iso: string) => formatearFecha(iso);
const resolucionEnTexto = (r: { numero: number; fecha: string }) =>
  `Resolución n.º ${r.numero} del ${fecha(r.fecha)}`;

const AVISO_SIN_BOLETA =
  'El SII todavía no registra folios de boleta timbrados. Si la empresa se certificó solo para factura, no podrá emitir boletas.';

function mensajeAutorizada(
  r: Autorizada,
  stc: ApoyoStc,
  cambio: CambioResolucion,
  vigente: ResolucionVigente,
  operacionId: string,
): ResultadoPaso {
  const base = `El SII confirma que la empresa está autorizada desde el ${fecha(r.fechaAutorizacion)} (${resolucionEnTexto(r.resolucion)})`;
  const boleta = stc.tipo === 'boleta' ? ' y ya timbró folios de boleta electrónica.' : '.';
  const registro =
    cambio === 'igual'
      ? ' La resolución de producción registrada es la misma.'
      : ' Registramos esa resolución de producción: la empresa ya puede emitir en producción.';
  const avisos: string[] = [];
  if (cambio === 'reemplazada' && vigente) {
    avisos.push(
      `La resolución registrada antes (${resolucionEnTexto(vigente)}) no coincidía con la del SII: quedó vigente la del SII y la anterior pasó al historial.`,
    );
  }
  if (stc.tipo === 'sin_boleta') avisos.push(AVISO_SIN_BOLETA);
  return ok(
    { titulo: 'El SII confirma la autorización', detalle: `${base}${boleta}${registro}` },
    operacionId,
    avisos,
  );
}

function mensajeSinRepresentacion(stc: ApoyoStc, operacionId: string): ResultadoPaso {
  const detalle =
    stc.tipo === 'boleta'
      ? `El titular del certificado no figura como representante legal de la empresa en el SII, así que no pudimos confirmar la resolución. Pero el SII registra folios de boleta electrónica timbrados (el último en ${stc.ultimoAnio}): la empresa ya emite boletas. Registra su resolución de producción.`
      : 'El titular del certificado no figura como representante legal de la empresa en el SII, así que no pudimos verificar la autorización. Si la empresa ya está certificada, registra su resolución de producción.';
  return ok({ titulo: 'No pudimos verificar la autorización', detalle }, operacionId, [], {
    tono: 'aviso',
    sugerencia: 'registrarResolucion',
  });
}

function mensajeNoAutorizada(marcada: boolean, operacionId: string): ResultadoPaso {
  return ok(
    {
      titulo: 'El SII indica que la empresa no está autorizada',
      detalle:
        'El SII indica que la empresa no está autorizada para emitir con software propio: certifícala con el asistente.',
    },
    operacionId,
    marcada
      ? [
          'La empresa figura como autorizada por una resolución de producción registrada a mano. Revísala en Configuración → Empresas: si no corresponde, el SII rechazará los envíos de producción.',
        ]
      : [],
    { tono: 'aviso' },
  );
}

/**
 * Pregunta al SII si la empresa está autorizada y con qué resolución (🔁, sin ensayo).
 * Ver el encabezado del archivo.
 */
export async function verificarAutorizacion(
  ctx: ContextoCertificacion,
  dependencias?: Partial<DependenciasCertificacion>,
): Promise<ResultadoPaso> {
  const deps = resolverDependencias(dependencias);
  const cliente = deps.servicio();
  const credenciales = deps.credenciales(cliente);
  const prep = async () => {
    const empresa = await cargarEmpresa(cliente, ctx);
    const certificado = await credenciales.certificadoDeEmpresa({
      organizacionId: ctx.organizacionId,
      empresaId: ctx.empresaId,
    });
    return { empresa, certificado };
  };

  const previo = await validarAntes(prep);
  if (!previo.ok) return previo.resultado;

  const r = await ejecutar(
    deps,
    cliente,
    ctx,
    { operacion: 'verificar_autorizacion', confirmada: true, ambiente: AMBIENTE_CONSULTA },
    async ({ agregarDetalle }) => {
      const p = await prep();
      await using transporte = deps.transporte();
      const consulta = deps.sii.autorizacion({ transporte, reloj: deps.reloj });
      const respuesta = await conSesionSii(
        deps,
        cliente,
        p.certificado,
        () => consulta.autenticar(p.certificado.certificado),
        (sesion) => consulta.consultar(sesion, p.empresa.rut),
        AMBIENTE_CONSULTA,
      );

      // Apoyo, fuera del bloqueo del certificado (no usa sesión): nunca hace fallar la
      // operación.
      let timbrajes: ResultadoTimbrajes | null = null;
      try {
        timbrajes = await deps.sii.situacionTributaria({ transporte }).timbrajes(p.empresa.rut);
      } catch {
        timbrajes = null;
      }
      const stc = apoyoStc(timbrajes);

      agregarDetalle({
        respuesta: respuesta.tipo,
        ...(respuesta.tipo === 'autorizada'
          ? {
              nro_resol: respuesta.resolucion.numero,
              fch_resol: respuesta.resolucion.fecha,
              fecha_autorizacion: respuesta.fechaAutorizacion,
            }
          : {}),
        stc: stc.tipo,
        ...(stc.tipo === 'boleta' ? { stc_ultimo_anio: stc.ultimoAnio } : {}),
      });

      if (respuesta.tipo !== 'autorizada') {
        return { respuesta, stc, empresa: p.empresa, cambio: null, vigente: null };
      }
      const vigente = await resolucionProduccionVigente(cliente, ctx);
      const cambio = await guardarAutorizacion(cliente, ctx, p.empresa, vigente, respuesta);
      agregarDetalle({ resolucion: cambio });
      return { respuesta, stc, empresa: p.empresa, cambio, vigente };
    },
  );
  if (!r.ok) return errorDeEjecucion(r);

  const { respuesta, stc, empresa, cambio, vigente } = r.valor;
  switch (respuesta.tipo) {
    case 'autorizada':
      return mensajeAutorizada(respuesta, stc, cambio ?? 'igual', vigente, r.operacionId);
    case 'sin_representacion':
      return mensajeSinRepresentacion(stc, r.operacionId);
    case 'no_autorizada':
      return mensajeNoAutorizada(empresa.autorizada_produccion, r.operacionId);
  }
}
