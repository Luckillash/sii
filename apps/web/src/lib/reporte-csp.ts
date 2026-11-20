// Reportes de CSP del navegador (PLAN-SAAS Fase 13, punto 1). Puro: lo usa la ruta
// `/api/csp`, que los reenvía a Sentry desde el servidor.
//
// Por qué una ruta propia y no `report-uri` directo a `ingest.sentry.io`: los bloqueadores
// de anuncios frenan ese host (verificado el 2026-11-20 en Production: un reporte
// provocado en el navegador nunca llegó, mientras uno enviado con curl llegó en segundos).
// Es el mismo motivo del túnel `/api/monitoring` de los errores. Sin esto, con la CSP en
// `enforce`, una página rota para quien usa un bloqueador no dejaría rastro.
//
// El reporte se rearma con los campos conocidos (nada más viaja a Sentry) y sin datos de
// la persona: `document-uri` queda en origen + ruta (sin query ni fragmento) y el token de
// `/invitacion/<token>` se reemplaza; las demás URL pierden query y fragmento, y
// `referrer` queda en el origen.

/** Un reporte de CSP real pesa ~1 KB; con la política completa, menos de 4 KB. */
export const TAMANO_MAXIMO_REPORTE = 16 * 1024;

const LARGO_MAXIMO_CAMPO = 2048;

/** Campos de texto del formato `application/csp-report` que se reenvían. */
const CAMPOS_TEXTO = [
  'violated-directive',
  'effective-directive',
  'original-policy',
  'disposition',
  'script-sample',
] as const;

const CAMPOS_NUMERO = ['status-code', 'line-number', 'column-number'] as const;

export type ReporteCsp = Record<string, string | number>;

function recortar(valor: string): string {
  return valor.length > LARGO_MAXIMO_CAMPO ? valor.slice(0, LARGO_MAXIMO_CAMPO) : valor;
}

/** URL sin query ni fragmento; palabras clave del navegador (`inline`, `eval`…) tal cual. */
function sinQuery(valor: string): string {
  try {
    const u = new URL(valor);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return `${u.protocol}`;
    return recortar(`${u.origin}${u.pathname}`);
  } catch {
    return /^[a-z-]{1,32}$/i.test(valor) ? valor : '';
  }
}

/** Ruta del documento sin el token de una invitación (`/invitacion/[token]`). */
function rutaSinSecretos(pathname: string): string {
  return pathname.replace(/^\/invitacion\/[^/]+/, '/invitacion/[token]');
}

/**
 * Valida y sanea el cuerpo de un reporte `application/csp-report`. Devuelve `null` si no
 * es un reporte de CSP o si `document-uri` no es una página de `origenApp` (un reporte
 * ajeno no debe gastar la cuota de Sentry).
 */
export function sanearReporteCsp(texto: string, origenApp: string): ReporteCsp | null {
  let cuerpo: unknown;
  try {
    cuerpo = JSON.parse(texto);
  } catch {
    return null;
  }
  if (!cuerpo || typeof cuerpo !== 'object') return null;
  const crudo = (cuerpo as Record<string, unknown>)['csp-report'];
  if (!crudo || typeof crudo !== 'object' || Array.isArray(crudo)) return null;
  const r = crudo as Record<string, unknown>;

  const documento = r['document-uri'];
  if (typeof documento !== 'string') return null;
  let doc: URL;
  let app: URL;
  try {
    doc = new URL(documento);
    app = new URL(origenApp);
  } catch {
    return null;
  }
  if (doc.origin !== app.origin) return null;

  const directiva = r['violated-directive'] ?? r['effective-directive'];
  if (typeof directiva !== 'string' || directiva.length === 0) return null;

  const reporte: ReporteCsp = {
    'document-uri': `${doc.origin}${rutaSinSecretos(doc.pathname)}`,
  };
  for (const campo of CAMPOS_TEXTO) {
    const v = r[campo];
    if (typeof v === 'string' && v.length > 0) reporte[campo] = recortar(v);
  }
  for (const campo of CAMPOS_NUMERO) {
    const v = r[campo];
    if (typeof v === 'number' && Number.isFinite(v)) reporte[campo] = v;
  }
  for (const campo of ['blocked-uri', 'source-file'] as const) {
    const v = r[campo];
    if (typeof v === 'string' && v.length > 0) {
      const limpio = sinQuery(v);
      if (limpio) reporte[campo] = limpio;
    }
  }
  const referrer = r.referrer;
  if (typeof referrer === 'string' && referrer.length > 0) {
    try {
      reporte.referrer = new URL(referrer).origin;
    } catch {
      // Sin referrer válido no se reenvía.
    }
  }
  return reporte;
}
