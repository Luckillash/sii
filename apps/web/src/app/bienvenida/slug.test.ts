import { describe, expect, it } from 'vitest';
import { SLUGS_RESERVADOS } from '@/lib/rutas';
import {
  PATRON_SLUG,
  sugerirSlug,
  traducirErrorOrganizacion,
  validarNombre,
  validarSlug,
} from './slug';

describe('sugerirSlug', () => {
  it.each([
    ['Servicios Andinos SpA', 'servicios-andinos-spa'],
    ['Panadería Ñuñoa', 'panaderia-nunoa'],
    ['  Árbol & Cía. Ltda.  ', 'arbol-cia-ltda'],
    ['Estudio  Contable -- Pérez', 'estudio-contable-perez'],
    ['--Hola--', 'hola'],
    ['123 Comercial', '123-comercial'],
    ['Ünïcödé', 'unicode'],
    ['日本', ''],
  ])('%s → %s', (nombre, esperado) => {
    expect(sugerirSlug(nombre)).toBe(esperado);
  });

  it('corta en 63 caracteres sin dejar un guion al final', () => {
    const s = sugerirSlug(`${'a'.repeat(62)} b`);
    expect(s).toBe('a'.repeat(62));
    expect(sugerirSlug('x'.repeat(80))).toHaveLength(63);
  });

  it('lo que sugiere desde un nombre normal cumple el check de la base', () => {
    for (const nombre of ['Servicios Andinos SpA', 'Panadería Ñuñoa', '123 Comercial']) {
      expect(sugerirSlug(nombre)).toMatch(PATRON_SLUG);
    }
  });
});

describe('validarSlug', () => {
  it('acepta slugs válidos', () => {
    for (const s of ['ab', 'acme', 'servicios-andinos', '9-lives', 'a'.repeat(63)]) {
      expect(validarSlug(s), s).toBeNull();
    }
  });

  it('rechaza vacío, cortos, largos y caracteres fuera del patrón', () => {
    expect(validarSlug('')).toMatch(/Escribe/);
    expect(validarSlug('a')).toMatch(/al menos 2/);
    expect(validarSlug('a'.repeat(64))).toMatch(/hasta 63/);
    for (const s of ['-acme', 'Acme', 'acmé', 'ac me', 'acme_sa', 'acme.cl']) {
      expect(validarSlug(s), s).toMatch(/minúsculas/);
    }
  });

  it('rechaza todos los slugs reservados', () => {
    for (const s of SLUGS_RESERVADOS) {
      expect(validarSlug(s), s).toMatch(/reservada/);
    }
  });
});

describe('validarNombre', () => {
  it('exige texto y como máximo 100 caracteres', () => {
    expect(validarNombre('   ')).toMatch(/Escribe/);
    expect(validarNombre('x'.repeat(101))).toMatch(/hasta 100/);
    expect(validarNombre('Servicios Andinos')).toBeNull();
  });
});

describe('traducirErrorOrganizacion', () => {
  it('slug tomado (23505) apunta al campo slug', () => {
    expect(traducirErrorOrganizacion({ code: '23505' })).toEqual({
      campo: 'slug',
      mensaje: 'Esa dirección ya la usa otra organización. Prueba con otra.',
    });
  });

  it('42501 es sesión vencida y lo demás, genérico', () => {
    expect(traducirErrorOrganizacion({ code: '42501' }).mensaje).toMatch(/sesión/);
    expect(traducirErrorOrganizacion({ code: 'XX000' }).campo).toBeNull();
  });
});
