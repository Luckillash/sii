import { defineConfig, devices } from '@playwright/test';

// e2e y accesibilidad (PLAN-SAAS §8).
// - Local: levanta `next dev` en el puerto 3100 (`pnpm --filter web test:e2e`; la librería
//   debe estar compilada con `pnpm build:libreria`).
// - Contra un deploy: `E2E_URL=https://… pnpm --filter web test:e2e` (no levanta
//   servidor y corre solo las pruebas de humo de e2e/despliegue.spec.ts).
const puerto = 3100;
const urlDeploy = process.env.E2E_URL;

export default defineConfig({
  testDir: './e2e',
  testMatch: urlDeploy ? 'despliegue.spec.ts' : '**/*.spec.ts',
  testIgnore: urlDeploy ? [] : ['despliegue.spec.ts'],
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: urlDeploy ?? `http://localhost:${puerto}`,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'claro', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'oscuro', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
    { name: 'movil', use: { ...devices['Pixel 7'], colorScheme: 'light' } },
  ],
  webServer: urlDeploy
    ? undefined
    : {
        command: `pnpm exec next dev --port ${puerto}`,
        url: `http://localhost:${puerto}/_ds`,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
