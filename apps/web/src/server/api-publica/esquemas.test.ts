import { describe, expect, it } from 'vitest';
import {
  aBorrador,
  esquemaEmisionApi,
  leerCuerpoJson,
  leerParametrosListado,
  validar,
} from './esquemas';
import { ErrorApi } from './respuestas';

function errorDe(fn: () => unknown): ErrorApi {
  try {
    fn();
  } catch (error) {
    if (error instanceof ErrorApi) return error;
    throw error;
  }
  throw new Error('no lanzó');
}

describe('boleta de la API → borrador', () => {
  it('pasa por esquemaBorrador: receptor genérico por defecto y RUT normalizado', () => {
    const b = aBorrador(
      validar(esquemaEmisionApi, {
        tipo_dte: 39,
        lineas: [{ nombre: 'Café', cantidad: 2, precio: 1190, unidad: 'Kg' }],
      }),
      'certificacion',
    );
    expect(b).toMatchObject({
      tipoDte: 39,
      ambiente: 'certificacion',
      receptor: { rut: '66666666-6', razonSocial: 'Cliente General' },
      lineas: [{ nombre: 'Café', cantidad: 2, precio: 1190, exento: false, unidad: 'Kg' }],
    });
    const conReceptor = aBorrador(
      validar(esquemaEmisionApi, {
        tipo_dte: 39,
        receptor: { rut: '11.111.111-1', razon_social: 'Cliente SpA', correo: 'a@b.cl' },
        lineas: [{ nombre: 'Café', cantidad: 1, precio: 1190 }],
      }),
      'produccion',
    );
    expect(conReceptor.receptor).toMatchObject({ rut: '11111111-1', razonSocial: 'Cliente SpA' });
  });

  it('en la boleta exenta (41) las líneas son exentas por defecto', () => {
    const b = aBorrador(
      validar(esquemaEmisionApi, {
        tipo_dte: 41,
        lineas: [{ nombre: 'Curso', cantidad: 1, precio: 5000 }],
      }),
      'certificacion',
    );
    expect(b.lineas[0]?.exento).toBe(true);
  });

  it('422 datos_invalidos con las rutas en snake_case', () => {
    const e = errorDe(() =>
      aBorrador(
        validar(esquemaEmisionApi, {
          tipo_dte: 41,
          receptor: { rut: '11.111.111-2' },
          lineas: [{ nombre: 'Curso', cantidad: 1, precio: 10.5, exento: false }],
        }),
        'certificacion',
      ),
    );
    expect(e.codigo).toBe('datos_invalidos');
    expect(e.opciones.campos).toMatchObject({
      'receptor.rut': 'Revisa el RUT.',
      'lineas.0.precio': 'El precio va en pesos, sin decimales.',
    });
    // Las reglas de toda la boleta (41 solo exenta) corren cuando lo básico está bien.
    const exenta = errorDe(() =>
      aBorrador(
        validar(esquemaEmisionApi, {
          tipo_dte: 41,
          lineas: [{ nombre: 'Curso', cantidad: 1, precio: 10, exento: false }],
        }),
        'certificacion',
      ),
    );
    expect(exenta.opciones.campos).toEqual({
      'lineas.0.exento': 'En una boleta exenta todas las líneas son exentas.',
    });
  });

  it('un campo desconocido es un error (no emite a Cliente General en silencio)', () => {
    const e = errorDe(() =>
      validar(esquemaEmisionApi, {
        tipo_dte: 39,
        receptor: { razonSocial: 'Mal escrito' },
        lineas: [{ nombre: 'x', cantidad: 1, precio: 1 }],
        extra: true,
      }),
    );
    expect(e.codigo).toBe('datos_invalidos');
    expect(Object.keys(e.opciones.campos ?? {})).toEqual(
      expect.arrayContaining(['receptor.razonSocial', 'extra']),
    );
  });

  it('tipos y faltantes con mensajes en español', () => {
    const e = errorDe(() => validar(esquemaEmisionApi, { tipo_dte: 33, lineas: [] }));
    expect(e.opciones.campos).toMatchObject({
      tipo_dte: 'Usa 39 (boleta) o 41 (boleta exenta).',
      lineas: 'Agrega al menos una línea.',
    });
    expect(errorDe(() => validar(esquemaEmisionApi, 'texto')).opciones.campos).toEqual({
      cuerpo: 'Tiene que ser un objeto JSON.',
    });
  });

  it('422 ambiente_no_coincide si pide otro ambiente que el de la clave', () => {
    const entrada = validar(esquemaEmisionApi, {
      ambiente: 'produccion',
      tipo_dte: 39,
      lineas: [{ nombre: 'x', cantidad: 1, precio: 100 }],
    });
    expect(errorDe(() => aBorrador(entrada, 'certificacion')).codigo).toBe('ambiente_no_coincide');
    expect(aBorrador(entrada, 'produccion').ambiente).toBe('produccion');
  });

  it('prefijo de los campos (lote)', () => {
    const e = errorDe(() =>
      validar(esquemaEmisionApi, { tipo_dte: 39, lineas: [] }, 'documentos.2'),
    );
    expect(e.opciones.campos).toHaveProperty(['documentos.2.lineas']);
  });
});

