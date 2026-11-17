import { EstadoEnvio } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CLAVE_PFX } from '../../../test/certificacion-prueba';
import {
  agrupar,
  debeConsultar,
  ErrorSeguimiento,
  ejecutarSeguimiento,
  intervaloMinutos,
} from './cron';
import {
  AHORA,
  EMPRESA,
  EMPRESA_2,
  EMPRESA_ORG_2,
  type EscenarioSeguimiento,
  escenarioSeguimiento,
  filaDocumento,
  filaEnvio,
  jsonEstado,
  ORG,
  ORG_2,
  TOKEN_SII,
} from './escenario-prueba';
import { TEXTO_SIN_DETALLE } from './persistencia';

function correr(e: EscenarioSeguimiento, opciones?: Parameters<typeof ejecutarSeguimiento>[1]) {
  return ejecutarSeguimiento(e.deps, opciones);
}

function operaciones(e: EscenarioSeguimiento) {
  return e.falso.tabla('operaciones_sii');
}

describe('ejecutarSeguimiento: grupos y token', () => {
  it('agrupa por empresa y ambiente, pide un token por grupo y consulta en el host del ambiente', async () => {
    const envios = [
      filaEnvio({ track_id: '101' }),
      filaEnvio({ track_id: '102' }),
      filaEnvio({ track_id: '103' }),
      filaEnvio({ track_id: '201', empresa_id: EMPRESA_2 }),
      filaEnvio({ track_id: '202', empresa_id: EMPRESA_2 }),
      filaEnvio({ track_id: '301', ambiente: 'produccion' }),
    ];
    const e = escenarioSeguimiento({ envios });
    const r = await correr(e);

    expect(r).toEqual({
      envios: 6,
      consultados: 6,
      cambiados: 6,
      errores: 0,
      gruposOmitidos: 0,
      postergados: 0,
    });
    // Un token por empresa + ambiente: 2 en certificación (apicert) y 1 en producción (api).
    expect(e.tokensPedidos('apicert.sii.cl')).toBe(2);
    expect(e.tokensPedidos('//api.sii.cl')).toBe(1);
    const urls = e.consultasHechas().map((p) => p.url);
    expect(urls).toHaveLength(6);
    expect(urls.filter((u) => u.startsWith('https://apicert.sii.cl/'))).toHaveLength(5);
    expect(urls).toContain(
      'https://api.sii.cl/recursos/v1/boleta.electronica.envio/76123456-0-301',
    );
    expect(urls).toContain(
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.envio/77777777-7-201',
    );

    // Una operación `seguimiento` por grupo, sin usuario, con los conteos.
    const ops = operaciones(e);
    expect(ops).toHaveLength(3);
    for (const op of ops) {
      expect(op).toMatchObject({
        operacion: 'seguimiento',
        resultado: 'ok',
        canal: 'rest',
        confirmada: true,
        usuario_id: null,
        organizacion_id: ORG,
      });
    }
    expect(
      ops.map((o) => [
        o.empresa_id,
        o.ambiente,
        (o.detalle as Record<string, unknown>).consultados,
      ]),
    ).toEqual(
      expect.arrayContaining([
        [EMPRESA, 'certificacion', 3],
        [EMPRESA_2, 'certificacion', 2],
        [EMPRESA, 'produccion', 1],
      ]),
    );
  });

  it('el token de un grupo falla: se omite ese grupo (con su fila) y sigue con el resto', async () => {
    const prod = filaEnvio({ track_id: '301', ambiente: 'produccion' });
    const cert = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({ envios: [prod, cert], tokenFallaEn: 'api.sii.cl' });
    const r = await correr(e);

    expect(r).toMatchObject({ envios: 2, consultados: 1, errores: 0, gruposOmitidos: 1 });
    // El envío de producción quedó intacto: sin consulta, sin bitácora, sin intento anotado.
    expect(e.envio(prod.id)).toMatchObject({
      estado_sii: 'REC',
      consultas: 0,
      ultima_consulta_en: null,
    });
    expect(e.consultas(prod.id)).toEqual([]);
    expect(e.envio(cert.id)).toMatchObject({ estado_sii: 'EPR', consultas: 1 });
    const fallida = operaciones(e).find((o) => o.ambiente === 'produccion');
    expect(fallida).toMatchObject({ operacion: 'seguimiento', resultado: 'transporte' });
  });

  it('una empresa sin certificado se omite con una operación `config`', async () => {
    const ajeno = filaEnvio({ track_id: '901', organizacion_id: ORG_2, empresa_id: EMPRESA_ORG_2 });
    const e = escenarioSeguimiento({ envios: [ajeno] });
    const r = await correr(e);
    expect(r).toMatchObject({ envios: 1, consultados: 0, gruposOmitidos: 1 });
    expect(e.consultasHechas()).toEqual([]);
    expect(operaciones(e)).toEqual([
      expect.objectContaining({ organizacion_id: ORG_2, resultado: 'config' }),
    ]);
  });

  it('si el SII rechaza el token (401) lo renueva una vez y repite la consulta', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({
      envios: [envio],
      respuestas: { '101': [{ http: 401 }, jsonEstado('EPR', { informados: 1, aceptados: 1 })] },
    });
    const r = await correr(e);
    expect(r).toMatchObject({ consultados: 1, errores: 0 });
    expect(e.tokensPedidos()).toBe(2);
    expect(e.consultasHechas()).toHaveLength(2);
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'EPR', consultas: 1 });
  });

  it('con el token renovado y otro 401, posterga el resto del grupo', async () => {
    const envios = [
      filaEnvio({ track_id: '101' }),
      filaEnvio({ track_id: '102' }),
      filaEnvio({ track_id: '103' }),
    ];
    const e = escenarioSeguimiento({
      envios,
      respuestas: { '101': { http: 401 }, '102': { http: 401 }, '103': { http: 401 } },
    });
    const r = await correr(e);
    expect(r).toMatchObject({ envios: 3, consultados: 0, errores: 1, postergados: 2 });
    expect(e.tokensPedidos()).toBe(2);
    expect(operaciones(e)[0]).toMatchObject({ resultado: 'transporte' });
  });
});

