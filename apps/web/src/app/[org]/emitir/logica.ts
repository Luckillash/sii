import type { z } from 'zod';
import type { EstadoDte } from '@/components/boleteame/tipos';
import type {
  AmbienteEmision,
  EstadoDocumento,
  FoliosEmision,
  MotivoAmbienteBloqueado,
  ResultadoEmision,
  Totales,
  VistaEmision,
} from '@/lib/emision';
import { type AmbienteSii, enAmbiente, nombreTipoFolio, type TipoFolio } from '@/lib/folios';
import { formatearMiles, formatearMonto } from '@/lib/formatos';

// Lógica pura de `/[org]/emitir` (PLAN-SAAS Fase 7): qué impide emitir (para explicarlo
// antes de que el servidor lo rechace), el folio que se asignará, los errores de zod por
// campo y el medidor de folios del resumen. Sin React ni `server-only`; se prueba con
// Vitest. La autoridad sigue siendo el servidor. El modelo del formulario (textos de los
// campos numéricos, líneas, totales) está en `@/stores/emision`.

// --- Errores por campo ------------------------------------------------------------------

/**
 * Errores de zod con la ruta completa (`receptor.rut`, `lineas.0.nombre`,
 * `descuento.valor`, `lineas`), el primero de cada campo.
 */
export function erroresDelBorrador(error: z.ZodError): Record<string, string> {
  const errores: Record<string, string> = {};
  for (const issue of error.issues) {
    const clave = issue.path.length > 0 ? issue.path.map(String).join('.') : 'formulario';
    errores[clave] ??= issue.message;
  }
  return errores;
}

/** Quita los errores de un campo y los de sus hijos (`lineas` quita `lineas.3.precio`). */
export function sinErroresDe(
  errores: Record<string, string>,
  prefijo: string,
): Record<string, string> {
  let cambio = false;
  const r: Record<string, string> = {};
  for (const [k, v] of Object.entries(errores)) {
    if (k === prefijo || k.startsWith(`${prefijo}.`)) cambio = true;
    else r[k] = v;
  }
  return cambio ? r : errores;
}

// --- Folios y bloqueos ------------------------------------------------------------------

export function foliosDe(
  vista: Pick<VistaEmision, 'folios'>,
  ambiente: AmbienteSii,
  tipo: TipoFolio,
): FoliosEmision | null {
  return vista.folios.find((f) => f.ambiente === ambiente && f.tipoDte === tipo) ?? null;
}

/** «N.º 18.245», o `null` si no hay folios. */
export function textoFolio(folio: number | null | undefined): string | null {
  return folio == null ? null : `N.º ${formatearMiles(folio)}`;
}

/**
 * Props del `MedidorFolios` del resumen. El contrato trae el siguiente folio, los
 * disponibles y el total de los CAF activos (no el rango del CAF en uso), así que el rango
 * se reconstruye contando hacia atrás desde el siguiente folio: es exacto con un solo CAF
 * y una aproximación con varios. `null` si el tipo nunca tuvo folios (el medidor diría
 * «CAF agotado», que no es cierto).
 */
export function medidorDe(
  f: FoliosEmision | null,
): { desde: number; hasta: number; siguiente: number } | null {
  if (!f || f.total <= 0) return null;
  const usados = Math.max(0, f.total - f.disponibles);
  if (f.siguiente == null || f.disponibles <= 0) {
    return { desde: 1, hasta: f.total, siguiente: f.total + 1 };
  }
  const desde = Math.max(1, f.siguiente - usados);
  return { desde, hasta: desde + f.total - 1, siguiente: desde + usados };
}

export interface Enlace {
  href: string;
  texto: string;
}

export interface Bloqueo {
  texto: string;
  enlace: Enlace | null;
}

/** Qué impide emitir en un ambiente y dónde se arregla. */
export function explicarMotivo(
  motivo: MotivoAmbienteBloqueado,
  ambiente: AmbienteSii,
  slug: string,
  empresaId: string,
): Bloqueo {
  const empresa = `/${slug}/configuracion/empresas/${empresaId}`;
  switch (motivo) {
    case 'empresa_inactiva':
      return {
        texto: 'La empresa está desactivada.',
        enlace: { href: empresa, texto: 'Actívala en la configuración de la empresa' },
      };
    case 'sin_autorizacion':
      return {
        texto: 'La empresa aún no está autorizada para emitir en producción.',
        enlace: {
          href: `/${slug}/certificacion?empresa=${empresaId}`,
          texto: 'Termina la certificación ante el SII',
        },
      };
    case 'plan_sin_produccion':
      return {
        texto: 'Tu plan no incluye producción o tiene un pago vencido.',
        enlace: { href: `/${slug}/configuracion/plan`, texto: 'Revisa tu plan' },
      };
    case 'sin_resolucion':
      return {
        texto: `Falta la resolución del SII que autoriza a emitir ${enAmbiente(ambiente)}.`,
        enlace: { href: empresa, texto: 'Regístrala en la empresa' },
      };
    case 'sin_certificado':
      return {
        texto: 'Falta un certificado vigente para firmar las boletas.',
        enlace: { href: `${empresa}/certificados`, texto: 'Asocia un certificado a la empresa' },
      };
  }
}

