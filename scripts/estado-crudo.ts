/**
 * Diagnóstico: muestra la respuesta cruda de QueryEstUp (SOAP) para un trackId de
 * certificación, sin el token. Uso: node scripts/estado-crudo.ts <trackId>
 */

import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Certificado,
  ClienteDtews,
  type PeticionHttp,
  type RespuestaHttp,
  Rut,
  TransporteUndici,
} from '../packages/core/src/index.ts';

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.loadEnvFile(join(RAIZ, '.env'));
const trackId = process.argv[2] ?? '';

await using base = new TransporteUndici();
let token = '';
const transporte = {
  async enviar(p: PeticionHttp): Promise<RespuestaHttp> {
    const r = await base.enviar(p);
    if (String(p.url).includes('QueryEstUp')) {
      const texto = r.cuerpo.toString('latin1').replaceAll(token, '<token>');
      console.log(`HTTP ${r.status}\n${texto.replaceAll('&lt;', '<').replaceAll('&gt;', '>')}`);
    }
    return r;
  },
};

const cert = await Certificado.desdeArchivo(
  resolve(RAIZ, process.env.SII_CERT_PATH ?? ''),
  process.env.SII_CERT_PASS ?? '',
);
const soap = new ClienteDtews(cert, { ambiente: 'certificacion', transporte });
token = await soap.solicitarToken();
const rut = Rut.de(process.env.SII_RUT_EMPRESA ?? '').toString();
await soap
  .estadoEnvio(token, rut, trackId)
  .catch((e: Error) => console.log(`(${e.name}) ${e.message}`));
