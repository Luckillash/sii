import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { certificado, pfx } from '../test/pfx-prueba';
import { CASOS_SET, RUT_EMPRESA, RUT_TITULAR, SiiFalso } from './soporte/sii-falso';
import { confirmarCorreo, correoDePrueba, limpiar, PREFIJO } from './soporte/supabase';

// Flujo crítico de punta a punta (PLAN-SAAS Fase 13, punto 2), con el SII FALSO:
//
//   registro → organización → empresa → certificado → certificación (5 pasos) → folios
//   → emisión → seguimiento
//
// ESCRIBE EN LA BASE (es producción, no hay otra): una cuenta, una organización con su
// empresa, un certificado y CAF de MENTIRA (Vault), documentos y envíos de certificación.
// Todo lleva el prefijo `e2e-flujo-` y se borra al terminar, pase o falle, igual que lo
// que haya dejado una corrida anterior (`soporte/supabase.ts`). Nada sale al SII: el
// `next dev` de la prueba corre con `E2E_SII_FALSO_URL` y la capa SII le pregunta todo al
// simulador de `soporte/sii-falso.ts` (que además rechaza cualquier host de producción).
//
// Por eso es opcional y solo corre con su propio servidor:
//   E2E_FLUJO=1 pnpm --filter web test:e2e
// (ver documentación/05-pruebas/e2e-flujo-critico.md).

const ACTIVA = process.env.E2E_FLUJO === '1';
const PUERTO_SII = Number(process.env.E2E_SII_PUERTO ?? 3197);

const id = `${PREFIJO}${Date.now().toString(36)}${randomBytes(3).toString('hex')}`;
const correo = correoDePrueba(id);
const clave = `E2e-${randomBytes(12).toString('base64url')}`;
const clavePfx = `pfx-${randomBytes(9).toString('base64url')}`;
const sii = new SiiFalso();
/** Correo para los formularios que van al SII (falso): el SII no acepta el '+' del de la cuenta. */
const correoSii = 'dte@example.com';

test.describe.configure({ mode: 'serial' });
test.skip(!ACTIVA, 'Solo con E2E_FLUJO=1 (escribe en la base; ver documentación/05-pruebas)');

test.beforeAll(async () => {
  // Lo que haya dejado una corrida anterior que se cortó.
  await limpiar();
  await sii.iniciar(PUERTO_SII);
});

test.afterAll(async () => {
  await sii.cerrar();
  // Sin cuerpos ni cabeceras: solo método, host, ruta y método GWT.
  if (sii.desconocidas.length > 0) {
    console.log(`SII falso, sin respuesta: ${sii.desconocidas.join(' | ')}`);
  }
  console.log(`SII falso atendió:\n${sii.resumen().join('\n')}`);
  const r = await limpiar();
  console.log(
    `Limpieza: ${r.organizaciones} organización(es), ${r.usuarios} cuenta(s), ${r.archivos} archivo(s) de Storage.`,
  );
});

/** Botón del diálogo de confirmación abierto (el `<dialog>` nativo del design system). */
function confirmarEnDialogo(page: Page, texto: string | RegExp): Locator {
  return page.getByRole('dialog').getByRole('button', { name: texto });
}

/**
 * Espera el token de Turnstile. El servidor de la prueba usa las claves de PRUEBA de
 * Cloudflare (siempre pasan), pero el widget tarda unos segundos en entregarlo.
 */
async function esperarTurnstile(page: Page) {
  await expect(page.locator('input[name="cf-turnstile-response"]').first()).not.toHaveValue('', {
    timeout: 30_000,
  });
}

/** Alerta (éxito, info o aviso) del asistente con ese título. */
async function esperarAviso(page: Page, titulo: string | RegExp, timeout = 90_000) {
  await expect(page.getByText(titulo).first()).toBeVisible({ timeout });
}

/**
 * El cron de seguimiento de Production (`seguimiento-envios`, cada 5 minutos en :00, :05…)
 * consulta los envíos nuevos de TODA la base, también los de esta prueba, y lo haría contra
 * el SII real. Para que nunca alcance a verlos, cada envío se hace y se consulta (queda
 * en un estado final) lejos de esa hora: entre los segundos 20 y 150 del ciclo.
 */
async function lejosDelCron(page: Page) {
  const segundo = (Date.now() / 1000) % 300;
  const espera = segundo < 20 ? 20 - segundo : segundo > 150 ? 320 - segundo : 0;
  if (espera > 0) await page.waitForTimeout(espera * 1000);
}

