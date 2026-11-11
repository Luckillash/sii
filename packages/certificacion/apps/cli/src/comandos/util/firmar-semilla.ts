// `sii util firmar-semilla <semilla>`: firma una semilla obtenida a mano (Swagger
// del SII, Postman) y deja el XML listo para POST boleta.electronica.token.
// Reemplaza bin/util/firmar-semilla.php. Sin red.

import { FirmaElectronica } from '@winex/certificacion';
import { cargarCertificado } from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import { CODIGOS, ErrorUso } from '../../errores.ts';
import type { DefinicionComando, EntradaComando } from '../tipos.ts';

const AYUDA = `Uso: sii util firmar-semilla <semilla>

Firma una semilla de la API REST de boleta obtenida a mano (p. ej. desde el
"Try it out" del Swagger del SII o desde Postman) e imprime el XML getToken
firmado, listo para usar como cuerpo de POST boleta.electronica.token.

La semilla es el número que viene en <SEMILLA>...</SEMILLA>.

Variables del .env:
  SII_CERT_PATH, SII_CERT_PASS   certificado que firma

Qué sale al SII: nada (no hay red).
Archivos que escribe: ninguno. El XML va a la salida estándar entre las marcas
  ===== COPIA DESDE AQUI ===== y ===== HASTA AQUI =====
  (incluye el certificado público, no la llave privada).`;

export const comando: DefinicionComando = {
  grupo: 'util',
  nombre: 'firmar-semilla',
  resumen: 'Firma una semilla para pedir el token REST a mano',
  ayuda: AYUDA,
  opciones: {},
  posicionales: { min: 1, max: 1 },
  ejecutar: firmarSemilla,
};

async function firmarSemilla(ctx: Contexto, entrada: EntradaComando) {
  const semilla = (entrada.posicionales[0] ?? '').trim();
  // Las semillas del SII son numéricas. Además, la semilla va sin escapar dentro
  // del XML firmado: cualquier otra cosa podría romperlo.
  if (!/^[0-9]+$/.test(semilla)) {
    throw new ErrorUso(`Semilla inválida: "${semilla}". Debe ser numérica.`);
  }

  const certificado = await cargarCertificado(entrada.config());
  const firmador = new FirmaElectronica(certificado.llavePrivada, certificado.certificado);
  const xml = firmador.firmarSemilla(semilla);

  ctx.imprimir('===== COPIA DESDE AQUI =====');
  ctx.imprimir(xml);
  ctx.imprimir('===== HASTA AQUI =====');
  return CODIGOS.OK;
}
