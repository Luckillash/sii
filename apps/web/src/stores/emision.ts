import { z } from 'zod';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  type Borrador,
  calcularTotales,
  type DescuentoBorrador,
  MAXIMO_LINEAS,
  type ProductoCatalogo,
  type ReceptorCatalogo,
  type Totales,
} from '@/lib/emision';
import type { AmbienteSii, TipoFolio } from '@/lib/folios';
import { formatearMiles, formatearRut } from '@/lib/formatos';

// `useEmisionStore` (PLAN-SAAS §4.3): el borrador de la boleta que arma `/[org]/emitir`.
// Solo estado de cliente. El store es vanilla (`createStore`) y lo crea un provider de
// contexto por montaje (`ProveedorEmision.tsx`): nunca un singleton de módulo, para no
// compartir estado entre usuarios en el servidor.
//
// Los campos numéricos se guardan como el texto que escribe la persona («1.190.000»,
// «1,5») y se convierten al armar el `Borrador` del contrato (`aBorrador`); los totales
// en vivo salen de `calcularTotales` de `@/lib/emision`, la misma cuenta que la librería.
//
// Persistencia: el borrador sin guardar va a `sessionStorage`, una clave por organización
// y empresa (`claveSesion`). `sessionStorage` puede no existir o lanzar (modo privado,
// almacenamiento bloqueado, servidor): toda lectura y escritura va en try/catch y la
// pantalla funciona igual sin él.

// --- Modelo del formulario --------------------------------------------------------------

export interface LineaFormulario {
  /** Clave estable de la línea en la lista (no viaja al servidor). */
  id: string;
  productoId: string | null;
  nombre: string;
  /** Texto del campo: «1», «1,5», «2.000». */
  cantidad: string;
  /** Texto del campo, en pesos brutos: «1.190.000». */
  precio: string;
  exento: boolean;
  unidad: string;
  /**
   * Lo que tenía `exento` antes de pasar a boleta exenta (41), donde todas las líneas son
   * exentas; se recupera al volver a la boleta afecta (39). `null` fuera de la 41.
   */
  exentoPrevio: boolean | null;
}

export interface ReceptorFormulario {
  /** Vacío = receptor genérico (66.666.666-6 Cliente General). */
  rut: string;
  razonSocial: string;
  correo: string;
  receptorId: string | null;
}

export interface DescuentoFormulario {
  tipo: DescuentoBorrador['tipo'];
  /** Texto del campo; vacío = sin descuento. */
  valor: string;
}

/** Emisión que quedó por verificar: bloquea emitir hasta empezar otra boleta a propósito. */
export interface EmisionIncierta {
  ambiente: AmbienteSii;
  documentoId: string | null;
  folio: number | null;
  trackId: string | null;
  /** ISO 8601. */
  en: string;
}

export interface DatosEmision {
  tipoDte: TipoFolio;
  ambiente: AmbienteSii;
  receptor: ReceptorFormulario;
  lineas: LineaFormulario[];
  descuento: DescuentoFormulario;
  /** Borrador guardado que se está editando (`documentos.id`), o `null` si es nuevo. */
  borradorId: string | null;
  incierta: EmisionIncierta | null;
  /** Contador de las claves de línea. */
  siguienteId: number;
}

type CambiosLinea = Partial<
  Pick<LineaFormulario, 'nombre' | 'cantidad' | 'precio' | 'exento' | 'unidad'>
>;

export interface AccionesEmision {
  cambiarTipo: (tipo: TipoFolio) => void;
  cambiarAmbiente: (ambiente: AmbienteSii) => void;
  cambiarReceptor: (campo: 'rut' | 'razonSocial' | 'correo', valor: string) => void;
  usarReceptor: (receptor: ReceptorCatalogo) => void;
  /** Vuelve al receptor genérico. */
  quitarReceptor: () => void;
  agregarLinea: () => void;
  quitarLinea: (id: string) => void;
  moverLinea: (id: string, delta: -1 | 1) => void;
  cambiarLinea: (id: string, cambios: CambiosLinea) => void;
  usarProducto: (id: string, producto: ProductoCatalogo) => void;
  cambiarDescuento: (cambios: Partial<DescuentoFormulario>) => void;
  /** Carga un borrador guardado (de `?borrador=<id>`). */
  cargar: (borrador: Borrador, borradorId: string) => void;
  fijarBorradorId: (id: string | null) => void;
  marcarIncierta: (incierta: EmisionIncierta) => void;
  /** Formulario vacío; conserva el tipo y el ambiente elegidos. */
  reiniciar: () => void;
  /** Reemplaza todos los datos (al hidratar desde la sesión). */
  reemplazar: (datos: DatosEmision) => void;
}

