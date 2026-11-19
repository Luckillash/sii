import {
  ErrorSolicitudFolios,
  FolioInicialRequeridoError,
  FoliosSinCafError,
} from '@winex/certificacion';
import { describe, expect, it, vi } from 'vitest';
import { cafPrueba } from '../../../test/caf-prueba';
import {
  COOKIE_SII,
  EMPRESA,
  ORG,
  todoLoEscrito,
  USUARIO,
} from '../../../test/certificacion-prueba';
import { escenarioFolios, filaCaf, revisionQueAsigna } from '../../../test/folios-prueba';
import { PASO_TIMBRAR } from './sii';
import { type OpcionesSolicitud, solicitarFolios } from './solicitar';

const BASE: OpcionesSolicitud = {
  nivel: 'ensayo',
  tipoDte: 39,
  ambiente: 'certificacion',
  cantidad: 20,
};

function cafBuffer(opciones: Parameters<typeof cafPrueba>[0]) {
  const { xml, rsask } = cafPrueba(opciones);
  return { caf: Buffer.from(xml, 'latin1'), rsask };
}

describe('solicitarFolios: ensayo local', () => {
  it('devuelve el resumen sin red, sin filas y sin operación', async () => {
    const e = escenarioFolios({
      tablas: {
        cafs: [
          filaCaf({
            id: 'c1',
            ambiente: 'certificacion',
            idk: 100,
            folio_desde: 1,
            folio_hasta: 10,
            siguiente_folio: 4,
          }),
        ],
      },
    });
    const r = await solicitarFolios(e.ctx, BASE, e.deps);
    expect(r.tipo).toBe('ensayo');
    if (r.tipo !== 'ensayo') return;
    expect(r.resumen).toMatchObject({
      ambiente: 'certificacion',
      tipoDte: 39,
      cantidad: 20,
      revisionObligatoria: false,
      textoConfirmar: 'Timbrar folios',
    });
    expect(r.resumen.filas).toContainEqual({ etiqueta: 'Folios disponibles hoy', valor: '7' });
    expect(r.resumen.filas).toContainEqual({ etiqueta: 'Ambiente', valor: 'Certificación' });
    expect(r.resumen.certificado.rut).toBe('12345678-5');
    expect(e.falso.escrituras).toEqual([]);
    expect(e.folios.autenticar).not.toHaveBeenCalled();
    expect(e.transporteFalso.enviadas).toEqual([]);
  });

  it('en producción avisa que los folios son reales y exige revisar antes', async () => {
    const e = escenarioFolios();
    const r = await solicitarFolios(
      e.ctx,
      { ...BASE, ambiente: 'produccion', tipoDte: 41 },
      e.deps,
    );
    if (r.tipo !== 'ensayo') throw new Error('se esperaba el ensayo');
    expect(r.resumen.revisionObligatoria).toBe(true);
    expect(r.resumen.textoConfirmar).toBe('Revisar con el SII');
    expect(r.resumen.avisos.join(' ')).toContain('Los folios de producción son reales');
    expect(r.resumen.filas).toContainEqual({
      etiqueta: 'Tipo de documento',
      valor: 'Boleta exenta electrónica (41)',
    });
  });

  it('producción sin autorización: error de uso, sin salir al SII ni dejar filas', async () => {
    const e = escenarioFolios({ autorizada: false });
    for (const nivel of ['ensayo', 'revision', 'timbrar'] as const) {
      const r = await solicitarFolios(e.ctx, { ...BASE, nivel, ambiente: 'produccion' }, e.deps);
      expect(r).toMatchObject({ tipo: 'error', motivo: 'sin_autorizacion', operacionId: null });
    }
    expect(e.falso.escrituras).toEqual([]);
    expect(e.folios.autenticar).not.toHaveBeenCalled();
  });

  it('producción con un plan sin producción (o sin plan): error de uso', async () => {
    for (const plan of ['sin_produccion', 'ninguno'] as const) {
      const e = escenarioFolios({ plan });
      const r = await solicitarFolios(
        e.ctx,
        { ...BASE, nivel: 'timbrar', ambiente: 'produccion' },
        e.deps,
      );
      expect(r).toMatchObject({ tipo: 'error', motivo: 'plan_sin_produccion' });
      if (r.tipo === 'error') expect(r.mensaje.titulo).toBe('Tu plan no incluye producción');
      expect(e.falso.escrituras).toEqual([]);
    }
  });

  it('sin certificado de representante electrónico: config, sin filas', async () => {
    const e = escenarioFolios();
    const asociacion = e.falso.tabla('empresa_certificados')[0];
    if (asociacion) asociacion.es_representante_electronico = false;
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'timbrar' }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'config' });
    if (r.tipo === 'error') expect(r.mensaje.titulo).toContain('representante electrónico');
    expect(e.falso.escrituras).toEqual([]);
  });

  it('rechaza cantidades fuera de 1–10.000 y tipos que no son boleta', async () => {
    const e = escenarioFolios();
    for (const cantidad of [0, 10_001, 2.5]) {
      const r = await solicitarFolios(e.ctx, { ...BASE, cantidad }, e.deps);
      expect(r).toMatchObject({ tipo: 'error', motivo: 'uso' });
    }
    const r = await solicitarFolios(e.ctx, { ...BASE, tipoDte: 33 as unknown as 39 }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'tipo_no_permitido' });
  });
});

