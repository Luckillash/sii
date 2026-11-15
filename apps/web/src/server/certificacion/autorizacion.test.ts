import { ErrorSolicitudFolios, ErrorVerificacion } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import {
  CERTIFICADO,
  CLAVE_PFX,
  COOKIE_SII,
  EMPRESA,
  type Escenario,
  escenario,
  ORG,
  RUT_EMPRESA,
  todoLoEscrito,
} from '../../../test/certificacion-prueba';
import { apoyoStc, medianocheChile, verificarAutorizacion } from './autorizacion';
import { consultarEstadoDeclaracion } from './declaracion';
import { leerAsistente } from './lectura';

// «Verificar autorización en el SII» (PLAN-SAAS Fase 5): ad_empresa en palena con el
// certificado de la empresa + STC como apoyo. Los clientes de la librería son dobles
// (ningún test sale a la red): `e.autorizacion.consultar` y `e.situacionTributaria.timbrajes`.

const RES_80 = { numero: 80, fecha: '2014-08-22' };

function resolucionProduccion(numero: number, fecha: string, extra: Record<string, unknown> = {}) {
  return {
    id: `res-prod-${numero}`,
    organizacion_id: ORG,
    empresa_id: EMPRESA,
    ambiente: 'produccion',
    numero,
    fecha,
    vigente: true,
    ...extra,
  };
}

function autorizadaPreviamente(e: Escenario, autorizadaEn = '2026-11-13T14:00:00Z') {
  const empresa = e.falso.tabla('empresas')[0];
  if (!empresa) throw new Error('sin empresa');
  empresa.autorizada_produccion = true;
  empresa.autorizada_en = autorizadaEn;
}

const empresa = (e: Escenario) => e.falso.tabla('empresas')[0];
const operaciones = (e: Escenario) => e.falso.tabla('operaciones_sii');
const vigentesProduccion = (e: Escenario) =>
  e.falso.tabla('resoluciones').filter((r) => r.ambiente === 'produccion' && r.vigente);
const llamadasRegistrar = (e: Escenario) =>
  e.falso.rpcs.filter((r) => r.nombre === 'registrar_resolucion');

