// Paridad de la declaración de cumplimiento (fase 6) contra
// paridad/php/operaciones/declaracion.php: DeclaracionBoletas con el servidor de
// captura (PLAN §5.3). www4.sii.cl va al origen `https`, por un transporte que solo
// cambia el destino. Se comparan las peticiones (cuerpos GWT-RPC, cabeceras, la
// query de DownloadFileServlet) y el resultado.
//
// La fecha de hoy de declarar() en el PHP sale de la hora real: esos casos usan
// `normalizar.fechasGwt` (el servidor la marca como `<fecha>`), y aquí el reloj
// queda fijo en cualquier día.
//
// Las respuestas son las sintéticas de paridad/declaracion/armar-casos.mjs.

import { describe, expect, it } from 'vitest';
import {
  DeclaracionInciertaError,
  ErrorPostulacion,
  SesionCaducaError,
  SetSinDescargarError,
} from '../../src/comun/errores.ts';
import type { RespuestaHttp } from '../../src/comun/http/respuesta.ts';
import type { PeticionHttp, TransporteHttp } from '../../src/comun/http/transporte.ts';
import { relojFijo } from '../../src/comun/reloj.ts';
import { type CookieSii, SesionSii } from '../../src/folios/sesion-sii.ts';
import {
  DatosDeclaracion,
  type EntradaDeclaracion,
} from '../../src/postulacion/datos-postulacion.ts';
import { DeclaracionBoletas } from '../../src/postulacion/declaracion-boletas.ts';
import type { EstadoDeclaracion } from '../../src/postulacion/estado-declaracion.ts';
import { type CasoHttp, usarServidorCaptura } from '../soporte/captura.ts';
import { casos, esperado, exigirIdentico } from '../soporte/paridad.ts';

interface EntradaHttp {
  accion:
    | 'estado'
    | 'declarar'
    | 'solicitarRevisionSet'
    | 'descargarSetPruebas'
    | 'verificarPortal';
  sesion?: Partial<CookieSii>[];
  rutEmpresa?: string;
  datos?: EntradaDeclaracion;
  trackId?: string;
  correoProveedor?: string;
  esperaError?: boolean;
  http?: CasoHttp;
}

/** Manda cada petición al origen de captura de su host, con la misma ruta y query. */
class TransporteHaciaCaptura implements TransporteHttp {
  constructor(
    private readonly real: TransporteHttp,
    private readonly origenes: Readonly<Record<string, string>>,
  ) {}

  enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    const url = new URL(peticion.url);
    const origen = this.origenes[url.hostname];
    if (origen === undefined)
      throw new Error(`El caso pidió un host sin origen de captura: ${url.hostname}`);
    return this.real.enviar({ ...peticion, url: `${origen}${url.pathname}${url.search}` });
  }
}

/** Categoría del error, como `declaracionCategoria()` del PHP. */
function categoria(error: unknown): string {
  if (error instanceof DeclaracionInciertaError) return 'incierta';
  if (error instanceof SetSinDescargarError) return 'set-sin-descargar';
  if (error instanceof SesionCaducaError) return 'sesion-caduca';
  if (error instanceof ErrorPostulacion) {
    const m = /\(respuesta: (.*)\)\. Intenta más tarde\.$/s.exec(error.message);
    return `postulacion${m === null ? '' : ` [respuesta=${m[1]}]`}`;
  }
  throw error;
}

function estado(e: EstadoDeclaracion): string {
  return JSON.stringify({
    empresa: e.empresa.toString(),
    codigo: e.codigo,
    glosa: e.glosa,
    paso: e.paso,
    porDeclarar: e.porDeclarar(),
    autorizada: e.autorizada(),
  });
}

describe('paridad: declaración de cumplimiento en el cable (DeclaracionBoletas)', () => {
  const captura = usarServidorCaptura();
  const lista = casos<EntradaHttp>('httpDeclaracion');

  it('hay casos', () => {
    expect(lista.length).toBeGreaterThan(0);
  });

  for (const caso of lista) {
    it(caso.nombre, async () => {
      const { entrada } = caso;
      const { peticiones, resultado } = await captura.ejecutar(
        entrada.http,
        async ({ origenes, transporte }) => {
          const declaracion = new DeclaracionBoletas({
            transporte: new TransporteHaciaCaptura(transporte, { 'www4.sii.cl': origenes.https }),
            reloj: relojFijo('2026-11-07T15:00:00Z'),
          });
          const sesion = SesionSii.desdeArreglo(entrada.sesion ?? []);
          const rut = entrada.rutEmpresa ?? '';
          try {
            let salida: string;
            switch (entrada.accion) {
              case 'estado':
                salida = `ok ${estado(await declaracion.estado(sesion, rut))}`;
                break;
              case 'declarar':
                salida = `ok ${estado(
                  await declaracion.declarar(
                    sesion,
                    new DatosDeclaracion(entrada.datos as EntradaDeclaracion),
                  ),
                )}`;
                break;
              case 'solicitarRevisionSet':
                await declaracion.solicitarRevisionSet(sesion, rut, entrada.trackId ?? '');
                salida = 'ok';
                break;
              case 'descargarSetPruebas':
                salida = `ok ${JSON.stringify(
                  await declaracion.descargarSetPruebas(sesion, rut, entrada.correoProveedor ?? ''),
                )}`;
                break;
              case 'verificarPortal':
                salida = `ok ${JSON.stringify(await declaracion.verificarPortal())}`;
                break;
            }
            if (entrada.esperaError === true)
              throw new Error('Se esperaba que el cliente lanzara.');
            return salida;
          } catch (error) {
            if (entrada.esperaError !== true) throw error;
            return `error ${categoria(error)}`;
          }
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
