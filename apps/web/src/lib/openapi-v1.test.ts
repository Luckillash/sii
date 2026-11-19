import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ALCANCES,
  ALCANCES_OFRECIDOS,
  CODIGOS_ERROR,
  type CodigoError,
  EVENTO_PRUEBA,
  EVENTOS_WEBHOOK,
} from './api-publica';
import {
  ESPECIFICACION_V1,
  type MetodoOpenApi,
  type OperacionOpenApi,
  RUTAS_V1,
  respuestasDeError,
} from './openapi-v1';

// La especificación tiene que cubrir las rutas del diseño de la Fase 11 (§2.2) y, si ya
// existen en disco, las de `app/api/v1/**/route.ts` con sus métodos.

/** Rutas y métodos del diseño (PLAN-SAAS Fase 11, §2.2). */
const RUTAS_DEL_DISENO: Record<string, MetodoOpenApi[]> = {
  '/documentos': ['get', 'post'],
  '/documentos/lote': ['post'],
  '/documentos/{id}': ['get'],
  '/documentos/{id}/xml': ['get'],
  '/documentos/{id}/pdf': ['get'],
  '/folios': ['get'],
  '/folios/solicitudes': ['post'],
  '/envios/{id}': ['get'],
  '/openapi.json': ['get'],
};

const DIR_V1 = fileURLToPath(new URL('../app/api/v1/', import.meta.url));

function rutasEnDisco(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const salida: string[] = [];
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) salida.push(...rutasEnDisco(ruta));
    else if (nombre === 'route.ts') salida.push(ruta);
  }
  return salida;
}

/** `…/v1/documentos/[id]/xml/route.ts` → `/documentos/{id}/xml`. */
function rutaOpenApi(archivo: string): string {
  const segmentos = relative(DIR_V1, archivo).split(sep).slice(0, -1);
  return `/${segmentos.map((s) => s.replace(/^\[(.+)\]$/, '{$1}')).join('/')}`;
}

