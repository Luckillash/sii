import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLOR, TOKEN_CSS } from './tokens';

// Los colores de los correos son copia del tema claro: esta prueba avisa si tokens.css
// (generado desde tokens.json) cambia y los correos quedan atrás.

const TOKENS_CSS = fileURLToPath(
  new URL('../../../apps/web/src/styles/tokens.css', import.meta.url),
);

function bloqueRaiz(css: string): string {
  const inicio = css.indexOf(':root {');
  return css.slice(inicio, css.indexOf('}', inicio));
}

describe('tokens de correo', () => {
  const raiz = bloqueRaiz(readFileSync(TOKENS_CSS, 'utf8'));

  for (const [clave, token] of Object.entries(TOKEN_CSS)) {
    it(`${clave} coincide con ${token} del tema claro`, () => {
      const valor = new RegExp(`${token}:\\s*(#[0-9a-f]{6})\\b`, 'i').exec(raiz)?.[1];
      expect(valor?.toLowerCase()).toBe(COLOR[clave as keyof typeof COLOR]);
    });
  }
});
