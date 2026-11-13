import { describe, expect, it } from 'vitest';
import { CERTIFICADO, EMPRESA, escenario, ORG } from '../../../test/certificacion-prueba';
import { leerAsistente } from './lectura';

const PROCESO = '55555555-5555-4555-8555-555555555555';
const ENVIO = '88888888-8888-4888-8888-888888888888';

describe('leerAsistente', () => {
  it('null si la empresa no es de la organización (o el id no es un uuid)', async () => {
    const e = escenario();
    expect(await leerAsistente('99999999-9999-4999-8999-999999999999', EMPRESA, e.deps)).toBeNull();
    expect(await leerAsistente(ORG, 'no-es-uuid', e.deps)).toBeNull();
  });

  it('sin proceso: vista vacía con el certificado predeterminado', async () => {
    const e = escenario({ proceso: null });
    const v = await leerAsistente(ORG, EMPRESA, e.deps);
    expect(v).toMatchObject({
      empresa: { id: EMPRESA, rut: '76123456-0', activa: true, autorizadaProduccion: false },
      proceso: null,
      casos: [],
      envioSet: null,
      cafSet: null,
      resolucionCertificacion: null,
      certificado: {
        id: CERTIFICADO,
        titular: 'Titular de Prueba',
        rut: '12345678-5',
        representante: true,
      },
      operaciones: [],
    });
  });

  it('arma el proceso, los casos, el envío con rechazos, el CAF y las operaciones', async () => {
    const e = escenario({
      etapa: 'set_enviado',
      proceso: { envio_set_id: ENVIO, avisos_postulacion: ['Aviso del SII'] },
      tablas: {
        set_pruebas_casos: [
          {
            id: 'c1',
            organizacion_id: ORG,
            proceso_id: PROCESO,
            numero_caso: 1,
            tipo_dte: 39,
            detalles: [{ nombre: 'Arroz', cantidad: 5, precio: 700 }],
            referencia_codigo: 'SET',
            referencia_razon: 'CASO-1',
            documento_id: null,
          },
        ],
        envios: [
          {
            id: ENVIO,
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            track_id: '123',
            clasificacion: 'rechazado',
            estado_sii: 'EPR',
            incierto: false,
            enviado_en: '2026-11-13T14:00:00Z',
            ultima_consulta_en: '2026-11-13T14:10:00Z',
            informados: 5,
            aceptados: 4,
            rechazados: 1,
            reparos: 0,
          },
        ],
        envio_rechazos: [
          {
            id: 'r1',
            organizacion_id: ORG,
            envio_id: ENVIO,
            folio: 2,
            estado: 'RCH',
            descripcion: 'Monto mal calculado',
            errores: [{ codigo: 123, descripcion: 'x' }],
          },
        ],
        cafs: [
          {
            id: 'caf-1',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            ambiente: 'certificacion',
            tipo_dte: 39,
            folio_desde: 1,
            folio_hasta: 10,
            siguiente_folio: 6,
            estado: 'activo',
            caf_secret_id: 'no-debe-salir',
          },
          {
            id: 'caf-2',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            ambiente: 'certificacion',
            tipo_dte: 39,
            folio_desde: 11,
            folio_hasta: 15,
            siguiente_folio: 11,
            estado: 'activo',
            caf_secret_id: 'no-debe-salir',
          },
        ],
        resoluciones: [
          {
            id: 'res',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            ambiente: 'certificacion',
            numero: 0,
            fecha: '2026-11-10',
            vigente: true,
          },
        ],
        operaciones_sii: [
          {
            id: 'op1',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            operacion: 'enviar_set',
            ambiente: 'certificacion',
            resultado: 'incierto',
            confirmada: true,
            mensaje: 'No sabemos',
            detalle: { revisada_en: '2026-11-13T14:30:00Z' },
            iniciada_en: '2026-11-13T14:00:00Z',
            terminada_en: '2026-11-13T14:01:00Z',
          },
          {
            id: 'op2',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            operacion: 'emitir',
            ambiente: 'produccion',
            resultado: 'ok',
            confirmada: true,
            detalle: {},
            iniciada_en: '2026-11-13T14:05:00Z',
          },
        ],
      },
    });
    const v = await leerAsistente(ORG, EMPRESA, e.deps);
    expect(v?.proceso).toMatchObject({
      id: PROCESO,
      etapa: 'set_enviado',
      avisosPostulacion: ['Aviso del SII'],
      envioSetId: ENVIO,
    });
    expect(v?.casos).toEqual([
      {
        numero: 1,
        tipoDte: 39,
        referenciaRazon: 'CASO-1',
        detalles: [{ nombre: 'Arroz', cantidad: 5, precio: 700 }],
        documentoId: null,
      },
    ]);
    expect(v?.envioSet).toMatchObject({
      id: ENVIO,
      trackId: '123',
      estado: 'rechazado',
      aceptados: 4,
      rechazados: 1,
      rechazos: [{ folio: 2, codigo: '123', descripcion: 'Monto mal calculado' }],
    });
    expect(v?.cafSet).toEqual({
      id: 'caf-1',
      folioDesde: 1,
      folioHasta: 10,
      siguienteFolio: 6,
      disponibles: 10,
    });
    expect(v?.resolucionCertificacion).toEqual({ numero: 0, fecha: '2026-11-10' });
    // Solo certificación, y la incierta revisada se ve como revisada.
    expect(v?.operaciones).toEqual([
      expect.objectContaining({
        id: 'op1',
        operacion: 'enviar_set',
        resultado: 'incierto',
        revisada: true,
      }),
    ]);
    expect(JSON.stringify(v)).not.toContain('no-debe-salir');
  });
});