describe('verificarAutorizacion: el SII confirma la autorización', () => {
  it('sin resolución vigente: la registra, marca la empresa y fija la fecha del SII', async () => {
    const e = escenario({ proceso: null });
    const r = await verificarAutorizacion(e.ctx, e.deps);

    expect(r).toMatchObject({ tipo: 'ok', mensaje: { titulo: 'El SII confirma la autorización' } });
    if (r.tipo !== 'ok') throw new Error('no ok');
    expect(r.mensaje.detalle).toContain(
      'autorizada desde el 06-11-2026 (Resolución n.º 80 del 22-08-2014) y ya timbró folios de boleta electrónica.',
    );
    expect(r.mensaje.detalle).toContain('Registramos esa resolución de producción');
    expect(r.tono).toBeUndefined();
    expect(r.avisos).toBeUndefined();

    expect(llamadasRegistrar(e)).toEqual([
      {
        nombre: 'registrar_resolucion',
        args: { p_empresa: EMPRESA, p_ambiente: 'produccion', p_numero: 80, p_fecha: '2014-08-22' },
      },
    ]);
    expect(vigentesProduccion(e)).toHaveLength(1);
    expect(vigentesProduccion(e)[0]).toMatchObject({ organizacion_id: ORG, ...RES_80 });
    // El trigger de la 0009 marca la empresa; la fecha es la del SII (medianoche de Chile).
    expect(empresa(e)).toMatchObject({
      autorizada_produccion: true,
      autorizada_en: '2026-11-06T03:00:00.000Z',
    });

    const [op] = operaciones(e);
    expect(operaciones(e)).toHaveLength(1);
    expect(op).toMatchObject({
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      operacion: 'verificar_autorizacion',
      ambiente: 'produccion',
      confirmada: true,
      resultado: 'ok',
      detalle: {
        respuesta: 'autorizada',
        nro_resol: 80,
        fch_resol: '2014-08-22',
        fecha_autorizacion: '2026-11-06',
        stc: 'boleta',
        stc_ultimo_anio: 2026,
        resolucion: 'registrada',
      },
    });
    expect(r.operacionId).toBe(op?.id);
  });

  it('usa el certificado predeterminado, la sesión y el bloqueo de PRODUCCIÓN, y no sale a la red', async () => {
    const e = escenario({ proceso: null });
    await verificarAutorizacion(e.ctx, e.deps);

    expect(e.autorizacion.autenticar).toHaveBeenCalledTimes(1);
    expect(e.autorizacion.consultar).toHaveBeenCalledWith(expect.anything(), RUT_EMPRESA);
    expect(e.situacionTributaria.timbrajes).toHaveBeenCalledWith(RUT_EMPRESA);
    expect([...e.sesiones.mapa.keys()]).toEqual([`${CERTIFICADO}:produccion`]);
    const bloqueos = e.falso.rpcs.filter((r) => r.nombre.includes('bloqueo'));
    expect(bloqueos.map((b) => [b.nombre, b.args.p_ambiente])).toEqual([
      ['tomar_bloqueo_certificado', 'produccion'],
      ['liberar_bloqueo_certificado', 'produccion'],
    ]);
    expect(e.transporteFalso.enviadas).toEqual([]);
    // Nada de los pasos de certificación.
    for (const cliente of [e.postulacion, e.declaracion, e.folios]) {
      for (const fn of Object.values(cliente)) expect(fn).not.toHaveBeenCalled();
    }
  });

  it('la segunda verificación reutiliza la sesión de producción guardada', async () => {
    const e = escenario({ proceso: null });
    await verificarAutorizacion(e.ctx, e.deps);
    await verificarAutorizacion(e.ctx, e.deps);
    expect(e.autorizacion.autenticar).toHaveBeenCalledTimes(1);
    expect(e.autorizacion.consultar).toHaveBeenCalledTimes(2);
    expect(operaciones(e)).toHaveLength(2);
  });

  it('con la misma resolución vigente no escribe nada más que la operación', async () => {
    const e = escenario({
      proceso: null,
      tablas: { resoluciones: [resolucionProduccion(80, '2014-08-22')] },
    });
    autorizadaPreviamente(e, '2026-11-06T03:00:00.000Z');
    const r = await verificarAutorizacion(e.ctx, e.deps);

    expect(r.tipo).toBe('ok');
    if (r.tipo === 'ok')
      expect(r.mensaje.detalle).toContain('La resolución de producción registrada es la misma.');
    expect(llamadasRegistrar(e)).toEqual([]);
    expect(e.falso.escrituras.filter((w) => w.tabla !== 'operaciones_sii')).toEqual([]);
    expect(operaciones(e)[0]?.detalle).toMatchObject({ resolucion: 'igual' });
  });

  it('con otra resolución vigente: queda la del SII, la anterior al historial y la fecha de autorización no cambia', async () => {
    const e = escenario({
      proceso: null,
      tablas: { resoluciones: [resolucionProduccion(12, '2020-01-15')] },
    });
    autorizadaPreviamente(e, '2026-11-10T12:00:00Z');
    const r = await verificarAutorizacion(e.ctx, e.deps);

    expect(r.tipo).toBe('ok');
    if (r.tipo !== 'ok') return;
    expect(r.avisos).toEqual([
      'La resolución registrada antes (Resolución n.º 12 del 15-01-2020) no coincidía con la del SII: quedó vigente la del SII y la anterior pasó al historial.',
    ]);
    expect(vigentesProduccion(e)).toEqual([expect.objectContaining(RES_80)]);
    expect(e.falso.tabla('resoluciones').find((x) => x.numero === 12)?.vigente).toBe(false);
    expect(empresa(e)?.autorizada_en).toBe('2026-11-10T12:00:00Z');
    expect(operaciones(e)[0]?.detalle).toMatchObject({ resolucion: 'reemplazada' });
  });

  it('autorizada por P91 (sin el candado empresa_autorizada): igual consulta y registra la resolución', async () => {
    const e = escenario({ etapa: 'autorizada', proceso: { codigo_estado_sii: 'P91' } });
    autorizadaPreviamente(e);
    const r = await verificarAutorizacion(e.ctx, e.deps);
    expect(r.tipo).toBe('ok');
    expect(vigentesProduccion(e)).toHaveLength(1);
    expect(empresa(e)?.autorizada_en).toBe('2026-11-13T14:00:00Z');
  });
});

