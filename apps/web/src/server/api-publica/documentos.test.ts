import { describe, expect, it, vi } from 'vitest';
import { MENSAJES_ERROR } from '@/lib/api-publica';
import type { ResultadoEmision } from '@/lib/emision';
import type { DependenciasApi } from './dependencias';
import { manejarDocumento, manejarEmision, manejarListado } from './documentos';
import { aBorrador, esquemaEmisionApi, validar } from './esquemas';
import { huella } from './idempotencia';
import { manejarApi } from './manejar';
import {
  API_KEY,
  BOLETA,
  CLAVE_TEST,
  claveCompleta,
  dependenciasPrueba,
  EMPRESA,
  EMPRESA_2,
  emisorFalso,
  filaDocumento,
  HEX,
  ORG,
  OTRA_ORG,
  peticion,
  type RepositorioMemoria,
  RUT_EMPRESA_2,
  repositorioMemoria,
} from './repositorio-memoria.test-util';

function emitir(
  deps: DependenciasApi,
  opciones: { cuerpo?: unknown; idempotencia?: string; ruta?: string } = {},
) {
  return manejarApi(
    peticion(opciones.ruta ?? '/documentos', {
      cuerpo: opciones.cuerpo ?? BOLETA,
      ...(opciones.idempotencia === ''
        ? {}
        : { idempotencia: opciones.idempotencia ?? 'pedido-1' }),
    }),
    { ruta: 'POST /documentos', alcance: 'documentos:emitir' },
    manejarEmision,
    deps,
  );
}

function fallo(motivo: string, extra: Partial<Extract<ResultadoEmision, { tipo: 'error' }>> = {}) {
  return {
    tipo: 'error',
    mensaje: { titulo: 'Título', detalle: 'Detalle de la emisión.' },
    motivo,
    operacionId: null,
    ...extra,
  } as ResultadoEmision;
}

