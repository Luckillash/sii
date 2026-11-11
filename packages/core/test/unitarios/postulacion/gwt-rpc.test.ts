import { describe, expect, it } from 'vitest';
import { ErrorPostulacion } from '../../../src/comun/errores.ts';
import {
  esDtoGwt,
  esListaGwt,
  GwtRpc,
  type ObjetoGwt,
  type ParametroGwt,
  stripcslashes,
} from '../../../src/postulacion/gwt-rpc.ts';

const { INTEGER, LONG, STRING, ARRAY_LIST } = GwtRpc;
const DTO = 'cl.prueba.Dto/1';

/** Cuerpo de una llamada mínima: devuelve solo lo que va después de la cabecera fija. */
function cuerpo(params: readonly ParametroGwt[]): { tabla: string[]; tokens: string[] } {
  const texto = GwtRpc.llamada('b', 'p', 's', 'm', params);
  expect(texto.startsWith('7|0|')).toBe(true);
  expect(texto.endsWith('|')).toBe(true);
  const partes = texto.slice(4, -1).split('|');
  const n = Number(partes[0]);
  return { tabla: partes.slice(1, 1 + n), tokens: partes.slice(1 + n) };
}

/** Tokens de los valores (sin base, policy, servicio, método, nParams ni tipos). */
function valores(params: readonly ParametroGwt[]): string[] {
  return cuerpo(params).tokens.slice(5 + params.length);
}

function lanza(fn: () => unknown, mensaje: RegExp | string): void {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ErrorPostulacion);
  expect((error as Error).message).toMatch(mensaje);
}

/** Respuesta //OK con los tokens del payload en orden de lectura. */
function ok(lectura: (string | number)[], tabla: string[]): string {
  return `//OK[${[...lectura].reverse().join(',')},${JSON.stringify(tabla)},0,7]`;
}

describe('GwtRpc.llamada', () => {
  it('arma la cabecera, la tabla 1-based y los tipos de los parámetros', () => {
    const texto = GwtRpc.llamada('https://x/', 'POL', 'Servicio', 'metodo', [
      [INTEGER, (w) => w.integer(5)],
      [STRING, (w) => w.string('hola')],
      [STRING, (w) => w.string(null)],
    ]);
    expect(texto).toBe(
      `7|0|7|https://x/|POL|Servicio|metodo|${INTEGER}|${STRING}|hola|1|2|3|4|3|5|6|6|5|5|7|0|`,
    );
  });

  it('sin parámetros', () => {
    expect(GwtRpc.llamada('b', 'p', 's', 'm', [])).toBe('7|0|4|b|p|s|m|1|2|3|4|0|');
  });

  it('repite índices para strings iguales (también si coinciden con la base o el método)', () => {
    const { tabla, tokens } = cuerpo([[STRING, (w) => w.string('m').string('x').string('x')]]);
    expect(tabla).toEqual(['b', 'p', 's', 'm', STRING, 'x']);
    expect(tokens.slice(-3)).toEqual(['4', '6', '6']);
  });

  it('escapa \\, | y NUL en la tabla (y nada más)', () => {
    const { tabla } = cuerpo([[STRING, (w) => w.string('a\\b|c\0d\n"é😀')]]);
    expect(tabla.at(-1)).toBe('a\\\\b\\!c\\0d\n"é😀');
  });

  it('string vacío va a la tabla (no es null)', () => {
    const texto = GwtRpc.llamada('b', 'p', 's', 'm', [[STRING, (w) => w.string('')]]);
    expect(texto).toBe(`7|0|6|b|p|s|m|${STRING}||1|2|3|4|1|5|6|`);
  });

  it('rechaza textos con surrogates sueltos (no se pueden enviar en UTF-8)', () => {
    lanza(() => cuerpo([[STRING, (w) => w.string('a\uD800b')]]), /UTF-16 sueltos/);
  });

  it('int e integer validan que sea un entero seguro', () => {
    expect(valores([[INTEGER, (w) => w.int(-0).int(2147483647).integer(null)]])).toEqual([
      '0',
      '2147483647',
      '0',
    ]);
    lanza(() => cuerpo([[INTEGER, (w) => w.int(1.5)]]), /no es un entero/);
    lanza(() => cuerpo([[INTEGER, (w) => w.integer(2 ** 53)]]), /no es un entero/);
    lanza(() => cuerpo([[INTEGER, (w) => w.int(Number.NaN)]]), /no es un entero/);
  });
});