export function ambienteDe(
  vista: Pick<VistaEmision, 'ambientes'>,
  ambiente: AmbienteSii,
): AmbienteEmision | null {
  return vista.ambientes.find((a) => a.ambiente === ambiente) ?? null;
}

/** El ambiente con que parte un borrador nuevo: el primero habilitado (producción primero). */
export function ambientePorDefecto(vista: Pick<VistaEmision, 'ambientes'>): AmbienteSii {
  return vista.ambientes.find((a) => a.habilitado)?.ambiente ?? 'certificacion';
}

/**
 * Por qué no se puede emitir ahora este tipo en este ambiente, o `null`. El primero que
 * aplique: ambiente bloqueado, sin certificado, sin folios. La validación del formulario
 * va aparte (se explica campo por campo al intentar emitir).
 */
export function bloqueoEmision(
  vista: Pick<VistaEmision, 'ambientes' | 'folios' | 'certificado' | 'cuotaProduccion'>,
  ambiente: AmbienteSii,
  tipo: TipoFolio,
  slug: string,
  empresaId: string,
): Bloqueo | null {
  const a = ambienteDe(vista, ambiente);
  if (!a) {
    return { texto: `No se puede emitir ${enAmbiente(ambiente)}.`, enlace: null };
  }
  if (!a.habilitado) {
    return explicarMotivo(a.motivo ?? 'sin_resolucion', ambiente, slug, empresaId);
  }
  if (!vista.certificado) return explicarMotivo('sin_certificado', ambiente, slug, empresaId);
  // Cupo del plan (Fase 10): la base rechaza la boleta que pasa max_boletas_mes.
  const cuota = vista.cuotaProduccion;
  if (
    ambiente === 'produccion' &&
    cuota &&
    cuota.maximo !== null &&
    cuota.maximo > 0 &&
    cuota.usadas >= cuota.maximo
  ) {
    return {
      texto: `Se alcanzó el límite de ${formatearMiles(cuota.maximo)} boletas en producción de este mes${cuota.plan ? ` del plan ${cuota.plan}` : ''}. Cambia a un plan más grande o espera al próximo mes.`,
      enlace: { href: `/${slug}/configuracion/plan`, texto: 'Revisa tu plan' },
    };
  }
  const f = foliosDe(vista, ambiente, tipo);
  // Sin siguiente folio no hay qué asignar, aunque `puedeEmitir` diga otra cosa.
  if (!f?.puedeEmitir || f.siguiente === null) {
    const enlace = { href: `/${slug}/folios?empresa=${empresaId}`, texto: 'Ir a Folios (CAF)' };
    if (!f || f.total <= 0) {
      return {
        texto: `Aún no hay folios de ${nombreTipoFolio(tipo)} ${enAmbiente(ambiente)}: pide o sube un CAF antes de emitir.`,
        enlace,
      };
    }
    return {
      texto: `CAF agotado: no quedan folios de ${nombreTipoFolio(tipo)} ${enAmbiente(ambiente)}. Solicita un nuevo rango de folios al SII antes de emitir.`,
      enlace,
    };
  }
  return null;
}

// --- Totales y descuento ----------------------------------------------------------------

/**
 * Aviso cuando el descuento pedido no se aplica entero: solo rebaja lo afecto (como la
 * librería), así que en una boleta exenta o con un descuento mayor que lo afecto queda
 * acotado.
 */
export function avisoDescuento(
  totales: Pick<Totales, 'afectoBruto' | 'descuentoAplicado'>,
  descuento: { tipo: 'monto' | 'porcentaje'; valor: number } | null,
): string | null {
  if (!descuento || descuento.valor <= 0) return null;
  if (totales.afectoBruto <= 0) {
    return 'El descuento global solo rebaja las líneas afectas, y esta boleta no tiene: no se aplica.';
  }
  // Un porcentaje de hasta 100 nunca supera lo afecto.
  if (descuento.tipo === 'monto' && descuento.valor > totales.afectoBruto) {
    return `El descuento supera lo afecto: se aplican ${formatearMonto(totales.descuentoAplicado)}.`;
  }
  return null;
}

