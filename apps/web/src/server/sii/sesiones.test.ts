import { randomBytes } from 'node:crypto';
import {
  FoliosSinCafError,
  RespuestaHttp,
  relojFijo,
  SesionCaducaError,
  SesionSii,
} from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import type { ClienteServicio } from '../supabase/service';
import {
  type AlmacenSesiones,
  type ClaveSesion,
  claveSesion,
  conSesionReutilizada,
  ErrorSesiones,
  SesionesSupabase,
} from './sesiones';

const AHORA = new Date('2026-11-13T15:00:00Z');
const reloj = relojFijo(AHORA);
const CERT = '00000000-0000-4000-8000-000000000001';
const CLAVE: ClaveSesion = { certificadoId: CERT, ambiente: 'certificacion' };
const COOKIE_SECRETA = 'VALOR-COOKIE-SECRETO-987';

type Fila = {
  certificado_id: string;
  ambiente: string;
  cookies_cifradas: string;
  expira_en: string | null;
  ultimo_uso_en: string;
};

/** Imita `sesiones_sii` en un Map, guardando lo que llega tal cual. */
function clienteFalso() {
  const filas = new Map<string, Fila>();
  const id = (c: unknown, a: unknown) => `${String(c)}|${String(a)}`;
  const operaciones: string[] = [];
  let fallar: string | null = null;
  const error = { code: '42501', message: 'detalle con datos de la fila' };

  function from(tabla: string) {
    if (tabla !== 'sesiones_sii') throw new Error(`Tabla inesperada: ${tabla}`);
    const filtros: Record<string, unknown> = {};
    let accion: 'select' | 'update' | 'delete' = 'select';
    let cambios: Partial<Fila> = {};
    const ejecutar = () => {
      operaciones.push(accion);
      if (fallar === accion) return { data: null, error };
      const clave = id(filtros.certificado_id, filtros.ambiente);
      if (accion === 'update') {
        const fila = filas.get(clave);
        if (fila) filas.set(clave, { ...fila, ...cambios });
      } else if (accion === 'delete') {
        filas.delete(clave);
      }
      return { data: null, error: null };
    };
    const consulta = {
      select: () => consulta,
      update: (c: Partial<Fila>) => {
        accion = 'update';
        cambios = c;
        return consulta;
      },
      delete: () => {
        accion = 'delete';
        return consulta;
      },
      eq: (columna: string, valor: unknown) => {
        filtros[columna] = valor;
        return consulta;
      },
      maybeSingle: async () => {
        operaciones.push('select');
        if (fallar === 'select') return { data: null, error };
        return {
          data: filas.get(id(filtros.certificado_id, filtros.ambiente)) ?? null,
          error: null,
        };
      },
      upsert: async (fila: Partial<Fila>, opciones: { onConflict: string }) => {
        operaciones.push('upsert');
        if (opciones.onConflict !== 'certificado_id,ambiente') throw new Error('onConflict');
        if (fallar === 'upsert') return { data: null, error };
        const clave = id(fila.certificado_id, fila.ambiente);
        const previa = filas.get(clave);
        filas.set(clave, {
          expira_en: null,
          ...previa,
          ...fila,
        } as Fila);
        return { data: null, error: null };
      },
      // biome-ignore lint/suspicious/noThenProperty: imita el builder de PostgREST, que es thenable.
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(ejecutar()).then(ok, ko),
    };
    return consulta;
  }

  return {
    cliente: { from } as unknown as ClienteServicio,
    filas,
    operaciones,
    fallarEn: (a: string | null) => {
      fallar = a;
    },
  };
}

function sesionDePrueba(valor = COOKIE_SECRETA): SesionSii {
  return SesionSii.desdeArreglo([
    { name: 'TOKEN', value: valor, domain: 'sii.cl', host_only: false },
    { name: 'NETSCAPE_LIVEWIRE.rut', value: '12345678', domain: 'sii.cl', host_only: false },
  ]);
}

