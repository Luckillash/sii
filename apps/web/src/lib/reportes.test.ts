import { describe, expect, it } from 'vitest';
import { hrefExportacion } from './reportes';

const EMPRESA = '8a7c4efb-5829-4b11-b23d-632779a33837';

describe('hrefExportacion', () => {
  it('arma la URL de la ruta de exportación con los cinco parámetros en orden', () => {
    expect(
      hrefExportacion('servicio', {
        empresa: EMPRESA,
        ambiente: 'certificacion',
        periodo: '2026-11',
        reporte: 'documentos',
        formato: 'csv',
      }),
    ).toBe(
      `/servicio/reportes/exportar?empresa=${EMPRESA}&ambiente=certificacion&periodo=2026-11&reporte=documentos&formato=csv`,
    );
  });

  it('codifica el slug', () => {
    expect(
      hrefExportacion('mi org', {
        empresa: EMPRESA,
        ambiente: 'produccion',
        periodo: '2026-01',
        reporte: 'resumen',
        formato: 'xlsx',
      }),
    ).toMatch(/^\/mi%20org\/reportes\/exportar\?.*reporte=resumen&formato=xlsx$/);
  });
});
