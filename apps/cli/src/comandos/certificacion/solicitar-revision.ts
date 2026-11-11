// `sii certificacion solicitar-revision <trackId>`: pide al SII la revisión del set
// de pruebas de boletas enviado (portal de la declaración, "Solicitar validación").

import { SetSinDescargarError } from '@winex/certificacion';
import { cargarCertificado } from '../../config.ts';
import { CODIGOS, ErrorUso } from '../../errores.ts';
import { type DefinicionComando, opcionBooleana, opcionTexto } from '../tipos.ts';
import {
  AYUDA_LOGIN,
  autenticar,
  conIndicacion,
  declaracionBoletas,
  rutEmpresa,
  sinConfirmar,
} from './comun-portal.ts';

export const comando: DefinicionComando = {
  grupo: 'certificacion',
  nombre: 'solicitar-revision',
  resumen: 'Pide al SII la revisión del set de pruebas enviado',
  ayuda: [
    'Uso: sii certificacion solicitar-revision <trackId> [--rut <rut>] --confirmar',
    '',
    'Pide al SII que revise el set de pruebas de boletas enviado con ese trackId',
    '(portal de la declaración, "Solicitar validación"). El resultado NO es inmediato:',
    'el SII lo informa por correo y, si aprueba, `sii certificacion estado-declaracion`',
    'muestra P90 (falta declarar cumplimiento).',
    '',
    'Antes, revisa con `sii certificacion estado-envio <trackId>` que el envío no tenga',
    'rechazos ni reparos: pedir la revisión de un envío con problemas no sirve.',
    'Si el SII responde que falta descargar el set, usa `sii certificacion descargar-set`',
    '(set nuevo), envía las boletas de ese set y pide la revisión con el nuevo trackId.',
    '',
    'Argumentos:',
    '  trackId               Identificador del envío de las boletas (solo dígitos, hasta 15).',
    '',
    'Opciones:',
    '  --rut <rut>           RUT de la empresa (en vez de SII_RUT_EMPRESA).',
    '  --confirmar           Envía la solicitud. Sin ella se valida todo y no se envía nada.',
    '',
    'Variables del .env: SII_CERT_PATH, SII_CERT_PASS, SII_RUT_EMPRESA.',
    '',
    'Qué sale al SII (ambiente certificación), solo con --confirmar:',
    `  1. ${AYUDA_LOGIN}`,
    '  2. recuperarNroActividadesVigAfecIva e ingresarTrackId en www4.sii.cl (GWT-RPC):',
    '     aquí el SII registra la solicitud.',
    'Archivos que escribe: ninguno.',
  ].join('\n'),
  opciones: {
    rut: { type: 'string' },
    confirmar: { type: 'boolean' },
  },
  posicionales: { min: 1, max: 1 },
  async ejecutar(ctx, entrada) {
    const trackId = entrada.posicionales[0] ?? '';
    if (!/^\d{1,15}$/.test(trackId)) {
      throw new ErrorUso(`trackId inválido: ${trackId} (solo dígitos, hasta 15).`);
    }
    const config = entrada.config();
    const empresa = rutEmpresa(config, { valor: opcionTexto(entrada, 'rut'), opcion: '--rut' });
    const certificado = await cargarCertificado(config);

    ctx.imprimir(`Empresa: ${empresa}`);
    ctx.imprimir(`Solicitud de revisión del set de pruebas enviado con el trackId ${trackId}.`);
    if (!opcionBooleana(entrada, 'confirmar')) {
      return sinConfirmar(ctx, `sii certificacion solicitar-revision ${trackId}`);
    }

    const sesion = await autenticar(ctx, certificado);
    try {
      await declaracionBoletas(ctx).solicitarRevisionSet(sesion, empresa, trackId);
    } catch (error) {
      if (error instanceof SetSinDescargarError) {
        throw conIndicacion(
          error,
          'Qué hacer: descarga el set de pruebas (`sii certificacion descargar-set --confirmar`), ' +
            'envía las boletas de ESE set (`sii certificacion enviar-set`) y pide la revisión con ' +
            'el trackId de ese envío.',
        );
      }
      throw error;
    }
    ctx.imprimir('El SII recibió la solicitud de revisión.');
    ctx.imprimir(
      'El resultado llega por correo; si aprueba, `sii certificacion estado-declaracion` mostrará P90.',
    );
    return CODIGOS.OK;
  },
};
