import { describe, expect, it } from 'vitest';
import {
  bloqueoSii,
  camposDe,
  declaracionCompleta,
  type EntradaPlan,
  elegirEmpresa,
  esAsciiImprimible,
  esquemaCorreoProveedorSet,
  esquemaFolioInicial,
  faltanFolios,
  inciertasSinRevisar,
  operacionEnCurso,
  type PlanPaso,
  pasosCompletos,
  planAsistente,
  postulacionCompleta,
  presentarEstadoEnvio,
  presentarResultado,
  textoEnCurso,
  validarDeclaracion,
  validarPostulacion,
} from './logica';

const BASE: EntradaPlan = {
  etapa: 'borrador',
  admin: true,
  empresaActiva: true,
  autorizadaProduccion: false,
  tieneCertificado: true,
  operacionEnCurso: false,
  inciertaSinRevisar: false,
  postulacionCompleta: true,
  declaracionCompleta: true,
  casos: 5,
  foliosDisponibles: null,
  envio: null,
};

function enCurso(plan: PlanPaso[]): PlanPaso {
  const paso = plan.find((p) => p.estado === 'en_curso');
  if (!paso) throw new Error('sin paso en curso');
  return paso;
}

function acciones(e: Partial<EntradaPlan>) {
  return enCurso(planAsistente({ ...BASE, ...e })).acciones.map((a) => ({
    accion: a.accion,
    habilitada: a.habilitada,
  }));
}

describe('planAsistente', () => {
  it('da los 5 pasos con su estado según la etapa', () => {
    const plan = planAsistente({ ...BASE, etapa: 'set_enviado', envio: null });
    expect(plan.map((p) => p.estado)).toEqual([
      'completo',
      'completo',
      'en_curso',
      'pendiente',
      'pendiente',
    ]);
    expect(plan.map((p) => p.numero)).toEqual([1, 2, 3, 4, 5]);
  });

  it('paso 1: guardar siempre; postular solo con los datos guardados', () => {
    expect(acciones({ postulacionCompleta: false })).toEqual([
      { accion: 'guardarPostulacion', habilitada: true },
      { accion: 'postular', habilitada: false },
    ]);
    expect(acciones({})).toEqual([
      { accion: 'guardarPostulacion', habilitada: true },
      { accion: 'postular', habilitada: true },
    ]);
    const paso = enCurso(planAsistente({ ...BASE, postulacionCompleta: false }));
    expect(paso.falta).toMatch(/guarda los datos/i);
    expect(paso.acciones[1]?.motivo).toMatch(/Guarda primero/);
  });

  it('paso 2: descargar el set', () => {
    expect(acciones({ etapa: 'postulada' })).toEqual([
      { accion: 'descargarSet', habilitada: true },
    ]);
  });

  it('paso 3 sin folios: solicitar folios y enviar deshabilitado', () => {
    expect(acciones({ etapa: 'set_descargado', foliosDisponibles: null })).toEqual([
      { accion: 'solicitarFolios', habilitada: true },
      { accion: 'enviarSet', habilitada: false },
    ]);
    // Un CAF con menos folios que casos tampoco alcanza.
    expect(acciones({ etapa: 'set_descargado', foliosDisponibles: 3 })[0]?.accion).toBe(
      'solicitarFolios',
    );
  });

  it('paso 3 con folios: enviar el set', () => {
    const plan = planAsistente({ ...BASE, etapa: 'set_descargado', foliosDisponibles: 5 });
    expect(enCurso(plan).acciones).toEqual([{ accion: 'enviarSet', habilitada: true }]);
    expect(enCurso(plan).falta).toBe('Envía el set de pruebas al SII.');
  });

  it('paso 3 enviado: consultar el estado, sin reenviar', () => {
    expect(
      acciones({
        etapa: 'set_enviado',
        foliosDisponibles: 0,
        envio: { trackId: '0219302214', estado: 'en_proceso', incierto: false },
      }),
    ).toEqual([{ accion: 'consultarEstadoSet', habilitada: true }]);
  });

  it('paso 3 rechazado: permite volver a enviar (y pedir folios si faltan)', () => {
    expect(
      acciones({
        etapa: 'set_enviado',
        foliosDisponibles: 0,
        envio: { trackId: '1', estado: 'rechazado', incierto: false },
      }),
    ).toEqual([
      { accion: 'solicitarFolios', habilitada: true },
      { accion: 'enviarSet', habilitada: false },
      { accion: 'consultarEstadoSet', habilitada: true },
    ]);
  });

  it('paso 3 aceptado con reparos: no avanza y permite volver a enviar', () => {
    const plan = planAsistente({
      ...BASE,
      etapa: 'set_enviado',
      foliosDisponibles: 5,
      envio: { trackId: '1', estado: 'aceptado_con_reparos', incierto: false },
    });
    expect(enCurso(plan).falta).toMatch(/con reparos/);
    expect(enCurso(plan).acciones.map((a) => a.accion)).toEqual([
      'enviarSet',
      'consultarEstadoSet',
    ]);
  });

  it('paso 3 incierto: explica que hay que revisar en el SII', () => {
    const paso = enCurso(
      planAsistente({
        ...BASE,
        etapa: 'set_enviado',
        envio: { trackId: null, estado: 'incierto', incierto: true },
      }),
    );
    expect(paso.falta).toMatch(/No sabemos si el set llegó/);
    expect(paso.acciones.some((a) => a.accion === 'consultarEstadoSet')).toBe(false);
  });

  it('paso 4: solicitar revisión y después consultar', () => {
    expect(acciones({ etapa: 'set_aceptado' })).toEqual([
      { accion: 'solicitarRevision', habilitada: true },
    ]);
    expect(acciones({ etapa: 'revision_solicitada' })).toEqual([
      { accion: 'consultarEstadoDeclaracion', habilitada: true },
    ]);
  });

  it('paso 5: declarar solo con los datos guardados', () => {
    expect(acciones({ etapa: 'por_declarar', declaracionCompleta: false })).toEqual([
      { accion: 'guardarDeclaracion', habilitada: true },
      { accion: 'declarar', habilitada: false },
      { accion: 'consultarEstadoDeclaracion', habilitada: true },
    ]);
  });

  it('autorizada: todo completo y sin acciones', () => {
    const plan = planAsistente({ ...BASE, etapa: 'autorizada' });
    expect(plan.every((p) => p.estado === 'completo' && p.acciones.length === 0)).toBe(true);
    // La marca de la empresa manda aunque el proceso diga otra etapa.
    const marcada = planAsistente({ ...BASE, etapa: 'por_declarar', autorizadaProduccion: true });
    expect(marcada.every((p) => p.estado === 'completo')).toBe(true);
  });

  it('lector o emisor: ve el estado y lo que falta, sin acciones', () => {
    const paso = enCurso(planAsistente({ ...BASE, admin: false, etapa: 'postulada' }));
    expect(paso.acciones).toEqual([]);
    expect(paso.falta).toMatch(/Descarga el set/);
  });

  it('una operación en curso deshabilita lo que sale al SII, no los formularios', () => {
    expect(acciones({ operacionEnCurso: true })).toEqual([
      { accion: 'guardarPostulacion', habilitada: true },
      { accion: 'postular', habilitada: false },
    ]);
    const paso = enCurso(planAsistente({ ...BASE, operacionEnCurso: true }));
    expect(paso.acciones[1]?.motivo).toMatch(/operación en curso/);
  });
});