// --- Estados ----------------------------------------------------------------------------

/** Estado del documento (`estado_documento`) en el vocabulario del `EstadoDTE`. */
export function estadoParaMostrar(estado: EstadoDocumento): EstadoDte {
  return estado === 'aceptado_con_reparos' ? 'reparos' : estado;
}

// --- Respuesta a un error de emisión ------------------------------------------------------

type ErrorEmision = Extract<ResultadoEmision, { tipo: 'error' }>;

export interface ReaccionError {
  /**
   * `incierta`: no se sabe si el SII la recibió (o ya hay un documento con folio): se
   * bloquea emitir hasta que la persona empiece otra boleta a propósito.
   * `mostrar`: solo el mensaje y los errores por campo; el formulario se conserva.
   */
  tipo: 'incierta' | 'mostrar';
  /** Soltar el `borradorId`: el próximo intento emite sin él (crea un documento nuevo). */
  soltarBorrador: boolean;
  /** Ofrecer «Empezar una boleta nueva» junto al mensaje (el borrador ya se emitió). */
  ofrecerNueva: boolean;
}

/**
 * Qué hace la pantalla con un error de `emitir` (nivel `emitir`), según el backend:
 *   - `incierto` (resultado, estado del documento o motivo `documento_incierto`): bloquear;
 *   - documento `anulado` (rechazo 4xx del SII, cuota, folio anulado): el borrador se
 *     perdió; se conserva el formulario y se reintenta sin `borradorId`;
 *   - `borrador_no_encontrado`: lo borraron antes de emitirlo; se reintenta sin él;
 *   - `borrador_emitido`: ya es una boleta; NO se suelta el id (reintentar daría el mismo
 *     error y no una boleta duplicada) y se ofrece empezar otra;
 *   - un documento en cualquier otro estado tiene folio y pudo salir: bloquear, como incierto.
 */
export function reaccionAError(r: ErrorEmision): ReaccionError {
  const estado = r.documento?.estado;
  if (
    r.resultado === 'incierto' ||
    estado === 'incierto' ||
    r.motivo === 'documento_incierto' ||
    (estado !== undefined && estado !== 'anulado' && estado !== 'borrador')
  ) {
    return { tipo: 'incierta', soltarBorrador: true, ofrecerNueva: false };
  }
  if (r.motivo === 'borrador_emitido') {
    return { tipo: 'mostrar', soltarBorrador: false, ofrecerNueva: true };
  }
  return {
    tipo: 'mostrar',
    soltarBorrador: estado === 'anulado' || r.motivo === 'borrador_no_encontrado',
    ofrecerNueva: false,
  };
}

/**
 * La base rechaza guardar un borrador de producción sin autorización o con un plan sin
 * producción (aunque no lleve folio). Se explica antes de que choque.
 */
export function bloqueoGuardado(
  vista: Pick<VistaEmision, 'ambientes'>,
  ambiente: AmbienteSii,
  slug: string,
  empresaId: string,
): Bloqueo | null {
  const a = ambienteDe(vista, ambiente);
  if (!a || a.habilitado) return null;
  if (a.motivo !== 'sin_autorizacion' && a.motivo !== 'plan_sin_produccion') return null;
  const b = explicarMotivo(a.motivo, ambiente, slug, empresaId);
  return {
    ...b,
    texto: `No se puede guardar un borrador de producción: ${b.texto.charAt(0).toLowerCase()}${b.texto.slice(1)}`,
  };
}

const CAMPO_LINEA = /^lineas\.\d+\.(nombre|cantidad|unidad|precio|exento)$/;
const CAMPOS_CON_LUGAR = new Set([
  'receptor.rut',
  'receptor.razonSocial',
  'receptor.correo',
  'lineas',
  'descuento.tipo',
  'descuento.valor',
]);

/** Errores por campo que no tienen un control donde mostrarse (van en el aviso general). */
export function erroresSinCampo(errores: Record<string, string>): string[] {
  return Object.entries(errores)
    .filter(([k]) => !CAMPOS_CON_LUGAR.has(k) && !CAMPO_LINEA.test(k))
    .map(([, v]) => v)
    .filter((v, i, todos) => todos.indexOf(v) === i);
}
