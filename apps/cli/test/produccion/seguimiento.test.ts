// `sii produccion seguimiento`: todo contra el TransporteFalso; nada sale a la red.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type PeticionRegistrada, RespuestaHttp, TransporteFalso } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../src/errores.ts';
import { CLAVE_PFX, correr, INSTANTE, type Proyecto, proyecto } from '../soporte/cli.ts';
import { fixture, SII_FALSO, TOKEN } from './soporte.ts';

type Ambiente = keyof typeof SII_FALSO;

/** Deja en `data/output` el registro que habría escrito `emitir --confirmar`. */
function registro(
  p: Proyecto,
  datos: {
    folio: number;
    ambiente?: Ambiente;
    trackId?: string;
    incierto?: boolean;
    enviadoEn?: string;
    tipoDte?: number;
    error?: string;
  },
): void {
  const ambiente = datos.ambiente ?? 'produccion';
  const incierto = datos.incierto ?? false;
  const base = `boleta-${ambiente}-${datos.folio}`;
  p.escribir(
    `data/output/${base}.envio.json`,
    `${JSON.stringify(
      {
        ambiente,
        tipoDte: datos.tipoDte ?? 39,
        folio: datos.folio,
        archivo: `${base}.xml`,
        enviadoEn: datos.enviadoEn ?? '2026-11-06T13:00:00.000Z',
        incierto,
        ...(incierto
          ? { error: datos.error ?? 'ErrorTransporte: se agotó el tiempo' }
          : { trackId: datos.trackId, estado: 'REC', fechaRecepcion: '2026-11-06 10:00:01' }),
      },
      null,
      2,
    )}\n`,
  );
}

/** Estado REST de un envío de una boleta. */
function estado(trackId: string, codigo: string, conteos: Partial<Record<string, number>> = {}) {
  const { aceptados = 1, rechazados = 0, reparos = 0 } = conteos;
  return JSON.stringify({
    trackid: Number(trackId),
    estado: codigo,
    fecha_recepcion: '2026-11-06 10:00:01',
    estadistica:
      codigo === 'EPR'
        ? [{ tipo: 39, informados: aceptados + rechazados, aceptados, rechazados, reparos }]
        : [],
    detalle_rep_rech:
      rechazados > 0
        ? [
            {
              tipo: 39,
              folio: 7,
              estado: 'RCH',
              descripcion: 'Rechazado',
              error: [{ codigo: 302, descripcion: 'Monto Total No Cuadra' }],
            },
          ]
        : [],
  });
}

/** SII falso que responde el estado según el trackId de la URL. */
function siiFalso(
  ambiente: Ambiente,
  estados: Readonly<Record<string, string | RespuestaHttp>>,
): TransporteFalso {
  const { auth } = SII_FALSO[ambiente];
  return new TransporteFalso({
    [`${auth}/boleta.electronica.semilla`]: fixture('semilla.xml'),
    [`${auth}/boleta.electronica.token`]: fixture('token.xml'),
    [`${auth}/boleta.electronica.envio/*`]: (peticion: PeticionRegistrada) => {
      const trackId = peticion.url.split('-').at(-1) ?? '';
      return estados[trackId] ?? new RespuestaHttp(404, {}, '');
    },
  });
}

function sinSecretos(r: { stdout: string; stderr: string }): void {
  for (const texto of [r.stdout, r.stderr]) {
    expect(texto).not.toContain(TOKEN);
    expect(texto).not.toContain(CLAVE_PFX);
  }
}

const SEGUIMIENTO = ['produccion', 'seguimiento'] as const;