describe('bloqueoSii', () => {
  it('prioriza autorizada, desactivada, sin certificado, en curso e incierta', () => {
    expect(bloqueoSii(BASE)).toBeNull();
    expect(bloqueoSii({ ...BASE, tieneCertificado: false })).toMatch(/certificado predeterminado/);
    expect(bloqueoSii({ ...BASE, empresaActiva: false, tieneCertificado: false })).toMatch(
      /desactivada/,
    );
    expect(bloqueoSii({ ...BASE, inciertaSinRevisar: true })).toMatch(/por verificar/);
    expect(bloqueoSii({ ...BASE, etapa: 'autorizada', operacionEnCurso: true })).toMatch(
      /autorizada/,
    );
  });
});

describe('folios y progreso', () => {
  it('faltanFolios usa 5 por defecto si aún no hay casos', () => {
    expect(faltanFolios({ casos: 0, foliosDisponibles: 4 })).toBe(true);
    expect(faltanFolios({ casos: 0, foliosDisponibles: 5 })).toBe(false);
    expect(faltanFolios({ casos: 8, foliosDisponibles: null })).toBe(true);
  });

  it('pasosCompletos', () => {
    expect(pasosCompletos('borrador')).toBe(0);
    expect(pasosCompletos('set_enviado')).toBe(2);
    expect(pasosCompletos('por_declarar')).toBe(4);
    expect(pasosCompletos('autorizada')).toBe(5);
  });
});

