import { describe, expect, it, vi } from 'vitest';
import type { EstadoEntregaWebhook } from '@/lib/api-publica';
import {
  type CierreEntrega,
  cierreDe,
  cuerpoEntrega,
  type DependenciasWebhooks,
  type EntregaReclamada,
  ejecutarEntregas,
  sanearRespuesta,
} from './cron';
import type { PeticionWebhook, ResultadoHttp } from './entregar';
import { verificarFirma } from './firma';

// La corrida de webhooks con dobles: reclamar → secreto → firma → POST → cierre.

const SECRETO = 'whsec_secreto_de_prueba_0123456789';
const AHORA = new Date('2026-11-18T12:00:00Z');

function entrega(id: number, extra: Partial<EntregaReclamada> = {}): EntregaReclamada {
  return {
    id,
    organizacion_id: 'org-1',
    webhook_id: 'wh-1',
    evento: 'documento.aceptado',
    payload: {
      evento: 'documento.aceptado',
      creado_en: '2026-11-18T11:59:00+00:00',
      datos: { documento_id: `doc-${id}`, folio: 43 },
    },
    intentos: 1,
    url: 'https://receptor.example.com/hook',
    secreto_secret_id: 'sec-1',
    ...extra,
  };
}

function dependencias(
  entregas: EntregaReclamada[],
  responder: (p: PeticionWebhook) => ResultadoHttp | Promise<ResultadoHttp> = () => ({
    tipo: 'respuesta',
    status: 200,
    cuerpo: 'ok',
  }),
  extra: Partial<DependenciasWebhooks> = {},
) {
  const peticiones: PeticionWebhook[] = [];
  const cierres: CierreEntrega[] = [];
  const deps: DependenciasWebhooks = {
    reclamar: vi.fn(async () => entregas),
    leerSecreto: vi.fn(async () => SECRETO),
    cerrar: vi.fn(async (c: CierreEntrega): Promise<EstadoEntregaWebhook | null> => {
      cierres.push(c);
      if (c.entregada) return 'entregado';
      return c.definitiva ? 'descartado' : 'fallido';
    }),
    enviar: vi.fn(async (p: PeticionWebhook) => {
      peticiones.push(p);
      return responder(p);
    }),
    reloj: () => AHORA,
    avisar: vi.fn(),
    ...extra,
  };
  return { deps, peticiones, cierres };
}

