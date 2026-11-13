import { DeclaracionInciertaError, SetSinDescargarError } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import {
  COOKIE_SII,
  DATOS_DECLARACION,
  EMPRESA,
  escenario,
  estadoDeclaracion,
  ORG,
  operacionDe,
  RUT_EMPRESA,
  todoLoEscrito,
} from '../../../test/certificacion-prueba';
import { consultarEstadoDeclaracion, declarar, solicitarRevision } from './declaracion';

const ENVIO = '88888888-8888-4888-8888-888888888888';

function conEnvioAceptado(etapa = 'set_aceptado') {
  return escenario({
    etapa,
    proceso: { envio_set_id: ENVIO, ...DATOS_DECLARACION },
    tablas: {
      envios: [
        {
          id: ENVIO,
          organizacion_id: ORG,
          empresa_id: EMPRESA,
          ambiente: 'certificacion',
          proposito: 'set_pruebas',
          track_id: '123456789',
          clasificacion: 'aceptado',
          estado_sii: 'EPR',
        },
      ],
    },
  });
}

describe('solicitarRevision', () => {
  it('ensayo con el Track ID del envío aceptado, sin salir al SII', async () => {
    const e = conEnvioAceptado();
    const r = await solicitarRevision(e.ctx, { confirmada: false }, e.deps);
    expect(r.tipo).toBe('ensayo');
    if (r.tipo === 'ensayo') {
      expect(r.resumen.filas).toContainEqual({
        etiqueta: 'Track ID del envío',
        valor: '123456789',
      });
    }
    expect(e.falso.escrituras).toEqual([]);
  });

  it('sin set aceptado no se pide', async () => {
    const e = conEnvioAceptado('set_enviado');
    const r = await solicitarRevision(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'uso' });
    expect(e.declaracion.solicitarRevisionSet).not.toHaveBeenCalled();
  });

  it('confirmada: pide la revisión y deja revision_solicitada', async () => {
    const e = conEnvioAceptado();
    const r = await solicitarRevision(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    expect(e.declaracion.solicitarRevisionSet.mock.calls[0]?.slice(1)).toEqual([
      RUT_EMPRESA,
      '123456789',
    ]);
    expect(e.falso.tabla('procesos_certificacion')[0]).toMatchObject({
      etapa: 'revision_solicitada',
      revision_solicitada_en: '2026-11-13T15:00:00.000Z',
    });
    expect(e.falso.tabla('operaciones_sii')[0]).toMatchObject({
      operacion: 'solicitar_revision',
      resultado: 'ok',
    });
    expect(e.correo.enviar).toHaveBeenCalledTimes(1);
  });

  it('SetSinDescargarError: rechazo_sii con la indicación de qué hacer', async () => {
    const e = conEnvioAceptado();
    e.declaracion.solicitarRevisionSet.mockRejectedValueOnce(
      new SetSinDescargarError(
        'El SII no acepta revisar el envío: primero hay que descargar el set de prueba de boletas.',
      ),
    );
    const r = await solicitarRevision(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'rechazo_sii' });
    if (r.tipo === 'error') {
      expect(r.mensaje.detalle).toContain('descarga un set de pruebas nuevo');
      expect(r.mensaje.detalle).toContain('Track ID de ese envío');
    }
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('set_aceptado');
  });
});

describe('consultarEstadoDeclaracion', () => {
  it('P90: guarda el estado y el trigger deja por_declarar', async () => {
    const e = escenario({ etapa: 'revision_solicitada' });
    e.declaracion.estado.mockResolvedValueOnce(
      estadoDeclaracion('P90', 'Por declarar cumplimiento', 90),
    );
    const r = await consultarEstadoDeclaracion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') expect(r.mensaje.titulo).toContain('P90');
    expect(e.falso.tabla('procesos_certificacion')[0]).toMatchObject({
      etapa: 'por_declarar',
      codigo_estado_sii: 'P90',
      glosa_estado_sii: 'Por declarar cumplimiento',
      paso_sii: 90,
      estado_consultado_en: '2026-11-13T15:00:00.000Z',
    });
    expect(e.falso.tabla('operaciones_sii')[0]).toMatchObject({
      operacion: 'estado_declaracion',
      resultado: 'ok',
    });
    expect(e.correo.enviar).toHaveBeenCalledTimes(1);
    expect(todoLoEscrito(e)).not.toContain(COOKIE_SII);
  });

  it('sin trámite pendiente: lo informa sin cambiar la etapa ni avisar', async () => {
    const e = escenario({ etapa: 'revision_solicitada' });
    const r = await consultarEstadoDeclaracion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') expect(r.mensaje.detalle).toContain('no muestra un trámite pendiente');
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('revision_solicitada');
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });
});

