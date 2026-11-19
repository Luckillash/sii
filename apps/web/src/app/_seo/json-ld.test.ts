import { describe, expect, it } from 'vitest';
import { construirJsonLd, PLANES_JSON_LD, serializarJsonLd } from './json-ld';

const BASE = 'https://boleteame.dev';

/** Como la grilla D5 completa: Certificación y Empresa van con precio 0. */
const GRILLA_COMPLETA = [
  { codigo: 'certificacion', nombre: 'Certificación', precio_mensual_clp: 0 },
  { codigo: 'pyme', nombre: 'Pyme', precio_mensual_clp: 14990 },
  { codigo: 'contador', nombre: 'Contador', precio_mensual_clp: 49990 },
  { codigo: 'api', nombre: 'API', precio_mensual_clp: 39990 },
  { codigo: 'empresa', nombre: 'Empresa', precio_mensual_clp: 0 },
];

type Nodo = Record<string, unknown>;
const grafo = (datos: Nodo) => datos['@graph'] as Nodo[];

describe('construirJsonLd', () => {
  it('arma Organization y SoftwareApplication enlazados', () => {
    const [organizacion, aplicacion] = grafo(construirJsonLd(BASE));
    expect(organizacion).toEqual({
      '@type': 'Organization',
      '@id': 'https://boleteame.dev#organizacion',
      name: 'Boletéame',
      url: 'https://boleteame.dev',
      logo: 'https://boleteame.dev/apple-icon',
    });
    expect(aplicacion).toMatchObject({
      '@type': 'SoftwareApplication',
      name: 'Boletéame',
      applicationCategory: 'BusinessApplication',
      operatingSystem: 'Web',
      inLanguage: 'es-CL',
      publisher: { '@id': 'https://boleteame.dev#organizacion' },
    });
  });

  it('por defecto ofrece Pyme, Contador y API en CLP, mensuales', () => {
    const ofertas = grafo(construirJsonLd(BASE))[1]?.offers as Nodo[];
    expect(ofertas.map((o) => [o.name, o.price, o.priceCurrency])).toEqual([
      ['Plan Pyme', 14990, 'CLP'],
      ['Plan Contador', 49990, 'CLP'],
      ['Plan API', 39990, 'CLP'],
    ]);
    for (const o of ofertas) {
      expect(o.url).toBe('https://boleteame.dev/#precios');
      expect(o.priceSpecification).toMatchObject({ billingDuration: 'P1M', priceCurrency: 'CLP' });
    }
    expect(PLANES_JSON_LD).toHaveLength(3);
  });

  it('con los planes leídos de la base, deja fuera los gratis y los a medida', () => {
    const ofertas = grafo(construirJsonLd(BASE, GRILLA_COMPLETA))[1]?.offers as Nodo[];
    expect(ofertas.map((o) => o.name)).toEqual(['Plan Pyme', 'Plan Contador', 'Plan API']);
  });
});

describe('serializarJsonLd', () => {
  it('escapa <, > y & y sigue siendo el mismo JSON', () => {
    const datos = { nombre: '</script><script>alert(1)</script> & cía' };
    const texto = serializarJsonLd(datos);
    expect(texto).not.toMatch(/[<>&]/);
    expect(texto).toContain('\\u003c/script\\u003e');
    expect(JSON.parse(texto)).toEqual(datos);
  });

  it('escapa también los separadores de línea U+2028 y U+2029', () => {
    const texto = serializarJsonLd({ t: 'a\u2028b\u2029c' });
    expect(texto).toContain('\\u2028');
    expect(texto).toContain('\\u2029');
    expect(JSON.parse(texto)).toEqual({ t: 'a\u2028b\u2029c' });
  });

  it('el JSON-LD completo no tiene ningún < sin escapar', () => {
    const planes = [{ codigo: 'x', nombre: '<b>Raro</b>', precio_mensual_clp: 1 }];
    const texto = serializarJsonLd(construirJsonLd(BASE, planes));
    expect(texto).not.toContain('<');
    expect(JSON.parse(texto)['@graph'][1].offers[0].name).toBe('Plan <b>Raro</b>');
  });
});
