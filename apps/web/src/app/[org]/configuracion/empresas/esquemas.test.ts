import { describe, expect, it } from 'vitest';
import {
  type CampoEmpresa,
  type CampoResolucion,
  esFechaIso,
  esquemaEdicionEmpresa,
  esquemaEmpresa,
  esquemaResolucion,
  LARGOS_EMPRESA,
  largoEnCaracteres,
  leerCampos,
  MENSAJES_EMPRESA as ME,
  MENSAJES_RESOLUCION as MR,
  mensajeFueraDeIso,
  NUMERO_RESOLUCION_MAXIMO,
  validarCampos,
} from './esquemas';

const BASE = {
  rut: '76.354.771-k',
  razonSocial: 'Servicios Andinos SpA',
  giro: 'Venta al por menor de artículos de ferretería',
  direccion: 'Av. Providencia 1234, oficina 56',
  comuna: 'Providencia',
  correoIntercambio: '',
};

function empresa(cambios: Partial<typeof BASE> = {}) {
  return validarCampos<typeof esquemaEmpresa, CampoEmpresa>(esquemaEmpresa, {
    ...BASE,
    ...cambios,
  });
}

function errorDe(cambios: Partial<typeof BASE>, campo: CampoEmpresa) {
  const r = empresa(cambios);
  return r.ok ? undefined : r.errores[campo];
}

describe('esquemaEmpresa: normalización', () => {
  it('RUT al formato del dominio `rut` (sin puntos, guion, K mayúscula) y textos recortados', () => {
    const r = empresa({
      razonSocial: '  Servicios Andinos SpA  ',
      comuna: ' Providencia ',
      correoIntercambio: '  dte@andinos.cl ',
    });
    expect(r).toEqual({
      ok: true,
      datos: {
        rut: '76354771-K',
        razonSocial: 'Servicios Andinos SpA',
        giro: BASE.giro,
        direccion: BASE.direccion,
        comuna: 'Providencia',
        correoIntercambio: 'dte@andinos.cl',
      },
    });
  });

  it('acepta el RUT en cualquier formato habitual', () => {
    for (const rut of [
      '76354771K',
      '76354771-k',
      ' 76.354.771-K ',
      '76 354 771 K',
      '076354771-K',
    ]) {
      const r = empresa({ rut });
      expect(r.ok && r.datos.rut, rut).toBe('76354771-K');
    }
    const corto = empresa({ rut: '1-9' });
    expect(corto.ok && corto.datos.rut).toBe('1-9');
  });

  it('correo vacío o solo espacios = null', () => {
    for (const correoIntercambio of ['', '   ']) {
      const r = empresa({ correoIntercambio });
      expect(r.ok && r.datos.correoIntercambio).toBeNull();
    }
    const sinCampo = validarCampos(esquemaEmpresa, { ...BASE, correoIntercambio: undefined });
    expect(sinCampo.ok && sinCampo.datos.correoIntercambio).toBeNull();
  });
});

describe('esquemaEmpresa: RUT', () => {
  it('vacío', () => {
    expect(errorDe({ rut: '' }, 'rut')).toBe(ME.rutVacio);
    expect(errorDe({ rut: '   ' }, 'rut')).toBe(ME.rutVacio);
  });
  it('dígito verificador incorrecto', () => {
    expect(errorDe({ rut: '76.354.771-1' }, 'rut')).toBe(ME.rutDv);
    expect(errorDe({ rut: '12.345.678-K' }, 'rut')).toBe(ME.rutDv);
  });
  it('caracteres ajenos al RUT no se descartan en silencio', () => {
    expect(errorDe({ rut: '76354771-K x' }, 'rut')).toBe(ME.rutInvalido);
    expect(errorDe({ rut: '7635a4771-K' }, 'rut')).toBe(ME.rutInvalido);
  });
  it('más de 8 dígitos en el cuerpo, K en el cuerpo o sin DV', () => {
    expect(errorDe({ rut: '123.456.789-2' }, 'rut')).toBe(ME.rutInvalido);
    expect(errorDe({ rut: '7635K4771-1' }, 'rut')).toBe(ME.rutInvalido);
    expect(errorDe({ rut: '7' }, 'rut')).toBe(ME.rutInvalido);
  });
});