describe('ejecutarSeguimiento: persistencia por respuesta', () => {
  it('EPR aceptado: envío, estadística, bitácora y documento aceptado', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const doc = filaDocumento(envio, 41);
    const e = escenarioSeguimiento({
      envios: [envio],
      documentos: [doc],
      respuestas: { '101': jsonEstado('EPR', { informados: 1, aceptados: 1 }) },
    });
    const r = await correr(e);
    expect(r).toMatchObject({ envios: 1, consultados: 1, cambiados: 1, errores: 0 });

    expect(e.envio(envio.id)).toMatchObject({
      estado_sii: 'EPR',
      informados: 1,
      aceptados: 1,
      rechazados: 0,
      reparos: 0,
      clasificacion: 'aceptado',
      consultas: 1,
      ultima_consulta_en: AHORA.toISOString(),
      respuesta_estado: expect.objectContaining({ estado: 'EPR', trackid: 101 }),
    });
    expect(e.falso.tabla('envio_estadisticas')).toEqual([
      expect.objectContaining({
        organizacion_id: ORG,
        envio_id: envio.id,
        tipo_dte: 39,
        informados: 1,
        aceptados: 1,
        rechazados: 0,
        reparos: 0,
      }),
    ]);
    expect(e.consultas(envio.id)).toEqual([
      expect.objectContaining({
        organizacion_id: ORG,
        estado_sii: 'EPR',
        informados: 1,
        aceptados: 1,
        consultado_en: AHORA.toISOString(),
        respuesta: expect.objectContaining({ estado: 'EPR' }),
      }),
    ]);
    expect(e.consultas(envio.id)[0]?.error).toBeUndefined();
    expect(e.falso.tabla('envio_rechazos')).toEqual([]);
    expect(e.historial.get(41)).toEqual(['enviado', 'aceptado']);
  });

  it('EPR con rechazos y reparos: guarda el detalle ANTES del estado y ningún documento pasa por aceptado', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const docs = [41, 42, 43].map((f) => filaDocumento(envio, f));
    const errorRch = {
      seccion: 'Detalle',
      linea: 1,
      nivel: 2,
      codigo: 123,
      descripcion: 'Monto del ítem no cuadra',
      detalle: 'MontoItem distinto de PrcItem * QtyItem',
    };
    const e = escenarioSeguimiento({
      envios: [envio],
      documentos: docs,
      respuestas: {
        '101': jsonEstado('EPR', { informados: 3, aceptados: 2, rechazados: 1, reparos: 1 }, [
          { tipo: 39, folio: 42, estado: 'RCH', descripcion: 'Rechazado', error: [errorRch] },
          {
            tipo: 39,
            folio: 43,
            estado: 'RPR',
            descripcion: 'Aceptado con reparos',
            error: [
              {
                seccion: 'Encabezado',
                linea: 3,
                nivel: 1,
                codigo: 7,
                descripcion: 'Giro largo',
                detalle: '',
              },
            ],
          },
        ]),
      },
    });
    const r = await correr(e);
    expect(r).toMatchObject({ consultados: 1, cambiados: 1, errores: 0 });

    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'EPR', clasificacion: 'rechazado' });
    const rechazos = e.falso.tabla('envio_rechazos');
    expect(rechazos).toHaveLength(2);
    expect(rechazos.find((x) => x.folio === 42)).toMatchObject({
      organizacion_id: ORG,
      envio_id: envio.id,
      documento_id: docs[1]?.id,
      tipo_dte: 39,
      estado: 'RCH',
      tipo_observacion: 'rechazo',
      descripcion: 'Rechazado',
      errores: [errorRch],
    });
    expect(rechazos.find((x) => x.folio === 43)).toMatchObject({
      documento_id: docs[2]?.id,
      tipo_observacion: 'reparo',
      errores: [
        {
          seccion: 'Encabezado',
          linea: 3,
          nivel: 1,
          codigo: 7,
          descripcion: 'Giro largo',
          detalle: '',
        },
      ],
    });

    // Orden: rechazos antes del update del estado del envío.
    const orden = e.falso.escrituras.map((w) => `${w.tabla}:${w.accion}`);
    const iRechazos = orden.indexOf('envio_rechazos:upsert');
    const iEstado = e.falso.escrituras.findIndex(
      (w) =>
        w.tabla === 'envios' &&
        w.accion === 'update' &&
        (w.datos as Record<string, unknown>).estado_sii === 'EPR',
    );
    expect(iRechazos).toBeGreaterThanOrEqual(0);
    expect(iRechazos).toBeLessThan(iEstado);
    expect(orden.indexOf('envio_estadisticas:upsert')).toBeLessThan(iEstado);
    expect(orden.lastIndexOf('consultas_envio:insert')).toBeGreaterThan(iEstado);

    // Estados finales correctos y sin pasar por un estado final equivocado.
    expect(e.historial.get(41)).toEqual(['enviado', 'aceptado']);
    expect(e.historial.get(42)).toEqual(['enviado', 'rechazado']);
    expect(e.historial.get(43)).toEqual(['enviado', 'aceptado_con_reparos']);
  });

  it('rechazo del sobre (RSC): el envío y todos sus documentos quedan rechazados', async () => {
    const envio = filaEnvio({ track_id: '101', estado_sii: 'SOK' });
    const docs = [filaDocumento(envio, 41), filaDocumento(envio, 42)];
    const e = escenarioSeguimiento({
      envios: [envio],
      documentos: docs,
      respuestas: { '101': jsonEstado('RSC') },
    });
    await correr(e);
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'RSC', clasificacion: 'rechazado' });
    expect(e.falso.tabla('envio_estadisticas')).toEqual([]);
    expect(e.historial.get(41)).toEqual(['enviado', 'rechazado']);
    expect(e.historial.get(42)).toEqual(['enviado', 'rechazado']);
  });

  it.each(['RCT', 'RFR', 'RCH'])('rechazo del sobre (%s)', async (estado) => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({
      envios: [envio],
      documentos: [filaDocumento(envio, 41)],
      respuestas: { '101': jsonEstado(estado) },
    });
    await correr(e);
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: estado, clasificacion: 'rechazado' });
    expect(e.historial.get(41)).toEqual(['enviado', 'rechazado']);
  });

  it('en proceso: REC → SOK cuenta como cambio y los documentos siguen enviados', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({
      envios: [envio],
      documentos: [filaDocumento(envio, 41)],
      respuestas: { '101': jsonEstado('SOK') },
    });
    const r = await correr(e);
    expect(r).toMatchObject({ consultados: 1, cambiados: 1 });
    expect(e.envio(envio.id)).toMatchObject({
      estado_sii: 'SOK',
      clasificacion: 'en_proceso',
      consultas: 1,
    });
    expect(e.historial.get(41)).toEqual(['enviado']);
  });

  it('en proceso sin cambios (REC → REC): consulta anotada, sin cambio', async () => {
    const envio = filaEnvio({ track_id: '101', consultas: 3 });
    const e = escenarioSeguimiento({ envios: [envio], respuestas: { '101': jsonEstado('REC') } });
    const r = await correr(e);
    expect(r).toMatchObject({ consultados: 1, cambiados: 0 });
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'REC', consultas: 4 });
    expect(e.consultas(envio.id)).toHaveLength(1);
  });

  it('un pendiente con Track ID (sin estado aún) también se consulta', async () => {
    const envio = filaEnvio({ track_id: '101', estado_sii: null });
    const e = escenarioSeguimiento({ envios: [envio] });
    const r = await correr(e);
    expect(r).toMatchObject({ envios: 1, consultados: 1 });
    expect(e.envio(envio.id)).toMatchObject({ clasificacion: 'aceptado' });
  });

  it('nunca toca envíos inciertos ni con estado final', async () => {
    const incierto = filaEnvio({ track_id: null, estado_sii: null, incierto: true });
    const final = filaEnvio({ track_id: '555', estado_sii: 'EPR', informados: 1, aceptados: 1 });
    const e = escenarioSeguimiento({ envios: [incierto, final] });
    const r = await correr(e);
    expect(r).toMatchObject({ envios: 0, consultados: 0 });
    expect(e.transporteFalso.enviadas).toEqual([]);
    expect(e.falso.escrituras).toEqual([]);
    expect(operaciones(e)).toEqual([]);
  });
});