describe('operaciones', () => {
  const ops = [
    {
      id: 'a',
      operacion: 'postular',
      resultado: 'ok',
      iniciadaEn: '2026-11-10T17:00:00Z',
      revisada: false,
    },
    {
      id: 'b',
      operacion: 'enviar_set',
      resultado: 'incierto',
      iniciadaEn: '2026-11-11T17:00:00Z',
      revisada: false,
    },
    {
      id: 'c',
      operacion: 'estado_envio',
      resultado: 'incierto',
      iniciadaEn: '2026-11-12T17:00:00Z',
      revisada: false,
    },
    {
      id: 'd',
      operacion: 'declarar',
      resultado: 'incierto',
      iniciadaEn: '2026-11-09T17:00:00Z',
      revisada: true,
    },
    {
      id: 'e',
      operacion: 'solicitar_folios',
      resultado: 'en_curso',
      iniciadaEn: '2026-11-13T17:32:00Z',
      revisada: false,
    },
  ] as const;

  it('la operación en curso es la más reciente en_curso', () => {
    const ahora = new Date('2026-11-13T17:40:00Z');
    expect(operacionEnCurso(ops, ahora)?.id).toBe('e');
    expect(operacionEnCurso(ops.slice(0, 4), ahora)).toBeNull();
  });

  it('solo bloquean las inciertas sin revisar de operaciones que graban', () => {
    expect(inciertasSinRevisar(ops, new Date('2026-11-13T17:40:00Z')).map((o) => o.id)).toEqual([
      'b',
    ]);
  });

  it('una en_curso de más de 15 minutos está abandonada: cuenta como incierta, no en curso', () => {
    const despues = new Date('2026-11-13T17:48:00Z'); // 16 min después de 'e'
    expect(operacionEnCurso(ops, despues)).toBeNull();
    expect(inciertasSinRevisar(ops, despues).map((o) => o.id)).toEqual(['e', 'b']);
    const justo = new Date('2026-11-13T17:46:00Z');
    expect(operacionEnCurso(ops, justo)?.id).toBe('e');
  });

  it('textoEnCurso en hora de Chile, 24 h', () => {
    // 17:32 UTC = 14:32 en Chile (verano, UTC−3).
    expect(textoEnCurso('postular', '2026-11-13T17:32:00Z', new Date('2026-11-13T18:00:00Z'))).toBe(
      'Postulando en el SII desde las 14:32…',
    );
    expect(
      textoEnCurso('solicitar_folios', '2026-11-10T19:18:00Z', new Date('2026-11-13T18:00:00Z')),
    ).toBe('Solicitando folios al SII desde el 10-11-2026 16:18…');
  });

  it('presentarResultado usa los tonos del design system', () => {
    expect(presentarResultado('ok')).toMatchObject({ texto: 'Completada', tono: 'exito' });
    expect(presentarResultado('incierto')).toMatchObject({ texto: 'Por verificar', tono: 'aviso' });
    expect(presentarResultado('rechazo_sii').tono).toBe('error');
    expect(presentarResultado('en_curso').tono).toBe('info');
  });

  it('presentarEstadoEnvio', () => {
    expect(presentarEstadoEnvio('aceptado_con_reparos')).toEqual({
      texto: 'Aceptado con reparos',
      tono: 'aviso',
    });
    expect(presentarEstadoEnvio('pendiente').tono).toBe('info');
  });
});