describe('esquemaEmpresa: largos exactos (checks de `empresas`)', () => {
  const casos = [
    ['razonSocial', LARGOS_EMPRESA.razonSocial, ME.razonSocialVacia, ME.razonSocialLarga],
    ['giro', LARGOS_EMPRESA.giro, ME.giroVacio, ME.giroLargo],
    ['direccion', LARGOS_EMPRESA.direccion, ME.direccionVacia, ME.direccionLarga],
    ['comuna', LARGOS_EMPRESA.comuna, ME.comunaVacia, ME.comunaLarga],
  ] as const;

  it.each(casos)('%s: 1 a %i caracteres', (campo, maximo, vacio, largo) => {
    expect(errorDe({ [campo]: 'a' }, campo)).toBeUndefined();
    expect(errorDe({ [campo]: 'a'.repeat(maximo) }, campo)).toBeUndefined();
    expect(errorDe({ [campo]: 'a'.repeat(maximo + 1) }, campo)).toBe(largo);
    expect(errorDe({ [campo]: '' }, campo)).toBe(vacio);
    expect(errorDe({ [campo]: '    ' }, campo)).toBe(vacio);
    // Los espacios de los extremos no cuentan.
    expect(errorDe({ [campo]: ` ${'a'.repeat(maximo)} ` }, campo)).toBeUndefined();
  });

  it('cuenta caracteres como Postgres, no unidades UTF-16', () => {
    expect(largoEnCaracteres('Ñuñoa')).toBe(5);
    expect(largoEnCaracteres('𝐀')).toBe(1);
    expect(errorDe({ comuna: 'Ñuñoa' }, 'comuna')).toBeUndefined();
    expect(errorDe({ comuna: 'ñ'.repeat(20) }, 'comuna')).toBeUndefined();
  });
});

describe('esquemaEmpresa: solo caracteres de ISO-8859-1', () => {
  it.each(['razonSocial', 'giro', 'direccion', 'comuna'] as const)('%s', (campo) => {
    expect(errorDe({ [campo]: 'Pingü Ñuñoa Nº1 «A»' }, campo)).toBeUndefined();
    expect(errorDe({ [campo]: 'Café 😀' }, campo)).toBe(mensajeFueraDeIso(['😀']));
    expect(errorDe({ [campo]: '“Andes” – €' }, campo)).toBe(
      mensajeFueraDeIso(['“', '”', '–', '€']),
    );
  });

  it('el error de caracteres gana al de largo', () => {
    expect(errorDe({ comuna: `${'a'.repeat(25)}€` }, 'comuna')).toBe(mensajeFueraDeIso(['€']));
  });

  it('el mensaje nombra hasta 5 caracteres, dice qué hacer y no lleva exclamaciones', () => {
    const uno = mensajeFueraDeIso(['😀']);
    expect(uno).toMatch(/^Tiene un carácter que no se puede usar/);
    expect(mensajeFueraDeIso(['€', '“'])).toMatch(/^Tiene caracteres que no se pueden usar/);
    expect(uno).toContain('«😀»');
    expect(uno).toMatch(/Quita los emoji/);
    const muchos = mensajeFueraDeIso(['1', '2', '3', '4', '5', '6']);
    expect(muchos).toContain('«5»');
    expect(muchos).not.toContain('«6»');
    expect(`${uno} ${muchos}`).not.toMatch(/[!¡]/);
  });
});

describe('esquemaEmpresa: correo de intercambio (`correo_sii`)', () => {
  it('válido', () => {
    expect(errorDe({ correoIntercambio: 'dte@andinos.cl' }, 'correoIntercambio')).toBeUndefined();
  });
  it('más de 50 caracteres', () => {
    const correo = `${'a'.repeat(46)}@x.cl`;
    expect(correo).toHaveLength(51);
    expect(errorDe({ correoIntercambio: correo }, 'correoIntercambio')).toBe(ME.correoLargo);
    expect(errorDe({ correoIntercambio: correo.slice(1) }, 'correoIntercambio')).toBeUndefined();
  });
  it('reglas del SII', () => {
    for (const correo of [
      'dte@andinos',
      'dte@.andinos.cl',
      '.dte@andinos.cl',
      'dte@andinos.cl.',
      'd te@andinos.cl',
      'dté@andinos.cl',
      'dte+1@andinos.cl',
      'dte@@andinos.cl',
      'andinos.cl',
    ]) {
      expect(errorDe({ correoIntercambio: correo }, 'correoIntercambio'), correo).toBe(
        ME.correoInvalido,
      );
    }
  });
});

describe('esquemaEdicionEmpresa', () => {
  it('no lee ni devuelve el RUT', () => {
    const r = validarCampos(esquemaEdicionEmpresa, { ...BASE, rut: 'cualquier cosa' });
    expect(r.ok).toBe(true);
    expect(r.ok && 'rut' in r.datos).toBe(false);
  });
});

describe('validarCampos', () => {
  it('un error por campo (el primero) y varios campos a la vez', () => {
    const r = empresa({ rut: '', razonSocial: '', comuna: 'a'.repeat(21) });
    expect(r).toEqual({
      ok: false,
      errores: { rut: ME.rutVacio, razonSocial: ME.razonSocialVacia, comuna: ME.comunaLarga },
    });
  });
});