describe('POST /documentos: emisión con Idempotency-Key', () => {
  it('201 con el documento y Location; emite con usuarioId null, la API key y la clave', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m);
    const r = await emitir(deps);
    expect(r.status).toBe(201);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('Idempotent-Replayed')).toBeNull();
    const doc = await r.json();
    expect(doc).toMatchObject({
      objeto: 'documento',
      empresa: { id: EMPRESA, rut: '76123456-0' },
      ambiente: 'certificacion',
      tipo_dte: 39,
      folio: 43,
      estado: 'enviado',
      origen: 'api',
      clave_idempotencia: 'pedido-1',
      envio: { track_id: '34015200' },
      lineas: [{ nro: 1, nombre: 'Café', monto: 1190 }],
    });
    expect(r.headers.get('Location')).toBe(`/api/v1/documentos/${doc.id}`);
    expect(deps.emitir).toHaveBeenCalledWith(
      { organizacionId: ORG, empresaId: EMPRESA, usuarioId: null, apiKeyId: API_KEY },
      expect.objectContaining({ nivel: 'emitir', claveIdempotencia: 'pedido-1' }),
    );
    expect(m.idempotencia.get(`${ORG}:pedido-1`)).toMatchObject({
      estado: 'terminada',
      statusHttp: 201,
      recursoId: doc.id,
    });
  });

  it('repetir con la misma clave y la misma boleta devuelve lo mismo sin emitir otra vez', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m);
    const primera = await emitir(deps);
    const cuerpo = await primera.json();
    const segunda = await emitir(deps, {
      // Mismas llaves en otro orden: misma huella.
      cuerpo: { lineas: BOLETA.lineas, tipo_dte: 39, empresa: '76.123.456-0' },
    });
    expect(segunda.status).toBe(201);
    expect(segunda.headers.get('Idempotent-Replayed')).toBe('true');
    expect(segunda.headers.get('Location')).toBe(`/api/v1/documentos/${cuerpo.id}`);
    expect(await segunda.json()).toEqual(cuerpo);
    expect(deps.emitir).toHaveBeenCalledTimes(1);
    expect(m.documentos).toHaveLength(1);
  });

  it('422 idempotencia_conflicto con la misma clave y otra boleta', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m);
    await emitir(deps);
    const r = await emitir(deps, {
      cuerpo: { ...BOLETA, lineas: [{ nombre: 'Té', cantidad: 1, precio: 990 }] },
    });
    expect(r.status).toBe(422);
    expect((await r.json()).error.codigo).toBe('idempotencia_conflicto');
    expect(deps.emitir).toHaveBeenCalledTimes(1);
  });

  it('409 con Retry-After mientras la primera sigue en curso', async () => {
    const m = repositorioMemoria();
    let soltar: () => void = () => {};
    const enCurso = new Promise<void>((r) => {
      soltar = r;
    });
    const emisor = emisorFalso(m);
    const deps = dependenciasPrueba(m, {
      emitir: vi.fn(async (ctx, entrada) => {
        await enCurso;
        return emisor(ctx, entrada);
      }),
    });
    const primera = emitir(deps);
    await vi.waitFor(() => expect(m.idempotencia.size).toBe(1));
    const segunda = await emitir(deps);
    expect(segunda.status).toBe(409);
    expect(segunda.headers.get('Retry-After')).toBe('5');
    expect((await segunda.json()).error.codigo).toBe('idempotencia_en_curso');
    soltar();
    expect((await primera).status).toBe(201);
  });

  it('400 sin Idempotency-Key y 422 de validación sin ocupar la clave ni emitir', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m);
    const sinClave = await emitir(deps, { idempotencia: '' });
    expect(sinClave.status).toBe(400);
    expect((await sinClave.json()).error.codigo).toBe('idempotencia_requerida');
    const invalida = await emitir(deps, { cuerpo: { ...BOLETA, lineas: [] } });
    expect(invalida.status).toBe(422);
    expect((await invalida.json()).error).toMatchObject({
      codigo: 'datos_invalidos',
      campos: { lineas: 'Agrega al menos una línea.' },
    });
    expect(m.idempotencia.size).toBe(0);
    expect(deps.emitir).not.toHaveBeenCalled();
  });

  it('un error sin documento suelta la clave: repetir con la misma clave vuelve a intentar', async () => {
    const m = repositorioMemoria();
    const emitirFn = vi
      .fn()
      .mockResolvedValueOnce(fallo('sin_folios'))
      .mockImplementation(emisorFalso(m));
    const deps = dependenciasPrueba(m, { emitir: emitirFn });
    const r = await emitir(deps);
    expect(r.status).toBe(422);
    expect((await r.json()).error).toMatchObject({ codigo: 'sin_folios' });
    expect(m.llamadas).toContain('soltar:pedido-1');
    const otra = await emitir(deps);
    expect(otra.status).toBe(201);
    expect(emitirFn).toHaveBeenCalledTimes(2);
  });

  it('traduce los motivos de la emisión a códigos de la API', async () => {
    const casos: [ResultadoEmision, number, string][] = [
      [fallo('cuota'), 403, 'cuota_agotada'],
      [fallo('plan_sin_produccion'), 403, 'plan_sin_produccion'],
      [fallo('sin_resolucion'), 422, 'sin_resolucion'],
      [fallo('config'), 422, 'sin_certificado'],
      [fallo('en_curso'), 409, 'operacion_en_curso'],
      [
        fallo('receptor_sin_razon_social', { errores: { 'receptor.razonSocial': 'Falta' } }),
        422,
        'datos_invalidos',
      ],
      [
        { ...fallo(''), motivo: undefined, resultado: 'transporte' } as ResultadoEmision,
        503,
        'sii_no_disponible',
      ],
      [fallo('borrador_no_encontrado'), 409, 'operacion_en_curso'],
      [fallo('borrador_emitido'), 409, 'operacion_en_curso'],
      [fallo('borrador_cambio'), 409, 'operacion_en_curso'],
      [fallo('folio_anulado'), 409, 'operacion_en_curso'],
      [fallo('documento_incierto'), 409, 'incierto_sin_revisar'],
      [fallo('sin_permiso'), 403, 'alcance_insuficiente'],
      [{ ...fallo('desconocido'), resultado: 'error' } as ResultadoEmision, 500, 'error_interno'],
    ];
    for (const [resultado, status, codigo] of casos) {
      const m = repositorioMemoria();
      const r = await emitir(dependenciasPrueba(m, { emitir: vi.fn(async () => resultado) }));
      expect(r.status, codigo).toBe(status);
      const cuerpo = await r.json();
      expect(cuerpo.error.codigo).toBe(codigo);
      if (codigo === 'datos_invalidos') {
        expect(cuerpo.error.campos).toEqual({ 'receptor.razon_social': 'Falta' });
      }
      if (codigo === 'sii_no_disponible') expect(r.headers.get('Retry-After')).toBe('60');
      if (codigo === 'sin_certificado' || codigo === 'error_interno') {
        expect(cuerpo.error.mensaje).toBe('Detalle de la emisión.');
      }
      // Las carreras con el panel llevan un mensaje de la API, no el del panel.
      const motivo = resultado.tipo === 'error' ? resultado.motivo : undefined;
      if (
        motivo?.startsWith('borrador_') ||
        motivo === 'folio_anulado' ||
        motivo === 'documento_incierto'
      ) {
        expect(cuerpo.error.mensaje).toContain('Idempotency-Key');
      }
    }
  });

  it('un error_interno traducido de la emisión va a Sentry con motivo y resultado, sin datos', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m, {
      emitir: vi.fn(
        async () => ({ ...fallo('desconocido'), resultado: 'error' }) as ResultadoEmision,
      ),
    });
    const r = await emitir(deps);
    expect(r.status).toBe(500);
    expect(deps.capturar).toHaveBeenCalledWith(
      expect.objectContaining({ codigo: 'error_interno' }),
      {
        api_publica_ruta: 'POST /documentos',
        api_publica_motivo: 'desconocido',
        api_publica_resultado: 'error',
      },
    );
    expect(JSON.stringify(await r.json())).not.toContain('diagnostico');
  });

  it('los errores esperados (4xx) no van a Sentry', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m, { emitir: vi.fn(async () => fallo('cuota')) });
    expect((await emitir(deps)).status).toBe(403);
    expect(deps.capturar).not.toHaveBeenCalled();
  });

  it('incierto: 202 con el documento y su aviso, y queda guardado (no se reemite)', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m, { emitir: emisorFalso(m, 'incierto') });
    const r = await emitir(deps);
    expect(r.status).toBe(202);
    const doc = await r.json();
    expect(doc).toMatchObject({
      estado: 'incierto',
      aviso: { titulo: 'No sabemos si el SII recibió la boleta', detalle: 'Revisa en el SII.' },
    });
    const otra = await emitir(deps);
    expect(otra.status).toBe(202);
    expect(otra.headers.get('Idempotent-Replayed')).toBe('true');
    expect(deps.emitir).toHaveBeenCalledTimes(1);
  });

  it('rechazo 4xx del SII: 422 rechazado_por_sii con el documento anulado, guardado', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m, { emitir: emisorFalso(m, 'anulado') });
    const r = await emitir(deps);
    expect(r.status).toBe(422);
    const cuerpo = await r.json();
    // Mensaje del contrato (pide una clave nueva); el texto de la emisión va en documento.aviso.
    expect(cuerpo.error).toMatchObject({
      codigo: 'rechazado_por_sii',
      mensaje: MENSAJES_ERROR.rechazado_por_sii,
      documento: { estado: 'anulado', folio: 43, aviso: { detalle: 'El SII rechazó el envío.' } },
    });
    expect(m.idempotencia.get(`${ORG}:pedido-1`)?.estado).toBe('terminada');
    const otra = await emitir(deps);
    expect(otra.headers.get('Idempotent-Replayed')).toBe('true');
    expect((await otra.json()).error.mensaje).toBe(MENSAJES_ERROR.rechazado_por_sii);
  });

  it('rechazo ya guardado en la base (camino existente): mismo mensaje del contrato', async () => {
    const m = repositorioMemoria({
      documentos: [filaDocumento({ clave_idempotencia: 'pedido-1', estado: 'anulado' })],
    });
    const deps = dependenciasPrueba(m);
    const r = await emitir(deps);
    expect(r.status).toBe(422);
    expect((await r.json()).error.mensaje).toBe(MENSAJES_ERROR.rechazado_por_sii);
    expect(deps.emitir).not.toHaveBeenCalled();
  });

  it('retomada tras una caída: si la boleta ya se emitió, responde su estado sin emitir', async () => {
    const m = repositorioMemoria({
      documentos: [filaDocumento({ clave_idempotencia: 'pedido-1', estado: 'aceptado' })],
    });
    const deps = dependenciasPrueba(m);
    // La primera petición murió en curso (sin soltar ni terminar).
    await m.repo.reclamarIdempotencia({
      organizacionId: ORG,
      clave: 'pedido-1',
      recurso: 'documento',
      huella: huella({
        recurso: 'documento',
        empresa_id: EMPRESA,
        borrador: aBorrador(validar(esquemaEmisionApi, BOLETA), 'certificacion'),
      }),
      apiKeyId: API_KEY,
      arriendoSegundos: 120,
    });
    expect((await emitir(deps)).status).toBe(409);
    m.avanzar(121_000);
    const r = await emitir(deps);
    expect(r.status).toBe(201);
    expect((await r.json()).estado).toBe('aceptado');
    expect(deps.emitir).not.toHaveBeenCalled();
  });

  it('retomada con el borrador ya guardado: emite ESE borrador', async () => {
    const borrador = filaDocumento({
      clave_idempotencia: 'pedido-1',
      estado: 'borrador',
      folio: null,
    });
    const m = repositorioMemoria({ documentos: [borrador] });
    const deps = dependenciasPrueba(m);
    const r = await emitir(deps);
    expect(r.status).toBe(201);
    expect(deps.emitir).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ borradorId: borrador.id }),
    );
    expect(m.documentos).toHaveLength(1);
  });

  it('una excepción inesperada suelta la clave, va a Sentry y responde 500 sin detalles', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m, {
      emitir: vi.fn(async () => {
        throw new Error(`falló con ${CLAVE_TEST}`);
      }),
    });
    const r = await emitir(deps);
    expect(r.status).toBe(500);
    const texto = await r.text();
    expect(texto).not.toContain(HEX);
    expect(JSON.parse(texto).error.codigo).toBe('error_interno');
    expect(m.llamadas).toContain('soltar:pedido-1');
    expect(deps.capturar).toHaveBeenCalledWith(expect.any(Error), {
      api_publica_ruta: 'POST /documentos',
    });
  });
});

