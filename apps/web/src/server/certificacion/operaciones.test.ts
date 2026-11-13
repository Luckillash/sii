import { describe, expect, it } from 'vitest';
import { EMPRESA, escenario, ORG, USUARIO } from '../../../test/certificacion-prueba';
import { marcarRevisada } from './operaciones';

const OP = '77777777-7777-4777-8777-777777777777';

function conIncierta(empresaId = EMPRESA) {
  return escenario({
    tablas: {
      operaciones_sii: [
        {
          id: OP,
          organizacion_id: ORG,
          empresa_id: empresaId,
          operacion: 'solicitar_folios',
          ambiente: 'certificacion',
          confirmada: true,
          resultado: 'incierto',
          detalle: { error: { nombre: 'FoliosSinCafError' } },
          iniciada_en: '2026-11-13T14:00:00.000Z',
        },
      ],
    },
  });
}

describe('marcarRevisada', () => {
  it('marca la operación incierta como revisada (detalle.revisada_en y revisada_por)', async () => {
    const e = conIncierta();
    const r = await marcarRevisada(e.ctx, OP, e.deps);
    expect(r).toMatchObject({ tipo: 'ok', operacionId: OP });
    expect(e.falso.tabla('operaciones_sii')[0]?.detalle).toMatchObject({
      revisada_en: '2026-11-13T15:00:00.000Z',
      revisada_por: USUARIO,
      error: { nombre: 'FoliosSinCafError' },
    });
  });

  it('una operación de otra empresa de la organización no se toca', async () => {
    const e = conIncierta('99999999-9999-4999-8999-999999999999');
    const r = await marcarRevisada(e.ctx, OP, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'no_encontrada' });
    expect(e.falso.tabla('operaciones_sii')[0]?.detalle).not.toHaveProperty('revisada_en');
  });

  it('una operación que no es incierta no necesita revisión', async () => {
    const e = conIncierta();
    const fila = e.falso.tabla('operaciones_sii')[0];
    if (fila) fila.resultado = 'ok';
    const r = await marcarRevisada(e.ctx, OP, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'no_revisable' });
  });
});
