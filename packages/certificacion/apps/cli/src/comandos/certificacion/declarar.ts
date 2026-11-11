// `sii certificacion declarar`: declara el cumplimiento de requisitos de boleta
// electrónica (el último paso de la certificación). Deja a la empresa AUTORIZADA
// EN PRODUCCIÓN: es la operación más delicada de la CLI.

import {
  DatosDeclaracion,
  DeclaracionInciertaError,
  type EntradaDeclaracion,
  type EstadoDeclaracion,
  Rut,
} from '@winex/certificacion';
import { z } from 'zod';
import { cargarCertificado, correo, leerVariables } from '../../config.ts';
import { CODIGOS, ErrorUso } from '../../errores.ts';
import { type DefinicionComando, opcionBooleana, opcionTexto } from '../tipos.ts';
import {
  AYUDA_LOGIN,
  autenticar,
  conIndicacion,
  declaracionBoletas,
  leerJson,
  rutEmpresa,
  sinConfirmar,
  validarDatos,
} from './comun-portal.ts';

const textoJson = z.string({ error: 'debe ser texto' });
const rutJson = textoJson
  .refine((v) => Rut.esValido(v), 'no es un RUT válido')
  .transform((v) => Rut.de(v).toString());

/** Formato de `--datos` (ver la ayuda). Campos desconocidos son error (atrapa erratas). */
const ESQUEMA = z.strictObject(
  {
    rutEmpresa: rutJson.optional(),
    linkConsulta: textoJson,
    rutProveedor: rutJson,
    nombreProveedor: textoJson,
    correoProveedor: textoJson.optional(),
  },
  { error: 'debe ser un objeto JSON' },
);

export const comando: DefinicionComando = {
  grupo: 'certificacion',
  nombre: 'declarar',
  resumen: 'Declara el cumplimiento (autoriza la empresa en producción)',
  ayuda: [
    'Uso: sii certificacion declarar --datos <archivo.json> --confirmar',
    '',
    'Declara el cumplimiento de requisitos de boleta electrónica en el portal de la',
    'declaración (www4.sii.cl). ATENCIÓN: deja a la empresa AUTORIZADA EN PRODUCCIÓN',
    'para emitir boletas. El usuario del certificado firma como representante legal.',
    '',
    'Solo se declara si la empresa está en P90 (la librería consulta el estado antes y',
    'se detiene sin grabar si no lo está; código 5). Revísalo con',
    '`sii certificacion estado-declaracion`.',
    '',
    'Opciones:',
    '  --datos <archivo>     JSON con los datos de la declaración (obligatorio).',
    '  --confirmar           Declara de verdad. Sin ella se valida todo y no se envía nada.',
    '',
    'Formato de --datos (los datos del proveedor de software los exige el SII: es la',
    'empresa que desarrolla o vende el sistema; si es la propia empresa, ella misma):',
    '  {',
    '    "rutEmpresa": "76123456-0",            (opcional; por defecto SII_RUT_EMPRESA)',
    '    "linkConsulta": "https://www.empresa.cl/boletas",   (hasta 100 caracteres)',
    '    "rutProveedor": "77777777-7",',
    '    "nombreProveedor": "Proveedor SpA",    (hasta 30 caracteres)',
    '    "correoProveedor": "sw@proveedor.cl"   (opcional; por defecto SII_CORREO_PROVEEDOR)',
    '  }',
    'Estos datos van por GWT-RPC (UTF-8), no por los asistentes HTML: admiten tildes.',
    '',
    'Variables del .env: SII_CERT_PATH, SII_CERT_PASS y, si faltan en el JSON,',
    'SII_RUT_EMPRESA y SII_CORREO_PROVEEDOR.',
    '',
    'Qué sale al SII (ambiente certificación), solo con --confirmar:',
    `  1. ${AYUDA_LOGIN}`,
    '  2. obtenerEstadoAutorizaEmp, recuperarNombreContribuyente y listarDocAutorizados',
    '     en www4.sii.cl (GWT-RPC, solo lectura).',
    '  3. autorizarEmpresaBolProd: GRABA la declaración (P91).',
    'Archivos que escribe: ninguno.',
    '',
    'Código 6 (resultado incierto): la orden salió y no se pudo confirmar. NO repitas',
    'a ciegas: consulta `sii certificacion estado-declaracion` (P91 = quedó autorizada;',
    'P90 = se puede volver a declarar).',
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
    const valores: EntradaDeclaracion = {
      rutEmpresa: json.rutEmpresa ?? rutEmpresa(config),
      linkConsulta: json.linkConsulta,
      rutProveedor: json.rutProveedor,
      nombreProveedor: json.nombreProveedor,
      correoProveedor:
        json.correoProveedor ??
        leerVariables(config, { SII_CORREO_PROVEEDOR: correo }).SII_CORREO_PROVEEDOR,
    };
    const datos = validarDatos(ruta, () => new DatosDeclaracion(valores));
    const certificado = await cargarCertificado(config);

    ctx.imprimir('Declaración de cumplimiento de boleta electrónica:');
    ctx.imprimir(`  Empresa:               ${datos.empresa}`);
    ctx.imprimir(`  Link de consulta:      ${datos.linkConsulta}`);
    ctx.imprimir(`  Proveedor de software: ${datos.proveedor} ${datos.nombreProveedor}`);
    ctx.imprimir(`  Correo del proveedor:  ${datos.correoProveedor}`);
    ctx.imprimir('ATENCIÓN: declarar deja a la empresa AUTORIZADA EN PRODUCCIÓN.');
    if (!opcionBooleana(entrada, 'confirmar')) {
      ctx.imprimir(
        'Revisa antes que esté en P90: `sii certificacion estado-declaracion` (no graba nada).',
      );
      return sinConfirmar(ctx, `sii certificacion declarar --datos ${archivo}`);
    }

    const sesion = await autenticar(ctx, certificado);
    ctx.imprimir('Declarando (la librería revisa antes que la empresa esté en P90)...');
    let estado: EstadoDeclaracion;
    try {
      estado = await declaracionBoletas(ctx).declarar(sesion, datos);
    } catch (error) {
      if (error instanceof DeclaracionInciertaError) {
        throw conIndicacion(
          error,
          `NO repitas la declaración a ciegas: consulta antes \`sii certificacion estado-declaracion ${datos.empresa}\` ` +
            '(P91 = quedó autorizada; P90 = se puede volver a declarar).',
        );
      }
      throw error;
    }
    ctx.imprimir(`Declaración efectuada: ${estado.codigo ?? ''} ${estado.glosa}`.trimEnd());
    ctx.imprimir(`La empresa ${datos.empresa} quedó autorizada en producción para emitir boletas.`);
    return CODIGOS.OK;
  },
};
