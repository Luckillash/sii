import { describe, expect, it } from 'vitest';
import { CLAVE_PFX, USUARIO } from '../../../test/certificacion-prueba';
import { clienteBoletaRest } from '../sii/clientes';
import { consultarEnvio } from './consultar-envio';
import {
  AHORA,
  EMPRESA,
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

function consultar(e: EscenarioSeguimiento, envioId: unknown, organizacionId = ORG) {
  return consultarEnvio({ organizacionId, envioId: String(envioId), usuarioId: USUARIO }, e.deps);
}

const hace = (segundos: number) => new Date(AHORA.getTime() - segundos * 1000).toISOString();

/** Sin red, sin escrituras y sin operaciones. */
function nadaSalio(e: EscenarioSeguimiento) {
  expect(e.transporteFalso.enviadas).toEqual([]);
  expect(e.falso.escrituras).toEqual([]);
  expect(e.falso.tabla('operaciones_sii')).toEqual([]);
}

/** Sin signos de exclamación ni emoji, con título y detalle (design system). */
function conTono(mensaje: { titulo: string; detalle: string }) {
  expect(mensaje.titulo.length).toBeGreaterThan(0);
  expect(mensaje.detalle.length).toBeGreaterThan(0);
  expect(`${mensaje.titulo} ${mensaje.detalle}`).not.toMatch(/[!¡]|\p{Extended_Pictographic}/u);
}

describe('consultarEnvio', () => {
  it('consultado: consulta en el SII, guarda y devuelve el estado nuevo', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({
      envios: [envio],
      documentos: [filaDocumento(envio, 41)],
      respuestas: { '101': jsonEstado('EPR', { informados: 1, aceptados: 1 }) },
    });
    const r = await consultar(e, envio.id);
    expect(r).toEqual({
      tipo: 'consultado',
      estadoSii: 'EPR',
      glosaSii: null,
      clasificacion: 'aceptado',
      cambio: true,
    });
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'EPR', consultas: 1 });
    expect(e.consultas(envio.id)).toHaveLength(1);
    expect(e.historial.get(41)).toEqual(['enviado', 'aceptado']);
    expect(e.falso.tabla('operaciones_sii')).toEqual([
      expect.objectContaining({
        operacion: 'consultar_envio',
        resultado: 'ok',
        organizacion_id: ORG,
        empresa_id: EMPRESA,
        usuario_id: USUARIO,
        envio_id: envio.id,
        ambiente: 'certificacion',
        canal: 'rest',
        detalle: expect.objectContaining({ estado: 'EPR', cambio: true }),
      }),
    ]);
  });

  it('consultado sin cambio: el SII sigue en proceso', async () => {
    const envio = filaEnvio({
      track_id: '101',
      estado_sii: 'SOK',
      ultima_consulta_en: hace(600),
      consultas: 2,
    });
    const e = escenarioSeguimiento({ envios: [envio], respuestas: { '101': jsonEstado('SOK') } });
    expect(await consultar(e, envio.id)).toEqual({
      tipo: 'consultado',
      estadoSii: 'SOK',
      glosaSii: null,
      clasificacion: 'en_proceso',
      cambio: false,
    });
    expect(e.envio(envio.id)).toMatchObject({ consultas: 3 });
  });

  it('consultado hace menos de 30 s: devuelve lo guardado sin salir al SII', async () => {
    const envio = filaEnvio({
      track_id: '101',
      estado_sii: 'SOK',
      ultima_consulta_en: hace(10),
      consultas: 1,
    });
    const e = escenarioSeguimiento({ envios: [envio] });
    e.falso.tabla('consultas_envio').push({
      id: 1,
      organizacion_id: ORG,
      envio_id: envio.id,
      consultado_en: hace(10),
      estado_sii: 'SOK',
      error: null,
    });
    expect(await consultar(e, envio.id)).toEqual({
      tipo: 'consultado',
      estadoSii: 'SOK',
      glosaSii: null,
      clasificacion: 'en_proceso',
      cambio: false,
    });
    nadaSalio(e);
  });

  it('si la consulta de hace unos segundos falló, pide esperar sin volver a consultar', async () => {
    const envio = filaEnvio({ track_id: '101', ultima_consulta_en: hace(5), consultas: 1 });
    const e = escenarioSeguimiento({ envios: [envio] });
    e.falso.tabla('consultas_envio').push({
      id: 1,
      organizacion_id: ORG,
      envio_id: envio.id,
      consultado_en: hace(5),
      error: 'ErrorTransporte: Falló la conexión con apicert.sii.cl.',
    });
    const r = await consultar(e, envio.id);
    expect(r.tipo).toBe('error');
    if (r.tipo === 'error') {
      expect(r.mensaje.titulo).toBe('Consultamos hace unos segundos y el SII no respondió');
      conTono(r.mensaje);
    }
    nadaSalio(e);
  });

  it('sin_track_id: un envío incierto no se consulta (ni se reenvía)', async () => {
    const envio = filaEnvio({ track_id: null, estado_sii: null, incierto: true });
    const e = escenarioSeguimiento({ envios: [envio] });
    const r = await consultar(e, envio.id);
    expect(r.tipo).toBe('sin_track_id');
    if (r.tipo === 'sin_track_id') {
      expect(r.mensaje.titulo).toBe('Este envío no tiene Track ID');
      expect(r.mensaje.detalle).toContain('portal del SII');
      conTono(r.mensaje);
    }
    nadaSalio(e);
  });

  it('sin_track_id: un envío que falló antes de salir', async () => {
    const envio = filaEnvio({ track_id: null, estado_sii: null, error: 'falló antes' });
    const e = escenarioSeguimiento({ envios: [envio] });
    const r = await consultar(e, envio.id);
    expect(r.tipo).toBe('sin_track_id');
    if (r.tipo === 'sin_track_id') expect(r.mensaje.titulo).toBe('Este envío no llegó al SII');
    nadaSalio(e);
  });

  it.each([
    [{ estado_sii: 'EPR', informados: 1, aceptados: 1 }, 'aceptado'],
    [{ estado_sii: 'EPR', informados: 2, aceptados: 2, reparos: 1 }, 'aceptado_con_reparos'],
    [{ estado_sii: 'RSC' }, 'rechazado'],
  ])('final: %o → %s, sin volver a consultar', async (datos, clasificacion) => {
    const envio = filaEnvio({ track_id: '101', ...datos });
    const e = escenarioSeguimiento({ envios: [envio] });
    expect(await consultar(e, envio.id)).toEqual({ tipo: 'final', clasificacion });
    nadaSalio(e);
  });

  it('inconsistente: no es final, se consulta y puede cerrarse', async () => {
    const envio = filaEnvio({ track_id: '101', estado_sii: 'EPR', informados: 2, aceptados: 1 });
    expect(envio.clasificacion).toBe('inconsistente');
    const e = escenarioSeguimiento({
      envios: [envio],
      respuestas: { '101': jsonEstado('EPR', { informados: 2, aceptados: 2 }) },
    });
    expect(await consultar(e, envio.id)).toMatchObject({
      tipo: 'consultado',
      clasificacion: 'aceptado',
      cambio: true,
    });
  });

  it('si otra consulta lo cerró mientras tanto, devuelve `final` sin pisarlo', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({ envios: [envio], respuestas: { '101': jsonEstado('PRD') } });
    // El cron lo cierra justo cuando el SII responde la consulta del panel.
    const original = e.deps.rest;
    e.deps.rest = (c, o) => {
      const real = (original ?? clienteBoletaRest)(c, o);
      return {
        ...real,
        obtenerToken: (rut) => real.obtenerToken(rut),
        olvidarToken: (rut) => real.olvidarToken(rut),
        consultarEnvio: async (t, r, id) => {
          const estado = await real.consultarEnvio(t, r, id);
          Object.assign(e.envio(envio.id) as object, {
            estado_sii: 'RSC',
            clasificacion: 'rechazado',
          });
          return estado;
        },
      };
    };
    expect(await consultar(e, envio.id)).toEqual({ tipo: 'final', clasificacion: 'rechazado' });
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'RSC', consultas: 0 });
  });

  it('EPR con rechazos sin detalle por documento: error que pide revisar y emitir solo las rechazadas', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({
      envios: [envio],
      documentos: [filaDocumento(envio, 41)],
      respuestas: { '101': jsonEstado('EPR', { informados: 1, rechazados: 1 }) },
    });
    const r = await consultar(e, envio.id);
    expect(r.tipo).toBe('error');
    if (r.tipo === 'error') {
      expect(r.mensaje.titulo).toBe('El SII procesó el envío con rechazos o reparos');
      expect(r.mensaje.detalle).toContain('solo las boletas rechazadas');
      conTono(r.mensaje);
    }
    expect(e.envio(envio.id)).toMatchObject({ estado_sii: 'REC' });
    expect(e.historial.get(41)).toEqual(['enviado']);
  });

  it('error de red: mensaje del design system, bitácora con el error y operación `transporte`', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({ envios: [envio], respuestas: { '101': 'red' } });
    const r = await consultar(e, envio.id);
    expect(r.tipo).toBe('error');
    if (r.tipo === 'error') {
      expect(r.mensaje).toEqual({
        titulo: 'No pudimos consultar el estado en el SII',
        detalle:
          'El SII no respondió a la consulta del Track ID 101. Inténtalo de nuevo en unos minutos; el seguimiento automático también lo consulta cada 5 minutos.',
      });
      conTono(r.mensaje);
    }
    expect(e.consultas(envio.id)).toEqual([
      expect.objectContaining({ error: expect.stringContaining('ErrorTransporte') }),
    ]);
    expect(e.envio(envio.id)).toMatchObject({
      estado_sii: 'REC',
      consultas: 1,
      ultima_consulta_en: AHORA.toISOString(),
    });
    expect(e.falso.tabla('operaciones_sii')[0]).toMatchObject({
      operacion: 'consultar_envio',
      resultado: 'transporte',
      envio_id: envio.id,
    });
  });

  it('error del token: también queda en la bitácora del envío', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({ envios: [envio], tokenFallaEn: 'apicert.sii.cl' });
    const r = await consultar(e, envio.id);
    expect(r.tipo).toBe('error');
    expect(e.consultas(envio.id)[0]?.error).toContain('HTTP 500');
    expect(e.consultasHechas()).toEqual([]);
  });

  it('error de configuración (sin certificado): el mensaje dice qué hacer', async () => {
    const envio = filaEnvio({ track_id: '101', organizacion_id: ORG_2, empresa_id: EMPRESA_ORG_2 });
    const e = escenarioSeguimiento({ envios: [envio] });
    const r = await consultar(e, envio.id, ORG_2);
    expect(r.tipo).toBe('error');
    if (r.tipo === 'error') conTono(r.mensaje);
    expect(e.falso.tabla('operaciones_sii')[0]).toMatchObject({ resultado: 'config' });
    expect(e.transporteFalso.enviadas).toEqual([]);
  });

  it('un envío de otra organización no existe para esta', async () => {
    const ajeno = filaEnvio({ track_id: '101', organizacion_id: ORG_2, empresa_id: EMPRESA_ORG_2 });
    const e = escenarioSeguimiento({ envios: [ajeno] });
    const r = await consultar(e, ajeno.id, ORG);
    expect(r).toEqual({
      tipo: 'error',
      mensaje: {
        titulo: 'No encontramos el envío',
        detalle: 'Puede que ya no exista o que sea de otra organización. Recarga la página.',
      },
    });
    nadaSalio(e);
  });

  it('no deja el token ni la clave en lo persistido', async () => {
    const envio = filaEnvio({ track_id: '101' });
    const e = escenarioSeguimiento({
      envios: [envio],
      respuestas: { '101': { ...jsonEstado('REC'), glosa: `eco ${TOKEN_SII}`, token: TOKEN_SII } },
    });
    const r = await consultar(e, envio.id);
    expect(r).toMatchObject({ tipo: 'consultado', glosaSii: 'eco [FILTRADO]' });
    const todo = e.todoLoEscrito();
    expect(todo).not.toContain(TOKEN_SII);
    expect(todo).not.toContain(CLAVE_PFX);
  });
});