describe('verificarAutorizacion: el STC solo apoya', () => {
  it('autorizada sin timbrajes de boleta: la marca se pone igual, con el aviso de factura', async () => {
    const e = escenario({ proceso: null });
    e.situacionTributaria.timbrajes.mockResolvedValueOnce({
      tipo: 'ok',
      timbrajes: [{ tipoDte: 33, ultimoAnio: 2026, folioFinal: 1200 }],
    });
    const r = await verificarAutorizacion(e.ctx, e.deps);
    expect(r).toMatchObject({
      tipo: 'ok',
      avisos: [
        'El SII todavía no registra folios de boleta timbrados. Si la empresa se certificó solo para factura, no podrá emitir boletas.',
      ],
    });
    if (r.tipo === 'ok') expect(r.mensaje.detalle).not.toContain('ya timbró');
    expect(empresa(e)?.autorizada_produccion).toBe(true);
    expect(operaciones(e)[0]?.detalle).toMatchObject({ stc: 'sin_boleta' });
    expect(operaciones(e)[0]?.detalle).not.toHaveProperty('stc_ultimo_anio');
  });

  for (const [caso, preparar] of [
    [
      'con captcha',
      (e: Escenario) => e.situacionTributaria.timbrajes.mockResolvedValueOnce({ tipo: 'captcha' }),
    ],
    [
      'si falla (forma desconocida)',
      (e: Escenario) =>
        e.situacionTributaria.timbrajes.mockRejectedValueOnce(
          new ErrorVerificacion('forma desconocida'),
        ),
    ],
    [
      'si falla la red',
      (e: Escenario) =>
        e.situacionTributaria.timbrajes.mockRejectedValueOnce(new Error('ECONNRESET')),
    ],
  ] as const) {
    it(`${caso}: no cambia nada de lo de ad_empresa y no hace fallar la operación`, async () => {
      const e = escenario({ proceso: null });
      preparar(e);
      const r = await verificarAutorizacion(e.ctx, e.deps);
      expect(r).toMatchObject({
        tipo: 'ok',
        mensaje: { titulo: 'El SII confirma la autorización' },
      });
      if (r.tipo === 'ok') expect(r.avisos).toBeUndefined();
      expect(empresa(e)?.autorizada_produccion).toBe(true);
      expect(operaciones(e)[0]).toMatchObject({
        resultado: 'ok',
        detalle: { stc: 'no_disponible' },
      });
    });
  }
});

