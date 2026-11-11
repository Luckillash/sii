// `sii certificacion estado-envio <trackId...>`: estado de envíos en certificación,
// por SOAP (QueryEstUp en maullin) y por REST (boleta.electronica.envio en apicert).
// Reemplaza al `estado` de scripts/validar-certificacion.ts.
//
// Un trackId de DTEUpload no se ve por REST y viceversa: con `--canal ambos` (por
// defecto) un canal que falla se informa y se sigue con el otro.

import type { EstadoEnvio, EstadoEnvioRest } from '@winex/certificacion';
import { cargarCertificado, configEmpresa, configTokenStore } from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import { type CodigoSalida, codigoDeError, describirError, ErrorUso } from '../../errores.ts';
import {
  type DefinicionComando,
  type EntradaComando,
  opcionBooleana,
  opcionEnum,
} from '../tipos.ts';
import { clienteDtews, clienteRest } from './comun-envio.ts';

const MAX_TRACKIDS = 20;

const AYUDA = `Uso: sii certificacion estado-envio <trackId> [<trackId> ...] [opciones]

Consulta el estado de 1 a ${MAX_TRACKIDS} envíos (TrackID, solo dígitos) en el SII de
certificación. Solo lectura: se puede repetir.

Opciones:
  --canal soap|rest|ambos  soap: QueryEstUp (maullin), para lo subido por DTEUpload.
                           rest: API REST (apicert), para lo subido por REST.
                           ambos (por defecto): los dos. Un trackId de DTEUpload no se
                           ve por REST y viceversa: si un canal falla se informa y se
                           sigue con el otro.
  --json                   Salida en JSON (ver abajo) en vez de texto.

Variables del .env: SII_CERT_PATH, SII_CERT_PASS, SII_RUT_EMPRESA, SII_RUT_FIRMA y,
opcional, SII_CACHE_TOKENS.

Qué sale al SII: un pedido de token por canal y una consulta por trackId y canal.
No escribe archivos.

Código de salida: 0 si por cada trackId respondió al menos un canal (aunque el
envío esté rechazado: mira el estado); si no, el del primer error de ese trackId
(4 red/HTTP, 5 el SII respondió con un error...).

Formato de --json (un solo objeto en la salida estándar):
  { "ambiente": "certificacion",
    "envios": [
      { "trackId": "123", "ok": true,
        "soap": { "ok": true, "estado": "EPR", "glosa": "Envio Procesado",
                  "informados": 5, "aceptados": 5, "rechazados": 0, "reparos": 0,
                  "enProceso": false, "procesado": true, "limpio": true },
        "rest": { "ok": false, "error": "ErrorTransporte: ...", "codigo": 4 } } ] }
  "ok" del envío es true si respondió al menos un canal. Un canal que no se consultó
  no aparece. La respuesta REST trae además "fechaRecepcion", "estadistica"
  [{ tipo, informados, aceptados, rechazados, reparos }] y "detalle"
  [{ tipo, folio, estado, descripcion, errores: [{ seccion, linea, nivel, codigo,
  descripcion, detalle }] }].`;

export const comando: DefinicionComando = {
  grupo: 'certificacion',
  nombre: 'estado-envio',
  resumen: 'Consulta el estado de envíos por trackId',
  ayuda: AYUDA,
  opciones: {
    canal: { type: 'string' },
    json: { type: 'boolean' },
  },
  posicionales: { min: 1, max: MAX_TRACKIDS },
  ejecutar,
};

type Canal = 'soap' | 'rest';

interface Fallo {
  readonly ok: false;
  readonly error: string;
  readonly codigo: CodigoSalida;
}

type ResultadoSoap = ({ readonly ok: true } & ReturnType<typeof datosSoap>) | Fallo;
type ResultadoRest = ({ readonly ok: true } & ReturnType<typeof datosRest>) | Fallo;

interface Consulta {
  readonly trackId: string;
  readonly ok: boolean;
  readonly soap?: ResultadoSoap;
  readonly rest?: ResultadoRest;
}

