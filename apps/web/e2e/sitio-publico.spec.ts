import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

// Fase 12: la landing, el layout público (cabecera, pie) y las demás páginas públicas
// (contacto, ayuda, estado y legales). Solo lectura: no inicia sesión, no envía el
// formulario de contacto, no escribe en la base ni toca el SII (`/estado` solo lee
// agregados). Corre en claro, oscuro y móvil (proyectos de playwright.config.ts). No
// correr contra producción: se usa con el `next dev` local de playwright.config.ts.

const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Páginas públicas que pasan axe y la revisión de palabras prohibidas. */
const PAGINAS_PUBLICAS = [
  '/',
  '/contacto',
  '/ayuda',
  '/estado',
  '/legal/terminos',
  '/legal/privacidad',
] as const;

/** Documentos que todavía no existen (factura y compañía llegan en la Fase 14). */
const PROHIBIDAS = [
  // «facturación» (el cobro del plan) sí se permite.
  /factura(?!ci[oó]n)/i,
  /libros? de compras/i,
  /notas? de crédito/i,
  /guías? de despacho/i,
  /documentos recibidos/i,
];

/**
 * Descargos que nombran lo que NO hacemos (los términos deben decirlo). Se quitan del
 * texto antes de buscar: el resto de la página no puede nombrar esos documentos.
 */
const DESCARGOS = [
  'Hoy Boletéame no emite facturas, notas de crédito o débito, guías de despacho ni lleva el Registro de Compras y Ventas.',
];

/**
 * Carga una página pública lista para axe. No usa `networkidle`: en `/contacto` el widget
 * de Turnstile (cuando hay clave en `.env.local`) mantiene conexiones abiertas con
 * Cloudflare y la red nunca queda quieta.
 */
async function cargar(page: Page, ruta: string) {
  await page.goto(ruta);
  await page.waitForLoadState('load');
  await expect(page.locator('main#contenido')).toBeVisible();
}

async function axeSinViolaciones(page: Page) {
  // El iframe de Turnstile es de Cloudflare: no es nuestro marcado.
  const resultado = await new AxeBuilder({ page })
    .withTags(ETIQUETAS_WCAG)
    .exclude('iframe[src*="challenges.cloudflare.com"]')
    .analyze();
  return resultado.violations.map((v) => ({
    regla: v.id,
    impacto: v.impact,
    nodos: v.nodes.map((n) => n.target.join(' ')),
  }));
}

async function abrirMenuSiHaceFalta(page: Page) {
  const boton = page.getByRole('button', { name: 'Menú' });
  if (await boton.isVisible()) {
    await expect(boton).toHaveAttribute('aria-expanded', 'false');
    await boton.click();
    await expect(boton).toHaveAttribute('aria-expanded', 'true');
  }
}

test('la landing carga con su título, sin errores de consola', async ({ page }) => {
  const errores: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errores.push(m.text());
  });
  page.on('pageerror', (e) => errores.push(e.message));

  const respuesta = await page.goto('/');
  expect(respuesta?.status()).toBe(200);
  await expect(page).toHaveTitle('Boletéame · Boletas electrónicas ante el SII');
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Emite, firma y envía tus boletas electrónicas sin vueltas.',
    }),
  ).toBeVisible();
  await expect(page.locator('main#contenido')).toHaveCount(1);
  await page.waitForLoadState('networkidle');
  expect(errores).toEqual([]);
});

for (const ruta of PAGINAS_PUBLICAS) {
  test(`${ruta}: no promete documentos que todavía no existen`, async ({ page }) => {
    const respuesta = await page.goto(ruta);
    expect(respuesta?.status()).toBe(200);
    let texto = ((await page.locator('main').textContent()) ?? '').replace(/\s+/g, ' ');
    for (const descargo of DESCARGOS) texto = texto.replace(descargo, '');
    for (const prohibido of PROHIBIDAS) expect(texto, String(prohibido)).not.toMatch(prohibido);
  });
}

test('las secciones de las anclas existen', async ({ page }) => {
  await page.goto('/');
  for (const [id, titulo] of [
    ['producto', 'Todo el ciclo de la boleta, en un solo lugar'],
    ['certificacion', 'Te llevamos paso a paso por la certificación'],
    ['api', 'Una API para tu sistema'],
    ['precios', 'Precios'],
  ] as const) {
    await expect(
      page.locator(`#${id}`).getByRole('heading', { level: 2, name: titulo }),
    ).toHaveCount(1);
  }
  await expect(page.locator('#certificacion ol > li')).toHaveCount(5);
});

test('la cabecera enlaza a las secciones, la documentación y el ingreso', async ({ page }) => {
  await page.goto('/');
  await abrirMenuSiHaceFalta(page);
  const nav = page.getByRole('navigation', { name: 'Principal' });
  await expect(nav.getByRole('link', { name: 'Producto' })).toHaveAttribute('href', '/#producto');
  await expect(nav.getByRole('link', { name: 'Certificación' })).toHaveAttribute(
    'href',
    '/#certificacion',
  );
  await expect(nav.getByRole('link', { name: 'Desarrolladores' })).toHaveAttribute(
    'href',
    '/docs/api',
  );
  await expect(nav.getByRole('link', { name: 'Precios' })).toHaveAttribute('href', '/#precios');
  const cabecera = page.getByRole('banner');
  await expect(cabecera.getByRole('link', { name: 'Boletéame' })).toHaveAttribute('href', '/');
  await expect(cabecera.getByRole('link', { name: 'Ingresar' })).toHaveAttribute(
    'href',
    '/ingresar',
  );
  await expect(cabecera.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute(
    'href',
    '/crear-cuenta',
  );

  // Elegir una sección lleva a su ancla (y en móvil cierra el menú).
  await nav.getByRole('link', { name: 'Precios' }).click();
  await expect(page).toHaveURL(/\/#precios$/);
  await expect(page.locator('#precios')).toBeInViewport();
  const boton = page.getByRole('button', { name: 'Menú' });
  if (await boton.isVisible()) await expect(boton).toHaveAttribute('aria-expanded', 'false');
});

test('el menú móvil se cierra con Escape y devuelve el foco', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'solo móvil');
  await page.goto('/');
  await abrirMenuSiHaceFalta(page);
  await page.getByRole('navigation', { name: 'Principal' }).getByRole('link').first().focus();
  await page.keyboard.press('Escape');
  const boton = page.getByRole('button', { name: 'Menú' });
  await expect(boton).toHaveAttribute('aria-expanded', 'false');
  await expect(boton).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Principal' })).toBeHidden();
});