describe('POST /documentos: empresa', () => {
  it('422 empresa_requerida si la clave sirve para todas y no viene empresa', async () => {
    const m = repositorioMemoria();
    const r = await emitir(dependenciasPrueba(m), {
      cuerpo: { tipo_dte: 39, lineas: BOLETA.lineas },
    });
    expect(r.status).toBe(422);
    expect((await r.json()).error.codigo).toBe('empresa_requerida');
  });

  it('con empresa en la clave: no hace falta indicarla, y pedir otra da 403', async () => {
    const m = repositorioMemoria({ claves: { [CLAVE_TEST]: { empresaId: EMPRESA } } });
    const deps = dependenciasPrueba(m);
    expect((await emitir(deps, { cuerpo: { tipo_dte: 39, lineas: BOLETA.lineas } })).status).toBe(
      201,
    );
    const otra = await emitir(deps, {
      idempotencia: 'pedido-2',
      cuerpo: { ...BOLETA, empresa: RUT_EMPRESA_2 },
    });
    expect(otra.status).toBe(403);
    expect((await otra.json()).error.codigo).toBe('empresa_no_permitida');
  });

  it('acepta el id de la empresa; una de otra organización no existe (404)', async () => {
    const m = repositorioMemoria({
      empresas: [
        { id: EMPRESA, rut: '76123456-0', razon_social: 'A', activa: true },
        {
          id: EMPRESA_2,
          rut: RUT_EMPRESA_2,
          razon_social: 'B',
          activa: true,
          organizacion_id: OTRA_ORG,
        },
      ],
    });
    const deps = dependenciasPrueba(m);
    expect((await emitir(deps, { cuerpo: { ...BOLETA, empresa: EMPRESA } })).status).toBe(201);
    const ajena = await emitir(deps, {
      idempotencia: 'p2',
      cuerpo: { ...BOLETA, empresa: EMPRESA_2 },
    });
    expect(ajena.status).toBe(404);
  });

  it('422 empresa_inactiva antes de reclamar la clave', async () => {
    const m = repositorioMemoria({
      empresas: [{ id: EMPRESA, rut: '76123456-0', razon_social: 'A', activa: false }],
    });
    const r = await emitir(dependenciasPrueba(m));
    expect((await r.json()).error.codigo).toBe('empresa_inactiva');
    expect(m.idempotencia.size).toBe(0);
  });
});

