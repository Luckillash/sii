import { describe, expect, it, vi } from 'vitest';
import { type Borrador, calcularTotales, esquemaBorrador, MAXIMO_LINEAS } from '@/lib/emision';
import {
  type AlmacenSimple,
  aBorrador,
  almacenSesion,
  borrarDeSesion,
  cantidadDeTexto,
  claveSesion,
  crearStoreEmision,
  datosDe,
  datosIniciales,
  datosVacios,
  desdeBorrador,
  guardarEnSesion,
  leerGuardado,
  persistir,
  pesosDeTexto,
  type StoreEmision,
  tieneContenido,
  totalesDe,
  valorDescuentoDeTexto,
} from './emision';

const PRODUCTO = {
  id: '0b8f3f7e-5a43-4c39-9a0e-0f6b9a3f1c11',
  codigo: 'MANT-1',
  nombre: 'Mantención preventiva',
  precio: 59_500,
  exento: false,
  unidad: 'hr',
};

const RECEPTOR = {
  id: '4f0c9b7a-2d1e-4c3b-8a59-6e7d8c9b0a1f',
  rut: '76354771-K',
  razonSocial: 'Comercial Los Aromos SpA',
  correo: 'dte@losaromos.cl',
};

function nuevo(): StoreEmision {
  return crearStoreEmision(datosVacios('certificacion'));
}

function idLinea(store: StoreEmision, i = 0): string {
  return store.getState().lineas[i]?.id ?? '';
}

/** Almacén en memoria con la interfaz de `Storage`. */
function memoria(): AlmacenSimple & { datos: Map<string, string> } {
  const datos = new Map<string, string>();
  return {
    datos,
    getItem: (k) => datos.get(k) ?? null,
    setItem: (k, v) => {
      datos.set(k, v);
    },
    removeItem: (k) => {
      datos.delete(k);
    },
  };
}

/** Almacén que lanza en todo (modo privado, almacenamiento bloqueado). */
const roto: AlmacenSimple = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('textos de los campos numéricos', () => {
  it('pesosDeTexto acepta miles con punto y el signo peso', () => {
    expect(pesosDeTexto('1.190.000')).toBe(1_190_000);
    expect(pesosDeTexto('$ 1.190')).toBe(1_190);
    expect(pesosDeTexto('990')).toBe(990);
    expect(pesosDeTexto('')).toBeUndefined();
    expect(pesosDeTexto('12,5')).toBeNaN();
  });

  it('cantidadDeTexto acepta coma o punto decimal y miles chilenos', () => {
    expect(cantidadDeTexto('1,5')).toBe(1.5);
    expect(cantidadDeTexto('1.5')).toBe(1.5);
    expect(cantidadDeTexto('2')).toBe(2);
    expect(cantidadDeTexto('1.000')).toBe(1_000);
    expect(cantidadDeTexto('1.000,25')).toBe(1_000.25);
    expect(cantidadDeTexto(' ')).toBeUndefined();
    expect(cantidadDeTexto('1,2,3')).toBeNaN();
  });

  it('valorDescuentoDeTexto según el tipo', () => {
    expect(valorDescuentoDeTexto('monto', '5.000')).toBe(5_000);
    expect(valorDescuentoDeTexto('porcentaje', '12,5')).toBe(12.5);
  });
});