describe('solicitarFolios: revisión con el SII', () => {
  function operacionPrevia(resultado: string, iniciadaEn: string, ambiente = 'certificacion') {
    return {
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      operacion: 'solicitar_folios',
      ambiente,
      confirmada: true,
      resultado,
      detalle: {},
      iniciada_en: iniciadaEn,
    };
  }

  it('no sale al SII con un incierto sin revisar de la misma empresa y ambiente', async () => {
    const e = escenarioFolios({
      tablas: { operaciones_sii: [operacionPrevia('incierto', '2026-11-13T14:00:00Z')] },
    });
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'revision' }, e.deps);
    expect(r).toMatchObject({
      tipo: 'error',
      motivo: 'incierto_sin_revisar',
      operacionId: null,
      operacionPendienteId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });
    expect(e.folios.autenticar).not.toHaveBeenCalled();
    expect(e.falso.escrituras).toEqual([]);
    // Otro ambiente no está bloqueado.
    revisionQueAsigna(e, 1, 20);
    const otra = await solicitarFolios(
      e.ctx,
      { ...BASE, nivel: 'revision', ambiente: 'produccion' },
      e.deps,
    );
    expect(otra.tipo).toBe('revision');
  });

  it('no sale al SII con una confirmada en curso reciente (y sí con una abandonada revisada)', async () => {
    const e = escenarioFolios({
      tablas: { operaciones_sii: [operacionPrevia('en_curso', '2026-11-13T14:55:00Z')] },
    });
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'revision' }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'en_curso' });
    expect(e.folios.autenticar).not.toHaveBeenCalled();

    const revisada = escenarioFolios({
      tablas: {
        operaciones_sii: [
          {
            ...operacionPrevia('incierto', '2026-11-13T14:00:00Z'),
            detalle: { revisada_en: '2026-11-13T14:30:00Z' },
          },
        ],
      },
    });
    revisionQueAsigna(revisada, 1, 20);
    const ok = await solicitarFolios(revisada.ctx, { ...BASE, nivel: 'revision' }, revisada.deps);
    expect(ok.tipo).toBe('revision');
  });

  it('confirma la sesión con Auth antes de salir al SII', async () => {
    const e = escenarioFolios();
    e.deps.operacion = { ...e.deps.operacion, confirmarSesion: async () => false };
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'revision' }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'sesion_invalida' });
    expect(e.folios.autenticar).not.toHaveBeenCalled();
    expect(e.falso.escrituras).toEqual([]);
  });

  it('el transporte de la revisión corta también of_genera_archivo y rutas desconocidas', async () => {
    const e = escenarioFolios();
    e.folios.solicitar.mockImplementationOnce(async () => {
      const transporte = e.opcionesFolios.at(-1)?.transporte;
      await transporte?.enviar({
        metodo: 'POST',
        url: 'https://maullin.sii.cl/cvc_cgi/dte/of_genera_archivo',
      });
      throw new Error('salió');
    });
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'revision' }, e.deps);
    expect(r.tipo).toBe('error');
    expect(e.transporteFalso.enviadas).toEqual([]);
    expect(e.falso.tabla('cafs')).toEqual([]);
  });

  it('corta la orden de timbrar, deja la solicitud simulada con el rango y muestra el mensaje', async () => {
    const e = escenarioFolios();
    revisionQueAsigna(e, 101, 120);
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'revision' }, e.deps);
    expect(r.tipo).toBe('revision');
    if (r.tipo !== 'revision') return;
    expect(r.mensaje.titulo).toBe('El SII asignaría los folios 101 a 120');
    expect(r.mensaje.detalle).toContain('no se timbraron');
    expect(r.revision).toMatchObject({ desde: 101, hasta: 120, cantidad: 20, tipoDte: 39 });

    const [solicitud] = e.falso.tabla('solicitudes_folios');
    expect(solicitud).toMatchObject({
      id: r.revision.revisionId,
      estado: 'simulada',
      confirmada: false,
      folio_desde: 101,
      folio_hasta: 120,
      solicitado_por: USUARIO,
    });
    const [op] = e.falso.tabla('operaciones_sii');
    expect(op).toMatchObject({
      operacion: 'solicitar_folios',
      confirmada: false,
      resultado: 'ok',
      ambiente: 'certificacion',
      solicitud_id: solicitud?.id,
    });
    expect(op?.detalle).toMatchObject({ nivel: 'revision', folio_desde: 101, folio_hasta: 120 });
    expect(e.falso.tabla('cafs')).toEqual([]);
    // La orden de timbrar no llegó al transporte real.
    expect(e.transporteFalso.enviadas.map((p) => p.url).join()).not.toContain(PASO_TIMBRAR);
    expect(e.opcionesFolios[0]?.ambiente).toBe('certificacion');
  });

  it('en producción usa palena (ambiente produccion) y su sesión', async () => {
    const e = escenarioFolios();
    revisionQueAsigna(e, 1, 50);
    const r = await solicitarFolios(
      e.ctx,
      { ...BASE, nivel: 'revision', ambiente: 'produccion', cantidad: 50 },
      e.deps,
    );
    expect(r.tipo).toBe('revision');
    expect(e.opcionesFolios[0]?.ambiente).toBe('produccion');
    expect([...e.sesiones.mapa.keys()][0]).toContain(':produccion');
    expect(e.falso.tabla('operaciones_sii')[0]).toMatchObject({ ambiente: 'produccion' });
  });

  it('un rechazo del SII en la revisión deja la solicitud rechazada', async () => {
    const e = escenarioFolios();
    e.folios.solicitar.mockRejectedValueOnce(new ErrorSolicitudFolios('Usted no tiene permisos.'));
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'revision' }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'rechazo_sii' });
    expect(e.falso.tabla('solicitudes_folios')[0]).toMatchObject({
      estado: 'rechazada',
      confirmada: false,
    });
  });

  it('folio inicial requerido también en la revisión', async () => {
    const e = escenarioFolios();
    e.folios.solicitar.mockRejectedValueOnce(new FolioInicialRequeridoError('certificacion', '1'));
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'revision' }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', requiere: { folioInicial: { sugerido: '1' } } });
  });
});

