// Genera apps/web/src/styles/tokens.css desde design-system/boleteame/tokens.json
// (PLAN-SAAS §4.2). Uso: `pnpm --filter web tokens`. No editar tokens.css a mano.
//
// Tema oscuro: `@media (prefers-color-scheme: dark)` cuando no se fijó tema, y
// `[data-theme="dark"]` / `[data-theme="light"]` para el tema elegido por el usuario.

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Valor = string | { light: string; dark: string };
interface Token {
  name: string;
  value: Valor;
}
interface TokensJson {
  color: { tokens: Token[] };
  type: {
    families: Record<string, string>;
    groups: { styles: Record<string, string | number>[] }[];
  };
  spacing: { tokens: Token[] };
  radius: { tokens: Token[] };
  shadow: { tokens: Token[] };
}

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origen = resolve(raiz, 'design-system/boleteame/tokens.json');
const destino = resolve(raiz, 'apps/web/src/styles/tokens.css');

const json = JSON.parse(readFileSync(origen, 'utf8')) as TokensJson;

// `{sello}` → `var(--sello)`
const valorCss = (v: string): string => v.replace(/^\{([\w-]+)\}$/, 'var(--$1)');

const claro: string[] = [];
const oscuro: string[] = [];
const fijos: string[] = [];

for (const t of [...json.color.tokens, ...json.shadow.tokens]) {
  if (typeof t.value === 'string') {
    fijos.push(`  --${t.name}: ${valorCss(t.value)};`);
  } else {
    claro.push(`  --${t.name}: ${t.value.light};`);
    oscuro.push(`  --${t.name}: ${t.value.dark};`);
  }
}

// Las familias se cargan con next/font (variables --fuente-plex-*); los nombres de
// respaldo quedan detrás para cuando la fuente aún no carga.
const familias = Object.entries(json.type.families).map(
  ([nombre, pila]) =>
    `  --font-${nombre}: var(--fuente-plex-${nombre}, ${pila.split(',')[0]}), ${pila.split(',').slice(1).join(',').trim()};`,
);

const tipografia: string[] = [];
for (const grupo of json.type.groups) {
  for (const s of grupo.styles) {
    const n = String(s.name);
    tipografia.push(`  --text-${n}-size: ${s.fontSize};`);
    tipografia.push(`  --text-${n}-line: ${s.lineHeight};`);
    tipografia.push(`  --text-${n}-weight: ${s.fontWeight};`);
    if (s.letterSpacing) tipografia.push(`  --text-${n}-tracking: ${s.letterSpacing};`);
  }
}

const escala = [...json.spacing.tokens, ...json.radius.tokens].map(
  (t) => `  --${t.name}: ${t.value as string};`,
);

const css = `/* Generado por scripts/generar-tokens.ts desde design-system/boleteame/tokens.json.
 * No editar a mano: cambia tokens.json y corre \`pnpm --filter web tokens\`. */

:root {
  color-scheme: light;
${claro.join('\n')}
${fijos.join('\n')}

${familias.join('\n')}

${tipografia.join('\n')}

${escala.join('\n')}

  --duracion-rapida: 120ms;
  --duracion-menu: 200ms;
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
${oscuro.map((l) => `  ${l}`).join('\n')}
  }
}

:root[data-theme="dark"] {
  color-scheme: dark;
${oscuro.join('\n')}
}

@media (prefers-reduced-motion: reduce) {
  :root {
    --duracion-rapida: 0ms;
    --duracion-menu: 0ms;
  }
}
`;

writeFileSync(destino, css);
console.log(`tokens.css generado: ${claro.length} tokens con tema, ${fijos.length} fijos.`);
