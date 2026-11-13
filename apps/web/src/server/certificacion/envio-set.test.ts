import {
  ErrorRespuestaSii,
  ErrorTransporte,
  EstadoEnvioRest,
  parsearSetPruebas,
} from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { cafPrueba } from '../../../test/caf-prueba';
import {
  CLAVE_PFX,
  EMPRESA,
  escenario,
  ORG,
  operacionDe,
  RUT_EMPRESA,
  RUT_TITULAR,
  SET_PRUEBAS,
  TOKEN_SII,
  todoLoEscrito,
  USUARIO,
} from '../../../test/certificacion-prueba';
import { consultarEstadoSet, enviarSet } from './envio-set';
import { marcarRevisada } from './operaciones';

const PROCESO = '55555555-5555-4555-8555-555555555555';
const CAF = { desde: 1, hasta: 10 };

function casosDelSet() {
  return parsearSetPruebas(SET_PRUEBAS, '39').map((c, i) => ({
    id: `caso-${i + 1}`,
    organizacion_id: ORG,
    proceso_id: PROCESO,
    numero_caso: i + 1,
    tipo_dte: 39,
    detalles: c.detalles,
    referencia_codigo: c.referencia.codigo,
    referencia_razon: c.referencia.razon,
    documento_id: null,
  }));
}

function escenarioEnvio(opciones: { etapa?: string; folios?: number; resolucion?: boolean } = {}) {
  const { xml, rsask } = cafPrueba({ desde: CAF.desde, hasta: opciones.folios ?? CAF.hasta });
  const e = escenario({
    etapa: opciones.etapa ?? 'set_descargado',
    tablas: {
      set_pruebas_casos: casosDelSet(),
      cafs: [
        {
          id: 'caf-1',
          organizacion_id: ORG,
          empresa_id: EMPRESA,
          ambiente: 'certificacion',
          tipo_dte: 39,
          folio_desde: CAF.desde,
          folio_hasta: opciones.folios ?? CAF.hasta,
          siguiente_folio: 1,
          estado: 'activo',
          caf_secret_id: 'caf-secreto',
          idk: 100,
        },
      ],
      resoluciones:
        opciones.resolucion === false
          ? []
          : [
              {
                id: 'res-1',
                organizacion_id: ORG,
                empresa_id: EMPRESA,
                ambiente: 'certificacion',
                numero: 0,
                fecha: '2026-11-10',
                vigente: true,
              },
            ],
    },
  });
  e.falso.secretos.set('caf-secreto', xml);
  return { ...e, rsask };
}

