import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Fase 1: cada componente pasa axe (WCAG 2.1 AA, contraste 4,5:1) en claro, oscuro y
// móvil (proyectos de playwright.config.ts), y el foco de teclado es visible.

const PAGINAS = ['/_ds', '/_ds/app', '/_ds/ingreso'];
const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

for (const ruta of PAGINAS) {
  test(`axe sin violaciones en ${ruta}`, async ({ page }) => {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
    const resumen = resultado.violations.map((v) => ({
      regla: v.id,
      impacto: v.impact,
      nodos: v.nodes.map((n) => n.target.join(' ')),
    }));
    expect(resumen).toEqual([]);
  });

  test(`sin desborde horizontal en ${ruta}`, async ({ page }) => {
    await page.goto(ruta);
    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde).toBeLessThanOrEqual(0);
  });
}

test('el tema fijado con data-theme también pasa axe', async ({ page }, info) => {
  test.skip(info.project.name !== 'claro', 'basta con un proyecto');
  await page.goto('/_ds');
  await page.getByLabel('Oscuro').check();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
  expect(resultado.violations.map((v) => v.id)).toEqual([]);
});

test('el foco de teclado se ve con focus-ring', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'sin teclado');
  await page.goto('/_ds');
  const boton = page.getByRole('button', { name: 'Emitir boleta' });
  await boton.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(boton).toBeFocused();
  const sombra = await boton.evaluate((el) => getComputedStyle(el).boxShadow);
  const anillo = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--focus-ring').trim(),
  );
  expect(anillo).not.toBe('');
  expect(sombra).not.toBe('none');
});

test('TablaDTE se selecciona con el teclado', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'sin teclado');
  await page.goto('/_ds');
  const fila = page.locator('#TablaDTE tbody tr', { hasText: 'Panadería La Espiga' });
  await fila.focus();
  await page.keyboard.press('Enter');
  await expect(fila).toHaveAttribute('aria-selected', 'true');
});

test('Dialogo abre, devuelve el foco y cierra con Escape', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'sin teclado');
  await page.goto('/_ds');
  const abrir = page.getByRole('button', { name: 'Solicitar folios' });
  await abrir.click();
  const dialogo = page.getByRole('dialog', { name: 'Solicitar 50 folios de boleta electrónica' });
  await expect(dialogo).toBeVisible();
  await expect(dialogo.getByRole('button', { name: 'Cancelar' })).toBeFocused();
  const axe = await new AxeBuilder({ page }).include('dialog').withTags(ETIQUETAS_WCAG).analyze();
  expect(axe.violations.map((v) => v.id)).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialogo).toBeHidden();
  await expect(abrir).toBeFocused();
});

test('CampoRut formatea al salir y avisa un dígito verificador malo', async ({ page }, info) => {
  test.skip(info.project.name !== 'claro', 'basta con un proyecto');
  await page.goto('/_ds');
  const campo = page.getByLabel('RUT de la empresa');
  await campo.fill('763547710');
  await campo.blur();
  await expect(campo).toHaveValue('76.354.771-0');
  await expect(campo).toHaveAttribute('aria-invalid', 'true');
  await expect(
    page.getByText('El dígito verificador no corresponde a este RUT.').first(),
  ).toBeVisible();
});

// Capturas por componente para comparar con los preview.html del design system.
test('capturas por componente', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'solo escritorio');
  await page.goto('/_ds');
  await page.waitForLoadState('networkidle');
  for (const seccion of await page.locator('[data-componente]').all()) {
    const nombre = await seccion.getAttribute('data-componente');
    await seccion.screenshot({ path: `test-results/capturas/${info.project.name}/${nombre}.png` });
  }
  for (const ruta of ['/_ds/app', '/_ds/ingreso']) {
    await page.goto(ruta);
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: `test-results/capturas/${info.project.name}${ruta.replaceAll('/', '_')}.png`,
      fullPage: true,
    });
  }
});