describe('leerCampos', () => {
  it('lee los textos y deja vacío lo que falta o no es texto', () => {
    const f = new FormData();
    f.set('rut', '1-9');
    f.set('giro', new Blob(['x']));
    expect(leerCampos(f, ['rut', 'giro', 'comuna'] as const)).toEqual({
      rut: '1-9',
      giro: '',
      comuna: '',
    });
  });
});

const HOY = '2026-11-12';

function resolucion(entrada: Record<string, unknown>) {
  return validarCampos<ReturnType<typeof esquemaResolucion>, CampoResolucion>(
    esquemaResolucion(HOY),
    entrada,
  );
}

describe('esquemaResolucion', () => {
  it('certificación: número siempre 0, aunque llegue otro', () => {
    expect(resolucion({ ambiente: 'certificacion', fecha: '2026-11-10' })).toEqual({
      ok: true,
      datos: { ambiente: 'certificacion', numero: 0, fecha: '2026-11-10' },
    });
    const conNumero = resolucion({ ambiente: 'certificacion', numero: '80', fecha: '2026-11-10' });
    expect(conNumero.ok && conNumero.datos.numero).toBe(0);
  });

  it('producción: entero mayor que 0', () => {
    expect(resolucion({ ambiente: 'produccion', numero: ' 80 ', fecha: '2026-11-10' })).toEqual({
      ok: true,
      datos: { ambiente: 'produccion', numero: 80, fecha: '2026-11-10' },
    });
    const tope = resolucion({
      ambiente: 'produccion',
      numero: String(NUMERO_RESOLUCION_MAXIMO),
      fecha: HOY,
    });
    expect(tope.ok && tope.datos.numero).toBe(NUMERO_RESOLUCION_MAXIMO);
  });

  it('producción: errores del número', () => {
    const casos: [unknown, string][] = [
      [undefined, MR.numeroVacio],
      ['', MR.numeroVacio],
      ['0', MR.numeroCero],
      ['000', MR.numeroCero],
      ['-1', MR.numeroEntero],
      ['1.5', MR.numeroEntero],
      ['1.000', MR.numeroEntero],
      ['80a', MR.numeroEntero],
      [String(NUMERO_RESOLUCION_MAXIMO + 1), MR.numeroGrande],
    ];
    for (const [numero, mensaje] of casos) {
      const r = resolucion({ ambiente: 'produccion', numero, fecha: '2026-11-10' });
      expect(r.ok ? null : r.errores.numero, String(numero)).toBe(mensaje);
    }
  });

  it('fecha: hoy sí, mañana no (en hora de Chile)', () => {
    expect(resolucion({ ambiente: 'certificacion', fecha: HOY }).ok).toBe(true);
    const futura = resolucion({ ambiente: 'certificacion', fecha: '2026-11-13' });
    expect(futura.ok ? null : futura.errores.fecha).toBe(MR.fechaFutura);
  });

  it('fecha vacía o inválida', () => {
    const casos: [unknown, string][] = [
      [undefined, MR.fechaVacia],
      ['', MR.fechaVacia],
      ['2026-02-30', MR.fechaInvalida],
      ['10-11-2026', MR.fechaInvalida],
      ['2026-13-01', MR.fechaInvalida],
    ];
    for (const [fecha, mensaje] of casos) {
      const r = resolucion({ ambiente: 'certificacion', fecha });
      expect(r.ok ? null : r.errores.fecha, String(fecha)).toBe(mensaje);
    }
  });

  it('informa número y fecha a la vez', () => {
    const r = resolucion({ ambiente: 'produccion', numero: '0', fecha: '2030-01-01' });
    expect(r).toEqual({ ok: false, errores: { numero: MR.numeroCero, fecha: MR.fechaFutura } });
  });

  it('ambiente desconocido', () => {
    const r = resolucion({ ambiente: 'pruebas', fecha: HOY });
    expect(r.ok ? null : r.errores.ambiente).toBe(MR.ambiente);
  });
});

describe('esFechaIso', () => {
  it('solo AAAA-MM-DD que existe', () => {
    expect(esFechaIso('2024-02-29')).toBe(true);
    expect(esFechaIso('2026-02-29')).toBe(false);
    expect(esFechaIso('2026-1-01')).toBe(false);
  });
});

describe('mensajes', () => {
  it('sin exclamaciones', () => {
    for (const m of [...Object.values(ME), ...Object.values(MR)]) {
      expect(m).not.toMatch(/[!¡]/);
    }
  });
});
