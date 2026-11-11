// Paridad de requests de la API REST de boleta: ClienteBoletaRest
// (src/produccion/boleta-rest.ts) contra SiiBoletaProduccion del core PHP
// (paridad/php/operaciones/http-rest.php), los dos grabados por el servidor de
// captura (PLAN §5.3). Autenticación (semilla, token, consulta) en el origen
// `https`; envío de boleta y RCOF en `https2`.
//
// Al final de cada esperado va lo que el cliente leyó de la respuesta (token,
// trackid o estado), o `error` si lanzó.
//
// Diferencias deliberadas en el cable, que estos casos no muestran:
// - `filename` del multipart: el PHP manda el nombre de un temporal de tempnam()
//   (`bolC7E.tmp.xml` en Windows, `bol_AbC123.xml` en Linux; distinto en cada
//   envío) y Node `envio.xml` / `rcof.xml`. Los casos lo normalizan
//   (`normalizar.nombresArchivo`): se compara solo la extensión.
// - `Expect: 100-continue`: cURL lo agrega a los cuerpos de más de 1 MiB y undici
//   no lo envía (rechaza esa cabecera). Con un sobre de más de 1 MiB el PHP manda
//   esa cabecera y Node no; el resto de la petición es igual. Los casos usan los
//   sobres del set completo (unos 27 KB y 4 KB).
// - `Connection`: Node manda `close` en las subidas (`conexionNueva`) y
//   `keep-alive` en el resto; el servidor de captura la excluye (fase 4).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Certificado } from '../../src/core/certificado.ts';
import { ClienteBoletaRest } from '../../src/produccion/boleta-rest.ts';
import { type CasoHttp, usarServidorCaptura } from '../soporte/captura.ts';
import { casos, esperado, exigirIdentico, material, RAIZ_PARIDAD } from '../soporte/paridad.ts';

interface Entrada {
  accion: 'solicitarToken' | 'enviarBoletaXml' | 'enviarConsumoFolios' | 'consultarEnvio';
  esperaError?: boolean;
  token?: string;
  rutEmisor?: string;
  rutEnvia?: string;
  trackId?: string;
  xml?: { esperado: string } | { base64: string };
  http?: CasoHttp;
}

const { llave, certificado } = material('base');
const cert = Certificado.desdeContenido(`${llave}\n${certificado}`);

function bytesXml(xml: Entrada['xml']): Buffer {
  if (xml === undefined) return Buffer.alloc(0);
  if ('base64' in xml) return Buffer.from(xml.base64, 'base64');
  if (!/^[\w-]+$/.test(xml.esperado)) throw new Error(`Esperado desconocido: ${xml.esperado}`);
  return readFileSync(join(RAIZ_PARIDAD, 'esperados', `${xml.esperado}.bin`));
}

/** Lo mismo que hace la operación PHP con cada acción. */
async function ejecutar(sii: ClienteBoletaRest, entrada: Entrada): Promise<string> {
  const token = entrada.token ?? '';
  const rutEmisor = entrada.rutEmisor ?? '';
  const rutEnvia = entrada.rutEnvia ?? '';
  switch (entrada.accion) {
    case 'solicitarToken':
      return sii.solicitarToken();
    case 'enviarBoletaXml':
      return (await sii.enviarBoleta(token, rutEmisor, rutEnvia, bytesXml(entrada.xml))).trackId;
    case 'enviarConsumoFolios':
      return (await sii.enviarConsumoFolios(token, rutEmisor, rutEnvia, bytesXml(entrada.xml)))
        .trackId;
    case 'consultarEnvio':
      return (await sii.consultarEnvio(token, rutEmisor, entrada.trackId ?? '')).estado;
  }
}

describe('paridad: API REST de boleta (SiiBoletaProduccion)', () => {
  const captura = usarServidorCaptura();
  const lista = casos<Entrada>('httpRest');

  it('hay casos', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  for (const caso of lista) {
    it(caso.nombre, async () => {
      const { entrada } = caso;
      const { peticiones, resultado } = await captura.ejecutar(
        entrada.http,
        async ({ origenes, transporte }) => {
          const sii = new ClienteBoletaRest(cert, {
            ambiente: 'certificacion',
            transporte,
            urls: {
              auth: `${origenes.https}/recursos/v1`,
              envio: `${origenes.https2}/recursos/v1`,
            },
          });
          if (entrada.esperaError !== true) return ejecutar(sii, entrada);
          // Camino de error: lo que se compara es el cable (los mensajes difieren a propósito).
          await expect(ejecutar(sii, entrada)).rejects.toThrow();
          return 'error';
        },
      );
      exigirIdentico(
        Buffer.concat([peticiones, Buffer.from(`=== resultado ===\n${resultado}\n`, 'utf8')]),
        esperado(caso.nombre).bytes,
        caso.nombre,
      );
    });
  }
});
