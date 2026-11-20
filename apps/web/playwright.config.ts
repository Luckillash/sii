import { defineConfig, devices } from '@playwright/test';

// e2e y accesibilidad (PLAN-SAAS §8).
// - Local: levanta `next dev` en el puerto 3100 (`pnpm --filter web test:e2e`; la librería
//   debe estar compilada con `pnpm build:libreria`).
// - Contra un deploy: `E2E_URL=https://… pnpm --filter web test:e2e` (no levanta
//   servidor y corre solo las pruebas de humo de e2e/despliegue.spec.ts).
// - Flujo crítico con el SII falso (Fase 13): `E2E_FLUJO=1 pnpm --filter web test:e2e`.
//   Corre SOLO e2e/flujo-critico.spec.ts, en un proyecto, con un `next dev` propio (nunca
//   reutiliza otro) en el puerto 3117 (`E2E_PUERTO`), con `E2E_SII_FALSO_URL` hacia el
//   simulador de la prueba (127.0.0.1:3197, `E2E_SII_PUERTO`), Turnstile y Sentry
//   desactivados. Escribe en la base y lo borra al terminar: ver
//   documentación/05-pruebas/e2e-flujo-critico.md.
const urlDeploy = process.env.E2E_URL;
const flujo = !urlDeploy && process.env.E2E_FLUJO === '1';
const puerto = Number(process.env.E2E_PUERTO ?? (flujo ? 3117 : 3100));
const puertoSii = Number(process.env.E2E_SII_PUERTO ?? 3197);

export default defineConfig({
  testDir: './e2e',
  testMatch: urlDeploy ? 'despliegue.spec.ts' : flujo ? 'flujo-critico.spec.ts' : '**/*.spec.ts',
  testIgnore: urlDeploy || flujo ? [] : ['despliegue.spec.ts', 'flujo-critico.spec.ts'],
  fullyParallel: !flujo,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI && !flujo ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: urlDeploy ?? `http://localhost:${puerto}`,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    trace: 'retain-on-failure',
  },
  projects: flujo
    ? [{ name: 'claro', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } }]
    : [
        { name: 'claro', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
        { name: 'oscuro', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
        { name: 'movil', use: { ...devices['Pixel 7'], colorScheme: 'light' } },
      ],
  webServer: urlDeploy
    ? undefined
    : {
        command: `pnpm exec next dev --port ${puerto}`,
        url: `http://localhost:${puerto}/_ds`,
        reuseExistingServer: !flujo && !process.env.CI,
        timeout: 180_000,
        ...(flujo
          ? {
              env: {
                E2E_SII_FALSO_URL: `http://127.0.0.1:${puertoSii}`,
                // Claves de PRUEBA de Turnstile (Cloudflare): el widget siempre pasa y
                // siteverify siempre acepta. Una variable vacía no llega a next dev en Windows.
                NEXT_PUBLIC_TURNSTILE_SITE_KEY: '1x00000000000000000000AA',
                TURNSTILE_SECRET_KEY: '1x0000000000000000000000000000000AA',
                // Sin eventos de la prueba en el Sentry de producción.
                NEXT_PUBLIC_SENTRY_DSN: '',
              },
            }
          : {}),
      },
});
