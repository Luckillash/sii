import { describe, expect, it } from 'vitest';
import {
  esquemaCrearCuenta,
  esquemaEnlace,
  esquemaIngresar,
  esquemaRestablecer,
  leerCampos,
  MENSAJES_VALIDACION as M,
  validar,
} from './esquemas';

describe('esquemaIngresar', () => {
  it('acepta correo y contraseña, recortando espacios del correo', () => {
    const r = validar(esquemaIngresar, { correo: '  ana@empresa.cl ', clave: 'x' });
    expect(r).toEqual({ ok: true, datos: { correo: 'ana@empresa.cl', clave: 'x' } });
  });

  it('pide correo y contraseña cuando faltan', () => {
    expect(validar(esquemaIngresar, { correo: '', clave: '' })).toEqual({
      ok: false,
      errores: { correo: M.correoVacio, clave: M.claveVacia },
    });
  });

  it('rechaza un correo mal escrito con un solo mensaje', () => {
    expect(validar(esquemaIngresar, { correo: 'ana@', clave: 'x' })).toEqual({
      ok: false,
      errores: { correo: M.correoInvalido },
    });
  });

  it('campos ausentes o que no son texto', () => {
    const r = validar(esquemaIngresar, {});
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores.correo).toBe(M.correoVacio);
      expect(r.errores.clave).toBe(M.claveVacia);
    }
  });

  it('no recorta la contraseña', () => {
    const r = validar(esquemaIngresar, { correo: 'a@b.cl', clave: ' con espacios ' });
    expect(r.ok && r.datos.clave).toBe(' con espacios ');
  });
});

describe('esquemaCrearCuenta', () => {
  const valido = { nombre: 'Ana Pérez', correo: 'ana@empresa.cl', clave: '12345678' };

  it('acepta datos válidos', () => {
    expect(validar(esquemaCrearCuenta, valido).ok).toBe(true);
  });

  it('exige al menos 8 caracteres de contraseña', () => {
    expect(validar(esquemaCrearCuenta, { ...valido, clave: '1234567' })).toEqual({
      ok: false,
      errores: { clave: M.claveCorta },
    });
  });

  it('no acepta más de 72 caracteres de contraseña', () => {
    expect(validar(esquemaCrearCuenta, { ...valido, clave: 'a'.repeat(73) })).toEqual({
      ok: false,
      errores: { clave: M.claveLarga },
    });
  });

  it('pide el nombre (los espacios no cuentan)', () => {
    expect(validar(esquemaCrearCuenta, { ...valido, nombre: '   ' })).toEqual({
      ok: false,
      errores: { nombre: M.nombreVacio },
    });
  });
});

describe('otros esquemas', () => {
  it('enlace por correo solo pide el correo', () => {
    expect(validar(esquemaEnlace, { correo: 'ana@empresa.cl', clave: '' }).ok).toBe(true);
  });

  it('restablecer exige la contraseña nueva con el mínimo', () => {
    expect(validar(esquemaRestablecer, { clave: 'corta' })).toEqual({
      ok: false,
      errores: { clave: M.claveCorta },
    });
  });
});

describe('leerCampos', () => {
  it('lee texto y deja vacío lo que falta o es archivo', () => {
    const datos = new FormData();
    datos.set('correo', 'ana@empresa.cl');
    datos.set('clave', new Blob(['x']));
    expect(leerCampos(datos, ['correo', 'clave', 'nombre'])).toEqual({
      correo: 'ana@empresa.cl',
      clave: '',
      nombre: '',
    });
  });
});