describe('verificarAutorizacion: el SII no confirma', () => {
  it('sin representación legal: no cambia nada y ofrece registrar la resolución a mano', async () => {
    const e = escenario({ proceso: null });
    e.autorizacion.consultar.mockResolvedValueOnce({ tipo: 'sin_representacion' });
    e.situacionTributaria.timbrajes.mockResolvedValueOnce({ tipo: 'ok', timbrajes: [] });
    const r = await verificarAutorizacion(e.ctx, e.deps);

    expect(r).toMatchObject({
      tipo: 'ok',
      tono: 'aviso',
      sugerencia: 'registrarResolucion',
      mensaje: {
        titulo: 'No pudimos verificar la autorización',
        detalle:
          'El titular del certificado no figura como representante legal de la empresa en el SII, así que no pudimos verificar la autorización. Si la empresa ya está certificada, registra su resolución de producción.',
      },
    });
    expect(llamadasRegistrar(e)).toEqual([]);
    expect(empresa(e)?.autorizada_produccion).toBe(false);
    expect(e.falso.escrituras.filter((w) => w.tabla !== 'operaciones_sii')).toEqual([]);
    expect(operaciones(e)[0]).toMatchObject({
      resultado: 'ok',
      detalle: { respuesta: 'sin_representacion', stc: 'sin_boleta' },
    });
    expect(operaciones(e)[0]?.detalle).not.toHaveProperty('nro_resol');
  });

  it('sin representación pero con timbrajes de boleta: dice que ya emite boletas, sin marcar', async () => {
    const e = escenario({ proceso: null });
    e.autorizacion.consultar.mockResolvedValueOnce({ tipo: 'sin_representacion' });
    e.situacionTributaria.timbrajes.mockResolvedValueOnce({
      tipo: 'ok',
      timbrajes: [
        { tipoDte: 41, ultimoAnio: 2025, folioFinal: 10 },
        { tipoDte: 39, ultimoAnio: 2024, folioFinal: 300 },
      ],
    });
    const r = await verificarAutorizacion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'ok', tono: 'aviso', sugerencia: 'registrarResolucion' });
    if (r.tipo === 'ok') {
      expect(r.mensaje.detalle).toContain(
        'el SII registra folios de boleta electrónica timbrados (el último en 2025): la empresa ya emite boletas. Registra su resolución de producción.',
      );
    }
    expect(empresa(e)?.autorizada_produccion).toBe(false);
    expect(operaciones(e)[0]?.detalle).toMatchObject({ stc: 'boleta', stc_ultimo_anio: 2025 });
  });

  it('no autorizada: no cambia nada y lo dice', async () => {
    const e = escenario({ proceso: null });
    e.autorizacion.consultar.mockResolvedValueOnce({ tipo: 'no_autorizada' });
    const r = await verificarAutorizacion(e.ctx, e.deps);
    expect(r).toMatchObject({
      tipo: 'ok',
      tono: 'aviso',
      mensaje: { titulo: 'El SII indica que la empresa no está autorizada' },
    });
    if (r.tipo === 'ok') expect(r.avisos).toBeUndefined();
    expect(empresa(e)?.autorizada_produccion).toBe(false);
    expect(operaciones(e)[0]?.detalle).toMatchObject({ respuesta: 'no_autorizada' });
  });

  it('no autorizada con la empresa marcada a mano: nunca quita la marca y avisa revisar la resolución', async () => {
    const e = escenario({
      proceso: null,
      tablas: { resoluciones: [resolucionProduccion(12, '2020-01-15')] },
    });
    autorizadaPreviamente(e);
    e.autorizacion.consultar.mockResolvedValueOnce({ tipo: 'no_autorizada' });
    const r = await verificarAutorizacion(e.ctx, e.deps);
    expect(r.tipo).toBe('ok');
    if (r.tipo === 'ok') expect(r.avisos?.[0]).toContain('registrada a mano');
    expect(empresa(e)?.autorizada_produccion).toBe(true);
    expect(vigentesProduccion(e)).toEqual([expect.objectContaining({ numero: 12 })]);
  });
});

describe('verificarAutorizacion: errores', () => {
  it('página que la librería no reconoce: verificación fallida (7), registrada y sin escribir nada más', async () => {
    const e = escenario({ proceso: null });
    e.autorizacion.consultar.mockRejectedValueOnce(
      new ErrorVerificacion(
        'El SII respondió la consulta de datos del contribuyente con una página que la librería no reconoce. No se interpretó: revisa si el SII cambió la página.',
      ),
    );
    const r = await verificarAutorizacion(e.ctx, e.deps);
    expect(r).toMatchObject({
      tipo: 'error',
      resultado: 'verificacion_fallida',
      mensaje: { titulo: 'La verificación no pasó' },
    });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('no reconoce');
    expect(operaciones(e)[0]).toMatchObject({
      operacion: 'verificar_autorizacion',
      ambiente: 'produccion',
      resultado: 'verificacion_fallida',
    });
    expect(llamadasRegistrar(e)).toEqual([]);
    expect(empresa(e)?.autorizada_produccion).toBe(false);
    // Sin la respuesta no se consulta el STC.
    expect(e.situacionTributaria.timbrajes).not.toHaveBeenCalled();
  });

  it('página de otro RUT (la librería la rechaza): verificación fallida', async () => {
    const e = escenario({ proceso: null });
    e.autorizacion.consultar.mockRejectedValueOnce(
      new ErrorVerificacion(
        `El SII respondió la consulta de datos del contribuyente con otro RUT (se pidió ${RUT_EMPRESA}). No se usó.`,
      ),
    );
    const r = await verificarAutorizacion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'verificacion_fallida' });
    expect(vigentesProduccion(e)).toEqual([]);
  });

  it('el SII no acepta el certificado: rechazo del SII', async () => {
    const e = escenario({ proceso: null });
    e.autorizacion.autenticar.mockRejectedValueOnce(
      new ErrorSolicitudFolios('El SII no aceptó el certificado para pedir folios.'),
    );
    const r = await verificarAutorizacion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'rechazo_sii' });
    expect(e.autorizacion.consultar).not.toHaveBeenCalled();
  });

  it('sin certificado predeterminado: no sale al SII ni registra la operación', async () => {
    const e = escenario({ proceso: null, tablas: { empresa_certificados: [] } });
    const r = await verificarAutorizacion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'error', operacionId: null });
    expect(operaciones(e)).toEqual([]);
    expect(e.autorizacion.autenticar).not.toHaveBeenCalled();
    expect(e.autorizacion.consultar).not.toHaveBeenCalled();
    expect(e.situacionTributaria.timbrajes).not.toHaveBeenCalled();
  });

  it('empresa desactivada: datos inválidos, sin salir al SII', async () => {
    const e = escenario({ proceso: null });
    const fila = empresa(e);
    if (fila) fila.activa = false;
    const r = await verificarAutorizacion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'uso', operacionId: null });
    expect(operaciones(e)).toEqual([]);
  });

  it('si falla registrar la resolución, la operación queda en error y la empresa sin marcar', async () => {
    const e = escenario({ proceso: null });
    e.falso.fallas.set('rpc:registrar_resolucion', { code: '42501', message: 'Sin permiso' });
    const r = await verificarAutorizacion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'error' });
    expect(empresa(e)?.autorizada_produccion).toBe(false);
    expect(operaciones(e)[0]?.resultado).toBe('error');
  });

  it('nada de lo escrito lleva secretos, correos, URL ni la razón social de la página', async () => {
    const e = escenario({ proceso: null });
    await verificarAutorizacion(e.ctx, e.deps);
    const escrito = todoLoEscrito(e);
    expect(escrito).not.toContain(CLAVE_PFX);
    expect(escrito).not.toContain(COOKIE_SII);
    expect(JSON.stringify(operaciones(e)[0]?.detalle)).not.toMatch(/EMPRESA DE PRUEBA|@|www\./);
  });
});

