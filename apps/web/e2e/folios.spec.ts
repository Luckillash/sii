import { expect, test } from '@playwright/test';

// Fase 6: folios (CAF). SOLO lo que no escribe en la base (es producción) ni sale al SII:
// sin sesión, la ruta queda protegida por el proxy. La solicitud (ensayo, revisión y
// timbraje), la carga de un CAF y la anulación se prueban con Vitest y dobles.

for (const ruta of ['/acme/folios', '/acme/folios?empresa=otra']) {
  test(`${ruta} sin sesión redirige a ingresar con ?siguiente=`, async ({ request }) => {
    const r = await request.get(ruta, { maxRedirects: 0 });
    expect(r.status()).toBe(307);
    const destino = new URL(r.headers().location ?? '', 'http://x');
    expect(destino.pathname).toBe('/ingresar');
    expect(destino.searchParams.get('siguiente')).toBe(ruta);
  });
}