describe('ejecutarSeguimiento: fallas por consulta', () => {
  it('una falla de red deja su fila con error y sigue con el resto', async () => {
    const malo = filaEnvio({ track_id: '101' });
    const bueno = filaEnvio({ track_id: '102' });
    const e = escenarioSeguimiento({ envios: [malo, bueno], respuestas: { '101': 'red' } });
    const r = await correr(e);
    expect(r).toMatchObject({ envios: 2, consultados: 1, errores: 1, cambiados: 1 });

    expect(e.consultas(malo.id)).toEqual([
      expect.objectContaining({
        organizacion_id: ORG,
        error: expect.stringContaining('ErrorTransporte'),
        consultado_en: AHORA.toISOString(),
      }),
    ]);
    // El intento queda anotado (cola y backoff) sin tocar el estado.
    expect(e.envio(malo.id)).toMatchObject({
      estado_sii: 'REC',
      consultas: 1,
      ultima_consulta_en: AHORA.toISOString(),
    });
    expect(e.envio(bueno.id)).toMatchObject({ estado_sii: 'EPR' });
    expect(operaciones(e)[0]).toMatchObject({
      resultado: 'ok',
      detalle: expect.objectContaining({ consultados: 1, errores: 1 }),
    });
  });

  it('un HTTP 500 del SII también queda como error de esa consulta', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({ envios: [envio], respuestas: { '101': { http: 500 } } });
    const r = await correr(e);
    expect(r).toMatchObject({ consultados: 0, errores: 1, gruposOmitidos: 0 });
    expect(e.consultas(envio.id)[0]?.error).toContain('HTTP 500');
    // Si fallan todas, la operación queda con el resultado de la última falla.
    expect(operaciones(e)[0]).toMatchObject({ resultado: 'transporte' });
    expect(e.registros.some((x) => x.etiquetas.host_sii === 'apicert.sii.cl')).toBe(true);
  });

  it('una respuesta sin estado es un error de esa consulta', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({ envios: [envio], respuestas: { '101': { otra: 'cosa' } } });
    const r = await correr(e);
    expect(r).toMatchObject({ errores: 1 });
    expect(e.consultas(envio.id)[0]?.error).toContain('ErrorRespuestaSii');
    expect(operaciones(e)[0]).toMatchObject({ resultado: 'rechazo_sii' });
  });

  it('si no puede leer la vista, lanza ErrorSeguimiento sin detalle de la base', async () => {
    const e = escenarioSeguimiento();
    e.falso.fallas.set('v_envios_por_consultar:select', {
      code: '42P01',
      message: 'relation secreta',
    });
    await expect(correr(e)).rejects.toThrow(ErrorSeguimiento);
    await expect(correr(e)).rejects.toThrow(
      'No se pudo leer v_envios_por_consultar (código 42P01).',
    );
  });
});

