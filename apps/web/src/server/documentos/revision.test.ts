import { describe, expect, it } from 'vitest';
import { revisadaEn, revisionEnvio } from './revision';

// Un envío incierto está revisado cuando todas sus operaciones inciertas (o en curso)
// enlazadas tienen `detalle.revisada_en` (la marca de `marcarInciertaRevisada`).

const T1 = '2026-11-17T10:00:00.000Z';
const T2 = '2026-11-17T12:00:00.000Z';

describe('revisión de un envío incierto', () => {
  it('revisadaEn lee la marca sin confiar en la forma del detalle', () => {
    expect(revisadaEn({ revisada_en: T1, revisada_por: 'u1' })).toBe(T1);
    expect(revisadaEn({ revisada_en: '' })).toBeNull();
    expect(revisadaEn({})).toBeNull();
    expect(revisadaEn(null)).toBeNull();
    expect(revisadaEn([T1])).toBeNull();
  });

  it('sin operaciones inciertas enlazadas, no está revisado', () => {
    expect(revisionEnvio([])).toBeNull();
    expect(revisionEnvio([{ resultado: 'ok', detalle: { revisada_en: T1 } }])).toBeNull();
  });

  it('falta revisar una: no está revisado', () => {
    expect(
      revisionEnvio([
        { resultado: 'incierto', detalle: { revisada_en: T1 } },
        { resultado: 'en_curso', detalle: {} },
      ]),
    ).toBeNull();
  });

  it('todas revisadas: la marca más reciente; las que no son inciertas no cuentan', () => {
    expect(
      revisionEnvio([
        { resultado: 'incierto', detalle: { revisada_en: T2 } },
        { resultado: 'incierto', detalle: { revisada_en: T1 } },
        { resultado: 'error', detalle: {} },
      ]),
    ).toBe(T2);
  });
});