export type EstadoEmision = DatosEmision & AccionesEmision;
export type StoreEmision = StoreApi<EstadoEmision>;

function lineaVacia(id: number, tipo: TipoFolio): LineaFormulario {
  return {
    id: `l${id}`,
    productoId: null,
    nombre: '',
    cantidad: '1',
    precio: '',
    exento: tipo === 41,
    unidad: '',
    exentoPrevio: tipo === 41 ? false : null,
  };
}

export const RECEPTOR_VACIO: Readonly<ReceptorFormulario> = Object.freeze({
  rut: '',
  razonSocial: '',
  correo: '',
  receptorId: null,
});

/** Formulario vacío: boleta 39, receptor genérico y una línea. */
export function datosVacios(ambiente: AmbienteSii, tipoDte: TipoFolio = 39): DatosEmision {
  return {
    tipoDte,
    ambiente,
    receptor: { ...RECEPTOR_VACIO },
    lineas: [lineaVacia(1, tipoDte)],
    descuento: { tipo: 'monto', valor: '' },
    borradorId: null,
    incierta: null,
    siguienteId: 2,
  };
}

// --- Textos de los campos numéricos -----------------------------------------------------

/**
 * Pesos enteros de un campo de texto: acepta `1.190.000`, `1190000` o `$ 1.190`. Vacío →
 * `undefined`; con decimales u otros caracteres → `NaN` (zod lo rechaza con su mensaje).
 */
export function pesosDeTexto(texto: string): number | undefined {
  const limpio = texto.replace(/[$\s.]/g, '');
  if (limpio === '') return undefined;
  return /^\d+$/.test(limpio) ? Number(limpio) : Number.NaN;
}

/**
 * Cantidad de un campo de texto, con coma o punto decimal: `1,5`, `1.5`, `2`. Un punto
 * seguido de grupos de exactamente tres dígitos y sin coma se lee como miles (`1.000` =
 * mil), como se escriben los números en Chile. Vacío → `undefined`; inválido → `NaN`.
 */
export function cantidadDeTexto(texto: string): number | undefined {
  const t = texto.replace(/\s/g, '');
  if (t === '') return undefined;
  let normal: string;
  if (t.includes(',')) normal = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) normal = t.replace(/\./g, '');
  else normal = t;
  return /^\d+(\.\d+)?$/.test(normal) ? Number(normal) : Number.NaN;
}

/** Valor del descuento según su tipo (pesos o porcentaje). Vacío → `undefined`. */
export function valorDescuentoDeTexto(
  tipo: DescuentoFormulario['tipo'],
  texto: string,
): number | undefined {
  return tipo === 'monto' ? pesosDeTexto(texto) : cantidadDeTexto(texto);
}

/** `1.5` → `1,5`. */
export function textoCantidad(n: number): string {
  return String(n).replace('.', ',');
}

/** `1190000` → `1.190.000`. */
export function textoPesos(n: number): string {
  return formatearMiles(n);
}

const finitoOCero = (n: number | undefined): number =>
  n !== undefined && Number.isFinite(n) ? n : 0;

// --- Conversión al contrato -------------------------------------------------------------

/** Lo que se manda a las Server Actions. Lo vacío o inválido llega como `NaN`: zod lo explica. */
export function aBorrador(
  d: Omit<DatosEmision, 'borradorId' | 'incierta' | 'siguienteId'>,
): Borrador {
  const descuento = valorDescuentoDeTexto(d.descuento.tipo, d.descuento.valor);
  return {
    tipoDte: d.tipoDte,
    ambiente: d.ambiente,
    receptor: {
      rut: d.receptor.rut.trim(),
      razonSocial: d.receptor.razonSocial.trim() || null,
      correo: d.receptor.correo.trim() || null,
      receptorId: d.receptor.receptorId,
    },
    lineas: d.lineas.map((l) => ({
      productoId: l.productoId,
      nombre: l.nombre,
      cantidad: cantidadDeTexto(l.cantidad) ?? Number.NaN,
      precio: pesosDeTexto(l.precio) ?? Number.NaN,
      exento: l.exento,
      unidad: l.unidad.trim() || null,
    })),
    descuento: descuento === undefined ? null : { tipo: d.descuento.tipo, valor: descuento },
  };
}

