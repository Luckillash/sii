// `sii certificacion postular`: postula una empresa a boleta electrónica en el
// ambiente de certificación (asistente `pe_*` de maullin). Es el primer paso de la
// certificación.

import { DatosPostulacion, type EntradaPostulacion, Rut } from '@winex/certificacion';
import { z } from 'zod';
import { cargarCertificado, leerVariables, rut } from '../../config.ts';
import { CODIGOS, ErrorUso } from '../../errores.ts';
import { type DefinicionComando, opcionBooleana, opcionTexto } from '../tipos.ts';
import {
  AYUDA_LOGIN,
  autenticar,
  leerJson,
  postulacionSii,
  rutEmpresa,
  sinConfirmar,
  soloAscii,
  validarDatos,
} from './comun-portal.ts';

/** Texto que va al asistente del SII: solo ASCII imprimible (PLAN §8, 2026-11-07). */
const textoAscii = z.string({ error: 'debe ser texto' }).superRefine(soloAscii);
const rutJson = z
  .string({ error: 'debe ser texto' })
  .refine((v) => Rut.esValido(v), 'no es un RUT válido')
  .transform((v) => Rut.de(v).toString());

/** Formato de `--datos` (ver la ayuda). Campos desconocidos son error (atrapa erratas). */
const ESQUEMA = z.strictObject(
  {
    rutEmpresa: rutJson.optional(),
    rutAdministrador: rutJson.optional(),
    correoAdministrador: textoAscii,
    correoContactoSii: textoAscii,
    correoIntercambio: textoAscii,
    nombreSoftware: textoAscii,
    boletaExenta: z.boolean({ error: 'debe ser true o false' }).optional(),
    url: textoAscii.optional(),
  },
  { error: 'debe ser un objeto JSON' },
);

export const comando: DefinicionComando = {
  grupo: 'certificacion',
  nombre: 'postular',
  resumen: 'Postula la empresa a boleta electrónica en certificación (maullin)',
  ayuda: [
    'Uso: sii certificacion postular --datos <archivo.json> --confirmar',
    '',
    'Postula la empresa a boleta electrónica en el ambiente de certificación',
    '(asistente de postulación de maullin.sii.cl). El usuario del certificado tiene que',
    'ser representante legal. Se puede repetir: vuelve a dejar la empresa en',
    'certificación con los datos nuevos. Factura no se postula desde aquí.',
    '',
    'Opciones:',
    '  --datos <archivo>     JSON con los datos de la postulación (obligatorio).',
    '  --confirmar           Postula de verdad. Sin ella solo se valida y se muestra el resumen.',
    '',
    'Formato de --datos:',
    '  {',
    '    "rutEmpresa": "76123456-0",              (opcional; por defecto SII_RUT_EMPRESA)',
    '    "rutAdministrador": "11111111-1",        (opcional; por defecto SII_RUT_FIRMA)',
    '    "correoAdministrador": "admin@empresa.cl",',
    '    "correoContactoSii": "contacto@empresa.cl",',
    '    "correoIntercambio": "dte@empresa.cl",',
    '    "nombreSoftware": "Software Propio",     (hasta 30 caracteres)',
    '    "boletaExenta": true,                    (opcional; por defecto true)',
    '    "url": "www.empresa.cl"                  (opcional; empieza con "www.")',
    '  }',
    'El administrador tiene que ser quien después se autentica para ver el avance y',
    'declarar (normalmente el titular del certificado). Los correos siguen la regla del',
    'SII: sin + ni símbolos, un solo @ y hasta 50 caracteres.',
    '',
    'SOLO ASCII: los textos no pueden llevar tildes, ñ ni otros caracteres fuera de',
    'ASCII imprimible (se rechazan con código 3 antes de cualquier petición). El',
    'asistente del SII declara charset=iso-8859-1 y con tildes la confirmación no calza',
    'y la postulación no se graba (decisión del 2026-11-07, PLAN-MIGRACION §8).',
    '',
    'Variables del .env: SII_CERT_PATH, SII_CERT_PASS y, si faltan en el JSON,',
    'SII_RUT_EMPRESA y SII_RUT_FIRMA.',
    '',
    'Qué sale al SII (ambiente certificación), solo con --confirmar:',
    `  1. ${AYUDA_LOGIN}`,
    '  2. pe_ingrut, pe_datos_empresa (y las páginas de aviso) y pe_confirma en',
    '     maullin.sii.cl; antes de grabar se revisa que la confirmación del SII traiga',
    '     exactamente los datos enviados.',
    '  3. pe_graba_postulacion: GRABA la postulación.',
    'Archivos que escribe: ninguno.',
  ].join('\n'),
  opciones: {
    datos: { type: 'string' },
    confirmar: { type: 'boolean' },
  },
  async ejecutar(ctx, entrada) {
    const archivo = opcionTexto(entrada, 'datos');
    if (archivo === undefined) throw new ErrorUso('Falta --datos <archivo.json>.');
    const config = entrada.config();
    const { ruta, datos: json } = leerJson(config, archivo, '--datos', ESQUEMA);
    const valores: EntradaPostulacion = {
      rutEmpresa: json.rutEmpresa ?? rutEmpresa(config),
      rutAdministrador:
        json.rutAdministrador ?? leerVariables(config, { SII_RUT_FIRMA: rut }).SII_RUT_FIRMA,
      correoAdministrador: json.correoAdministrador,
      correoContactoSii: json.correoContactoSii,
      correoIntercambio: json.correoIntercambio,
      nombreSoftware: json.nombreSoftware,
      ...(json.boletaExenta !== undefined ? { boletaExenta: json.boletaExenta } : {}),
      ...(json.url !== undefined ? { url: json.url } : {}),
    };
    const datos = validarDatos(ruta, () => new DatosPostulacion(valores));
    const certificado = await cargarCertificado(config);

    ctx.imprimir('Postulación a boleta electrónica (certificación):');
    ctx.imprimir(`  Empresa:                 ${datos.empresa}`);
    ctx.imprimir(`  Usuario administrador:   ${datos.administrador}`);
    ctx.imprimir(`  Correo administrador:    ${datos.correoAdministrador}`);
    ctx.imprimir(`  Correo contacto SII:     ${datos.correoContactoSii}`);
    ctx.imprimir(`  Correo intercambio:      ${datos.correoIntercambio}`);
    ctx.imprimir(`  Nombre del software:     ${datos.nombreSoftware}`);
    ctx.imprimir(`  Boleta exenta:           ${datos.boletaExenta ? 'sí' : 'no'}`);
    ctx.imprimir(`  URL:                     ${datos.url !== '' ? datos.url : '(sin URL)'}`);
    if (!opcionBooleana(entrada, 'confirmar')) {
      return sinConfirmar(ctx, `sii certificacion postular --datos ${archivo}`);
    }

    const sesion = await autenticar(ctx, certificado);
    ctx.imprimir('Postulando en maullin.sii.cl...');
    const resultado = await postulacionSii(ctx).postular(sesion, datos);
    for (const aviso of resultado.avisos) ctx.imprimir(`Aviso del SII: ${aviso}`);
    ctx.imprimir(`Postulación de ${resultado.empresa} aceptada por el SII.`);
    if (resultado.mensaje !== '') ctx.imprimir(resultado.mensaje);
    ctx.imprimir('Siguiente paso: `sii certificacion descargar-set --confirmar` (set de pruebas).');
    return CODIGOS.OK;
  },
};
