import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Fase 2: organizaciones e invitaciones, SOLO lo que no escribe en la base (la base es
// producción). Sin sesión, sin usuarios ni organizaciones de prueba. El flujo completo
// (crear organización, invitar, aceptar, dos organizaciones aisladas) queda para la
// prueba e2e con usuarios reales del criterio de aceptación.
//
// Invitaciones inválidas: un token con forma incorrecta ni se consulta; uno con la
// forma correcta (64 hex) llama a `ver_invitacion`. Si esa RPC aún no existe (migración
// 0003 sin aplicar), la RPC responde error y la página muestra igual el mensaje de
// invitación inválida: la prueba pasa en ambos estados de la base.

const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const INVALIDA = 'La invitación venció, ya se usó o no existe';

test('/acme/tablero sin sesión redirige a ingresar con ?siguiente=', async ({ request }) => {
  const r = await request.get('/acme/tablero', { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  const destino = new URL(r.headers().location ?? '', 'http://x');
  expect(destino.pathname).toBe('/ingresar');
  expect(destino.searchParams.get('siguiente')).toBe('/acme/tablero');
});

test('/bienvenida sin sesión redirige a ingresar', async ({ request }) => {
  const r = await request.get('/bienvenida', { maxRedirects: 0 });
  expect(r.status()).toBe(307);
  expect(new URL(r.headers().location ?? '', 'http://x').pathname).toBe('/ingresar');
});

for (const token of ['token-falso', '0'.repeat(64)]) {
  test(`/invitacion/${token.slice(0, 12)}… muestra la invitación inválida y pasa axe`, async ({
    page,
  }) => {
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(e.message));

    const respuesta = await page.goto(`/invitacion/${token}`);
    expect(respuesta?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: INVALIDA })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ingresar' })).toHaveAttribute('href', '/ingresar');
    // El token va en la URL: no debe salir en la cabecera Referer hacia otros sitios.
    await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');

    const axe = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
    expect(axe.violations.map((v) => ({ regla: v.id, nodos: v.nodes.length }))).toEqual([]);
    expect(errores).toEqual([]);
  });
}
