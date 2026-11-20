import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SLUGS_RESERVADOS } from './rutas';

// La base también rechaza los slugs reservados (check `organizaciones_slug_no_reservado`,
// migración 0020). Las dos listas deben ser iguales: esta prueba lee la lista de la ÚLTIMA
// migración que la define (entre los marcadores `slugs-reservados:inicio` y
// `slugs-reservados:fin`) y la compara con `SLUGS_RESERVADOS`. Para agregar un slug:
// agregarlo en `rutas.ts` y en una migración nueva que reemplace el check con los mismos
// marcadores.

const CARPETA_MIGRACIONES = fileURLToPath(
  new URL('../../../../supabase/migrations', import.meta.url),
);
const MARCADORES = /--\s*slugs-reservados:inicio([\s\S]*?)--\s*slugs-reservados:fin/;

function listaDeLaBase(): { archivo: string; slugs: string[] } {
  const archivos = readdirSync(CARPETA_MIGRACIONES)
    .filter((a) => a.endsWith('.sql'))
    .sort();
  for (const archivo of archivos.reverse()) {
    const sql = readFileSync(join(CARPETA_MIGRACIONES, archivo), 'utf8');
    const bloque = MARCADORES.exec(sql)?.[1];
    if (bloque !== undefined) {
      const slugs = [...bloque.matchAll(/'([^']*)'/g)].map((m) => m[1] ?? '');
      return { archivo, slugs };
    }
  }
  throw new Error('Ninguna migración define la lista de slugs reservados');
}

describe('slugs reservados en la base', () => {
  it('la última migración que los define es la 0020 o posterior', () => {
    const { archivo } = listaDeLaBase();
    expect(archivo >= '0020').toBe(true);
  });

  it('la lista del check es igual a SLUGS_RESERVADOS', () => {
    const { slugs } = listaDeLaBase();
    expect(new Set(slugs).size).toBe(slugs.length);
    expect([...slugs].sort()).toEqual([...SLUGS_RESERVADOS].sort());
  });
});