describe('ejecutarSeguimiento: lotes y backoff', () => {
  it('intervaloMinutos sube con las consultas', () => {
    expect(intervaloMinutos(0)).toBe(4);
    expect(intervaloMinutos(11)).toBe(4);
    expect(intervaloMinutos(12)).toBe(15);
    expect(intervaloMinutos(24)).toBe(60);
    expect(intervaloMinutos(48)).toBe(360);
    expect(intervaloMinutos(500)).toBe(360);
  });

  it('debeConsultar respeta el intervalo', () => {
    const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
    const env = (consultas: number, ultima: string | null, enviadoHace = 60) => ({
      consultas,
      ultima_consulta_en: ultima,
      enviado_en: hace(enviadoHace),
    });
    expect(debeConsultar(env(0, null), AHORA)).toBe(true);
    expect(debeConsultar(env(2, hace(5)), AHORA)).toBe(true);
    expect(debeConsultar(env(2, hace(2)), AHORA)).toBe(false);
    expect(debeConsultar(env(20, hace(10)), AHORA)).toBe(false);
    expect(debeConsultar(env(20, hace(16)), AHORA)).toBe(true);
    expect(debeConsultar(env(60, hace(300)), AHORA)).toBe(false);
    expect(debeConsultar(env(60, hace(361)), AHORA)).toBe(true);
    // Más de 7 días sin cerrar: una vez al día.
    const ochoDias = 8 * 24 * 60;
    expect(debeConsultar(env(60, hace(361), ochoDias), AHORA)).toBe(false);
    expect(debeConsultar(env(60, hace(24 * 60), ochoDias), AHORA)).toBe(true);
    expect(debeConsultar(env(3, hace(10), ochoDias), AHORA)).toBe(false);
  });

  it('salta los envíos muy consultados que todavía no toca consultar', async () => {
    const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
    const reciente = filaEnvio({ track_id: '101', consultas: 30, ultima_consulta_en: hace(20) });
    const toca = filaEnvio({ track_id: '102', consultas: 30, ultima_consulta_en: hace(61) });
    const e = escenarioSeguimiento({ envios: [reciente, toca] });
    const r = await correr(e);
    expect(r).toMatchObject({ envios: 1, consultados: 1 });
    expect(e.consultasHechas().map((p) => p.url)).toEqual([
      'https://apicert.sii.cl/recursos/v1/boleta.electronica.envio/76123456-0-102',
    ]);
  });

  it('toma hasta el tope por corrida, primero los nunca consultados y luego los más antiguos', async () => {
    const hace = (min: number) => new Date(AHORA.getTime() - min * 60_000).toISOString();
    const envios = [
      filaEnvio({ track_id: '101', consultas: 1, ultima_consulta_en: hace(10) }),
      filaEnvio({ track_id: '102', consultas: 1, ultima_consulta_en: hace(30) }),
      filaEnvio({ track_id: '103' }),
    ];
    const e = escenarioSeguimiento({ envios });
    const r = await correr(e, { tope: 2 });
    expect(r).toMatchObject({ envios: 2, consultados: 2 });
    expect(e.consultasHechas().map((p) => p.url.split('-').at(-1))).toEqual(['103', '102']);
  });

  it('agrupar conserva el orden de prioridad del primer envío de cada grupo', () => {
    const a = filaEnvio({ track_id: '1', empresa_id: EMPRESA_2 });
    const b = filaEnvio({ track_id: '2' });
    const c = filaEnvio({ track_id: '3', empresa_id: EMPRESA_2 });
    const grupos = agrupar([a, b, c] as never);
    expect(grupos.map((g) => [g.empresaId, g.envios.length])).toEqual([
      [EMPRESA_2, 2],
      [EMPRESA, 1],
    ]);
  });
});

