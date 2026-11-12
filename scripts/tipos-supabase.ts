// Genera los tipos TypeScript del esquema de Supabase (PLAN-SAAS §4.4) desde el
// proyecto en la nube (la única base, producción). Requiere `supabase login` una vez.
// Alternativa sin CLI: MCP `generate_typescript_types` (y pegar la cabecera de abajo).
//
//   pnpm db:tipos
//
// Regenerar y versionar el resultado después de cada migración nueva. Es Node y no sh
// para que corra igual en PowerShell, Git Bash y CI.

import { execSync } from 'node:child_process';
import { renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destino = resolve(raiz, 'apps/web/src/server/supabase/tipos.ts');

const CABECERA = `// Generado desde el proyecto de Supabase (rbrntkztzijaxsnpgpqn). No editar a mano:
// regenerar con \`pnpm db:tipos\` o el MCP generate_typescript_types tras cada migración.

`;

// --remote con el ref explícito: la CLI 3.x apunta a una base local por defecto.
// execSync pasa por la shell del sistema, que resuelve `pnpm` también en Windows
// (pnpm.cmd). stderr se hereda: ahí la CLI escribe el destino y los errores.
const tipos = execSync(
  'pnpm exec supabase gen types --lang=typescript --remote=rbrntkztzijaxsnpgpqn --schema public',
  {
    cwd: raiz,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 16 * 1024 * 1024,
  },
);

// Si la CLI devolvió otra cosa (vacío, un aviso), no se toca el archivo versionado.
if (!tipos.includes('export type Database')) {
  console.error('La CLI no devolvió tipos: tipos.ts queda como estaba.');
  process.exit(1);
}

// Archivo temporal y renombrar: un fallo a mitad no deja tipos.ts truncado.
const temporal = `${destino}.tmp`;
writeFileSync(temporal, CABECERA + tipos);
renameSync(temporal, destino);
console.log('Tipos generados en apps/web/src/server/supabase/tipos.ts');
