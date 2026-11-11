// Caché de tokens del SII, inyectable (PLAN §4 y pend. 1.4).
//
// Reemplaza el caché global en archivo de winex/certificacion v1.9.1
// (SiiBoletaProduccion::getToken, un solo archivo para todas las empresas y
// ambientes), © 2026 Meniaz (William Menares), Apache-2.0. Modificado: port a
// TypeScript con clave por canal, ambiente, empresa y certificado, y sin
// archivos implícitos (el PHP escribía en data/output/ por su cuenta).
//
// El token queda atado a la identidad que firmó la semilla: por eso la clave
// incluye la huella del certificado, además de la empresa y el ambiente.
//
// Regla para todas las implementaciones: el token es una credencial. No se
// escribe en logs ni en mensajes de error.

import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { open, readFile, rename, rm } from 'node:fs/promises';
import type { Ambiente } from './ambiente.ts';
import { ErrorCertificado, SiiError } from './errores.ts';

/** A quién pertenece un token. */
export interface ClaveToken {
  /** `rest`: API REST de boleta; `soap`: DTEWS (maullin / palena). */
  readonly canal: 'rest' | 'soap';
  readonly ambiente: Ambiente;
  /** RUT de la empresa, con guion y DV en mayúscula (`76543210-K`). */
  readonly rutEmpresa: string;
  /** sha256 en hex del certificado (DER) que firmó la semilla. Ver `huellaCertificado`. */
  readonly huellaCertificado: string;
}

export interface TokenGuardado {
  readonly token: string;
  /** Desde este instante el token ya no se usa (se pide uno nuevo). */
  readonly venceEn: Date;
}

/**
 * Dónde se guardan los tokens. Una app web lo implementa con su propio driver
 * (Redis, base de datos...). Las implementaciones no validan la vigencia: eso lo
 * hace el cliente con su reloj.
 */
export interface TokenStore {
  obtener(clave: ClaveToken): Promise<TokenGuardado | undefined>;
  guardar(clave: ClaveToken, guardado: TokenGuardado): Promise<void>;
  /** Olvida el token (p. ej. si el SII lo rechazó). */
  borrar(clave: ClaveToken): Promise<void>;
}

/**
 * Huella para `ClaveToken.huellaCertificado`: sha256 en hex (minúsculas) del DER
 * del primer certificado del PEM (la hoja, en `Certificado.certificado` o en
 * `Certificado.cadena`).
 *
 * @throws ErrorCertificado si el PEM no trae un certificado legible.
 */
export function huellaCertificado(certificadoPem: string): string {
  let der: Buffer;
  try {
    der = new X509Certificate(certificadoPem).raw;
  } catch (error) {
    throw new ErrorCertificado('No se pudo leer el certificado para calcular su huella.', {
      cause: error,
    });
  }
  return createHash('sha256').update(der).digest('hex');
}

/** Texto único por clave (los campos van en orden fijo y escapados por JSON). */
function textoClave(clave: ClaveToken): string {
  return JSON.stringify([clave.canal, clave.ambiente, clave.rutEmpresa, clave.huellaCertificado]);
}

/** Copia defensiva: quien recibe el `Date` podría modificarlo. */
function copia(guardado: TokenGuardado): TokenGuardado {
  return { token: guardado.token, venceEn: new Date(guardado.venceEn.getTime()) };
}

function exigirGuardable(guardado: TokenGuardado): void {
  if (typeof guardado.token !== 'string' || guardado.token === '') {
    throw new TypeError('El token a guardar está vacío.');
  }
  if (!(guardado.venceEn instanceof Date) || Number.isNaN(guardado.venceEn.getTime())) {
    throw new TypeError('La fecha de vencimiento del token no es válida.');
  }
}

/**
 * Tokens en memoria del proceso. Sirve para un servidor de un solo proceso y
 * para los tests. Se pierde al reiniciar.
 */
export class TokenStoreMemoria implements TokenStore {
  readonly #tokens = new Map<string, TokenGuardado>();

  async obtener(clave: ClaveToken): Promise<TokenGuardado | undefined> {
    const guardado = this.#tokens.get(textoClave(clave));
    return guardado === undefined ? undefined : copia(guardado);
  }

  async guardar(clave: ClaveToken, guardado: TokenGuardado): Promise<void> {
    exigirGuardable(guardado);
    this.#tokens.set(textoClave(clave), copia(guardado));
  }

  async borrar(clave: ClaveToken): Promise<void> {
    this.#tokens.delete(textoClave(clave));
  }

  /** Cuántos tokens hay guardados (vigentes o no). */
  get tamano(): number {
    return this.#tokens.size;
  }
}

/** Una entrada del archivo JSON. */
interface EntradaArchivo {
  canal: ClaveToken['canal'];
  ambiente: Ambiente;
  rutEmpresa: string;
  huellaCertificado: string;
  token: string;
  /** ISO 8601 (UTC). */
  venceEn: string;
}

interface ContenidoArchivo {
  version: 1;
  tokens: EntradaArchivo[];
}

const VERSION_ARCHIVO = 1;

