import { describe, expect, it } from 'vitest';
import {
  armarConsulta,
  ESTADOS_LISTADOS,
  expresionBusqueda,
  hayFiltros,
  hrefDocumentos,
  hrefInciertos,
  leerFiltros,
  nombrePeriodo,
  opcionesPeriodo,
  POR_PAGINA,
  parametrosDe,
  periodoActual,
  rangoPeriodo,
  TODOS_LOS_PERIODOS,
  ultimaPagina,
} from './filtros';

// Filtros de `/[org]/documentos` desde la URL (fuente de verdad, §4.3) y armado de la
// consulta. Puro: sin base ni red.

// 16-11-2026 12:00 en Chile (UTC-3).
const AHORA = new Date('2026-11-16T15:00:00Z');
const UUID = '4f0c9b7a-2d1e-4c3b-8a59-6e7d8c9b0a1f';
const UUID_EMPRESA = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

describe('leerFiltros', () => {
  it('sin parámetros: mes actual en Chile, página 1, sin filtros', () => {
    expect(leerFiltros({}, AHORA)).toEqual({
      ambiente: null,
      empresa: null,
      periodo: '2026-11',
      tipo: null,
      estado: null,
      q: '',
      pagina: 1,
      doc: null,
    });
  });

  it('el mes actual se toma en hora de Chile, no en UTC', () => {
    // 01-12-2026 01:00 UTC = 30-11-2026 22:00 en Chile.
    expect(periodoActual(new Date('2026-12-01T01:00:00Z'))).toBe('2026-11');
  });

  it('lee todos los filtros válidos', () => {
    const f = leerFiltros(
      {
        ambiente: 'produccion',
        empresa: UUID_EMPRESA,
        periodo: '2026-10',
        tipo: '41',
        estado: 'reparos',
        q: '  Comercial   Los  Aromos ',
        pagina: '3',
        doc: UUID,
      },
      AHORA,
    );
    expect(f).toEqual({
      ambiente: 'produccion',
      empresa: UUID_EMPRESA,
      periodo: '2026-10',
      tipo: 41,
      estado: 'reparos',
      q: 'Comercial Los Aromos',
      pagina: 3,
      doc: UUID,
    });
  });

  it('lo inválido vuelve al valor por defecto, sin lanzar', () => {
    const f = leerFiltros(
      {
        ambiente: 'staging',
        empresa: 'no-es-uuid',
        periodo: '2026-13',
        tipo: '33',
        estado: 'borrador',
        pagina: '-2',
        doc: "1' or 1=1",
      },
      AHORA,
    );
    expect(f.ambiente).toBeNull();
    expect(f.empresa).toBeNull();
    expect(f.periodo).toBe('2026-11');
    expect(f.tipo).toBeNull();
    expect(f.estado).toBeNull();
    expect(f.pagina).toBe(1);
    expect(f.doc).toBeNull();
    expect(leerFiltros({ pagina: '1.5' }, AHORA).pagina).toBe(1);
    expect(leerFiltros({ pagina: 'abc' }, AHORA).pagina).toBe(1);
  });

  it('con valores repetidos toma el primero', () => {
    expect(leerFiltros({ tipo: ['39', '41'] }, AHORA).tipo).toBe(39);
  });

  it('acepta «todos los períodos» y corta la búsqueda a 60 caracteres', () => {
    expect(leerFiltros({ periodo: 'todos' }, AHORA).periodo).toBe(TODOS_LOS_PERIODOS);
    expect(leerFiltros({ q: 'x'.repeat(200) }, AHORA).q).toHaveLength(60);
  });
});

describe('parametrosDe y hrefDocumentos', () => {
  const base = leerFiltros({}, AHORA);

  it('omite los valores por defecto pero siempre lleva el período', () => {
    expect(parametrosDe(base).toString()).toBe('periodo=2026-11');
  });

  it('escribe todos los filtros y aplica los cambios', () => {
    const f = {
      ...base,
      ambiente: 'certificacion' as const,
      tipo: 39 as const,
      estado: 'rechazado' as const,
      q: 'Los Aromos',
      pagina: 2,
    };
    expect(hrefDocumentos('mi-org', f)).toBe(
      '/mi-org/documentos?ambiente=certificacion&periodo=2026-11&tipo=39&estado=rechazado&q=Los+Aromos&pagina=2',
    );
    expect(hrefDocumentos('mi-org', f, { pagina: 1, doc: UUID })).toBe(
      `/mi-org/documentos?ambiente=certificacion&periodo=2026-11&tipo=39&estado=rechazado&q=Los+Aromos&doc=${UUID}`,
    );
  });

  it('lo escrito se vuelve a leer igual (ida y vuelta)', () => {
    const f = {
      ...base,
      ambiente: 'produccion' as const,
      empresa: UUID_EMPRESA,
      periodo: TODOS_LOS_PERIODOS,
      tipo: 41 as const,
      estado: 'incierto' as const,
      q: '12.345.678-5',
      pagina: 4,
      doc: UUID,
    };
    const leido = leerFiltros(Object.fromEntries(parametrosDe(f)), AHORA);
    expect(leido).toEqual(f);
  });
});