/** Totales en vivo: lo que aún no es un número cuenta como 0. */
export function totalesDe(d: Pick<DatosEmision, 'lineas' | 'descuento'>): Totales {
  const valor = finitoOCero(valorDescuentoDeTexto(d.descuento.tipo, d.descuento.valor));
  return calcularTotales({
    lineas: d.lineas.map((l) => ({
      cantidad: finitoOCero(cantidadDeTexto(l.cantidad)),
      precio: finitoOCero(pesosDeTexto(l.precio)),
      exento: l.exento,
    })),
    descuento: valor > 0 ? { tipo: d.descuento.tipo, valor } : null,
  });
}

/** Un `Borrador` del servidor en la forma del formulario. */
export function desdeBorrador(
  b: Borrador,
  borradorId: string | null,
  incierta: EmisionIncierta | null = null,
): DatosEmision {
  const lineas = b.lineas.slice(0, MAXIMO_LINEAS).map<LineaFormulario>((l, i) => ({
    id: `l${i + 1}`,
    productoId: l.productoId ?? null,
    nombre: l.nombre,
    cantidad: Number.isFinite(l.cantidad) ? textoCantidad(l.cantidad) : '',
    precio: Number.isFinite(l.precio) ? textoPesos(l.precio) : '',
    exento: b.tipoDte === 41 ? true : l.exento,
    unidad: l.unidad ?? '',
    exentoPrevio: b.tipoDte === 41 ? l.exento : null,
  }));
  const generico = b.receptor.rut === '' || b.receptor.rut === '66666666-6';
  return {
    tipoDte: b.tipoDte,
    ambiente: b.ambiente,
    receptor: generico
      ? { ...RECEPTOR_VACIO, correo: b.receptor.correo ?? '' }
      : {
          rut: formatearRut(b.receptor.rut),
          razonSocial: b.receptor.razonSocial ?? '',
          correo: b.receptor.correo ?? '',
          receptorId: b.receptor.receptorId ?? null,
        },
    lineas: lineas.length > 0 ? lineas : [lineaVacia(1, b.tipoDte)],
    descuento:
      b.descuento && b.descuento.valor > 0
        ? {
            tipo: b.descuento.tipo,
            valor:
              b.descuento.tipo === 'monto'
                ? textoPesos(b.descuento.valor)
                : textoCantidad(b.descuento.valor),
          }
        : { tipo: 'monto', valor: '' },
    borradorId,
    incierta,
    siguienteId: Math.max(lineas.length, 1) + 1,
  };
}

/** ¿Escribió algo la persona? (para no descartar trabajo sin preguntar). */
export function tieneContenido(
  d: Pick<DatosEmision, 'receptor' | 'lineas' | 'descuento'>,
): boolean {
  return (
    d.receptor.rut.trim() !== '' ||
    d.receptor.razonSocial.trim() !== '' ||
    d.receptor.correo.trim() !== '' ||
    d.descuento.valor.trim() !== '' ||
    d.lineas.length > 1 ||
    d.lineas.some((l) => l.nombre.trim() !== '' || l.precio.trim() !== '')
  );
}

// --- Store ------------------------------------------------------------------------------

function soloDatos(s: EstadoEmision): DatosEmision {
  return {
    tipoDte: s.tipoDte,
    ambiente: s.ambiente,
    receptor: s.receptor,
    lineas: s.lineas,
    descuento: s.descuento,
    borradorId: s.borradorId,
    incierta: s.incierta,
    siguienteId: s.siguienteId,
  };
}

export function datosDe(store: StoreEmision): DatosEmision {
  return soloDatos(store.getState());
}