describe('store de emisión', () => {
  it('cada store es independiente (uno por montaje, nunca global)', () => {
    const a = nuevo();
    const b = nuevo();
    a.getState().cambiarLinea(idLinea(a), { nombre: 'Solo en A' });
    expect(b.getState().lineas[0]?.nombre).toBe('');
  });

  it('parte con boleta 39, receptor genérico y una línea', () => {
    const s = nuevo().getState();
    expect(s.tipoDte).toBe(39);
    expect(s.receptor.rut).toBe('');
    expect(s.lineas).toHaveLength(1);
    expect(s.lineas[0]).toMatchObject({ cantidad: '1', exento: false });
    expect(s.borradorId).toBeNull();
  });

  it('al pasar a 41 todas las líneas son exentas y el control queda fijo; al volver, se recupera', () => {
    const store = nuevo();
    store.getState().agregarLinea();
    store.getState().cambiarLinea(idLinea(store, 1), { exento: true });
    store.getState().cambiarTipo(41);
    expect(store.getState().lineas.map((l) => l.exento)).toEqual([true, true]);
    // En la 41 no se puede desmarcar.
    store.getState().cambiarLinea(idLinea(store, 0), { exento: false });
    expect(store.getState().lineas[0]?.exento).toBe(true);
    // Una línea nueva en la 41 ya es exenta.
    store.getState().agregarLinea();
    expect(store.getState().lineas[2]?.exento).toBe(true);
    store.getState().cambiarTipo(39);
    expect(store.getState().lineas.map((l) => l.exento)).toEqual([false, true, false]);
  });

  it('usar un producto llena nombre, precio, unidad y exento', () => {
    const store = nuevo();
    store.getState().usarProducto(idLinea(store), PRODUCTO);
    expect(store.getState().lineas[0]).toMatchObject({
      productoId: PRODUCTO.id,
      nombre: 'Mantención preventiva',
      precio: '59.500',
      unidad: 'hr',
      exento: false,
      cantidad: '1',
    });
    // Cambiar el nombre lo desliga del catálogo.
    store.getState().cambiarLinea(idLinea(store), { nombre: 'Otra cosa' });
    expect(store.getState().lineas[0]?.productoId).toBeNull();
  });

  it('un producto exento en una boleta 39 deja la línea exenta; en la 41 recuerda su valor', () => {
    const store = nuevo();
    store.getState().cambiarTipo(41);
    store.getState().usarProducto(idLinea(store), { ...PRODUCTO, exento: false });
    expect(store.getState().lineas[0]?.exento).toBe(true);
    store.getState().cambiarTipo(39);
    expect(store.getState().lineas[0]?.exento).toBe(false);
  });

  it('quitar la última línea deja una vacía; mover cambia el orden', () => {
    const store = nuevo();
    store.getState().cambiarLinea(idLinea(store), { nombre: 'A' });
    store.getState().agregarLinea();
    store.getState().cambiarLinea(idLinea(store, 1), { nombre: 'B' });
    store.getState().moverLinea(idLinea(store, 1), -1);
    expect(store.getState().lineas.map((l) => l.nombre)).toEqual(['B', 'A']);
    // Fuera de rango: nada.
    store.getState().moverLinea(idLinea(store, 0), -1);
    expect(store.getState().lineas.map((l) => l.nombre)).toEqual(['B', 'A']);
    store.getState().quitarLinea(idLinea(store, 0));
    store.getState().quitarLinea(idLinea(store, 0));
    expect(store.getState().lineas).toHaveLength(1);
    expect(store.getState().lineas[0]?.nombre).toBe('');
  });

  it(`no pasa de ${MAXIMO_LINEAS} líneas y las claves no se repiten`, () => {
    const store = nuevo();
    for (let i = 0; i < MAXIMO_LINEAS + 5; i++) store.getState().agregarLinea();
    const ids = store.getState().lineas.map((l) => l.id);
    expect(ids).toHaveLength(MAXIMO_LINEAS);
    expect(new Set(ids).size).toBe(MAXIMO_LINEAS);
  });

  it('usar un receptor del catálogo y cambiar su RUT lo desliga', () => {
    const store = nuevo();
    store.getState().usarReceptor(RECEPTOR);
    expect(store.getState().receptor).toEqual({
      rut: '76.354.771-K',
      razonSocial: 'Comercial Los Aromos SpA',
      correo: 'dte@losaromos.cl',
      receptorId: RECEPTOR.id,
    });
    store.getState().cambiarReceptor('razonSocial', 'Los Aromos');
    expect(store.getState().receptor.receptorId).toBe(RECEPTOR.id);
    store.getState().cambiarReceptor('rut', '11.111.111-1');
    expect(store.getState().receptor.receptorId).toBeNull();
    store.getState().quitarReceptor();
    expect(store.getState().receptor.rut).toBe('');
  });

  it('reiniciar vacía el formulario y conserva tipo y ambiente', () => {
    const store = nuevo();
    store.getState().cambiarTipo(41);
    store.getState().cambiarLinea(idLinea(store), { nombre: 'X', precio: '1.000' });
    store.getState().fijarBorradorId(PRODUCTO.id);
    store.getState().marcarIncierta({
      ambiente: 'certificacion',
      documentoId: null,
      folio: 12,
      trackId: null,
      en: '2026-11-15T12:00:00.000Z',
    });
    store.getState().reiniciar();
    const s = store.getState();
    expect(s.tipoDte).toBe(41);
    expect(s.ambiente).toBe('certificacion');
    expect(s.lineas[0]).toMatchObject({ nombre: '', exento: true });
    expect(s.borradorId).toBeNull();
    expect(s.incierta).toBeNull();
    expect(tieneContenido(s)).toBe(false);
  });
});

