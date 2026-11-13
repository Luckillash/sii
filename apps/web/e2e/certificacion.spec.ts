import { expect, test } from '@playwright/test';

// Fase 5: asistente de certificación. SOLO lo que no escribe en la base (es producción) ni
// sale al SII: sin sesión, la ruta queda protegida por el proxy. El asistente con sesión
// (pasos, ensayo y confirmación) se prueba a mano contra certificación con un RUT de prueba.

for (const ruta of ['/acme/certificacion', '/acme/certificacion?empresa=otra']) {
  test(`${ruta} sin sesión redirige a ingresar con ?siguiente=`, async ({ request }) => {
    const r = await request.get(ruta, { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    const destino = new URL(r.headers().location ?? '', 'http://x');
    expect(destino.pathname).toBe('/ingresar');
    expect(destino.searchParams.get('siguiente')).toBe(ruta);
  });
}
