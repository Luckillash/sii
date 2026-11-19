import { describe, expect, it } from 'vitest';
import { correoContacto, type DatosContacto, limpiarLinea, limpiarTextoLibre } from './contacto';

const DATOS: DatosContacto = {
  motivo: 'Ventas / plan Empresa',
  nombre: 'Camila Rojas',
  correo: 'camila@andinos.cl',
  empresa: 'Servicios Andinos SpA',
  rut: '76.354.771-K',
  mensaje: 'Hola.\nQueremos emitir desde 4 empresas.\n\nTrack ID 34120364.',
};

const EMOJI = /\p{Extended_Pictographic}/u;

/** Del HTML solo el texto visible (`<!DOCTYPE html>` lleva un «!» que no es tono). */
function visible(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}

describe('limpiarTextoLibre y limpiarLinea', () => {
  it('quita controles y caracteres bidi, y normaliza los saltos de línea', () => {
    expect(limpiarTextoLibre('a\r\nb\rc\u{2028}d\u0000e\u{202E}f\u0007')).toBe('a\nb\nc\ndef');
    expect(limpiarTextoLibre('a\n\n\n\n\nb')).toBe('a\n\nb');
    expect(limpiarTextoLibre('  hola \t mundo  ')).toBe('hola \t mundo');
  });

  it('una línea: los saltos y espacios seguidos quedan en un espacio', () => {
    expect(limpiarLinea(' Camila\r\nRojas\u0000 \u{202E}evil ')).toBe('Camila Rojas evil');
    expect(limpiarLinea('x'.repeat(300))).toHaveLength(200);
  });
});

describe('correoContacto', () => {
  const correo = correoContacto(DATOS);

  it('arma el asunto con el motivo y el nombre', () => {
    expect(correo.asunto).toBe('[Contacto · Ventas / plan Empresa] Camila Rojas');
  });

  it('con motivo corto, el asunto lo usa y el cuerpo conserva el largo', () => {
    const c = correoContacto({ ...DATOS, motivoAsunto: 'Ventas' });
    expect(c.asunto).toBe('[Contacto · Ventas] Camila Rojas');
    expect(c.texto).toContain('Motivo: Ventas / plan Empresa');
  });

  it('lleva todos los datos en el HTML y en el texto plano', () => {
    for (const salida of [visible(correo.html), correo.texto]) {
      expect(salida).toContain('Camila Rojas');
      expect(salida).toContain('camila@andinos.cl');
      expect(salida).toContain('Servicios Andinos SpA');
      expect(salida).toContain('76.354.771-K');
      expect(salida).toContain('Queremos emitir desde 4 empresas.');
      expect(salida).toContain('Responde a este correo para contestarle a camila@andinos.cl.');
    }
    expect(correo.texto).toContain(
      'Hola.\nQueremos emitir desde 4 empresas.\n\nTrack ID 34120364.',
    );
    expect(correo.html).toContain('Hola.<br>Queremos emitir desde 4 empresas.<br><br>Track ID');
  });

  it('sin empresa ni RUT omite esas filas', () => {
    const c = correoContacto({ ...DATOS, empresa: null, rut: '' });
    expect(c.texto).not.toContain('Empresa:');
    expect(c.texto).not.toContain('RUT de la empresa');
    expect(c.html).not.toContain('RUT de la empresa');
  });

  it('escapa en el HTML todo lo que escribe la persona', () => {
    const c = correoContacto({
      ...DATOS,
      nombre: '<img src=x onerror=alert(1)>',
      empresa: 'A & B "Cía"',
      mensaje: '<script>robar()</script>\n<a href="javascript:x">clic</a>',
    });
    expect(c.html).not.toContain('<script>');
    expect(c.html).not.toContain('<img');
    expect(c.html).not.toContain('<a href="javascript');
    expect(c.html).toContain('&lt;script&gt;robar()&lt;/script&gt;');
    expect(c.html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(c.html).toContain('A &amp; B &quot;Cía&quot;');
  });

  it('el asunto y las líneas no admiten saltos de línea ni controles', () => {
    const c = correoContacto({
      ...DATOS,
      nombre: 'Camila\r\nBcc: otro@ejemplo.cl',
      mensaje: 'texto\u0000con\u{202E}controles',
    });
    expect(c.asunto).toBe('[Contacto · Ventas / plan Empresa] Camila Bcc: otro@ejemplo.cl');
    expect(c.asunto).not.toMatch(/[\r\n]/);
    expect(c.texto).toContain('Nombre: Camila Bcc: otro@ejemplo.cl');
    expect(c.texto).toContain('textoconcontroles');
    // biome-ignore lint/suspicious/noControlCharactersInRegex: se comprueba que no queden.
    expect(c.texto).not.toMatch(/[\u{0}\u{202E}]/u);
  });

  it('usa estilos en línea, sin hojas de estilo ni custom properties', () => {
    expect(correo.html).not.toContain('<style');
    expect(correo.html).not.toContain('var(--');
    expect(correo.html).toContain('<html lang="es-CL">');
  });
});

describe('tono', () => {
  it('sin exclamaciones ni emoji', () => {
    for (const c of [correoContacto(DATOS), correoContacto({ ...DATOS, empresa: null })]) {
      for (const salida of [c.asunto, visible(c.html), c.texto]) {
        expect(salida).not.toMatch(/[!¡]/u);
        expect(salida).not.toMatch(EMOJI);
      }
    }
  });
});
