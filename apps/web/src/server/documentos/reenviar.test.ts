import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Database } from '../supabase/tipos';
import {
  REENVIO_NO_ENCONTRADO,
  REENVIO_SIN_CORREO,
  reenviarAlReceptor,
  VENTANA_REENVIO_MS,
} from './reenviar';

// «Reenviar al receptor» con dobles: base (sesión y service_role), URL firmada, descarga y
// Resend. Sin red ni correos reales.

const ORG = '82c456c2-5937-4d35-a178-9128cd7a1cb0';
const OTRA_ORG = '11111111-2222-4333-8444-555555555555';
const EMPRESA = '8a7c4efb-5829-4b11-b23d-632779a33837';
const DOC = '6ff2fe99-f81d-4659-99d1-f6837497669f';
const AHORA = new Date('2026-11-16T22:30:00Z');
const PDF = Buffer.from('%PDF-1.7 prueba');

type Fila = Record<string, unknown>;

/** Cliente falso: filtra por igualdad las filas de cada tabla y registra los `update`. */
function clienteFalso(tablas: Record<string, Fila[]>, updates: { tabla: string; valor: Fila }[]) {
  return {
    from(tabla: string) {
      const filtros: [string, unknown][] = [];
      let valor: Fila | null = null;
      const filas = () =>
        (tablas[tabla] ?? []).filter((f) => filtros.every(([c, v]) => f[c] === v));
      const b = {
        select: () => b,
        update: (v: Fila) => {
          valor = v;
          return b;
        },
        eq: (c: string, v: unknown) => {
          filtros.push([c, v]);
          return b;
        },
        maybeSingle: async () => ({ data: filas()[0] ?? null, error: null }),
        // biome-ignore lint/suspicious/noThenProperty: imita el builder «thenable» de supabase-js.
        then: (ok: (r: { error: null }) => void) => {
          if (valor) updates.push({ tabla, valor });
          ok({ error: null });
        },
      };
      return b;
    },
  } as unknown as SupabaseClient<Database>;
}

function documento(parcial: Fila = {}): Fila {
  return {
    id: DOC,
    organizacion_id: ORG,
    empresa_id: EMPRESA,
    tipo_dte: 39,
    folio: 41,
    estado: 'aceptado',
    fecha_emision: '2026-11-16',
    mnt_total: 1190,
    metadata: { receptor_correo: 'cliente@example.com', pdf: { carta: 'x/carta.pdf' } },
    ...parcial,
  };
}

const empresa = {
  id: EMPRESA,
  organizacion_id: ORG,
  rut: '20630500-2',
  razon_social: 'Piloto SpA',
};

let updates: { tabla: string; valor: Fila }[];
let docs: Fila[];
const enlace = vi.fn();
const correo = vi.fn();
const descargar = vi.fn();

function deps() {
  return {
    sesion: async () => clienteFalso({ documentos: docs, empresas: [empresa] }, updates),
    servicio: () => clienteFalso({ documentos: docs }, updates),
    enlace,
    correo,
    descargar,
    ahora: () => AHORA,
  };
}

beforeEach(() => {
  updates = [];
  docs = [documento()];
  enlace.mockReset().mockResolvedValue({ ok: true, url: 'https://storage/firmada' });
  correo.mockReset().mockResolvedValue({ ok: true, id: 'resend-1' });
  descargar.mockReset().mockResolvedValue(PDF);
});