describe('solicitarFolios: timbrar', () => {
  it('certificación: timbra sin revisión, guarda el CAF en Vault y en cafs, solicitud timbrada', async () => {
    const e = escenarioFolios();
    const { caf, rsask } = cafBuffer({ desde: 1, hasta: 20 });
    e.folios.solicitar.mockResolvedValueOnce(caf);
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'timbrar' }, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') expect(r.mensaje.detalle).toContain('folios 1 a 20 en certificación');
    expect(e.folios.solicitar.mock.calls[0]?.slice(1)).toEqual(['76123456-0', 39, 20, {}]);
    const [solicitud] = e.falso.tabla('solicitudes_folios');
    const [fila] = e.falso.tabla('cafs');
    expect(solicitud).toMatchObject({ estado: 'timbrada', confirmada: true, caf_id: fila?.id });
    expect(fila).toMatchObject({ siguiente_folio: 1, folio_desde: 1, folio_hasta: 20 });
    expect(e.falso.secretos.get(String(fila?.caf_secret_id))).toContain('<RSASK>');
    expect(e.falso.tabla('operaciones_sii')[0]).toMatchObject({
      resultado: 'ok',
      confirmada: true,
    });
    const escrito = todoLoEscrito(e) + JSON.stringify(r);
    expect(escrito).not.toContain('RSASK');
    expect(escrito).not.toContain(rsask.split('\n')[1]);
    expect(escrito).not.toContain(COOKIE_SII);
  });

  it('producción sin revisión previa: no timbra ni deja filas', async () => {
    const e = escenarioFolios();
    const r = await solicitarFolios(
      e.ctx,
      { ...BASE, nivel: 'timbrar', ambiente: 'produccion' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', motivo: 'revision_requerida', operacionId: null });
    expect(e.falso.escrituras).toEqual([]);
  });

  it('producción: revisión y luego timbraje con la misma cantidad; la revisión sirve una sola vez', async () => {
    const e = escenarioFolios();
    const op: OpcionesSolicitud = { ...BASE, ambiente: 'produccion', cantidad: 50 };
    revisionQueAsigna(e, 1, 50);
    const rev = await solicitarFolios(e.ctx, { ...op, nivel: 'revision' }, e.deps);
    if (rev.tipo !== 'revision') throw new Error('se esperaba la revisión');

    // Otra cantidad no sirve con esa revisión.
    const otra = await solicitarFolios(
      e.ctx,
      { ...op, nivel: 'timbrar', cantidad: 60, revisionId: rev.revision.revisionId },
      e.deps,
    );
    expect(otra).toMatchObject({ tipo: 'error', motivo: 'revision_requerida' });

    const { caf } = cafBuffer({ desde: 1, hasta: 50, idk: 300 });
    e.folios.solicitar.mockResolvedValueOnce(caf);
    const r = await solicitarFolios(
      e.ctx,
      { ...op, nivel: 'timbrar', revisionId: rev.revision.revisionId },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'ok' });
    expect(e.falso.tabla('cafs')[0]).toMatchObject({ ambiente: 'produccion', idk: 300 });

    const repetida = await solicitarFolios(
      e.ctx,
      { ...op, nivel: 'timbrar', revisionId: rev.revision.revisionId },
      e.deps,
    );
    expect(repetida).toMatchObject({ tipo: 'error', motivo: 'revision_usada' });
    expect(e.folios.solicitar).toHaveBeenCalledTimes(2);
  });

  it('avisa si el SII asignó al timbrar otro rango que el de la revisión', async () => {
    const e = escenarioFolios();
    const op: OpcionesSolicitud = { ...BASE, ambiente: 'produccion', cantidad: 10 };
    revisionQueAsigna(e, 1, 10);
    const rev = await solicitarFolios(e.ctx, { ...op, nivel: 'revision' }, e.deps);
    if (rev.tipo !== 'revision') throw new Error('se esperaba la revisión');
    e.folios.solicitar.mockResolvedValueOnce(cafBuffer({ desde: 11, hasta: 20, idk: 300 }).caf);
    const r = await solicitarFolios(
      e.ctx,
      { ...op, nivel: 'timbrar', revisionId: rev.revision.revisionId },
      e.deps,
    );
    expect(r.tipo).toBe('ok');
    if (r.tipo === 'ok') expect(r.avisos?.[0]).toContain('al timbrar asignó 11 a 20');
  });

  it('folio inicial requerido: rechazo_sii con el valor sugerido, sin CAF', async () => {
    const e = escenarioFolios();
    e.folios.solicitar.mockRejectedValueOnce(new FolioInicialRequeridoError('certificacion', '7'));
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'timbrar' }, e.deps);
    expect(r).toMatchObject({
      tipo: 'error',
      resultado: 'rechazo_sii',
      requiere: { folioInicial: { sugerido: '7' } },
    });
    expect(e.falso.tabla('solicitudes_folios')[0]).toMatchObject({ estado: 'rechazada' });
    expect(e.falso.tabla('cafs')).toEqual([]);

    // Con el folio inicial, la librería lo recibe.
    e.folios.solicitar.mockResolvedValueOnce(cafBuffer({ desde: 7, hasta: 26 }).caf);
    const otra = await solicitarFolios(
      e.ctx,
      { ...BASE, nivel: 'timbrar', folioInicial: 7 },
      e.deps,
    );
    expect(otra.tipo).toBe('ok');
    expect(e.folios.solicitar.mock.calls[1]?.[4]).toEqual({ folioInicial: 7 });
  });

  it('rechazo del SII al timbrar: solicitud rechazada', async () => {
    const e = escenarioFolios();
    e.folios.solicitar.mockRejectedValueOnce(
      new ErrorSolicitudFolios('El SII rechazó la solicitud de folios. (SII: excede el máximo)'),
    );
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'timbrar' }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'rechazo_sii' });
    expect(e.falso.tabla('solicitudes_folios')[0]).toMatchObject({ estado: 'rechazada' });
  });

  it('FoliosSinCafError: incierto con el rango y bloquea repetir hasta revisar', async () => {
    const e = escenarioFolios();
    e.folios.solicitar.mockRejectedValueOnce(
      new FoliosSinCafError(21, 40, 'certificacion', 'maullin.sii.cl'),
    );
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'timbrar' }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    expect(e.falso.tabla('solicitudes_folios')[0]).toMatchObject({
      estado: 'incierta',
      folio_desde: 21,
      folio_hasta: 40,
    });
    const otra = await solicitarFolios(e.ctx, { ...BASE, nivel: 'timbrar' }, e.deps);
    expect(otra).toMatchObject({ tipo: 'error', motivo: 'incierto_sin_revisar' });
    if (otra.tipo === 'error') expect(otra.operacionPendienteId).toBeTruthy();
    expect(e.folios.solicitar).toHaveBeenCalledTimes(1);
  });

  it('CAF timbrado que no se pudo guardar: incierto con el rango y la guía para subirlo', async () => {
    const e = escenarioFolios();
    e.folios.solicitar.mockResolvedValueOnce(cafBuffer({ desde: 1, hasta: 5 }).caf);
    e.falso.fallas.set('rpc:registrar_caf', { code: 'XX000', message: 'caído' });
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'timbrar' }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('súbelo en Folios (CAF)');
    expect(e.falso.tabla('solicitudes_folios')[0]).toMatchObject({
      estado: 'incierta',
      folio_desde: 1,
      folio_hasta: 5,
    });
    expect(e.falso.tabla('operaciones_sii')[0]?.detalle).not.toHaveProperty('incierto_motivo');
  });

  it('traslape 23P01 al guardar el CAF timbrado: incierto con mensaje propio, sin proponer subirlo', async () => {
    const e = escenarioFolios({
      tablas: {
        cafs: [
          filaCaf({
            id: 'c1',
            ambiente: 'certificacion',
            idk: 100,
            folio_desde: 5,
            folio_hasta: 30,
          }),
        ],
      },
    });
    const { caf, rsask } = cafBuffer({ desde: 10, hasta: 29 });
    e.folios.solicitar.mockResolvedValueOnce(caf);
    const r = await solicitarFolios(e.ctx, { ...BASE, nivel: 'timbrar' }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    if (r.tipo === 'error') {
      expect(r.mensaje.detalle).toContain('Se timbraron los folios 10 a 29');
      expect(r.mensaje.detalle).toContain('el CAF de los folios 5 a 30 que ya estaba cargado');
      expect(r.mensaje.detalle).toContain('No los vuelvas a pedir');
      expect(r.mensaje.detalle).toContain('escríbenos a soporte');
      expect(r.mensaje.detalle).not.toContain('súbelo');
    }
    expect(e.falso.tabla('solicitudes_folios')[0]).toMatchObject({
      estado: 'incierta',
      folio_desde: 10,
      folio_hasta: 29,
    });
    expect(e.falso.tabla('solicitudes_folios')[0]?.mensaje).toContain('escríbenos a soporte');
    // La UI lo distingue por el detalle de la operación (sin secretos).
    expect(e.falso.tabla('operaciones_sii')[0]).toMatchObject({
      resultado: 'incierto',
      detalle: { incierto_motivo: 'traslape', traslape_desde: 5, traslape_hasta: 30 },
    });
    expect(e.falso.tabla('cafs')).toHaveLength(1);
    const escrito = todoLoEscrito(e) + JSON.stringify(r);
    expect(escrito).not.toContain('RSASK');
    expect(escrito).not.toContain(rsask.split('\n')[1]);
  });

  it('la empresa de otra organización no se encuentra', async () => {
    const e = escenarioFolios();
    const r = await solicitarFolios(
      { ...e.ctx, empresaId: '99999999-9999-4999-8999-999999999999' },
      BASE,
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', motivo: 'empresa_no_encontrada' });
    expect(EMPRESA).not.toBe('99999999-9999-4999-8999-999999999999');
  });
});