describe('GwtRpc#long (BigInt)', () => {
  const long = (v: bigint | number | null) => valores([[LONG, (w) => w.long(v)]]);

  it('escribe la firma y el base64 de GWT', () => {
    expect(long(0n)).toEqual(['5', 'A']);
    expect(long(63n)).toEqual(['5', '_']);
    expect(long(64n)).toEqual(['5', 'BA']);
    expect(long(null)).toEqual(['0']);
  });

  it('valores mayores que 2^31, 2^32 y 2^53 sin perder precisión', () => {
    expect(long(2n ** 31n)).toEqual(['5', 'CAAAAA']);
    expect(long(2n ** 32n)).toEqual(['5', 'EAAAAA']);
    expect(long(2n ** 53n)).toEqual(['5', 'gAAAAAAAA']);
    expect(long(2n ** 53n + 1n)).toEqual(['5', 'gAAAAAAAB']);
    expect(long(1757808000000)).toEqual(['5', 'ZlFhXwA']);
  });

  it('extremos de 64 bits: 2^63-1 y -2^63', () => {
    expect(long(2n ** 63n - 1n)).toEqual(['5', 'H__________']);
    expect(long(-(2n ** 63n))).toEqual(['5', '4AAAAAAAAAA']);
  });

  it('rechaza lo que no cabe en 64 bits con signo (el PHP no puede representarlo) y number inexactos', () => {
    lanza(() => long(2n ** 63n), /no cabe en 64 bits/);
    lanza(() => long(-(2n ** 63n) - 1n), /no cabe en 64 bits/);
    lanza(() => long(2 ** 53), /no es un entero exacto/);
    lanza(() => long(0.5), /no es un entero exacto/);
  });

  it('-128..127 repetidos van como back-reference al primer objeto (contando todos los objetos)', () => {
    const tokens = valores([
      [INTEGER, (w) => w.integer(1)], // objeto 1
      [LONG, (w) => w.long(5n).long(5).long(-128n).long(-128n).long(127n).long(127n)],
      [LONG, (w) => w.long(128n).long(128n).long(-129n).long(-129n)],
    ]);
    expect(tokens).toEqual([
      ...['5', '1', '6', 'F', '-2', '6', '$A', '-3', '6', 'B_', '-4'],
      ...['6', 'CA', '6', 'CA', '6', '9_', '6', '9_'],
    ]);
  });

  // Defecto del PHP, replicado a propósito (cambiarlo cambia bytes enviados al SII):
  // GwtRpc::longBase64 desplaza hasta 0 o -1 y no escribe la extensión de signo que
  // GWT espera (Java escribe -1 como 'P__________'). El servidor leería otro valor.
  it('defecto replicado: los negativos salen sin extensión de signo', () => {
    expect(GwtRpc.longBase64(-1n)).toBe('');
    expect(GwtRpc.longBase64(-2n)).toBe('$');
    expect(GwtRpc.longDeBase64('$')).toBe(62n);
    expect(GwtRpc.longBase64(-64n)).toBe('A');
    expect(GwtRpc.longBase64(-65n)).toBe('$_');
    expect(GwtRpc.longBase64(-(2n ** 53n) - 1n)).toBe('f________');
    expect(long(-1n)).toEqual(['5', '']);
    // Long.MIN_VALUE sí da la vuelta (por casualidad).
    expect(GwtRpc.longDeBase64(GwtRpc.longBase64(-(2n ** 63n)))).toBe(-(2n ** 63n));
  });

  it('ida y vuelta exacta para los no negativos', () => {
    const valoresPrueba = [
      0n,
      1n,
      2n ** 31n - 1n,
      2n ** 31n,
      2n ** 32n + 7n,
      2n ** 53n - 1n,
      2n ** 53n + 1n,
      2n ** 62n + 12345n,
      2n ** 63n - 2n,
      2n ** 63n - 1n,
    ];
    let x = 0x9e3779b97f4a7c15n;
    for (let k = 0; k < 50; k++) {
      x = BigInt.asUintN(64, x * 6364136223846793005n + 1442695040888963407n);
      valoresPrueba.push(x >> 1n);
    }
    for (const v of valoresPrueba) {
      expect(GwtRpc.longDeBase64(GwtRpc.longBase64(v))).toBe(v);
    }
  });
});

