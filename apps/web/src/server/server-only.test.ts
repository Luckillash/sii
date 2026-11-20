import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Todo `src/server/` es solo de servidor (PLAN-SAAS Fase 13, punto 1): cada archivo que no
// sea una prueba importa `server-only`, así un import desde un componente cliente rompe el
// build en vez de mandar al navegador código con service_role, Vault o claves. Lo puro que
// también usa el cliente vive en `src/lib/` (p. ej. `lib/equipo-errores.ts`).
//
// Se exige el import directo en cada archivo (no basta con que lo importe un vecino): un
// archivo «cubierto» por otro deja de estarlo en cuanto alguien lo importa por su ruta.

const RAIZ = fileURLToPath(new URL('.', import.meta.url));
const IMPORT_SERVER_ONLY = /^import 'server-only';$/m;

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return archivos(ruta);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

describe('server-only en src/server', () => {
  const lista = archivos(RAIZ);

  it('recorre la carpeta', () => {
    expect(lista.length).toBeGreaterThan(100);
  });

  it('todo archivo que no es prueba importa server-only', () => {
    const faltan = lista
      .filter((ruta) => !IMPORT_SERVER_ONLY.test(readFileSync(ruta, 'utf8')))
      .map((ruta) => relative(RAIZ, ruta).replaceAll('\\', '/'));
    expect(faltan).toEqual([]);
  });

  it('el import va antes de cualquier otro import', () => {
    const tarde = lista
      .filter((ruta) => {
        const primero = readFileSync(ruta, 'utf8')
          .split('\n')
          .find((linea) => /^import\s/.test(linea));
        return primero !== "import 'server-only';";
      })
      .map((ruta) => relative(RAIZ, ruta).replaceAll('\\', '/'));
    expect(tarde).toEqual([]);
  });
});
