import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// Quién crea el cliente con service_role (salta RLS). Revisado en la Fase 13, punto 1: cada
// uno filtra por la organización correcta o es legítimamente global. Un módulo nuevo que lo
// importe hace fallar esta prueba hasta que alguien revise sus consultas y lo agregue aquí.
//
// Para el resto, lo normal es recibir el cliente inyectado (`ClienteServicio` como tipo) de
// uno de estos módulos de dependencias, con el `organizacionId` ya verificado.

const SRC = fileURLToPath(new URL('../../', import.meta.url));

/** Ruta (desde src/) → de dónde sale la organización con que filtra. */
const REVISADOS: Record<string, string> = {
  'app/[org]/configuracion/certificados/acciones.ts':
    'membresía de la sesión (getUser) en registrar_certificado, revocar y eliminar',
  'server/alertas/index.ts': 'cron de alertas: global por diseño (todas las organizaciones)',
  'server/api-publica/dependencias.ts':
    'organización de la API key autenticada (repositorio.test.ts lo verifica)',
  'server/certificacion/dependencias.ts':
    'contexto verificado (membresía o API key) de certificación, folios y emisión',
  'server/documentos/reenviar.ts': 'membresía de la sesión',
  'server/documentos/revisar.ts': 'membresía de la sesión',
  'server/estado/index.ts': '/estado: agregados globales, devuelve solo niveles',
  'server/pagos/index.ts':
    'membresía (acciones de plan) o cliente de Flow verificado con la API firmada (callbacks, cron)',
  'server/seguimiento/dependencias.ts': 'cron de seguimiento (global) o membresía de la sesión',
  'server/webhooks/dependencias.ts': 'cron de entregas de webhooks: global por diseño',
};

const IMPORTA_CLIENTE =
  /import\s*\{[^}]*\bclienteServicio\b[^}]*\}\s*from\s*['"](?:@\/server\/supabase\/service|(?:\.\.?\/)+(?:supabase\/)?service)['"]/;

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const ruta = join(dir, e.name);
    if (e.isDirectory()) return archivos(ruta);
    return /\.tsx?$/.test(e.name) && !/\.test(-util)?\.tsx?$/.test(e.name) ? [ruta] : [];
  });
}

describe('clienteServicio (service_role)', () => {
  const usan = archivos(SRC)
    .filter((ruta) => IMPORTA_CLIENTE.test(readFileSync(ruta, 'utf8')))
    .map((ruta) => relative(SRC, ruta).replaceAll('\\', '/'))
    .sort();

  it('solo lo importan los módulos revisados', () => {
    expect(usan).toEqual(Object.keys(REVISADOS).sort());
  });

  it('nunca desde un componente cliente', () => {
    const cliente = usan.filter((ruta) =>
      /^\s*['"]use client['"]/m.test(readFileSync(join(SRC, ruta), 'utf8').slice(0, 200)),
    );
    expect(cliente).toEqual([]);
  });
});