describe('ejecutarSeguimiento: canal SOAP', () => {
  it('consulta con QueryEstUp (ClienteDtews) y guarda estado y conteos', async () => {
    const envio = filaEnvio({ track_id: '101', canal: 'soap' });
    const e = escenarioSeguimiento({ envios: [envio], documentos: [filaDocumento(envio, 41)] });
    const r = await correr(e);
    expect(r).toMatchObject({ consultados: 1, errores: 0 });
    expect(e.soap.obtenerToken).toHaveBeenCalledTimes(1);
    expect(e.soap.estadoEnvio).toHaveBeenCalledWith(TOKEN_SII, '76123456-0', '101');
    expect(e.consultasHechas()).toEqual([]);
    expect(e.envio(envio.id)).toMatchObject({
      estado_sii: 'EPR',
      glosa_sii: 'Envio Procesado',
      clasificacion: 'aceptado',
    });
    expect(e.historial.get(41)).toEqual(['enviado', 'aceptado']);
    expect(operaciones(e)[0]).toMatchObject({
      operacion: 'seguimiento',
      canal: 'soap',
      resultado: 'ok',
    });
  });

  it('SOAP con EPR y rechazos: no guarda el estado (no sabe qué documentos son) y lo anota', async () => {
    const envio = filaEnvio({ track_id: '101', canal: 'soap' });
    const e = escenarioSeguimiento({ envios: [envio], documentos: [filaDocumento(envio, 41)] });
    e.soap.estadoEnvio.mockResolvedValueOnce(
      new EstadoEnvio({
        trackId: '101',
        estado: 'EPR',
        glosa: 'Envio Procesado',
        informados: 2,
        aceptados: 1,
        rechazados: 1,
      }),
    );
    const r = await correr(e);
    expect(r).toMatchObject({ consultados: 0, errores: 1 });
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'REC', consultas: 1 });
    expect(e.consultas(envio.id)[0]).toMatchObject({
      estado_sii: 'EPR',
      rechazados: 1,
      error: TEXTO_SIN_DETALLE,
    });
    expect(e.historial.get(41)).toEqual(['enviado']);
  });
});

