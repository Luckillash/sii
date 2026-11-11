// `sii produccion consultar <trackId>`: estado de un envío de boletas por la API REST.
// Reemplaza bin/produccion/consultar-envio.php. Solo lectura.

import type { Ambiente, EstadoEnvioRest } from '@winex/certificacion';
import { cargarCertificado, leerVariables, rut } from '../../config.ts';
import type { Contexto } from '../../contexto.ts';
import { CODIGOS, ErrorUso } from '../../errores.ts';
import {
  type DefinicionComando,
  type EntradaComando,
  opcionAmbiente,
  opcionBooleana,
} from '../tipos.ts';
import { clienteRest, glosaEstado, hostsRest, nombreAmbiente, sufijoAmbiente } from './rest.ts';

const AYUDA = `Uso: sii produccion consultar <trackId> [--ambiente produccion|certificacion] [--json]

Consulta el estado de un envío de boletas hecho por la API REST (el trackId lo
imprime \`sii produccion emitir --confirmar\`). Solo lectura: no envía documentos.

Opciones:
  --ambiente <amb>   produccion (por defecto: api.sii.cl) o certificacion (apicert.sii.cl).
  --json             Imprime el JSON completo que devolvió el SII, en vez del resumen.

Variables del .env:
  SII_CERT_PATH, SII_CERT_PASS   certificado para pedir el token
  SII_RUT_EMPRESA                empresa dueña del envío
  SII_CACHE_TOKENS (opcional)    caché de tokens entre ejecuciones

Qué sale al SII:
  GET semilla y POST token (si no hay token vigente en SII_CACHE_TOKENS) y
  GET boleta.electronica.envio/<rut>-<dv>-<trackId>.

Archivos que escribe: ninguno (salvo el caché de SII_CACHE_TOKENS, si está configurado).`;

export const comando: DefinicionComando = {
  grupo: 'produccion',
  nombre: 'consultar',
  resumen: 'Consulta el estado de un envío REST',
  ayuda: AYUDA,
  opciones: {
    ambiente: { type: 'string' },
    json: { type: 'boolean' },
  },
  posicionales: { min: 1, max: 1 },
  ejecutar: consultar,
};

async function consultar(ctx: Contexto, entrada: EntradaComando) {
  const ambiente = opcionAmbiente(entrada, 'produccion');
  const trackId = (entrada.posicionales[0] ?? '').trim();
  if (!/^[0-9]+$/.test(trackId)) {
    throw new ErrorUso(`TrackID inválido: "${trackId}". Debe ser numérico.`);
  }
  const json = opcionBooleana(entrada, 'json');

  const config = entrada.config();
  const { SII_RUT_EMPRESA: rutEmpresa } = leerVariables(config, { SII_RUT_EMPRESA: rut });
  const certificado = await cargarCertificado(config);
  const rest = clienteRest(ctx, config, certificado, ambiente);

  const token = await rest.token(rutEmpresa);
  const estado = await rest.cliente.consultarEnvio(token, rutEmpresa, trackId);

  if (json) {
    // Como el JSON_PRETTY_PRINT del PHP (4 espacios), sin escapar "/" ni los no ASCII.
    ctx.imprimir(JSON.stringify(estado.json, null, 4));
    return CODIGOS.OK;
  }
  imprimirResumen(ctx, estado, ambiente);
  return CODIGOS.OK;
}

function imprimirResumen(ctx: Contexto, e: EstadoEnvioRest, ambiente: Ambiente): void {
  const glosa = glosaEstado(e.estado);
  ctx.imprimir(`Envío ${e.trackId} (${nombreAmbiente(ambiente)}, ${hostsRest(ambiente).auth}):`);
  ctx.imprimir(`  Estado:      ${e.estado}${glosa === undefined ? '' : ` (${glosa})`}`);
  if (e.fechaRecepcion !== '') ctx.imprimir(`  Recibido:    ${e.fechaRecepcion}`);
  if (e.rutEmisor !== '') ctx.imprimir(`  Emisor:      ${e.rutEmisor}`);
  if (e.rutEnvia !== '') ctx.imprimir(`  Envía:       ${e.rutEnvia}`);
  ctx.imprimir(
    `  Documentos:  informados ${e.informados} · aceptados ${e.aceptados} · ` +
      `rechazados ${e.rechazados} · reparos ${e.reparos}`,
  );
  if (e.estadistica.length > 1) {
    for (const t of e.estadistica) {
      ctx.imprimir(
        `    tipo ${t.tipo}: informados ${t.informados} · aceptados ${t.aceptados} · ` +
          `rechazados ${t.rechazados} · reparos ${t.reparos}`,
      );
    }
  }
  if (e.detalleRepRech.length > 0) {
    ctx.imprimir('  Rechazos y reparos:');
    for (const d of e.detalleRepRech) {
      ctx.imprimir(
        `    Tipo ${d.tipo} folio ${d.folio}: ${d.estado}${d.descripcion === '' ? '' : ` (${d.descripcion})`}`,
      );
      for (const err of d.errores) {
        const donde = [
          err.seccion !== '' ? `sección ${err.seccion}` : '',
          err.linea !== null ? `línea ${err.linea}` : '',
        ]
          .filter((x) => x !== '')
          .join(', ');
        ctx.imprimir(
          `      - ${err.codigo === null ? '' : `[${err.codigo}] `}${err.descripcion}` +
            `${err.detalle === '' ? '' : `: ${err.detalle}`}${donde === '' ? '' : ` (${donde})`}`,
        );
      }
    }
  }
  ctx.imprimir('');
  if (e.enProceso()) {
    ctx.imprimir(
      `El SII todavía está validando el envío: vuelve a consultar en unos minutos con ` +
        `\`sii produccion consultar ${e.trackId}${sufijoAmbiente(ambiente)}\`.`,
    );
  } else if (e.limpio()) {
    ctx.imprimir('Procesado: todos los documentos aceptados, sin rechazos ni reparos.');
  } else if (e.procesado()) {
    ctx.imprimir('Procesado con rechazos o reparos: revisa el detalle.');
  } else {
    ctx.imprimir(`El SII no aceptó el envío (estado ${e.estado}).`);
  }
}
