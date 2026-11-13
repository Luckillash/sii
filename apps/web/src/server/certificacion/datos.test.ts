import { describe, expect, it } from 'vitest';
import { EMPRESA, escenario, ORG } from '../../../test/certificacion-prueba';
import { guardarDatosDeclaracion, guardarDatosPostulacion } from './datos';
import type { DatosDeclaracionForm, DatosPostulacionForm } from './tipos';

const POSTULACION: DatosPostulacionForm = {
  rutAdministrador: '12.345.678-5',
  correoAdministrador: 'admin@empresa.cl',
  correoContactoSii: 'contacto@empresa.cl',
  correoIntercambio: 'dte@empresa.cl',
  nombreSoftware: 'Boleteame',
  boletaExenta: false,
  url: 'www.empresa.cl',
};

const DECLARACION: DatosDeclaracionForm = {
  linkConsulta: 'https://www.empresa.cl/boletas',
  rutProveedor: '77.777.777-7',
  nombreProveedor: 'Proveedor Señal SpA',
  correoProveedor: 'sw@proveedor.cl',
};

describe('guardarDatosPostulacion', () => {
  it('crea el proceso con la sesión (etapa borrador) y normaliza el RUT', async () => {
    const e = escenario({ proceso: null });
    const r = await guardarDatosPostulacion(e.ctx, POSTULACION, e.deps);
    expect(r).toMatchObject({ tipo: 'ok', operacionId: null });
    const [proceso] = e.falso.tabla('procesos_certificacion');
    expect(proceso).toMatchObject({
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      etapa: 'borrador',
      rut_administrador: '12345678-5',
      nombre_software: 'Boleteame',
      boleta_exenta: false,
      url: 'www.empresa.cl',
    });
    expect(e.falso.tabla('operaciones_sii')).toEqual([]);
  });

  it('actualiza el proceso existente sin tocar la etapa', async () => {
    const e = escenario({ etapa: 'postulada' });
    const r = await guardarDatosPostulacion(e.ctx, { ...POSTULACION, url: '' }, e.deps);
    expect(r.tipo).toBe('ok');
    expect(e.falso.tabla('procesos_certificacion')).toHaveLength(1);
    expect(e.falso.tabla('procesos_certificacion')[0]).toMatchObject({
      etapa: 'postulada',
      url: null,
    });
  });

  it('rechaza tildes y datos inválidos con errores por campo', async () => {
    const e = escenario({ proceso: null });
    const r = await guardarDatosPostulacion(
      e.ctx,
      {
        ...POSTULACION,
        rutAdministrador: '12.345.678-9',
        correoIntercambio: 'dte+x@empresa.cl',
        nombreSoftware: 'Señal',
        url: 'empresa.cl',
      },
      e.deps,
    );
    expect(r.tipo).toBe('error');
    if (r.tipo !== 'error') return;
    expect(Object.keys(r.errores ?? {}).sort()).toEqual([
      'correoIntercambio',
      'nombreSoftware',
      'rutAdministrador',
      'url',
    ]);
    expect(r.errores?.nombreSoftware).toContain('sin tildes');
    expect(e.falso.tabla('procesos_certificacion')).toEqual([]);
  });

  it('empresa de otra organización: no guarda', async () => {
    const e = escenario({ proceso: null });
    const r = await guardarDatosPostulacion(
      { ...e.ctx, organizacionId: '99999999-9999-4999-8999-999999999999' },
      POSTULACION,
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error' });
    expect(e.falso.tabla('procesos_certificacion')).toEqual([]);
  });
});

describe('guardarDatosDeclaracion', () => {
  it('guarda los datos (admiten tildes: van por GWT-RPC en UTF-8)', async () => {
    const e = escenario({ etapa: 'revision_solicitada' });
    const r = await guardarDatosDeclaracion(e.ctx, DECLARACION, e.deps);
    expect(r.tipo).toBe('ok');
    expect(e.falso.tabla('procesos_certificacion')[0]).toMatchObject({
      link_consulta: 'https://www.empresa.cl/boletas',
      rut_proveedor: '77777777-7',
      nombre_proveedor: 'Proveedor Señal SpA',
      correo_proveedor: 'sw@proveedor.cl',
      etapa: 'revision_solicitada',
    });
  });

  it('sin proceso pide primero la postulación', async () => {
    const e = escenario({ proceso: null });
    const r = await guardarDatosDeclaracion(e.ctx, DECLARACION, e.deps);
    expect(r).toMatchObject({ tipo: 'error' });
    if (r.tipo === 'error') expect(r.mensaje.titulo).toContain('postulación');
  });

  it('valida largos y el correo del SII', async () => {
    const e = escenario({ etapa: 'postulada' });
    const r = await guardarDatosDeclaracion(
      e.ctx,
      { ...DECLARACION, nombreProveedor: 'x'.repeat(31), correoProveedor: 'sin-arroba' },
      e.deps,
    );
    expect(r.tipo).toBe('error');
    if (r.tipo === 'error') {
      expect(Object.keys(r.errores ?? {}).sort()).toEqual(['correoProveedor', 'nombreProveedor']);
    }
  });
});
