/**
 * Revisa el .env de la validación en certificación (scripts/validar-certificacion.ts)
 * sin imprimir valores sensibles: solo si cada dato está, su formato y si calza con
 * el CAF y el certificado.
 *
 * Uso: node scripts/revisar-env.ts
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Certificado, parsearSetPruebas, Rut } from '../packages/core/src/index.ts';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(join(RAIZ, '.env'));

let errores = 0;
const ok = (m: string) => console.log(`  OK     ${m}`);
const mal = (m: string) => {
  errores++;
  console.log(`  ERROR  ${m}`);
};
const aviso = (m: string) => console.log(`  AVISO  ${m}`);
const v = (n: string) => process.env[n]?.trim() ?? '';

console.log('Variables:');
const obligatorias = [
  'SII_CERT_PATH',
  'SII_CERT_PASS',
  'SII_RUT_EMPRESA',
  'SII_RUT_FIRMA',
  'EMISOR_RAZON_SOCIAL',
  'EMISOR_GIRO',
  'EMISOR_DIRECCION',
  'EMISOR_COMUNA',
  'SII_FCH_RESOL',
  'SII_CAF_39',
  'SII_FOLIO_INICIAL',
];
for (const n of obligatorias) (v(n) ? ok : mal)(`${n} ${v(n) ? 'definida' : 'falta'}`);
for (const n of ['EMISOR_RAZON_SOCIAL', 'EMISOR_GIRO', 'EMISOR_DIRECCION', 'EMISOR_COMUNA']) {
  const valor = v(n);
  if (/^["'].*["']$/.test(valor)) mal(`${n} quedó con comillas literales`);
  if (/\s#/.test(valor)) mal(`${n} parece llevar un comentario pegado`);
  if (valor) ok(`${n}: ${valor.length} caracteres`);
}
if (
  /\.\s*$|\b(LTDA|SPA|EIRL)\.?$/i.test(v('EMISOR_GIRO')) ||
  /\b[A-Z]{2,4}\.\s/i.test(v('EMISOR_GIRO'))
) {
  aviso('EMISOR_GIRO parece tener abreviaciones; el SII pide no usarlas');
}

console.log('RUT:');
let rutEmpresa: Rut | undefined;
let rutFirma: Rut | undefined;
try {
  rutEmpresa = Rut.de(v('SII_RUT_EMPRESA'), 'SII_RUT_EMPRESA');
  ok(
    `SII_RUT_EMPRESA válido (DV correcto)${rutEmpresa.toString() === v('SII_RUT_EMPRESA') ? '' : '; se normaliza al usarlo'}`,
  );
} catch {
  mal('SII_RUT_EMPRESA no es un RUT válido (formato 76543210-K y DV correcto)');
}
try {
  rutFirma = Rut.de(v('SII_RUT_FIRMA'), 'SII_RUT_FIRMA');
  ok(
    `SII_RUT_FIRMA válido (DV correcto)${rutFirma.toString() === v('SII_RUT_FIRMA') ? '' : '; se normaliza al usarlo'}`,
  );
} catch {
  mal('SII_RUT_FIRMA no es un RUT válido (formato 76543210-K y DV correcto)');
}

console.log('Resolución:');
const fch = v('SII_FCH_RESOL');
const hoy = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/Santiago' }).format(new Date());
if (!/^\d{4}-\d{2}-\d{2}$/.test(fch) || Number.isNaN(Date.parse(`${fch}T00:00:00Z`))) {
  mal('SII_FCH_RESOL debe ser AAAA-MM-DD');
} else if (fch > hoy) {
  mal(`SII_FCH_RESOL (${fch}) es posterior a hoy (${hoy})`);
} else {
  ok(`SII_FCH_RESOL = ${fch}`);
  if (fch === '2026-09-05' || fch === '2026-09-04')
    aviso('es la fecha de los bin del autor original, ¿seguro que es la tuya?');
}
const nro = v('SII_NRO_RESOL') || '0';
(nro === '0' ? ok : mal)(
  `SII_NRO_RESOL = ${nro}${nro === '0' ? '' : ' (en certificación debe ser 0)'}`,
);

console.log('Certificado:');
try {
  const cert = await Certificado.desdeArchivo(
    resolve(RAIZ, v('SII_CERT_PATH')),
    v('SII_CERT_PASS'),
  );
  const info = cert.info();
  ok(`se lee; vigente hasta ${info.vigenteHasta ?? '?'}`);
  if (rutFirma !== undefined) {
    const numero = rutFirma.toString().split('-')[0] ?? '';
    const texto = `${cert.certificado}`;
    const der = Buffer.from(texto.replace(/-----[^-]+-----|\s/g, ''), 'base64').toString('latin1');
    if (der.includes(rutFirma.toString()) || der.includes(numero))
      ok('SII_RUT_FIRMA aparece en el certificado (es el titular)');
    else aviso('no se encontró SII_RUT_FIRMA dentro del certificado; debe ser el RUT del titular');
  }
} catch (e) {
  mal(`no se pudo leer el certificado: ${(e as Error).message}`);
}

console.log('CAF:');
const rutaCaf = resolve(RAIZ, v('SII_CAF_39'));
if (!existsSync(rutaCaf)) {
  mal('SII_CAF_39 no existe');
} else {
  const caf = readFileSync(rutaCaf, 'latin1').replace(/\s+/g, ' ');
  const campo = (t: string) => caf.match(new RegExp(`<${t}>\\s*([^<]*?)\\s*</${t}>`))?.[1] ?? '';
  const re = campo('RE');
  (campo('TD') === '39' ? ok : mal)(`tipo ${campo('TD')}`);
  (campo('IDK') === '100' ? ok : mal)(
    `IDK ${campo('IDK')} (${campo('IDK') === '100' ? 'certificación' : 'NO es de certificación'})`,
  );
  if (rutEmpresa !== undefined) {
    let igual = false;
    try {
      igual = Rut.de(re).equals(rutEmpresa);
    } catch {}
    (igual ? ok : mal)(`RUT del CAF ${igual ? '=' : '≠'} SII_RUT_EMPRESA`);
  }
  const d = Number(campo('D'));
  const h = Number(campo('H'));
  const inicial = Number.parseInt(v('SII_FOLIO_INICIAL'), 10);
  let casos = 0;
  try {
    casos = parsearSetPruebas(
      readFileSync(resolve(RAIZ, v('SII_SET_PRUEBAS') || 'data/set_pruebas/Set Prueba BE.txt')),
      '39',
    ).length;
  } catch (e) {
    mal(`set de pruebas: ${(e as Error).message}`);
  }
  const final = inicial + casos - 1;
  ok(`rango del CAF ${d}-${h}; el set tiene ${casos} casos -> folios ${inicial}-${final}`);
  if (!(inicial >= d && final <= h)) mal('los folios a usar no caben en el rango del CAF');
}

console.log('Set de pruebas:');
const rutaSet = resolve(RAIZ, v('SII_SET_PRUEBAS') || 'data/set_pruebas/Set Prueba BE.txt');
const ejemplo = resolve(RAIZ, '../certificacion-core/data/set_pruebas/Set Prueba BE.txt');
if (existsSync(ejemplo) && readFileSync(ejemplo).equals(readFileSync(rutaSet))) {
  aviso(
    'el set es IDÉNTICO al de ejemplo del repo PHP; el SII revisa contra el set que te entregó a ti',
  );
} else {
  ok('el set es distinto del de ejemplo del repo (se asume el tuyo)');
}
const numero = readFileSync(rutaSet, 'latin1').match(/N[UÚ]MERO DE ATENCI[OÓ]N:?\s*(\d+)/i)?.[1];
if (numero) ok(`número de atención del set: ${numero}`);

console.log(errores === 0 ? '\nSin errores.' : `\n${errores} error(es).`);
process.exitCode = errores === 0 ? 0 : 1;