describe('ejecutarEntregas', () => {
  it('reclama 32 con arriendo de 120 s, firma, envía y cierra como entregada', async () => {
    const { deps, peticiones, cierres } = dependencias([entrega(7)]);
    const resumen = await ejecutarEntregas(deps);
    expect(deps.reclamar).toHaveBeenCalledWith(32, 120);
    expect(resumen).toEqual({
      reclamadas: 1,
      entregadas: 1,
      fallidas: 0,
      descartadas: 0,
      postergadas: 0,
      errores: 0,
    });
    const [p] = peticiones;
    expect(p?.url).toBe('https://receptor.example.com/hook');
    expect(JSON.parse(p?.cuerpo ?? '')).toEqual({
      id: '7',
      evento: 'documento.aceptado',
      creado_en: '2026-11-18T11:59:00+00:00',
      datos: { documento_id: 'doc-7', folio: 43 },
    });
    expect(p?.cabeceras).toMatchObject({
      'Content-Type': 'application/json; charset=utf-8',
      'User-Agent': expect.stringMatching(/^Boleteame-Webhooks\/1\.0/),
      'Boleteame-Evento': 'documento.aceptado',
      'Boleteame-Entrega': '7',
      'Boleteame-Intento': '1',
    });
    // La firma es verificable por el receptor con el secreto.
    expect(
      verificarFirma({
        cuerpo: p?.cuerpo ?? '',
        cabecera: p?.cabeceras['Boleteame-Firma'],
        secreto: SECRETO,
        ahora: AHORA,
      }),
    ).toEqual({ ok: true, t: Math.floor(AHORA.getTime() / 1000) });
    expect(cierres).toEqual([
      { id: 7, intento: 1, entregada: true, statusHttp: 200, respuesta: 'ok', definitiva: false },
    ]);
  });

  it('el cuerpo es el mismo entre intentos (solo cambian Intento y t de la firma)', async () => {
    const a = dependencias([entrega(9, { intentos: 1 })]);
    await ejecutarEntregas(a.deps);
    const b = dependencias([entrega(9, { intentos: 3 })], undefined, {
      reloj: () => new Date(AHORA.getTime() + 60_000),
    });
    await ejecutarEntregas(b.deps);
    expect(a.peticiones[0]?.cuerpo).toBe(b.peticiones[0]?.cuerpo);
    expect(b.peticiones[0]?.cabeceras['Boleteame-Intento']).toBe('3');
    // El cierre lleva el intento del reclamo: la base no pisa una fila reenviada a mitad.
    expect(b.cierres[0]?.intento).toBe(3);
    expect(a.peticiones[0]?.cabeceras['Boleteame-Firma']).not.toBe(
      b.peticiones[0]?.cabeceras['Boleteame-Firma'],
    );
  });

  it('fallas del receptor: 500, 3xx y sin respuesta quedan fallidas; bloqueada se descarta', async () => {
    const guiones: Record<number, ResultadoHttp> = {
      1: { tipo: 'respuesta', status: 500, cuerpo: 'Internal Server Error' },
      2: { tipo: 'respuesta', status: 301, cuerpo: '<html>moved</html>' },
      3: { tipo: 'falla', mensaje: 'El receptor no respondió en 10 s.' },
      4: { tipo: 'bloqueada', mensaje: 'La URL resuelve a una dirección privada.' },
    };
    const { deps, cierres } = dependencias(
      [entrega(1), entrega(2), entrega(3), entrega(4)],
      (p) => {
        const id = Number(p.cabeceras['Boleteame-Entrega']);
        return guiones[id] as ResultadoHttp;
      },
    );
    const resumen = await ejecutarEntregas(deps);
    expect(resumen).toMatchObject({
      reclamadas: 4,
      entregadas: 0,
      fallidas: 3,
      descartadas: 1,
      errores: 0,
    });
    const porId = new Map(cierres.map((c) => [c.id, c]));
    expect(porId.get(1)).toEqual({
      id: 1,
      intento: 1,
      entregada: false,
      statusHttp: 500,
      respuesta: 'Internal Server Error',
      definitiva: false,
    });
    expect(porId.get(2)?.respuesta).toBe(
      'Respondió 301: los webhooks no siguen redirecciones. Actualiza la URL.',
    );
    expect(porId.get(2)?.statusHttp).toBe(301);
    expect(porId.get(3)).toMatchObject({ statusHttp: null, definitiva: false });
    expect(porId.get(4)).toMatchObject({ statusHttp: null, definitiva: true });
  });

  it('lee el secreto una sola vez por webhook en la corrida', async () => {
    const { deps } = dependencias([
      entrega(1),
      entrega(2),
      entrega(3, { webhook_id: 'wh-2', secreto_secret_id: 'sec-2' }),
    ]);
    await ejecutarEntregas(deps);
    expect(deps.leerSecreto).toHaveBeenCalledTimes(2);
  });

  it('secreto ilegible: no envía, cierra como fallida reintentable y lo cuenta como error', async () => {
    const { deps, peticiones, cierres } = dependencias([entrega(1)], undefined, {
      leerSecreto: vi.fn(async () => {
        throw new Error('vault caído');
      }),
    });
    const resumen = await ejecutarEntregas(deps);
    expect(peticiones).toHaveLength(0);
    expect(cierres[0]).toMatchObject({
      id: 1,
      entregada: false,
      statusHttp: null,
      definitiva: false,
    });
    expect(cierres[0]?.respuesta).toContain('secreto');
    expect(resumen).toMatchObject({ errores: 1, fallidas: 1 });
    expect(deps.avisar).toHaveBeenCalledWith(
      expect.objectContaining({ extra: { webhook: 'wh-1' } }),
    );
  });

  it('el reclamo falla: no hace nada más y avisa', async () => {
    const { deps } = dependencias([], undefined, {
      reclamar: vi.fn(async () => {
        throw new Error('rpc');
      }),
    });
    const resumen = await ejecutarEntregas(deps);
    expect(resumen).toMatchObject({ reclamadas: 0, errores: 1 });
    expect(deps.enviar).not.toHaveBeenCalled();
    expect(deps.avisar).toHaveBeenCalledTimes(1);
  });

  it('el cierre falla o no encuentra la fila: error con aviso, sin tumbar la corrida', async () => {
    let n = 0;
    const { deps } = dependencias([entrega(1), entrega(2), entrega(3)], undefined, {
      cerrar: vi.fn(async (): Promise<EstadoEntregaWebhook | null> => {
        n += 1;
        if (n === 1) throw new Error('cierre');
        if (n === 2) return null;
        return 'entregado';
      }),
    });
    const resumen = await ejecutarEntregas(deps);
    expect(resumen).toMatchObject({ reclamadas: 3, entregadas: 1, errores: 2 });
    expect(deps.avisar).toHaveBeenCalledTimes(2);
  });

  it('enviar que lanza se trata como falla de red', async () => {
    const { deps, cierres } = dependencias([entrega(1)], () => {
      throw new Error('inesperado');
    });
    const resumen = await ejecutarEntregas(deps);
    expect(resumen.fallidas).toBe(1);
    expect(cierres[0]).toMatchObject({ statusHttp: null, definitiva: false });
  });

  it('hasta 8 en paralelo', async () => {
    let activas = 0;
    let maximo = 0;
    const entregas = Array.from({ length: 20 }, (_, i) => entrega(i + 1));
    const { deps } = dependencias(entregas, async () => {
      activas += 1;
      maximo = Math.max(maximo, activas);
      await new Promise((r) => setTimeout(r, 5));
      activas -= 1;
      return { tipo: 'respuesta', status: 200, cuerpo: '' };
    });
    const resumen = await ejecutarEntregas(deps);
    expect(maximo).toBe(8);
    expect(resumen.entregadas).toBe(20);
  });

  it('no empieza entregas después de 45 s: quedan postergadas', async () => {
    let ms = AHORA.getTime();
    const entregas = Array.from({ length: 12 }, (_, i) => entrega(i + 1));
    const { deps } = dependencias(
      entregas,
      () => {
        ms += 10_000; // cada entrega «tarda» 10 s
        return { tipo: 'respuesta', status: 200, cuerpo: '' };
      },
      { reloj: () => new Date(ms) },
    );
    const resumen = await ejecutarEntregas(deps);
    expect(resumen.entregadas + resumen.postergadas).toBe(12);
    expect(resumen.postergadas).toBeGreaterThan(0);
    expect(deps.cerrar).toHaveBeenCalledTimes(resumen.entregadas);
  });

  it('sin entregas: resumen en cero sin leer secretos', async () => {
    const { deps } = dependencias([]);
    expect(await ejecutarEntregas(deps)).toEqual({
      reclamadas: 0,
      entregadas: 0,
      fallidas: 0,
      descartadas: 0,
      postergadas: 0,
      errores: 0,
    });
    expect(deps.leerSecreto).not.toHaveBeenCalled();
  });
});

