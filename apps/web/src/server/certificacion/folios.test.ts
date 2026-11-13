import { FolioInicialRequeridoError, FoliosSinCafError } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { cafPrueba } from '../../../test/caf-prueba';
import {
  CERTIFICADO,
  COOKIE_SII,
  EMPRESA,
  escenario,
  ORG,
  todoLoEscrito,
  USUARIO,
} from '../../../test/certificacion-prueba';
import { leerDatosCaf, solicitarFoliosSet } from './folios';

const PROCESO = '55555555-5555-4555-8555-555555555555';

function casos(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `caso-${i + 1}`,
    organizacion_id: ORG,
    proceso_id: PROCESO,
    numero_caso: i + 1,
    tipo_dte: 39,
    detalles: [{ nombre: 'x', cantidad: 1, precio: 100 }],
    referencia_codigo: 'SET',
    referencia_razon: `CASO-${i + 1}`,
  }));
}

describe('leerDatosCaf', () => {
  it('lee el <DA> sin la llave', () => {
    const { xml } = cafPrueba({ desde: 31, hasta: 35 });
    expect(leerDatosCaf(Buffer.from(xml, 'latin1'))).toEqual({
      rutEmisor: '76123456-0',
      razonSocial: 'EMPRESA DE PRUEBA SPA',
      tipoDte: 39,
      desde: 31,
      hasta: 35,
      fechaAutorizacion: '2026-11-13',
      idk: 100,
    });
  });
});

