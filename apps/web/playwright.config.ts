import { defineConfig, devices } from '@playwright/test';

// e2e y accesibilidad (PLAN-SAAS §8). Levanta `next dev` en el puerto 3100.
// Uso: `pnpm --filter web test:e2e` (la librería debe estar compilada: `pnpm build:libreria`).
const puerto = 3100;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${puerto}`,
    locale: 'es-CL',
    timezoneId: 'America/Santiago',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'claro', use: { ...devices['Desktop Chrome'], colorScheme: 'light' } },
    { name: 'oscuro', use: { ...devices['Desktop Chrome'], colorScheme: 'dark' } },
    { name: 'movil', use: { ...devices['Pixel 7'], colorScheme: 'light' } },
  ],
  webServer: {
    command: `pnpm exec next dev --port ${puerto}`,
    url: `http://localhost:${puerto}/_ds`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
