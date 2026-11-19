import { describe, expect, it } from 'vitest';
import { URL_PRODUCCION, urlAbsoluta, urlSitio } from './sitio';

describe('urlSitio', () => {
  it('usa NEXT_PUBLIC_APP_URL sin barra final', () => {
    expect(urlSitio('https://boleteame.dev')).toBe('https://boleteame.dev');
    expect(urlSitio('https://boleteame.dev/')).toBe('https://boleteame.dev');
    expect(urlSitio('http://localhost:3000')).toBe('http://localhost:3000');
  });

  it('si falta o no sirve, usa el dominio de producción', () => {
    for (const valor of [undefined, '', 'no es url', 'ftp://boleteame.dev']) {
      expect(urlSitio(valor), String(valor)).toBe(URL_PRODUCCION);
    }
    expect(URL_PRODUCCION).toBe('https://boleteame.dev');
  });
});

describe('urlAbsoluta', () => {
  it('compone rutas con la base', () => {
    expect(urlAbsoluta('/', 'https://boleteame.dev')).toBe('https://boleteame.dev');
    expect(urlAbsoluta('/ayuda', 'https://boleteame.dev')).toBe('https://boleteame.dev/ayuda');
    expect(urlAbsoluta('legal/terminos', 'https://boleteame.dev')).toBe(
      'https://boleteame.dev/legal/terminos',
    );
  });
});
