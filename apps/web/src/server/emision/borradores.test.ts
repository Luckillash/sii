import { describe, expect, it } from 'vitest';
import { EMPRESA, ORG, USUARIO } from '../../../test/certificacion-prueba';
import {
  borradorConReceptor,
  borradorPrueba,
  escenarioEmision,
  RECEPTOR_RUT,
} from '../../../test/emision-prueba';
import { aBorrador, borrarBorrador, guardarBorrador } from './borradores';

const PRODUCTO = '77777777-7777-4777-8777-777777777777';
const OTRO_PRODUCTO = '88888888-8888-4888-8888-888888888888';

describe('guardarBorrador', () => {
  it('crea el borrador con la sesión, sus líneas y el receptor en el catálogo', async () => {
    const e = escenarioEmision({
      tablas: {
        productos: [
          {
            id: PRODUCTO,
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            nombre: 'Café grano 1 kg',
            precio_bruto: 11990,
            activo: true,
          },
        ],
      },
    });
    const borrador = borradorConReceptor({
      lineas: [
        {
          productoId: PRODUCTO,
          nombre: 'Café grano 1 kg',
          cantidad: 2,
          precio: 11990,
          exento: false,
        },
        // Un producto que no es de la empresa queda sin enlace.
        { productoId: OTRO_PRODUCTO, nombre: 'Otro', cantidad: 1, precio: 1000, exento: false },
      ],
      descuento: { tipo: 'porcentaje', valor: 10, glosa: 'Cliente frecuente' },
    });
    const r = await guardarBorrador(e.ctx, borrador, undefined, e.deps);
    expect(r).toMatchObject({ tipo: 'borrador', mensaje: { titulo: 'Guardamos el borrador' } });
    const [doc] = e.falso.tabla('documentos');
    expect(r.tipo === 'borrador' && r.documentoId).toBe(doc?.id);
    expect(doc).toMatchObject({
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      estado: 'borrador',
      origen: 'panel',
      creado_por: USUARIO,
      receptor_rut: RECEPTOR_RUT,
      descuento_tipo: 'porcentaje',
      descuento_valor: 10,
      descuento_glosa: 'Cliente frecuente',
      descuento_aplicado: 2498,
      mnt_total: 22482,
      metadata: { receptor_correo: 'pagos@cliente.cl' },
    });
    expect(doc?.folio).toBeUndefined();
    expect(e.falso.tabla('documento_detalles').map((l) => l.producto_id)).toEqual([PRODUCTO, null]);
    // Todo con el cliente de sesión (RLS), nada con service_role.
    expect(e.falso.escrituras).toEqual([]);
    expect(e.sesion.escrituras.map((w) => w.tabla)).toEqual(
      expect.arrayContaining(['receptores', 'documentos', 'documento_detalles']),
    );
    expect(e.falso.tabla('operaciones_sii')).toEqual([]);
  });

  it('actualiza un borrador y reemplaza sus líneas; el receptor genérico no va al catálogo', async () => {
    const e = escenarioEmision();
    const primero = await guardarBorrador(e.ctx, borradorConReceptor(), undefined, e.deps);
    const id = primero.tipo === 'borrador' ? primero.documentoId : '';
    const r = await guardarBorrador(
      e.ctx,
      borradorPrueba({ lineas: [{ nombre: 'Uno', cantidad: 1, precio: 100, exento: false }] }),
      id,
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'borrador', documentoId: id });
    expect(e.falso.tabla('documentos')).toHaveLength(1);
    expect(e.falso.tabla('documentos')[0]).toMatchObject({
      receptor_rut: '66666666-6',
      receptor_razon_social: 'Cliente General',
      receptor_id: null,
    });
    expect(e.falso.tabla('documento_detalles').map((l) => l.nombre)).toEqual(['Uno']);
    expect(e.falso.tabla('receptores')).toHaveLength(1);
  });

  it('el correo vacío no borra el que ya tenía el receptor', async () => {
    const e = escenarioEmision();
    await guardarBorrador(e.ctx, borradorConReceptor(), undefined, e.deps);
    await guardarBorrador(
      e.ctx,
      borradorConReceptor({
        receptor: { rut: RECEPTOR_RUT, razonSocial: 'Cliente Frecuente SpA', correo: null },
      }),
      undefined,
      e.deps,
    );
    expect(e.falso.tabla('receptores')).toMatchObject([{ correo: 'pagos@cliente.cl' }]);
  });

  it('un borrador ya emitido o inexistente no se pisa', async () => {
    const e = escenarioEmision({
      tablas: {
        documentos: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            ambiente: 'produccion',
            tipo_dte: 39,
            folio: 12,
            estado: 'enviado',
          },
        ],
      },
    });
    const emitido = await guardarBorrador(
      e.ctx,
      borradorPrueba(),
      '99999999-9999-4999-8999-999999999999',
      e.deps,
    );
    expect(emitido).toMatchObject({ tipo: 'error', motivo: 'borrador_emitido' });
    if (emitido.tipo === 'error') expect(emitido.mensaje.detalle).toContain('N.º 12');
    const otro = await guardarBorrador(
      e.ctx,
      borradorPrueba(),
      '12121212-1212-4212-8212-121212121212',
      e.deps,
    );
    expect(otro).toMatchObject({ tipo: 'error', motivo: 'borrador_no_encontrado' });
    const invalido = await guardarBorrador(e.ctx, borradorPrueba(), 'no-es-uuid', e.deps);
    expect(invalido).toMatchObject({ tipo: 'error', motivo: 'borrador_no_encontrado' });
  });

  it('una empresa de otra organización: no se guarda nada', async () => {
    const e = escenarioEmision();
    const r = await guardarBorrador(
      { ...e.ctx, empresaId: '12121212-1212-4212-8212-121212121212' },
      borradorPrueba(),
      undefined,
      e.deps,
    );
    expect(r).toMatchObject({ tipo: 'error', motivo: 'empresa_no_encontrada' });
    expect(e.falso.tabla('documentos')).toEqual([]);
  });

  it('una falla de la base da un mensaje propio, sin detalles', async () => {
    const e = escenarioEmision();
    e.sesion.fallas.set('documentos:insert', { code: 'XX000', message: 'detalle interno' });
    const r = await guardarBorrador(e.ctx, borradorPrueba(), undefined, e.deps);
    expect(r).toMatchObject({
      tipo: 'error',
      mensaje: { titulo: 'No pudimos guardar el borrador' },
    });
    expect(JSON.stringify(r)).not.toContain('detalle interno');
  });

  it('un borrador de producción con la empresa sin autorizar (trigger de la base) se explica', async () => {
    const e = escenarioEmision();
    e.sesion.fallas.set('documentos:insert', {
      code: 'P0001',
      message: 'La empresa no está autorizada a emitir en producción (estado P91)',
    });
    const r = await guardarBorrador(e.ctx, borradorPrueba(), undefined, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'sin_autorizacion' });
  });

  it('42501 (RLS: sin puede_emitir) se explica', async () => {
    const e = escenarioEmision();
    e.sesion.fallas.set('documentos:insert', { code: '42501', message: 'rls' });
    const r = await guardarBorrador(e.ctx, borradorPrueba(), undefined, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'sin_permiso' });
  });
});

