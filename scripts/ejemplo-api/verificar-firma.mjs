// Verificación de la firma de los webhooks de Boletéame, para copiar en tu sistema.
// Node.js puro (node:crypto), sin dependencias.
//
// Cada entrega trae la cabecera
//   Boleteame-Firma: t=<segundos unix>,v1=<hex de HMAC-SHA256>
// donde el HMAC se calcula con tu secreto `whsec_…` (tal cual, en UTF-8) sobre el texto
// `${t}.${cuerpo}`, con el cuerpo EXACTO que recibiste (los bytes, antes de parsear el JSON).
// Rechaza la entrega si la firma no calza o si `t` es de hace más de 5 minutos (evita que
// alguien repita una entrega vieja). Deduplica por el `id` del cuerpo: es el mismo en
// todos los intentos de una entrega.

import { createHmac, timingSafeEqual } from 'node:crypto';

export const TOLERANCIA_SEGUNDOS = 300;

/** Hex del HMAC-SHA256 de `${t}.${cuerpo}` con el secreto. */
export function firmar(secreto, t, cuerpo) {
  return createHmac('sha256', secreto).update(`${t}.${cuerpo}`, 'utf8').digest('hex');
}

/** Lee `t=…,v1=…` (puede traer más de un v1). Devuelve `null` si no tiene el formato. */
export function leerCabecera(cabecera) {
  if (typeof cabecera !== 'string' || cabecera.length === 0) return null;
  let t = null;
  const firmas = [];
  for (const parte of cabecera.split(',')) {
    const i = parte.indexOf('=');
    if (i <= 0) continue;
    const clave = parte.slice(0, i).trim();
    const valor = parte.slice(i + 1).trim();
    if (clave === 't' && /^\d{1,12}$/.test(valor)) t = Number(valor);
    if (clave === 'v1' && /^[0-9a-f]{64}$/.test(valor)) firmas.push(valor);
  }
  if (t === null || firmas.length === 0) return null;
  return { t, firmas };
}

/**
 * @param {object} p
 * @param {string | Buffer} p.cuerpo cuerpo crudo de la petición
 * @param {string | undefined | null} p.cabecera valor de Boleteame-Firma
 * @param {string} p.secreto whsec_…
 * @param {number} [p.toleranciaSegundos]
 * @param {Date | number} [p.ahora] instante de la verificación (Date o milisegundos)
 * @returns {{ ok: true, t: number }
 *   | { ok: false, motivo: 'cabecera_invalida' | 'fuera_de_tolerancia' | 'firma_invalida' }}
 */
export function verificarFirma({
  cuerpo,
  cabecera,
  secreto,
  toleranciaSegundos = TOLERANCIA_SEGUNDOS,
  ahora = Date.now(),
}) {
  const leida = leerCabecera(cabecera);
  if (!leida) return { ok: false, motivo: 'cabecera_invalida' };
  const ms = ahora instanceof Date ? ahora.getTime() : ahora;
  if (Math.abs(Math.floor(ms / 1000) - leida.t) > toleranciaSegundos) {
    return { ok: false, motivo: 'fuera_de_tolerancia' };
  }
  const texto = Buffer.isBuffer(cuerpo) ? cuerpo.toString('utf8') : String(cuerpo);
  const esperada = Buffer.from(firmar(secreto, leida.t, texto), 'hex');
  for (const firma of leida.firmas) {
    const recibida = Buffer.from(firma, 'hex');
    if (recibida.length === esperada.length && timingSafeEqual(recibida, esperada)) {
      return { ok: true, t: leida.t };
    }
  }
  return { ok: false, motivo: 'firma_invalida' };
}