describe('período', () => {
  it('rangoPeriodo: [primer día, primer día del mes siguiente)', () => {
    expect(rangoPeriodo('2026-11')).toEqual({ desde: '2026-11-01', hasta: '2026-12-01' });
    expect(rangoPeriodo('2026-12')).toEqual({ desde: '2026-12-01', hasta: '2027-01-01' });
    expect(rangoPeriodo(TODOS_LOS_PERIODOS)).toBeNull();
    expect(rangoPeriodo('2026-00')).toBeNull();
  });

  it('nombrePeriodo', () => {
    expect(nombrePeriodo('2026-11')).toBe('Noviembre 2026');
    expect(nombrePeriodo('2027-01')).toBe('Enero 2027');
    expect(nombrePeriodo(TODOS_LOS_PERIODOS)).toBe('Todos los períodos');
  });

  it('opcionesPeriodo: 12 meses hacia atrás, el pedido si es más viejo y «todos» al final', () => {
    const o = opcionesPeriodo('2026-11', AHORA);
    expect(o).toHaveLength(13);
    expect(o[0]).toEqual({ valor: '2026-11', texto: 'Noviembre 2026' });
    expect(o[11]).toEqual({ valor: '2025-12', texto: 'Diciembre 2025' });
    expect(o.at(-1)?.valor).toBe(TODOS_LOS_PERIODOS);
    const viejo = opcionesPeriodo('2024-03', AHORA);
    expect(viejo).toHaveLength(14);
    expect(viejo[12]).toEqual({ valor: '2024-03', texto: 'Marzo 2024' });
  });
});

describe('expresionBusqueda', () => {
  it('sin texto, sin búsqueda', () => {
    expect(expresionBusqueda('   ')).toBeNull();
  });

  it('una razón social busca por razón social y RUT, sin folio', () => {
    expect(expresionBusqueda('Aromos')).toBe(
      'receptor_razon_social.ilike.%Aromos%,receptor_rut.ilike.%AROMOS%',
    );
  });

  it('un número busca además el folio exacto (con o sin puntos de miles)', () => {
    expect(expresionBusqueda('41')).toBe(
      'receptor_razon_social.ilike.%41%,receptor_rut.ilike.%41%,folio.eq.41',
    );
    expect(expresionBusqueda('18.244')).toContain('folio.eq.18244');
    expect(expresionBusqueda('99999999999')).not.toContain('folio.eq');
  });

  it('un RUT con puntos busca como se guarda (sin puntos, K mayúscula)', () => {
    expect(expresionBusqueda('76.354.771-k')).toBe(
      'receptor_razon_social.ilike.%76.354.771-k%,receptor_rut.ilike.%76354771-K%',
    );
  });

  it('sanea lo que rompería el `or` de PostgREST o el LIKE', () => {
    const e = expresionBusqueda('a,b(c)"d*e%f_g') ?? '';
    expect(e).toBe(
      'receptor_razon_social.ilike.%a_b_c__d_e\\%f\\_g%,receptor_rut.ilike.%A_B_C__D_E\\%F\\_G%',
    );
    // Una sola coma por condición: nadie puede agregar condiciones al `or`.
    expect(e.split(',')).toHaveLength(2);
  });
});

describe('armarConsulta', () => {
  const ctx = { organizacionId: 'org-1', empresaId: 'emp-1', ambiente: 'produccion' as const };

  it('sin filtros: el mes, todos los estados menos borrador, primera página', () => {
    const c = armarConsulta(ctx, leerFiltros({}, AHORA));
    expect(c).toEqual({
      ...ctx,
      periodo: { desde: '2026-11-01', hasta: '2026-12-01' },
      tipo: null,
      estados: ESTADOS_LISTADOS,
      busqueda: null,
      rango: [0, POR_PAGINA - 1],
    });
    expect(c.estados).not.toContain('borrador');
  });

  it('traduce el estado de la UI al de la base y pagina con `range` inclusivo', () => {
    const c = armarConsulta(
      ctx,
      leerFiltros({ estado: 'reparos', tipo: '39', pagina: '3', periodo: 'todos', q: '41' }, AHORA),
    );
    expect(c.estados).toEqual(['aceptado_con_reparos']);
    expect(c.tipo).toBe(39);
    expect(c.periodo).toBeNull();
    expect(c.busqueda).toContain('folio.eq.41');
    expect(c.rango).toEqual([2 * POR_PAGINA, 3 * POR_PAGINA - 1]);
  });

  it('ultimaPagina y hayFiltros', () => {
    expect(ultimaPagina(0)).toBe(1);
    expect(ultimaPagina(POR_PAGINA)).toBe(1);
    expect(ultimaPagina(POR_PAGINA + 1)).toBe(2);
    expect(hayFiltros(leerFiltros({}, AHORA))).toBe(false);
    expect(hayFiltros(leerFiltros({ q: 'x' }, AHORA))).toBe(true);
    // El período y el ambiente no cuentan como filtro (siempre hay uno).
    expect(hayFiltros(leerFiltros({ periodo: 'todos', ambiente: 'produccion' }, AHORA))).toBe(
      false,
    );
  });
});

describe('hrefInciertos', () => {
  it('lleva empresa y ambiente del envío (no los por defecto de /documentos)', () => {
    const href = hrefInciertos('mi-org', UUID_EMPRESA, 'certificacion');
    expect(href).toBe(
      `/mi-org/documentos?empresa=${UUID_EMPRESA}&ambiente=certificacion&periodo=todos&estado=incierto`,
    );
    const leido = leerFiltros(Object.fromEntries(new URL(href, 'http://x').searchParams), AHORA);
    expect(leido).toMatchObject({
      empresa: UUID_EMPRESA,
      ambiente: 'certificacion',
      periodo: TODOS_LOS_PERIODOS,
      estado: 'incierto',
    });
  });
});