test('el pie trae la leyenda y los enlaces del sitio', async ({ page }) => {
  await page.goto('/');
  const pie = page.getByRole('contentinfo');
  await expect(pie).toContainText(
    'Boletéame es un servicio independiente y no está afiliado al Servicio de Impuestos Internos.',
  );
  const nav = pie.getByRole('navigation', { name: 'Pie de página' });
  for (const [nombre, href] of [
    ['Producto', '/#producto'],
    ['Certificación', '/#certificacion'],
    ['Documentación de la API', '/docs/api'],
    ['Precios', '/#precios'],
    ['Ayuda', '/ayuda'],
    ['Estado del servicio', '/estado'],
    ['Contacto', '/contacto'],
    ['Términos', '/legal/terminos'],
    ['Privacidad', '/legal/privacidad'],
  ] as const) {
    await expect(nav.getByRole('link', { name: nombre, exact: true })).toHaveAttribute(
      'href',
      href,
    );
  }
});

test('los precios se ven con los planes de la grilla', async ({ page }) => {
  await page.goto('/');
  const precios = page.locator('#precios');
  for (const [plan, monto] of [
    ['Pyme', '$ 14.990'],
    ['Contador', '$ 49.990'],
    ['API', '$ 39.990'],
  ] as const) {
    const tarjeta = precios.getByRole('article', { name: plan, exact: true });
    await expect(tarjeta).toContainText(monto);
    await expect(tarjeta).toContainText('al mes');
    await expect(tarjeta.getByRole('link', { name: `Elegir plan ${plan}` })).toHaveAttribute(
      'href',
      '/crear-cuenta',
    );
  }
  await expect(precios.getByRole('article', { name: 'Contador', exact: true })).toContainText(
    'Varias empresas',
  );
  await expect(precios).toContainText('IVA incluido');
  await expect(precios).toContainText('Gratis y sin plazo');
  await expect(precios.getByRole('link', { name: 'Hablar con ventas' })).toHaveAttribute(
    'href',
    '/contacto?motivo=ventas',
  );
});

test('el ejemplo de la API es el de la v1', async ({ page }) => {
  await page.goto('/');
  const api = page.locator('#api');
  await expect(api).toContainText('POST https://boleteame.dev/api/v1/documentos');
  await expect(api).toContainText('Authorization: Bearer sk_test_…');
  await expect(api).toContainText('Idempotency-Key:');
  await expect(api.getByRole('link', { name: 'Leer la documentación' })).toHaveAttribute(
    'href',
    '/docs/api',
  );
});

test('«Saltar al contenido» lleva al main', async ({ page }, info) => {
  test.skip(info.project.name === 'movil', 'sin teclado');
  await page.goto('/');
  await page.keyboard.press('Tab');
  const saltar = page.getByRole('link', { name: 'Saltar al contenido' });
  await expect(saltar).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main#contenido')).toBeFocused();
});

for (const ruta of PAGINAS_PUBLICAS) {
  test(`axe sin violaciones en ${ruta}`, async ({ page }) => {
    await cargar(page, ruta);
    expect(await axeSinViolaciones(page)).toEqual([]);
  });
}

test('/ayuda#por-verificar abre la pregunta', async ({ page }) => {
  await page.goto('/ayuda#por-verificar');
  await expect(page.locator('details#por-verificar')).toHaveAttribute('open', '');
  // Un salto dentro de la página (hashchange) también abre la pregunta.
  const otra = page.locator('main details[id]:not([open])').first();
  const id = await otra.getAttribute('id');
  await page.evaluate((h) => {
    window.location.hash = h;
  }, `#${id}`);
  await expect(page.locator(`details#${id}`)).toHaveAttribute('open', '');
});

test('axe sin violaciones con el menú móvil abierto', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'solo móvil');
  await page.goto('/');
  await abrirMenuSiHaceFalta(page);
  const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
  expect(resultado.violations.map((v) => v.id)).toEqual([]);
});

for (const ruta of PAGINAS_PUBLICAS) {
  test(`${ruta}: el tema fijado con data-theme también pasa axe`, async ({ page }, info) => {
    test.skip(info.project.name !== 'claro', 'basta con un proyecto');
    await cargar(page, ruta);
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    expect(await axeSinViolaciones(page)).toEqual([]);
  });
}

test('sin desborde horizontal', async ({ page }) => {
  await page.goto('/');
  const desborde = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(desborde).toBeLessThanOrEqual(0);
});

test('sin desborde horizontal a 320 px', async ({ page }, info) => {
  test.skip(info.project.name !== 'movil', 'solo móvil');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await abrirMenuSiHaceFalta(page);
  const desborde = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(desborde).toBeLessThanOrEqual(0);
});
