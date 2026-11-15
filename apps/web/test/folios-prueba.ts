// Escenario de prueba de la capa de folios (Fase 6), sobre el de la certificación: la misma
// organización, empresa y certificado de MENTIRA, más un plan, la autorización de
// producción a elección y la fábrica de `SolicitudFolios` que guarda sus opciones (para
// ver el ambiente y el transporte que recibió). Nada sale a la red: el doble de
// `SolicitudFolios` es el de `certificacion-prueba.ts`.

import { FoliosSinCafError } from '@winex/certificacion';
import type { OpcionesClienteFolios } from '../src/server/certificacion/dependencias';
import { EMPRESA, escenario, ORG } from './certificacion-prueba';
import type { Fila } from './supabase-falso';

export interface OpcionesEscenarioFolios {
  /** Empresa autorizada en producción (por defecto sí). */
  autorizada?: boolean;
  /** Plan vigente: con producción (por defecto), sin producción o sin suscripción. */
  plan?: 'con_produccion' | 'sin_produccion' | 'ninguno';
  tablas?: Record<string, Fila[]>;
}

export function escenarioFolios(opciones: OpcionesEscenarioFolios = {}) {
  const plan = opciones.plan ?? 'con_produccion';
  const e = escenario({
    proceso: null,
    tablas: {
      planes: [
        { id: 'plan-pyme', codigo: 'pyme', permite_produccion: true },
        { id: 'plan-cert', codigo: 'certificacion', permite_produccion: false },
      ],
      suscripciones:
        plan === 'ninguno'
          ? []
          : [
              {
                id: 'sus-1',
                organizacion_id: ORG,
                plan_id: plan === 'con_produccion' ? 'plan-pyme' : 'plan-cert',
                estado: 'activa',
                creado_en: '2026-11-01T00:00:00Z',
              },
            ],
      ...opciones.tablas,
    },
  });
  const empresa = e.falso.tabla('empresas')[0];
  if (empresa) empresa.autorizada_produccion = opciones.autorizada ?? true;

  const opcionesFolios: OpcionesClienteFolios[] = [];
  const sii = e.deps.sii;
  if (!sii) throw new Error('escenario sin fábricas');
  e.deps.sii = {
    ...sii,
    folios: (o) => {
      opcionesFolios.push(o);
      return e.folios;
    },
  };
  return { ...e, opcionesFolios };
}

export type EscenarioFolios = ReturnType<typeof escenarioFolios>;

/**
 * El doble de `solicitar` se porta como `SolicitudFolios` real ante el transporte de
 * revisión: intenta la orden de timbrar por el transporte que recibió y, si el transporte
 * la corta, lanza `FoliosSinCafError` con el rango y esa causa (como la librería).
 */
export function revisionQueAsigna(e: EscenarioFolios, desde: number, hasta: number) {
  e.folios.solicitar.mockImplementationOnce(async () => {
    const transporte = e.opcionesFolios.at(-1)?.transporte;
    if (!transporte) throw new Error('sin transporte');
    const host = e.opcionesFolios.at(-1)?.ambiente === 'produccion' ? 'palena' : 'maullin';
    try {
      await transporte.enviar({
        metodo: 'POST',
        url: `https://${host}.sii.cl/cvc_cgi/dte/of_genera_folio`,
      });
    } catch (causa) {
      throw new FoliosSinCafError(desde, hasta, 'certificacion', `${host}.sii.cl`, '', {
        cause: causa,
      });
    }
    throw new Error('La orden de timbrar salió');
  });
}

/** Un CAF ya cargado (fila de `cafs`). */
export function filaCaf(datos: Partial<Fila> & { id: string }): Fila {
  return {
    organizacion_id: ORG,
    empresa_id: EMPRESA,
    ambiente: 'produccion',
    tipo_dte: 39,
    folio_desde: 1,
    folio_hasta: 100,
    siguiente_folio: 1,
    fecha_autorizacion: '2026-11-01',
    idk: 300,
    rut_emisor: '76123456-0',
    estado: 'activo',
    caf_secret_id: `secreto-${datos.id}`,
    solicitud_id: null,
    creado_en: '2026-11-01T00:00:00Z',
    ...datos,
  };
}
