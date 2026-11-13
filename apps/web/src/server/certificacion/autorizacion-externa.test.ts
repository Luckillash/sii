import { describe, expect, it } from 'vitest';
import type { ResultadoPaso } from '@/lib/certificacion';
import {
  DATOS_DECLARACION,
  EMPRESA,
  type Escenario,
  escenario,
  estadoDeclaracion,
  ORG,
} from '../../../test/certificacion-prueba';
import { MENSAJE_EMPRESA_AUTORIZADA } from './comun';
import { consultarEstadoDeclaracion, declarar, solicitarRevision } from './declaracion';
import { enviarSet } from './envio-set';
import { solicitarFoliosSet } from './folios';
import { leerAsistente } from './lectura';
import { postular } from './postulacion';
import { descargarSet } from './set';

// Empresa autorizada en producción fuera de Boletéame (migración 0009): el SII responde
// «sin trámite» a `obtenerEstadoAutorizaEmp`, la empresa registra su resolución de
// producción y el trigger la marca como autorizada. Los pasos ⚠️ de la certificación se
// niegan antes de salir al SII, y la consulta del estado sirve desde `borrador`.

const RESOLUCION_PRODUCCION = {
  id: 'res-prod',
  organizacion_id: ORG,
  empresa_id: EMPRESA,
  ambiente: 'produccion',
  numero: 80,
  fecha: '2014-08-22',
  vigente: true,
};

/** Escenario con la empresa autorizada como lo deja el trigger de la 0009. */
function autorizada(opciones: Parameters<typeof escenario>[0] = {}): Escenario {
  const e = escenario(opciones);
  const empresa = e.falso.tabla('empresas')[0];
  if (!empresa) throw new Error('sin empresa');
  empresa.autorizada_produccion = true;
  empresa.autorizada_en = '2026-11-13T14:00:00Z';
  return e;
}

/** Nada salió al SII y no se escribió nada (ni una fila en operaciones_sii). */
function sinEfectos(e: Escenario) {
  expect(e.transporteFalso.enviadas).toEqual([]);
  expect(e.falso.escrituras).toEqual([]);
  expect(e.falso.tabla('operaciones_sii')).toEqual([]);
  for (const cliente of [e.postulacion, e.declaracion, e.folios]) {
    for (const fn of Object.values(cliente)) expect(fn).not.toHaveBeenCalled();
  }
  expect(e.rest.obtenerToken).not.toHaveBeenCalled();
  expect(e.rest.enviarBoleta).not.toHaveBeenCalled();
}

function esCandado(r: ResultadoPaso) {
  expect(r).toMatchObject({
    tipo: 'error',
    motivo: 'empresa_autorizada',
    operacionId: null,
    mensaje: MENSAJE_EMPRESA_AUTORIZADA,
  });
}

type Paso = (e: Escenario, confirmada: boolean) => Promise<ResultadoPaso>;

const PASOS: [string, string, Paso][] = [
  ['postular', 'borrador', (e, c) => postular(e.ctx, { confirmada: c }, e.deps)],
  [
    'descargarSet',
    'postulada',
    (e, c) => descargarSet(e.ctx, { confirmada: c, correoProveedorSet: 'sw@proveedor.cl' }, e.deps),
  ],
  [
    'solicitarFoliosSet',
    'set_descargado',
    (e, c) => solicitarFoliosSet(e.ctx, { confirmada: c }, e.deps),
  ],
  ['enviarSet', 'set_descargado', (e, c) => enviarSet(e.ctx, { confirmada: c }, e.deps)],
  [
    'solicitarRevision',
    'set_aceptado',
    (e, c) => solicitarRevision(e.ctx, { confirmada: c }, e.deps),
  ],
  ['declarar', 'por_declarar', (e, c) => declarar(e.ctx, { confirmada: c }, e.deps)],
];

