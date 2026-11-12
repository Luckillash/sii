import { describe, expect, it } from 'vitest';
import { correoInvitacion, type DatosInvitacion } from './invitacion';

const TOKEN = 'a'.repeat(64);
const DATOS: DatosInvitacion = {
  organizacion: 'Servicios Andinos',
  rol: 'Emisor',
  invitadoPor: 'Camila Rojas',
  correo: 'pedro@andinos.cl',
  enlace: `https://app.timbre.cl/invitacion/${TOKEN}`,
  // 19-11-2026 03:00 UTC = 19-11-2026 00:00 en Santiago (UTC-3 en verano).
  expiraEn: new Date('2026-11-19T03:00:00Z'),
};

const EMOJI = /\p{Extended_Pictographic}/u;

describe('correoInvitacion', () => {
  const correo = correoInvitacion(DATOS);

  it('arma el asunto con la organización', () => {
    expect(correo.asunto).toBe('Invitación a Servicios Andinos en Timbre');
  });

  it('lleva el enlace en el botón y como texto de respaldo, y en el texto plano', () => {
    expect(correo.html).toContain(`href="https://app.timbre.cl/invitacion/${TOKEN}"`);
    expect(correo.html.split(TOKEN).length - 1).toBe(2);
    expect(correo.texto).toContain(`https://app.timbre.cl/invitacion/${TOKEN}`);
  });

  it('dice quién invita, con qué rol, a qué correo y cuándo vence (dd-mm-aaaa)', () => {
    for (const salida of [correo.html, correo.texto]) {
      expect(salida).toContain('Camila Rojas te invitó a unirte a Servicios Andinos');
      expect(salida).toContain('con el rol Emisor');
      expect(salida).toContain('pedro@andinos.cl');
      expect(salida).toContain('19-11-2026');
    }
  });

  it('sin quien invita usa la forma impersonal', () => {
    const c = correoInvitacion({ ...DATOS, invitadoPor: null });
    expect(c.texto).toContain('Te invitaron a unirte a Servicios Andinos');
  });

  it('respeta el tono: sin exclamaciones ni emoji', () => {
    // Del HTML solo el texto visible (`<!DOCTYPE html>` lleva un «!» que no es tono).
    const visible = correo.html.replace(/<[^>]*>/g, '');
    for (const salida of [correo.asunto, visible, correo.texto]) {
      expect(salida).not.toMatch(/[!¡]/u);
      expect(salida).not.toMatch(EMOJI);
    }
  });

  it('usa estilos en línea con los colores del design system, sin hojas de estilo', () => {
    expect(correo.html).toContain('background:#0b5f5a');
    expect(correo.html).not.toContain('<style');
    expect(correo.html).not.toContain('var(--');
    expect(correo.html).toContain('<html lang="es-CL">');
  });

  it('escapa los datos variables', () => {
    const c = correoInvitacion({ ...DATOS, organizacion: '<script>x</script> & Cía' });
    expect(c.html).not.toContain('<script>');
    expect(c.html).toContain('&lt;script&gt;x&lt;/script&gt; &amp; Cía');
  });

  it('rechaza enlaces que no sean http(s) absolutos', () => {
    expect(() => correoInvitacion({ ...DATOS, enlace: 'javascript:alert(1)' })).toThrow();
    expect(() => correoInvitacion({ ...DATOS, enlace: '/invitacion/x' })).toThrow();
  });
});
