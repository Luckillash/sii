// Arnés de los tests de la CLI: corre `ejecutarCli` con un contexto falso (salida
// capturada, reloj fijo, TransporteFalso) en una carpeta temporal con un `.env` y
// material de prueba (certificado, CAF, set de pruebas). Nunca sale a la red.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Reloj, relojFijo, TransporteFalso } from '@winex/certificacion';
import { afterEach } from 'vitest';
import { cafPrueba } from '../../../../packages/core/test/soporte/caf.ts';
import { certificado, pfx } from '../../../../packages/core/test/soporte/criptografia.ts';
import { ejecutarCli } from '../../src/cli.ts';
import type { Contexto } from '../../src/contexto.ts';

export const RUT_EMPRESA = '76123456-0';
export const RUT_FIRMA = '11111111-1';
export const CLAVE_PFX = 'clave-de-prueba';
/** 2026-11-07 10:00:00 en Chile (UTC-3). */
export const INSTANTE = '2026-11-07T13:00:00Z';

/**
 * Set de pruebas mínimo con el formato del portal del SII (2 casos). Las columnas
 * van separadas por 2 o más blancos, como en el archivo real (`parsearSetPruebas`
 * no acepta un solo tabulador).
 */
export const SET_PRUEBAS = [
  'CASO-1',
  '==============',
  'Item\t\tCantidad\t\tPrecio Unitario',
  'Cambio de aceite\t\t1\t\t19900',
  'Alineacion y balanceo\t\t1\t\t9900',
  '',
  'CASO-2',
  '==============',
  'Item\t\tCantidad\t\tPrecio Unitario',
  'Papel de regalo\t\t17\t\t120',
  '',
].join('\n');

const carpetas: string[] = [];
afterEach(() => {
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});

export interface Proyecto {
  /** Carpeta temporal (se borra al terminar el test). Es el `cwd` de la CLI. */
  readonly dir: string;
  /** Variables escritas en `<dir>/.env`. */
  readonly env: Record<string, string>;
  /** XML del CAF de prueba (tipo 39, folios 1–10, emisor `RUT_EMPRESA`). */
  readonly caf: string;
  /** Reescribe el `.env` con estas variables (se combinan con las actuales; `''` la vacía). */
  escribirEnv(cambios: Record<string, string>): void;
  /** Escribe un archivo dentro del proyecto y devuelve su ruta absoluta. */
  escribir(ruta: string, contenido: string | Uint8Array): string;
}

/**
 * Carpeta temporal con `.env` completo de certificación, un .pfx de prueba en
 * `data/certs/prueba.pfx`, un CAF en `data/caf/caf-39.xml` y el set en
 * `data/set_pruebas/set.txt`.
 */
export function proyecto(opciones: { caf?: Parameters<typeof cafPrueba>[0] } = {}): Proyecto {
  const dir = mkdtempSync(join(tmpdir(), 'sii-cli-'));
  carpetas.push(dir);
  const escribir = (ruta: string, contenido: string | Uint8Array) => {
    const completa = join(dir, ruta);
    mkdirSync(join(completa, '..'), { recursive: true });
    writeFileSync(completa, contenido);
    return completa;
  };
  escribir('data/certs/prueba.pfx', pfx(certificado(), CLAVE_PFX));
  const caf = cafPrueba({ rut: RUT_EMPRESA, desde: 1, hasta: 10, ...opciones.caf }).xml;
  escribir('data/caf/caf-39.xml', caf);
  escribir('data/set_pruebas/set.txt', SET_PRUEBAS);

  const env: Record<string, string> = {
    SII_CERT_PATH: 'data/certs/prueba.pfx',
    SII_CERT_PASS: CLAVE_PFX,
    SII_RUT_EMPRESA: RUT_EMPRESA,
    SII_RUT_FIRMA: RUT_FIRMA,
    EMISOR_RAZON_SOCIAL: 'EMPRESA DE PRUEBA SPA',
    EMISOR_GIRO: 'VENTA AL POR MENOR',
    EMISOR_DIRECCION: 'CALLE FALSA 123',
    EMISOR_COMUNA: 'SANTIAGO',
    SII_FCH_RESOL: '2026-09-05',
    SII_NRO_RESOL: '0',
    SII_CAF_39: 'data/caf/caf-39.xml',
    SII_FOLIO_INICIAL: '1',
    SII_SET_PRUEBAS: 'data/set_pruebas/set.txt',
    SII_RCOF_SEC_ENVIO: '1',
    SII_CORREO_PROVEEDOR: 'proveedor@example.com',
  };
  const escribirEnv = (cambios: Record<string, string>) => {
    Object.assign(env, cambios);
    escribir(
      '.env',
      Object.entries(env)
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
    );
  };
  escribirEnv({});
  return { dir, env, caf, escribirEnv, escribir };
}

export interface ResultadoCli {
  readonly codigo: number;
  /** Salida estándar completa (líneas unidas con `\n`). */
  readonly stdout: string;
  readonly stderr: string;
  /** Todo lo que se pidió al SII (falso). */
  readonly transporte: TransporteFalso;
}

export interface OpcionesCorrer {
  /** Respuestas del SII falso (ver `TransporteFalso`). Lo que no calce responde 404. */
  readonly transporte?: TransporteFalso;
  /** Variables del entorno del proceso (ganan sobre el `.env`). */
  readonly entorno?: Record<string, string | undefined>;
  readonly reloj?: Reloj;
}

/** Corre `sii <argv...>` en la carpeta del proyecto. */
export async function correr(
  p: Pick<Proyecto, 'dir'>,
  argv: readonly string[],
  opciones: OpcionesCorrer = {},
): Promise<ResultadoCli> {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const transporte = opciones.transporte ?? new TransporteFalso();
  const ctx: Contexto = {
    cwd: p.dir,
    entorno: opciones.entorno ?? {},
    reloj: opciones.reloj ?? relojFijo(INSTANTE),
    imprimir: (l) => stdout.push(l),
    imprimirError: (l) => stderr.push(l),
    transporte: () => transporte,
  };
  const codigo = await ejecutarCli(argv, ctx);
  return { codigo, stdout: stdout.join('\n'), stderr: stderr.join('\n'), transporte };
}