describe('piezas', () => {
  it('apoyoStc: 39 o 41 son boleta (el año más reciente); otra cosa no; captcha o null, no disponible', () => {
    expect(
      apoyoStc({
        tipo: 'ok',
        timbrajes: [
          { tipoDte: 39, ultimoAnio: 2024, folioFinal: 1 },
          { tipoDte: 41, ultimoAnio: 2026, folioFinal: 1 },
          { tipoDte: 33, ultimoAnio: 2027, folioFinal: 1 },
        ],
      }),
    ).toEqual({ tipo: 'boleta', ultimoAnio: 2026 });
    expect(
      apoyoStc({ tipo: 'ok', timbrajes: [{ tipoDte: 33, ultimoAnio: 2026, folioFinal: 1 }] }),
    ).toEqual({
      tipo: 'sin_boleta',
    });
    expect(apoyoStc({ tipo: 'ok', timbrajes: [] })).toEqual({ tipo: 'sin_boleta' });
    expect(apoyoStc({ tipo: 'captcha' })).toEqual({ tipo: 'no_disponible' });
    expect(apoyoStc(null)).toEqual({ tipo: 'no_disponible' });
  });

  it('medianocheChile: UTC-3 en verano y UTC-4 en invierno', () => {
    expect(medianocheChile('2026-11-06')).toBe('2026-11-06T03:00:00.000Z');
    expect(medianocheChile('2026-06-15')).toBe('2026-06-15T04:00:00.000Z');
  });
});

describe('integración con el asistente', () => {
  it('leerAsistente muestra la verificación (producción) junto a las operaciones de certificación', async () => {
    const e = escenario({ etapa: 'borrador' });
    await consultarEstadoDeclaracion(e.ctx, e.deps);
    await verificarAutorizacion(e.ctx, e.deps);
    const v = await leerAsistente(ORG, EMPRESA, e.deps);
    expect(v?.operaciones.map((o) => o.operacion)).toEqual([
      'verificar_autorizacion',
      'estado_declaracion',
    ]);
    expect(v).toMatchObject({
      autorizacionExterna: true,
      resolucionProduccion: RES_80,
    });
  });

  it('«sin trámite» en borrador sugiere verificar la autorización', async () => {
    const e = escenario({ etapa: 'borrador' });
    const r = await consultarEstadoDeclaracion(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'ok', tono: 'info', sugerencia: 'verificarAutorizacion' });
    if (r.tipo === 'ok') expect(r.mensaje.detalle).toContain('verifica su autorización en el SII');
  });
});