describe('solicitarFolios: desde la API pública (Fase 11)', () => {
  const API_KEY = '66666666-6666-4666-8666-666666666666';

  it('la revisión no pide getUser() y la operación queda con la API key, sin usuario', async () => {
    const e = escenarioFolios();
    revisionQueAsigna(e, 1, 20);
    const confirmarSesion = vi.fn(async () => false);
    e.deps.operacion = { ...e.deps.operacion, confirmarSesion };
    const r = await solicitarFolios(
      { organizacionId: ORG, empresaId: EMPRESA, usuarioId: null, apiKeyId: API_KEY },
      { ...BASE, nivel: 'revision' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'revision', revision: { desde: 1, hasta: 20 } });
    expect(confirmarSesion).not.toHaveBeenCalled();
    expect(e.falso.tabla('operaciones_sii')[0]).toMatchObject({
      operacion: 'solicitar_folios',
      usuario_id: null,
      api_key_id: API_KEY,
    });
    expect(e.falso.tabla('solicitudes_folios')[0]).toMatchObject({ solicitado_por: null });
  });

  it('el control de un incierto sin revisar se aplica igual', async () => {
    const e = escenarioFolios({
      tablas: {
        operaciones_sii: [
          {
            id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            operacion: 'solicitar_folios',
            ambiente: 'certificacion',
            confirmada: true,
            resultado: 'incierto',
            detalle: {},
            iniciada_en: '2026-11-13T14:00:00Z',
          },
        ],
      },
    });
    const r = await solicitarFolios(
      { organizacionId: ORG, empresaId: EMPRESA, usuarioId: null, apiKeyId: API_KEY },
      { ...BASE, nivel: 'revision' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', motivo: 'incierto_sin_revisar' });
    expect(e.folios.autenticar).not.toHaveBeenCalled();
  });
});