describe('leerCuerpoJson', () => {
  const req = (cuerpo: string, tipo = 'application/json', largo?: string) =>
    new Request('https://boleteame.dev/api/v1/documentos', {
      method: 'POST',
      headers: { 'content-type': tipo, ...(largo ? { 'content-length': largo } : {}) },
      body: cuerpo,
    });

  async function codigo(r: Request): Promise<string> {
    try {
      await leerCuerpoJson(r);
      return 'ok';
    } catch (error) {
      return (error as ErrorApi).codigo;
    }
  }

  it('415 sin application/json, 413 si supera 256 KB, 400 si no es JSON', async () => {
    expect(await codigo(req('{}', 'text/plain'))).toBe('tipo_contenido');
    expect(await codigo(req('{}', 'application/json; charset=utf-8'))).toBe('ok');
    expect(await codigo(req('x'.repeat(262_145)))).toBe('cuerpo_muy_grande');
    expect(await codigo(req('{}', 'application/json', '999999'))).toBe('cuerpo_muy_grande');
    expect(await codigo(req('{"a":'))).toBe('json_invalido');
  });
});

describe('leerParametrosListado', () => {
  const p = (q: string) => leerParametrosListado(new URLSearchParams(q));

  it('valores por defecto y filtros válidos', () => {
    expect(p('')).toEqual({ limite: 20 });
    expect(
      p(
        'limite=100&tipo_dte=39&estado=aceptado,rechazado&desde=2026-11-01&hasta=2026-11-30&folio=43&receptor_rut=11.111.111-1&origen=api&clave_idempotencia=pedido-1',
      ),
    ).toEqual({
      limite: 100,
      tipoDte: 39,
      estados: ['aceptado', 'rechazado'],
      desde: '2026-11-01',
      hasta: '2026-11-30',
      folio: 43,
      receptorRut: '11111111-1',
      origen: 'api',
      claveIdempotencia: 'pedido-1',
    });
  });

  it('400 parametro_invalido con todos los campos malos', () => {
    const e = errorDe(() =>
      p('limite=0&tipo_dte=33&estado=pagado&desde=2026-02-30&folio=-1&receptor_rut=1-2&origen=cli'),
    );
    expect(e.codigo).toBe('parametro_invalido');
    expect(Object.keys(e.opciones.campos ?? {}).sort()).toEqual(
      ['desde', 'estado', 'folio', 'limite', 'origen', 'receptor_rut', 'tipo_dte'].sort(),
    );
    expect(errorDe(() => p('desde=2026-11-30&hasta=2026-11-01')).opciones.campos).toHaveProperty(
      'hasta',
    );
  });
});
