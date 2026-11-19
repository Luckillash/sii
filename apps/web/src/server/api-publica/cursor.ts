import 'server-only';
import { ErrorApi } from './respuestas';

// Cursor opaco de los listados de `/api/v1` (§2.1 del diseño): base64url de
// `[creado_en, id]`, keyset `(creado_en desc, id desc)`. Opaco para el cliente: se usa tal
// cual vino en `siguiente_cursor`. Un cursor alterado da 400 `cursor_invalido`, nunca un
// filtro inyectado en PostgREST (se valida la forma antes de armar la condición).

const PATRON_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** `timestamptz` como lo devuelve PostgREST (`2026-11-18T12:34:56.123456+00:00`). */
const PATRON_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export interface Cursor {
  creadoEn: string;
  id: string;
}

export function codificarCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.creadoEn, c.id]), 'utf8').toString('base64url');
}

export function decodificarCursor(texto: string): Cursor {
  let valor: unknown;
  try {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(texto)) throw new Error('forma');
    valor = JSON.parse(Buffer.from(texto, 'base64url').toString('utf8'));
  } catch {
    throw new ErrorApi('cursor_invalido');
  }
  if (
    !Array.isArray(valor) ||
    valor.length !== 2 ||
    typeof valor[0] !== 'string' ||
    typeof valor[1] !== 'string' ||
    !PATRON_TIMESTAMP.test(valor[0]) ||
    !PATRON_UUID.test(valor[1])
  ) {
    throw new ErrorApi('cursor_invalido');
  }
  return { creadoEn: valor[0], id: valor[1] };
}

/** Condición `or()` de PostgREST: lo que viene después del cursor en orden descendente. */
export function condicionCursor(c: Cursor): string {
  if (!PATRON_TIMESTAMP.test(c.creadoEn) || !PATRON_UUID.test(c.id)) {
    throw new ErrorApi('cursor_invalido');
  }
  return `creado_en.lt."${c.creadoEn}",and(creado_en.eq."${c.creadoEn}",id.lt."${c.id}")`;
}
