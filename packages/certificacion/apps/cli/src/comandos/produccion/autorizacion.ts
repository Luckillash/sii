// `sii produccion autorizacion [rut]`: consulta en el portal de producción si la
// empresa está autorizada para emitir con software de mercado y con qué resolución
// (página «Actualización de datos del contribuyente», ad_empresa). Solo lectura.

import { ConsultaAutorizacion, type ResultadoAutorizacion } from '@winex/certificacion';
import { cargarCertificado } from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import { CODIGOS } from '../../errores.ts';
import { rutEmpresa } from '../certificacion/comun-portal.ts';
import { type DefinicionComando, type EntradaComando, opcionBooleana } from '../tipos.ts';

const AYUDA = `Uso: sii produccion autorizacion [rut] [--json]

Consulta en el portal de producción del SII (palena) si la empresa está autorizada
para emitir con software de mercado y con qué resolución. Solo lectura: nunca envía
el formulario que actualiza los datos del contribuyente.

El SII solo responde si el titular del certificado es REPRESENTANTE LEGAL de la
empresa (no basta el representante electrónico). Las respuestas posibles:
  autorizada           fecha de autorización y resolución de producción (número y
                       fecha, los de SII_PRODUCCION_NRO_RESOL / _FCH_RESOL);
  sin representación   el titular no es representante legal: no dice nada de la
                       autorización (registra la resolución a mano);
  no autorizada        la empresa no está autorizada en esta modalidad.

Argumentos:
  rut                  RUT de la empresa (por defecto SII_RUT_EMPRESA).

Opciones:
  --json               Imprime el resultado en JSON (tipo, rut, razonSocial,
                       fechaAutorizacion, resolucion).

Variables del .env: SII_CERT_PATH, SII_CERT_PASS, SII_RUT_EMPRESA (si no va el rut).

Qué sale al SII (producción):
  1. Login AUT2000 con el certificado (herculesr.sii.cl, vuelta a palena.sii.cl).
  2. GET palena.sii.cl/cvc_cgi/dte/ad_empresa1.
  3. POST palena.sii.cl/cvc_cgi/dte/ad_empresa2 con RUT_EMP, DV_EMP y ACEPTAR.
Archivos que escribe: ninguno.

Ojo: el SII frena los inicios de sesión seguidos (unos 5).

Códigos de salida: 0 = el SII respondió (cualquiera de las tres); 7 = el SII
respondió una página que la librería no reconoce o de otro RUT (no se interpretó).`;

export const comando: DefinicionComando = {
  grupo: 'produccion',
  nombre: 'autorizacion',
  resumen: 'Consulta si la empresa está autorizada y con qué resolución (solo lectura)',
  ayuda: AYUDA,
  opciones: { json: { type: 'boolean' } },
  posicionales: { min: 0, max: 1 },
  ejecutar: autorizacion,
};

async function autorizacion(ctx: Contexto, entrada: EntradaComando) {
  const json = opcionBooleana(entrada, 'json');
  const config = entrada.config();
  const empresa = rutEmpresa(config, {
    valor: entrada.posicionales[0],
    opcion: 'el argumento rut',
  });
  const certificado = await cargarCertificado(config);

  const consulta = new ConsultaAutorizacion({ transporte: ctx.transporte(), reloj: ctx.reloj });
  if (!json) ctx.imprimir('Autenticando con el certificado (AUT2000, producción)...');
  const sesion = await consulta.autenticar(certificado);
  const resultado = await consulta.consultar(sesion, empresa);

  if (json) {
    ctx.imprimir(JSON.stringify(resultado, null, 2));
    return CODIGOS.OK;
  }
  for (const linea of lineas(empresa, resultado)) ctx.imprimir(linea);
  return CODIGOS.OK;
}

function lineas(empresa: string, r: ResultadoAutorizacion): string[] {
  switch (r.tipo) {
    case 'autorizada':
      return [
        `Empresa:     ${r.rut} (${r.razonSocial})`,
        `Autorizada en producción desde ${r.fechaAutorizacion}.`,
        `Resolución:  n.º ${r.resolucion.numero} del ${r.resolucion.fecha}`,
        `Para el .env: SII_PRODUCCION_NRO_RESOL=${r.resolucion.numero} y SII_PRODUCCION_FCH_RESOL=${r.resolucion.fecha}`,
      ];
    case 'sin_representacion':
      return [
        `Empresa:     ${empresa}`,
        'El titular del certificado no figura como representante legal de la empresa en el SII:',
        'no se pudo verificar la autorización. Si la empresa ya está certificada, usa su',
        'resolución de producción (SII_PRODUCCION_NRO_RESOL / SII_PRODUCCION_FCH_RESOL).',
      ];
    case 'no_autorizada':
      return [
        `Empresa:     ${empresa}`,
        'El SII indica que la empresa NO está autorizada para emitir con software de mercado:',
        'hay que certificarla (sii certificacion postular ...).',
      ];
  }
}