async function ejecutar(ctx: Contexto, entrada: EntradaComando) {
  const trackIds = entrada.posicionales;
  for (const t of trackIds) {
    if (!/^[0-9]+$/.test(t))
      throw new ErrorUso(`TrackID inválido: ${t.slice(0, 40)} (solo dígitos).`);
  }
  const canal = opcionEnum(entrada, 'canal', ['soap', 'rest', 'ambos'] as const, 'ambos');
  const json = opcionBooleana(entrada, 'json');
  const canales: readonly Canal[] = canal === 'ambos' ? ['soap', 'rest'] : [canal];

  const config = entrada.config();
  const { rutEmpresa } = configEmpresa(config);
  const tokenStore = configTokenStore(config);
  const certificado = await cargarCertificado(config);

  const soap = canales.includes('soap')
    ? clienteDtews(ctx, certificado, 'certificacion', tokenStore)
    : undefined;
  const rest = canales.includes('rest')
    ? clienteRest(ctx, certificado, 'certificacion', tokenStore)
    : undefined;
  // Un token por canal para toda la ejecución. Si falla, el mismo error vale para
  // todos los trackId de ese canal (no se vuelve a pedir).
  let tokenSoap: Promise<string> | undefined;
  let tokenRest: Promise<string> | undefined;

  const consultas: Consulta[] = [];
  for (const trackId of trackIds) {
    if (!json) ctx.imprimir(`TrackID ${trackId}`);
    let resultadoSoap: ResultadoSoap | undefined;
    let resultadoRest: ResultadoRest | undefined;
    if (soap !== undefined) {
      try {
        tokenSoap ??= soap.obtenerToken(rutEmpresa);
        const e = await soap.estadoEnvio(await tokenSoap, rutEmpresa, trackId);
        resultadoSoap = { ok: true, ...datosSoap(e) };
        if (!json) ctx.imprimir(`  SOAP: ${e.resumen()}${pista(e)}`);
      } catch (error) {
        resultadoSoap = fallo(error);
        if (!json) ctx.imprimir(`  SOAP: sin respuesta (${resultadoSoap.error})`);
      }
    }
    if (rest !== undefined) {
      try {
        tokenRest ??= rest.obtenerToken(rutEmpresa);
        const e = await rest.consultarEnvio(await tokenRest, rutEmpresa, trackId);
        resultadoRest = { ok: true, ...datosRest(e) };
        if (!json) imprimirRest(ctx, e);
      } catch (error) {
        resultadoRest = fallo(error);
        if (!json) ctx.imprimir(`  REST: sin respuesta (${resultadoRest.error})`);
      }
    }
    consultas.push({
      trackId,
      ok: resultadoSoap?.ok === true || resultadoRest?.ok === true,
      ...(resultadoSoap !== undefined ? { soap: resultadoSoap } : {}),
      ...(resultadoRest !== undefined ? { rest: resultadoRest } : {}),
    });
  }

  if (json) {
    ctx.imprimir(JSON.stringify({ ambiente: 'certificacion', envios: consultas }, null, 2));
  } else if (canales.length === 2 && consultas.some((c) => c.ok && (!c.soap?.ok || !c.rest?.ok))) {
    ctx.imprimir(
      'Nota: un trackId de DTEUpload no se ve por REST y viceversa; basta con que responda un canal.',
    );
  }

  const sinRespuesta = consultas.find((c) => !c.ok);
  if (sinRespuesta === undefined) return undefined;
  const primerFallo = [sinRespuesta.soap, sinRespuesta.rest].find(
    (r): r is Fallo => r !== undefined && !r.ok,
  );
  ctx.imprimirError(
    `[ERROR] Ningún canal respondió por el TrackID ${sinRespuesta.trackId}` +
      (primerFallo !== undefined ? `: ${primerFallo.error}` : '.'),
  );
  return primerFallo?.codigo;
}

function fallo(error: unknown): Fallo {
  return { ok: false, error: describirError(error), codigo: codigoDeError(error) };
}

function datosSoap(e: EstadoEnvio) {
  return {
    estado: e.estado,
    glosa: e.glosa,
    informados: e.informados,
    aceptados: e.aceptados,
    rechazados: e.rechazados,
    reparos: e.reparos,
    enProceso: e.enProceso(),
    procesado: e.procesado(),
    limpio: e.limpio(),
  };
}

function datosRest(e: EstadoEnvioRest) {
  return {
    estado: e.estado,
    fechaRecepcion: e.fechaRecepcion,
    informados: e.informados,
    aceptados: e.aceptados,
    rechazados: e.rechazados,
    reparos: e.reparos,
    enProceso: e.enProceso(),
    procesado: e.procesado(),
    limpio: e.limpio(),
    estadistica: e.estadistica,
    detalle: e.detalleRepRech,
  };
}

function pista(e: EstadoEnvio | EstadoEnvioRest): string {
  if (e.enProceso()) return ' (en proceso: vuelve a consultar en unos minutos)';
  // QueryEstUp responde -11 sin glosa en dos casos (docs/validaciones.md, fases 4 y 7):
  // un envío recién subido que todavía no registra, o un trackId de la API REST.
  if (e.estado === '-11') {
    return (
      ' (el SII no tiene este envío por DTEUpload: si se subió por REST, mira la línea REST;' +
      ' si se acaba de subir por DTEUpload, vuelve a consultar en unos minutos)'
    );
  }
  return '';
}

function imprimirRest(ctx: Contexto, e: EstadoEnvioRest): void {
  ctx.imprimir(
    `  REST: ${e.estado} | informados ${e.informados}, aceptados ${e.aceptados}, ` +
      `rechazados ${e.rechazados}, reparos ${e.reparos}${pista(e)}`,
  );
  for (const d of e.detalleRepRech) {
    ctx.imprimir(`    folio ${d.folio} (tipo ${d.tipo}): ${d.estado} ${d.descripcion}`.trimEnd());
    for (const err of d.errores) {
      const codigo = err.codigo === null ? '' : `[${err.codigo}] `;
      const detalle = err.detalle === '' ? '' : `: ${err.detalle}`;
      ctx.imprimir(`      ${codigo}${err.descripcion}${detalle}`);
    }
  }
}