describe('GwtRpc.longDeBase64', () => {
  it('decodifica como Java: 64 bits con signo', () => {
    expect(GwtRpc.longDeBase64('A')).toBe(0n);
    expect(GwtRpc.longDeBase64('')).toBe(0n);
    expect(GwtRpc.longDeBase64('P__________')).toBe(-1n);
    expect(GwtRpc.longDeBase64('H__________')).toBe(2n ** 63n - 1n);
    expect(GwtRpc.longDeBase64('IAAAAAAAAAA')).toBe(-(2n ** 63n));
    expect(GwtRpc.longDeBase64('gAAAAAAAB')).toBe(2n ** 53n + 1n);
  });

  it('se desborda envolviendo 64 bits (más de 11 caracteres), como el PHP', () => {
    expect(GwtRpc.longDeBase64('___________')).toBe(-1n);
    expect(GwtRpc.longDeBase64('AAAAAAAAAAAAB')).toBe(1n);
    expect(GwtRpc.longDeBase64('BAAAAAAAAAAA')).toBe(0n);
    expect(GwtRpc.longDeBase64('CAAAAAAAAAA')).toBe(2n ** 61n);
    // 'g' = 32: 32 << 60 = 2^65, que se pierde entero.
    expect(GwtRpc.longDeBase64('gAAAAAAAAAA')).toBe(0n);
    // 12 caracteres: el primero ('Q' = 16) queda en 16 << 66 y se pierde; solo queda el 1.
    expect(GwtRpc.longDeBase64('QAAAAAAAAAAB')).toBe(1n);
  });

  it('rechaza caracteres fuera del alfabeto (divergencia: el PHP los tomaba como 0)', () => {
    lanza(() => GwtRpc.longDeBase64('a=b'), /mal formada \(long\)/);
    lanza(() => GwtRpc.longDeBase64('Añ'), /mal formada \(long\)/);
  });
});

