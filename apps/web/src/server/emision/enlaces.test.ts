import { describe, expect, it } from 'vitest';
import { EMPRESA, ORG } from '../../../test/certificacion-prueba';
import {
  borradorConReceptor,
  type EscenarioEmision,
  escenarioEmision,
} from '../../../test/emision-prueba';
import { guardarBorrador } from './borradores';
import { emitirDocumento } from './emitir';
import { enlaceDocumento } from './enlaces';

const ctx = { organizacionId: ORG, empresaId: EMPRESA };

async function emitida(e: EscenarioEmision): Promise<string> {
  const r = await emitirDocumento(
    { ...ctx, usuarioId: '33333333-3333-4333-8333-333333333333' },
    { nivel: 'emitir', borrador: borradorConReceptor() },
    e.deps,
  );
  if (r.tipo !== 'ok') throw new Error('la emisión de preparación falló');
  return r.documento.id;
}

describe('enlaceDocumento', () => {
  it('URL firmada del XML y de los PDF guardados', async () => {
    const e = escenarioEmision();
    const id = await emitida(e);
    expect(await enlaceDocumento(ctx, id, 'xml', e.deps)).toEqual({
      ok: true,
      url: `https://falso/${ORG}/${EMPRESA}/produccion/DTE-39-F1.xml`,
    });
    expect(await enlaceDocumento(ctx, id, 'pdf_rollo', e.deps)).toEqual({
      ok: true,
      url: `https://falso/${ORG}/${EMPRESA}/produccion/DTE-39-F1-rollo.pdf`,
    });
    expect(e.pdf).toHaveBeenCalledTimes(2);
  });

  it('si falta el PDF, lo regenera desde lo guardado y el TED, lo sube y lo firma', async () => {
    const e = escenarioEmision();
    e.pdf.mockRejectedValueOnce(new Error('pdf')).mockRejectedValueOnce(new Error('pdf'));
    const id = await emitida(e);
    const doc = e.falso.tabla('documentos')[0];
    expect(doc?.metadata).toEqual({ receptor_correo: 'pagos@cliente.cl' });

    const r = await enlaceDocumento(ctx, id, 'pdf_carta', e.deps);
    expect(r).toEqual({
      ok: true,
      url: `https://falso/${ORG}/${EMPRESA}/produccion/DTE-39-F1-carta.pdf`,
    });
    const [datos, formato] = e.pdf.mock.calls.at(-1) ?? [];
    expect(formato).toBe('carta');
    expect(datos).toMatchObject({
      folio: 1,
      tedXml: doc?.ted_xml,
      resolucion: { numero: 80, fecha: '2014-08-22' },
      totales: { total: 26980, iva: 3829, neto: 20151, exento: 3000, descuentoAplicado: 0 },
      emisor: { rut: '76123456-0', razonSocial: 'EMPRESA DE PRUEBA SPA' },
    });
    expect(datos?.lineas).toHaveLength(2);
    expect(
      e.falso.storage.has(`documentos-xml/${ORG}/${EMPRESA}/produccion/DTE-39-F1-carta.pdf`),
    ).toBe(true);
    expect(e.falso.tabla('documentos')[0]?.metadata).toMatchObject({
      pdf: { carta: `${ORG}/${EMPRESA}/produccion/DTE-39-F1-carta.pdf` },
    });
  });

  it('un borrador, un documento de otra empresa o un id inválido no se descargan', async () => {
    const e = escenarioEmision();
    const g = await guardarBorrador(
      { ...ctx, usuarioId: '33333333-3333-4333-8333-333333333333' },
      borradorConReceptor(),
      undefined,
      e.deps,
    );
    const id = g.tipo === 'borrador' ? g.documentoId : '';
    expect(await enlaceDocumento(ctx, id, 'xml', e.deps)).toMatchObject({
      ok: false,
      mensaje: { titulo: 'El documento todavía no se emite' },
    });
    expect(
      await enlaceDocumento(
        { ...ctx, empresaId: '12121212-1212-4212-8212-121212121212' },
        id,
        'xml',
        e.deps,
      ),
    ).toMatchObject({ ok: false, mensaje: { titulo: 'No encontramos el documento' } });
    expect(await enlaceDocumento(ctx, 'x', 'xml', e.deps)).toMatchObject({ ok: false });
  });

  it('una boleta anulada no tiene PDF, pero sí XML', async () => {
    const e = escenarioEmision();
    const id = await emitida(e);
    const doc = e.falso.tabla('documentos')[0];
    if (doc) doc.estado = 'anulado';
    expect(await enlaceDocumento(ctx, id, 'pdf_carta', e.deps)).toMatchObject({
      ok: false,
      mensaje: { titulo: 'La boleta quedó anulada' },
    });
    expect(await enlaceDocumento(ctx, id, 'xml', e.deps)).toMatchObject({ ok: true });
  });
});
