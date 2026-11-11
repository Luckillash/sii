// Archivo JSON con la boleta que emite `sii produccion emitir --boleta <archivo.json>`.
//
// Se valida entero con zod antes de armar nada: campos desconocidos (p. ej. un
// `precios` mal escrito) son error, para no emitir un documento real distinto
// del que se quiso.

import type { DescuentoGlobal, DetalleBoleta, ReceptorBoleta } from '@winex/certificacion';
import { Rut } from '@winex/certificacion';
import { z } from 'zod';
import { ErrorConfig } from '../../errores.ts';

/** Receptor por defecto de las boletas (como el bin del PHP). */
export const RECEPTOR_GENERICO: ReceptorBoleta = Object.freeze({
  rut: '66666666-6',
  razonSocial: 'Cliente General',
});

/** Formato del archivo, para la ayuda del comando. */
export const FORMATO_BOLETA_JSON = [
  'Formato de --boleta (JSON; los campos desconocidos son error):',
  '  {',
  '    "tipoDte": 39,                     39 boleta afecta (por defecto) o 41 exenta',
  '    "receptor": {                      opcional; por defecto 66666666-6 "Cliente General"',
  '      "rut": "12345678-5", "razonSocial": "Juan Pérez"',
  '    },',
  '    "detalles": [                      al menos un ítem',
  '      { "nombre": "Producto", "cantidad": 1, "precio": 1190 },',
  '      { "nombre": "Servicio exento", "cantidad": 2, "precio": 500,',
  '        "exento": true, "unidad": "Hr" }',
  '    ],',
  '    "descuento": { "tipo": "porcentaje", "valor": 10 }   opcional',
  '  }',
  '  - precio: unitario BRUTO (IVA incluido), en pesos.',
  '  - exento: el ítem va en <MntExe> y no recibe descuento.',
  '  - descuento: tipo "monto" (pesos, por defecto) o "porcentaje"; solo sobre lo afecto.',
  '  - El folio NO va en el JSON: se pasa con --folio.',
].join('\n');

export interface BoletaJson {
  readonly tipoDte: 39 | 41;
  readonly receptor: ReceptorBoleta;
  readonly detalles: DetalleBoleta[];
  readonly descuento?: DescuentoGlobal;
}

/** Mensaje en español según si el campo falta o tiene otro tipo. */
function tipo(esperado: string) {
  return {
    error: (iss: { input?: unknown }) =>
      iss.input === undefined ? 'falta' : `debe ser ${esperado}`,
  };
}

const textoNoVacio = z
  .string(tipo('un texto'))
  .refine((v) => v.trim() !== '', { error: 'no puede estar vacío' });

const esquema = z.strictObject(
  {
    tipoDte: z
      .union([z.literal(39), z.literal(41)], { error: 'debe ser 39 o 41 (número)' })
      .optional(),
    receptor: z
      .strictObject(
        {
          rut: z
            .string(tipo('un texto'))
            .refine((v) => Rut.esValido(v), { error: 'no es un RUT válido' })
            .transform((v) => Rut.de(v).toString()),
          razonSocial: textoNoVacio,
        },
        tipo('un objeto'),
      )
      .optional(),
    detalles: z
      .array(
        z.strictObject(
          {
            nombre: textoNoVacio,
            cantidad: z.number(tipo('un número')).positive({ error: 'debe ser mayor que 0' }),
            precio: z.number(tipo('un número')).nonnegative({ error: 'no puede ser negativo' }),
            exento: z.boolean(tipo('true o false')).optional(),
            unidad: textoNoVacio.optional(),
          },
          tipo('un objeto'),
        ),
        tipo('una lista'),
      )
      .min(1, { error: 'debe tener al menos un ítem' }),
    descuento: z
      .strictObject(
        {
          tipo: z
            .enum(['monto', 'porcentaje'], { error: 'debe ser "monto" o "porcentaje"' })
            .optional(),
          valor: z.number(tipo('un número')).nonnegative({ error: 'no puede ser negativo' }),
          glosa: z.string(tipo('un texto')).optional(),
        },
        tipo('un objeto'),
      )
      .optional(),
  },
  tipo('un objeto'),
);

/** Ruta legible de un campo: `detalles[0].precio`. */
function ruta(path: readonly PropertyKey[]): string {
  let salida = '';
  for (const parte of path) {
    salida +=
      typeof parte === 'number' ? `[${parte}]` : `${salida === '' ? '' : '.'}${String(parte)}`;
  }
  return salida === '' ? '(raíz)' : salida;
}

/**
 * Lee y valida el JSON de la boleta.
 *
 * @param origen ruta del archivo, solo para los mensajes.
 * @throws {ErrorConfig} si no es JSON o no cumple el formato (con todos los campos que fallan).
 */
export function leerBoletaJson(bytes: Buffer, origen: string): BoletaJson {
  let datos: unknown;
  try {
    datos = JSON.parse(bytes.toString('utf8').replace(/^﻿/, ''));
  } catch {
    throw new ErrorConfig(`El archivo de --boleta no es un JSON válido: ${origen}`);
  }
  const r = esquema.safeParse(datos);
  if (!r.success) {
    const problemas = r.error.issues.map((i) => {
      if (i.code === 'unrecognized_keys') {
        return `${ruta(i.path)}: campo desconocido ${i.keys.map((k) => `"${k}"`).join(', ')}`;
      }
      return `${ruta(i.path)}: ${i.message}`;
    });
    throw new ErrorConfig(
      `El archivo de --boleta no tiene el formato esperado (${origen}):\n  - ${problemas.join('\n  - ')}\n` +
        'Ver el formato en `sii produccion emitir --ayuda`.',
    );
  }
  const b = r.data;
  return {
    tipoDte: b.tipoDte ?? 39,
    receptor: b.receptor ?? { ...RECEPTOR_GENERICO },
    detalles: b.detalles.map((d) => ({
      nombre: d.nombre,
      cantidad: d.cantidad,
      precio: d.precio,
      ...(d.exento === undefined ? {} : { exento: d.exento }),
      ...(d.unidad === undefined ? {} : { unidad: d.unidad }),
    })),
    ...(b.descuento === undefined
      ? {}
      : {
          descuento: {
            valor: b.descuento.valor,
            ...(b.descuento.tipo === undefined ? {} : { tipo: b.descuento.tipo }),
            ...(b.descuento.glosa === undefined ? {} : { glosa: b.descuento.glosa }),
          },
        }),
  };
}