describe('conversión al contrato y totales', () => {
  it('aBorrador arma un Borrador válido para esquemaBorrador', () => {
    const store = nuevo();
    store.getState().cambiarLinea(idLinea(store), {
      nombre: 'Mantención',
      cantidad: '2',
      precio: '1.190',
    });
    store.getState().cambiarDescuento({ tipo: 'porcentaje', valor: '10' });
    const b = aBorrador(datosDe(store));
    expect(b).toEqual({
      tipoDte: 39,
      ambiente: 'certificacion',
      receptor: { rut: '', razonSocial: null, correo: null, receptorId: null },
      lineas: [
        {
          productoId: null,
          nombre: 'Mantención',
          cantidad: 2,
          precio: 1_190,
          exento: false,
          unidad: null,
        },
      ],
      descuento: { tipo: 'porcentaje', valor: 10 },
    });
    expect(esquemaBorrador.safeParse(b).success).toBe(true);
  });

  it('un precio vacío llega como NaN y zod lo explica', () => {
    const store = nuevo();
    store.getState().cambiarLinea(idLinea(store), { nombre: 'X' });
    const r = esquemaBorrador.safeParse(aBorrador(datosDe(store)));
    expect(r.success).toBe(false);
    expect(r.error?.issues.find((i) => i.path.join('.') === 'lineas.0.precio')?.message).toBe(
      'Escribe el precio.',
    );
  });

  it('totalesDe usa calcularTotales (precio bruto, IVA incluido)', () => {
    const store = nuevo();
    store.getState().cambiarLinea(idLinea(store), { nombre: 'A', precio: '1.190.000' });
    store.getState().agregarLinea();
    store.getState().cambiarLinea(idLinea(store, 1), {
      nombre: 'B',
      precio: '10.000',
      exento: true,
    });
    const t = totalesDe(datosDe(store));
    expect(t).toMatchObject({ neto: 1_000_000, iva: 190_000, exento: 10_000, total: 1_200_000 });
    expect(t).toEqual(calcularTotales(aBorrador(datosDe(store))));
  });

  it('totalesDe cuenta como 0 lo que aún no es un número', () => {
    const store = nuevo();
    store.getState().cambiarLinea(idLinea(store), { cantidad: 'abc', precio: '' });
    store.getState().cambiarDescuento({ valor: '1,5' });
    expect(totalesDe(datosDe(store)).total).toBe(0);
  });

  it('desdeBorrador y aBorrador hacen el viaje de ida y vuelta', () => {
    const b: Borrador = {
      tipoDte: 39,
      ambiente: 'produccion',
      receptor: {
        rut: '76354771-K',
        razonSocial: 'Comercial Los Aromos SpA',
        correo: null,
        receptorId: RECEPTOR.id,
      },
      lineas: [
        {
          productoId: null,
          nombre: 'Kilo de pan',
          cantidad: 1.5,
          precio: 2_390,
          exento: false,
          unidad: 'kg',
        },
      ],
      descuento: { tipo: 'monto', valor: 1_000 },
    };
    const d = desdeBorrador(b, PRODUCTO.id);
    expect(d.lineas[0]).toMatchObject({ cantidad: '1,5', precio: '2.390', unidad: 'kg' });
    expect(d.receptor.rut).toBe('76.354.771-K');
    expect(d.descuento).toEqual({ tipo: 'monto', valor: '1.000' });
    expect(d.borradorId).toBe(PRODUCTO.id);
    const vuelta = aBorrador(d);
    expect(vuelta.lineas).toEqual(b.lineas);
    expect(vuelta.descuento).toEqual(b.descuento);
    expect(vuelta.receptor).toMatchObject({ razonSocial: 'Comercial Los Aromos SpA' });
  });

  it('desdeBorrador: el receptor genérico vuelve como campo vacío', () => {
    const d = desdeBorrador(
      {
        tipoDte: 41,
        ambiente: 'certificacion',
        receptor: { rut: '66666666-6', razonSocial: 'Cliente General', correo: 'a@b.cl' },
        lineas: [{ nombre: 'Clase', cantidad: 1, precio: 5_000, exento: true }],
      },
      null,
    );
    expect(d.receptor).toEqual({ rut: '', razonSocial: '', correo: 'a@b.cl', receptorId: null });
    expect(d.lineas[0]?.exento).toBe(true);
  });
});

