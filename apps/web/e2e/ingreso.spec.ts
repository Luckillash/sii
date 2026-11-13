import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

// Pantallas de acceso (PLAN-SAAS Fase 2). Solo renderizan y validan en el cliente:
// ninguna prueba envía datos válidos a Supabase Auth (la base es producción). Las
// llamadas a Auth corren en Server Actions, así que no se pueden interceptar desde el
// navegador; la traducción de sus errores se prueba con Vitest
// (src/app/(auth)/_compartido/errores-auth.test.ts).

const ETIQUETAS_WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

const PANTALLAS = [
  { ruta: '/ingresar', titulo: 'Ingresar · Timbre', h1: 'Ingresar' },
  { ruta: '/crear-cuenta', titulo: 'Crear cuenta · Timbre', h1: 'Crear cuenta' },
  { ruta: '/recuperar', titulo: 'Recuperar contraseña · Timbre', h1: 'Recuperar contraseña' },
  // Sin sesión de recuperación muestra el aviso y el enlace a /recuperar.
  { ruta: '/restablecer', titulo: 'Restablecer contraseña · Timbre', h1: 'Restablecer contraseña' },
];

async function sinViolacionesAxe(page: Page) {
  const resultado = await new AxeBuilder({ page }).withTags(ETIQUETAS_WCAG).analyze();
  const resumen = resultado.violations.map((v) => ({
    regla: v.id,
    impacto: v.impact,
    nodos: v.nodes.map((n) => n.target.join(' ')),
  }));
  expect(resumen).toEqual([]);
}

/** Cuenta los POST de Server Actions (cabecera `next-action`). */
function contarAcciones(page: Page): { total: number } {
  const contador = { total: 0 };
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.headers()['next-action']) contador.total += 1;
  });
  return contador;
}

for (const { ruta, titulo, h1 } of PANTALLAS) {
  test(`${ruta} se ve, tiene título y pasa axe`, async ({ page }) => {
    await page.goto(ruta);
    await expect(page).toHaveTitle(titulo);
    await expect(page.getByRole('heading', { level: 1, name: h1 })).toBeVisible();
    await page.waitForLoadState('networkidle');
    await sinViolacionesAxe(page);
    const desborde = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(desborde).toBeLessThanOrEqual(0);
  });
}

test('los errores de validación también pasan axe', async ({ page }) => {
  await page.goto('/crear-cuenta');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByText('Escribe tu nombre.')).toBeVisible();
  await sinViolacionesAxe(page);
});

test('/ingresar valida en el cliente, enfoca el primer error y no envía nada', async ({ page }) => {
  const acciones = contarAcciones(page);
  await page.goto('/ingresar');
  await page.waitForLoadState('networkidle');

  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  const correo = page.getByLabel('Correo electrónico');
  await expect(page.getByText('Escribe tu correo electrónico.')).toBeVisible();
  await expect(page.getByText('Escribe tu contraseña.')).toBeVisible();
  await expect(correo).toBeFocused();
  await expect(correo).toHaveAttribute('aria-invalid', 'true');
  // El error queda ligado al campo.
  const descripcion = await correo.getAttribute('aria-describedby');
  expect(descripcion).toBeTruthy();
  await expect(page.locator(`[id="${descripcion}"]`)).toContainText(
    'Escribe tu correo electrónico.',
  );

  await correo.fill('ana@');
  await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
  await expect(
    page.getByText('Revisa el correo: debe tener la forma nombre@empresa.cl.'),
  ).toBeVisible();

  // El enlace por correo solo exige el correo.
  await correo.fill('');
  await page.getByRole('button', { name: 'Recibir un enlace por correo' }).click();
  await expect(page.getByText('Escribe tu correo electrónico.')).toBeVisible();
  await expect(page.getByText('Escribe tu contraseña.')).toHaveCount(0);

  expect(acciones.total).toBe(0);
});

test('/crear-cuenta exige 8 caracteres de contraseña en el cliente', async ({ page }) => {
  const acciones = contarAcciones(page);
  await page.goto('/crear-cuenta');
  await page.waitForLoadState('networkidle');
  await page.getByLabel('Nombre').fill('Ana Pérez');
  await page.getByLabel('Correo electrónico').fill('ana@empresa.cl');
  const clave = page.getByLabel('Contraseña', { exact: true });
  await clave.fill('1234567');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await expect(page.getByText('La contraseña debe tener al menos 8 caracteres.')).toBeVisible();
  await expect(clave).toBeFocused();
  expect(acciones.total).toBe(0);
});

test('mostrar y ocultar la contraseña', async ({ page }) => {
  await page.goto('/ingresar');
  await page.waitForLoadState('networkidle');
  const clave = page.getByLabel('Contraseña', { exact: true });
  const boton = page.getByRole('button', { name: 'Mostrar contraseña' });
  await expect(clave).toHaveAttribute('type', 'password');
  await expect(clave).toHaveAttribute('autocomplete', 'current-password');
  await expect(boton).toHaveAttribute('aria-pressed', 'false');
  await boton.click();
  await expect(clave).toHaveAttribute('type', 'text');
  await expect(boton).toHaveAttribute('aria-pressed', 'true');
  await boton.click();
  await expect(clave).toHaveAttribute('type', 'password');
});

