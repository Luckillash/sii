// `sii certificacion estado-declaracion [rut]`: estado de la certificación de
// boletas en www4 (solo lectura). Reemplaza bin/certificacion/estado-declaracion.php.

import { cargarCertificado } from '../../config.ts';
import type { DefinicionComando } from '../tipos.ts';
import {
  AYUDA_LOGIN,
  autenticar,
  declaracionBoletas,
  lineasEstado,
  rutEmpresa,
} from './comun-portal.ts';

export const comando: DefinicionComando = {
  grupo: 'certificacion',
  nombre: 'estado-declaracion',
  resumen: 'Consulta el estado de la declaración de cumplimiento (solo lectura)',
  ayuda: [
    'Uso: sii certificacion estado-declaracion [rut]',
    '',
    'Consulta el estado de la certificación de boletas de la empresa en el portal',
    'de la declaración (www4.sii.cl). P90 = falta declarar cumplimiento',
    '(`sii certificacion declarar`); P91 = declaración efectuada (autorizada en',
    'producción). Sin código: sin trámite pendiente (ya autorizada, sin postular o el',
    'usuario del certificado no la representa). No graba nada.',
    '',
    'Argumentos:',
    '  rut                   RUT de la empresa (por defecto SII_RUT_EMPRESA).',
    '',
    'Variables del .env: SII_CERT_PATH, SII_CERT_PASS, SII_RUT_EMPRESA (si no va el rut).',
    '',
    'Qué sale al SII (ambiente certificación):',
    `  1. ${AYUDA_LOGIN}`,
    '  2. obtenerEstadoAutorizaEmp en www4.sii.cl (GWT-RPC, solo lectura).',
    'Archivos que escribe: ninguno.',
  ].join('\n'),
  opciones: {},
  posicionales: { min: 0, max: 1 },
  async ejecutar(ctx, entrada) {
    const config = entrada.config();
    const empresa = rutEmpresa(config, {
      valor: entrada.posicionales[0],
      opcion: 'el argumento rut',
    });
    const certificado = await cargarCertificado(config);

    const sesion = await autenticar(ctx, certificado);
    const estado = await declaracionBoletas(ctx).estado(sesion, empresa);
    for (const linea of lineasEstado(estado)) ctx.imprimir(linea);
    return undefined;
  },
};
