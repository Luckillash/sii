import 'server-only';
import {
  type Ambiente,
  type CookieSii,
  type Reloj,
  relojSistema,
  SesionCaducaError,
  SesionSii,
} from '@winex/certificacion';
import { aBytea, cifrar, descifrar, desdeBytea } from '../cifrado';
import type { ClienteServicio } from '../supabase/service';
import type { TablesInsert } from '../supabase/tipos';

// Cookies de la sesión AUT2000 (`SesionSii`) guardadas en `sesiones_sii`, cifradas
// con AES-256-GCM y SII_TOKENS_KEY (PLAN-SAAS §4.4, Fase 4). El SII frena el
// re-login seguido (~5 ciclos, error 01.01.215.500.771.52): la sesión se reutiliza
// mientras sirva, como recomienda `SolicitudFolios.autenticar` de la librería.
//
// Las cookies son una credencial (con ellas se timbran folios sin el certificado):
// ningún mensaje de error ni log las incluye, ni tampoco el detalle de PostgREST.
//
// `sesiones_sii` no tiene `organizacion_id`: la clave es el certificado, que ya se
// leyó filtrando por organización en `credenciales.ts`. Por eso `claveSesion()` la
// arma desde un `CredencialesCertificado` y no desde un id suelto.

export class ErrorSesiones extends Error {
  override name = 'ErrorSesiones';
}

/** Fila de `sesiones_sii`. */
export interface ClaveSesion {
  readonly certificadoId: string;
  readonly ambiente: Ambiente;
}

/** Clave de la sesión del certificado ya cargado (y filtrado por organización). */
export function claveSesion(
  credenciales: { readonly certificadoId: string },
  ambiente: Ambiente,
): ClaveSesion {
  return { certificadoId: credenciales.certificadoId, ambiente };
}

/** Datos autenticados del cifrado: las cookies solo descifran en su propia fila. */
export function contextoSesion(clave: ClaveSesion): string {
  return JSON.stringify(['sesiones_sii', clave.certificadoId, clave.ambiente]);
}

function fallo(operacion: string, error: { code?: string }): ErrorSesiones {
  const codigo = error.code ? ` (código ${error.code})` : '';
  return new ErrorSesiones(`No se pudo ${operacion} la sesión del SII en Supabase${codigo}.`);
}

/** Lo que necesita `conSesionReutilizada`; `SesionesSupabase` lo implementa. */
export interface AlmacenSesiones {
  /** La sesión guardada, o `undefined` si no hay, venció o no descifra. */
  obtener(clave: ClaveSesion): Promise<SesionSii | undefined>;
  /**
   * Guarda (o reemplaza) las cookies. `expiraEn`: `Date` o `null` (sin vencimiento)
   * lo fijan; `undefined` conserva el de la fila (o `null` si la fila es nueva).
   */
  guardar(clave: ClaveSesion, sesion: SesionSii, expiraEn?: Date | null): Promise<void>;
  descartar(clave: ClaveSesion): Promise<void>;
}

export interface OpcionesSesiones {
  /** Reloj de `expira_en`, `ultimo_uso_en` y de la `SesionSii` (expiración de cookies). */
  readonly reloj?: Reloj;
}

export class SesionesSupabase implements AlmacenSesiones {
  readonly #cliente: ClienteServicio;
  readonly #llave: Buffer;
  readonly #reloj: Reloj;

  constructor(cliente: ClienteServicio, llave: Buffer, opciones: OpcionesSesiones = {}) {
    this.#cliente = cliente;
    this.#llave = llave;
    this.#reloj = opciones.reloj ?? relojSistema;
  }