/**
 * Tokens en un archivo JSON, en la ruta que entrega quien llama (nada se escribe
 * en una ruta por defecto). Pensado para la CLI: los tokens sobreviven entre
 * ejecuciones, como el `token_cache_boleta_produccion.txt` del PHP, pero con una
 * entrada por clave.
 *
 * - Se escribe de forma atómica: un temporal en la misma carpeta, creado en
 *   exclusiva con permisos 0600, que luego reemplaza al archivo con `rename`. Un
 *   corte a mitad de camino deja el archivo anterior intacto. (En Windows los
 *   permisos POSIX no aplican: el archivo hereda los de la carpeta.)
 * - Un archivo que no existe, que no es JSON o que tiene otra forma se trata como
 *   vacío: es un caché, y el siguiente `guardar` lo reescribe. Las entradas mal
 *   formadas se descartan.
 * - Las operaciones de una misma instancia se ejecutan en fila (no se pierden
 *   escrituras concurrentes). Entre procesos distintos gana la última escritura:
 *   en el peor caso se pide un token de más.
 * - La carpeta tiene que existir. El archivo guarda tokens vigentes: protégelo
 *   como una credencial.
 */
export class TokenStoreArchivo implements TokenStore {
  readonly ruta: string;
  #cola: Promise<unknown> = Promise.resolve();

  constructor(ruta: string) {
    if (typeof ruta !== 'string' || ruta.trim() === '') {
      throw new TypeError('La ruta del archivo de tokens no puede estar vacía.');
    }
    this.ruta = ruta;
  }

  obtener(clave: ClaveToken): Promise<TokenGuardado | undefined> {
    return this.#enFila(async () => {
      const buscada = textoClave(clave);
      const entrada = (await this.#leer()).find((e) => textoClave(e) === buscada);
      return entrada === undefined
        ? undefined
        : { token: entrada.token, venceEn: new Date(entrada.venceEn) };
    });
  }

  async guardar(clave: ClaveToken, guardado: TokenGuardado): Promise<void> {
    exigirGuardable(guardado);
    const nueva: EntradaArchivo = {
      canal: clave.canal,
      ambiente: clave.ambiente,
      rutEmpresa: clave.rutEmpresa,
      huellaCertificado: clave.huellaCertificado,
      token: guardado.token,
      venceEn: guardado.venceEn.toISOString(),
    };
    return this.#enFila(async () => {
      const buscada = textoClave(clave);
      const resto = (await this.#leer()).filter((e) => textoClave(e) !== buscada);
      await this.#escribir([...resto, nueva]);
    });
  }

  borrar(clave: ClaveToken): Promise<void> {
    return this.#enFila(async () => {
      const entradas = await this.#leer();
      const buscada = textoClave(clave);
      const resto = entradas.filter((e) => textoClave(e) !== buscada);
      if (resto.length !== entradas.length) await this.#escribir(resto);
    });
  }

  /** Ejecuta `tarea` después de las anteriores, aunque alguna haya fallado. */
  #enFila<T>(tarea: () => Promise<T>): Promise<T> {
    const resultado = this.#cola.then(tarea, tarea);
    this.#cola = resultado.catch(() => {});
    return resultado;
  }

  async #leer(): Promise<EntradaArchivo[]> {
    let texto: string;
    try {
      texto = await readFile(this.ruta, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      // Sin la ruta en el mensaje (puede llevar el RUT); queda en `cause`.
      throw new SiiError('No se pudo leer el archivo de tokens.', { cause: error });
    }
    let datos: unknown;
    try {
      datos = JSON.parse(texto);
    } catch {
      return [];
    }
    if (
      datos === null ||
      typeof datos !== 'object' ||
      (datos as Partial<ContenidoArchivo>).version !== VERSION_ARCHIVO ||
      !Array.isArray((datos as Partial<ContenidoArchivo>).tokens)
    ) {
      return [];
    }
    return (datos as { tokens: unknown[] }).tokens.filter(esEntrada);
  }

  async #escribir(tokens: EntradaArchivo[]): Promise<void> {
    const contenido: ContenidoArchivo = { version: VERSION_ARCHIVO, tokens };
    const temporal = `${this.ruta}.${randomBytes(6).toString('hex')}.tmp`;
    try {
      // 'wx': falla si ya existe (nadie puede haberlo preparado de antes).
      const archivo = await open(temporal, 'wx', 0o600);
      try {
        await archivo.writeFile(`${JSON.stringify(contenido, null, 2)}\n`, 'utf8');
        await archivo.sync();
      } finally {
        await archivo.close();
      }
      await rename(temporal, this.ruta);
    } catch (error) {
      await rm(temporal, { force: true }).catch(() => {});
      throw new SiiError('No se pudo escribir el archivo de tokens.', { cause: error });
    }
  }
}

function esEntrada(valor: unknown): valor is EntradaArchivo {
  if (valor === null || typeof valor !== 'object') return false;
  const e = valor as Record<string, unknown>;
  return (
    (e.canal === 'rest' || e.canal === 'soap') &&
    (e.ambiente === 'certificacion' || e.ambiente === 'produccion') &&
    typeof e.rutEmpresa === 'string' &&
    typeof e.huellaCertificado === 'string' &&
    typeof e.token === 'string' &&
    e.token !== '' &&
    typeof e.venceEn === 'string' &&
    !Number.isNaN(new Date(e.venceEn).getTime())
  );
}