describe('ejecutarSeguimiento: secretos', () => {
  it('ni el token ni la clave del certificado aparecen en lo persistido, aunque el SII devuelva el token', async () => {
    const envios = [
      filaEnvio({ track_id: '101' }),
      filaEnvio({ track_id: '102' }),
      filaEnvio({ track_id: '103' }),
    ];
    const e = escenarioSeguimiento({
      envios,
      documentos: [filaDocumento(envios[0] as never, 41)],
      respuestas: {
        '101': {
          ...jsonEstado('EPR', { informados: 1, aceptados: 0, rechazados: 1 }, [
            {
              tipo: 39,
              folio: 41,
              estado: 'RCH',
              descripcion: `token ${TOKEN_SII}`,
              error: [
                {
                  seccion: 'x',
                  linea: 1,
                  nivel: 1,
                  codigo: 1,
                  descripcion: `TOKEN=${TOKEN_SII}`,
                  detalle: TOKEN_SII,
                },
              ],
            },
          ]),
          token: TOKEN_SII,
          nota: `Cookie: TOKEN=${TOKEN_SII}`,
          glosa: `eco ${TOKEN_SII}`,
        },
        '102': 'red',
        '103': { http: 500 },
      },
    });
    await correr(e);
    const todo = e.todoLoEscrito();
    expect(todo).not.toContain(TOKEN_SII);
    expect(todo).not.toContain(CLAVE_PFX);
    expect(todo).not.toMatch(/-----BEGIN/);
    expect(todo).not.toMatch(/"token"\s*:/i);
    // Lo que sí se guarda del SII sigue ahí.
    expect(e.falso.tabla('envio_rechazos')[0]).toMatchObject({ folio: 41, estado: 'RCH' });
  });
});