describe('GwtRpc#valor', () => {
  it('reescribe tal cual lo leído (DTO con lista, Long y Integer)', () => {
    const respuesta = ok(
      [1, 2, 3, 3, "'ZlFhXwA'", 3, "'F'", 3, "'F'", 4, 5, 1, 0],
      [DTO, ARRAY_LIST, LONG, 'texto', INTEGER],
    );
    const objeto = GwtRpc.leer(respuesta, { [DTO]: 'OSOS' });
    const leido = objeto.objeto();
    expect(leido).toEqual({
      '@tipo': DTO,
      campos: [
        [
          'O',
          {
            '@tipo': ARRAY_LIST,
            elementos: [
              { '@tipo': LONG, valor: 1757808000000n },
              { '@tipo': LONG, valor: 5n },
              { '@tipo': LONG, valor: 5n },
            ],
          },
        ],
        ['S', 'texto'],
        ['O', { '@tipo': INTEGER, valor: 1 }],
        ['S', null],
      ],
    });
    // El segundo Long 5 vuelve como back-reference; el número de objetos manda.
    expect(valores([[DTO, (w) => w.valor(leido)]])).toEqual([
      '5',
      '6',
      '3',
      '7',
      'ZlFhXwA',
      '7',
      'F',
      '-4',
      '8',
      '9',
      '1',
      '0',
    ]);
  });

  it('null, String nulo, ArrayList vacía y campos B', () => {
    const tokens = valores([
      [
        DTO,
        (w) =>
          w
            .valor(null)
            .valor({ '@tipo': STRING, valor: null })
            .valor({ '@tipo': ARRAY_LIST, elementos: [] })
            .valor({
              '@tipo': DTO,
              campos: [
                ['B', 1],
                ['S', 'x'],
                ['O', null],
              ],
            }),
      ],
    ]);
    expect(tokens).toEqual(['0', '6', '0', '7', '0', '5', '1', '8', '0']);
  });

  it('rechaza lo que no sabe escribir', () => {
    const malos: unknown[] = [
      5,
      'x',
      { foo: 1 },
      { '@tipo': INTEGER, valor: '1' },
      { '@tipo': LONG },
      { '@tipo': STRING, valor: 1 },
      { '@tipo': ARRAY_LIST, elementos: 'x' },
      { '@tipo': DTO },
      { '@tipo': DTO, campos: [['S', 1]] },
      { '@tipo': DTO, campos: [['B', true]] },
      { '@tipo': DTO, campos: [['S']] },
    ];
    for (const malo of malos) {
      lanza(
        () => cuerpo([[DTO, (w) => w.valor(malo as ObjetoGwt)]]),
        'GWT: valor que no se sabe escribir.',
      );
    }
  });
});

describe('GwtRpc.leer: //EX y respuestas inesperadas', () => {
  it('IncompatibleRemoteServiceException: hay que volver a capturar la versión', () => {
    lanza(
      () =>
        GwtRpc.leer(
          '//EX[2,1,["com.google.gwt.user.client.rpc.IncompatibleRemoteServiceException/3936916533","This application is out of date"],0,7]',
        ),
      'El servicio del SII respondió con un error. (el SII actualizó el portal de boletas: hay que volver a capturar la versión de GWT)',
    );
  });

  it('toma como detalle el primer string sin "/" que no empieza con "java."', () => {
    lanza(
      () => GwtRpc.leer('//EX[3,2,1,["a.B/1","java.lang.X","Sin \\"permiso\\"\\n"],0,7]'),
      'El servicio del SII respondió con un error. (SII: Sin "permiso"\n)',
    );
  });

  it('sin detalle', () => {
    lanza(
      () => GwtRpc.leer('//EX[1,["java.lang.RuntimeException/515124647"],0,7]'),
      /^El servicio del SII respondió con un error\.$/,
    );
  });

  it('el detalle se corta en 300 caracteres', () => {
    try {
      GwtRpc.leer(`//EX[1,["${'é'.repeat(400)}"],0,7]`);
    } catch (e) {
      expect((e as Error).message).toBe(
        `El servicio del SII respondió con un error. (SII: ${'é'.repeat(300)})`,
      );
    }
  });

  it('lo que no empieza con //OK (tras el trim de PHP) es una respuesta inesperada, cortada a 200', () => {
    lanza(
      () => GwtRpc.leer(` //OK[0,[],0,7]`),
      /^Respuesta inesperada del servicio del SII:  \/\/OK/,
    );
    lanza(
      () => GwtRpc.leer(`<html>${'ñ'.repeat(300)}`),
      new RegExp(`^Respuesta inesperada del servicio del SII: <html>${'ñ'.repeat(194)}$`),
    );
    expect(GwtRpc.leer(' \t\n\r\0\v//OK[0,[],0,7]\n').objeto()).toBeNull();
  });
});

