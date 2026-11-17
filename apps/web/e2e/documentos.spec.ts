import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Fase 8: documentos emitidos y detalle de envíos. SOLO lo que no escribe en la base (es
// producción) ni sale al SII: sin sesión, las rutas quedan protegidas por el proxy; con
// sesión (opcional), se abre la lista, se filtra por la URL, se abre el panel de detalle y
// se revisa la accesibilidad SIN pulsar «Consultar estado en el SII», «Reenviar al
// receptor» ni las descargas. Las acciones se prueban con Vitest y dobles
// (`acciones.test.ts`, `server/documentos/*.test.ts`).
//
// La parte con sesión necesita una sesión guardada de Playwright (`storageState`):
//   E2E_SESION=ruta/a/sesion.json E2E_ORG=<slug> pnpm --filter web test:e2e documentos
// Sin esas variables se omite.

const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

for (const ruta of [
  '/acme/documentos',
  '/acme/documentos?periodo=todos&estado=incierto',
  '/acme/envios/4f0c9b7a-2d1e-4c3b-8a59-6e7d8c9b0a1f',
]) {
  test(`${ruta} sin sesión redirige a ingresar con ?siguiente=`, async ({ request }) => {
    const r = await request.get(ruta, { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    const destino = new URL(r.headers().location ?? '', 'http://x');
    expect(destino.pathname).toBe('/ingresar');
    expect(destino.searchParams.get('siguiente')).toBe(ruta);
  });
}

const sesion = process.env.E2E_SESION;
const org = process.env.E2E_ORG;

test.describe('con sesión', () => {
  test.skip(!sesion || !org, 'Sin E2E_SESION y E2E_ORG');
  test.use({ storageState: sesion });

  test('lista, filtros en la URL, panel de detalle y axe (sin acciones)', async ({ page }) => {
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(e.message));
    // Cualquier POST de una Server Action delataría una consulta al SII o un reenvío.
    const acciones: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.headers()['next-action']) acciones.push(r.url());
    });

    const respuesta = await page.goto(`/${org}/documentos?periodo=todos`);
    expect(respuesta?.status()).toBe(200);
    await expect(page).toHaveTitle('Documentos emitidos · Boletéame');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Documentos emitidos' }),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'Documentos emitidos' }).first()).toHaveAttribute(
      'aria-current',
      'page',
    );

    if ((await page.getByText('Aún no hay empresas').count()) === 0) {
      // Filtrar es un GET: los filtros quedan en la URL.
      await page.getByLabel('Estado').selectOption('aceptado');
      await page.getByRole('button', { name: 'Filtrar' }).click();
      await expect(page).toHaveURL(/estado=aceptado/);
      await page.getByLabel('Estado').selectOption('');
      await page.getByRole('button', { name: 'Filtrar' }).click();

      const fila = page.locator('tbody tr[aria-selected]').first();
      if ((await fila.count()) > 0) {
        await fila.focus();
        await page.keyboard.press('Enter');
        await expect(page).toHaveURL(/doc=/);
        const panel = page.getByRole('region', { name: /N\.º/ });
        await expect(panel).toBeVisible();
        await expect(
          panel.getByRole('button', { name: /Consultar estado en el SII/ }),
        ).toBeVisible();
      }
    }

    const axe = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
    expect(axe.violations.map((v) => ({ regla: v.id, nodos: v.nodes.length }))).toEqual([]);
    expect(errores).toEqual([]);
    expect(acciones).toEqual([]);
  });

  test('un envío inexistente responde 404', async ({ page }) => {
    const r = await page.goto(`/${org}/envios/00000000-0000-4000-8000-000000000000`);
    expect(r?.status()).toBe(404);
  });
});