describe('borrarBorrador', () => {
  it('borra un borrador propio y no uno emitido', async () => {
    const e = escenarioEmision();
    const g = await guardarBorrador(e.ctx, borradorPrueba(), undefined, e.deps);
    const id = g.tipo === 'borrador' ? g.documentoId : '';
    expect(await borrarBorrador(e.ctx, id, e.deps)).toEqual({ ok: true });
    expect(e.falso.tabla('documentos')).toEqual([]);
    const otra = await borrarBorrador(e.ctx, id, e.deps);
    expect(otra).toMatchObject({ ok: false, mensaje: { titulo: 'No encontramos el borrador' } });
    expect(await borrarBorrador(e.ctx, 'x', e.deps)).toMatchObject({ ok: false });
  });
});

describe('aBorrador', () => {
  it('convierte la fila a la forma del formulario (genérico = RUT vacío)', () => {
    const b = aBorrador(
      {
        id: 'd',
        tipo_dte: 41,
        ambiente: 'certificacion',
        receptor_id: null,
        receptor_rut: '66666666-6',
        receptor_razon_social: 'Cliente General',
        descuento_tipo: null,
        descuento_valor: null,
        descuento_glosa: null,
        metadata: {},
      },
      [
        {
          nro_linea: 2,
          producto_id: null,
          nombre: 'B',
          cantidad: 1,
          precio: 50,
          exento: true,
          unidad: null,
        },
        {
          nro_linea: 1,
          producto_id: null,
          nombre: 'A',
          cantidad: 1.5,
          precio: 100,
          exento: true,
          unidad: 'Kg',
        },
      ],
    );
    expect(b).toEqual({
      tipoDte: 41,
      ambiente: 'certificacion',
      receptor: { rut: '', razonSocial: null, correo: null, receptorId: null },
      lineas: [
        { productoId: null, nombre: 'A', cantidad: 1.5, precio: 100, exento: true, unidad: 'Kg' },
        { productoId: null, nombre: 'B', cantidad: 1, precio: 50, exento: true, unidad: null },
      ],
      descuento: null,
    });
  });
});
