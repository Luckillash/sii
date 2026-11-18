import { describe, expect, it } from 'vitest';
import {
  type AmbienteEmision,
  type DocumentoEmitido,
  esquemaBorrador,
  type FoliosEmision,
  type ResultadoEmision,
  type VistaEmision,
} from '@/lib/emision';
import {
  ambienteDe,
  ambientePorDefecto,
  avisoDescuento,
  bloqueoEmision,
  bloqueoGuardado,
  erroresDelBorrador,
  erroresSinCampo,
  estadoParaMostrar,
  explicarMotivo,
  foliosDe,
  medidorDe,
  reaccionAError,
  sinErroresDe,
  textoFolio,
} from './logica';

const EMPRESA = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

function folios(parcial: Partial<FoliosEmision> = {}): FoliosEmision {
  return {
    ambiente: 'certificacion',
    tipoDte: 39,
    siguiente: 41,
    disponibles: 60,
    total: 100,
    estado: 'sello',
    puedeEmitir: true,
    ...parcial,
  };
}

function ambiente(parcial: Partial<AmbienteEmision> = {}): AmbienteEmision {
  return {
    ambiente: 'certificacion',
    habilitado: true,
    motivo: null,
    resolucion: { numero: 0, fecha: '2026-11-01' },
    ...parcial,
  };
}

type VistaBloqueo = Pick<VistaEmision, 'ambientes' | 'folios' | 'certificado'>;

function vista(parcial: Partial<VistaBloqueo> = {}): VistaBloqueo {
  return {
    ambientes: [
      ambiente({ ambiente: 'produccion', habilitado: false, motivo: 'sin_autorizacion' }),
      ambiente(),
    ],
    folios: [folios(), folios({ tipoDte: 41, siguiente: null, disponibles: 0, total: 0 })],
    certificado: { titular: 'Camila Rojas', rut: '12345678-5', vigenteHasta: '2027-05-01' },
    ...parcial,
  };
}

