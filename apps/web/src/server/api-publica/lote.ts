import 'server-only';
import {
  CODIGOS_ERROR,
  claveItemLote,
  type DocumentoApi,
  type ResultadoItemLoteApi,
  type ResultadoLoteApi,
} from '@/lib/api-publica';
import type { Json } from '../supabase/tipos';
import { emitirConIdempotencia, type SalidaEmision } from './documentos';
import { exigirActiva, resolverEmpresa } from './empresas';
import {
  aBorrador,
  type EmisionApi,
  esquemaEmisionApi,
  esquemaLoteApi,
  leerCuerpoJson,
  validar,
} from './esquemas';
import { exigirClaveIdempotencia, huella } from './idempotencia';
import type { ContextoApi } from './manejar';
import { cuerpoError, ErrorApi, esErrorApi, respuestaJson, respuestaRepetida } from './respuestas';

// `POST /documentos/lote` (PLAN-SAAS Fase 11, decisión 13 del diseño): hasta 25 boletas
// como N EMISIONES INDEPENDIENTES (cada una con su envío al SII), en orden y de a una. La
// agrupación de varias boletas en un mismo EnvioBOLETA queda para después: en ese camino
// un 4xx anularía N folios y un incierto bloquearía N boletas a la vez.
//
//   - Todas las boletas se validan ANTES de emitir: si una falla, 422 con los campos de
//     cada una (`documentos.3.lineas.0.precio`) y no se emite ninguna.
//   - El lote reclama su `Idempotency-Key` (recurso `lote`, con la huella de todo el
//     lote); cada boleta usa `<clave>#<n>` (n desde 1) como su propia clave, con las mismas
//     reglas que `POST /documentos`.
//   - Presupuesto de tiempo: no se empieza una boleta después de `PRESUPUESTO_LOTE_MS`
//     (una emisión puede tardar hasta 60 s y la ruta tiene 300). Las que no alcanzan quedan
//     `pendiente` (`status: null`): se repite el lote con la MISMA clave y las ya emitidas
//     vuelven repetidas (`repetida: true`) sin duplicarse.
//   - El resultado del lote solo se guarda cuando todas sus boletas tienen documento; si no,
//     la clave se suelta para poder repetirlo.

export const PRESUPUESTO_LOTE_MS = 200_000;
/** Arriendo de la clave del lote: más que `maxDuration` (300 s) de la ruta. */
export const ARRIENDO_LOTE_S = 330;

interface ItemValidado {
  entrada: EmisionApi;
  empresaId: string;
  huella: string;
}

async function validarItems(ctx: ContextoApi, documentos: unknown[]): Promise<ItemValidado[]> {
  const campos: Record<string, string> = {};
  const items: ItemValidado[] = [];
  for (const [i, doc] of documentos.entries()) {
    const prefijo = `documentos.${i}`;
    try {
      const entrada = validar(esquemaEmisionApi, doc, prefijo);
      const borrador = aBorrador(entrada, ctx.clave.ambiente, prefijo);
      const empresa = await resolverEmpresa(ctx.deps.repo, ctx.clave, entrada.empresa, {
        requerida: true,
      });
      exigirActiva(empresa);
      items.push({
        entrada,
        empresaId: empresa.id,
        huella: huella({ recurso: 'documento', empresa_id: empresa.id, borrador }),
      });
    } catch (error) {
      if (!esErrorApi(error)) throw error;
      if (error.opciones.campos) Object.assign(campos, error.opciones.campos);
      else campos[prefijo] = error.message;
    }
  }
  if (Object.keys(campos).length > 0) throw new ErrorApi('datos_invalidos', { campos });
  return items;
}

function resultadoDe(indice: number, clave: string, salida: SalidaEmision): ResultadoItemLoteApi {
  const base = {
    indice,
    clave_idempotencia: clave,
    status: salida.status,
    repetida: salida.repetida,
  };
  const cuerpo = salida.cuerpo as Record<string, unknown> | null;
  if (cuerpo && typeof cuerpo === 'object' && 'error' in cuerpo) {
    const error = cuerpo.error as ResultadoItemLoteApi['error'];
    return { ...base, ...(error ? { error } : {}) };
  }
  return { ...base, documento: cuerpo as unknown as DocumentoApi };
}

