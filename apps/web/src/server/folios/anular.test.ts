import { describe, expect, it } from 'vitest';
import { EMPRESA, ORG } from '../../../test/certificacion-prueba';
import { escenarioFolios, filaCaf } from '../../../test/folios-prueba';
import { anularFolios } from './anular';
import { traducirErrorAnulacion } from './errores';

const CAF = '77777777-7777-4777-8777-777777777777';

function escenarioCaf(siguiente = 91) {
  return escenarioFolios({
    tablas: {
      cafs: [filaCaf({ id: CAF, folio_desde: 1, folio_hasta: 100, siguiente_folio: siguiente })],
    },
  });
}

describe('anularFolios', () => {
  it('anula folios asignados sin usar con el cliente de sesión (la base verifica el permiso)', async () => {
    const e = escenarioCaf();
    const r = await anularFolios(
      e.ctx,
      { cafId: CAF, desde: 5, hasta: 7, motivo: 'Corte de luz' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') expect(r.mensaje.titulo).toBe('Anulamos 3 folios');
    expect(e.sesion.rpcs.map((x) => x.nombre)).toEqual(['anular_folios']);
    expect(e.falso.rpcs.some((x) => x.nombre === 'anular_folios')).toBe(false);
    expect(e.falso.tabla('folios_anulados').map((f) => f.folio)).toEqual([5, 6, 7]);
    expect(e.falso.tabla('cafs')[0]).toMatchObject({ estado: 'activo', siguiente_folio: 91 });
  });

  it('«Anular los folios que quedan»: la cola deja el CAF anulado y revisa la alerta', async () => {
    const e = escenarioCaf();
    const r = await anularFolios(
      e.ctx,
      { cafId: CAF, desde: 91, hasta: 100, motivo: 'Cambio de sistema' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') expect(r.mensaje.detalle).toContain('El CAF quedó anulado');
    expect(e.falso.tabla('cafs')[0]).toMatchObject({ estado: 'anulado', siguiente_folio: 101 });
    // 10 de 100 (aviso) → 0: se agotó, alerta y correo.
    expect(e.falso.rpcs.find((x) => x.nombre === 'encolar_evento')?.args).toMatchObject({
      p_organizacion: ORG,
      p_evento: 'folios.por_agotarse',
      p_payload: { empresa_id: EMPRESA, agotado: true, folios_disponibles: 0 },
    });
    expect(e.correo.enviar).toHaveBeenCalledTimes(1);
  });

  it('repetir devuelve 0: «Esos folios ya estaban anulados»', async () => {
    const e = escenarioCaf();
    const entrada = { cafId: CAF, desde: 5, hasta: 6, motivo: 'x' };
    await anularFolios(e.ctx, entrada, e.deps);
    const r = await anularFolios(e.ctx, entrada, e.deps);
    expect(r).toMatchObject({ tipo: 'ok', tono: 'info' });
  });

  it('un rango que no sirve se explica antes de llamar a la base', async () => {
    const e = escenarioCaf();
    for (const [desde, hasta] of [
      [9, 3],
      [0, 5],
      [95, 98],
      [93, 100],
    ] as const) {
      const r = await anularFolios(e.ctx, { cafId: CAF, desde, hasta, motivo: 'x' }, e.deps);
      expect(r).toMatchObject({ tipo: 'error', motivo: 'rango_invalido' });
    }
    const sinMotivo = await anularFolios(
      e.ctx,
      { cafId: CAF, desde: 1, hasta: 2, motivo: '  ' },
      e.deps,
    );
    expect(sinMotivo).toMatchObject({ tipo: 'error', motivo: 'rango_invalido' });
    expect(e.sesion.rpcs).toEqual([]);
  });

  it('traduce los errores de la base a mensajes del design system', async () => {
    const e = escenarioCaf();
    e.falso.tabla('documentos').push({
      id: 'd1',
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      ambiente: 'produccion',
      tipo_dte: 39,
      folio: 12,
      estado: 'aceptado',
    });
    const usado = await anularFolios(
      e.ctx,
      { cafId: CAF, desde: 10, hasta: 15, motivo: 'x' },
      e.deps,
    );
    expect(usado).toMatchObject({ tipo: 'error' });
    if (usado.tipo === 'error') {
      expect(usado.mensaje.titulo).toBe('Hay folios del rango que ya se usaron');
      expect(usado.mensaje.detalle).toContain('El folio 12 ya tiene un documento emitido');
      expect(usado.mensaje.detalle).toContain('nota de crédito');
    }

    e.sesion.fallas.set('rpc:anular_folios', { code: '42501', message: 'x' });
    const sinPermiso = await anularFolios(
      e.ctx,
      { cafId: CAF, desde: 1, hasta: 2, motivo: 'x' },
      e.deps,
    );
    expect(sinPermiso).toMatchObject({ tipo: 'error', motivo: 'sin_permiso' });
    if (sinPermiso.tipo === 'error') {
      expect(sinPermiso.mensaje.titulo).toBe('No tienes permiso para gestionar folios');
    }

    expect(traducirErrorAnulacion({ code: 'P0002' }).titulo).toBe('No encontramos el CAF');
    expect(traducirErrorAnulacion({ code: '22023' }).titulo).toBe('Revisa el rango a anular');
    expect(traducirErrorAnulacion({ code: 'XX000' }).detalle).toContain('No se anuló nada');
  });

  it('un CAF de otra empresa u organización no se encuentra', async () => {
    const e = escenarioCaf();
    const r = await anularFolios(
      e.ctx,
      { cafId: '88888888-8888-4888-8888-888888888888', desde: 1, hasta: 2, motivo: 'x' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', motivo: 'caf_no_encontrado' });
  });
});