describe('GwtRpc.leer: formato', () => {
  it('mal formada y cortada', () => {
    const casos: [string, string][] = [
      ['//OK', 'Respuesta GWT del SII mal formada.'],
      ['//OK7', 'Respuesta GWT del SII mal formada.'],
      ["//OK'abc'", 'Respuesta GWT del SII mal formada.'],
      ['//OK[0,7]', 'Respuesta GWT del SII mal formada.'],
      ['//OK[1,2,0,7]', 'Respuesta GWT del SII mal formada.'],
      ["//OK[1,'x',0,7]", 'Respuesta GWT del SII mal formada.'],
      ['//OK[1,x,[],0,7]', 'Respuesta GWT del SII mal formada.'],
      ['//OK[1,,[],0,7]', 'Respuesta GWT del SII mal formada.'],
      ['//OK[-,[],0,7]', 'Respuesta GWT del SII mal formada.'],
      ['//OK[', 'Respuesta GWT del SII mal formada.'],
      ['//OK[1', 'Respuesta GWT del SII cortada.'],
      ['//OK[1,', 'Respuesta GWT del SII cortada.'],
      ['//OK[1,["abc', 'Respuesta GWT del SII cortada.'],
      ['//OK[1,["a\\"],0,7]', 'Respuesta GWT del SII cortada.'],
    ];
    for (const [respuesta, mensaje] of casos) {
      lanza(() => GwtRpc.leer(respuesta), mensaje);
    }
  });

  it('acepta coma final, coma faltante, blancos de ctype_space y basura al final', () => {
    const lector = GwtRpc.leer('//OK[ 2 1 ,\f["a"\v"b",] ,0,7,]basura');
    expect(lector.string()).toBe('a');
    expect(lector.string()).toBe('b');
  });

  it('el decimal 1. no es un número: el punto queda y la respuesta está mal formada', () => {
    lanza(() => GwtRpc.leer('//OK[1.,[],0,7]'), 'Respuesta GWT del SII mal formada.');
  });

  it('escapes como el PHP: \\x, \\u (hexdec ignora no-hex), surrogates descartados', () => {
    const lector = GwtRpc.leer(
      '//OK[1,["\\x41\\u00e9\\n\\t\\r\\0\\"\\\\\\/\\b\\uD83D\\uDE00\\u12zz\\x4g"],0,7]',
    );
    expect(lector.string()).toBe('Aé\n\t\r\0"\\/b\u0012\u0004');
  });

  it('\\u se come 4 bytes aunque sean la comilla de cierre', () => {
    // \u toma `1"]x` → hexdec("1") → U+0001; el string sigue hasta la próxima comilla.
    expect(GwtRpc.leer('//OK[1,["ab\\u1"]x"],0,7]').string()).toBe('ab\u0001');
  });

  it('acepta bytes UTF-8 y rechaza un texto que no es UTF-8 (divergencia: el PHP lo reenviaba)', () => {
    const bien = Buffer.concat([
      Buffer.from('//OK[1,["'),
      Buffer.from('ÑUÑOA', 'utf8'),
      Buffer.from('"],0,7]'),
    ]);
    expect(GwtRpc.leer(bien).string()).toBe('ÑUÑOA');
    const latin1 = Buffer.concat([
      Buffer.from('//OK[1,["'),
      Buffer.from('ÑUÑOA', 'latin1'),
      Buffer.from('"],0,7]'),
    ]);
    lanza(() => GwtRpc.leer(latin1), /mal formada \(texto que no es UTF-8\)/);
  });

  it('valida los esquemas', () => {
    lanza(() => GwtRpc.leer('//OK[0,[],0,7]', { [DTO]: 'SX' }), /esquema inválido/);
  });
});