describe('SesionesSupabase', () => {
  const llave = randomBytes(32);

  it('guarda cifrado (sin las cookies a la vista) y lo recupera', async () => {
    const falso = clienteFalso();
    const store = new SesionesSupabase(falso.cliente, llave, { reloj });
    const expira = new Date(AHORA.getTime() + 3_600_000);
    await store.guardar(CLAVE, sesionDePrueba(), expira);

    const [fila] = [...falso.filas.values()];
    expect(fila?.cookies_cifradas).toMatch(/^\\x[0-9a-f]+$/);
    expect(
      Buffer.from(fila?.cookies_cifradas.slice(2) ?? '', 'hex').toString('latin1'),
    ).not.toContain(COOKIE_SECRETA);
    expect(fila?.expira_en).toBe(expira.toISOString());
    expect(fila?.ultimo_uso_en).toBe(AHORA.toISOString());

    const leida = await store.obtener(CLAVE);
    expect(leida?.aArreglo()).toEqual(sesionDePrueba().aArreglo());
    expect(leida?.valor('TOKEN')).toBe(COOKIE_SECRETA);
  });

  it('obtener actualiza ultimo_uso_en', async () => {
    const falso = clienteFalso();
    await new SesionesSupabase(falso.cliente, llave, { reloj }).guardar(CLAVE, sesionDePrueba());
    const despues = new Date(AHORA.getTime() + 60_000);
    await new SesionesSupabase(falso.cliente, llave, { reloj: relojFijo(despues) }).obtener(CLAVE);
    expect([...falso.filas.values()][0]?.ultimo_uso_en).toBe(despues.toISOString());
  });

  it('sin fila, vencida, con otra llave o copiada a otra clave: caché vacío', async () => {
    const falso = clienteFalso();
    const store = new SesionesSupabase(falso.cliente, llave, { reloj });
    expect(await store.obtener(CLAVE)).toBeUndefined();

    await store.guardar(CLAVE, sesionDePrueba(), new Date(AHORA.getTime() - 1));
    expect(await store.obtener(CLAVE)).toBeUndefined();

    await store.guardar(CLAVE, sesionDePrueba(), null);
    expect(await store.obtener(CLAVE)).toBeDefined();
    expect(
      await new SesionesSupabase(falso.cliente, randomBytes(32), { reloj }).obtener(CLAVE),
    ).toBeUndefined();

    // AAD: las cookies copiadas a otro ambiente u otro certificado no descifran.
    const fila = [...falso.filas.values()][0] as Fila;
    falso.filas.set(`${CERT}|produccion`, { ...fila, ambiente: 'produccion' });
    expect(await store.obtener({ ...CLAVE, ambiente: 'produccion' })).toBeUndefined();

    // Basura en la columna.
    falso.filas.set(`${CERT}|certificacion`, { ...fila, cookies_cifradas: 'no-es-bytea' });
    expect(await store.obtener(CLAVE)).toBeUndefined();
  });

  it('guardar sin expiraEn conserva el vencimiento de la fila', async () => {
    const falso = clienteFalso();
    const store = new SesionesSupabase(falso.cliente, llave, { reloj });
    const expira = new Date(AHORA.getTime() + 3_600_000);
    await store.guardar(CLAVE, sesionDePrueba(), expira);
    await store.guardar(CLAVE, sesionDePrueba('OTRO-VALOR'));
    expect([...falso.filas.values()][0]?.expira_en).toBe(expira.toISOString());
    expect((await store.obtener(CLAVE))?.valor('TOKEN')).toBe('OTRO-VALOR');
  });

  it('una sesión sin cookies no se guarda: se descarta la fila', async () => {
    const falso = clienteFalso();
    const store = new SesionesSupabase(falso.cliente, llave, { reloj });
    await store.guardar(CLAVE, sesionDePrueba());
    await store.guardar(CLAVE, new SesionSii());
    expect(falso.filas.size).toBe(0);
  });

  it('descarta', async () => {
    const falso = clienteFalso();
    const store = new SesionesSupabase(falso.cliente, llave, { reloj });
    await store.guardar(CLAVE, sesionDePrueba());
    await store.descartar(CLAVE);
    expect(falso.filas.size).toBe(0);
  });

  it('los errores no incluyen las cookies ni el detalle de PostgREST', async () => {
    const falso = clienteFalso();
    const store = new SesionesSupabase(falso.cliente, llave, { reloj });
    for (const accion of ['upsert', 'select', 'delete'] as const) {
      falso.fallarEn(accion);
      const intento =
        accion === 'upsert'
          ? store.guardar(CLAVE, sesionDePrueba())
          : accion === 'select'
            ? store.obtener(CLAVE)
            : store.descartar(CLAVE);
      const error = await intento.then(
        () => null,
        (e: unknown) => e,
      );
      expect(error).toBeInstanceOf(ErrorSesiones);
      expect((error as Error).message).toContain('42501');
      expect((error as Error).message).not.toContain(COOKIE_SECRETA);
      expect((error as Error).message).not.toContain('detalle con datos');
    }
  });

  it('si falla actualizar ultimo_uso_en, la sesión se entrega igual', async () => {
    const falso = clienteFalso();
    const store = new SesionesSupabase(falso.cliente, llave, { reloj });
    await store.guardar(CLAVE, sesionDePrueba());
    falso.fallarEn('update');
    expect(await store.obtener(CLAVE)).toBeDefined();
  });

  it('claveSesion toma el id del certificado ya cargado', () => {
    expect(claveSesion({ certificadoId: CERT }, 'produccion')).toEqual({
      certificadoId: CERT,
      ambiente: 'produccion',
    });
  });
});

/** Almacén en memoria que registra lo que pasa, para probar `conSesionReutilizada`. */
function almacenMemoria(inicial?: SesionSii) {
  let guardada = inicial;
  const eventos: string[] = [];
  const almacen: AlmacenSesiones & { fallarGuardar: boolean } = {
    fallarGuardar: false,
    async obtener() {
      eventos.push('obtener');
      return guardada;
    },
    async guardar(_clave, sesion, expiraEn) {
      eventos.push(
        `guardar:${expiraEn === undefined ? 'conserva' : String(expiraEn?.toISOString() ?? null)}`,
      );
      if (almacen.fallarGuardar) throw new ErrorSesiones('No se pudo guardar');
      guardada = sesion;
    },
    async descartar() {
      eventos.push('descartar');
      guardada = undefined;
    },
  };
  return { almacen, eventos, actual: () => guardada };
}