describe('declarar', () => {
  it('ensayo: advierte que autoriza en producción, sin salir al SII', async () => {
    const e = escenario({ etapa: 'por_declarar', proceso: DATOS_DECLARACION });
    const r = await declarar(e.ctx, { confirmada: false }, e.deps);
    expect(r.tipo).toBe('ensayo');
    if (r.tipo === 'ensayo') expect(r.resumen.avisos[0]).toContain('AUTORIZADA EN PRODUCCIÓN');
    expect(e.falso.escrituras).toEqual([]);
    expect(e.declaracion.verificarPortal).not.toHaveBeenCalled();
  });

  it('fuera de P90 no se declara', async () => {
    const e = escenario({ etapa: 'revision_solicitada', proceso: DATOS_DECLARACION });
    const r = await declarar(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'uso' });
    expect(e.falso.tabla('operaciones_sii')).toEqual([]);
  });

  it('sin los datos de la declaración: uso', async () => {
    const e = escenario({ etapa: 'por_declarar' });
    const r = await declarar(e.ctx, { confirmada: false }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'uso' });
  });

  it('confirmada: verifica el portal, declara y queda autorizada (P91)', async () => {
    const e = escenario({
      etapa: 'por_declarar',
      proceso: { ...DATOS_DECLARACION, codigo_estado_sii: 'P90' },
    });
    const r = await declarar(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    expect(e.falso.tabla('operaciones_sii').map((o) => [o.operacion, o.resultado])).toEqual([
      ['verificar_portal', 'ok'],
      ['declarar', 'ok'],
    ]);
    const datos = e.declaracion.declarar.mock.calls[0]?.[1];
    expect(datos?.linkConsulta).toBe('https://www.empresa.cl/boletas');
    expect(e.falso.tabla('procesos_certificacion')[0]).toMatchObject({
      etapa: 'autorizada',
      codigo_estado_sii: 'P91',
      declarada_en: '2026-11-13T15:00:00.000Z',
    });
    expect(e.falso.tabla('empresas')[0]?.autorizada_produccion).toBe(true);
    expect(e.correo.enviar).toHaveBeenCalledTimes(1);
  });

  it('DeclaracionInciertaError: incierto con la indicación, y bloquea declarar otra vez', async () => {
    const e = escenario({ etapa: 'por_declarar', proceso: DATOS_DECLARACION });
    e.declaracion.declarar.mockRejectedValueOnce(new DeclaracionInciertaError(RUT_EMPRESA));
    const r = await declarar(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    if (r.tipo === 'error')
      expect(r.mensaje.detalle).toContain('consulta antes el estado de la declaración');
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('por_declarar');

    const otra = await declarar(e.ctx, { confirmada: true }, e.deps);
    expect(otra).toMatchObject({
      tipo: 'error',
      motivo: 'incierto_sin_revisar',
      operacionPendienteId: operacionDe(r),
    });
    expect(e.declaracion.declarar).toHaveBeenCalledTimes(1);
  });

  it('portal cambiado: verificacion_fallida y no declara', async () => {
    const e = escenario({ etapa: 'por_declarar', proceso: DATOS_DECLARACION });
    e.declaracion.verificarPortal.mockResolvedValueOnce(['falta método autorizarEmpresaBolProd']);
    const r = await declarar(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'verificacion_fallida' });
    expect(e.declaracion.declarar).not.toHaveBeenCalled();
  });
});