describe('candado: empresa ya autorizada en producción', () => {
  for (const [nombre, etapa, paso] of PASOS) {
    for (const confirmada of [false, true]) {
      it(`${nombre} (${confirmada ? 'confirmada' : 'ensayo'}) se niega sin salir al SII ni registrar nada`, async () => {
        const e = autorizada({ etapa, proceso: DATOS_DECLARACION });
        const r = await paso(e, confirmada);
        esCandado(r);
        sinEfectos(e);
        expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe(etapa);
      });
    }
  }

  it('el mensaje dice qué pasó y qué hacer, en el tono del design system', () => {
    expect(MENSAJE_EMPRESA_AUTORIZADA.titulo).toBe('La empresa ya está autorizada en producción');
    expect(MENSAJE_EMPRESA_AUTORIZADA.detalle).toContain('No hace falta certificarla');
    expect(MENSAJE_EMPRESA_AUTORIZADA.detalle).not.toContain('!');
  });

  it('sin la empresa autorizada, el ensayo de postular sigue igual', async () => {
    const e = escenario({ etapa: 'borrador' });
    const r = await postular(e.ctx, { confirmada: false }, e.deps);
    expect(r.tipo).toBe('ensayo');
  });
});

describe('consultarEstadoDeclaracion desde borrador y sin proceso', () => {
  it('sin proceso y «sin trámite»: crea el proceso en borrador y explica cómo seguir', async () => {
    const e = escenario({ proceso: null });
    const r = await consultarEstadoDeclaracion(e.ctx, e.deps);
    expect(r).toMatchObject({
      tipo: 'ok',
      mensaje: { titulo: 'El SII no tiene una certificación en curso para la empresa' },
    });
    if (r.tipo === 'ok') {
      expect(r.mensaje.detalle).toContain('registra su resolución de producción');
      expect(r.mensaje.detalle).toContain('postula');
    }
    const procesos = e.falso.tabla('procesos_certificacion');
    expect(procesos).toHaveLength(1);
    expect(procesos[0]).toMatchObject({
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      etapa: 'borrador',
      codigo_estado_sii: null,
      estado_consultado_en: '2026-11-13T15:00:00.000Z',
    });
    expect(e.falso.tabla('operaciones_sii')[0]).toMatchObject({
      operacion: 'estado_declaracion',
      resultado: 'ok',
    });
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });

  it('en borrador con proceso y «sin trámite»: mismo mensaje, sin cambiar la etapa', async () => {
    const e = escenario({ etapa: 'borrador' });
    const r = await consultarEstadoDeclaracion(e.ctx, e.deps);
    expect(r).toMatchObject({
      tipo: 'ok',
      mensaje: { titulo: 'El SII no tiene una certificación en curso para la empresa' },
    });
    expect(e.falso.tabla('procesos_certificacion')).toHaveLength(1);
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('borrador');
  });

  it('«sin trámite» con la resolución de producción registrada: confirma que ya está autorizada', async () => {
    const e = autorizada({ proceso: null, tablas: { resoluciones: [RESOLUCION_PRODUCCION] } });
    const r = await consultarEstadoDeclaracion(e.ctx, e.deps);
    expect(r).toMatchObject({
      tipo: 'ok',
      mensaje: { titulo: 'La empresa ya está autorizada en producción' },
    });
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('borrador');
  });

  it('sin proceso y P90: lo crea y el trigger lo deja por_declarar', async () => {
    const e = escenario({ proceso: null });
    e.declaracion.estado.mockResolvedValueOnce(
      estadoDeclaracion('P90', 'Por declarar cumplimiento', 90),
    );
    const r = await consultarEstadoDeclaracion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') expect(r.mensaje.titulo).toContain('P90');
    expect(e.falso.tabla('procesos_certificacion')[0]).toMatchObject({
      etapa: 'por_declarar',
      codigo_estado_sii: 'P90',
    });
    expect(e.correo.enviar).toHaveBeenCalledTimes(1);
  });

  it('en borrador y P91: el trigger deja la empresa autorizada', async () => {
    const e = escenario({ etapa: 'borrador' });
    e.declaracion.estado.mockResolvedValueOnce(estadoDeclaracion('P91', 'Autorizada', 91));
    const r = await consultarEstadoDeclaracion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') expect(r.mensaje.titulo).toContain('P91');
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('autorizada');
    expect(e.falso.tabla('empresas')[0]?.autorizada_produccion).toBe(true);
  });

  it('si el SII falla, no crea el proceso', async () => {
    const e = escenario({ proceso: null });
    e.declaracion.estado.mockRejectedValueOnce(new Error('falla inesperada'));
    const r = await consultarEstadoDeclaracion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'error' });
    expect(e.falso.tabla('procesos_certificacion')).toEqual([]);
  });

  it('sin certificado no sale al SII ni crea el proceso', async () => {
    const e = escenario({ proceso: null, tablas: { empresa_certificados: [] } });
    const r = await consultarEstadoDeclaracion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'error', operacionId: null });
    sinEfectos(e);
  });

  it('en etapas posteriores mantiene el mensaje de siempre', async () => {
    const e = escenario({ etapa: 'postulada' });
    const r = await consultarEstadoDeclaracion(e.ctx, e.deps);
    expect(r).toMatchObject({
      tipo: 'ok',
      mensaje: { titulo: 'Consultamos el estado de la declaración' },
    });
  });
});

