import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Humo contra un deploy de Vercel (E2E_URL). Solo lectura: no escribe nada ni toca el SII.
// Fase 1: el design system llega a producción (tokens, fuentes, temas) y el catálogo
// /_ds no queda expuesto.

const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

test('la portada carga sin errores de consola y pasa axe', async ({ page }) => {
  const errores: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });
  page.on('pageerror', (e) => errores.push(e.message));

  const respuesta = await page.goto('/');
  expect(respuesta?.status()).toBe(200);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { level: 1, name: 'Boletéame' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es-CL');

  const axe = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  expect(errores).toEqual([]);
});

test('los tokens y las fuentes IBM Plex llegan a producción', async ({ page }, info) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  const estilos = await page.evaluate(async () => {
    await document.fonts.ready;
    const raiz = getComputedStyle(document.documentElement);
    const cuerpo = getComputedStyle(document.body);
    return {
      sello: raiz.getPropertyValue('--sello').trim(),
      fondo: cuerpo.backgroundColor,
      familia: cuerpo.fontFamily,
      // La portada usa Plex Sans (se descarga); Plex Mono queda declarada y se descarga
      // en las páginas con montos, RUT o folios.
      plexSans: [...document.fonts].some(
        (f) => f.family === 'IBM Plex Sans' && f.status === 'loaded',
      ),
      plexMono: [...document.fonts].some((f) => f.family === 'IBM Plex Mono'),
    };
  });
  const oscuro = info.project.name === 'oscuro';
  expect(estilos.sello).toBe(oscuro ? '#5ec8bd' : '#0b5f5a');
  // --surface: #f6f5f0 (claro) / #111615 (oscuro)
  expect(estilos.fondo).toBe(oscuro ? 'rgb(17, 22, 21)' : 'rgb(246, 245, 240)');
  expect(estilos.familia).toMatch(/IBM Plex Sans/);
  expect(estilos.plexSans).toBe(true);
  expect(estilos.plexMono).toBe(true);
});

test('el catálogo /_ds no existe en el deploy', async ({ request }) => {
  for (const ruta of ['/_ds', '/_ds/app', '/_ds/ingreso']) {
    const r = await request.get(ruta);
    expect(r.status(), ruta).toBe(404);
  }
});

test('la portada no desborda en móvil', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'solo móvil');
  await page.goto('/');
  const desborde = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(desborde).toBeLessThanOrEqual(0);
});
