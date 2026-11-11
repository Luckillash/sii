// Golden tests de GWT-RPC (GwtRpc / LectorGwt). Ver paridad/php/operaciones/gwt.php
// (la mini-DSL de los casos `gwt-*`). Datos ficticios; los esquemas son los de
// DeclaracionBoletas::ESQUEMAS.
//
// - `gwtLlamada`: el cuerpo de GwtRpc::llamada() debe ser idéntico byte a byte (es
//   lo que se envía al SII).
// - `gwtLeer`: lo que entrega el lector (objetos con los long como texto decimal)
//   debe ser igual; los mensajes de error, iguales salvo tildes.
//
// Los casos de DIVERGENCIAS son decisiones del port (PLAN §4: números sin truncar
// en silencio; tokens del tipo equivocado): el esperado sigue siendo la salida del
// PHP y Node lanza ErrorPostulacion.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ErrorPostulacion } from '../../src/comun/errores.ts';
import {
  type EsquemasGwt,
  GwtRpc,
  type ObjetoGwt,
  type ParametroGwt,
} from '../../src/postulacion/gwt-rpc.ts';
import { type CasoParidad, casos, esperado, exigirIdentico } from '../soporte/paridad.ts';

type Paso = readonly [string, unknown?];

interface EntradaRespuesta {
  respuesta?: string;
  respuestaBase64?: string;
  esquemas?: EsquemasGwt;
}

interface EntradaLlamada {
  base: string;
  policy: string;
  servicio: string;
  metodo: string;
  parametros: { tipo: string; pasos: Paso[] }[];
}

interface EntradaLeer extends EntradaRespuesta {
  lecturas: ('objeto' | 'string' | 'esNulo')[];
}

interface SalidaLeer {
  lecturas: Record<string, unknown>[];
  error: { clase: string; mensaje: string } | null;
}

/** Divergencias intencionales: qué hace Node y qué marca dejó el PHP (si la deja). */
const DIVERGENCIAS: Record<string, { error: RegExp; marca?: string }> = {
  // El PHP satura 2^63 a 2^63-1 y lo envía.
  'gwt-llamada-long-fuera-de-rango': { error: /no cabe en 64 bits/, marca: 'longsSaturados' },
  // El PHP trunca 1.5 → 1.
  'gwt-leer-div-integer-decimal': {
    error: /mal formada \(entero: 1\.5 no es un número entero\)/,
    marca: 'numerosInexactos',
  },
  // El PHP lo conserva (int de 64 bits); en JS no es exacto como number.
  'gwt-leer-div-integer-grande': {
    error: /mal formada \(entero: 9007199254740993 fuera de rango\)/,
  },
  // El PHP satura a 2^63-1.
  'gwt-leer-div-long-numero-saturado': {
    error: /mal formada \(long: 99999999999999999999 fuera de rango\)/,
    marca: 'numerosInexactos',
  },
  // El PHP toma "=" como 0 (strpos → false).
  'gwt-leer-div-long-base64-invalido': { error: /mal formada \(long\)/ },
  // El PHP hace (int) "123".
  'gwt-leer-div-long-texto': { error: /mal formada \(long\)/ },
  // El PHP devuelve el objeto a medias (solo @tipo), que valor() no puede reescribir.
  'gwt-leer-div-referencia-circular': { error: /mal formada \(referencia circular\)/ },
  // El PHP trunca 1.9 → 1.
  'gwt-leer-div-string-decimal': {
    error: /mal formada \(string: 1\.9 no es un número entero\)/,
    marca: 'numerosInexactos',
  },
};

function sinTildes(texto: string): string {
  return texto.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function verificarMeta(caso: CasoParidad<unknown>): {
  bytes: Buffer;
  marcas: Record<string, string>;
} {
  const { bytes, meta } = esperado(caso.nombre);
  expect(bytes.length).toBe(meta.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(meta.sha256);
  return { bytes, marcas: meta.marcas };
}

function respuesta(e: EntradaRespuesta): Buffer {
  if (e.respuestaBase64 !== undefined) return Buffer.from(e.respuestaBase64, 'base64');
  if (e.respuesta !== undefined) return Buffer.from(e.respuesta, 'utf8');
  throw new Error('El caso no trae respuesta ni respuestaBase64');
}

/** Objeto de la DSL (long como texto decimal) → ObjetoGwt. Lo que no es objeto pasa tal cual. */
function desdeJson(o: unknown): unknown {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return o;
  const r: Record<string, unknown> = { ...(o as Record<string, unknown>) };
  if (r['@tipo'] === GwtRpc.LONG && typeof r.valor === 'string') r.valor = BigInt(r.valor);
  if (Array.isArray(r.elementos)) r.elementos = r.elementos.map(desdeJson);
  if (Array.isArray(r.campos)) {
    r.campos = (r.campos as [string, unknown][]).map(([clase, v]) => [
      clase,
      clase === 'S' || clase === 'B' ? v : desdeJson(v),
    ]);
  }
  return r;
}

/** ObjetoGwt → JSON como el de la operación PHP (bigint → texto decimal). */
function aJson(o: unknown): unknown {
  return JSON.parse(JSON.stringify(o, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)));
}

function aplicar(w: GwtRpc, [op, arg]: Paso): void {
  switch (op) {
    case 'string':
      w.string(arg as string | null);
      break;
    case 'int':
      w.int(arg as number);
      break;
    case 'nulo':
      w.nulo();
      break;
    case 'integer':
      w.integer(arg as number | null);
      break;
    case 'long':
      w.long(arg === null ? null : BigInt(arg as string));
      break;
    case 'tipo':
      w.tipo(arg as string);
      break;
    case 'valor':
      w.valor(desdeJson(arg) as ObjetoGwt | null);
      break;
    case 'valorLeido': {
      const e = arg as EntradaRespuesta;
      w.valor(GwtRpc.leer(respuesta(e), e.esquemas ?? {}).objeto());
      break;
    }
    default:
      throw new Error(`Paso GWT desconocido: ${op}`);
  }
}

function llamada(e: EntradaLlamada): string {
  const params: ParametroGwt[] = e.parametros.map((p) => [
    p.tipo,
    (w: GwtRpc) => {
      for (const paso of p.pasos) aplicar(w, paso);
    },
  ]);
  return GwtRpc.llamada(e.base, e.policy, e.servicio, e.metodo, params);
}

function leer(e: EntradaLeer, entrada: string | Buffer): SalidaLeer {
  const salida: SalidaLeer = { lecturas: [], error: null };
  try {
    const lector = GwtRpc.leer(entrada, e.esquemas ?? {});
    for (const lectura of e.lecturas) {
      if (lectura === 'objeto') salida.lecturas.push({ objeto: aJson(lector.objeto()) });
      else if (lectura === 'string') salida.lecturas.push({ string: lector.string() });
      else salida.lecturas.push({ esNulo: lector.esNulo() });
    }
  } catch (error) {
    if (!(error instanceof ErrorPostulacion)) throw error;
    salida.error = { clase: 'PostulacionException', mensaje: error.message };
  }
  return salida;
}

function exigirLanza(fn: () => unknown): ErrorPostulacion {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorPostulacion);
    return error as ErrorPostulacion;
  }
  throw new Error('se esperaba ErrorPostulacion');
}