test('registro → organización → empresa → certificado → certificación → folios → emisión → seguimiento', async ({
  page,
}, testInfo) => {
  test.setTimeout(20 * 60_000);
  const errores: string[] = [];
  page.on('pageerror', (e) => errores.push(e.message));
  const slug = id;
  let empresaId = '';

  await test.step('registro', async () => {
    await page.goto('/crear-cuenta');
    await page.getByLabel('Nombre').fill('Titular E2E');
    await page.getByLabel('Correo electrónico').fill(correo);
    await page.getByLabel('Contraseña', { exact: true }).fill(clave);
    await esperarTurnstile(page);
    await page.getByRole('button', { name: 'Crear cuenta' }).click();

    const revisaCorreo = page.getByRole('heading', { name: 'Revisa tu correo' });
    await expect(revisaCorreo.or(page.getByLabel('Nombre de la organización'))).toBeVisible({
      timeout: 60_000,
    });
    if (await revisaCorreo.isVisible()) {
      // Con la confirmación de correo activa: el enlace llega a la bandeja de prueba de
      // Resend (no se puede abrir), así que se confirma con la API de administración.
      await confirmarCorreo(correo);
      await page.goto('/ingresar');
      await page.getByLabel('Correo electrónico').fill(correo);
      await page.getByLabel('Contraseña', { exact: true }).fill(clave);
      await esperarTurnstile(page);
      await page.getByRole('button', { name: 'Ingresar', exact: true }).click();
    }
    await expect(page).toHaveURL(/\/bienvenida$/, { timeout: 60_000 });
  });

  await test.step('organización', async () => {
    await page.getByLabel('Nombre de la organización').fill(slug);
    await page.getByLabel('Dirección').fill(slug);
    await page.getByRole('button', { name: 'Crear organización' }).click();
    await expect(page).toHaveURL(new RegExp(`/${slug}/tablero$`), { timeout: 60_000 });
  });

  await test.step('empresa', async () => {
    await page.goto(`/${slug}/configuracion/empresas/nueva`);
    await page.getByLabel('RUT de la empresa').fill(RUT_EMPRESA);
    await page.getByLabel('Razón social').fill('EMPRESA E2E SPA');
    await page.getByLabel('Giro').fill('Venta al por menor de artículos de ferretería');
    await page.getByLabel('Dirección').fill('Av. Prueba 123');
    await page.getByLabel('Comuna').fill('Santiago');
    await page.getByRole('button', { name: 'Agregar empresa' }).click();
    await expect(page).toHaveURL(/\/configuracion\/empresas\/[0-9a-f-]{36}(\?creada=1)?$/, {
      timeout: 60_000,
    });
    empresaId = /empresas\/([0-9a-f-]{36})/.exec(page.url())?.[1] ?? '';
    expect(empresaId).not.toBe('');
  });

  await test.step('certificado (.pfx de MENTIRA, autogenerado)', async () => {
    const ruta = testInfo.outputPath('certificado-e2e.pfx');
    writeFileSync(ruta, pfx(certificado({ cn: 'Titular E2E', rutSan: RUT_TITULAR }), clavePfx));
    await page.goto(`/${slug}/configuracion/certificados`);
    await page.getByLabel('Archivo del certificado (.pfx o .p12)').setInputFiles(ruta);
    await page.getByLabel('Contraseña del certificado').fill(clavePfx);
    await page.getByLabel('Asociar a una empresa (opcional)').selectOption(empresaId);
    await page.getByLabel('El titular es representante electrónico').check();
    await page.getByLabel('Usar como certificado predeterminado').check();
    await page.getByRole('button', { name: 'Subir certificado' }).click();
    await esperarAviso(page, /Cargaste el certificado de Titular E2E/, 60_000);
  });

  await test.step('certificación · 1. postulación', async () => {
    await page.goto(`/${slug}/certificacion`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Certificación ante el SII' }),
    ).toBeVisible();
    await page.getByLabel('Nombre del software').fill('Boleteame');
    await page.getByLabel('Correo del administrador').fill(correoSii);
    await page.getByLabel('Correo de contacto con el SII').fill(correoSii);
    await page.getByLabel('Correo de intercambio').fill(correoSii);
    await page.getByRole('button', { name: 'Guardar datos' }).click();
    await expect(page.getByRole('button', { name: 'Postular en el SII' })).toBeEnabled({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Postular en el SII' }).click();
    await confirmarEnDialogo(page, 'Postular').click();
    await esperarAviso(page, 'El SII aceptó la postulación');
  });

  await test.step('certificación · 2. set de pruebas', async () => {
    await page.getByLabel('Correo del proveedor de software (opcional)').fill(correoSii);
    await page.getByRole('button', { name: 'Descargar el set de pruebas' }).click();
    await confirmarEnDialogo(page, 'Descargar el set').click();
    await esperarAviso(page, 'Descargamos el set de pruebas');
    await expect(page.getByText(`El set trae ${CASOS_SET} casos`)).toBeVisible();
  });

  await test.step('certificación · 3. folios y envío del set', async () => {
    await page.getByRole('button', { name: 'Solicitar folios de certificación' }).click();
    await confirmarEnDialogo(page, 'Pedir folios').click();
    await esperarAviso(page, 'El SII timbró los folios');

    await lejosDelCron(page);
    await page.getByRole('button', { name: 'Enviar el set al SII' }).click();
    await confirmarEnDialogo(page, 'Enviar el set').click();
    await esperarAviso(page, 'Enviamos el set de pruebas al SII');
    await page.getByRole('button', { name: 'Consultar el estado del envío' }).click();
    await esperarAviso(page, 'El SII aceptó el set de pruebas');
  });

  await test.step('certificación · 4. revisión', async () => {
    await page.getByRole('button', { name: 'Solicitar revisión' }).click();
    await confirmarEnDialogo(page, 'Pedir la revisión').click();
    await esperarAviso(page, 'El SII recibió la solicitud de revisión');
    await page.getByRole('button', { name: 'Consultar el estado en el SII' }).click();
    await esperarAviso(page, 'La empresa está lista para declarar (P90)');
  });

  await test.step('certificación · 5. declaración de cumplimiento', async () => {
    await page.getByLabel('Link de consulta de boletas').fill('https://www.example.com/boletas');
    await page.getByLabel('RUT del proveedor de software').fill('22.222.222-2');
    await page.getByLabel('Nombre del proveedor').fill('Proveedor E2E SpA');
    await page.getByLabel('Correo del proveedor').fill(correoSii);
    await page.getByRole('button', { name: 'Guardar datos' }).click();
    await expect(page.getByRole('button', { name: 'Declarar cumplimiento' })).toBeEnabled({
      timeout: 30_000,
    });
    await page.getByRole('button', { name: 'Declarar cumplimiento' }).click();
    await confirmarEnDialogo(page, 'Declarar el cumplimiento').click();
    await esperarAviso(page, 'Declaraste el cumplimiento');
    await esperarAviso(page, 'La empresa está autorizada para emitir boletas en producción');
    expect(sii.declaracion).toBe('P91');
  });

  await test.step('folios de certificación (Fase 6)', async () => {
    await page.goto(`/${slug}/folios`);
    await page.getByLabel('Ambiente', { exact: true }).selectOption('certificacion');
    await page.getByLabel('Tipo de documento').selectOption('39');
    await page.getByLabel('Cantidad').fill('5');
    await page.getByRole('button', { name: 'Preparar la solicitud' }).click();
    await confirmarEnDialogo(page, /^Timbrar 5 folios$/).click();
    await esperarAviso(page, 'El SII timbró los folios');
    // Una solicitud para el set y otra aquí, ambas en maullin (certificación).
    expect(sii.hacia('maullin.sii.cl', 'of_genera_archivo')).toHaveLength(2);
  });

  let folio = '';
  await test.step('emisión en certificación', async () => {
    // Precompila la lista de documentos para que la consulta de estado sea inmediata.
    await page.goto(`/${slug}/documentos?ambiente=certificacion&periodo=todos`);
    await page.goto(`/${slug}/emitir`);
    await page.getByRole('radio', { name: 'Certificación' }).check();
    await page.getByLabel('Producto o servicio, línea 1').fill('Prueba e2e');
    await page.getByLabel('Precio unitario con IVA, línea 1').fill('1190');
    await page.getByLabel('Precio unitario con IVA, línea 1').blur();
    await lejosDelCron(page);
    await page
      .getByRole('complementary', { name: 'Resumen' })
      .getByRole('button', { name: /Emitir boleta/ })
      .click();
    await confirmarEnDialogo(page, 'Emitir boleta').click();
    const exito = page.getByText(/^Emitimos la boleta electrónica/);
    await expect(exito).toBeVisible({ timeout: 90_000 });
    folio =
      /(\d[\d.]*)\s*$/.exec((await exito.textContent()) ?? '')?.[1]?.replaceAll('.', '') ?? '';
    expect(folio).not.toBe('');
  });

  await test.step('seguimiento: consultar el estado en el SII', async () => {
    await page.goto(`/${slug}/documentos?ambiente=certificacion&periodo=todos`);
    const fila = page.locator('tbody tr[aria-selected]').filter({ hasText: folio }).first();
    await fila.click();
    const panel = page.getByRole('region', { name: /N\.º/ });
    await expect(panel).toBeVisible();
    const consultas = sii.hacia('apicert.sii.cl', 'boleta.electronica.envio/').length;
    await panel.getByRole('button', { name: /Consultar estado en el SII/ }).click();
    await expect(panel.getByText('Aceptado', { exact: true }).first()).toBeVisible({
      timeout: 90_000,
    });
    // La consulta salió (al SII falso) por el Track ID de la boleta.
    expect(sii.hacia('apicert.sii.cl', 'boleta.electronica.envio/').length).toBe(consultas + 1);
  });

  await test.step('el SII falso vio todo y nada fue a producción', async () => {
    expect(sii.desconocidas, sii.resumen().join('\n')).toEqual([]);
    const hosts = new Set(sii.registro.map((r) => r.host));
    for (const host of [
      'herculesr.sii.cl',
      'maullin.sii.cl',
      'www4.sii.cl',
      'apicert.sii.cl',
      'pangal.sii.cl',
    ]) {
      expect(hosts, sii.resumen().join('\n')).toContain(host);
    }
    // Dos envíos aceptados: el set y la boleta.
    expect(sii.envios.size).toBe(2);
    expect(errores).toEqual([]);
  });
});
