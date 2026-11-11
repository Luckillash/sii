// Golden tests de SetPruebasParser::parsear(). Ver
// paridad/php/operaciones/set-pruebas.php.
//
// El PHP guarda cada número con su valor, su `(string)` y su tipo (int/float).
// En JS no hay esa distinción: se exige el mismo valor y el mismo texto, que es
// lo que llega al XML de la boleta (QtyItem, PrcItem). El tipo PHP no se compara.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type CasoSetPruebas, parsearSetPruebas } from '../../src/certificacion/set-pruebas.ts';
import { esUtf8Valido } from '../../src/comun/codificacion.ts';
import { ErrorValidacion } from '../../src/comun/errores.ts';
import { casos, esperado, RAIZ_PARIDAD } from '../soporte/paridad.ts';

interface EntradaSetPruebas {
  /** Ruta relativa a la raíz de certificacion-node. */
  archivo?: string;
  texto?: string;
  base64?: string;
  tipoDte?: string;
}

interface DetallePhp {
  nombre: string;
  cantidad: number;
  cantidadTexto: string;
  cantidadTipo: 'int' | 'float';
  precio: number;
  precioTexto: string;
  precioTipo: 'int' | 'float';
  exento?: boolean;
  unidad?: string;
}

type SalidaPhp =
  | {
      codificacion: 'UTF-8' | 'ISO-8859-1';
      casos: { tipo: string; detalles: DetallePhp[]; referencia: CasoSetPruebas['referencia'] }[];
    }
  | { error: { clase: string; mensaje: string } };

const lista = casos<EntradaSetPruebas>('setPruebas');

/**
 * Divergencias intencionales (decisiones del usuario, 2026-11-06): en estos
 * casos el PHP devuelve casos (perdiendo uno o leyendo mal un número, sin
 * avisar) y Node lanza ErrorValidacion. El esperado sigue siendo la salida del
 * PHP, sin cambios; se exige que no sea un error y que Node lance este mensaje
 * (el primer problema del archivo).
 */
const DIVERGENCIAS: Readonly<Record<string, string>> = {
  // CASO-2 trae "=====   " (blancos tras los "="): el PHP pierde el caso.
  'set-pruebas-bloques': 'CASO-2: no se pudo leer el encabezado del caso.',
  // El PHP lee "1.000,50" como 1.
  'set-pruebas-numeros': 'CASO-1, ítem "Vino": el precio "1.000,50" no es un número válido.',
};

function bytesEntrada(entrada: EntradaSetPruebas): Buffer {
  if (entrada.archivo !== undefined) {
    if (entrada.archivo.includes('..')) throw new Error(`Archivo desconocido: ${entrada.archivo}`);
    return readFileSync(resolve(RAIZ_PARIDAD, '..', entrada.archivo));
  }
  if (entrada.base64 !== undefined) return Buffer.from(entrada.base64, 'base64');
  if (entrada.texto !== undefined) return Buffer.from(entrada.texto, 'utf8');
  throw new Error('La entrada no trae archivo, texto ni base64');
}

/** El resultado de Node con la forma de la salida PHP. */
function comoPhp(casosNode: CasoSetPruebas[], codificacion: string) {
  return {
    codificacion,
    casos: casosNode.map((caso) => ({
      tipo: caso.tipo,
      detalles: caso.detalles.map((d) => ({
        nombre: d.nombre,
        cantidad: d.cantidad,
        cantidadTexto: String(d.cantidad),
        precio: d.precio,
        precioTexto: String(d.precio),
        ...(d.exento !== undefined ? { exento: d.exento } : {}),
        ...(d.unidad !== undefined ? { unidad: d.unidad } : {}),
      })),
      referencia: caso.referencia,
    })),
  };
}

function sinTipos(salida: Extract<SalidaPhp, { casos: unknown }>) {
  return {
    ...salida,
    casos: salida.casos.map((caso) => ({
      ...caso,
      detalles: caso.detalles.map(({ cantidadTipo, precioTipo, ...resto }) => resto),
    })),
  };
}

describe('paridad: SetPruebasParser::parsear', () => {
  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  it('cada divergencia nombra un caso existente', () => {
    const nombres = lista.map((c) => c.nombre);
    for (const nombre of Object.keys(DIVERGENCIAS)) expect(nombres).toContain(nombre);
  });

  describe.each(lista)('$nombre', (caso) => {
    const { bytes, meta } = esperado(caso.nombre);
    const salida = JSON.parse(bytes.toString('utf8')) as SalidaPhp;
    const entrada = bytesEntrada(caso.entrada);
    const tipo = caso.entrada.tipoDte;

    it('el esperado corresponde a su meta', () => {
      expect(bytes.length).toBe(meta.bytes);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
    });

    const divergencia = DIVERGENCIAS[caso.nombre];
    if (divergencia !== undefined) {
      it('divergencia intencional: el PHP entrega casos y Node lanza ErrorValidacion', () => {
        expect('casos' in salida).toBe(true);
        expect(() => parsearSetPruebas(entrada, tipo)).toThrow(ErrorValidacion);
        expect(() => parsearSetPruebas(entrada, tipo)).toThrow(divergencia);
      });
      return;
    }

    if ('error' in salida) {
      it('Node lanza el mismo error que el PHP', () => {
        // El PHP agrega la ruta del archivo; Node no la recibe.
        const mensaje = salida.error.mensaje.replace(/: <archivo>$/, '.');
        expect(() => parsearSetPruebas(entrada, tipo)).toThrow(ErrorValidacion);
        expect(() => parsearSetPruebas(entrada, tipo)).toThrow(mensaje);
        try {
          parsearSetPruebas(entrada, tipo);
        } catch (error) {
          expect((error as Error).message).toBe(mensaje);
        }
      });
      return;
    }

    it('Node entrega los mismos casos que el PHP (valores y texto de cada número)', () => {
      const codificacion = esUtf8Valido(entrada) ? 'UTF-8' : 'ISO-8859-1';
      expect(comoPhp(parsearSetPruebas(entrada, tipo), codificacion)).toStrictEqual(
        sinTipos(salida),
      );
    });

    it('un float del PHP con parte entera exacta se escribe sin decimales', () => {
      for (const c of salida.casos) {
        for (const d of c.detalles) {
          if (Number.isInteger(d.cantidad)) expect(d.cantidadTexto).toBe(String(d.cantidad));
          if (Number.isInteger(d.precio)) expect(d.precioTexto).toBe(String(d.precio));
        }
      }
    });

    if (esUtf8Valido(entrada)) {
      it('recibir el contenido como string da lo mismo que como bytes', () => {
        expect(parsearSetPruebas(entrada.toString('utf8'), tipo)).toStrictEqual(
          parsearSetPruebas(entrada, tipo),
        );
      });
    }
  });
});
