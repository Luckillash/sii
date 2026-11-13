import { ErrorPostulacion } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import {
  COOKIE_SII,
  escenario,
  estadoDeclaracion,
  ORG,
  todoLoEscrito,
} from '../../../test/certificacion-prueba';
import { descargarSet } from './set';

const PROCESO = '55555555-5555-4555-8555-555555555555';

describe('descargarSet', () => {
  it('ensayo: pide el correo del proveedor y no sale al SII', async () => {
    const e = escenario({ etapa: 'postulada' });
    const sinCorreo = await descargarSet(e.ctx, { confirmada: false }, e.deps);
    expect(sinCorreo).toMatchObject({ tipo: 'error', motivo: 'uso' });

    const r = await descargarSet(
      e.ctx,
      { confirmada: false, correoProveedorSet: 'sw@proveedor.cl' },
      e.deps,
    );
    expect(r.tipo).toBe('ensayo');
    if (r.tipo === 'ensayo') {
      expect(r.resumen.operacion).toBe('descargar_set');
      expect(r.resumen.avisos[0]).toContain('set NUEVO');
    }
    expect(e.falso.escrituras).toEqual([]);
    expect(e.declaracion.descargarSetPruebas).not.toHaveBeenCalled();
  });

  it('antes de postular no se descarga', async () => {
    const e = escenario({ etapa: 'borrador' });
    const r = await descargarSet(
      e.ctx,
      { confirmada: true, correoProveedorSet: 'sw@proveedor.cl' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', motivo: 'uso' });
    expect(e.falso.tabla('operaciones_sii')).toEqual([]);
  });

  it('un correo que el SII no acepta se rechaza sin salir', async () => {
    const e = escenario({ etapa: 'postulada' });
    const r = await descargarSet(
      e.ctx,
      { confirmada: true, correoProveedorSet: 'sw+x@proveedor.cl' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', motivo: 'uso' });
  });

  it('confirmada: descarga, parsea y reemplaza los casos del set', async () => {
    const e = escenario({
      etapa: 'set_enviado',
      tablas: {
        set_pruebas_casos: [
          {
            id: 'viejo',
            organizacion_id: ORG,
            proceso_id: PROCESO,
            numero_caso: 9,
            tipo_dte: 39,
            detalles: [],
            referencia_codigo: 'SET',
            referencia_razon: 'CASO-9',
          },
        ],
      },
    });
    const r = await descargarSet(
      e.ctx,
      { confirmada: true, correoProveedorSet: 'sw@proveedor.cl' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') expect(r.mensaje.detalle).toContain('5 casos');

    const casos = e.falso.tabla('set_pruebas_casos');
    expect(casos.map((c) => c.numero_caso)).toEqual([1, 2, 3, 4, 5]);
    expect(casos.every((c) => c.organizacion_id === ORG && c.referencia_codigo === 'SET')).toBe(
      true,
    );
    expect(casos[3]?.detalles).toEqual([
      { nombre: 'item afecto 1', cantidad: 8, precio: 1590 },
      { nombre: 'item exento 2', cantidad: 2, precio: 1000, exento: true },
    ]);
    const proceso = e.falso.tabla('procesos_certificacion')[0];
    expect(proceso).toMatchObject({
      etapa: 'set_descargado',
      correo_proveedor_set: 'sw@proveedor.cl',
      envio_set_id: null,
    });
    expect(String(proceso?.set_pruebas_texto)).toContain('CASO-1');
    expect(e.declaracion.estado).toHaveBeenCalledTimes(1);
    expect(e.declaracion.descargarSetPruebas.mock.calls[0]?.slice(1)).toEqual([
      '76123456-0',
      'sw@proveedor.cl',
    ]);
    expect(e.falso.tabla('operaciones_sii').map((o) => [o.operacion, o.resultado])).toEqual([
      ['descargar_set', 'ok'],
    ]);
    expect(todoLoEscrito(e)).not.toContain(COOKIE_SII);
  });

  it('P91: guarda el estado (autorizada) y no descarga', async () => {
    const e = escenario({ etapa: 'revision_solicitada' });
    e.declaracion.estado.mockResolvedValueOnce(estadoDeclaracion('P91', 'Autorizada', 91));
    const r = await descargarSet(
      e.ctx,
      { confirmada: true, correoProveedorSet: 'sw@proveedor.cl' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', motivo: 'autorizada' });
    expect(e.declaracion.descargarSetPruebas).not.toHaveBeenCalled();
    expect(e.falso.tabla('procesos_certificacion')[0]).toMatchObject({
      etapa: 'autorizada',
      codigo_estado_sii: 'P91',
    });
    expect(e.falso.tabla('empresas')[0]?.autorizada_produccion).toBe(true);
  });

  it('P90: la librería no descarga (rechazo_sii) y los casos no cambian', async () => {
    const e = escenario({ etapa: 'revision_solicitada' });
    e.declaracion.estado.mockResolvedValueOnce(estadoDeclaracion('P90', 'Por declarar', 90));
    e.declaracion.descargarSetPruebas.mockRejectedValueOnce(
      new ErrorPostulacion(
        'No se descarga un set nuevo: ya está lista para declarar cumplimiento.',
      ),
    );
    const r = await descargarSet(
      e.ctx,
      { confirmada: true, correoProveedorSet: 'sw@proveedor.cl' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', resultado: 'rechazo_sii' });
    expect(e.falso.tabla('set_pruebas_casos')).toEqual([]);
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('por_declarar');
  });

  it('un set que no se puede leer queda guardado como texto, sin casos', async () => {
    const e = escenario({ etapa: 'postulada' });
    e.declaracion.descargarSetPruebas.mockResolvedValueOnce('SET DE PRUEBA sin casos CASO-');
    const r = await descargarSet(
      e.ctx,
      { confirmada: true, correoProveedorSet: 'sw@proveedor.cl' },
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', motivo: 'set_ilegible' });
    const proceso = e.falso.tabla('procesos_certificacion')[0];
    expect(proceso?.set_pruebas_texto).toBe('SET DE PRUEBA sin casos CASO-');
    expect(proceso?.etapa).toBe('postulada');
    expect(e.falso.tabla('operaciones_sii')[0]?.resultado).toBe('ok');
  });
});
