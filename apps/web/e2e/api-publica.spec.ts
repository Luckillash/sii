import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Fase 11: API pública y documentación. SOLO lo que no escribe en la base (es producción)
// ni sale al SII: la especificación, la página de documentación (con axe) y los rechazos
// sin API key o con una inválida, que se responden antes de tocar nada. La emisión por la
// API se prueba con Vitest y dobles, y a mano con `scripts/ejemplo-api/emitir.mjs`.
//
//   pnpm --filter web test:e2e api-publica

const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const CLAVE_INVALIDA = `sk_test_${'0'.repeat(64)}`;

test('GET /api/v1/openapi.json es OpenAPI 3.1 y público', async ({ request }) => {
  const r = await request.get('/api/v1/openapi.json');
  expect(r.status()).toBe(200);
  expect(r.headers()['content-type']).toContain('application/json');
  const espec = await r.json();
  expect(espec.openapi).toBe('3.1.0');
  expect(Object.keys(espec.paths)).toContain('/documentos');
  expect(Object.keys(espec.webhooks)).toContain('documento.aceptado');
});

for (const [metodo, ruta] of [
  ['GET', '/api/v1/documentos'],
  ['POST', '/api/v1/documentos'],
  ['GET', '/api/v1/folios'],
  ['GET', '/api/v1/envios/4f0c9b7a-2d1e-4c3b-8a59-6e7d8c9b0a1f'],
] as const) {
  test(`${metodo} ${ruta} sin API key responde 401 no_autenticado`, async ({ request }) => {
    const r = await request.fetch(ruta, { method: metodo, maxRedirects: 0 });
    expect(r.status()).toBe(401);
    expect(r.headers()['cache-control']).toContain('no-store');
    const cuerpo = await r.json();
    expect(cuerpo.error.codigo).toBe('no_autenticado');
    expect(typeof cuerpo.error.mensaje).toBe('string');
  });
}

test('una API key inexistente responde 401 clave_invalida', async ({ request }) => {
  const r = await request.get('/api/v1/documentos', {
    headers: { Authorization: `Bearer ${CLAVE_INVALIDA}` },
  });
  expect(r.status()).toBe(401);
  expect((await r.json()).error.codigo).toBe('clave_invalida');
});

test('/api/cron/webhooks sin Bearer responde 401', async ({ request }) => {
  const r = await request.post('/api/cron/webhooks');
  expect(r.status()).toBe(401);
});

test('/docs/api se ve sin sesión, enlaza la especificación y pasa axe', async ({ page }) => {
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(e.message));
  const respuesta = await page.goto('/docs/api');
  expect(respuesta?.status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1, name: 'API de Boletéame' })).toBeVisible();
  await expect(page.locator('a[href="/api/v1/openapi.json"]').first()).toBeVisible();
  await expect(page.locator('#webhooks')).toBeVisible();
  await expect(page.locator('#error-idempotencia_conflicto')).toHaveCount(1);
  const axe = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
  expect(axe.violations).toEqual([]);
  expect(errores).toEqual([]);
});