describe('LectorGwt', () => {
  it('string(): índices 0 (null), dentro y fuera de la tabla', () => {
    const lector = GwtRpc.leer(ok([0, 1, 2, -1], ['a']));
    expect(lector.string()).toBeNull();
    expect(lector.string()).toBe('a');
    lanza(() => lector.string(), 'Respuesta GWT del SII mal formada (string).');
    lanza(() => GwtRpc.leer(ok([-1], ['a'])).string(), 'mal formada (string)');
    lanza(() => GwtRpc.leer('//OK["1",["a"],0,7]').string(), 'mal formada (string)');
    lanza(() => GwtRpc.leer('//OK[1,[1],0,7]').string(), 'mal formada (string)');
  });

  it('se corta si se acaba el payload', () => {
    const lector = GwtRpc.leer(ok([1], [INTEGER]));
    lanza(() => lector.objeto(), 'Respuesta GWT del SII cortada.');
    lanza(() => GwtRpc.leer('//OK[[],0,7]').string(), 'Respuesta GWT del SII cortada.');
  });

  it('objeto(): null, índice fuera de la tabla, referencia inexistente', () => {
    expect(GwtRpc.leer(ok([0], [])).objeto()).toBeNull();
    expect(GwtRpc.leer(ok(['-0'], [])).objeto()).toBeNull();
    lanza(() => GwtRpc.leer(ok([2], ['a'])).objeto(), 'mal formada (objeto)');
    lanza(() => GwtRpc.leer(ok([-1], [])).objeto(), 'mal formada (referencia)');
    lanza(() => GwtRpc.leer('//OK["x",[],0,7]').objeto(), 'mal formada (objeto)');
    lanza(() => GwtRpc.leer("//OK[1,['x'],0,7]").objeto(), 'mal formada (objeto)');
  });

  it('tipo sin esquema: el portal cambió (y no confunde propiedades del prototipo)', () => {
    lanza(
      () => GwtRpc.leer(ok([1], [DTO])).objeto(),
      `El SII respondió un tipo no esperado (${DTO}); pudo haber cambiado el portal.`,
    );
    lanza(() => GwtRpc.leer(ok([1], ['constructor'])).objeto(), /tipo no esperado \(constructor\)/);
  });

  it('Integer, String, ArrayList (largo negativo = vacía) y DTO con B', () => {
    expect(GwtRpc.leer(ok([1, -7], [INTEGER])).objeto()).toEqual({ '@tipo': INTEGER, valor: -7 });
    expect(GwtRpc.leer(ok([1, 2], [STRING, 'x'])).objeto()).toEqual({
      '@tipo': STRING,
      valor: 'x',
    });
    expect(GwtRpc.leer(ok([1, -2], [ARRAY_LIST])).objeto()).toEqual({
      '@tipo': ARRAY_LIST,
      elementos: [],
    });
    const dto = GwtRpc.leer(ok([1, 1, 2, 0], [DTO, 'x']), { [DTO]: 'BSO' }).objeto();
    expect(dto).toEqual({
      '@tipo': DTO,
      campos: [
        ['B', 1],
        ['S', 'x'],
        ['O', null],
      ],
    });
    expect(esDtoGwt(dto)).toBe(true);
    expect(esListaGwt(dto)).toBe(false);
  });

  it('Long en base64 y como número, exacto más allá de 2^53', () => {
    const lector = GwtRpc.leer(
      ok([1, 3, 2, "'gAAAAAAAB'", 2, '-9007199254740993', 2, "'P__________'"], [ARRAY_LIST, LONG]),
    );
    const lista = lector.objeto();
    expect(esListaGwt(lista)).toBe(true);
    expect(lista).toEqual({
      '@tipo': ARRAY_LIST,
      elementos: [
        { '@tipo': LONG, valor: 2n ** 53n + 1n },
        { '@tipo': LONG, valor: -(2n ** 53n) - 1n },
        { '@tipo': LONG, valor: -1n },
      ],
    });
  });

  it('back-references: devuelven una copia del objeto ya leído', () => {
    const lector = GwtRpc.leer(ok([1, 2, 2, 5, -2], [ARRAY_LIST, INTEGER]));
    const lista = lector.objeto();
    if (!esListaGwt(lista)) throw new Error('no es lista');
    expect(lista.elementos).toEqual([
      { '@tipo': INTEGER, valor: 5 },
      { '@tipo': INTEGER, valor: 5 },
    ]);
    expect(lista.elementos[0]).not.toBe(lista.elementos[1]);
  });

  it('referencia circular (divergencia: el PHP devolvía un objeto a medias)', () => {
    lanza(
      () => GwtRpc.leer(ok([1, -1], [DTO]), { [DTO]: 'O' }).objeto(),
      'Respuesta GWT del SII mal formada (referencia circular).',
    );
  });

  it('esNulo(): solo un 0 entero, sin consumir el token', () => {
    const lector = GwtRpc.leer(ok([0, 1], ['a']));
    expect(lector.esNulo()).toBe(true);
    expect(lector.esNulo()).toBe(true);
    expect(lector.string()).toBeNull();
    expect(lector.esNulo()).toBe(false);
    expect(lector.string()).toBe('a');
    expect(lector.esNulo()).toBe(false);
    expect(GwtRpc.leer(ok(['-0'], [])).esNulo()).toBe(true);
    expect(GwtRpc.leer(ok(['00'], [])).esNulo()).toBe(true);
    // El PHP hace (int) "0.5" → 0 y diría que sí; un decimal no es la referencia nula.
    expect(GwtRpc.leer(ok(['0.5'], [])).esNulo()).toBe(false);
    expect(GwtRpc.leer('//OK["0",[],0,7]').esNulo()).toBe(false);
  });

  describe('números sin truncar en silencio (PLAN §4; el PHP hace (int) y trunca o satura)', () => {
    it('decimales donde va un entero', () => {
      lanza(
        () => GwtRpc.leer(ok([1, '1.5'], [INTEGER])).objeto(),
        'Respuesta GWT del SII mal formada (entero: 1.5 no es un número entero).',
      );
      lanza(() => GwtRpc.leer(ok(['1.9'], ['a'])).string(), /string: 1\.9 no es un número entero/);
      lanza(() => GwtRpc.leer(ok(['1.0'], [INTEGER])).objeto(), /objeto: 1\.0 no es un número/);
      lanza(() => GwtRpc.leer(ok([1, '0.5'], [ARRAY_LIST])).objeto(), /entero: 0\.5/);
      lanza(() => GwtRpc.leer(ok([1, '5.5'], [LONG])).objeto(), /long: 5\.5 no es un número/);
    });

    it('enteros fuera del rango seguro (2^53) o de 64 bits', () => {
      lanza(
        () => GwtRpc.leer(ok([1, '9007199254740992'], [INTEGER])).objeto(),
        'Respuesta GWT del SII mal formada (entero: 9007199254740992 fuera de rango).',
      );
      expect(GwtRpc.leer(ok([1, '9007199254740991'], [INTEGER])).objeto()).toEqual({
        '@tipo': INTEGER,
        valor: 9007199254740991,
      });
      lanza(() => GwtRpc.leer(ok(['99999999999999999999'], [])).string(), /fuera de rango/);
      expect(GwtRpc.leer(ok([1, '9223372036854775807'], [LONG])).objeto()).toEqual({
        '@tipo': LONG,
        valor: 2n ** 63n - 1n,
      });
      lanza(
        () => GwtRpc.leer(ok([1, '9223372036854775808'], [LONG])).objeto(),
        /long: 9223372036854775808 fuera de rango/,
      );
    });

    it('un Long como texto entre comillas dobles (el PHP hacía (int) "123")', () => {
      lanza(
        () => GwtRpc.leer('//OK["123",1,["java.lang.Long/4227064769"],0,7]').objeto(),
        'mal formada (long)',
      );
    });
  });
});

describe('stripcslashes (como PHP)', () => {
  it('escapes de C, hexadecimales, octales y desconocidos', () => {
    expect(stripcslashes('a\\nb\\tc\\rd\\ae\\vf\\bg\\fh\\\\i')).toBe('a\nb\tc\rd\x07e\vf\bg\fh\\i');
    expect(stripcslashes('\\x41\\x4\\xg\\x')).toBe('A\x04xgx');
    expect(stripcslashes('\\101\\0\\7777\\8')).toBe('A\0\xff78');
    expect(stripcslashes('\\u00F3 \\"q\\" fin\\')).toBe('u00F3 "q" fin\\');
  });
});
