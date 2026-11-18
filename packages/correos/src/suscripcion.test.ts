import { describe, expect, it } from 'vitest';
import type { Correo } from './plantilla';
import { correoSuscripcionMorosa, type DatosSuscripcionMorosa } from './suscripcion';

const EMOJI = /\p{Extended_Pictographic}/u;

function revisarTono(c: Correo) {
  const visible = c.html.replace(/<[^>]*>/g, '');
  for (const salida of [c.asunto, visible, c.texto]) {
    expect(salida).not.toMatch(/[!¡]/u);
    expect(salida).not.toMatch(EMOJI);
  }
}

const DATOS: DatosSuscripcionMorosa = {
  organizacion: 'Servicios Andinos',
  plan: 'Básico',
  monto: '$ 14.990',
  vence: '10-11-2026',
  enlacePago: 'https://www.flow.cl/app/web/pagarBtnPago.php?token=abc&x=1',
  enlacePlan: 'https://boleteame.dev/servicios-andinos/configuracion/plan',
};

describe('correoSuscripcionMorosa', () => {
  it('explica qué pasó, qué queda bloqueado y qué hacer, con el enlace de Flow', () => {
    const c = correoSuscripcionMorosa(DATOS);
    expect(c.asunto).toBe('Tu plan tiene un pago vencido: Servicios Andinos');
    for (const salida of [c.html, c.texto]) {
      expect(salida).toContain('$ 14.990');
      expect(salida).toContain('plan Básico de Servicios Andinos');
      expect(salida).toContain('venció el 10-11-2026');
      expect(salida).toContain('no se pueden emitir boletas en producción');
      expect(salida).toContain('agregar empresas ni sumar usuarios nuevos');
      expect(salida).toContain('La certificación sigue funcionando');
      expect(salida).toContain('Paga el monto con el enlace de Flow');
      expect(salida).toContain('Configuración → Plan');
      expect(salida).toContain('Te avisamos porque administras Servicios Andinos');
    }
    expect(c.html).toContain(
      'href="https://www.flow.cl/app/web/pagarBtnPago.php?token=abc&amp;x=1"',
    );
    expect(c.html).toContain('Pagar con Flow');
    expect(c.html).toContain('href="https://boleteame.dev/servicios-andinos/configuracion/plan"');
    expect(c.texto).toContain('https://www.flow.cl/app/web/pagarBtnPago.php?token=abc&x=1');
    expect(c.texto).toContain('https://boleteame.dev/servicios-andinos/configuracion/plan');
    revisarTono(c);
  });

  it('sin enlace de pago: botón a la página del plan y sin mencionar el enlace de Flow', () => {
    for (const enlacePago of [null, undefined, '']) {
      const c = correoSuscripcionMorosa({ ...DATOS, enlacePago });
      expect(c.html).not.toContain('Pagar con Flow');
      expect(c.html).not.toContain('flow.cl');
      expect(c.texto).not.toContain('flow.cl');
      expect(c.texto).not.toContain('enlace de Flow');
      expect(c.html).toContain('Ver mi plan');
      expect(c.html).toContain('href="https://boleteame.dev/servicios-andinos/configuracion/plan"');
      expect(c.texto).toContain('revisa la tarjeta registrada en Configuración → Plan');
      revisarTono(c);
    }
  });

  it('sin fecha de vencimiento no inventa una', () => {
    const c = correoSuscripcionMorosa({ ...DATOS, vence: null });
    expect(c.texto).toContain('venció sin pagarse');
    expect(c.texto).not.toContain('venció el');
    revisarTono(c);
  });

  it('escapa los datos y exige enlaces http(s)', () => {
    const c = correoSuscripcionMorosa({
      ...DATOS,
      organizacion: '<script>x</script>',
      plan: '"Pro" & <b>',
    });
    expect(c.html).not.toContain('<script>');
    expect(c.html).not.toContain('<b>');
    expect(c.html).toContain('&lt;script&gt;x&lt;/script&gt;');
    expect(c.html).toContain('&quot;Pro&quot; &amp; &lt;b&gt;');
    expect(() =>
      correoSuscripcionMorosa({ ...DATOS, enlacePago: 'javascript:alert(1)' }),
    ).toThrow();
    expect(() => correoSuscripcionMorosa({ ...DATOS, enlacePlan: '/servicios-andinos' })).toThrow();
  });
});
