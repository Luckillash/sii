import { describe, expect, it, vi } from 'vitest';
import { formatoPdf, manejarArchivo } from './archivos';
import type { DependenciasApi } from './dependencias';
import { manejarEnvio } from './envios';
import { manejarApi } from './manejar';
import {
  dependenciasPrueba,
  EMPRESA,
  filaDocumento,
  filaEnvio,
  peticion,
  repositorioMemoria,
} from './repositorio-memoria.test-util';
import { ErrorApi } from './respuestas';

describe('GET /envios/{id}', () => {
  it('carátula, conteos, documentos y rechazos con los errores del SII', async () => {
    const envio = filaEnvio({ estado_sii: 'EPR', informados: 2, aceptados: 1, rechazados: 1 });
    const d1 = filaDocumento({ envio_id: envio.id, folio: 43, estado: 'aceptado' });
    const d2 = filaDocumento({ envio_id: envio.id, folio: 44, estado: 'rechazado' });
    const m = repositorioMemoria({
      envios: [envio, filaEnvio({ id: 'rcof', proposito: 'rcof' })],
      documentos: [d1, d2],
      rechazos: [
        {
          envio_id: envio.id,
          tipo_dte: 39,
          folio: 44,
          documento_id: d2.id,
          estado: 'RCH',
          tipo_observacion: 'rechazo',
          descripcion: 'Rechazado',
          errores: [
            { seccion: 'Encabezado', linea: '12', codigo: 'E01', descripcion: 'RUT inválido' },
            'basura',
          ],
        },
      ],
    });
    const ver = (id: string) =>
      manejarApi(
        peticion(`/envios/${id}`),
        { ruta: 'GET /envios/{id}', alcance: 'envios:leer' },
        (ctx) => manejarEnvio(ctx, id),
        dependenciasPrueba(m),
      );
    const r = await ver(envio.id);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      objeto: 'envio',
      empresa: { id: EMPRESA },
      estado_sii: 'EPR',
      conteos: { informados: 2, aceptados: 1, rechazados: 1, reparos: 0 },
      caratula: { rut_envia: '12345678-5', nro_resol: 0, fch_resol: '2026-11-06' },
      documentos: [
        { id: d1.id, folio: 43, estado: 'aceptado' },
        { id: d2.id, folio: 44, estado: 'rechazado' },
      ],
      rechazos: [
        {
          folio: 44,
          tipo_observacion: 'rechazo',
          errores: [
            {
              seccion: 'Encabezado',
              linea: 12,
              nivel: null,
              codigo: 'E01',
              descripcion: 'RUT inválido',
              detalle: null,
            },
          ],
        },
      ],
    });
    expect((await ver('rcof')).status).toBe(404);
  });
});

describe('GET /documentos/{id}/xml y /pdf', () => {
  function archivo(deps: DependenciasApi, id: string, formato: 'xml' | 'pdf_carta' | 'pdf_rollo') {
    return manejarApi(
      peticion(`/documentos/${id}/xml`),
      { ruta: 'GET /documentos/{id}/xml', alcance: 'documentos:leer' },
      (ctx) => manejarArchivo(ctx, id, formato),
      deps,
    );
  }

  it('reenvía los bytes de Storage como adjunto, sin exponer la URL firmada', async () => {
    const doc = filaDocumento({ folio: 43 });
    const m = repositorioMemoria({ documentos: [doc] });
    const deps = dependenciasPrueba(m, {
      descargar: vi.fn(async () => new Response('<DTE version="1.0"/>', { status: 200 })),
    });
    const r = await archivo(deps, doc.id, 'xml');
    expect(r.status).toBe(200);
    expect(r.headers.get('Content-Type')).toBe('application/xml; charset=ISO-8859-1');
    expect(r.headers.get('Content-Disposition')).toBe('attachment; filename="DTE-39-F43.xml"');
    expect(await r.text()).toBe('<DTE version="1.0"/>');
    expect(deps.enlace).toHaveBeenCalledWith(
      { organizacionId: doc.organizacion_id, empresaId: EMPRESA },
      doc.id,
      'xml',
    );
    const pdf = await archivo(deps, doc.id, 'pdf_rollo');
    expect(pdf.headers.get('Content-Disposition')).toBe(
      'attachment; filename="DTE-39-F43-rollo.pdf"',
    );
  });

  it('reenvía Content-Length solo si Storage no comprimió el cuerpo', async () => {
    const doc = filaDocumento({ folio: 43 });
    const m = repositorioMemoria({ documentos: [doc] });
    const plano = dependenciasPrueba(m, {
      descargar: vi.fn(
        async () => new Response('<DTE/>', { status: 200, headers: { 'Content-Length': '6' } }),
      ),
    });
    expect((await archivo(plano, doc.id, 'xml')).headers.get('Content-Length')).toBe('6');
    const comprimido = dependenciasPrueba(m, {
      descargar: vi.fn(
        async () =>
          new Response('<DTE version="1.0"/>', {
            status: 200,
            headers: { 'Content-Length': '12', 'Content-Encoding': 'gzip' },
          }),
      ),
    });
    const r = await archivo(comprimido, doc.id, 'xml');
    expect(r.headers.get('Content-Length')).not.toBe('12');
    expect(await r.text()).toBe('<DTE version="1.0"/>');
  });

  it('404 sin folio, PDF de una anulada o fuera del ámbito; 500 si Storage falla', async () => {
    const borrador = filaDocumento({ folio: null, estado: 'borrador' });
    const anulada = filaDocumento({ estado: 'anulado' });
    const ajena = filaDocumento({ ambiente: 'produccion' });
    const m = repositorioMemoria({ documentos: [borrador, anulada, ajena] });
    const deps = dependenciasPrueba(m);
    expect((await archivo(deps, borrador.id, 'xml')).status).toBe(404);
    expect((await archivo(deps, anulada.id, 'pdf_carta')).status).toBe(404);
    expect((await archivo(deps, anulada.id, 'xml')).status).toBe(200);
    expect((await archivo(deps, ajena.id, 'xml')).status).toBe(404);

    const caido = dependenciasPrueba(m, {
      descargar: vi.fn(async () => new Response('x', { status: 500 })),
    });
    expect((await archivo(caido, anulada.id, 'xml')).status).toBe(500);
    expect(caido.capturar).toHaveBeenCalled();
  });

  it('formatoPdf: carta por defecto, rollo, y 400 para otro', () => {
    expect(formatoPdf(null)).toBe('pdf_carta');
    expect(formatoPdf('rollo')).toBe('pdf_rollo');
    expect(() => formatoPdf('a4')).toThrow(ErrorApi);
  });
});
