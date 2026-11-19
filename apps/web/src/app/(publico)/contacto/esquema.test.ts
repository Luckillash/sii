import { describe, expect, it } from 'vitest';
import {
  ASUNTO_MOTIVO,
  ETIQUETA_MOTIVO,
  leerCamposContacto,
  MOTIVOS_CONTACTO,
  motivoDesdeParametro,
  validarContacto,
} from './esquema';

const VALIDO = {
  nombre: '  Camila Rojas ',
  correo: ' camila@andinos.cl ',
  empresa: '',
  rut: '',
  motivo: 'soporte',
  mensaje: '  No puedo subir el certificado.  ',
};

describe('motivoDesdeParametro', () => {
  it('acepta los cinco motivos, sin importar mayúsculas ni espacios', () => {
    for (const m of MOTIVOS_CONTACTO) expect(motivoDesdeParametro(m)).toBe(m);
    expect(motivoDesdeParametro(' Ventas ')).toBe('ventas');
  });

  it('cualquier otro valor, varios o ninguno → null', () => {
    expect(motivoDesdeParametro('factura')).toBeNull();
    expect(motivoDesdeParametro('')).toBeNull();
    expect(motivoDesdeParametro(undefined)).toBeNull();
    expect(motivoDesdeParametro(['ventas', 'soporte'])).toBeNull();
  });

  it('cada motivo tiene etiqueta y versión para el asunto', () => {
    for (const m of MOTIVOS_CONTACTO) {
      expect(ETIQUETA_MOTIVO[m]).toBeTruthy();
      expect(ASUNTO_MOTIVO[m]).toBeTruthy();
    }
    expect(ETIQUETA_MOTIVO.ventas).toBe('Ventas / plan Empresa');
    expect(ASUNTO_MOTIVO.ventas).toBe('Ventas');
  });
});

describe('validarContacto', () => {
  it('recorta los textos y deja empresa y RUT vacíos como null', () => {
    const r = validarContacto(VALIDO);
    expect(r).toEqual({
      ok: true,
      datos: {
        nombre: 'Camila Rojas',
        correo: 'camila@andinos.cl',
        empresa: null,
        rut: null,
        motivo: 'soporte',
        mensaje: 'No puedo subir el certificado.',
      },
    });
  });

  it('el correo se normaliza: sin espacios y en minúsculas', () => {
    const r = validarContacto({ ...VALIDO, correo: '  Camila@Andinos.CL ' });
    expect(r.ok && r.datos.correo).toBe('camila@andinos.cl');
  });

  it('el RUT se acepta en cualquier formato y se devuelve formateado', () => {
    for (const rut of ['76354771-k', '76.354.771-K', ' 76354771K ']) {
      const r = validarContacto({ ...VALIDO, rut });
      expect(r.ok && r.datos.rut).toBe('76.354.771-K');
    }
  });

  it('RUT inválido: formato o dígito verificador', () => {
    const dv = validarContacto({ ...VALIDO, rut: '76354771-1' });
    expect(dv.ok ? null : dv.errores.rut).toContain('dígito verificador');
    for (const rut of ['76/354/771-K', '123456789-0', 'K']) {
      const r = validarContacto({ ...VALIDO, rut });
      expect(r.ok ? null : r.errores.rut).toContain('escríbelo como');
    }
  });

  it('empresa de más de 100 caracteres', () => {
    const r = validarContacto({ ...VALIDO, empresa: 'x'.repeat(101) });
    expect(r.ok ? null : r.errores.empresa).toContain('hasta 100 caracteres');
  });

  it('un error por campo (el primero)', () => {
    const r = validarContacto({ ...VALIDO, nombre: '', correo: 'x', mensaje: '' });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errores).toEqual({
      nombre: 'Escribe tu nombre.',
      correo: 'Revisa el correo: debe tener la forma nombre@empresa.cl.',
      mensaje: 'Cuéntanos un poco más: el mensaje necesita al menos 10 caracteres.',
    });
  });
});

describe('leerCamposContacto', () => {
  it('lee solo texto y deja lo demás como cadena vacía', () => {
    const datos = new FormData();
    datos.set('nombre', 'Camila');
    datos.set('mensaje', new Blob(['archivo']));
    expect(leerCamposContacto(datos)).toEqual({
      nombre: 'Camila',
      correo: '',
      empresa: '',
      rut: '',
      motivo: '',
      mensaje: '',
    });
  });
});
