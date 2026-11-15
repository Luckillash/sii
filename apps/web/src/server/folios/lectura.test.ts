import { describe, expect, it } from 'vitest';
import { EMPRESA, ORG, USUARIO } from '../../../test/certificacion-prueba';
import { escenarioFolios, filaCaf } from '../../../test/folios-prueba';
import { leerFolios } from './lectura';

describe('leerFolios', () => {
  it('arma el resumen de los cuatro tipos y ambientes, el historial y quién pidió', async () => {
    const e = escenarioFolios({
      tablas: {
        cafs: [
          filaCaf({ id: 'c1', folio_desde: 1, folio_hasta: 100, siguiente_folio: 90 }),
          filaCaf({ id: 'c2', folio_desde: 101, folio_hasta: 200, siguiente_folio: 101 }),
          filaCaf({
            id: 'c3',
            tipo_dte: 41,
            folio_desde: 1,
            folio_hasta: 10,
            siguiente_folio: 11,
            estado: 'agotado',
          }),
          filaCaf({
            id: 'c4',
            ambiente: 'certificacion',
            idk: 100,
            folio_desde: 1,
            folio_hasta: 100,
            siguiente_folio: 90,
          }),
        ],
        folios_anulados: [
          { id: 'a1', organizacion_id: ORG, caf_id: 'c1', folio: 5 },
          { id: 'a2', organizacion_id: ORG, caf_id: 'c1', folio: 6 },
        ],
        solicitudes_folios: [
          {
            id: 's1',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            ambiente: 'produccion',
            tipo_dte: 39,
            cantidad: 100,
            confirmada: true,
            estado: 'timbrada',
            folio_desde: 101,
            folio_hasta: 200,
            solicitado_por: USUARIO,
            creado_en: '2026-11-10T12:00:00Z',
          },
        ],
      },
    });
    const vista = await leerFolios(ORG, EMPRESA, e.deps);
    if (!vista) throw new Error('sin vista');
    const resumen = (amb: string, tipo: number) =>
      vista.resumen.find((r) => r.ambiente === amb && r.tipoDte === tipo);
    expect(vista.resumen).toHaveLength(4);
    expect(resumen('produccion', 39)).toMatchObject({
      enUso: { id: 'c1', siguiente: 90 },
      disponibles: 111,
      total: 200,
      estado: 'sello',
      puedeEmitir: true,
    });
    expect(resumen('produccion', 41)).toMatchObject({
      enUso: null,
      disponibles: 0,
      estado: 'error',
      tuvoCaf: true,
      puedeEmitir: false,
    });
    expect(resumen('certificacion', 39)).toMatchObject({ estado: 'aviso', disponibles: 11 });
    expect(resumen('certificacion', 41)).toMatchObject({ tuvoCaf: false, puedeEmitir: false });
    expect(vista.cafs.find((c) => c.id === 'c1')?.anulados).toBe(2);
    expect(vista.solicitudes[0]?.solicitadoPor).toBe('duena@empresa.cl');
    expect(vista.representante?.rut).toBe('12345678-5');
    expect(vista.planPermiteProduccion).toBe(true);
    // Con el cliente de sesión, sin leer secretos.
    expect(JSON.stringify(vista)).not.toContain('secreto-');
  });

  it('null si la empresa no es de la organización o el id no es válido', async () => {
    const e = escenarioFolios();
    expect(await leerFolios(ORG, '99999999-9999-4999-8999-999999999999', e.deps)).toBeNull();
    expect(await leerFolios(ORG, 'no-es-uuid', e.deps)).toBeNull();
  });

  it('lee el plan con plan_vigente() (la misma fuente que el servidor), con service_role', async () => {
    for (const [plan, esperado] of [
      ['con_produccion', true],
      ['sin_produccion', false],
      ['ninguno', false],
    ] as const) {
      const e = escenarioFolios({ plan });
      const vista = await leerFolios(ORG, EMPRESA, e.deps);
      expect(vista?.planPermiteProduccion).toBe(esperado);
      expect(e.falso.rpcs.find((x) => x.nombre === 'plan_vigente')?.args).toEqual({
        p_organizacion: ORG,
      });
    }
    // Si la base falla, la vista no bloquea: decide el servidor.
    const e = escenarioFolios();
    e.falso.fallas.set('rpc:plan_vigente', { code: 'XX000', message: 'x' });
    expect((await leerFolios(ORG, EMPRESA, e.deps))?.planPermiteProduccion).toBeNull();
  });

  it('marca la incierta por traslape (para no proponer subir el CAF)', async () => {
    const e = escenarioFolios({
      tablas: {
        operaciones_sii: [
          {
            id: 'op-1',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            operacion: 'solicitar_folios',
            ambiente: 'produccion',
            confirmada: true,
            resultado: 'incierto',
            detalle: { incierto_motivo: 'traslape', traslape_desde: 5, traslape_hasta: 30 },
            solicitud_id: null,
            iniciada_en: '2026-11-13T14:00:00Z',
          },
          {
            id: 'op-2',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            operacion: 'solicitar_folios',
            ambiente: 'certificacion',
            confirmada: true,
            resultado: 'incierto',
            detalle: {},
            solicitud_id: null,
            iniciada_en: '2026-11-13T13:00:00Z',
          },
        ],
      },
    });
    const vista = await leerFolios(ORG, EMPRESA, e.deps);
    expect(vista?.operaciones.find((o) => o.id === 'op-1')?.traslape).toEqual({
      desde: 5,
      hasta: 30,
    });
    expect(vista?.operaciones.find((o) => o.id === 'op-2')?.traslape).toBeNull();
  });
});