describe('POST /documentos?ensayo=1', () => {
  it('resume con el folio previsto, sin Idempotency-Key ni emitir', async () => {
    const m = repositorioMemoria();
    const deps = dependenciasPrueba(m);
    const r = await emitir(deps, { ruta: '/documentos?ensayo=1', idempotencia: '' });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      objeto: 'ensayo',
      folio_previsto: 43,
      totales: { neto: 1000, iva: 190, total: 1190 },
    });
    expect(deps.emitir).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ nivel: 'ensayo' }),
    );
    expect(m.idempotencia.size).toBe(0);
    expect(m.documentos).toHaveLength(0);
  });
});

describe('GET /documentos y /documentos/{id}', () => {
  function sembrar(n: number): RepositorioMemoria {
    const documentos = Array.from({ length: n }, (_, i) =>
      filaDocumento({
        id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
        folio: 100 + i,
        creado_en: `2026-11-18T12:00:${String(i).padStart(2, '0')}.000000+00:00`,
      }),
    );
    documentos.push(
      filaDocumento({ estado: 'borrador', folio: null }),
      filaDocumento({ ambiente: 'produccion' }),
      filaDocumento({ organizacion_id: OTRA_ORG }),
    );
    return repositorioMemoria({ documentos });
  }

  function listar(m: RepositorioMemoria, q = '') {
    return manejarApi(
      peticion(`/documentos${q}`),
      { ruta: 'GET /documentos', alcance: 'documentos:leer' },
      manejarListado,
      dependenciasPrueba(m),
    );
  }

  it('pagina por cursor, del más nuevo al más antiguo, sin borradores ni otro ambiente u organización', async () => {
    const m = sembrar(5);
    const p1 = await (await listar(m, '?limite=2')).json();
    expect(p1).toMatchObject({ objeto: 'lista', tiene_mas: true });
    expect(p1.datos.map((d: { folio: number }) => d.folio)).toEqual([104, 103]);
    expect(p1.datos[0].lineas).toBeUndefined();
    const p2 = await (await listar(m, `?limite=2&cursor=${p1.siguiente_cursor}`)).json();
    expect(p2.datos.map((d: { folio: number }) => d.folio)).toEqual([102, 101]);
    const p3 = await (await listar(m, `?limite=2&cursor=${p2.siguiente_cursor}`)).json();
    expect(p3).toMatchObject({ tiene_mas: false, siguiente_cursor: null });
    expect(p3.datos.map((d: { folio: number }) => d.folio)).toEqual([100]);
  });

  it('400 con un cursor alterado o un filtro inválido', async () => {
    const m = sembrar(1);
    expect((await (await listar(m, '?cursor=zzz')).json()).error.codigo).toBe('cursor_invalido');
    expect((await listar(m, '?limite=500')).status).toBe(400);
  });

  it('403 sin el alcance documentos:leer', async () => {
    const m = repositorioMemoria({ claves: { [CLAVE_TEST]: { alcances: ['documentos:emitir'] } } });
    const r = await listar(m);
    expect(r.status).toBe(403);
    expect((await r.json()).error.codigo).toBe('alcance_insuficiente');
  });

  it('el detalle trae líneas; uno de otro ambiente o de otra empresa de la clave es 404', async () => {
    const propio = filaDocumento();
    const delSet = filaDocumento({ origen: 'set_pruebas' });
    const produccion = filaDocumento({ ambiente: 'produccion' });
    const otraEmpresa = filaDocumento({ empresa_id: EMPRESA_2 });
    const m = repositorioMemoria({
      documentos: [propio, delSet, produccion, otraEmpresa],
      claves: { [CLAVE_TEST]: { empresaId: EMPRESA } },
    });
    const ver = (id: string) =>
      manejarApi(
        peticion(`/documentos/${id}`),
        { ruta: 'GET /documentos/{id}', alcance: 'documentos:leer' },
        (ctx) => manejarDocumento(ctx, id),
        dependenciasPrueba(m),
      );
    const r = await ver(propio.id);
    expect(r.status).toBe(200);
    expect((await r.json()).lineas).toHaveLength(1);
    for (const id of [delSet.id, produccion.id, otraEmpresa.id, 'no-es-uuid']) {
      const x = await ver(id);
      expect(x.status).toBe(404);
      expect((await x.json()).error.codigo).toBe('no_encontrado');
    }
  });

  it('401 sin clave, con WWW-Authenticate', async () => {
    const m = repositorioMemoria();
    const r = await manejarApi(
      peticion('/documentos', { clave: null }),
      { ruta: 'GET /documentos', alcance: 'documentos:leer' },
      manejarListado,
      dependenciasPrueba(m),
    );
    expect(r.status).toBe(401);
    expect(r.headers.get('WWW-Authenticate')).toContain('Bearer');
    expect(claveCompleta().apiKeyId).toBe(API_KEY);
  });
});
