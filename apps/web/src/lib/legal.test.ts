import { describe, expect, it } from 'vitest';
import { MOTIVOS_CONTACTO } from '@/app/(publico)/contacto/esquema';
import { validarRut } from './formatos';
import {
  camposPendientes,
  canalContacto,
  type DatosResponsable,
  etiquetaCampo,
  identificacionTitular,
  nombreTitular,
  RESPONSABLE,
  RUTA_CONTACTO,
  RUTA_CONTACTO_PRIVACIDAD,
  textoCanal,
  VIGENCIA_PRIVACIDAD,
  VIGENCIA_TERMINOS,
} from './legal';

const VACIO: DatosResponsable = {
  razonSocial: null,
  rut: null,
  domicilio: null,
  correoContacto: null,
  correoPrivacidad: null,
};

const COMPLETO: DatosResponsable = {
  razonSocial: 'Servicios Boletéame SpA',
  rut: '76354771k',
  domicilio: 'Av. Providencia 1234, Providencia',
  correoContacto: 'hola@boleteame.dev',
  correoPrivacidad: 'privacidad@boleteame.dev',
};

/** Ningún texto de respaldo puede verse como un marcador sin completar. */
function sinMarcadores(texto: string) {
  expect(texto).not.toMatch(/[[\]{}]/);
  expect(texto).not.toMatch(/\bTU\b/);
  expect(texto).not.toMatch(/null|undefined/);
}

describe('nombreTitular', () => {
  it('sin razón social usa un texto neutro, con mayúscula al inicio de la frase', () => {
    expect(nombreTitular(VACIO)).toBe('el titular de Boletéame');
    expect(nombreTitular(VACIO, { inicio: true })).toBe('El titular de Boletéame');
    sinMarcadores(nombreTitular(VACIO));
  });

  it('con razón social la usa tal cual (sin pasarla a minúsculas)', () => {
    expect(nombreTitular(COMPLETO)).toBe('Servicios Boletéame SpA');
    expect(nombreTitular(COMPLETO, { inicio: true })).toBe('Servicios Boletéame SpA');
  });

  it('trata un texto en blanco como faltante', () => {
    expect(nombreTitular({ ...VACIO, razonSocial: '   ' })).toBe('el titular de Boletéame');
  });
});

describe('identificacionTitular', () => {
  it('sin datos queda solo el nombre neutro', () => {
    expect(identificacionTitular(VACIO)).toBe('el titular de Boletéame');
    sinMarcadores(identificacionTitular(VACIO, { inicio: true }));
  });

  it('con todos los datos formatea el RUT y agrega el domicilio', () => {
    expect(identificacionTitular(COMPLETO)).toBe(
      'Servicios Boletéame SpA, RUT 76.354.771-K, con domicilio en Av. Providencia 1234, Providencia',
    );
  });

  it('agrega solo lo que existe', () => {
    expect(identificacionTitular({ ...VACIO, rut: '76.354.771-K' })).toBe(
      'el titular de Boletéame, RUT 76.354.771-K',
    );
    expect(identificacionTitular({ ...VACIO, domicilio: 'Calle 1, Ñuñoa' })).toBe(
      'el titular de Boletéame, con domicilio en Calle 1, Ñuñoa',
    );
  });
});

describe('canalContacto', () => {
  it('sin correos lleva a la página de contacto (privacidad, con su motivo elegido)', () => {
    for (const [motivo, href] of [
      ['general', RUTA_CONTACTO],
      ['privacidad', RUTA_CONTACTO_PRIVACIDAD],
    ] as const) {
      const canal = canalContacto(motivo, VACIO);
      expect(canal).toEqual({
        antes: 'escríbenos desde ',
        texto: 'la página de contacto',
        href,
        tipo: 'formulario',
      });
      expect(textoCanal(canal)).toBe('escríbenos desde la página de contacto');
      sinMarcadores(textoCanal(canal));
    }
    expect(textoCanal(canalContacto('general', VACIO, { inicio: true }))).toBe(
      'Escríbenos desde la página de contacto',
    );
  });

  it('con correo usa mailto', () => {
    expect(canalContacto('general', COMPLETO)).toEqual({
      antes: 'escríbenos a ',
      texto: 'hola@boleteame.dev',
      href: 'mailto:hola@boleteame.dev',
      tipo: 'correo',
    });
    expect(canalContacto('privacidad', COMPLETO).texto).toBe('privacidad@boleteame.dev');
  });

  it('privacidad cae al correo de contacto si no hay uno propio', () => {
    const canal = canalContacto('privacidad', { ...VACIO, correoContacto: 'hola@boleteame.dev' });
    expect(canal.href).toBe('mailto:hola@boleteame.dev');
  });

  it('el general no usa el correo de privacidad', () => {
    const canal = canalContacto('general', {
      ...VACIO,
      correoPrivacidad: 'privacidad@boleteame.dev',
    });
    expect(canal.tipo).toBe('formulario');
  });
});

describe('camposPendientes', () => {
  it('lista los campos nulos o en blanco, en orden', () => {
    expect(camposPendientes(VACIO)).toEqual([
      'razonSocial',
      'rut',
      'domicilio',
      'correoContacto',
      'correoPrivacidad',
    ]);
    expect(camposPendientes({ ...COMPLETO, domicilio: ' ' })).toEqual(['domicilio']);
    expect(camposPendientes(COMPLETO)).toEqual([]);
    expect(etiquetaCampo('correoPrivacidad')).toBe('correo de privacidad');
  });

  it('la constante publicada identifica al titular (Ley 19.496 y Ley 21.719)', () => {
    // Los correos quedan en null a propósito (el canal es el formulario de contacto).
    expect(camposPendientes(RESPONSABLE)).toEqual(['correoContacto', 'correoPrivacidad']);
    expect(validarRut(RESPONSABLE.rut)).toBe(true);
    expect(identificacionTitular(RESPONSABLE)).toBe(
      'Lucas Salazar Cartes, RUT 20.630.500-2, con domicilio en Tajamar 223, Las Condes',
    );
  });

  it('el motivo de privacidad del enlace existe en el formulario de contacto', () => {
    const motivo = new URL(RUTA_CONTACTO_PRIVACIDAD, 'https://boleteame.dev').searchParams.get(
      'motivo',
    );
    expect(MOTIVOS_CONTACTO).toContain(motivo);
  });

  it('la constante publicada es coherente con sus textos de respaldo', () => {
    // Mientras falten datos, ningún texto que ve la persona puede mostrar un marcador.
    sinMarcadores(identificacionTitular(RESPONSABLE, { inicio: true }));
    sinMarcadores(textoCanal(canalContacto('privacidad', RESPONSABLE)));
    sinMarcadores(textoCanal(canalContacto('general', RESPONSABLE)));
  });
});

describe('vigencias', () => {
  it('son fechas AAAA-MM-DD', () => {
    expect(VIGENCIA_TERMINOS).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(VIGENCIA_PRIVACIDAD).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
