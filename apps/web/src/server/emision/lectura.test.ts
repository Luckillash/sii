import { describe, expect, it } from 'vitest';
import { EMPRESA, ORG } from '../../../test/certificacion-prueba';
import { borradorConReceptor, escenarioEmision } from '../../../test/emision-prueba';
import { guardarBorrador } from './borradores';
import { leerVistaEmision } from './lectura';

describe('leerVistaEmision', () => {
  it('empresa, certificado, ambientes habilitados, folios y borradores', async () => {
    const e = escenarioEmision({ caf: { desde: 1, hasta: 100, siguiente: 90 } });
    const g = await guardarBorrador(e.ctx, borradorConReceptor(), undefined, e.deps);
    const id = g.tipo === 'borrador' ? g.documentoId : '';
    const v = await leerVistaEmision(
      { organizacionId: ORG, empresaId: EMPRESA },
      { borradorId: id },
      e.deps,
    );
    expect(v.empresa).toMatchObject({ id: EMPRESA, rut: '76123456-0', autorizadaProduccion: true });
    expect(v.certificado).toMatchObject({ rut: '12345678-5', titular: 'Titular de Prueba' });
    expect(v.ambientes).toEqual([
      {
        ambiente: 'produccion',
        habilitado: true,
        motivo: null,
        resolucion: { numero: 80, fecha: '2014-08-22' },
      },
      {
        ambiente: 'certificacion',
        habilitado: true,
        motivo: null,
        resolucion: { numero: 0, fecha: '2026-11-10' },
      },
    ]);
    expect(v.folios).toEqual([
      {
        ambiente: 'produccion',
        tipoDte: 39,
        siguiente: 90,
        disponibles: 11,
        total: 100,
        estado: 'aviso',
        puedeEmitir: true,
      },
      {
        ambiente: 'produccion',
        tipoDte: 41,
        siguiente: null,
        disponibles: 0,
        total: 0,
        estado: 'error',
        puedeEmitir: false,
      },
      {
        ambiente: 'certificacion',
        tipoDte: 39,
        siguiente: 1,
        disponibles: 50,
        total: 50,
        estado: 'sello',
        puedeEmitir: true,
      },
      {
        ambiente: 'certificacion',
        tipoDte: 41,
        siguiente: null,
        disponibles: 0,
        total: 0,
        estado: 'error',
        puedeEmitir: false,
      },
    ]);
    expect(v.borradores).toMatchObject([
      { id, tipoDte: 39, ambiente: 'produccion', receptorRut: '11111111-1', total: 26980 },
    ]);
    expect(v.borrador?.id).toBe(id);
    expect(v.borrador?.datos.receptor).toEqual({
      rut: '11111111-1',
      razonSocial: 'Cliente Frecuente SpA',
      correo: 'pagos@cliente.cl',
      receptorId: e.falso.tabla('receptores')[0]?.id,
    });
    expect(v.borrador?.datos.lineas).toHaveLength(2);
    // Nada de secretos en la vista.
    expect(JSON.stringify(v)).not.toMatch(/secret|RSASK/i);
  });

  it('explica por qué un ambiente está bloqueado', async () => {
    const e = escenarioEmision({ autorizada: false, sinResolucion: 'certificacion' });
    const v = await leerVistaEmision({ organizacionId: ORG, empresaId: EMPRESA }, {}, e.deps);
    expect(v.ambientes.map((a) => [a.ambiente, a.habilitado, a.motivo])).toEqual([
      ['produccion', false, 'sin_autorizacion'],
      ['certificacion', false, 'sin_resolucion'],
    ]);
    expect(v.borrador).toBeNull();

    const sinPlan = escenarioEmision({ plan: 'sin_produccion' });
    const v2 = await leerVistaEmision(
      { organizacionId: ORG, empresaId: EMPRESA },
      {},
      sinPlan.deps,
    );
    expect(v2.ambientes[0]?.motivo).toBe('plan_sin_produccion');

    const sinCert = escenarioEmision();
    sinCert.falso.db.empresa_certificados = [];
    const v3 = await leerVistaEmision(
      { organizacionId: ORG, empresaId: EMPRESA },
      {},
      sinCert.deps,
    );
    expect(v3.certificado).toBeNull();
    expect(v3.ambientes.map((a) => a.motivo)).toEqual(['sin_certificado', 'sin_certificado']);
  });

  it('una empresa de otra organización lanza', async () => {
    const e = escenarioEmision();
    await expect(
      leerVistaEmision(
        { organizacionId: ORG, empresaId: '12121212-1212-4212-8212-121212121212' },
        {},
        e.deps,
      ),
    ).rejects.toThrow('No encontramos la empresa');
  });
});