function metodosExportados(archivo: string): MetodoOpenApi[] {
  const fuente = readFileSync(archivo, 'utf8');
  return (['get', 'post'] as const).filter((m) =>
    new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m.toUpperCase()}\\b`).test(fuente),
  );
}

function operaciones(): [string, MetodoOpenApi, OperacionOpenApi][] {
  return Object.entries(RUTAS_V1).flatMap(([ruta, metodos]) =>
    (Object.entries(metodos) as [MetodoOpenApi, OperacionOpenApi][]).map(
      ([m, op]) => [ruta, m, op] as [string, MetodoOpenApi, OperacionOpenApi],
    ),
  );
}

describe('especificación OpenAPI v1', () => {
  it('es OpenAPI 3.1 con el servidor de producción y bearer', () => {
    expect(ESPECIFICACION_V1.openapi).toBe('3.1.0');
    expect(ESPECIFICACION_V1.servers[0].url).toBe('https://boleteame.dev/api/v1');
    expect(ESPECIFICACION_V1.components.securitySchemes.bearerAuth.scheme).toBe('bearer');
  });

  it('cubre exactamente las rutas y métodos del diseño', () => {
    const actual = Object.fromEntries(
      Object.entries(RUTAS_V1).map(([r, ms]) => [r, Object.keys(ms).sort()]),
    );
    const esperado = Object.fromEntries(
      Object.entries(RUTAS_DEL_DISENO).map(([r, ms]) => [r, [...ms].sort()]),
    );
    expect(actual).toEqual(esperado);
  });

  it('cada route.ts que ya existe bajo app/api/v1 tiene su ruta y sus métodos', () => {
    for (const archivo of rutasEnDisco(DIR_V1)) {
      const ruta = rutaOpenApi(archivo);
      expect(Object.keys(RUTAS_V1), `falta ${ruta} en la especificación`).toContain(ruta);
      for (const m of metodosExportados(archivo)) {
        expect(RUTAS_V1[ruta]?.[m], `falta ${m.toUpperCase()} ${ruta}`).toBeDefined();
      }
    }
  });

  it('el route.ts de openapi.json existe (segmento con punto)', () => {
    expect(rutasEnDisco(DIR_V1).map(rutaOpenApi)).toContain('/openapi.json');
  });

  it('operationId únicos', () => {
    const ids = operaciones().map(([, , op]) => op.operationId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('cada operación con alcance usa uno ofrecido; certificacion:gestionar no aparece', () => {
    for (const [ruta, m, op] of operaciones()) {
      if (op['x-alcance'] === null) {
        expect(ruta).toBe('/openapi.json');
        expect(op.security).toEqual([]);
        continue;
      }
      expect(ALCANCES_OFRECIDOS as readonly string[], `${m} ${ruta}`).toContain(op['x-alcance']);
    }
    expect(JSON.stringify(ESPECIFICACION_V1)).not.toContain('certificacion:gestionar');
    expect(ALCANCES).toContain('certificacion:gestionar');
  });

  it('los errores de cada operación existen y su status está en las respuestas', () => {
    for (const [ruta, m, op] of operaciones()) {
      for (const codigo of op['x-errores']) {
        expect(CODIGOS_ERROR, `${codigo} en ${m} ${ruta}`).toHaveProperty(codigo);
        const status = String(CODIGOS_ERROR[codigo as CodigoError]);
        expect(op.responses[status], `${status} en ${m} ${ruta}`).toBeDefined();
        expect(op.responses[status]?.description).toContain(codigo);
      }
    }
  });

  it('las rutas protegidas declaran los errores de autenticación', () => {
    for (const [ruta, m, op] of operaciones()) {
      if (op['x-alcance'] === null) continue;
      for (const c of ['no_autenticado', 'clave_revocada', 'alcance_insuficiente'] as const) {
        expect(op['x-errores'], `${c} en ${m} ${ruta}`).toContain(c);
      }
    }
  });

  it('las emisiones exigen Idempotency-Key; timbrar folios la acepta', () => {
    const cabecera = (op?: OperacionOpenApi) =>
      op?.parameters?.find((p) => p.in === 'header' && p.name === 'Idempotency-Key');
    expect(cabecera(RUTAS_V1['/documentos']?.post)?.required).toBe(true);
    expect(cabecera(RUTAS_V1['/documentos/lote']?.post)?.required).toBe(true);
    expect(cabecera(RUTAS_V1['/folios/solicitudes']?.post)?.required).toBe(false);
  });

  it('respuestasDeError agrupa por status y agrega Retry-After a 409, 429 y 503', () => {
    const r = respuestasDeError(['clave_invalida', 'clave_revocada', 'idempotencia_en_curso']);
    expect(Object.keys(r)).toEqual(['401', '409']);
    expect(r['401']?.description).toContain('clave_invalida');
    expect(r['401']?.description).toContain('clave_revocada');
    expect(r['409']?.headers?.['Retry-After']).toBeDefined();
    expect(r['401']?.headers).toBeUndefined();
  });

  it('declara un webhook por evento más la prueba', () => {
    expect(Object.keys(ESPECIFICACION_V1.webhooks).sort()).toEqual(
      [...EVENTOS_WEBHOOK, EVENTO_PRUEBA].sort(),
    );
  });

  it('todas las $ref internas apuntan a un esquema existente', () => {
    const texto = JSON.stringify(ESPECIFICACION_V1);
    const refs = [...texto.matchAll(/"\$ref":"#\/components\/schemas\/([A-Za-z]+)/g)].map(
      (m) => m[1] ?? '',
    );
    expect(refs.length).toBeGreaterThan(0);
    for (const nombre of refs) {
      expect(ESPECIFICACION_V1.components.schemas, nombre).toHaveProperty(nombre);
    }
  });

  it('se serializa a JSON sin pérdidas', () => {
    expect(JSON.parse(JSON.stringify(ESPECIFICACION_V1))).toEqual(ESPECIFICACION_V1);
  });
});