describe('leerAsistente: autorización externa', () => {
  it('empresa autorizada sin P91 en el asistente: autorizacionExterna y la resolución de producción', async () => {
    const e = autorizada({ proceso: null, tablas: { resoluciones: [RESOLUCION_PRODUCCION] } });
    const v = await leerAsistente(ORG, EMPRESA, e.deps);
    expect(v).toMatchObject({
      empresa: { autorizadaProduccion: true },
      proceso: null,
      autorizacionExterna: true,
      resolucionProduccion: { numero: 80, fecha: '2014-08-22' },
      resolucionCertificacion: null,
    });
  });

  it('también con un proceso a medio camino (borrador)', async () => {
    const e = autorizada({ etapa: 'borrador', tablas: { resoluciones: [RESOLUCION_PRODUCCION] } });
    const v = await leerAsistente(ORG, EMPRESA, e.deps);
    expect(v?.autorizacionExterna).toBe(true);
  });

  it('autorizada por P91 en el asistente: no es externa', async () => {
    const e = autorizada({ etapa: 'autorizada', proceso: { codigo_estado_sii: 'P91' } });
    const v = await leerAsistente(ORG, EMPRESA, e.deps);
    expect(v).toMatchObject({ autorizacionExterna: false, resolucionProduccion: null });
  });

  it('sin autorizar: no es externa', async () => {
    const e = escenario({ etapa: 'postulada' });
    const v = await leerAsistente(ORG, EMPRESA, e.deps);
    expect(v?.autorizacionExterna).toBe(false);
  });

  it('el Supabase falso imita el trigger: registrar la resolución de producción autoriza', async () => {
    const e = escenario({ proceso: null });
    await e.falso.cliente.rpc('registrar_resolucion', {
      p_empresa: EMPRESA,
      p_ambiente: 'certificacion',
      p_numero: 0,
      p_fecha: '2026-11-10',
    });
    expect(e.falso.tabla('empresas')[0]?.autorizada_produccion).toBe(false);
    await e.falso.cliente.rpc('registrar_resolucion', {
      p_empresa: EMPRESA,
      p_ambiente: 'produccion',
      p_numero: 80,
      p_fecha: '2014-08-22',
    });
    expect(e.falso.tabla('empresas')[0]?.autorizada_produccion).toBe(true);
    const v = await leerAsistente(ORG, EMPRESA, e.deps);
    expect(v?.autorizacionExterna).toBe(true);
  });
});
