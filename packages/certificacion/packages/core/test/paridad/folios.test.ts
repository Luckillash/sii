// Paridad de la fase 5 (folios) contra paridad/php/operaciones/folios.php:
//
// - formFolios: formularioFolios() (parser HTML estilo libxml, comun/html.ts)
//   contra SolicitudFolios::form() del PHP (DOMDocument::loadHTML).
// - resolverUrl: resolverUrl() (comun/navegacion-sii.ts) contra el del PHP.
// - sesionSii: SesionSii contra la del PHP (cookies, dominios, borrados).
// - httpFolios: SolicitudFolios con el servidor de captura (PLAN Â§5.3): el login
//   (herculesr.sii.cl) va al origen `https` y el asistente (maullin.sii.cl) a
//   `https2`, por un transporte que solo cambia el destino. Se comparan las
//   peticiones (incluido el certificado TLS del login) y el resultado.
//
// Diferencias deliberadas, que los casos muestran o normalizan:
// - `accept-encoding` (valor normalizado por el servidor de captura) y
//   `FECHA` (el PHP usa la hora real: campo normalizado en los casos).
// - DIVERGENCIAS: casos donde Node, a propÃ³sito, clasifica distinto el error
//   (las peticiones siguen siendo idÃ©nticas).

import { describe, expect, it } from 'vitest';
import { RespuestaHttp } from '../../src/comun/http/respuesta.ts';
import type { PeticionHttp, TransporteHttp } from '../../src/comun/http/transporte.ts';
import { resolverUrl } from '../../src/comun/navegacion-sii.ts';
import { relojFijo } from '../../src/comun/reloj.ts';
import { Certificado } from '../../src/core/certificado.ts';
import { type CookieSii, SesionSii } from '../../src/folios/sesion-sii.ts';
import { formularioFolios, SolicitudFolios } from '../../src/folios/solicitud-folios.ts';
import { ErrorSolicitudFolios, FoliosSinCafError, SesionCaducaError } from '../../src/index.ts';
import { type CasoHttp, usarServidorCaptura } from '../soporte/captura.ts';
import { casos, esperado, exigirIdentico, leerMaterial } from '../soporte/paridad.ts';

const linea = (valor: unknown): string => `${JSON.stringify(valor)}\n`;

describe('paridad: formularios HTML (SolicitudFolios::form)', () => {
  for (const caso of casos<{ paginas: string[] }>('formFolios')) {
    it(caso.nombre, () => {
      const salida = caso.entrada.paginas
        .map((html) => {
          const form = formularioFolios(html);
          return linea(
            form === null ? { sinForm: true } : { action: form.action, inputs: [...form.inputs] },
          );
        })
        .join('');
      exigirIdentico(Buffer.from(salida, 'utf8'), esperado(caso.nombre).bytes, caso.nombre);
    });
  }
});

describe('paridad: resolverUrl', () => {
  for (const caso of casos<{ pares: [string, string][] }>('resolverUrl')) {
    it(caso.nombre, () => {
      const salida = caso.entrada.pares
        .map(([desde, ref]) => linea([desde, ref, resolverUrl(desde, ref)]))
        .join('');
      exigirIdentico(Buffer.from(salida, 'utf8'), esperado(caso.nombre).bytes, caso.nombre);
    });
  }
});

interface PasoSesion {
  recibir?: string;
  setCookie?: string[];
  html?: string;
  cabeceraPara?: string;
  valor?: string;
}

describe('paridad: SesionSii', () => {
  for (const caso of casos<{ inicial?: Partial<CookieSii>[]; pasos: PasoSesion[] }>('sesionSii')) {
    it(caso.nombre, () => {
      const sesion = SesionSii.desdeArreglo(caso.entrada.inicial ?? []);
      let salida = '';
      for (const paso of caso.entrada.pasos) {
        if (paso.recibir !== undefined) {
          sesion.recibir(
            paso.recibir,
            new RespuestaHttp(200, { 'set-cookie': paso.setCookie ?? [] }),
          );
        } else if (paso.html !== undefined) {
          sesion.recibirDesdeHtml(paso.html);
        } else if (paso.cabeceraPara !== undefined) {
          salida += linea([
            'cabeceraPara',
            paso.cabeceraPara,
            sesion.cabeceraPara(paso.cabeceraPara),
          ]);
        } else if (paso.valor !== undefined) {
          salida += linea(['valor', paso.valor, sesion.valor(paso.valor)]);
        }
      }
      salida += linea(sesion.aArreglo());
      exigirIdentico(Buffer.from(salida, 'utf8'), esperado(caso.nombre).bytes, caso.nombre);
    });
  }
});