describe('persistencia en sessionStorage', () => {
  const clave = claveSesion('org-1', 'empresa-1');

  it('la clave es por organización y empresa', () => {
    expect(clave).toBe('boleteame:emision:org-1:empresa-1');
    expect(claveSesion('org-1', 'empresa-2')).not.toBe(clave);
  });

  it('persistir guarda cada cambio y leerGuardado lo recupera', () => {
    const almacen = memoria();
    const store = nuevo();
    const dejar = persistir(store, almacen, clave);
    store.getState().cambiarLinea(idLinea(store), { nombre: 'Guardado' });
    expect(leerGuardado(almacen, clave)?.lineas[0]?.nombre).toBe('Guardado');
    dejar();
    store.getState().cambiarLinea(idLinea(store), { nombre: 'Ya no' });
    expect(leerGuardado(almacen, clave)?.lineas[0]?.nombre).toBe('Guardado');
  });

  it('lo corrupto o de otra versión se ignora', () => {
    const almacen = memoria();
    almacen.setItem(clave, '{no es json');
    expect(leerGuardado(almacen, clave)).toBeNull();
    almacen.setItem(clave, JSON.stringify({ v: 99, datos: datosVacios('certificacion') }));
    expect(leerGuardado(almacen, clave)).toBeNull();
    almacen.setItem(clave, JSON.stringify({ v: 1, datos: { tipoDte: 33 } }));
    expect(leerGuardado(almacen, clave)).toBeNull();
  });

  it('un almacenamiento que lanza o que no existe no rompe nada', () => {
    expect(leerGuardado(roto, clave)).toBeNull();
    expect(() => guardarEnSesion(roto, clave, datosVacios('certificacion'))).not.toThrow();
    expect(() => borrarDeSesion(roto, clave)).not.toThrow();
    expect(leerGuardado(null, clave)).toBeNull();
    const store = nuevo();
    const dejar = persistir(store, roto, clave);
    expect(() => store.getState().agregarLinea()).not.toThrow();
    dejar();
    expect(persistir(store, null, clave)).toBeTypeOf('function');
  });

  it('almacenSesion es null sin window (servidor) o si el acceso lanza', () => {
    expect(almacenSesion()).toBeNull();
    vi.stubGlobal('window', {
      get sessionStorage() {
        throw new Error('SecurityError');
      },
    });
    try {
      expect(almacenSesion()).toBeNull();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('datosIniciales', () => {
  const servidor: { id: string; datos: Borrador } = {
    id: 'borrador-a',
    datos: {
      tipoDte: 39,
      ambiente: 'certificacion',
      receptor: { rut: '' },
      lineas: [{ nombre: 'Del servidor', cantidad: 1, precio: 1_000, exento: false }],
    },
  };

  function guardado(nombre: string, borradorId: string | null) {
    const d = datosVacios('certificacion');
    return {
      ...d,
      borradorId,
      lineas: d.lineas.map((l) => ({ ...l, nombre })),
    };
  }

  it('sin nada: el formulario vacío del ambiente por defecto', () => {
    const d = datosIniciales({
      guardado: null,
      servidor: null,
      borradoresIds: [],
      ambiente: 'produccion',
    });
    expect(d.ambiente).toBe('produccion');
    expect(d.lineas[0]?.nombre).toBe('');
  });

  it('con ?borrador: la sesión solo si es el mismo borrador (cambios sin guardar)', () => {
    const mismo = datosIniciales({
      guardado: guardado('Cambios sin guardar', 'borrador-a'),
      servidor,
      borradoresIds: ['borrador-a'],
      ambiente: 'certificacion',
    });
    expect(mismo.lineas[0]?.nombre).toBe('Cambios sin guardar');
    const otro = datosIniciales({
      guardado: guardado('Otro', null),
      servidor,
      borradoresIds: ['borrador-a'],
      ambiente: 'certificacion',
    });
    expect(otro.lineas[0]?.nombre).toBe('Del servidor');
    expect(otro.borradorId).toBe('borrador-a');
  });

  it('sin ?borrador: la sesión; un borrador que ya no existe sigue como nuevo', () => {
    const d = datosIniciales({
      guardado: guardado('En la sesión', 'borrador-viejo'),
      servidor: null,
      borradoresIds: ['borrador-a'],
      ambiente: 'certificacion',
    });
    expect(d.lineas[0]?.nombre).toBe('En la sesión');
    expect(d.borradorId).toBeNull();
  });

  it('la emisión por verificar de la sesión se conserva aunque se cargue otro borrador', () => {
    const incierta = {
      ambiente: 'produccion' as const,
      documentoId: null,
      folio: 77,
      trackId: null,
      en: '2026-11-15T12:00:00.000Z',
    };
    const d = datosIniciales({
      guardado: { ...guardado('x', null), incierta },
      servidor,
      borradoresIds: ['borrador-a'],
      ambiente: 'certificacion',
    });
    expect(d.incierta).toEqual(incierta);
  });
});