describe('enviarSet', () => {
  it('ensayo: resume casos, folios y resolución sin asignar folios ni salir al SII', async () => {
    const e = escenarioEnvio();
    const r = await enviarSet(e.ctx, { confirmada: false }, e.deps);
    expect(r.tipo).toBe('ensayo');
    if (r.tipo !== 'ensayo') return;
    expect(r.resumen.filas).toContainEqual({
      etiqueta: 'Casos',
      valor: 'CASO-1, CASO-2, CASO-3, CASO-4, CASO-5',
    });
    expect(r.resumen.filas).toContainEqual({
      etiqueta: 'Resolución',
      valor: 'N.º 0 del 10-11-2026',
    });
    expect(r.resumen.filas).toContainEqual({
      etiqueta: 'Receptor',
      valor: '66.666.666-6 Cliente General',
    });
    expect(e.falso.escrituras).toEqual([]);
    expect(e.falso.rpcs.map((x) => x.nombre)).not.toContain('asignar_folio');
    expect(e.rest.obtenerToken).not.toHaveBeenCalled();
  });

  it('sin resolución de certificación: config, sin filas', async () => {
    const e = escenarioEnvio({ resolucion: false });
    const r = await enviarSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'config' });
    expect(e.falso.tabla('operaciones_sii')).toEqual([]);
  });

  it('sin folios suficientes: config, sin asignar', async () => {
    const e = escenarioEnvio({ folios: 3 });
    const r = await enviarSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'config' });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('necesita 5 y hay 3');
  });

  it('confirmada: arma las 5 boletas, las guarda y sube el sobre por REST', async () => {
    const e = escenarioEnvio();
    const r = await enviarSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') expect(r.mensaje.detalle).toContain('123456789');

    const [envio] = e.falso.tabla('envios');
    expect(envio).toMatchObject({
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      ambiente: 'certificacion',
      canal: 'rest',
      proposito: 'set_pruebas',
      rut_envia: RUT_TITULAR,
      nro_resol: 0,
      fch_resol: '2026-11-10',
      track_id: '123456789',
      estado_sii: 'REC',
      incierto: false,
      nombre_archivo: 'envio.xml',
    });
    expect(String(envio?.xml_path)).toBe(
      `${ORG}/${EMPRESA}/certificacion/EnvioBOLETA-set-${envio?.id}.xml`,
    );

    const documentos = e.falso.tabla('documentos');
    expect(documentos.map((d) => [d.caso_set, d.folio, d.estado, d.origen])).toEqual([
      [1, 1, 'enviado', 'set_pruebas'],
      [2, 2, 'enviado', 'set_pruebas'],
      [3, 3, 'enviado', 'set_pruebas'],
      [4, 4, 'enviado', 'set_pruebas'],
      [5, 5, 'enviado', 'set_pruebas'],
    ]);
    expect(documentos[0]).toMatchObject({
      receptor_rut: '66666666-6',
      receptor_razon_social: 'Cliente General',
      referencia_codigo: 'SET',
      referencia_razon: 'CASO-1',
      mnt_total: 19900 + 9900,
      envio_id: envio?.id,
      caf_id: 'caf-1',
      creado_por: USUARIO,
    });
    // El caso 4 trae un ítem exento.
    expect(documentos[3]?.mnt_exe).toBe(2000);
    expect(String(documentos[0]?.ted_xml)).toMatch(/^<TED version="1\.0">/);
    expect(e.falso.tabla('documento_detalles').length).toBeGreaterThanOrEqual(5);
    expect(e.falso.tabla('set_pruebas_casos').map((c) => c.documento_id)).toEqual(
      documentos.map((d) => d.id),
    );
    expect(e.falso.tabla('cafs')[0]?.siguiente_folio).toBe(6);

    // 5 DTE + el sobre en Storage, ISO-8859-1 tal cual.
    expect(e.falso.storage.size).toBe(6);
    const [token, rut, rutEnvia, sobre] = e.rest.enviarBoleta.mock.calls[0] as [
      string,
      string,
      string,
      Buffer,
    ];
    expect([token, rut, rutEnvia]).toEqual([TOKEN_SII, RUT_EMPRESA, RUT_TITULAR]);
    const texto = sobre.toString('latin1');
    expect(texto).toContain('<EnvioBOLETA');
    expect(texto).toContain('<RUTRecep>66666666-6</RUTRecep>');
    expect(texto).toContain('<RazonRef>CASO-5</RazonRef>');
    expect(texto).toContain('<FchResol>2026-11-10</FchResol>');

    const proceso = e.falso.tabla('procesos_certificacion')[0];
    expect(proceso).toMatchObject({ etapa: 'set_enviado', envio_set_id: envio?.id });
    const [op] = e.falso.tabla('operaciones_sii');
    expect(op).toMatchObject({
      operacion: 'enviar_set',
      resultado: 'ok',
      canal: 'rest',
      envio_id: envio?.id,
    });
    expect(e.correo.enviar).toHaveBeenCalledTimes(1);

    const escrito = todoLoEscrito(e) + JSON.stringify(r);
    for (const secreto of [TOKEN_SII, CLAVE_PFX, 'RSASK', e.rsask.split('\n')[1] ?? '-']) {
      expect(escrito).not.toContain(secreto);
    }
    expect(e.transporteFalso.enviadas).toEqual([]);
  });

  it('sin Track ID por ErrorTransporte después de salir: envío y documentos inciertos, y bloquea reenviar', async () => {
    const e = escenarioEnvio();
    e.rest.enviarBoleta.mockRejectedValueOnce(
      new ErrorTransporte(
        'Se cortó la conexión',
        'https://pangal.sii.cl/recursos/v1/boleta.electronica.envio',
      ),
    );
    const r = await enviarSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('los folios 1 a 5');

    const [envio] = e.falso.tabla('envios');
    expect(envio).toMatchObject({ incierto: true, track_id: null, clasificacion: 'incierto' });
    expect(e.falso.tabla('documentos').every((d) => d.estado === 'incierto')).toBe(true);
    expect(e.falso.tabla('folios_anulados')).toEqual([]);
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('set_descargado');
    // Enlazado al proceso para que el asistente muestre el aviso del envío incierto.
    expect(e.falso.tabla('procesos_certificacion')[0]?.envio_set_id).toBe(envio?.id);

    // Reenviar (incluso el ensayo) queda bloqueado hasta marcarlo como revisado.
    const otra = await enviarSet(e.ctx, { confirmada: false }, e.deps);
    expect(otra).toMatchObject({
      tipo: 'error',
      motivo: 'incierto_sin_revisar',
      operacionPendienteId: operacionDe(r),
    });
    expect(e.rest.enviarBoleta).toHaveBeenCalledTimes(1);

    const revisada = await marcarRevisada(e.ctx, String(operacionDe(r)), e.deps);
    expect(revisada.tipo).toBe('ok');
    const ahora = await enviarSet(e.ctx, { confirmada: false }, e.deps);
    expect(ahora.tipo).toBe('ensayo');
  });

  it('dos envíos simultáneos: el bloqueo del certificado deja pasar uno solo', async () => {
    const e = escenarioEnvio();
    const [a, b] = await Promise.all([
      enviarSet(e.ctx, { confirmada: true }, e.deps),
      enviarSet(e.ctx, { confirmada: true }, e.deps),
    ]);
    expect(e.rest.enviarBoleta).toHaveBeenCalledTimes(1);
    expect([a.tipo, b.tipo].sort()).toEqual(['error', 'ok']);
    expect(e.falso.tabla('envios')).toHaveLength(1);
  });

  it('falla antes de salir con folios asignados: los folios quedan anulados', async () => {
    const e = escenarioEnvio();
    e.rest.obtenerToken.mockRejectedValueOnce(
      new ErrorTransporte(
        'No se pudo conectar',
        'https://apicert.sii.cl/recursos/v1/boleta.electronica.semilla',
      ),
    );
    const r = await enviarSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'transporte' });
    expect(e.rest.enviarBoleta).not.toHaveBeenCalled();
    expect(e.falso.tabla('folios_anulados').map((f) => [f.caf_id, f.folio, f.anulado_por])).toEqual(
      [
        ['caf-1', 1, USUARIO],
        ['caf-1', 2, USUARIO],
        ['caf-1', 3, USUARIO],
        ['caf-1', 4, USUARIO],
        ['caf-1', 5, USUARIO],
      ],
    );
    expect(e.falso.tabla('documentos').every((d) => d.estado === 'anulado')).toBe(true);
    expect(e.falso.tabla('envios')[0]?.error).toContain('no se alcanzó a enviar');
  });

  it('rechazo del SII sin Track ID: rechazo_sii y folios anulados', async () => {
    const e = escenarioEnvio();
    e.rest.enviarBoleta.mockRejectedValueOnce(
      new ErrorRespuestaSii('El SII no devolvió el trackid.'),
    );
    const r = await enviarSet(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'rechazo_sii' });
    expect(e.falso.tabla('folios_anulados')).toHaveLength(5);
  });

  it('antes de descargar el set no se envía', async () => {
    const e = escenarioEnvio({ etapa: 'postulada' });
    const r = await enviarSet(e.ctx, { confirmada: false }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'uso' });
  });
});

