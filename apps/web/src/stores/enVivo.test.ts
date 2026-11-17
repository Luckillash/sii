import { describe, expect, it } from 'vitest';
import {
  crearStoreEnVivo,
  envioVigente,
  esMasNuevo,
  estadoVigente,
  filtrosRealtime,
  leerCambioDocumento,
  leerCambioEnvio,
} from './enVivo';

// `useEnVivoStore`: lo que llega por Realtime sobrescribe el estado en memoria solo si es
// más nuevo que lo que trajo el servidor (o que el evento anterior).

const T0 = '2026-11-16T22:17:35.330729+00:00';
const T1 = '2026-11-16T22:22:35.100000+00:00';
const T2 = '2026-11-16T22:27:35.000000+00:00';

describe('lectura de filas de Realtime', () => {
  it('documento: exige id, estado conocido y actualizado_en', () => {
    expect(
      leerCambioDocumento({ id: 'd1', estado: 'aceptado', actualizado_en: T1, folio: 41 }),
    ).toEqual({ id: 'd1', estado: 'aceptado', actualizadoEn: T1 });
    expect(leerCambioDocumento({ id: 'd1', estado: 'otro', actualizado_en: T1 })).toBeNull();
    expect(leerCambioDocumento({ id: 'd1', estado: 'aceptado' })).toBeNull();
    expect(leerCambioDocumento(null)).toBeNull();
    expect(leerCambioDocumento({})).toBeNull();
  });

  it('envío: clasificación conocida o nula', () => {
    expect(
      leerCambioEnvio({
        id: 'e1',
        clasificacion: 'aceptado',
        incierto: false,
        track_id: '34015200',
        estado_sii: 'EPR',
        glosa_sii: null,
        actualizado_en: T1,
      }),
    ).toEqual({
      id: 'e1',
      clasificacion: 'aceptado',
      incierto: false,
      trackId: '34015200',
      estadoSii: 'EPR',
      glosaSii: null,
      actualizadoEn: T1,
    });
    expect(
      leerCambioEnvio({ id: 'e1', clasificacion: null, actualizado_en: T1 })?.clasificacion,
    ).toBeNull();
    expect(leerCambioEnvio({ id: 'e1', clasificacion: 'raro', actualizado_en: T1 })).toBeNull();
  });
});

describe('store', () => {
  it('un evento más viejo no pisa a uno más nuevo', () => {
    const s = crearStoreEnVivo();
    expect(
      s.getState().aplicarDocumento({ id: 'd1', estado: 'aceptado', actualizado_en: T2 }),
    ).toBe(true);
    expect(s.getState().aplicarDocumento({ id: 'd1', estado: 'enviado', actualizado_en: T1 })).toBe(
      false,
    );
    expect(s.getState().documentos.d1).toEqual({ estado: 'aceptado', actualizadoEn: T2 });
    expect(s.getState().aplicarDocumento({ basura: true })).toBe(false);
  });

  it('envíos: guarda el último', () => {
    const s = crearStoreEnVivo();
    s.getState().aplicarEnvio({ id: 'e1', clasificacion: 'en_proceso', actualizado_en: T1 });
    s.getState().aplicarEnvio({ id: 'e1', clasificacion: 'aceptado', actualizado_en: T2 });
    expect(s.getState().envios.e1?.clasificacion).toBe('aceptado');
  });
});

describe('criterio: un envío pasa de enviado a aceptado sin recargar', () => {
  it('el estado vigente es el del evento si es más nuevo que el del servidor', () => {
    const servidor = { estado: 'enviado' as const, actualizadoEn: T0 };
    const s = crearStoreEnVivo();
    expect(estadoVigente(servidor, s.getState().documentos.d1)).toBe('enviado');
    s.getState().aplicarDocumento({ id: 'd1', estado: 'aceptado', actualizado_en: T1 });
    expect(estadoVigente(servidor, s.getState().documentos.d1)).toBe('aceptado');
  });

  it('un refresh con datos más nuevos gana sobre un evento viejo', () => {
    const s = crearStoreEnVivo();
    s.getState().aplicarDocumento({ id: 'd1', estado: 'enviado', actualizado_en: T1 });
    expect(
      estadoVigente({ estado: 'aceptado', actualizadoEn: T2 }, s.getState().documentos.d1),
    ).toBe('aceptado');
    // Empate (la misma fila): manda el servidor.
    expect(
      estadoVigente({ estado: 'rechazado', actualizadoEn: T1 }, s.getState().documentos.d1),
    ).toBe('rechazado');
  });

  it('envioVigente mezcla lo nuevo sobre lo del servidor', () => {
    const servidor = {
      id: 'e1',
      clasificacion: 'en_proceso' as const,
      incierto: false,
      trackId: '34015200',
      estadoSii: 'REC',
      glosaSii: null,
      actualizadoEn: T0,
    };
    expect(envioVigente(servidor, undefined)).toBe(servidor);
    const r = envioVigente(servidor, {
      clasificacion: 'aceptado',
      incierto: false,
      trackId: '34015200',
      estadoSii: 'EPR',
      glosaSii: null,
      actualizadoEn: T1,
    });
    expect(r.clasificacion).toBe('aceptado');
    expect(r.estadoSii).toBe('EPR');
  });

  it('esMasNuevo con fechas inválidas', () => {
    expect(esMasNuevo('no-es-fecha', T0)).toBe(false);
    expect(esMasNuevo(T0, 'no-es-fecha')).toBe(true);
    expect(esMasNuevo(T0, null)).toBe(true);
  });
});

describe('filtrosRealtime', () => {
  it('la lista escucha toda la organización', () => {
    expect(filtrosRealtime('org-1')).toEqual({
      documentos: 'organizacion_id=eq.org-1',
      envios: 'organizacion_id=eq.org-1',
    });
  });

  it('la página de un envío escucha solo ese envío y sus documentos', () => {
    expect(filtrosRealtime('org-1', 'e1')).toEqual({
      documentos: 'envio_id=eq.e1',
      envios: 'id=eq.e1',
    });
  });
});