describe('sii produccion seguimiento', () => {
  it('sin registros avisa y termina con 0, sin peticiones', async () => {
    const r = await correr(proyecto(), [...SEGUIMIENTO]);
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('No hay registros de envío de producción');
    expect(r.stdout).toContain('sii produccion emitir --confirmar');
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it('consulta cada trackId una vez con un solo token', async () => {
    const p = proyecto();
    registro(p, { folio: 3, trackId: '111', enviadoEn: '2026-11-06T13:00:00.000Z' });
    registro(p, { folio: 4, trackId: '222', enviadoEn: '2026-11-06T14:00:00.000Z' });
    registro(p, { folio: 5, trackId: '222', enviadoEn: '2026-11-06T14:00:00.000Z' });
    registro(p, { folio: 6, trackId: '333', enviadoEn: '2026-11-06T15:00:00.000Z' });
    // De otro ambiente: no se mira.
    registro(p, { folio: 9, trackId: '999', ambiente: 'certificacion' });
    const transporte = siiFalso('produccion', {
      '111': estado('111', 'EPR'),
      '222': estado('222', 'EPR', { aceptados: 2 }),
      '333': estado('333', 'SOK'),
    });

    const r = await correr(p, [...SEGUIMIENTO], { transporte });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(transporte.urls()).toEqual([
      'https://api.sii.cl/recursos/v1/boleta.electronica.semilla',
      'https://api.sii.cl/recursos/v1/boleta.electronica.token',
      'https://api.sii.cl/recursos/v1/boleta.electronica.envio/76123456-0-111',
      'https://api.sii.cl/recursos/v1/boleta.electronica.envio/76123456-0-222',
      'https://api.sii.cl/recursos/v1/boleta.electronica.envio/76123456-0-333',
    ]);
    const lineas = r.stdout.split('\n');
    expect(r.stdout).toContain('Seguimiento de boletas en producción (api.sii.cl)');
    expect(r.stdout).toContain('consultado el 2026-11-07 10:00');
    expect(lineas).toContain(
      'Folio  Tipo  Enviado           TrackID  Estado SII        Acept.  Rech.  Rep.',
    );
    expect(lineas).toContain(
      '3      39    2026-11-06 10:00  111      EPR (aceptado)    1       0      0',
    );
    expect(lineas).toContain(
      '4, 5   39    2026-11-06 11:00  222      EPR (aceptado)    2       0      0',
    );
    expect(lineas).toContain(
      '6      39    2026-11-06 12:00  333      SOK (en proceso)  0       0      0',
    );
    expect(r.stdout).not.toContain('999');
    expect(r.stdout).toContain(
      'Resumen: 3 envíos consultados · 2 aceptados · 0 con reparos · 1 en proceso · 0 rechazados',
    );
    expect(r.stdout).toContain('vuelve a correr `sii produccion seguimiento` en unos minutos');
    sinSecretos(r);
  });

  it('un registro incierto se lista aparte, no se consulta y sale con 6', async () => {
    const p = proyecto();
    registro(p, { folio: 7, incierto: true, error: 'ErrorTransporte: HTTP 502' });
    const r = await correr(p, [...SEGUIMIENTO]);
    expect(r.codigo).toBe(CODIGOS.INCIERTO);
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(r.stdout).toContain('Envíos inciertos');
    expect(r.stdout).toContain('portal del SII');
    expect(r.stdout).toContain(
      'Folio 7 (tipo 39), enviado 2026-11-06 10:00: ErrorTransporte: HTTP 502',
    );
    expect(r.stdout).not.toContain('TrackID');
  });

  it('un registro ilegible cuenta como incierto (6)', async () => {
    const p = proyecto();
    p.escribir('data/output/boleta-produccion-8.envio.json', '{ roto');
    p.escribir(
      'data/output/boleta-produccion-9.envio.json',
      JSON.stringify({ ambiente: 'produccion', folio: 9 }),
    );
    const r = await correr(p, [...SEGUIMIENTO]);
    expect(r.codigo).toBe(CODIGOS.INCIERTO);
    expect(r.stdout).toContain('boleta-produccion-8.envio.json: no es un JSON válido');
    expect(r.stdout).toContain('boleta-produccion-9.envio.json: campos inválidos: tipoDte');
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it('un rechazo sale con 5 y muestra el detalle; gana sobre un incierto', async () => {
    const p = proyecto();
    registro(p, { folio: 7, trackId: '444' });
    registro(p, { folio: 8, trackId: '555' });
    registro(p, { folio: 9, incierto: true });
    const transporte = siiFalso('produccion', {
      '444': estado('444', 'EPR', { aceptados: 0, rechazados: 1 }),
      '555': estado('555', 'RFR'),
    });
    const r = await correr(p, [...SEGUIMIENTO], { transporte });
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(r.stdout).toContain('EPR (rechazado)');
    expect(r.stdout).toContain('RFR (rechazado)');
    expect(r.stdout).toContain('Rechazos y reparos:');
    expect(r.stdout).toContain(
      'TrackID 444: EPR (envío procesado), informados 1 · aceptados 0 · rechazados 1 · reparos 0',
    );
    expect(r.stdout).toContain('Tipo 39 folio 7: RCH (Rechazado) - [302] Monto Total No Cuadra');
    expect(r.stdout).toContain('TrackID 555: RFR (rechazado por error en la firma)');
    expect(r.stdout).toContain('Folio 9 (tipo 39)');
    expect(r.stdout).toContain('2 rechazados');
  });

  it('reparos sin rechazos es 0; una consulta que falla es 4 y no corta las demás', async () => {
    const p = proyecto();
    registro(p, { folio: 1, trackId: '10', enviadoEn: '2026-11-06T13:00:00.000Z' });
    registro(p, { folio: 2, trackId: '20', enviadoEn: '2026-11-06T14:00:00.000Z' });
    const conReparos = await correr(p, [...SEGUIMIENTO], {
      transporte: siiFalso('produccion', {
        '10': estado('10', 'EPR', { reparos: 1 }),
        '20': estado('20', 'EPR'),
      }),
    });
    expect(conReparos.codigo).toBe(CODIGOS.OK);
    expect(conReparos.stdout).toContain('EPR (con reparos)');

    const transporte = siiFalso('produccion', {
      '10': new RespuestaHttp(500, {}, 'error'),
      '20': estado('20', 'EPR'),
    });
    const r = await correr(p, [...SEGUIMIENTO], { transporte });
    expect(r.codigo).toBe(CODIGOS.TRANSPORTE);
    expect(transporte.urls()).toHaveLength(4);
    expect(r.stdout).toContain('error de consulta');
    expect(r.stdout).toContain('Consultas que fallaron');
    expect(r.stdout).toContain('TrackID 10 (folio 1): ErrorTransporte');
    expect(r.stdout).toContain('EPR (aceptado)');
    sinSecretos(r);
  });

  it('un token rechazado (401) corta el seguimiento con 4', async () => {
    const p = proyecto();
    registro(p, { folio: 1, trackId: '10' });
    registro(p, { folio: 2, trackId: '20' });
    const transporte = siiFalso('produccion', { '10': new RespuestaHttp(401, {}, '') });
    const r = await correr(p, [...SEGUIMIENTO], { transporte });
    expect(r.codigo).toBe(CODIGOS.TRANSPORTE);
    expect(transporte.urls()).toHaveLength(3);
    sinSecretos(r);
  });

  it('--json imprime el resultado estructurado', async () => {
    const p = proyecto();
    registro(p, { folio: 3, trackId: '111' });
    registro(p, { folio: 4, incierto: true });
    const r = await correr(p, [...SEGUIMIENTO, '--json'], {
      transporte: siiFalso('produccion', { '111': estado('111', 'EPR') }),
    });
    expect(r.codigo).toBe(CODIGOS.INCIERTO);
    const datos = JSON.parse(r.stdout);
    expect(datos).toMatchObject({
      ambiente: 'produccion',
      consultadoEn: new Date(INSTANTE).toISOString(),
      codigo: CODIGOS.INCIERTO,
      envios: [
        {
          trackId: '111',
          folios: [3],
          tiposDte: [39],
          resultado: 'aceptado',
          estado: 'EPR',
          glosa: 'envío procesado',
          informados: 1,
          aceptados: 1,
          rechazados: 0,
          reparos: 0,
          enviadoEn: '2026-11-06T13:00:00.000Z',
          fechaRecepcion: '2026-11-06 10:00:01',
          detalle: [],
        },
      ],
      inciertos: [{ folio: 4, tipoDte: 39, archivo: 'boleta-produccion-4.xml' }],
      ilegibles: [],
    });
    sinSecretos(r);

    const vacio = await correr(proyecto(), [...SEGUIMIENTO, '--json']);
    expect(vacio.codigo).toBe(CODIGOS.OK);
    expect(JSON.parse(vacio.stdout)).toMatchObject({ envios: [], inciertos: [], ilegibles: [] });
  });

  it('--bitacora agrega una línea JSON por envío en cada ejecución', async () => {
    const p = proyecto();
    registro(p, { folio: 3, trackId: '111' });
    registro(p, { folio: 4, incierto: true });
    const argv = [...SEGUIMIENTO, '--bitacora', 'bitacora/piloto.jsonl'];
    p.escribir('bitacora/.mantener', '');
    const transporte = () => siiFalso('produccion', { '111': estado('111', 'REC') });

    const primera = await correr(p, argv, { transporte: transporte() });
    expect(primera.codigo).toBe(CODIGOS.INCIERTO);
    expect(primera.stdout).toContain(`Bitácora: ${join(p.dir, 'bitacora', 'piloto.jsonl')}`);
    await correr(p, argv, {
      transporte: transporte(),
      reloj: { ahora: () => new Date('2026-11-08T13:00:00Z') },
    });

    const lineas = readFileSync(join(p.dir, 'bitacora', 'piloto.jsonl'), 'utf8')
      .trimEnd()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lineas).toEqual([
      {
        consultadoEn: '2026-11-07T13:00:00.000Z',
        ambiente: 'produccion',
        trackId: '111',
        folios: [3],
        tiposDte: [39],
        resultado: 'en-proceso',
        estado: 'REC',
        informados: 0,
        aceptados: 0,
        rechazados: 0,
        reparos: 0,
      },
      {
        consultadoEn: '2026-11-07T13:00:00.000Z',
        ambiente: 'produccion',
        folios: [4],
        tiposDte: [39],
        resultado: 'incierto',
      },
      expect.objectContaining({ consultadoEn: '2026-11-08T13:00:00.000Z', trackId: '111' }),
      expect.objectContaining({ consultadoEn: '2026-11-08T13:00:00.000Z', resultado: 'incierto' }),
    ]);
    expect(readFileSync(join(p.dir, 'bitacora', 'piloto.jsonl'), 'utf8')).not.toContain(TOKEN);
  });

  it('--bitacora en una carpeta que no existe es error de configuración, sin peticiones', async () => {
    const p = proyecto();
    registro(p, { folio: 3, trackId: '111' });
    const r = await correr(p, [...SEGUIMIENTO, '--bitacora', 'no-existe/piloto.jsonl']);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('No existe la carpeta de --bitacora');
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it('--ambiente certificacion lee solo esos registros y consulta apicert', async () => {
    const p = proyecto();
    registro(p, { folio: 3, trackId: '111' });
    registro(p, { folio: 36, trackId: '777', ambiente: 'certificacion' });
    const transporte = siiFalso('certificacion', { '777': estado('777', 'EPR') });
    const r = await correr(p, [...SEGUIMIENTO, '--ambiente', 'certificacion'], { transporte });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(transporte.urls().at(-1)).toBe(
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.envio/76123456-0-777',
    );
    expect(transporte.urls()).toHaveLength(3);
    expect(r.stdout).toContain('Seguimiento de boletas en certificación (apicert.sii.cl)');
    expect(r.stdout).toContain('36 ');
    expect(r.stdout).not.toContain('111');
  });

  it('--desde filtra por el día del envío (hora de Chile)', async () => {
    const p = proyecto();
    // 2026-11-05 23:30 en Chile (UTC-3): queda fuera.
    registro(p, { folio: 1, trackId: '10', enviadoEn: '2026-11-06T02:30:00.000Z' });
    registro(p, { folio: 2, trackId: '20', enviadoEn: '2026-11-06T03:30:00.000Z' });
    registro(p, { folio: 3, incierto: true, enviadoEn: '2026-11-01T13:00:00.000Z' });
    const transporte = siiFalso('produccion', { '20': estado('20', 'EPR') });
    const r = await correr(p, [...SEGUIMIENTO, '--desde', '2026-11-06'], { transporte });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(transporte.urls()).toEqual([
      'https://api.sii.cl/recursos/v1/boleta.electronica.semilla',
      'https://api.sii.cl/recursos/v1/boleta.electronica.token',
      'https://api.sii.cl/recursos/v1/boleta.electronica.envio/76123456-0-20',
    ]);
    expect(r.stdout).not.toContain('Envíos inciertos');

    const nada = await correr(p, [...SEGUIMIENTO, '--desde', '2026-12-01']);
    expect(nada.codigo).toBe(CODIGOS.OK);
    expect(nada.stdout).toContain('No hay registros de envío de producción desde el 2026-12-01');

    const mala = await correr(p, [...SEGUIMIENTO, '--desde', '06-11-2026']);
    expect(mala.codigo).toBe(CODIGOS.USO);
    expect(mala.stderr).toContain('--desde debe ser una fecha AAAA-MM-DD');
  });

  it('--salida cambia la carpeta de los registros', async () => {
    const p = proyecto();
    p.escribir(
      'otra/boleta-produccion-5.envio.json',
      JSON.stringify({
        ambiente: 'produccion',
        tipoDte: 41,
        folio: 5,
        archivo: 'boleta-produccion-5.xml',
        enviadoEn: '2026-11-06T13:00:00.000Z',
        incierto: false,
        trackId: '50',
      }),
    );
    const r = await correr(p, [...SEGUIMIENTO, '--salida', 'otra'], {
      transporte: siiFalso('produccion', { '50': estado('50', 'EPR') }),
    });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toMatch(/^5 +41 /m);
  });
});
