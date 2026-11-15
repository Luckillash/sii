import { describe, expect, it } from 'vitest';
import { cafPrueba } from '../../../test/caf-prueba';
import { EMPRESA, ORG, todoLoEscrito, USUARIO } from '../../../test/certificacion-prueba';
import { escenarioFolios, filaCaf } from '../../../test/folios-prueba';
import { subirCaf } from './subir';

function bytes(xml: string) {
  return new Uint8Array(Buffer.from(xml, 'latin1'));
}

const PRODUCCION = { idk: 300 } as const;

describe('subirCaf', () => {
  it('un CAF válido va a Vault solo por registrar_caf y queda en cafs con siguiente = desde', async () => {
    const e = escenarioFolios();
    const { xml, rsask } = cafPrueba({ desde: 1, hasta: 50, ...PRODUCCION });
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(xml) }, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') {
      expect(r.mensaje.titulo).toBe('Cargamos el CAF');
      expect(r.mensaje.detalle).toContain('Folios 1 a 50 de Boleta electrónica (39) en producción');
    }
    const [caf] = e.falso.tabla('cafs');
    expect(caf).toMatchObject({
      organizacion_id: ORG,
      ambiente: 'produccion',
      tipo_dte: 39,
      folio_desde: 1,
      folio_hasta: 50,
      siguiente_folio: 1,
      idk: 300,
      solicitud_id: null,
    });
    expect(e.falso.secretos.get(String(caf?.caf_secret_id))).toContain('<RSASK>');
    expect(e.falso.rpcs.find((x) => x.nombre === 'registrar_caf')?.args).toMatchObject({
      p_organizacion: ORG,
      p_solicitud: null,
    });
    // No es una operación del SII.
    expect(e.falso.tabla('operaciones_sii')).toEqual([]);
    const escrito = todoLoEscrito(e) + JSON.stringify(r);
    expect(escrito).not.toContain('RSASK');
    expect(escrito).not.toContain(rsask.split('\n')[1]);
  });

  it('IDK equivocado: el CAF de certificación no entra como producción', async () => {
    const e = escenarioFolios();
    const { xml } = cafPrueba({ idk: 100 });
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(xml) }, e.deps);
    expect(r).toMatchObject({
      tipo: 'error',
      motivo: 'idk',
      errores: { ambiente: expect.any(String) },
    });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('es de certificación (IDK 100)');
    expect(e.falso.escrituras).toEqual([]);
  });

  it('RUT ajeno: el CAF de otra empresa no entra', async () => {
    const e = escenarioFolios();
    const { xml } = cafPrueba({ rut: '11111111-1', ...PRODUCCION });
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(xml) }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'rut' });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('11.111.111-1');
    expect(e.falso.escrituras).toEqual([]);
  });

  it('tipo no permitido: un CAF de factura (33) no entra', async () => {
    const e = escenarioFolios();
    const { xml } = cafPrueba({ tipoDte: 33, ...PRODUCCION });
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(xml) }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'tipo_no_permitido' });
    expect(e.falso.escrituras).toEqual([]);
  });

  it('sin RSASK: pide el CAF completo', async () => {
    const e = escenarioFolios();
    const { xml } = cafPrueba(PRODUCCION);
    const sinLlave = xml.replace(/<RSASK>[\s\S]*?<\/RSASK>\n/, '');
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(sinLlave) }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'sin_rsask' });
    expect(e.falso.escrituras).toEqual([]);
  });

  it('una llave que no es del par de RSAPK no entra', async () => {
    const e = escenarioFolios();
    const { xml } = cafPrueba(PRODUCCION);
    const otraM = xml.replace(/<M>[^<]+<\/M>/, `<M>${Buffer.alloc(64, 7).toString('base64')}</M>`);
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(otraM) }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'llaves_distintas' });
  });

  it('un archivo que no es CAF, vacío o demasiado grande', async () => {
    const e = escenarioFolios();
    const noCaf = await subirCaf(
      e.ctx,
      { ambiente: 'produccion', contenido: bytes('<factura>hola</factura>') },
      e.deps,
    );
    expect(noCaf).toMatchObject({ tipo: 'error', motivo: 'no_es_caf' });
    const vacio = await subirCaf(
      e.ctx,
      { ambiente: 'produccion', contenido: new Uint8Array() },
      e.deps,
    );
    expect(vacio).toMatchObject({ tipo: 'error', motivo: 'archivo_vacio' });
    const grande = await subirCaf(
      e.ctx,
      { ambiente: 'produccion', contenido: new Uint8Array(70 * 1024) },
      e.deps,
    );
    expect(grande).toMatchObject({ tipo: 'error', motivo: 'archivo_grande' });
  });

  it('traslape: dice con qué rango choca y no llama a la RPC', async () => {
    const e = escenarioFolios({
      tablas: { cafs: [filaCaf({ id: 'c1', folio_desde: 40, folio_hasta: 80 })] },
    });
    const { xml } = cafPrueba({ desde: 1, hasta: 50, ...PRODUCCION });
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(xml) }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'traslape' });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('folios 40 a 80');
    expect(e.falso.rpcs.some((x) => x.nombre === 'registrar_caf')).toBe(false);
  });

  it('traslape que solo detecta la base (23P01, carrera): mensaje claro', async () => {
    const e = escenarioFolios();
    e.falso.fallas.set('rpc:registrar_caf', { code: '23P01', message: 'traslape' });
    const { xml } = cafPrueba(PRODUCCION);
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(xml) }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'traslape' });
  });

  it('repetir el mismo CAF es idempotente: «Ese CAF ya estaba cargado»', async () => {
    const e = escenarioFolios();
    const { xml } = cafPrueba({ desde: 1, hasta: 10, ...PRODUCCION });
    await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(xml) }, e.deps);
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(xml) }, e.deps);
    expect(r).toMatchObject({ tipo: 'ok', tono: 'info' });
    if (r.tipo === 'ok') expect(r.mensaje.titulo).toBe('Ese CAF ya estaba cargado');
    expect(e.falso.tabla('cafs')).toHaveLength(1);
    expect(e.falso.secretos.size).toBe(3); // .pfx, clave y un solo CAF
  });

  it('calza con una solicitud incierta: la deja timbrada y marca revisada su operación', async () => {
    const e = escenarioFolios({
      tablas: {
        solicitudes_folios: [
          {
            id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            ambiente: 'produccion',
            tipo_dte: 39,
            cantidad: 10,
            confirmada: true,
            estado: 'incierta',
            folio_desde: 11,
            folio_hasta: 20,
            caf_id: null,
            creado_en: '2026-11-13T14:00:00Z',
          },
        ],
        operaciones_sii: [
          {
            id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            operacion: 'solicitar_folios',
            ambiente: 'produccion',
            confirmada: true,
            resultado: 'incierto',
            detalle: {},
            solicitud_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
            iniciada_en: '2026-11-13T14:00:00Z',
          },
        ],
      },
    });
    const { xml } = cafPrueba({ desde: 11, hasta: 20, ...PRODUCCION });
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(xml) }, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') expect(r.avisos?.[0]).toContain('la marcamos como revisada');
    const [caf] = e.falso.tabla('cafs');
    expect(e.falso.tabla('solicitudes_folios')[0]).toMatchObject({
      estado: 'timbrada',
      caf_id: caf?.id,
    });
    expect(e.falso.tabla('operaciones_sii')[0]?.detalle).toMatchObject({ revisada_por: USUARIO });
  });

  it('exige la empresa activa (mismo mensaje que pedir folios)', async () => {
    const e = escenarioFolios();
    const empresa = e.falso.tabla('empresas')[0];
    if (empresa) empresa.activa = false;
    const { xml } = cafPrueba(PRODUCCION);
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(xml) }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'empresa_desactivada' });
    if (r.tipo === 'error') expect(r.mensaje.titulo).toBe('La empresa está desactivada');
    expect(e.falso.escrituras).toEqual([]);
  });

  it('sin sesión válida en Auth no guarda nada', async () => {
    const e = escenarioFolios();
    e.deps.operacion = { ...e.deps.operacion, confirmarSesion: async () => false };
    const { xml } = cafPrueba(PRODUCCION);
    const r = await subirCaf(e.ctx, { ambiente: 'produccion', contenido: bytes(xml) }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'sesion_invalida' });
    expect(e.falso.tabla('cafs')).toEqual([]);
  });
});
