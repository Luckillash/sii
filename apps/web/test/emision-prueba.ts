// Escenario de prueba de la capa de emisión (Fase 7), sobre el de folios: la misma
// organización, empresa y certificado de MENTIRA, plan con producción, la empresa
// autorizada, resoluciones de los dos ambientes, un CAF de prueba (39) por ambiente en el
// «Vault» del Supabase falso y dobles del cliente REST, del PDF y del correo de la boleta.
// Nada sale a la red: el doble REST registra lo que recibe y el `TransporteFalso` del
// escenario de certificación registra cualquier petición que se escape.

import { vi } from 'vitest';
import { type BorradorValido, esquemaBorrador } from '../src/lib/emision';
import type { DatosCorreoBoleta } from '../src/server/correo/boleta';
import type { ResultadoEnvio } from '../src/server/correo/resend';
import type {
  ClienteRestEmision,
  DependenciasEmision,
  OpcionesRestEmision,
} from '../src/server/emision/dependencias';
import type { ContextoEmision } from '../src/server/emision/tipos';
import type { DatosRepresentacion, FormatoPdf } from '../src/server/pdf';
import { cafPrueba } from './caf-prueba';
import { EMPRESA, ORG, RUT_EMPRESA, RUT_TITULAR, TOKEN_SII, USUARIO } from './certificacion-prueba';
import { escenarioFolios, filaCaf } from './folios-prueba';
import type { Fila } from './supabase-falso';

export const CAF_PRODUCCION = 'caf-prod-39';
export const CAF_CERTIFICACION = 'caf-cert-39';
export const RECEPTOR_RUT = '11111111-1';

export interface OpcionesEscenarioEmision {
  autorizada?: boolean;
  plan?: 'con_produccion' | 'sin_produccion' | 'ninguno';
  /** `planes.max_boletas_mes` del plan con producción (por defecto sin límite). */
  maxBoletasMes?: number | null;
  /** Folios del CAF de producción (por defecto 1 a 100, siguiente 1). */
  caf?: { desde?: number; hasta?: number; siguiente?: number };
  /** Sin resolución en ese ambiente. */
  sinResolucion?: 'produccion' | 'certificacion';
  tablas?: Record<string, Fila[]>;
}

export function escenarioEmision(opciones: OpcionesEscenarioEmision = {}) {
  const desde = opciones.caf?.desde ?? 1;
  const hasta = opciones.caf?.hasta ?? 100;
  const prod = cafPrueba({ desde, hasta, idk: 300 });
  const cert = cafPrueba({ desde: 1, hasta: 50, idk: 100 });
  const resoluciones = [
    {
      id: 'res-prod',
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      ambiente: 'produccion',
      numero: 80,
      fecha: '2014-08-22',
      vigente: true,
    },
    {
      id: 'res-cert',
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      ambiente: 'certificacion',
      numero: 0,
      fecha: '2026-11-10',
      vigente: true,
    },
  ].filter((r) => r.ambiente !== opciones.sinResolucion);

  const e = escenarioFolios({
    autorizada: opciones.autorizada ?? true,
    plan: opciones.plan ?? 'con_produccion',
    tablas: {
      planes: [
        {
          id: 'plan-pyme',
          codigo: 'pyme',
          permite_produccion: true,
          max_boletas_mes: opciones.maxBoletasMes ?? null,
        },
        { id: 'plan-cert', codigo: 'certificacion', permite_produccion: false },
      ],
      cafs: [
        filaCaf({
          id: CAF_PRODUCCION,
          folio_desde: desde,
          folio_hasta: hasta,
          siguiente_folio: opciones.caf?.siguiente ?? desde,
        }),
        filaCaf({
          id: CAF_CERTIFICACION,
          ambiente: 'certificacion',
          idk: 100,
          folio_desde: 1,
          folio_hasta: 50,
          siguiente_folio: 1,
        }),
      ],
      resoluciones,
      ...opciones.tablas,
    },
  });
  e.falso.secretos.set(`secreto-${CAF_PRODUCCION}`, prod.xml);
  e.falso.secretos.set(`secreto-${CAF_CERTIFICACION}`, cert.xml);

  const opcionesRest: OpcionesRestEmision[] = [];
  const rest = {
    obtenerToken: vi.fn(async (_rut: unknown) => TOKEN_SII),
    enviarBoleta: vi.fn(async (_t: string, _r: unknown, _e: unknown, _x: Uint8Array) => ({
      trackId: '987654321',
      estado: 'REC',
      fechaRecepcion: '2026-11-13 12:00:00',
      rutEmisor: RUT_EMPRESA,
      rutEnvia: RUT_TITULAR,
      archivo: 'envio.xml',
      json: { trackid: 987654321, estado: 'REC' },
    })),
    olvidarToken: vi.fn(async (_rut: unknown) => {}),
  };
  const pdf = vi.fn(
    async (_d: DatosRepresentacion, formato: FormatoPdf): Promise<Buffer> =>
      Buffer.from(`%PDF-1.7 boleta de prueba ${formato}`, 'latin1'),
  );
  const correoBoleta = vi.fn(
    async (_d: DatosCorreoBoleta): Promise<ResultadoEnvio> => ({ ok: true, id: 'correo-boleta-1' }),
  );

  const deps: Partial<DependenciasEmision> = {
    ...e.deps,
    rest: (_certificado, o) => {
      opcionesRest.push(o);
      return rest as unknown as ClienteRestEmision;
    },
    pdf,
    correoBoleta,
  };
  const ctx: ContextoEmision = { organizacionId: ORG, empresaId: EMPRESA, usuarioId: USUARIO };

  return {
    ...e,
    deps,
    ctx,
    rest,
    opcionesRest,
    pdf,
    correoBoleta,
    rsask: [prod.rsask, cert.rsask],
  };
}

export type EscenarioEmision = ReturnType<typeof escenarioEmision>;

/** Un borrador válido (pasa por `esquemaBorrador`, como lo dejaría el Server Action). */
export function borradorPrueba(cambios: Record<string, unknown> = {}): BorradorValido {
  return esquemaBorrador.parse({
    tipoDte: 39,
    ambiente: 'produccion',
    receptor: { rut: '', razonSocial: null, correo: null },
    lineas: [
      { nombre: 'Café grano 1 kg', cantidad: 2, precio: 11990, exento: false, unidad: 'Kg' },
      { nombre: 'Servicio de despacho', cantidad: 1, precio: 3000, exento: true },
    ],
    descuento: null,
    ...cambios,
  });
}

/** Con receptor identificado y correo (para el catálogo y el envío del PDF). */
export function borradorConReceptor(cambios: Record<string, unknown> = {}): BorradorValido {
  return borradorPrueba({
    receptor: {
      rut: '11.111.111-1',
      razonSocial: 'Cliente Frecuente SpA',
      correo: 'pagos@cliente.cl',
    },
    ...cambios,
  });
}

/** Todo lo que escribieron el cliente de servicio y el de sesión, más operaciones y Sentry. */
export function todoLoEscritoEmision(e: EscenarioEmision): string {
  return JSON.stringify([
    e.falso.escrituras,
    e.sesion.escrituras,
    e.falso.tabla('operaciones_sii'),
    e.registros,
  ]);
}
