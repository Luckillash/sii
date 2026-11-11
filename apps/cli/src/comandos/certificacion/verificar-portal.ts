// `sii certificacion verificar-portal`: revisa, sin login, que el portal de la
// declaración de cumplimiento (www4) siga siendo la versión GWT capturada.

import { BASE_DECLARACION, PERMUTACION_DECLARACION } from '@winex/certificacion';
import { CODIGOS } from '../../errores.ts';
import type { DefinicionComando } from '../tipos.ts';
import { declaracionBoletas } from './comun-portal.ts';

const URL_PORTAL = `${BASE_DECLARACION}${PERMUTACION_DECLARACION}.cache.html`;

export const comando: DefinicionComando = {
  grupo: 'certificacion',
  nombre: 'verificar-portal',
  resumen: 'Revisa que el portal de la declaración siga en la versión capturada (sin login)',
  ayuda: [
    'Uso: sii certificacion verificar-portal',
    '',
    'Revisa que el portal de la declaración de cumplimiento de boletas (www4.sii.cl,',
    'app GWT certBolElectDteInternet) siga siendo la versión que conoce la librería:',
    'el archivo público de la app tiene que existir y traer la POLICY, el servicio,',
    'los métodos y las firmas de tipo que se usan. Si el SII publicó otra versión,',
    'estado-declaracion, descargar-set, solicitar-revision y declarar fallarían.',
    '',
    'Opciones: ninguna (solo --env y --ayuda).',
    'Variables del .env: ninguna (no lee el .env ni el certificado).',
    '',
    'Qué sale al SII: un GET público, sin cookies ni login, a',
    `  ${URL_PORTAL}`,
    'Archivos que escribe: ninguno.',
    '',
    'Códigos de salida: 0 = portal vigente; 5 = el portal cambió (muestra lo que falta;',
    'hay que actualizar la librería); 4 = no se pudo consultar (red o HTTP inesperado).',
  ].join('\n'),
  opciones: {},
  async ejecutar(ctx) {
    ctx.imprimir(`GET ${URL_PORTAL} (público, sin cookies).`);
    const problemas = await declaracionBoletas(ctx).verificarPortal();
    if (problemas.length === 0) {
      ctx.imprimir('Portal vigente: es la versión capturada (POLICY, firmas y métodos presentes).');
      return CODIGOS.OK;
    }
    ctx.imprimirError('[ERROR] El portal de la declaración NO es la versión capturada:');
    for (const p of problemas) ctx.imprimirError(`  - ${p}`);
    ctx.imprimirError(
      'Hay que actualizar la librería (POLICY, permutación y esquemas de DeclaracionBoletas) antes de usar el portal.',
    );
    return CODIGOS.SII;
  },
};
