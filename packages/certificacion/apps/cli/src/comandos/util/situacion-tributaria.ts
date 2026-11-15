// `sii util situacion-tributaria <rut>`: historial de timbraje de un RUT en la
// consulta pública «Situación tributaria de terceros» del SII. Sin login, sin
// certificado y sin .env.

import { Rut, SituacionTributaria, type TimbrajeStc } from '@winex/certificacion';
import type { Contexto } from '../../contexto.ts';
import { CODIGOS, ErrorUso } from '../../errores.ts';
import { type DefinicionComando, type EntradaComando, opcionBooleana } from '../tipos.ts';

const AYUDA = `Uso: sii util situacion-tributaria <rut> [--json]

Muestra los tipos de documento a los que el SII le timbró folios al RUT (tabla
«Documentos autorizados» de la consulta pública de situación tributaria de
terceros): código, año del último timbraje y último folio timbrado.

Es el HISTORIAL de timbraje, no la lista de autorizaciones: un tipo aparece solo
cuando ya se le timbraron folios. Boleta electrónica (39 o 41) prueba que la
empresa está autorizada para boletas; que no aparezca no prueba nada (una empresa
recién certificada todavía no tiene timbrajes).

Argumentos:
  rut                  RUT del contribuyente (cualquiera; no hace falta representarlo).

Opciones:
  --json               Imprime el resultado en JSON ({ tipo, timbrajes }).

Variables del .env: ninguna (no lee el .env ni el certificado).

Qué sale al SII (público, sin cookies ni certificado):
  1. GET www2.sii.cl/app/stc/recurso/v1/recaptcha/key (si el captcha está activo,
     se detiene aquí: no se intenta resolver).
  2. POST www2.sii.cl/app/stc/recurso/v1/consulta/getConsultaData/ con el RUT.
Archivos que escribe: ninguno. De la respuesta solo se usan los timbrajes.

Códigos de salida: 0 = consulta hecha; 5 = el SII tiene el captcha activo (no se
consultó); 7 = la respuesta no tiene la forma conocida; 4 = red o HTTP inesperado.`;

export const comando: DefinicionComando = {
  grupo: 'util',
  nombre: 'situacion-tributaria',
  resumen: 'Historial de timbraje de un RUT en la consulta pública del SII (sin certificado)',
  ayuda: AYUDA,
  opciones: { json: { type: 'boolean' } },
  posicionales: { min: 1, max: 1 },
  ejecutar: situacionTributaria,
};

/** Nombres de los documentos electrónicos más comunes (el SII manda el suyo, con relleno). */
const NOMBRES: Readonly<Record<number, string>> = {
  33: 'factura electrónica',
  34: 'factura exenta electrónica',
  39: 'boleta electrónica',
  41: 'boleta exenta electrónica',
  46: 'factura de compra electrónica',
  52: 'guía de despacho electrónica',
  56: 'nota de débito electrónica',
  61: 'nota de crédito electrónica',
};

async function situacionTributaria(ctx: Contexto, entrada: EntradaComando) {
  const json = opcionBooleana(entrada, 'json');
  const texto = (entrada.posicionales[0] ?? '').trim();
  if (!Rut.esValido(texto)) throw new ErrorUso(`RUT inválido: "${texto}".`);
  const rut = Rut.de(texto);

  const resultado = await new SituacionTributaria({ transporte: ctx.transporte() }).timbrajes(rut);
  if (json) {
    ctx.imprimir(JSON.stringify(resultado, null, 2));
    return resultado.tipo === 'ok' ? CODIGOS.OK : CODIGOS.SII;
  }
  if (resultado.tipo === 'captcha') {
    ctx.imprimirError(
      '[ERROR] El SII tiene activo el captcha de la consulta de situación tributaria: no se consultó.',
    );
    return CODIGOS.SII;
  }

  ctx.imprimir(`Contribuyente: ${rut}`);
  if (resultado.timbrajes.length === 0) {
    ctx.imprimir('Sin timbrajes registrados en el SII.');
  } else {
    ctx.imprimir('Timbrajes (historial del SII):');
    for (const t of resultado.timbrajes) ctx.imprimir(`  ${linea(t)}`);
  }
  const boleta = resultado.timbrajes.filter((t) => t.tipoDte === 39 || t.tipoDte === 41);
  ctx.imprimir(
    boleta.length > 0
      ? `Boleta electrónica: SÍ (último timbraje ${Math.max(...boleta.map((t) => t.ultimoAnio))}). ` +
          'La empresa está autorizada para boletas.'
      : 'Boleta electrónica: sin timbrajes de 39 ni 41 (no prueba que no esté autorizada).',
  );
  return CODIGOS.OK;
}

function linea(t: TimbrajeStc): string {
  const nombre = NOMBRES[t.tipoDte];
  return (
    `${String(t.tipoDte).padStart(3)}${nombre === undefined ? '' : ` ${nombre}`}: ` +
    `último timbraje ${t.ultimoAnio}, último folio ${t.folioFinal}`
  );
}