describe('erroresDelBorrador', () => {
  it('devuelve la ruta completa de cada campo, el primer error de cada uno', () => {
    const r = esquemaBorrador.safeParse({
      tipoDte: 41,
      ambiente: 'certificacion',
      receptor: { rut: '76.354.771-0', correo: 'no-es-correo' },
      lineas: [
        { nombre: '', cantidad: Number.NaN, precio: 1000, exento: true },
        { nombre: 'Asesoría', cantidad: 1, precio: 1000, exento: false },
      ],
      descuento: { tipo: 'porcentaje', valor: 150 },
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const e = erroresDelBorrador(r.error);
    expect(e['receptor.rut']).toBe('Revisa el RUT.');
    expect(e['receptor.correo']).toBe('Revisa el correo.');
    expect(e['lineas.0.nombre']).toBe('Escribe el nombre del producto o servicio.');
    expect(e['lineas.0.cantidad']).toBe('Escribe la cantidad.');
    expect(e['descuento.valor']).toMatch(/entre 0 y 100/);
  });

  it('las reglas del borrador completo (exenta, total) también llegan por campo', () => {
    const r = esquemaBorrador.safeParse({
      tipoDte: 41,
      ambiente: 'certificacion',
      receptor: { rut: '' },
      lineas: [{ nombre: 'Asesoría', cantidad: 1, precio: 0, exento: false }],
    });
    expect(r.success).toBe(false);
    if (r.success) return;
    const e = erroresDelBorrador(r.error);
    expect(e['lineas.0.exento']).toBe('En una boleta exenta todas las líneas son exentas.');
    expect(e.lineas).toBe('El total tiene que ser mayor que $ 0.');
  });
});

describe('sinErroresDe', () => {
  const errores = {
    'receptor.rut': 'a',
    'lineas.0.nombre': 'b',
    'lineas.10.precio': 'c',
    lineas: 'd',
    lineasExtra: 'e',
  };

  it('quita el campo y sus hijos, no los que solo comparten el comienzo', () => {
    expect(sinErroresDe(errores, 'lineas')).toEqual({ 'receptor.rut': 'a', lineasExtra: 'e' });
    expect(sinErroresDe(errores, 'lineas.1')).toBe(errores);
    expect(Object.keys(sinErroresDe(errores, 'lineas.0'))).not.toContain('lineas.0.nombre');
  });

  it('sin cambios devuelve el mismo objeto (no fuerza un render)', () => {
    expect(sinErroresDe(errores, 'descuento')).toBe(errores);
  });
});

describe('folios del resumen', () => {
  it('foliosDe busca por ambiente y tipo', () => {
    const v = vista();
    expect(foliosDe(v, 'certificacion', 39)?.siguiente).toBe(41);
    expect(foliosDe(v, 'produccion', 39)).toBeNull();
  });

  it('textoFolio con separador de miles', () => {
    expect(textoFolio(18245)).toBe('N.º 18.245');
    expect(textoFolio(null)).toBeNull();
  });

  it('medidorDe reconstruye el rango desde el siguiente folio', () => {
    // CAF 1–100 con 40 usados: siguiente 41.
    expect(medidorDe(folios())).toEqual({ desde: 1, hasta: 100, siguiente: 41 });
    // CAF 501–600 con 10 usados.
    expect(medidorDe(folios({ siguiente: 511, disponibles: 90 }))).toEqual({
      desde: 501,
      hasta: 600,
      siguiente: 511,
    });
  });

  it('medidorDe: agotado queda agotado; sin CAF nunca, sin medidor', () => {
    const agotado = medidorDe(folios({ siguiente: null, disponibles: 0, total: 50 }));
    expect(agotado).toEqual({ desde: 1, hasta: 50, siguiente: 51 });
    expect(medidorDe(folios({ siguiente: null, disponibles: 0, total: 0 }))).toBeNull();
    expect(medidorDe(null)).toBeNull();
  });
});

describe('explicarMotivo', () => {
  it.each([
    ['empresa_inactiva', `/acme/configuracion/empresas/${EMPRESA}`],
    ['sin_autorizacion', `/acme/certificacion?empresa=${EMPRESA}`],
    ['plan_sin_produccion', '/acme/configuracion/plan'],
    ['sin_resolucion', `/acme/configuracion/empresas/${EMPRESA}`],
    ['sin_certificado', `/acme/configuracion/empresas/${EMPRESA}/certificados`],
  ] as const)('%s enlaza a lo que lo arregla', (motivo, href) => {
    const b = explicarMotivo(motivo, 'produccion', 'acme', EMPRESA);
    expect(b.enlace?.href).toBe(href);
    expect(b.texto).toMatch(/\.$/);
    expect(b.texto).not.toMatch(/!/);
  });

  it('la resolución nombra el ambiente', () => {
    expect(explicarMotivo('sin_resolucion', 'certificacion', 'acme', EMPRESA).texto).toMatch(
      /en certificación/,
    );
  });
});

describe('bloqueoEmision', () => {
  it('nada bloquea: null', () => {
    expect(bloqueoEmision(vista(), 'certificacion', 39, 'acme', EMPRESA)).toBeNull();
  });

  it('ambiente bloqueado: su motivo', () => {
    const b = bloqueoEmision(vista(), 'produccion', 39, 'acme', EMPRESA);
    expect(b?.texto).toMatch(/autorizada/);
    expect(b?.enlace?.href).toContain('/acme/certificacion');
  });

  it('ambiente desconocido: bloqueado sin enlace', () => {
    const b = bloqueoEmision(vista({ ambientes: [] }), 'certificacion', 39, 'acme', EMPRESA);
    expect(b).toEqual({ texto: 'No se puede emitir en certificación.', enlace: null });
  });

  it('sin certificado', () => {
    const b = bloqueoEmision(vista({ certificado: null }), 'certificacion', 39, 'acme', EMPRESA);
    expect(b?.enlace?.href).toMatch(/certificados$/);
  });

  it('sin folios del tipo: guía a Folios', () => {
    const b = bloqueoEmision(vista(), 'certificacion', 41, 'acme', EMPRESA);
    expect(b?.texto).toMatch(/Aún no hay folios de Boleta exenta electrónica \(41\)/);
    expect(b?.enlace?.href).toBe(`/acme/folios?empresa=${EMPRESA}`);
  });

  it('CAF agotado (puedeEmitir falso): la guía del MedidorFolios', () => {
    const v = vista({
      folios: [folios({ siguiente: null, disponibles: 0, puedeEmitir: false, estado: 'error' })],
    });
    const b = bloqueoEmision(v, 'certificacion', 39, 'acme', EMPRESA);
    expect(b?.texto).toMatch(/^CAF agotado/);
    expect(b?.texto).toMatch(/Solicita un nuevo rango de folios al SII antes de emitir\.$/);
  });
});

describe('bloqueoEmision: cupo de producción del plan', () => {
  // Ambos ambientes habilitados y con folios: solo la cuota puede bloquear.
  const habilitada = (cuotaProduccion: VistaEmision['cuotaProduccion']) => ({
    ...vista({
      ambientes: [ambiente({ ambiente: 'produccion' }), ambiente()],
      folios: [folios(), folios({ ambiente: 'produccion' })],
    }),
    cuotaProduccion,
  });

  it('cupo lleno bloquea producción con enlace al plan y nombra el plan', () => {
    const v = habilitada({ plan: 'Emprende', usadas: 1000, maximo: 1000 });
    const b = bloqueoEmision(v, 'produccion', 39, 'acme', EMPRESA);
    expect(b?.texto).toMatch(
      /límite de 1\.000 boletas en producción de este mes del plan Emprende/,
    );
    expect(b?.enlace?.href).toBe('/acme/configuracion/plan');
    // Pasarse (la base contó otra antes de leer) también bloquea.
    const pasada = habilitada({ plan: null, usadas: 1001, maximo: 1000 });
    expect(bloqueoEmision(pasada, 'produccion', 39, 'acme', EMPRESA)?.texto).not.toMatch(
      /del plan/,
    );
  });

  it('el cupo lleno no bloquea certificación', () => {
    const v = habilitada({ plan: 'Emprende', usadas: 1000, maximo: 1000 });
    expect(bloqueoEmision(v, 'certificacion', 39, 'acme', EMPRESA)).toBeNull();
  });

  it('bajo el cupo, sin límite (null), máximo 0 o sin dato de cuota: no bloquea por cuota', () => {
    for (const cuota of [
      { plan: 'Emprende', usadas: 999, maximo: 1000 },
      { plan: 'Empresa', usadas: 50_000, maximo: null },
      { plan: 'Certificación', usadas: 3, maximo: 0 },
      null,
      undefined,
    ]) {
      expect(bloqueoEmision(habilitada(cuota), 'produccion', 39, 'acme', EMPRESA)).toBeNull();
    }
  });

  it('el certificado faltante se explica antes que la cuota', () => {
    const v = { ...habilitada({ plan: 'X', usadas: 5, maximo: 5 }), certificado: null };
    expect(bloqueoEmision(v, 'produccion', 39, 'acme', EMPRESA)?.enlace?.href).toMatch(
      /certificados$/,
    );
  });
});

describe('ambientes', () => {
  it('ambientePorDefecto: el primero habilitado (producción primero)', () => {
    expect(ambientePorDefecto(vista())).toBe('certificacion');
    expect(
      ambientePorDefecto({
        ambientes: [ambiente({ ambiente: 'produccion' }), ambiente()],
      }),
    ).toBe('produccion');
    expect(
      ambientePorDefecto({
        ambientes: [ambiente({ habilitado: false, motivo: 'sin_resolucion' })],
      }),
    ).toBe('certificacion');
  });

  it('ambienteDe', () => {
    expect(ambienteDe(vista(), 'produccion')?.motivo).toBe('sin_autorizacion');
  });
});

describe('avisoDescuento', () => {
  it('sin descuento o con uno que cabe: sin aviso', () => {
    expect(avisoDescuento({ afectoBruto: 10_000, descuentoAplicado: 0 }, null)).toBeNull();
    expect(
      avisoDescuento(
        { afectoBruto: 10_000, descuentoAplicado: 1_000 },
        { tipo: 'monto', valor: 1_000 },
      ),
    ).toBeNull();
    expect(
      avisoDescuento(
        { afectoBruto: 10_000, descuentoAplicado: 10_000 },
        { tipo: 'porcentaje', valor: 100 },
      ),
    ).toBeNull();
  });

  it('sin líneas afectas: no se aplica', () => {
    expect(
      avisoDescuento({ afectoBruto: 0, descuentoAplicado: 0 }, { tipo: 'monto', valor: 500 }),
    ).toMatch(/no se aplica/);
  });

  it('mayor que lo afecto: se acota', () => {
    expect(
      avisoDescuento(
        { afectoBruto: 1_190, descuentoAplicado: 1_190 },
        { tipo: 'monto', valor: 5_000 },
      ),
    ).toBe('El descuento supera lo afecto: se aplican $ 1.190.');
  });
});

describe('estadoParaMostrar', () => {
  it('traduce aceptado_con_reparos al vocabulario de EstadoDTE', () => {
    expect(estadoParaMostrar('aceptado_con_reparos')).toBe('reparos');
    expect(estadoParaMostrar('incierto')).toBe('incierto');
    expect(estadoParaMostrar('enviado')).toBe('enviado');
  });
});

type ErrorEmision = Extract<ResultadoEmision, { tipo: 'error' }>;

function error(parcial: Partial<ErrorEmision> = {}): ErrorEmision {
  return { tipo: 'error', mensaje: { titulo: 't', detalle: 'd' }, operacionId: null, ...parcial };
}

function documento(estado: DocumentoEmitido['estado']): DocumentoEmitido {
  return {
    id: 'doc-1',
    tipoDte: 39,
    ambiente: 'produccion',
    folio: 41,
    estado,
    total: 1_190,
    trackId: null,
    conPdf: false,
    correoEnviado: false,
  };
}

describe('reaccionAError', () => {
  it('incierto (por resultado, por estado o por motivo): bloquea y suelta el borrador', () => {
    const incierta = { tipo: 'incierta', soltarBorrador: true, ofrecerNueva: false };
    expect(reaccionAError(error({ resultado: 'incierto' }))).toEqual(incierta);
    expect(reaccionAError(error({ documento: documento('incierto') }))).toEqual(incierta);
    expect(reaccionAError(error({ motivo: 'documento_incierto' }))).toEqual(incierta);
  });

  it('un documento con folio en otro estado (no anulado) también bloquea', () => {
    expect(reaccionAError(error({ documento: documento('enviado') })).tipo).toBe('incierta');
    expect(reaccionAError(error({ documento: documento('firmado') })).tipo).toBe('incierta');
  });

  it('rechazo 4xx (documento anulado): conserva el formulario y reintenta sin borradorId', () => {
    expect(
      reaccionAError(error({ resultado: 'rechazo_sii', documento: documento('anulado') })),
    ).toEqual({ tipo: 'mostrar', soltarBorrador: true, ofrecerNueva: false });
  });

  it('borrador borrado antes de emitir: se suelta; borrador ya emitido: NO, y se ofrece otra', () => {
    expect(reaccionAError(error({ motivo: 'borrador_no_encontrado' })).soltarBorrador).toBe(true);
    expect(reaccionAError(error({ motivo: 'borrador_emitido' }))).toEqual({
      tipo: 'mostrar',
      soltarBorrador: false,
      ofrecerNueva: true,
    });
  });

  it('validación, sin folios, ambiente bloqueado: solo se muestra', () => {
    for (const motivo of ['no_ejecutada', 'sin_folios', 'sin_autorizacion', 'cuota']) {
      expect(reaccionAError(error({ motivo }))).toEqual({
        tipo: 'mostrar',
        soltarBorrador: false,
        ofrecerNueva: false,
      });
    }
  });
});

describe('bloqueoGuardado', () => {
  it('producción sin autorización o con plan sin producción: no se puede guardar', () => {
    const b = bloqueoGuardado(vista(), 'produccion', 'acme', EMPRESA);
    expect(b?.texto).toMatch(/^No se puede guardar un borrador de producción: la empresa/);
    const plan = vista({
      ambientes: [
        ambiente({ ambiente: 'produccion', habilitado: false, motivo: 'plan_sin_produccion' }),
      ],
    });
    expect(bloqueoGuardado(plan, 'produccion', 'acme', EMPRESA)?.enlace?.href).toBe(
      '/acme/configuracion/plan',
    );
  });

  it('otros bloqueos o un ambiente habilitado sí dejan guardar', () => {
    expect(bloqueoGuardado(vista(), 'certificacion', 'acme', EMPRESA)).toBeNull();
    const sinCert = vista({
      ambientes: [ambiente({ habilitado: false, motivo: 'sin_certificado' })],
    });
    expect(bloqueoGuardado(sinCert, 'certificacion', 'acme', EMPRESA)).toBeNull();
  });
});

describe('erroresSinCampo', () => {
  it('deja fuera los que tienen control (claves con punto) y junta los demás sin repetir', () => {
    expect(
      erroresSinCampo({
        'receptor.razonSocial': 'Falta la razón social del receptor',
        'lineas.0.precio': 'a',
        'lineas.12.exento': 'b',
        lineas: 'c',
        'descuento.valor': 'd',
        tipoDte: 'Elige el tipo.',
        formulario: 'Elige el tipo.',
        'lineas.0.otro': 'Campo raro',
      }),
    ).toEqual(['Elige el tipo.', 'Campo raro']);
  });
});