describe('cuerpoEntrega', () => {
  it('payload raro: creado_en vacío y datos {}', () => {
    expect(
      JSON.parse(cuerpoEntrega(entrega(3, { payload: null, evento: 'webhook.prueba' }))),
    ).toEqual({
      id: '3',
      evento: 'webhook.prueba',
      creado_en: '',
      datos: {},
    });
  });
});

describe('sanearRespuesta y cierreDe', () => {
  it('quita \\u0000, depura secretos y acota a 1.000 caracteres', () => {
    expect(sanearRespuesta('a\u0000b')).toBe('ab');
    expect(sanearRespuesta('x'.repeat(5000))).toHaveLength(1000);
    expect(sanearRespuesta(`Authorization: Bearer ${'a'.repeat(40)}`)).not.toContain(
      'a'.repeat(40),
    );
  });

  it('2xx entregada con el cuerpo; status fuera de rango sin status', () => {
    expect(cierreDe(1, { tipo: 'respuesta', status: 204, cuerpo: '' })).toEqual({
      id: 1,
      entregada: true,
      statusHttp: 204,
      respuesta: '',
      definitiva: false,
    });
    expect(cierreDe(1, { tipo: 'respuesta', status: 0, cuerpo: '' }).statusHttp).toBeNull();
    expect(cierreDe(1, { tipo: 'respuesta', status: 199, cuerpo: '' }).entregada).toBe(false);
  });
});
