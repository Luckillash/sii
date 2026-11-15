import { FoliosSinCafError } from '@winex/certificacion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cafPrueba } from '../../../test/caf-prueba';
import {
  CLAVE_PFX,
  COOKIE_SII,
  TOKEN_SII,
  todoLoEscrito,
} from '../../../test/certificacion-prueba';
import { escenarioFolios, revisionQueAsigna } from '../../../test/folios-prueba';
import { solicitarFolios } from './solicitar';
import { subirCaf } from './subir';

// Criterio transversal (PLAN-SAAS principios 1 y 5, §4.8) para la Fase 6: ni el XML del
// CAF, ni su `<RSASK>`, ni tokens, cookies o la clave del .pfx llegan a
// `operaciones_sii`, a los mensajes para el usuario, a lo que recibe Sentry ni a la
// consola. La única salida legítima del CAF es la RPC `registrar_caf` (a Vault).

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

function revisar(e: ReturnType<typeof escenarioFolios>, resultado: unknown, extra: string[] = []) {
  const todo = todoLoEscrito(e) + JSON.stringify(resultado) + JSON.stringify(consola);
  for (const secreto of [
    TOKEN_SII,
    COOKIE_SII,
    CLAVE_PFX,
    'RSASK',
    'BEGIN RSA PRIVATE KEY',
    '<AUTORIZACION',
    ...extra,
  ]) {
    expect(todo, `apareció ${secreto.slice(0, 12)}…`).not.toContain(secreto);
  }
}

describe('folios: secretos fuera de operaciones_sii, mensajes, Sentry y consola', () => {
  it('un timbraje completo en producción (revisión + timbraje)', async () => {
    const e = escenarioFolios();
    const { xml, rsask } = cafPrueba({ desde: 1, hasta: 10, idk: 300 });
    revisionQueAsigna(e, 1, 10);
    const rev = await solicitarFolios(
      e.ctx,
      { nivel: 'revision', tipoDte: 39, ambiente: 'produccion', cantidad: 10 },
      e.deps,
    );
    if (rev.tipo !== 'revision') throw new Error('se esperaba la revisión');
    e.folios.solicitar.mockResolvedValueOnce(Buffer.from(xml, 'latin1'));
    const r = await solicitarFolios(
      e.ctx,
      {
        nivel: 'timbrar',
        tipoDte: 39,
        ambiente: 'produccion',
        cantidad: 10,
        revisionId: rev.revision.revisionId,
      },
      e.deps,
    );
    expect(r.tipo).toBe('ok');
    revisar(e, [rev, r], [rsask.split('\n')[1] ?? '-']);
  });

  it('un error de folios que trae la cookie y el token en su texto', async () => {
    const e = escenarioFolios();
    e.folios.solicitar.mockRejectedValueOnce(
      new FoliosSinCafError(
        1,
        5,
        'certificacion',
        'maullin.sii.cl',
        `Cookie: TOKEN=${COOKIE_SII}; token=${TOKEN_SII}`,
      ),
    );
    const r = await solicitarFolios(
      e.ctx,
      { nivel: 'timbrar', tipoDte: 41, ambiente: 'certificacion', cantidad: 5 },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    revisar(e, r);
  });

  it('un CAF timbrado que no se pudo guardar, con el XML en el error de la base', async () => {
    const e = escenarioFolios();
    const { xml, rsask } = cafPrueba({ desde: 1, hasta: 5 });
    e.folios.solicitar.mockResolvedValueOnce(Buffer.from(xml, 'latin1'));
    e.falso.fallas.set('rpc:registrar_caf', { code: 'XX000', message: `fallo con ${xml}` });
    const r = await solicitarFolios(
      e.ctx,
      { nivel: 'timbrar', tipoDte: 39, ambiente: 'certificacion', cantidad: 5 },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    revisar(e, r, [rsask.split('\n')[1] ?? '-']);
  });

  it('la carga manual: el CAF solo viaja a registrar_caf, también cuando la base falla', async () => {
    const e = escenarioFolios();
    const { xml, rsask } = cafPrueba({ idk: 300 });
    e.falso.fallas.set('rpc:registrar_caf', { code: 'XX000', message: `fallo con ${xml}` });
    const r = await subirCaf(
      e.ctx,
      { ambiente: 'produccion', contenido: new Uint8Array(Buffer.from(xml, 'latin1')) },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error' });
    revisar(e, r, [rsask.split('\n')[1] ?? '-']);
  });
});