/** Crea un store nuevo (uno por montaje del formulario; nunca global). */
export function crearStoreEmision(inicial: DatosEmision): StoreEmision {
  return createStore<EstadoEmision>()((set, get) => ({
    ...inicial,

    cambiarTipo: (tipo) =>
      set((s) => {
        if (s.tipoDte === tipo) return {};
        const lineas = s.lineas.map((l) =>
          tipo === 41
            ? { ...l, exentoPrevio: l.exento, exento: true }
            : { ...l, exento: l.exentoPrevio ?? l.exento, exentoPrevio: null },
        );
        return { tipoDte: tipo, lineas };
      }),

    cambiarAmbiente: (ambiente) => set({ ambiente }),

    cambiarReceptor: (campo, valor) =>
      set((s) => ({
        receptor: {
          ...s.receptor,
          [campo]: valor,
          // Otro RUT ya no es el receptor del catálogo que se eligió.
          receptorId:
            campo === 'rut' && valor.trim() !== s.receptor.rut.trim()
              ? null
              : s.receptor.receptorId,
        },
      })),

    usarReceptor: (r) =>
      set({
        receptor: {
          rut: formatearRut(r.rut),
          razonSocial: r.razonSocial,
          correo: r.correo ?? '',
          receptorId: r.id,
        },
      }),

    quitarReceptor: () => set({ receptor: { ...RECEPTOR_VACIO } }),

    agregarLinea: () =>
      set((s) => {
        if (s.lineas.length >= MAXIMO_LINEAS) return {};
        return {
          lineas: [...s.lineas, lineaVacia(s.siguienteId, s.tipoDte)],
          siguienteId: s.siguienteId + 1,
        };
      }),

    quitarLinea: (id) =>
      set((s) => {
        const lineas = s.lineas.filter((l) => l.id !== id);
        // Siempre queda una línea para escribir.
        if (lineas.length === 0) {
          return { lineas: [lineaVacia(s.siguienteId, s.tipoDte)], siguienteId: s.siguienteId + 1 };
        }
        return { lineas };
      }),

    moverLinea: (id, delta) =>
      set((s) => {
        const i = s.lineas.findIndex((l) => l.id === id);
        const j = i + delta;
        if (i < 0 || j < 0 || j >= s.lineas.length) return {};
        const lineas = [...s.lineas];
        [lineas[i], lineas[j]] = [lineas[j] as LineaFormulario, lineas[i] as LineaFormulario];
        return { lineas };
      }),

    cambiarLinea: (id, cambios) =>
      set((s) => ({
        lineas: s.lineas.map((l) => {
          if (l.id !== id) return l;
          const nueva = { ...l, ...cambios };
          // En la boleta exenta el control queda fijo.
          if (s.tipoDte === 41) nueva.exento = true;
          // Si cambia el nombre, deja de ser el producto del catálogo.
          if (cambios.nombre !== undefined && cambios.nombre !== l.nombre) nueva.productoId = null;
          return nueva;
        }),
      })),

    usarProducto: (id, p) =>
      set((s) => ({
        lineas: s.lineas.map((l) =>
          l.id !== id
            ? l
            : {
                ...l,
                productoId: p.id,
                nombre: p.nombre,
                precio: textoPesos(p.precio),
                unidad: p.unidad ?? '',
                exento: s.tipoDte === 41 ? true : p.exento,
                exentoPrevio: s.tipoDte === 41 ? p.exento : null,
                cantidad: l.cantidad.trim() === '' ? '1' : l.cantidad,
              },
        ),
      })),

    cambiarDescuento: (cambios) => set((s) => ({ descuento: { ...s.descuento, ...cambios } })),

    cargar: (borrador, borradorId) => set(desdeBorrador(borrador, borradorId, get().incierta)),

    fijarBorradorId: (borradorId) => set({ borradorId }),

    marcarIncierta: (incierta) => set({ incierta }),

    reiniciar: () => {
      const s = get();
      set(datosVacios(s.ambiente, s.tipoDte));
    },

    reemplazar: (datos) => set(datos),
  }));
}

// --- Persistencia en sessionStorage ------------------------------------------------------

/** Lo que usamos de `Storage` (para poder probar con un doble). */
export interface AlmacenSimple {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
  removeItem(clave: string): void;
}

const VERSION = 1;

