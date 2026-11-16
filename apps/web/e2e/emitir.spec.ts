import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Fase 7: emisión de boletas. SOLO lo que no escribe en la base (es producción) ni sale al
// SII. Sin sesión, la ruta queda protegida por el proxy. Con sesión (opcional), se abre el
// formulario, se escribe una línea y se revisan los totales y la accesibilidad SIN pulsar
// «Emitir boleta» ni «Guardar borrador». El ensayo, la emisión y los borradores se prueban
// con Vitest y dobles (`acciones.test.ts`).
//
// La parte con sesión necesita una sesión guardada de Playwright (`storageState`) de un
// usuario con rol de emisor o superior:
//   E2E_SESION=ruta/a/sesion.json E2E_ORG=<slug> pnpm --filter web test:e2e emitir
// Sin esas variables se omite.

const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

for (const ruta of ['/acme/emitir', '/acme/emitir?empresa=otra&borrador=x']) {
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

  test('muestra el formulario, calcula los totales y pasa axe (sin emitir)', async ({ page }) => {
    const errores: string[] = [];
    page.on('pageerror', (e) => errores.push(e.message));
    // Cualquier POST de una Server Action delataría una emisión o un guardado.
    const acciones: string[] = [];
    page.on('request', (r) => {
      if (r.method() === 'POST' && r.headers()['next-action']) acciones.push(r.url());
    });

    const respuesta = await page.goto(`/${org}/emitir`);
    expect(respuesta?.status()).toBe(200);
    await expect(page).toHaveTitle('Emitir documento · Boletéame');
    await expect(page.getByRole('heading', { level: 1, name: 'Emitir boleta' })).toBeVisible();

    const sinEmpresa = page.getByText('Aún no hay empresas');
    const lector = page.getByText(/no puedes emitir/);
    if ((await sinEmpresa.count()) > 0 || (await lector.count()) > 0) {
      const axe = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
      expect(axe.violations.map((v) => ({ regla: v.id, nodos: v.nodes.length }))).toEqual([]);
      return;
    }

    // Formulario: tipo, ambiente, receptor por defecto y una línea.
    await expect(page.getByRole('radio', { name: /Boleta electrónica/ })).toBeChecked();
    await expect(page.getByText('Cliente General').first()).toBeVisible();
    await page.getByLabel('Producto o servicio, línea 1').fill('Prueba e2e');
    await page.getByLabel('Precio unitario con IVA, línea 1').fill('1190');
    await page.getByLabel('Precio unitario con IVA, línea 1').blur();
    await expect(page.getByLabel('Precio unitario con IVA, línea 1')).toHaveValue('1.190');

    const resumen = page.getByRole('complementary', { name: 'Resumen' });
    await expect(resumen.getByText('$ 1.000', { exact: true })).toBeVisible();
    await expect(resumen.getByText('$ 190', { exact: true })).toBeVisible();
    await expect(resumen.getByRole('button', { name: /Emitir boleta/ })).toBeVisible();

    // Boleta exenta: la línea queda exenta y el control, fijo.
    await page.getByRole('radio', { name: /Boleta exenta electrónica/ }).check();
    const exento = page.getByRole('checkbox', { name: /Exento, línea 1/ });
    await expect(exento).toBeChecked();
    await expect(exento).toBeDisabled();

    const axe = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
    expect(axe.violations.map((v) => ({ regla: v.id, nodos: v.nodes.length }))).toEqual([]);
    expect(errores).toEqual([]);
    expect(acciones).toEqual([]);

    // No dejar el borrador de prueba en la sesión del navegador.
    await page.evaluate(() => {
      try {
        for (const k of Object.keys(sessionStorage)) {
          if (k.startsWith('boleteame:emision:')) sessionStorage.removeItem(k);
        }
      } catch {
        // Sin almacenamiento no hay nada que limpiar.
      }
    });
  });

  test('no desborda en móvil: el resumen va debajo del formulario', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`/${org}/emitir`);
    const ancho = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(ancho).toBeLessThanOrEqual(375);
  });
});