describe('conSesionReutilizada', () => {
  it('reutiliza la sesión guardada sin autenticar', async () => {
    const { almacen, eventos } = almacenMemoria(sesionDePrueba());
    let logins = 0;
    const r = await conSesionReutilizada({
      sesiones: almacen,
      clave: CLAVE,
      autenticar: async () => {
        logins += 1;
        return sesionDePrueba('NUEVA');
      },
      usar: async (s) => s.valor('TOKEN'),
    });
    expect(r).toBe(COOKIE_SECRETA);
    expect(logins).toBe(0);
    expect(eventos).toEqual(['obtener', 'guardar:conserva']);
  });

  it('sin sesión guardada: autentica, guarda con su vencimiento y usa', async () => {
    const { almacen, eventos, actual } = almacenMemoria();
    const expira = new Date(AHORA.getTime() + 1_800_000);
    const r = await conSesionReutilizada({
      sesiones: almacen,
      clave: CLAVE,
      autenticar: async () => sesionDePrueba('NUEVA'),
      usar: async (s) => s.valor('TOKEN'),
      expiraEn: () => expira,
    });
    expect(r).toBe('NUEVA');
    expect(eventos).toEqual(['obtener', `guardar:${expira.toISOString()}`, 'guardar:conserva']);
    expect(actual()?.valor('TOKEN')).toBe('NUEVA');
  });

  it('SesionCaducaError con la guardada: descarta, autentica una vez y reintenta', async () => {
    const { almacen, eventos } = almacenMemoria(sesionDePrueba('VIEJA'));
    const usadas: (string | null)[] = [];
    const r = await conSesionReutilizada({
      sesiones: almacen,
      clave: CLAVE,
      autenticar: async () => sesionDePrueba('NUEVA'),
      usar: async (s) => {
        usadas.push(s.valor('TOKEN'));
        if (s.valor('TOKEN') === 'VIEJA') throw new SesionCaducaError('caducó');
        return 'ok';
      },
    });
    expect(r).toBe('ok');
    expect(usadas).toEqual(['VIEJA', 'NUEVA']);
    expect(eventos).toEqual(['obtener', 'descartar', 'guardar:null', 'guardar:conserva']);
  });

  it('si la sesión recién creada también caduca, no hay un tercer intento', async () => {
    const { almacen, eventos, actual } = almacenMemoria(sesionDePrueba('VIEJA'));
    let logins = 0;
    const intento = conSesionReutilizada({
      sesiones: almacen,
      clave: CLAVE,
      autenticar: async () => {
        logins += 1;
        return sesionDePrueba('NUEVA');
      },
      usar: async () => {
        throw new SesionCaducaError('caducó');
      },
    });
    await expect(intento).rejects.toBeInstanceOf(SesionCaducaError);
    expect(logins).toBe(1);
    expect(actual()).toBeUndefined();
    expect(eventos.at(-1)).toBe('descartar');
  });

  it('otro error no reintenta ni autentica, y conserva la sesión', async () => {
    const { almacen, actual } = almacenMemoria(sesionDePrueba());
    let logins = 0;
    const falla = new FoliosSinCafError(1, 5, 'certificacion', 'maullin.sii.cl', 'sin CAF');
    const intento = conSesionReutilizada({
      sesiones: almacen,
      clave: CLAVE,
      autenticar: async () => {
        logins += 1;
        return sesionDePrueba('NUEVA');
      },
      usar: async () => {
        throw falla;
      },
    });
    await expect(intento).rejects.toBe(falla);
    expect(logins).toBe(0);
    expect(actual()?.valor('TOKEN')).toBe(COOKIE_SECRETA);
  });

  it('guarda las cookies renovadas durante el uso', async () => {
    const { almacen, actual } = almacenMemoria(sesionDePrueba());
    await conSesionReutilizada({
      sesiones: almacen,
      clave: CLAVE,
      autenticar: async () => sesionDePrueba('NUEVA'),
      usar: async (s) => {
        s.recibir(
          'https://maullin.sii.cl/cvc_cgi/dte/of_solicita_folios',
          new RespuestaHttp(
            200,
            [['set-cookie', 'TOKEN=RENOVADA; Domain=sii.cl; Path=/']],
            Buffer.alloc(0),
          ),
        );
      },
    });
    expect(actual()?.valor('TOKEN')).toBe('RENOVADA');
  });

  it('si guardar falla después de usar, el resultado no se pierde', async () => {
    const { almacen } = almacenMemoria();
    almacen.fallarGuardar = true;
    const r = await conSesionReutilizada({
      sesiones: almacen,
      clave: CLAVE,
      autenticar: async () => sesionDePrueba('NUEVA'),
      usar: async () => 'CAF timbrado',
    });
    expect(r).toBe('CAF timbrado');
  });
});