describe('consultarEstadoSet', () => {
  async function enviado() {
    const e = escenarioEnvio();
    const r = await enviarSet(e.ctx, { confirmada: true }, e.deps);
    if (r.tipo !== 'ok') throw new Error('el envío de preparación falló');
    e.correo.enviar.mockClear();
    return e;
  }

  it('EPR limpio: guarda estado, estadísticas y consulta, acepta las boletas y avanza a set_aceptado', async () => {
    const e = await enviado();
    e.rest.consultarEnvio.mockResolvedValueOnce(
      EstadoEnvioRest.desdeJson(
        {
          trackid: 123456789,
          estado: 'EPR',
          estadistica: [{ tipo: 39, informados: 5, aceptados: 5, rechazados: 0, reparos: 0 }],
          detalle_rep_rech: [],
        },
        '123456789',
      ),
    );
    const r = await consultarEstadoSet(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    expect(e.rest.consultarEnvio.mock.calls[0]?.slice(1)).toEqual([RUT_EMPRESA, '123456789']);
    const [envio] = e.falso.tabla('envios');
    expect(envio).toMatchObject({
      estado_sii: 'EPR',
      aceptados: 5,
      informados: 5,
      consultas: 1,
      clasificacion: 'aceptado',
    });
    expect(e.falso.tabla('envio_estadisticas')).toMatchObject([{ tipo_dte: 39, aceptados: 5 }]);
    expect(e.falso.tabla('consultas_envio')).toMatchObject([{ estado_sii: 'EPR', aceptados: 5 }]);
    expect(e.falso.tabla('documentos').every((d) => d.estado === 'aceptado')).toBe(true);
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('set_aceptado');
    const ops = e.falso.tabla('operaciones_sii');
    expect(ops.at(-1)).toMatchObject({
      operacion: 'estado_envio',
      resultado: 'ok',
      envio_id: envio?.id,
    });
    expect(e.correo.enviar).toHaveBeenCalledTimes(1);
  });

  it('EPR con un rechazo: guarda el rechazo, rechaza esa boleta y no avanza', async () => {
    const e = await enviado();
    e.rest.consultarEnvio.mockResolvedValueOnce(
      EstadoEnvioRest.desdeJson(
        {
          estado: 'EPR',
          estadistica: [{ tipo: 39, informados: 5, aceptados: 4, rechazados: 1, reparos: 0 }],
          detalle_rep_rech: [
            {
              tipo: 39,
              folio: 2,
              estado: 'RCH',
              descripcion: 'Documento rechazado',
              error: [
                { seccion: 'DTE', codigo: 123, descripcion: 'Monto mal calculado', detalle: '' },
              ],
            },
          ],
        },
        '123456789',
      ),
    );
    const r = await consultarEstadoSet(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'set_rechazado' });
    const [rechazo] = e.falso.tabla('envio_rechazos');
    const documentos = e.falso.tabla('documentos');
    expect(rechazo).toMatchObject({
      folio: 2,
      tipo_observacion: 'rechazo',
      documento_id: documentos[1]?.id,
    });
    expect(documentos.map((d) => d.estado)).toEqual([
      'aceptado',
      'rechazado',
      'aceptado',
      'aceptado',
      'aceptado',
    ]);
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('set_enviado');
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });

  it('en proceso: avisa que vuelva a consultar', async () => {
    const e = await enviado();
    e.rest.consultarEnvio.mockResolvedValueOnce(
      EstadoEnvioRest.desdeJson({ estado: 'SOK' }, '123456789'),
    );
    const r = await consultarEstadoSet(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo === 'ok') expect(r.mensaje.titulo).toContain('todavía está validando');
  });

  it('una falla de red queda en consultas_envio y en transporte', async () => {
    const e = await enviado();
    e.rest.consultarEnvio.mockRejectedValueOnce(
      new ErrorTransporte(
        'HTTP 503',
        'https://apicert.sii.cl/recursos/v1/boleta.electronica.envio/x',
        503,
      ),
    );
    const r = await consultarEstadoSet(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'transporte' });
    expect(e.falso.tabla('consultas_envio')[0]?.error).toContain('ErrorTransporte');
  });

  it('sin envío del set: uso', async () => {
    const e = escenarioEnvio();
    const r = await consultarEstadoSet(e.ctx, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'uso' });
  });
});