describe('paridad: casos gwt-*', () => {
  const todos = [...casos('gwtLlamada'), ...casos('gwtLeer')];

  it('cada caso de divergencia existe y todo caso "div" está declarado', () => {
    const nombres = todos.map((c) => c.nombre);
    for (const nombre of Object.keys(DIVERGENCIAS)) expect(nombres).toContain(nombre);
    for (const nombre of nombres.filter((n) => n.includes('-div-'))) {
      expect(DIVERGENCIAS).toHaveProperty([nombre]);
    }
  });

  it.each(todos.filter((c) => !(c.nombre in DIVERGENCIAS)))(
    '$nombre: el PHP no truncó ni saturó nada (sin marcas)',
    (caso) => {
      expect(verificarMeta(caso).marcas).toEqual({});
    },
  );
});

describe('paridad: GwtRpc::llamada', () => {
  const lista = casos<EntradaLlamada>('gwtLlamada');

  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    const divergencia = DIVERGENCIAS[caso.nombre];

    if (divergencia !== undefined) {
      it('divergencia: el PHP envía un valor alterado y Node lanza', () => {
        const { bytes, marcas } = verificarMeta(caso);
        expect(bytes.toString('utf8').startsWith('#error ')).toBe(false);
        if (divergencia.marca !== undefined) expect(marcas).toHaveProperty([divergencia.marca]);
        expect(exigirLanza(() => llamada(caso.entrada)).message).toMatch(divergencia.error);
      });
      return;
    }

    it('Node produce el mismo cuerpo que el PHP', () => {
      const { bytes } = verificarMeta(caso);
      const texto = bytes.toString('utf8');
      if (texto.startsWith('#error ')) {
        const error = exigirLanza(() => llamada(caso.entrada));
        expect(sinTildes(error.message)).toBe(texto.slice('#error '.length));
        return;
      }
      exigirIdentico(Buffer.from(llamada(caso.entrada), 'utf8'), bytes, caso.nombre);
    });
  });
});

describe('paridad: GwtRpc::leer y LectorGwt', () => {
  const lista = casos<EntradaLeer>('gwtLeer');

  it('hay casos de paridad', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  describe.each(lista)('$nombre', (caso) => {
    const divergencia = DIVERGENCIAS[caso.nombre];

    if (divergencia !== undefined) {
      it('divergencia: el PHP entrega un valor alterado y Node lanza', () => {
        const { bytes, marcas } = verificarMeta(caso);
        const php = JSON.parse(bytes.toString('utf8')) as SalidaLeer;
        expect(php.error).toBeNull();
        if (divergencia.marca !== undefined) expect(marcas).toHaveProperty([divergencia.marca]);
        const node = leer(caso.entrada, respuesta(caso.entrada));
        expect(node.error?.mensaje).toMatch(divergencia.error);
      });
      return;
    }

    it('Node lee lo mismo que el PHP (bytes y texto)', () => {
      const { bytes } = verificarMeta(caso);
      const php = JSON.parse(bytes.toString('utf8')) as SalidaLeer;

      const bytesRespuesta = respuesta(caso.entrada);
      for (const entrada of [bytesRespuesta, bytesRespuesta.toString('utf8')]) {
        const node = leer(caso.entrada, entrada);
        expect(node.lecturas).toEqual(php.lecturas);
        if (php.error === null) {
          expect(node.error).toBeNull();
        } else {
          expect(node.error?.clase).toBe(php.error.clase);
          expect(sinTildes(node.error?.mensaje ?? '').trim()).toBe(php.error.mensaje.trim());
        }
      }
    });
  });
});
