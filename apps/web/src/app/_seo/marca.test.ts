import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { COLORES_CLARO, COLORES_OSCURO, perforaciones, svgEstampilla, TRAZO_B } from './marca';

const leer = (ruta: string) => readFileSync(fileURLToPath(new URL(ruta, import.meta.url)), 'utf8');

interface Token {
  name: string;
  value: { light: string; dark: string };
}

const tokens = JSON.parse(leer('../../../../../design-system/boleteame/tokens.json')) as {
  color: { tokens: Token[] };
};
const porNombre = new Map(tokens.color.tokens.map((t) => [t.name, t.value]));

describe('colores de marca', () => {
  it('los del tema claro son los de tokens.json', () => {
    for (const [nombre, valor] of Object.entries(COLORES_CLARO)) {
      expect(porNombre.get(nombre)?.light, nombre).toBe(valor);
    }
  });

  it('los del tema oscuro son los de tokens.json', () => {
    for (const [nombre, valor] of Object.entries(COLORES_OSCURO)) {
      expect(porNombre.get(nombre)?.dark, nombre).toBe(valor);
    }
  });
});

describe('estampilla', () => {
  it('app/icon.svg es la estampilla generada (con tema oscuro)', () => {
    expect(leer('../icon.svg').trim()).toBe(svgEstampilla({ temaOscuro: true }));
  });

  it('lleva la «B», 7 perforaciones por lado y, sin tema oscuro, colores fijos', () => {
    const svg = svgEstampilla();
    expect(svg).toContain(`d="${TRAZO_B}"`);
    expect(perforaciones()).toHaveLength(28);
    expect(svg.match(/<circle /g)).toHaveLength(28);
    expect(svg).not.toContain('<style>');
    expect(svg).toContain(`fill="${COLORES_CLARO.sello}"`);
    expect(svgEstampilla({ temaOscuro: true })).toContain('prefers-color-scheme:dark');
  });
});
