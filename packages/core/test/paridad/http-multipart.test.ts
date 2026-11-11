// Paridad del multipart: `armarMultipart` enviado por `TransporteUndici` contra el
// POST con cURL + CURLFile del core PHP (paridad/php/operaciones/http-multipart.php),
// los dos grabados por el servidor de captura (PLAN §5.3).

import { describe, expect, it } from 'vitest';
import { armarMultipart, type CampoMultipart } from '../../src/comun/http/multipart.ts';
import {
  type CasoHttp,
  cabecerasComoCurl,
  type Origen,
  usarServidorCaptura,
} from '../soporte/captura.ts';
import { casos, esperado, exigirIdentico } from '../soporte/paridad.ts';

type ArchivoEntrada = { base64: string } | { texto: string };

interface Entrada {
  origen?: Origen;
  ruta: string;
  cabeceras?: string[];
  campos: (
    | { nombre: string; valor: string }
    | {
        nombre: string;
        archivo: ArchivoEntrada;
        nombreArchivo?: string;
        contentType?: string;
        prefijoTemporal?: string;
      }
  )[];
  http?: CasoHttp;
}

function campos(entrada: Entrada): CampoMultipart[] {
  return entrada.campos.map((campo): CampoMultipart => {
    if (!('archivo' in campo)) return campo;
    const archivo =
      'base64' in campo.archivo
        ? Buffer.from(campo.archivo.base64, 'base64')
        : Buffer.from(campo.archivo.texto, 'utf8');
    // Con prefijoTemporal el PHP usa el nombre de un temporal; el caso lo normaliza.
    const nombreArchivo =
      campo.prefijoTemporal === undefined
        ? (campo.nombreArchivo ?? '')
        : `${campo.prefijoTemporal}temporal.xml`;
    return {
      nombre: campo.nombre,
      archivo,
      nombreArchivo,
      ...(campo.contentType === undefined ? {} : { contentType: campo.contentType }),
    };
  });
}

describe('paridad: multipart como cURL + CURLFile', () => {
  const captura = usarServidorCaptura();
  const lista = casos<Entrada>('httpMultipart');

  it('hay casos', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  for (const caso of lista) {
    it(caso.nombre, async () => {
      const { entrada } = caso;
      const { peticiones } = await captura.ejecutar(
        entrada.http,
        async ({ origenes, transporte }) => {
          const multipart = armarMultipart(campos(entrada));
          await transporte.enviar({
            metodo: 'POST',
            url: `${origenes[entrada.origen ?? 'https']}${entrada.ruta}`,
            cabeceras: cabecerasComoCurl(entrada.cabeceras),
            cuerpo: { tipo: 'crudo', datos: multipart.datos, contentType: multipart.contentType },
            // Como el cURL del core: sin CURLOPT_ENCODING, una conexión por petición.
            descomprimir: false,
            conexionNueva: true,
          });
        },
      );
      exigirIdentico(peticiones, esperado(caso.nombre).bytes, caso.nombre);
    });
  }
});
