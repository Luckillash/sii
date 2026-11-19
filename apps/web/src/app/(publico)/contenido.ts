import type { DocumentoFila } from '@/components/boleteame';
import { CABECERA_IDEMPOTENCIA, type DocumentoApi, URL_API } from '@/lib/api-publica';
import { type NumeroPaso, PASOS } from '@/lib/certificacion';
import { calcularTotales } from '@/lib/emision';

// Contenido de la landing (PLAN-SAAS Fase 12) que conviene probar: los datos ficticios
// del hero, los pasos de la certificación (los mismos del asistente) y el ejemplo de la
// API (calculado con las mismas cuentas que la emisión). Puro.

// --- Hero: boletas ficticias ------------------------------------------------------

/** Boletas 39 y 41 de ejemplo, con montos brutos y receptores ficticios. */
export const DOCUMENTOS_EJEMPLO: DocumentoFila[] = [
  {
    id: 'ejemplo-1',
    tipo: 39,
    folio: 1245,
    receptor: 'Cliente General',
    rut: '66666666-6',
    fecha: '19-11-2026',
    total: 12990,
    estado: 'enviado',
  },
  {
    id: 'ejemplo-2',
    tipo: 39,
    folio: 1244,
    receptor: 'Comercial Los Aromos SpA',
    rut: '76354771-K',
    fecha: '18-11-2026',
    total: 45990,
    estado: 'aceptado',
  },
  {
    id: 'ejemplo-3',
    tipo: 41,
    folio: 318,
    receptor: 'Centro de Estudios El Alerce Ltda.',
    rut: '76218455-9',
    fecha: '18-11-2026',
    total: 35000,
    estado: 'aceptado',
  },
];

/** CAF de boletas 39 del ejemplo: 755 folios disponibles de 1.000. */
export const FOLIOS_EJEMPLO = { codigo: 39, desde: 1001, hasta: 2000, siguiente: 1246 } as const;

// --- Certificación ----------------------------------------------------------------

/**
 * Qué pasa en cada paso, en palabras de la landing. Los títulos y la cantidad salen de
 * `PASOS` (lo mismo que muestra el asistente de `/[org]/certificacion`).
 */
const DESCRIPCION_PASO_PUBLICA: Readonly<Record<NumeroPaso, string>> = {
  1: 'Completas los datos de la empresa y del software, y Boletéame postula a la empresa a boleta electrónica en el SII.',
  2: 'El SII prepara un set de casos de prueba para tu empresa y Boletéame lo descarga.',
  3: 'Pides los folios de certificación y Boletéame emite, firma y envía al SII las boletas del set.',
  4: 'El SII revisa el set aceptado y deja a la empresa lista para declarar.',
  5: 'Firmas la declaración de cumplimiento de requisitos y la empresa queda autorizada para emitir en producción.',
};

export const PASOS_PUBLICOS = PASOS.map((p) => ({
  numero: p.numero,
  titulo: p.titulo,
  descripcion: DESCRIPCION_PASO_PUBLICA[p.numero],
}));

// --- API --------------------------------------------------------------------------

export const CLAVE_EJEMPLO = 'sk_test_…';
export const IDEMPOTENCIA_EJEMPLO = 'venta-000123';

/** Cuerpo de `POST /documentos`: una boleta 39 con precio bruto (IVA incluido). */
export const CUERPO_EJEMPLO = {
  tipo_dte: 39,
  lineas: [{ nombre: 'Café americano', cantidad: 2, precio: 2490 }],
} as const;

const totales = calcularTotales({
  lineas: CUERPO_EJEMPLO.lineas.map((l) => ({ ...l, exento: false })),
});

/** Extracto de la respuesta 201 (`DocumentoApi`) para esa boleta. */
export const RESPUESTA_EJEMPLO = {
  objeto: 'documento',
  id: '6f1c2a9e-3b7d-4c51-9a08-2e4f6b8d1c35',
  ambiente: 'certificacion',
  tipo_dte: 39,
  folio: 1246,
  estado: 'enviado',
  totales: {
    neto: totales.neto,
    exento: totales.exento,
    iva: totales.iva,
    total: totales.total,
    descuento: totales.descuentoAplicado,
  },
  envio: { track_id: '34120365', estado_sii: 'REC' },
} as const satisfies Omit<Partial<DocumentoApi>, 'envio'> & {
  envio: Partial<NonNullable<DocumentoApi['envio']>>;
};

export const URL_EMISION = `${URL_API}/documentos`;

/** Cabeceras de la petición de ejemplo, en el orden en que se muestran. */
export const CABECERAS_EJEMPLO: readonly string[] = [
  `Authorization: Bearer ${CLAVE_EJEMPLO}`,
  'Content-Type: application/json',
  `${CABECERA_IDEMPOTENCIA}: ${IDEMPOTENCIA_EJEMPLO}`,
];

type Json = string | number | boolean | null | readonly Json[] | { readonly [k: string]: Json };

const esCompuesto = (v: Json): v is readonly Json[] | { readonly [k: string]: Json } =>
  typeof v === 'object' && v !== null;

/**
 * JSON con sangría de 2 espacios, pero con los objetos y listas sin anidados en una sola
 * línea (`{ "neto": 4185, ... }`), como en la documentación.
 */
export function jsonCompacto(valor: Json, nivel = 0): string {
  if (!esCompuesto(valor)) return JSON.stringify(valor);
  const lista = Array.isArray(valor);
  const entradas: [string | null, Json][] = lista
    ? (valor as readonly Json[]).map((v) => [null, v])
    : Object.entries(valor);
  const [abre, cierra] = lista ? ['[', ']'] : ['{', '}'];
  if (entradas.length === 0) return `${abre}${cierra}`;
  const item = ([k, v]: [string | null, Json], n: number) =>
    `${k === null ? '' : `${JSON.stringify(k)}: `}${jsonCompacto(v, n)}`;
  if (nivel > 0 && entradas.every(([, v]) => !esCompuesto(v))) {
    return `${abre} ${entradas.map((e) => item(e, nivel + 1)).join(', ')} ${cierra}`;
  }
  const sangria = '  '.repeat(nivel + 1);
  const lineas = entradas.map((e) => `${sangria}${item(e, nivel + 1)}`);
  return `${abre}\n${lineas.join(',\n')}\n${'  '.repeat(nivel)}${cierra}`;
}
