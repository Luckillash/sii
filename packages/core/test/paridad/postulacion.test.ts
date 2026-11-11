// Paridad de la fase 6 (postulación) contra paridad/php/operaciones/postulacion.php:
//
// - formPostulacion: formularioPostulacion() (la regla de NavegadorSii::form(), que
//   no es la de folios) contra el PHP.
// - textoPostulacion: textoPostulacion() (strip_tags, html_entity_decode HTML5,
//   `\s` con /u, mb_substr), stripTagsPhp(), decodificarEntidadesHtml5(), los
//   marcadores con mb_stripos y el aviso, contra el PHP.
// - httpPostulacion: PostulacionSii con el servidor de captura (PLAN §5.3): el login
//   (herculesr.sii.cl) va al origen `https` y maullin a `https2`, por un transporte
//   que solo cambia el destino. Se comparan las peticiones y el resultado.
//
// Las páginas son las sintéticas de paridad/postulacion/paginas/ (armar-casos.mjs).

import { describe, expect, it } from 'vitest';
import { decodificarEntidadesHtml5 } from '../../src/comun/entidades-html5.ts';
import { ErrorPostulacion, SesionCaducaError } from '../../src/comun/errores.ts';
import type { RespuestaHttp } from '../../src/comun/http/respuesta.ts';
import type { PeticionHttp, TransporteHttp } from '../../src/comun/http/transporte.ts';
import { relojFijo } from '../../src/comun/reloj.ts';
import { Certificado } from '../../src/core/certificado.ts';
import { type CookieSii, SesionSii } from '../../src/folios/sesion-sii.ts';
import {
  DatosPostulacion,
  type EntradaPostulacion,
} from '../../src/postulacion/datos-postulacion.ts';
import {
  contieneSinMayusculas,
  ESPACIO_PCRE_UNICODE,
  formularioPostulacion,
  stripTagsPhp,
  textoPostulacion,
} from '../../src/postulacion/navegador-sii.ts';
import { PostulacionSii } from '../../src/postulacion/postulacion-sii.ts';
import { type CasoHttp, usarServidorCaptura } from '../soporte/captura.ts';
import { casos, esperado, exigirIdentico, leerMaterial } from '../soporte/paridad.ts';

const linea = (valor: unknown): string => `${JSON.stringify(valor)}\n`;

describe('paridad: formularios HTML de la postulación (NavegadorSii::form)', () => {
  for (const caso of casos<{ paginas: string[] }>('formPostulacion')) {
    it(caso.nombre, () => {
      const salida = caso.entrada.paginas
        .map((html) => {
          const form = formularioPostulacion(html);
          return linea(
            form === null ? { sinForm: true } : { action: form.action, inputs: [...form.inputs] },
          );
        })
        .join('');
      exigirIdentico(Buffer.from(salida, 'utf8'), esperado(caso.nombre).bytes, caso.nombre);
    });
  }
});

/** Los MARCADORES_ERROR de PostulacionSii y el texto de éxito, en el orden del PHP. */
const MARCADORES = [
  'El código de este mensaje es',
  'no está autorizado',
  'no es representante',
  'No ha sido posible completar su solicitud',
  'Usted no tiene',
  'ha sido aceptada',
];

/** `PostulacionSii::aviso()` (privado en los dos lados): se reproduce con lo público. */
function aviso(html: string): string {
  const texto = textoPostulacion(html, 2000);
  const m = new RegExp(
    `Sr\\. Contribuyente:${ESPACIO_PCRE_UNICODE}*([^\\n]+?)(?:Continuar|Salir|$)`,
    'u',
  ).exec(texto);
  if (m !== null) return (m[1] as string).replace(/^[ \t\n\r\0\v]+|[ \t\n\r\0\v]+$/g, '');
  return [...texto].slice(0, 400).join('');
}

describe('paridad: texto de las páginas (NavegadorSii::texto)', () => {
  for (const caso of casos<{ textos: string[]; max?: number }>('textoPostulacion')) {
    it(caso.nombre, () => {
      const salida = caso.entrada.textos
        .map((html) => {
          const completo = textoPostulacion(html, Number.POSITIVE_INFINITY);
          return linea({
            texto: completo,
            recortado: textoPostulacion(html, caso.entrada.max ?? 300),
            stripTags: stripTagsPhp(html),
            entidades: decodificarEntidadesHtml5(html),
            marcadores: MARCADORES.filter((m) => contieneSinMayusculas(completo, m)),
            aviso: aviso(html),
          });
        })
        .join('');
      exigirIdentico(Buffer.from(salida, 'utf8'), esperado(caso.nombre).bytes, caso.nombre);
    });
  }
});

interface EntradaHttp {
  accion: 'postular' | 'completo';
  archivo?: string;
  clave?: string;
  sesion?: Partial<CookieSii>[];
  datos: EntradaPostulacion;
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

function categoria(error: unknown): string {
  if (error instanceof SesionCaducaError) return 'sesion-caduca';
  if (error instanceof ErrorPostulacion) {
    const m = /trae (\w+)=(.*), distinto de lo enviado/s.exec(error.message);
    return `postulacion${m === null ? '' : ` [${m[1]}=${m[2]}]`}`;
  }
  throw error;
}

describe('paridad: postulación en el cable (PostulacionSii)', () => {
  const captura = usarServidorCaptura();
  const lista = casos<EntradaHttp>('httpPostulacion');

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
          const postulacion = new PostulacionSii({
            transporte: new TransporteHaciaCaptura(transporte, {
              'herculesr.sii.cl': origenes.https,
              'maullin.sii.cl': origenes.https2,
            }),
            reloj: relojFijo('2026-11-07T15:00:00Z'),
          });
          try {
            const datos = new DatosPostulacion(entrada.datos);
            const sesion =
              entrada.accion === 'postular'
                ? SesionSii.desdeArreglo(entrada.sesion ?? [])
                : await postulacion.autenticar(certificado as Certificado);
            const r = await postulacion.postular(sesion, datos);
            if (entrada.esperaError === true)
              throw new Error('Se esperaba que el cliente lanzara.');
            return (
              `ok ${JSON.stringify({ empresa: r.empresa.toString(), avisos: r.avisos, mensaje: r.mensaje })}\n` +
              `cookies ${JSON.stringify(sesion.aArreglo())}`
            );
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
