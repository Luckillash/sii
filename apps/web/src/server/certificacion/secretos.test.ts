import { ErrorTransporte, FoliosSinCafError } from '@winex/certificacion';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cafPrueba } from '../../../test/caf-prueba';
import {
  CLAVE_PFX,
  COOKIE_SII,
  EMPRESA,
  escenario,
  ORG,
  TOKEN_SII,
  todoLoEscrito,
} from '../../../test/certificacion-prueba';
import { consultarEstadoSet, enviarSet } from './envio-set';
import { solicitarFoliosSet } from './folios';
import { postular } from './postulacion';

// Criterio transversal (PLAN-SAAS principios 1 y 5, §4.8): ningún secreto (llave del CAF,
// token del SII, cookie AUT2000, clave del .pfx) llega a `operaciones_sii`, a los mensajes
// para el usuario, a lo que recibe Sentry ni a la consola, aunque el error de la librería
// o de la red los traiga en su texto.

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

function revisar(e: ReturnType<typeof escenario>, resultado: unknown, extra: string[] = []) {
  const todo = todoLoEscrito(e) + JSON.stringify(resultado) + JSON.stringify(consola);
  for (const secreto of [
    TOKEN_SII,
    COOKIE_SII,
    CLAVE_PFX,
    'RSASK',
    'BEGIN RSA PRIVATE KEY',
    ...extra,
  ]) {
    expect(todo, `apareció ${secreto.slice(0, 12)}…`).not.toContain(secreto);
  }
}

describe('secretos fuera de operaciones_sii, mensajes, Sentry y consola', () => {
  it('un error de folios que trae la cookie y el token en su texto', async () => {
    const e = escenario({ etapa: 'postulada' });
    e.folios.solicitar.mockRejectedValueOnce(
      new FoliosSinCafError(
        1,
        5,
        'certificacion',
        'maullin.sii.cl',
        `Cookie: TOKEN=${COOKIE_SII}; token=${TOKEN_SII}`,
      ),
    );
    const r = await solicitarFoliosSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    revisar(e, r);
  });

  it('una falla de red al enviar el set que trae el token en la URL', async () => {
    const { xml, rsask } = cafPrueba({ desde: 1, hasta: 10 });
    const e = escenario({
      etapa: 'set_descargado',
      tablas: {
        set_pruebas_casos: [
          {
            id: 'c1',
            organizacion_id: ORG,
            proceso_id: '55555555-5555-4555-8555-555555555555',
            numero_caso: 1,
            tipo_dte: 39,
            detalles: [{ nombre: 'Arroz', cantidad: 5, precio: 700 }],
            referencia_codigo: 'SET',
            referencia_razon: 'CASO-1',
          },
        ],
        cafs: [
          {
            id: 'caf-1',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            ambiente: 'certificacion',
            tipo_dte: 39,
            folio_desde: 1,
            folio_hasta: 10,
            siguiente_folio: 1,
            estado: 'activo',
            caf_secret_id: 'caf-secreto',
          },
        ],
        resoluciones: [
          {
            id: 'res',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            ambiente: 'certificacion',
            numero: 0,
            fecha: '2026-11-10',
            vigente: true,
          },
        ],
      },
    });
    e.falso.secretos.set('caf-secreto', xml);
    e.rest.enviarBoleta.mockRejectedValueOnce(
      new ErrorTransporte(
        `Se cortó la conexión (Cookie: TOKEN=${TOKEN_SII})`,
        `https://pangal.sii.cl/recursos/v1/boleta.electronica.envio?token=${TOKEN_SII}`,
      ),
    );
    const r = await enviarSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    revisar(e, r, [rsask.split('\n')[1] ?? '-']);
  });

  it('un error desconocido con la clave del .pfx en el mensaje queda genérico', async () => {
    const e = escenario({
      etapa: 'set_enviado',
      proceso: { envio_set_id: '88888888-8888-4888-8888-888888888888' },
      tablas: {
        envios: [
          {
            id: '88888888-8888-4888-8888-888888888888',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            track_id: '123',
            consultas: 0,
          },
        ],
      },
    });
    e.rest.consultarEnvio.mockRejectedValueOnce(new Error(`clave=${CLAVE_PFX} token ${TOKEN_SII}`));
    const r = await consultarEstadoSet(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'error' });
    expect(e.registros.some((x) => x.tipo === 'excepcion')).toBe(true);
    revisar(e, r);
  });

  it('una postulación completa no deja la cookie de la sesión en ninguna parte', async () => {
    const e = escenario();
    const r = await postular(e.ctx, { confirmada: true }, e.deps);
    expect(r.tipo).toBe('ok');
    revisar(e, r);
  });
});
