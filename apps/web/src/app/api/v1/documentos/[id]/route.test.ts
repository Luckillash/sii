import { beforeEach, describe, expect, it, vi } from 'vitest';

// Cableado de la ruta (PLAN-SAAS Fase 11): configuración y delegación en `manejarApi`
// con su alcance. Los manejadores se prueban en `server/api-publica/`.

const { manejarApi } = vi.hoisted(() => ({
  manejarApi: vi.fn(async () => new Response(null, { status: 299 })),
}));
vi.mock('@/server/api-publica', async (original) => ({
  ...(await original<typeof import('@/server/api-publica')>()),
  manejarApi,
}));

const { GET, runtime, dynamic, maxDuration } = await import('./route');
const ID = '22222222-2222-4222-8222-222222222222';
const peticion = (metodo: string) =>
  new Request('https://boleteame.dev/api/v1/x', { method: metodo });

beforeEach(() => {
  manejarApi.mockClear();
});

describe('documentos/[id]', () => {
  it('Node.js, dinámica y maxDuration de 60 s', () => {
    expect(runtime).toBe('nodejs');
    expect(dynamic).toBe('force-dynamic');
    expect(maxDuration).toBe(60);
  });

  it('GET: delega en manejarApi con la ruta y el alcance', async () => {
    const r = await GET(peticion('GET'), { params: Promise.resolve({ id: ID }) });
    expect(r.status).toBe(299);
    expect(manejarApi).toHaveBeenCalledWith(
      expect.any(Request),
      { ruta: 'GET /documentos/{id}', alcance: 'documentos:leer' },
      expect.any(Function),
    );
  });
});