  async obtener(clave: ClaveSesion): Promise<SesionSii | undefined> {
    const { data, error } = await this.#cliente
      .from('sesiones_sii')
      .select('cookies_cifradas, expira_en')
      .eq('certificado_id', clave.certificadoId)
      .eq('ambiente', clave.ambiente)
      .maybeSingle();
    if (error) throw fallo('leer', error);
    if (!data) return undefined;

    const ahora = this.#reloj.ahora();
    if (data.expira_en !== null) {
      const expira = new Date(data.expira_en);
      if (Number.isNaN(expira.getTime()) || expira.getTime() <= ahora.getTime()) return undefined;
    }

    let sesion: SesionSii;
    try {
      const texto = descifrar(
        desdeBytea(data.cookies_cifradas),
        this.#llave,
        contextoSesion(clave),
      );
      const cookies: unknown = JSON.parse(texto.toString('utf8'));
      if (!Array.isArray(cookies)) return undefined;
      sesion = SesionSii.desdeArreglo(cookies as Partial<CookieSii>[], { reloj: this.#reloj });
    } catch {
      // Llave rotada, fila alterada o copiada de otro certificado: es un caché, se
      // vuelve a autenticar.
      return undefined;
    }
    if (sesion.aArreglo().length === 0) return undefined;

    // Solo informativo (limpieza de sesiones viejas): si falla, la sesión sirve igual.
    try {
      await this.#cliente
        .from('sesiones_sii')
        .update({ ultimo_uso_en: ahora.toISOString() })
        .eq('certificado_id', clave.certificadoId)
        .eq('ambiente', clave.ambiente);
    } catch {
      // supabase-js no lanza por errores de la base; esto cubre una falla de red.
    }
    return sesion;
  }

  async guardar(clave: ClaveSesion, sesion: SesionSii, expiraEn?: Date | null): Promise<void> {
    const cookies = sesion.aArreglo();
    if (cookies.length === 0) {
      // Una sesión sin cookies no sirve para nada: mejor no dejar una fila vacía.
      await this.descartar(clave);
      return;
    }
    const cifrado = cifrar(JSON.stringify(cookies), this.#llave, contextoSesion(clave));
    const fila: TablesInsert<'sesiones_sii'> = {
      certificado_id: clave.certificadoId,
      ambiente: clave.ambiente,
      cookies_cifradas: aBytea(cifrado),
      ultimo_uso_en: this.#reloj.ahora().toISOString(),
    };
    // Sin la columna, el upsert no la toca en una fila existente.
    if (expiraEn !== undefined) fila.expira_en = expiraEn === null ? null : expiraEn.toISOString();
    const { error } = await this.#cliente
      .from('sesiones_sii')
      .upsert(fila, { onConflict: 'certificado_id,ambiente' });
    if (error) throw fallo('guardar', error);
  }

  async descartar(clave: ClaveSesion): Promise<void> {
    const { error } = await this.#cliente
      .from('sesiones_sii')
      .delete()
      .eq('certificado_id', clave.certificadoId)
      .eq('ambiente', clave.ambiente);
    if (error) throw fallo('descartar', error);
  }
}

export interface OpcionesSesionReutilizada<T> {
  readonly sesiones: AlmacenSesiones;
  readonly clave: ClaveSesion;
  /** Login AUT2000 de la librería, p. ej. `() => folios.autenticar(credenciales.certificado)`. */
  readonly autenticar: () => Promise<SesionSii>;
  /** Lo que se hace con la sesión, p. ej. `(s) => folios.solicitar(s, rut, 39, 5)`. */
  readonly usar: (sesion: SesionSii) => Promise<T>;
  /**
   * `expira_en` de una sesión nueva (se calcula al autenticar). Sin él queda `null` y
   * vale hasta que el SII la rechace. Al reutilizar una sesión se conserva el suyo.
   */
  readonly expiraEn?: () => Date | null;
}

/**
 * Usa la sesión guardada; si no hay, autentica y la guarda. Si la librería lanza
 * `SesionCaducaError` con la sesión guardada, la descarta, autentica UNA vez más y
 * reintenta. Es seguro reintentar: la librería lanza `SesionCaducaError` solo antes
 * de la orden irreversible (timbrar folios, grabar la declaración); desde ahí en
 * adelante cualquier falla llega como `FoliosSinCafError` o `DeclaracionInciertaError`.
 * Con la sesión recién creada no se reintenta: el error sube tal cual.
 *
 * Debe correr dentro del candado del certificado (`bloqueos.ts`), para que dos
 * peticiones no abran sesiones AUT2000 en paralelo.
 *
 * La sesión nueva se guarda apenas se autentica (si la función se corta a mitad de
 * camino, la próxima petición no vuelve a hacer login) y otra vez después de `usar`,
 * porque el SII puede renovar cookies en la navegación. Esos guardados nunca lanzan:
 * si `usar` ya grabó algo en el SII (folios timbrados), perder el resultado por un
 * caché sería peor que volver a autenticar.
 *
 * @throws lo que lancen `sesiones.obtener`, `autenticar` o `usar`
 */
export async function conSesionReutilizada<T>(opciones: OpcionesSesionReutilizada<T>): Promise<T> {
  const { sesiones, clave, autenticar, usar } = opciones;

  const guardarSinFallar = async (sesion: SesionSii, expiraEn?: Date | null) => {
    try {
      await sesiones.guardar(clave, sesion, expiraEn);
    } catch {
      // Caché: la próxima vez se autentica de nuevo.
    }
  };
  const descartarSinFallar = async () => {
    try {
      await sesiones.descartar(clave);
    } catch {
      // Si no se pudo borrar, la próxima lectura la usará, caducará y se reintentará.
    }
  };
  const usarYGuardar = async (sesion: SesionSii): Promise<T> => {
    let resultado: T;
    try {
      resultado = await usar(sesion);
    } catch (error) {
      if (error instanceof SesionCaducaError) await descartarSinFallar();
      // Cualquier otra falla no invalida la sesión: se guardan sus cookies al día.
      else await guardarSinFallar(sesion);
      throw error;
    }
    await guardarSinFallar(sesion);
    return resultado;
  };

  const guardada = await sesiones.obtener(clave);
  if (guardada) {
    try {
      return await usarYGuardar(guardada);
    } catch (error) {
      if (!(error instanceof SesionCaducaError)) throw error;
    }
  }

  const nueva = await autenticar();
  await guardarSinFallar(nueva, opciones.expiraEn?.() ?? null);
  return usarYGuardar(nueva);
}