/** Clave del borrador sin guardar de una empresa de una organización. */
export function claveSesion(organizacionId: string, empresaId: string): string {
  return `boleteame:emision:${organizacionId}:${empresaId}`;
}

/** `sessionStorage`, o `null` si no existe o el navegador no deja usarlo. */
export function almacenSesion(): AlmacenSimple | null {
  try {
    if (typeof window === 'undefined') return null;
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

const esquemaGuardado = z.object({
  v: z.literal(VERSION),
  datos: z.object({
    tipoDte: z.union([z.literal(39), z.literal(41)]),
    ambiente: z.enum(['certificacion', 'produccion']),
    receptor: z.object({
      rut: z.string(),
      razonSocial: z.string(),
      correo: z.string(),
      receptorId: z.string().nullable(),
    }),
    lineas: z
      .array(
        z.object({
          id: z.string(),
          productoId: z.string().nullable(),
          nombre: z.string(),
          cantidad: z.string(),
          precio: z.string(),
          exento: z.boolean(),
          unidad: z.string(),
          exentoPrevio: z.boolean().nullable(),
        }),
      )
      .min(1)
      .max(MAXIMO_LINEAS),
    descuento: z.object({ tipo: z.enum(['monto', 'porcentaje']), valor: z.string() }),
    borradorId: z.string().nullable(),
    incierta: z
      .object({
        ambiente: z.enum(['certificacion', 'produccion']),
        documentoId: z.string().nullable(),
        folio: z.number().nullable(),
        trackId: z.string().nullable(),
        en: z.string(),
      })
      .nullable(),
    siguienteId: z.number().int().positive(),
  }),
});

/** Lo guardado en la sesión, o `null` si no hay, no se puede leer o no tiene la forma. */
export function leerGuardado(almacen: AlmacenSimple | null, clave: string): DatosEmision | null {
  if (!almacen) return null;
  try {
    const crudo = almacen.getItem(clave);
    if (!crudo) return null;
    const r = esquemaGuardado.safeParse(JSON.parse(crudo));
    return r.success ? r.data.datos : null;
  } catch {
    return null;
  }
}

export function guardarEnSesion(
  almacen: AlmacenSimple | null,
  clave: string,
  datos: DatosEmision,
): void {
  if (!almacen) return;
  try {
    almacen.setItem(clave, JSON.stringify({ v: VERSION, datos }));
  } catch {
    // Cuota llena o almacenamiento bloqueado: el formulario sigue funcionando.
  }
}

export function borrarDeSesion(almacen: AlmacenSimple | null, clave: string): void {
  if (!almacen) return;
  try {
    almacen.removeItem(clave);
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }
}

/** Guarda cada cambio del store en la sesión. Devuelve la función para dejar de hacerlo. */
export function persistir(store: StoreEmision, almacen: AlmacenSimple | null, clave: string) {
  if (!almacen) return () => {};
  return store.subscribe((s) => guardarEnSesion(almacen, clave, soloDatos(s)));
}

/**
 * Con qué datos parte el formulario al montarse en el navegador:
 *   - con `?borrador=<id>`: lo guardado en la sesión si es ese mismo borrador (cambios sin
 *     guardar), si no el borrador del servidor;
 *   - sin él: lo guardado en la sesión; si su `borradorId` ya no está entre los borradores
 *     de la empresa (se borró o se emitió), sigue como borrador nuevo;
 *   - si no hay nada: el formulario vacío.
 * La emisión por verificar (`incierta`) de la sesión se conserva siempre.
 */
export function datosIniciales(opciones: {
  guardado: DatosEmision | null;
  servidor: { id: string; datos: Borrador } | null;
  borradoresIds: readonly string[];
  ambiente: AmbienteSii;
}): DatosEmision {
  const { guardado, servidor, borradoresIds, ambiente } = opciones;
  const incierta = guardado?.incierta ?? null;
  if (servidor) {
    if (guardado && guardado.borradorId === servidor.id) return guardado;
    return desdeBorrador(servidor.datos, servidor.id, incierta);
  }
  if (guardado) {
    if (guardado.borradorId && !borradoresIds.includes(guardado.borradorId)) {
      return { ...guardado, borradorId: null };
    }
    return guardado;
  }
  return datosVacios(ambiente);
}
