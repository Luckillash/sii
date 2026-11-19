import { describe, expect, it } from 'vitest';
import { PASOS } from '@/lib/certificacion';
import { calcularTotales } from '@/lib/emision';
import { validarRut } from '@/lib/formatos';
import { esquemaEmisionApi } from '@/server/api-publica/esquemas';
import {
  CABECERAS_EJEMPLO,
  CUERPO_EJEMPLO,
  DOCUMENTOS_EJEMPLO,
  jsonCompacto,
  PASOS_PUBLICOS,
  RESPUESTA_EJEMPLO,
  URL_EMISION,
} from './contenido';

describe('datos del hero', () => {
  it('solo boletas 39 y 41, con RUT válidos y montos positivos', () => {
    for (const d of DOCUMENTOS_EJEMPLO) {
      expect([39, 41]).toContain(d.tipo);
      expect(validarRut(d.rut), d.rut).toBe(true);
      expect(d.total).toBeGreaterThan(0);
      expect(d.fecha).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    }
  });
});

describe('pasos de la certificación', () => {
  it('son los mismos pasos visibles del asistente, con descripción', () => {
    expect(PASOS_PUBLICOS.map((p) => [p.numero, p.titulo])).toEqual(
      PASOS.map((p) => [p.numero, p.titulo]),
    );
    expect(PASOS_PUBLICOS).toHaveLength(5);
    for (const p of PASOS_PUBLICOS) expect(p.descripcion.length).toBeGreaterThan(20);
  });
});

describe('ejemplo de la API', () => {
  it('apunta a POST /api/v1/documentos con clave de prueba e Idempotency-Key', () => {
    expect(URL_EMISION).toBe('https://boleteame.dev/api/v1/documentos');
    expect(CABECERAS_EJEMPLO).toEqual([
      'Authorization: Bearer sk_test_…',
      'Content-Type: application/json',
      'Idempotency-Key: venta-000123',
    ]);
  });

  it('el cuerpo pasa la validación de la API', () => {
    expect(esquemaEmisionApi.safeParse(CUERPO_EJEMPLO).success).toBe(true);
  });

  it('la respuesta trae los totales que calcula la emisión', () => {
    const t = calcularTotales({
      lineas: CUERPO_EJEMPLO.lineas.map((l) => ({ ...l, exento: false })),
    });
    expect(RESPUESTA_EJEMPLO.totales).toEqual({
      neto: t.neto,
      exento: 0,
      iva: t.iva,
      total: 4980,
      descuento: 0,
    });
    expect(RESPUESTA_EJEMPLO.totales.neto + RESPUESTA_EJEMPLO.totales.iva).toBe(4980);
    expect(RESPUESTA_EJEMPLO.ambiente).toBe('certificacion');
  });
});

describe('jsonCompacto', () => {
  it('deja en una línea los objetos sin anidados y es JSON válido', () => {
    const texto = jsonCompacto(CUERPO_EJEMPLO);
    expect(texto).toBe(
      [
        '{',
        '  "tipo_dte": 39,',
        '  "lineas": [',
        '    { "nombre": "Café americano", "cantidad": 2, "precio": 2490 }',
        '  ]',
        '}',
      ].join('\n'),
    );
    expect(JSON.parse(texto)).toEqual(CUERPO_EJEMPLO);
    expect(JSON.parse(jsonCompacto(RESPUESTA_EJEMPLO))).toEqual(RESPUESTA_EJEMPLO);
  });

  it('valores sueltos y vacíos', () => {
    expect(jsonCompacto(null)).toBe('null');
    expect(jsonCompacto('a"b')).toBe('"a\\"b"');
    expect(jsonCompacto({ a: [], b: {} })).toBe('{\n  "a": [],\n  "b": {}\n}');
  });
});
