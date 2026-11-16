import { ErrorTransporte } from '@winex/certificacion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAVE_PFX, TOKEN_SII } from '../../../test/certificacion-prueba';
import {
  borradorConReceptor,
  type EscenarioEmision,
  escenarioEmision,
  todoLoEscritoEmision,
} from '../../../test/emision-prueba';
import { emitirDocumento } from './emitir';

// Criterio transversal (PLAN-SAAS principios 1 y 5, §4.8) para la Fase 7: ni el XML del
// CAF, ni su `<RSASK>`, ni el token del SII, ni el .pfx o su clave llegan a
// `operaciones_sii`, a las escrituras de la base (servicio y sesión), a los mensajes para
// el usuario, a lo que recibe Sentry ni a la consola. El DTE firmado (con el certificado
// público y el TED) solo va a Storage y `ted_xml`, que es lo que se espera.

const consola: unknown[] = [];

beforeEach(() => {
  consola.length = 0;
  for (const metodo of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, metodo).mockImplementation((...args: unknown[]) => {
      consola.push(args);
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

function revisar(e: EscenarioEmision, resultado: unknown) {
  const todo = todoLoEscritoEmision(e) + JSON.stringify(resultado) + JSON.stringify(consola);
  const pfx = String(e.falso.secretos.get('pfx-secreto'));
  for (const secreto of [
    TOKEN_SII,
    CLAVE_PFX,
    'RSASK',
    'BEGIN RSA PRIVATE KEY',
    'PRIVATE KEY',
    '<AUTORIZACION',
    pfx.slice(0, 40),
    ...e.rsask.map((r) => r.split('\n')[1] ?? '-'),
  ]) {
    expect(todo, `apareció ${secreto.slice(0, 12)}…`).not.toContain(secreto);
  }
}

function emitir(e: EscenarioEmision) {
  return emitirDocumento(e.ctx, { nivel: 'emitir', borrador: borradorConReceptor() }, e.deps);
}

describe('emisión: secretos fuera de operaciones_sii, base, mensajes, Sentry y consola', () => {
  it('una emisión completa (ensayo y emisión)', async () => {
    const e = escenarioEmision();
    const ensayo = await emitirDocumento(
      e.ctx,
      { nivel: 'ensayo', borrador: borradorConReceptor() },
      e.deps,
    );
    const r = await emitir(e);
    expect(r.tipo).toBe('ok');
    revisar(e, [ensayo, r]);
  });

  it('un error de transporte que trae el token en su texto (incierto)', async () => {
    const e = escenarioEmision();
    e.rest.enviarBoleta.mockRejectedValueOnce(
      new ErrorTransporte(
        `Falló con Authorization: Bearer ${TOKEN_SII}; token=${TOKEN_SII}`,
        `https://rahue.sii.cl/recursos/v1/boleta.electronica.envio?token=${TOKEN_SII}`,
      ),
    );
    const r = await emitir(e);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    revisar(e, r);
  });

  it('una falla de Storage y de la base con el CAF en el texto (antes de enviar)', async () => {
    const e = escenarioEmision();
    const caf = String(e.falso.secretos.get('secreto-caf-prod-39'));
    e.falso.fallas.set('storage:upload', { code: '500', message: `fallo con ${caf}` });
    e.falso.fallas.set('folios_anulados:insert', { code: 'XX000', message: `fallo con ${caf}` });
    const r = await emitir(e);
    expect(r).toMatchObject({ tipo: 'error' });
    revisar(e, r);
  });

  it('un error desconocido con la clave del .pfx en el mensaje', async () => {
    const e = escenarioEmision();
    e.rest.obtenerToken.mockRejectedValueOnce(new Error(`clave=${CLAVE_PFX} ${TOKEN_SII}`));
    const r = await emitir(e);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'error' });
    revisar(e, r);
  });
});
