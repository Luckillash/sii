import { describe, expect, it } from 'vitest';
import { destinoSeguro } from './redireccion';

describe('destinoSeguro', () => {
  it('acepta rutas internas con query y hash', () => {
    expect(destinoSeguro('/acme/tablero')).toBe('/acme/tablero');
    expect(destinoSeguro('/acme/documentos?estado=rechazado&pagina=2')).toBe(
      '/acme/documentos?estado=rechazado&pagina=2',
    );
    expect(destinoSeguro('/acme/envios#ultimo')).toBe('/acme/envios#ultimo');
    expect(destinoSeguro('/')).toBe('/');
  });

  it('sin valor usa el destino por defecto', () => {
    expect(destinoSeguro(null)).toBe('/bienvenida');
    expect(destinoSeguro(undefined)).toBe('/bienvenida');
    expect(destinoSeguro('')).toBe('/bienvenida');
    expect(destinoSeguro(null, '/acme/tablero')).toBe('/acme/tablero');
  });

  it.each([
    'https://malo.example/robar',
    'http:/malo.example',
    'javascript:alert(1)',
    'data:text/html,hola',
    '//malo.example',
    '///malo.example',
    '/\\malo.example',
    '\\\\malo.example',
    '/acme\\..\\..\\malo',
    'acme/tablero',
    ' /acme',
    '/\t/malo.example',
    '/\n/malo.example',
    '/acme tablero',
    '/.//malo.example',
    `/${'a'.repeat(2100)}`,
  ])('rechaza %j', (siguiente) => {
    expect(destinoSeguro(siguiente)).toBe('/bienvenida');
  });

  it('normaliza segmentos . y .. sin salir de la app', () => {
    expect(destinoSeguro('/acme/../otra/tablero')).toBe('/otra/tablero');
    expect(destinoSeguro('/../../etc')).toBe('/etc');
  });

  it('una barra codificada no abre otro origen', () => {
    // El navegador no decodifica %2F en Location: queda como ruta interna.
    expect(destinoSeguro('/%2F%2Fmalo.example')).toBe('/%2F%2Fmalo.example');
  });
});
