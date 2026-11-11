// Paridad de requests del canal SOAP DTEWS: ClienteDtews
// (src/certificacion/dtews-soap.ts) contra SiiSoapClient del core PHP
// (paridad/php/operaciones/http-dtews.php), los dos grabados por el servidor de
// captura (PLAN §5.3). Se comparan en el cable método, ruta, cabeceras y cuerpo,
// incluido el sobre de GetTokenFromSeed con la semilla firmada (la firma propia
// del PHP, ver firma-semilla-dtews.ts) para las tres rutas de carga del
// certificado (PEM, .pfx legacy y .pfx moderno).
//
// Al final de cada esperado va lo que el cliente leyó de la respuesta (token,
// trackId o resumen del estado), o `error` si lanzó (el mensaje no se compara:
// Node lo cambia a propósito).
//
// Diferencia deliberada en el cable, que estos casos no muestran: `Connection`.
// `file_get_contents` (semilla, token, estado) manda `close` y cURL (DTEUpload)
// no la manda; Node manda `keep-alive` en las primeras y `close` en DTEUpload
// (`conexionNueva`). El servidor de captura la excluye (decisión de la fase 4).
// El resto de las cabeceras (sin `Accept` ni `User-Agent` en SOAP; `Accept: */*`
// y sin `Expect` en DTEUpload) es idéntico.

import { describe, expect, it } from 'vitest';
import { ClienteDtews } from '../../src/certificacion/dtews-soap.ts';
import { Certificado } from '../../src/core/certificado.ts';
import { type CasoHttp, usarServidorCaptura } from '../soporte/captura.ts';
import { casos, esperado, exigirIdentico, leerMaterial } from '../soporte/paridad.ts';

interface Entrada {
  accion: 'getToken' | 'enviarDte' | 'estadoEnvio';
  archivo?: string;
  clave?: string;
  esperaError?: boolean;
  token?: string;
  rutEmisor?: string;
  rutEnvia?: string;
  rutEmpresa?: string;
  trackId?: string;
  xml?: { base64: string };
  nombreArchivo?: string;
  http?: CasoHttp;
}

/** Lo mismo que hace la operación PHP con cada acción. */
async function ejecutar(sii: ClienteDtews, entrada: Entrada): Promise<string> {
  const token = entrada.token ?? '';
  switch (entrada.accion) {
    case 'getToken':
      return sii.solicitarToken();
    case 'enviarDte':
      return sii.enviarDte(token, {
        rutEmisor: entrada.rutEmisor ?? '',
        rutEnvia: entrada.rutEnvia ?? '',
        xml: Buffer.from(entrada.xml?.base64 ?? '', 'base64'),
        nombreArchivo: entrada.nombreArchivo ?? '',
      });
    case 'estadoEnvio':
      return (
        await sii.estadoEnvio(token, entrada.rutEmpresa ?? '', entrada.trackId ?? '')
      ).resumen();
  }
}

describe('paridad: canal SOAP DTEWS (SiiSoapClient)', () => {
  const captura = usarServidorCaptura();
  const lista = casos<Entrada>('httpDtews');

  it('hay casos', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  for (const caso of lista) {
    it(caso.nombre, async () => {
      const { entrada } = caso;
      const certificado = Certificado.desdeContenido(
        leerMaterial(entrada.archivo ?? 'cert-titular.pem'),
        entrada.clave ?? '',
      );
      const { peticiones, resultado } = await captura.ejecutar(
        entrada.http,
        async ({ origenes, transporte }) => {
          const sii = new ClienteDtews(certificado, {
            ambiente: 'certificacion',
            transporte,
            urlBase: origenes.https,
          });
          let leido: string;
          try {
            leido = await ejecutar(sii, entrada);
          } catch (error) {
            if (entrada.esperaError !== true) throw error;
            return 'error';
          }
          if (entrada.esperaError === true) throw new Error('Se esperaba que el cliente lanzara.');
          return leido;
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