interface EntradaHttp {
  accion: 'autenticar' | 'solicitar' | 'completo';
  archivo?: string;
  clave?: string;
  sesion?: Partial<CookieSii>[];
  rutEmpresa?: string;
  tipoDte?: number;
  cantidad?: number;
  esperaError?: boolean;
  http?: CasoHttp;
}

/** Manda cada peticiÃ³n al origen de captura de su host, con la misma ruta y query. */
class TransporteHaciaCaptura implements TransporteHttp {
  constructor(
    private readonly real: TransporteHttp,
    private readonly origenes: Readonly<Record<string, string>>,
  ) {}

  enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    const url = new URL(peticion.url);
    const origen = this.origenes[url.hostname];
    if (origen === undefined)
      throw new Error(`El caso pidiÃ³ un host sin origen de captura: ${url.hostname}`);
    return this.real.enviar({ ...peticion, url: `${origen}${url.pathname}${url.search}` });
  }
}

/**
 * Casos en que Node clasifica el error distinto a propÃ³sito: nombre â†’ [PHP, Node].
 * Las peticiones se comparan igual; solo cambia la lÃ­nea del resultado.
 */
const DIVERGENCIAS: Readonly<Record<string, readonly [string, string]>> = {
  // pend. 1.2: el CAF no cuadra con lo pedido despuÃ©s de timbrar.
  'http-folios-caf-otro-ambiente': ['error solicitud', 'error folios-sin-caf 101-105'],
};

function categoria(error: unknown): string {
  if (error instanceof SesionCaducaError) return 'sesion-caduca';
  if (error instanceof FoliosSinCafError)
    return `folios-sin-caf ${error.folioDesde}-${error.folioHasta}`;
  if (error instanceof ErrorSolicitudFolios) return 'solicitud';
  throw error;
}

describe('paridad: solicitud de folios en el cable (SolicitudFolios)', () => {
  const captura = usarServidorCaptura();
  const lista = casos<EntradaHttp>('httpFolios');

  it('hay casos', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  for (const caso of lista) {
    it(caso.nombre, async () => {
      const { entrada } = caso;
      const certificado =
        entrada.archivo === undefined
          ? undefined
          : Certificado.desdeContenido(leerMaterial(entrada.archivo), entrada.clave ?? '');

      const { peticiones, resultado } = await captura.ejecutar(
        entrada.http,
        async ({ origenes, transporte }) => {
          const folios = new SolicitudFolios({
            ambiente: 'certificacion',
            transporte: new TransporteHaciaCaptura(transporte, {
              'herculesr.sii.cl': origenes.https,
              'maullin.sii.cl': origenes.https2,
            }),
            reloj: relojFijo('2026-11-06T15:00:00Z'),
          });
          try {
            const sesion =
              entrada.accion === 'solicitar'
                ? SesionSii.desdeArreglo(entrada.sesion ?? [])
                : await folios.autenticar(certificado as Certificado);
            let salida = '';
            if (entrada.accion !== 'autenticar') {
              const caf = await folios.solicitar(
                sesion,
                entrada.rutEmpresa ?? '',
                entrada.tipoDte ?? 0,
                entrada.cantidad ?? 0,
              );
              const { createHash } = await import('node:crypto');
              salida += `caf sha256 ${createHash('sha256').update(caf).digest('hex')} (${caf.length} bytes)\n`;
            }
            salida += `cookies ${JSON.stringify(sesion.aArreglo())}`;
            if (entrada.esperaError === true)
              throw new Error('Se esperaba que el cliente lanzara.');
            return salida;
          } catch (error) {
            if (entrada.esperaError !== true) throw error;
            return `error ${categoria(error)}`;
          }
        },
      );

      let bytesEsperados = esperado(caso.nombre).bytes;
      const divergencia = DIVERGENCIAS[caso.nombre];
      if (divergencia !== undefined) {
        const [php, node] = divergencia;
        const texto = bytesEsperados.toString('latin1');
        const marca = `=== resultado ===\n${php}\n`;
        expect(texto.endsWith(marca), `${caso.nombre}: el PHP ya no da "${php}"`).toBe(true);
        bytesEsperados = Buffer.from(
          `${texto.slice(0, -marca.length)}=== resultado ===\n${node}\n`,
          'latin1',
        );
      }
      exigirIdentico(
        Buffer.concat([peticiones, Buffer.from(`=== resultado ===\n${resultado}\n`, 'utf8')]),
        bytesEsperados,
        caso.nombre,
      );
    });
  }
});