export async function manejarLote(ctx: ContextoApi): Promise<Response> {
  const { clave, deps } = ctx;
  const inicio = deps.reloj().getTime();
  const cuerpo = await leerCuerpoJson(ctx.request);
  const { documentos } = validar(esquemaLoteApi, cuerpo);
  const claveLote = exigirClaveIdempotencia(ctx.request.headers);
  const items = await validarItems(ctx, documentos);

  const reclamo = await deps.repo.reclamarIdempotencia({
    organizacionId: clave.organizacionId,
    clave: claveLote,
    recurso: 'lote',
    huella: huella({ recurso: 'lote', items: items.map((i) => i.huella) }),
    apiKeyId: clave.apiKeyId,
    arriendoSegundos: ARRIENDO_LOTE_S,
  });
  if (reclamo.resultado === 'conflicto') throw new ErrorApi('idempotencia_conflicto');
  if (reclamo.resultado === 'en_curso') {
    throw new ErrorApi('idempotencia_en_curso', { cabeceras: { 'Retry-After': '30' } });
  }
  if (reclamo.resultado === 'terminada') {
    return respuestaRepetida(reclamo.respuesta, reclamo.statusHttp ?? 200);
  }

  let guardado = false;
  try {
    const resultados: ResultadoItemLoteApi[] = [];
    for (const [i, item] of items.entries()) {
      const claveItem = claveItemLote(claveLote, i);
      if (deps.reloj().getTime() - inicio > PRESUPUESTO_LOTE_MS) {
        resultados.push({
          indice: i,
          clave_idempotencia: claveItem,
          status: null,
          repetida: false,
        });
        continue;
      }
      try {
        const salida = await emitirConIdempotencia(ctx, {
          entrada: item.entrada,
          claveIdempotencia: claveItem,
          prefijo: `documentos.${i}`,
        });
        resultados.push(resultadoDe(i, claveItem, salida));
      } catch (error) {
        if (!esErrorApi(error)) {
          deps.capturar(error, { api_publica_ruta: 'POST /documentos/lote' });
        } else if (error.codigo === 'error_interno') {
          deps.capturar(error, {
            api_publica_ruta: 'POST /documentos/lote',
            ...Object.fromEntries(
              Object.entries(error.opciones.diagnostico ?? {}).map(([k, v]) => [
                `api_publica_${k}`,
                v.slice(0, 64),
              ]),
            ),
          });
        }
        const codigo = esErrorApi(error) ? error.codigo : 'error_interno';
        resultados.push({
          indice: i,
          clave_idempotencia: claveItem,
          status: CODIGOS_ERROR[codigo],
          repetida: false,
          error: cuerpoError(codigo, esErrorApi(error) ? error.opciones : {}).error,
        });
      }
    }
    const pendientes = resultados.filter((r) => r.status === null).length;
    const respuesta: ResultadoLoteApi = {
      objeto: 'lote',
      resultados,
      procesados: resultados.length - pendientes,
      pendientes,
    };
    // El lote solo se guarda si TODAS sus boletas quedaron con documento (emitida, incierta
    // o anulada por el SII), que es cuando cada una guardó su propia respuesta. Con una
    // pendiente, en curso o con un error sin documento (sin folios, cuota, SII caído), se
    // repite el lote con la misma clave: las emitidas vuelven repetidas y el resto se
    // reintenta.
    const definitivo =
      pendientes === 0 && resultados.every((r) => r.documento || r.error?.documento);
    if (definitivo) {
      await deps.repo.terminarIdempotencia({
        organizacionId: clave.organizacionId,
        clave: claveLote,
        statusHttp: 200,
        respuesta: respuesta as unknown as Json,
      });
      guardado = true;
    }
    return respuestaJson(respuesta, 200);
  } finally {
    if (!guardado) {
      await deps.repo
        .soltarIdempotencia({ organizacionId: clave.organizacionId, clave: claveLote })
        .catch(() => undefined);
    }
  }
}