test('autocomplete correctos', async ({ page }) => {
  await page.goto('/crear-cuenta');
  await expect(page.getByLabel('Nombre')).toHaveAttribute('autocomplete', 'name');
  await expect(page.getByLabel('Correo electrónico')).toHaveAttribute('autocomplete', 'email');
  await expect(page.getByLabel('Contraseña', { exact: true })).toHaveAttribute(
    'autocomplete',
    'new-password',
  );
});

test('?error=enlace muestra el aviso del enlace vencido', async ({ page }) => {
  await page.goto('/ingresar?error=enlace');
  await expect(page.getByText('El enlace venció o ya se usó.')).toBeVisible();
  await sinViolacionesAxe(page);
});

test('?siguiente= se conserva solo si es una ruta interna', async ({ page }) => {
  await page.goto('/ingresar?siguiente=%2Facme%2Fdocumentos');
  await expect(page.locator('input[name="siguiente"]')).toHaveValue('/acme/documentos');
  await expect(page.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute(
    'href',
    '/crear-cuenta?siguiente=%2Facme%2Fdocumentos',
  );

  await page.goto('/ingresar?siguiente=https%3A%2F%2Fotro.sitio');
  await expect(page.locator('input[name="siguiente"]')).toHaveValue('');
  await expect(page.getByRole('link', { name: 'Crear cuenta' })).toHaveAttribute(
    'href',
    '/crear-cuenta',
  );
});

test('/restablecer sin sesión lleva a pedir un enlace nuevo', async ({ page }) => {
  await page.goto('/restablecer');
  await expect(page.getByText('Tu enlace de recuperación venció o ya se usó.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Pedir un enlace nuevo' })).toHaveAttribute(
    'href',
    '/recuperar',
  );
  await expect(page.getByLabel('Contraseña nueva')).toHaveCount(0);
});

test('/bienvenida sin sesión redirige a /ingresar', async ({ page }) => {
  // /bienvenida es el destino por omisión: urlIngresar() no lo repite en ?siguiente=.
  await page.goto('/bienvenida');
  await expect(page).toHaveURL(/\/ingresar$/);
});

test('una ruta protegida sin sesión redirige a /ingresar con ?siguiente=', async ({ page }) => {
  await page.goto('/acme/documentos?pagina=2');
  const url = new URL(page.url());
  expect(url.pathname).toBe('/ingresar');
  expect(url.searchParams.get('siguiente')).toBe('/acme/documentos?pagina=2');
});

test.describe('cerrar sesión', () => {
  test('POST /auth/salir responde 303 a /ingresar', async ({ request }) => {
    const respuesta = await request.post('/auth/salir', { maxRedirects: 0 });
    expect(respuesta.status()).toBe(303);
    expect(new URL(respuesta.headers().location ?? '', 'http://x').pathname).toBe('/ingresar');
  });

  test('rechaza un POST desde otro sitio', async ({ request }) => {
    const respuesta = await request.post('/auth/salir', {
      maxRedirects: 0,
      headers: { origin: 'https://otro.sitio' },
    });
    expect(respuesta.status()).toBe(403);
  });

  // /invitacion/[token] usa `referrer: no-referrer`: Chrome manda `Origin: null` en el POST
  // de su botón «Cerrar sesión» (antes respondía 403 «Origen no permitido»).
  test('acepta Origin: null si Sec-Fetch-Site es same-origin y respeta siguiente', async ({
    request,
  }) => {
    const respuesta = await request.post('/auth/salir', {
      maxRedirects: 0,
      headers: { origin: 'null', 'sec-fetch-site': 'same-origin' },
      form: { siguiente: '/invitacion/abc' },
    });
    expect(respuesta.status()).toBe(303);
    const destino = new URL(respuesta.headers().location ?? '', 'http://x');
    expect(destino.pathname).toBe('/ingresar');
    expect(destino.searchParams.get('siguiente')).toBe('/invitacion/abc');
  });

  for (const sitio of [undefined, 'cross-site', 'same-site']) {
    test(`rechaza Origin: null con Sec-Fetch-Site ${sitio ?? 'ausente'}`, async ({ request }) => {
      const respuesta = await request.post('/auth/salir', {
        maxRedirects: 0,
        headers: { origin: 'null', ...(sitio ? { 'sec-fetch-site': sitio } : {}) },
      });
      expect(respuesta.status()).toBe(403);
    });
  }

  test('GET /auth/salir no cierra sesión (405)', async ({ request }) => {
    const respuesta = await request.get('/auth/salir', { maxRedirects: 0 });
    expect(respuesta.status()).toBe(405);
  });
});