describe('validarPostulacion', () => {
  const valido = {
    rutAdministrador: '12.865.430-5',
    correoAdministrador: 'admin@empresa.cl',
    correoContactoSii: 'contacto@empresa.cl',
    correoIntercambio: 'dte@empresa.cl',
    nombreSoftware: 'Boleteame',
    boletaExenta: 'on',
    url: '',
  };

  it('normaliza el RUT, la casilla y la URL vacía', () => {
    const r = validarPostulacion(valido);
    expect(r).toEqual({
      ok: true,
      datos: {
        rutAdministrador: '12865430-5',
        correoAdministrador: 'admin@empresa.cl',
        correoContactoSii: 'contacto@empresa.cl',
        correoIntercambio: 'dte@empresa.cl',
        nombreSoftware: 'Boleteame',
        boletaExenta: true,
        url: undefined,
      },
    });
    const sinCasilla = validarPostulacion({ ...valido, boletaExenta: undefined });
    expect(sinCasilla.ok && sinCasilla.datos.boletaExenta).toBe(false);
  });

  it('rechaza tildes y ñ en lo que va al asistente del SII', () => {
    const r = validarPostulacion({ ...valido, nombreSoftware: 'Boletéame', url: 'www.ñandú.cl' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errores.nombreSoftware).toMatch(/ASCII/);
      expect(r.errores.url).toMatch(/ASCII/);
    }
  });

  it('da un error por campo', () => {
    const r = validarPostulacion({
      ...valido,
      rutAdministrador: '12.865.430-4',
      correoAdministrador: 'admin+sii@empresa.cl',
      nombreSoftware: 'x'.repeat(31),
      url: 'empresa.cl',
      correoIntercambio: '',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(Object.keys(r.errores).sort()).toEqual([
        'correoAdministrador',
        'correoIntercambio',
        'nombreSoftware',
        'rutAdministrador',
        'url',
      ]);
      expect(r.errores.url).toMatch(/www\./);
    }
  });
});

describe('validarDeclaracion', () => {
  it('acepta tildes (va por GWT-RPC) y normaliza el RUT', () => {
    const r = validarDeclaracion({
      linkConsulta: 'https://www.empresa.cl/boletas',
      rutProveedor: '76.354.771-K',
      nombreProveedor: 'Proveedor Andino',
      correoProveedor: 'sw@proveedor.cl',
    });
    expect(r.ok && r.datos.rutProveedor).toBe('76354771-K');
    const conTilde = validarDeclaracion({
      linkConsulta: 'https://www.empresa.cl/boletas',
      rutProveedor: '76354771-K',
      nombreProveedor: 'Compañía Ñandú',
      correoProveedor: 'sw@proveedor.cl',
    });
    expect(conTilde.ok).toBe(true);
  });

  it('exige todos los campos', () => {
    const r = validarDeclaracion({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errores)).toHaveLength(4);
  });
});

describe('otros esquemas y utilidades', () => {
  it('correo del proveedor del set: opcional y con la regla del SII', () => {
    expect(esquemaCorreoProveedorSet.parse('  ')).toBeUndefined();
    expect(esquemaCorreoProveedorSet.parse('sw@proveedor.cl')).toBe('sw@proveedor.cl');
    expect(esquemaCorreoProveedorSet.safeParse('sw@proveedor').success).toBe(false);
  });

  it('folio inicial: entero positivo', () => {
    expect(esquemaFolioInicial.safeParse(101).success).toBe(true);
    expect(esquemaFolioInicial.safeParse(0).success).toBe(false);
    expect(esquemaFolioInicial.safeParse(1.5).success).toBe(false);
    expect(esquemaFolioInicial.safeParse(Number.NaN).success).toBe(false);
  });

  it('esAsciiImprimible', () => {
    expect(esAsciiImprimible('Software Propio 2.0')).toBe(true);
    expect(esAsciiImprimible('Diseño')).toBe(false);
    expect(esAsciiImprimible('a\tb')).toBe(false);
  });

  it('postulacionCompleta y declaracionCompleta', () => {
    expect(postulacionCompleta(null)).toBe(false);
    expect(
      postulacionCompleta({
        rutAdministrador: '1-9',
        correoAdministrador: 'a@b.cl',
        correoContactoSii: 'a@b.cl',
        correoIntercambio: 'a@b.cl',
        nombreSoftware: ' ',
      }),
    ).toBe(false);
    expect(
      declaracionCompleta({
        linkConsulta: 'x',
        rutProveedor: '1-9',
        nombreProveedor: 'x',
        correoProveedor: 'a@b.cl',
      }),
    ).toBe(true);
  });

  it('camposDe ignora los archivos', () => {
    const f = new FormData();
    f.set('a', '1');
    f.set('b', new Blob(['x']), 'x.txt');
    expect(camposDe(f)).toEqual({ a: '1' });
  });

  it('elegirEmpresa: pedida, última, primera sin autorizar, primera', () => {
    const empresas = [
      { id: 'a', activa: true, autorizadaProduccion: true },
      { id: 'b', activa: false, autorizadaProduccion: false },
      { id: 'c', activa: true, autorizadaProduccion: false },
    ];
    expect(elegirEmpresa(empresas, 'b', 'a')?.id).toBe('b');
    expect(elegirEmpresa(empresas, 'otra', 'a')?.id).toBe('a');
    expect(elegirEmpresa(empresas, null, null)?.id).toBe('c');
    expect(elegirEmpresa(empresas.slice(0, 2), null, null)?.id).toBe('a');
    expect(elegirEmpresa([], 'a', 'a')).toBeNull();
  });
});
