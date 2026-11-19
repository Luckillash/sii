import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { TOLERANCIA_FIRMA_S } from '@/lib/api-publica';

// Firma de las entregas de webhooks (PLAN-SAAS Fase 11). Cabecera `Boleteame-Firma`:
//
//   t=<segundos unix>,v1=<hex en minúsculas de HMAC-SHA256(secreto, `${t}.${cuerpo}`)>
//
// El secreto es el texto completo `whsec_…` en UTF-8 (tal como lo muestra el panel una
// vez), sin decodificar. El cuerpo es el texto exacto del POST (bytes UTF-8), antes de
// parsear el JSON. `t` es nuevo en cada intento: el receptor rechaza firmas viejas
// (tolerancia recomendada de 300 s) para que una entrega capturada no se pueda repetir.
//
// `scripts/ejemplo-api/verificar-firma.mjs` es la copia en JavaScript para los clientes;
// una prueba compara las dos.

/** HMAC-SHA256 en hex (minúsculas) de `${t}.${cuerpo}` con el secreto en UTF-8. */
export function firmar(secreto: string, t: number, cuerpo: string): string {
  return createHmac('sha256', Buffer.from(secreto, 'utf8'))
    .update(`${t}.${cuerpo}`, 'utf8')
    .digest('hex');
}

/** Valor de la cabecera `Boleteame-Firma`: `t=<t>,v1=<firma>`. */
export function cabeceraFirma(secreto: string, t: number, cuerpo: string): string {
  return `t=${t},v1=${firmar(secreto, t, cuerpo)}`;
}

export type MotivoFirmaInvalida =
  /** Falta la cabecera, no tiene `t` entero o no trae ningún `v1` hex de 64 caracteres. */
  | 'cabecera_invalida'
  /** `t` está a más de `toleranciaSegundos` de `ahora` (en cualquier dirección). */
  | 'fuera_de_tolerancia'
  /** Ningún `v1` coincide con la firma calculada. */
  | 'firma_invalida';

export interface VerificacionFirma {
  /** Texto exacto del cuerpo recibido. */
  cuerpo: string;
  /** Valor de la cabecera `Boleteame-Firma` (o null si no vino). */
  cabecera: string | null | undefined;
  /** Secreto `whsec_…` del webhook. */
  secreto: string;
  /** 300 por defecto. */
  toleranciaSegundos?: number;
  /** Instante de la verificación; ahora por defecto. */
  ahora?: Date;
}

export type ResultadoVerificacion =
  | { ok: true; t: number }
  | { ok: false; motivo: MotivoFirmaInvalida };

const HEX_64 = /^[0-9a-f]{64}$/;

/**
 * Verifica `Boleteame-Firma`. Acepta varios `v1` en la misma cabecera (basta que coincida
 * uno) y compara en tiempo constante.
 */
export function verificarFirma(datos: VerificacionFirma): ResultadoVerificacion {
  const { cuerpo, cabecera, secreto } = datos;
  const tolerancia = datos.toleranciaSegundos ?? TOLERANCIA_FIRMA_S;
  if (!cabecera) return { ok: false, motivo: 'cabecera_invalida' };

  let t: number | null = null;
  const firmas: string[] = [];
  for (const parte of cabecera.split(',')) {
    const igual = parte.indexOf('=');
    if (igual < 0) continue;
    const clave = parte.slice(0, igual).trim();
    const valor = parte.slice(igual + 1).trim();
    if (clave === 't' && /^\d{1,12}$/.test(valor)) t = Number(valor);
    else if (clave === 'v1' && HEX_64.test(valor)) firmas.push(valor);
  }
  if (t === null || firmas.length === 0) return { ok: false, motivo: 'cabecera_invalida' };

  const ahora = Math.floor((datos.ahora ?? new Date()).getTime() / 1000);
  if (Math.abs(ahora - t) > tolerancia) return { ok: false, motivo: 'fuera_de_tolerancia' };

  const esperada = Buffer.from(firmar(secreto, t, cuerpo), 'hex');
  const coincide = firmas.some((f) => timingSafeEqual(Buffer.from(f, 'hex'), esperada));
  return coincide ? { ok: true, t } : { ok: false, motivo: 'firma_invalida' };
}