describe('reenviarAlReceptor', () => {
  it('manda el PDF carta al correo guardado y lo registra en metadata', async () => {
    const r = await reenviarAlReceptor({ organizacionId: ORG }, DOC, deps());
    expect(r).toEqual({
      ok: true,
      mensaje: {
        titulo: 'Reenviamos la boleta',
        detalle: 'La boleta N.º 41 va en camino a cliente@example.com, con su PDF adjunto.',
      },
    });
    expect(enlace).toHaveBeenCalledWith(
      { organizacionId: ORG, empresaId: EMPRESA },
      DOC,
      'pdf_carta',
    );
    expect(descargar).toHaveBeenCalledWith('https://storage/firmada');
    expect(correo).toHaveBeenCalledWith({
      para: 'cliente@example.com',
      emisor: { rut: '20630500-2', razonSocial: 'Piloto SpA' },
      tipoDte: 39,
      folio: 41,
      fechaEmision: '2026-11-16',
      total: 1190,
      pdf: PDF,
      claveIdempotencia: `reenvio-${DOC}-${Math.floor(AHORA.getTime() / VENTANA_REENVIO_MS)}`,
    });
    expect(updates).toEqual([
      {
        tabla: 'documentos',
        valor: {
          metadata: {
            receptor_correo: 'cliente@example.com',
            pdf: { carta: 'x/carta.pdf' },
            correo: { id: 'resend-1', enviado_en: AHORA.toISOString() },
          },
        },
      },
    ]);
  });

  it('no pisa la ruta del PDF que `enlaceDocumento` regeneró mientras tanto', async () => {
    docs = [documento({ metadata: { receptor_correo: 'cliente@example.com' } })];
    enlace.mockImplementation(async () => {
      // Como `enlaceDocumento` cuando falta el PDF: lo regenera y guarda su ruta.
      docs[0] = {
        ...docs[0],
        metadata: { receptor_correo: 'cliente@example.com', pdf: { carta: 'nueva/carta.pdf' } },
      };
      return { ok: true, url: 'https://storage/firmada' };
    });
    const r = await reenviarAlReceptor({ organizacionId: ORG }, DOC, deps());
    expect(r.ok).toBe(true);
    expect(updates).toEqual([
      {
        tabla: 'documentos',
        valor: {
          metadata: {
            receptor_correo: 'cliente@example.com',
            pdf: { carta: 'nueva/carta.pdf' },
            correo: { id: 'resend-1', enviado_en: AHORA.toISOString() },
          },
        },
      },
    ]);
  });

  it('sin correo del receptor no sale nada', async () => {
    docs = [documento({ metadata: { receptor_correo: null } })];
    const r = await reenviarAlReceptor({ organizacionId: ORG }, DOC, deps());
    expect(r).toEqual({ ok: false, mensaje: REENVIO_SIN_CORREO });
    expect(enlace).not.toHaveBeenCalled();
    expect(correo).not.toHaveBeenCalled();
  });

  it('una boleta de otra organización no existe', async () => {
    const r = await reenviarAlReceptor({ organizacionId: OTRA_ORG }, DOC, deps());
    expect(r).toEqual({ ok: false, mensaje: REENVIO_NO_ENCONTRADO });
    expect(correo).not.toHaveBeenCalled();
    expect(await reenviarAlReceptor({ organizacionId: ORG }, 'no-uuid', deps())).toEqual({
      ok: false,
      mensaje: REENVIO_NO_ENCONTRADO,
    });
  });

  it('una boleta incierta no se reenvía: primero se revisa en el SII', async () => {
    docs = [documento({ estado: 'incierto' })];
    const r = await reenviarAlReceptor({ organizacionId: ORG }, DOC, deps());
    expect(r.ok).toBe(false);
    expect(r.mensaje.titulo).toBe('Primero revisa la boleta en el SII');
    expect(correo).not.toHaveBeenCalled();
  });

  it('rechazada o anulada tampoco', async () => {
    for (const estado of ['rechazado', 'anulado', 'firmado']) {
      docs = [documento({ estado })];
      const r = await reenviarAlReceptor({ organizacionId: ORG }, DOC, deps());
      expect(r.ok).toBe(false);
    }
    expect(correo).not.toHaveBeenCalled();
  });

  it('si no hay PDF, devuelve el mensaje de `enlaceDocumento`', async () => {
    const mensaje = { titulo: 'No pudimos generar el PDF', detalle: 'Inténtalo más tarde.' };
    enlace.mockResolvedValue({ ok: false, mensaje });
    expect(await reenviarAlReceptor({ organizacionId: ORG }, DOC, deps())).toEqual({
      ok: false,
      mensaje,
    });
    expect(correo).not.toHaveBeenCalled();
  });

  it('una falla de Resend no deja nada guardado y explica qué hacer', async () => {
    correo.mockResolvedValue({ ok: false, motivo: 'sin_configuracion', detalle: 'x' });
    const r = await reenviarAlReceptor({ organizacionId: ORG }, DOC, deps());
    expect(r.ok).toBe(false);
    expect(r.mensaje.titulo).toBe('El envío de correos todavía no está configurado');
    expect(updates).toEqual([]);

    correo.mockResolvedValue({ ok: false, motivo: 'red', detalle: 'x' });
    expect((await reenviarAlReceptor({ organizacionId: ORG }, DOC, deps())).mensaje.titulo).toBe(
      'No pudimos reenviar la boleta',
    );
  });

  it('nunca lanza: una descarga que falla vuelve como mensaje', async () => {
    descargar.mockRejectedValue(new Error('HTTP 500'));
    const r = await reenviarAlReceptor({ organizacionId: ORG }, DOC, deps());
    expect(r.ok).toBe(false);
    expect(correo).not.toHaveBeenCalled();
  });
});