describe('solicitarFoliosSet', () => {
  it('ensayo: cantidad = casos del set, avisa si ya alcanzan los folios, sin red ni filas', async () => {
    const e = escenario({
      etapa: 'set_descargado',
      tablas: {
        set_pruebas_casos: casos(5),
        cafs: [
          {
            id: 'caf-1',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            ambiente: 'certificacion',
            tipo_dte: 39,
            folio_desde: 1,
            folio_hasta: 10,
            siguiente_folio: 3,
            estado: 'activo',
          },
        ],
      },
    });
    const r = await solicitarFoliosSet(e.ctx, { confirmada: false }, e.deps);
    expect(r.tipo).toBe('ensayo');
    if (r.tipo !== 'ensayo') return;
    expect(r.resumen.filas).toContainEqual({ etiqueta: 'Cantidad', valor: '5' });
    expect(r.resumen.avisos[0]).toContain('Ya tienes 8 folios');
    expect(e.falso.escrituras).toEqual([]);
    expect(e.folios.autenticar).not.toHaveBeenCalled();
  });

  it('sin set descargado pide 5 (uno por caso del set de boletas)', async () => {
    const e = escenario({ etapa: 'postulada' });
    const r = await solicitarFoliosSet(e.ctx, { confirmada: false }, e.deps);
    if (r.tipo === 'ensayo')
      expect(r.resumen.filas).toContainEqual({ etiqueta: 'Cantidad', valor: '5' });
    else throw new Error('se esperaba el ensayo');
  });

  it('exige un representante electrónico', async () => {
    const e = escenario({ etapa: 'postulada' });
    const asociacion = e.falso.tabla('empresa_certificados')[0];
    if (asociacion) asociacion.es_representante_electronico = false;
    const r = await solicitarFoliosSet(e.ctx, { confirmada: false }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'config' });
    if (r.tipo === 'error') expect(r.mensaje.titulo).toContain('representante electrónico');
  });

  it('confirmada: timbra, guarda el CAF en Vault y en cafs, y deja la solicitud timbrada', async () => {
    const e = escenario({ etapa: 'set_descargado', tablas: { set_pruebas_casos: casos(5) } });
    const { xml, rsask } = cafPrueba({ desde: 1, hasta: 5 });
    e.folios.solicitar.mockResolvedValueOnce(Buffer.from(xml, 'latin1'));

    const r = await solicitarFoliosSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    expect(e.folios.solicitar.mock.calls[0]?.slice(1)).toEqual(['76123456-0', 39, 5, {}]);

    const [solicitud] = e.falso.tabla('solicitudes_folios');
    const [caf] = e.falso.tabla('cafs');
    expect(solicitud).toMatchObject({
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      certificado_id: CERTIFICADO,
      ambiente: 'certificacion',
      tipo_dte: 39,
      cantidad: 5,
      confirmada: true,
      estado: 'timbrada',
      folio_desde: 1,
      folio_hasta: 5,
      caf_id: caf?.id,
      solicitado_por: USUARIO,
    });
    expect(caf).toMatchObject({
      folio_desde: 1,
      folio_hasta: 5,
      siguiente_folio: 1,
      idk: 100,
      solicitud_id: solicitud?.id,
    });
    expect(e.falso.secretos.get(String(caf?.caf_secret_id))).toContain('<RSASK>');

    const [op] = e.falso.tabla('operaciones_sii');
    expect(op).toMatchObject({
      operacion: 'solicitar_folios',
      resultado: 'ok',
      solicitud_id: solicitud?.id,
    });

    // El CAF (y su llave) solo viajó a la RPC: nada más lo tiene.
    const escrito = todoLoEscrito(e) + JSON.stringify(r);
    expect(escrito).not.toContain(rsask.split('\n')[1]);
    expect(escrito).not.toContain('RSASK');
    expect(escrito).not.toContain(COOKIE_SII);
  });

  it('folio inicial requerido: rechazo_sii con el valor que sugiere el SII', async () => {
    const e = escenario({ etapa: 'postulada' });
    e.folios.solicitar.mockRejectedValueOnce(new FolioInicialRequeridoError('certificacion', '1'));
    const r = await solicitarFoliosSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({
      tipo: 'error',
      resultado: 'rechazo_sii',
      requiere: { folioInicial: { sugerido: '1' } },
    });
    expect(e.falso.tabla('solicitudes_folios')[0]).toMatchObject({ estado: 'rechazada' });
    expect(e.falso.tabla('cafs')).toEqual([]);
  });

  it('con folio inicial lo pasa a la librería', async () => {
    const e = escenario({ etapa: 'postulada' });
    const { xml } = cafPrueba({ desde: 1, hasta: 5 });
    e.folios.solicitar.mockResolvedValueOnce(Buffer.from(xml, 'latin1'));
    const r = await solicitarFoliosSet(e.ctx, { confirmada: true, folioInicial: 1 }, e.deps);
    expect(r.tipo).toBe('ok');
    expect(e.folios.solicitar.mock.calls[0]?.[4]).toEqual({ folioInicial: 1 });
    expect(e.falso.tabla('solicitudes_folios')[0]?.folio_inicial).toBe(1);
  });

  it('la orden de timbrar salió sin CAF (FoliosSinCafError): incierto y solicitud incierta', async () => {
    const e = escenario({ etapa: 'postulada' });
    e.folios.solicitar.mockRejectedValueOnce(
      new FoliosSinCafError(11, 15, 'certificacion', 'maullin.sii.cl'),
    );
    const r = await solicitarFoliosSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('Folios ya autorizados');
    expect(e.falso.tabla('solicitudes_folios')[0]).toMatchObject({
      estado: 'incierta',
      folio_desde: 11,
      folio_hasta: 15,
    });

    // La siguiente solicitud queda bloqueada hasta marcar la incierta como revisada.
    const otra = await solicitarFoliosSet(e.ctx, { confirmada: true }, e.deps);
    expect(otra).toMatchObject({ tipo: 'error', motivo: 'incierto_sin_revisar' });
    expect(e.folios.solicitar).toHaveBeenCalledTimes(1);
  });

  it('el CAF se timbró pero no se pudo guardar: incierto (código 6 de la CLI), sin secretos', async () => {
    const e = escenario({ etapa: 'postulada' });
    const { xml, rsask } = cafPrueba({ desde: 1, hasta: 5 });
    e.folios.solicitar.mockResolvedValueOnce(Buffer.from(xml, 'latin1'));
    e.falso.fallas.set('rpc:registrar_caf', { code: 'XX000', message: `fallo con ${xml}` });
    const r = await solicitarFoliosSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    if (r.tipo === 'error') {
      expect(r.mensaje.detalle).toContain('No los vuelvas a pedir');
      expect(r.mensaje.detalle).toContain('Folios ya autorizados');
    }
    expect(e.falso.tabla('solicitudes_folios')[0]?.estado).toBe('incierta');
    const escrito = todoLoEscrito(e) + JSON.stringify(r);
    expect(escrito).not.toContain(rsask.split('\n')[1]);
    expect(escrito).not.toContain('RSASK');
  });
});
