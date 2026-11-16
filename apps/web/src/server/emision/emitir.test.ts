import { ErrorRespuestaSii, ErrorTransporte } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import {
  EMPRESA,
  ORG,
  RUT_EMPRESA,
  RUT_TITULAR,
  TOKEN_SII,
  USUARIO,
} from '../../../test/certificacion-prueba';
import {
  borradorConReceptor,
  borradorPrueba,
  CAF_PRODUCCION,
  type EscenarioEmision,
  escenarioEmision,
  RECEPTOR_RUT,
} from '../../../test/emision-prueba';
import { emitirDocumento } from './emitir';

const URL_ENVIO = 'https://rahue.sii.cl/recursos/v1/boleta.electronica.envio';

function emitir(e: EscenarioEmision, borrador = borradorPrueba(), borradorId?: string) {
  return emitirDocumento(
    e.ctx,
    { nivel: 'emitir', borrador, ...(borradorId ? { borradorId } : {}) },
    e.deps,
  );
}

function documentos(e: EscenarioEmision) {
  return e.falso.tabla('documentos');
}

describe('emitirDocumento: ensayo', () => {
  it('resume con el folio previsto y los totales, sin folio, sin red y sin filas', async () => {
    const e = escenarioEmision({ caf: { siguiente: 7 } });
    const r = await emitirDocumento(
      e.ctx,
      { nivel: 'ensayo', borrador: borradorConReceptor() },
      e.deps,
    );
    expect(r.tipo).toBe('ensayo');
    if (r.tipo !== 'ensayo') return;
    expect(r.resumen).toMatchObject({
      operacion: 'emitir',
      ambiente: 'produccion',
      folioPrevisto: 7,
      textoConfirmar: 'Emitir boleta',
      titulo: 'Emitir boleta electrónica en producción',
      certificado: { rut: RUT_TITULAR, titular: 'Titular de Prueba' },
    });
    // 2 × 11.990 afecto + 3.000 exento.
    expect(r.resumen.totales).toMatchObject({ neto: 20151, iva: 3829, exento: 3000, total: 26980 });
    expect(r.resumen.filas).toEqual(
      expect.arrayContaining([
        { etiqueta: 'Empresa', valor: 'EMPRESA DE PRUEBA SPA (76.123.456-0)' },
        { etiqueta: 'Documento', valor: 'Boleta electrónica (39)' },
        { etiqueta: 'Ambiente', valor: 'Producción' },
        { etiqueta: 'Receptor', valor: '11.111.111-1 Cliente Frecuente SpA' },
        { etiqueta: 'Total', valor: '$ 26.980' },
        { etiqueta: 'Resolución', valor: 'N.º 80 del 22-08-2014' },
        { etiqueta: 'Canal', valor: 'API REST de boletas del SII' },
      ]),
    );
    expect(r.resumen.avisos[0]).toContain('documento tributario real');
    expect(r.resumen.avisos[0]).toContain('el folio 7');
    expect(r.resumen.avisos).toContain('Le enviaremos el PDF a pagos@cliente.cl.');

    expect(e.falso.escrituras).toEqual([]);
    expect(e.sesion.escrituras).toEqual([]);
    expect(e.falso.rpcs.map((x) => x.nombre)).not.toContain('asignar_folio');
    expect(e.falso.tabla('cafs').find((c) => c.id === CAF_PRODUCCION)?.siguiente_folio).toBe(7);
    expect(e.rest.obtenerToken).not.toHaveBeenCalled();
    expect(e.opcionesRest).toEqual([]);
  });

  it('en certificación avisa que no tiene validez tributaria', async () => {
    const e = escenarioEmision();
    const r = await emitirDocumento(
      e.ctx,
      { nivel: 'ensayo', borrador: borradorPrueba({ ambiente: 'certificacion' }) },
      e.deps,
    );
    expect(r.tipo).toBe('ensayo');
    if (r.tipo !== 'ensayo') return;
    expect(r.resumen.avisos[0]).toContain('no tiene validez tributaria');
    expect(r.resumen.filas).toContainEqual({
      etiqueta: 'Resolución',
      valor: 'N.º 0 del 10-11-2026',
    });
  });
});

describe('emitirDocumento: validación previa (sin filas ni folios)', () => {
  async function sinFilas(e: EscenarioEmision, borrador = borradorPrueba()) {
    const r = await emitir(e, borrador);
    expect(r.tipo).toBe('error');
    expect(e.falso.tabla('operaciones_sii')).toEqual([]);
    expect(documentos(e)).toEqual([]);
    expect(e.falso.rpcs.map((x) => x.nombre)).not.toContain('asignar_folio');
    expect(e.rest.obtenerToken).not.toHaveBeenCalled();
    return r;
  }

  it('empresa desactivada', async () => {
    const e = escenarioEmision();
    const empresa = e.falso.tabla('empresas')[0];
    if (empresa) empresa.activa = false;
    expect(await sinFilas(e)).toMatchObject({ motivo: 'empresa_inactiva' });
  });

  it('producción sin autorización', async () => {
    const e = escenarioEmision({ autorizada: false });
    expect(await sinFilas(e)).toMatchObject({ motivo: 'sin_autorizacion' });
  });

  it('producción con un plan que no la incluye', async () => {
    const e = escenarioEmision({ plan: 'sin_produccion' });
    expect(await sinFilas(e)).toMatchObject({ motivo: 'plan_sin_produccion' });
  });

  it('sin resolución del ambiente', async () => {
    const e = escenarioEmision({ sinResolucion: 'produccion' });
    const r = await sinFilas(e);
    expect(r).toMatchObject({ motivo: 'sin_resolucion' });
    if (r.tipo === 'error') expect(r.mensaje.titulo).toBe('Falta la resolución de producción');
  });

  it('sin certificado predeterminado', async () => {
    const e = escenarioEmision();
    e.falso.db.empresa_certificados = [];
    expect(await sinFilas(e)).toMatchObject({ motivo: 'config' });
  });

  it('sin folios del tipo', async () => {
    const e = escenarioEmision({ caf: { desde: 1, hasta: 5, siguiente: 6 } });
    const r = await sinFilas(e);
    expect(r).toMatchObject({ motivo: 'sin_folios' });
  });

  it('cuota del mes ya usada (control previo)', async () => {
    const e = escenarioEmision({
      maxBoletasMes: 5,
      tablas: {
        uso_mensual: [{ organizacion_id: ORG, periodo: '2026-11-01', boletas_produccion: 5 }],
      },
    });
    const r = await sinFilas(e);
    expect(r).toMatchObject({ motivo: 'cuota' });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('5 boletas');
  });

  it('receptor identificado sin razón social: marca el campo', async () => {
    const e = escenarioEmision();
    const r = await sinFilas(
      e,
      borradorPrueba({ receptor: { rut: '11111111-1', razonSocial: null, correo: null } }),
    );
    expect(r).toMatchObject({
      motivo: 'receptor_sin_razon_social',
      errores: { 'receptor.razonSocial': 'Falta la razón social del receptor' },
    });
  });
});

describe('emitirDocumento: emisión', () => {
  it('ok en producción: folio, firma, Storage, envío REST, PDF y correo', async () => {
    const e = escenarioEmision();
    const r = await emitir(e, borradorConReceptor());
    expect(r.tipo).toBe('ok');
    if (r.tipo !== 'ok') return;

    const [doc] = documentos(e);
    const [envio] = e.falso.tabla('envios');
    expect(r.documento).toEqual({
      id: doc?.id,
      tipoDte: 39,
      ambiente: 'produccion',
      folio: 1,
      estado: 'enviado',
      total: 26980,
      trackId: '987654321',
      conPdf: true,
      correoEnviado: true,
    });
    expect(r.mensaje.titulo).toBe('Emitimos la boleta electrónica N.º 1');
    expect(r.mensaje.detalle).toContain('987654321');
    expect(r.avisos).toBeUndefined();

    expect(doc).toMatchObject({
      organizacion_id: ORG,
      empresa_id: EMPRESA,
      ambiente: 'produccion',
      tipo_dte: 39,
      folio: 1,
      caf_id: CAF_PRODUCCION,
      estado: 'enviado',
      origen: 'panel',
      creado_por: USUARIO,
      receptor_rut: RECEPTOR_RUT,
      receptor_razon_social: 'Cliente Frecuente SpA',
      mnt_neto: 20151,
      iva: 3829,
      mnt_exe: 3000,
      mnt_total: 26980,
      descuento_aplicado: 0,
      fecha_emision: '2026-11-13',
      envio_id: envio?.id,
      xml_path: `${ORG}/${EMPRESA}/produccion/DTE-39-F1.xml`,
    });
    expect(String(doc?.ted_xml)).toMatch(/^<TED version="1\.0">[\s\S]*<\/TED>$/);
    expect(doc?.metadata).toEqual({
      receptor_correo: 'pagos@cliente.cl',
      pdf: {
        carta: `${ORG}/${EMPRESA}/produccion/DTE-39-F1-carta.pdf`,
        rollo: `${ORG}/${EMPRESA}/produccion/DTE-39-F1-rollo.pdf`,
      },
      correo: { id: 'correo-boleta-1', enviado_en: expect.any(String) },
    });
    expect(e.falso.tabla('documento_detalles').map((l) => [l.nro_linea, l.monto_item])).toEqual([
      [1, 23980],
      [2, 3000],
    ]);
    // Receptor al catálogo (sesión).
    expect(e.falso.tabla('receptores')).toMatchObject([
      { rut: RECEPTOR_RUT, razon_social: 'Cliente Frecuente SpA', correo: 'pagos@cliente.cl' },
    ]);
    expect(doc?.receptor_id).toBe(e.falso.tabla('receptores')[0]?.id);

    expect(envio).toMatchObject({
      ambiente: 'produccion',
      canal: 'rest',
      proposito: 'emision',
      rut_envia: RUT_TITULAR,
      nro_resol: 80,
      fch_resol: '2014-08-22',
      nombre_archivo: 'envio.xml',
      track_id: '987654321',
      estado_sii: 'REC',
      incierto: false,
      xml_path: `${ORG}/${EMPRESA}/produccion/EnvioBOLETA-39-F1.xml`,
    });
    const [op] = e.falso.tabla('operaciones_sii');
    expect(op).toMatchObject({
      operacion: 'emitir',
      ambiente: 'produccion',
      canal: 'rest',
      confirmada: true,
      resultado: 'ok',
      documento_id: doc?.id,
      envio_id: envio?.id,
    });
    expect(r.operacionId).toBe(op?.id);
    expect(op?.detalle).toMatchObject({ folio: 1, track_id: '987654321', intentos: 1 });

    // El cliente REST de PRODUCCIÓN, y el sobre tal cual.
    expect(e.opcionesRest).toHaveLength(1);
    expect(e.opcionesRest[0]?.ambiente).toBe('produccion');
    const [token, rut, rutEnvia, sobre] = e.rest.enviarBoleta.mock.calls[0] as [
      string,
      string,
      string,
      Buffer,
    ];
    expect([token, rut, rutEnvia]).toEqual([TOKEN_SII, RUT_EMPRESA, RUT_TITULAR]);
    const texto = Buffer.from(sobre).toString('latin1');
    expect(texto).toContain('<EnvioBOLETA');
    expect(texto).toContain(`<RUTRecep>${RECEPTOR_RUT}</RUTRecep>`);
    expect(texto).toContain('<NroResol>80</NroResol>');
    expect(texto).toContain('<Folio>1</Folio>');

    // DTE, sobre y los dos PDF en Storage.
    expect([...e.falso.storage.keys()].sort()).toEqual(
      [
        `documentos-xml/${ORG}/${EMPRESA}/produccion/DTE-39-F1-carta.pdf`,
        `documentos-xml/${ORG}/${EMPRESA}/produccion/DTE-39-F1-rollo.pdf`,
        `documentos-xml/${ORG}/${EMPRESA}/produccion/DTE-39-F1.xml`,
        `documentos-xml/${ORG}/${EMPRESA}/produccion/EnvioBOLETA-39-F1.xml`,
      ].sort(),
    );
    expect(e.pdf.mock.calls.map((c) => c[1])).toEqual(['carta', 'rollo']);
    const datosPdf = e.pdf.mock.calls[0]?.[0];
    expect(datosPdf).toMatchObject({
      folio: 1,
      fechaEmision: '2026-11-13',
      resolucion: { numero: 80, fecha: '2014-08-22' },
      totales: { total: 26980, neto: 20151, iva: 3829, exento: 3000 },
      receptor: { rut: RECEPTOR_RUT, razonSocial: 'Cliente Frecuente SpA' },
    });
    expect(datosPdf?.tedXml).toBe(doc?.ted_xml);
    expect(e.correoBoleta).toHaveBeenCalledTimes(1);
    expect(e.correoBoleta.mock.calls[0]?.[0]).toMatchObject({
      para: 'pagos@cliente.cl',
      folio: 1,
      total: 26980,
      claveIdempotencia: `boleta-${doc?.id}`,
      emisor: { rut: RUT_EMPRESA, razonSocial: 'EMPRESA DE PRUEBA SPA' },
    });

    expect(e.falso.tabla('uso_mensual')).toMatchObject([
      { organizacion_id: ORG, periodo: '2026-11-01', boletas_produccion: 1 },
    ]);
    expect(e.falso.tabla('cafs').find((c) => c.id === CAF_PRODUCCION)?.siguiente_folio).toBe(2);
    expect(e.falso.tabla('folios_anulados')).toEqual([]);
    expect(e.transporteFalso.enviadas).toEqual([]);
  });

  it('en certificación usa el cliente REST de certificación y la resolución 0', async () => {
    const e = escenarioEmision();
    const r = await emitir(e, borradorPrueba({ ambiente: 'certificacion' }));
    expect(r.tipo).toBe('ok');
    if (r.tipo === 'ok') expect(r.mensaje.detalle).toContain('sin validez tributaria');
    expect(e.opcionesRest[0]?.ambiente).toBe('certificacion');
    expect(e.falso.tabla('envios')[0]).toMatchObject({ ambiente: 'certificacion', nro_resol: 0 });
    expect(e.falso.tabla('uso_mensual')[0]?.boletas_certificacion).toBe(1);
    // Sin correo del receptor, no se envía nada.
    expect(e.correoBoleta).not.toHaveBeenCalled();
  });

  it('emite un borrador ya guardado: lo actualiza y reemplaza sus líneas', async () => {
    const e = escenarioEmision();
    // Un primer intento que no pasa del token deja el borrador guardado.
    e.rest.obtenerToken.mockRejectedValueOnce(new ErrorTransporte('sin red', URL_ENVIO));
    const g = await emitir(e);
    expect(g).toMatchObject({ tipo: 'error', resultado: 'transporte' });
    const id = String(documentos(e)[0]?.id);
    expect(documentos(e)[0]?.estado).toBe('borrador');

    const r = await emitir(
      e,
      borradorPrueba({
        lineas: [{ nombre: 'Otra cosa', cantidad: 1, precio: 5000, exento: false }],
      }),
      id,
    );
    expect(r).toMatchObject({ tipo: 'ok', documento: { id, folio: 1 } });
    expect(documentos(e)).toHaveLength(1);
    expect(e.falso.tabla('documento_detalles').map((l) => l.nombre)).toEqual(['Otra cosa']);
  });

  it('el token falla: nada se consumió y el borrador sigue guardado', async () => {
    const e = escenarioEmision();
    e.rest.obtenerToken.mockRejectedValueOnce(
      new ErrorTransporte(
        'No se pudo conectar',
        'https://api.sii.cl/recursos/v1/boleta.electronica.semilla',
      ),
    );
    const r = await emitir(e);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'transporte' });
    expect(e.falso.rpcs.map((x) => x.nombre)).not.toContain('asignar_folio');
    expect(documentos(e)[0]?.estado).toBe('borrador');
    expect(e.falso.tabla('folios_anulados')).toEqual([]);
    expect(e.falso.tabla('envios')).toEqual([]);
  });

  it('sin Track ID por corte de red después de salir: envío y documento inciertos, sin anular', async () => {
    const e = escenarioEmision();
    e.rest.enviarBoleta.mockRejectedValueOnce(
      new ErrorTransporte('Se cortó la conexión', URL_ENVIO),
    );
    const r = await emitir(e);
    expect(r).toMatchObject({
      tipo: 'error',
      resultado: 'incierto',
      documento: { folio: 1, estado: 'incierto', trackId: null },
    });
    if (r.tipo === 'error') {
      expect(r.mensaje.titulo).toBe('No sabemos si el SII recibió la boleta');
      expect(r.mensaje.detalle).toContain('No la vuelvas a emitir a ciegas');
    }
    expect(e.falso.tabla('envios')[0]).toMatchObject({
      incierto: true,
      track_id: null,
      clasificacion: 'incierto',
    });
    expect(documentos(e)[0]).toMatchObject({ estado: 'incierto', folio: 1 });
    expect(e.falso.tabla('folios_anulados')).toEqual([]);
    expect(e.falso.tabla('operaciones_sii')[0]).toMatchObject({ resultado: 'incierto' });
    expect(e.pdf).not.toHaveBeenCalled();

    // Reemitir ese documento queda bloqueado (por documento), sin pedir folio.
    const otra = await emitir(e, borradorPrueba(), String(documentos(e)[0]?.id));
    expect(otra).toMatchObject({ tipo: 'error', motivo: 'documento_incierto' });
    expect(e.falso.rpcs.filter((x) => x.nombre === 'asignar_folio')).toHaveLength(1);
  });

  it('un 5xx o una respuesta sin trackid también son inciertos (regla de la CLI)', async () => {
    for (const error of [
      new ErrorTransporte('HTTP 503', URL_ENVIO, 503),
      new ErrorRespuestaSii('El SII no devolvió el trackid.'),
    ]) {
      const e = escenarioEmision();
      e.rest.enviarBoleta.mockRejectedValueOnce(error);
      const r = await emitir(e);
      expect(r).toMatchObject({ tipo: 'error', resultado: 'incierto' });
      expect(documentos(e)[0]?.estado).toBe('incierto');
      expect(e.falso.tabla('folios_anulados')).toEqual([]);
    }
  });

  it('un 4xx: el SII no la recibió, documento anulado y folio a folios_anulados', async () => {
    const e = escenarioEmision();
    e.rest.enviarBoleta.mockRejectedValueOnce(new ErrorTransporte('HTTP 400', URL_ENVIO, 400));
    const r = await emitir(e);
    expect(r).toMatchObject({
      tipo: 'error',
      resultado: 'transporte',
      documento: { estado: 'anulado', folio: 1 },
    });
    if (r.tipo === 'error') expect(r.mensaje.titulo).toBe('El SII no recibió la boleta');
    expect(documentos(e)[0]).toMatchObject({ estado: 'anulado', folio: 1 });
    expect(e.falso.tabla('folios_anulados')).toMatchObject([
      { caf_id: CAF_PRODUCCION, folio: 1, anulado_por: USUARIO },
    ]);
    expect(String(e.falso.tabla('envios')[0]?.error)).toContain('rechazó');
    expect(e.rest.olvidarToken).not.toHaveBeenCalled();
  });

  it('un 401 olvida el token guardado', async () => {
    const e = escenarioEmision();
    e.rest.enviarBoleta.mockRejectedValueOnce(new ErrorTransporte('HTTP 401', URL_ENVIO, 401));
    await emitir(e);
    expect(e.rest.olvidarToken).toHaveBeenCalledWith(RUT_EMPRESA);
  });

  it('falla antes de enviar con folio asignado: folio anulado, el borrador sigue', async () => {
    const e = escenarioEmision();
    e.falso.fallas.set('storage:upload', { code: '500', message: 'Storage caído' });
    const r = await emitir(e);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'error' });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('El folio 1 quedó anulado');
    expect(e.rest.enviarBoleta).not.toHaveBeenCalled();
    expect(documentos(e)[0]?.estado).toBe('borrador');
    expect(documentos(e)[0]?.folio ?? null).toBeNull();
    expect(e.falso.tabla('folios_anulados')).toMatchObject([
      { folio: 1, motivo: 'La boleta no se alcanzó a enviar al SII.' },
    ]);
  });

  it('23514 (folio anulado en paralelo): pide otro folio y vuelve a armar', async () => {
    const e = escenarioEmision({
      tablas: {
        folios_anulados: [
          { id: 'anulado-1', organizacion_id: ORG, caf_id: CAF_PRODUCCION, folio: 1, motivo: 'x' },
        ],
      },
    });
    const r = await emitir(e);
    expect(r).toMatchObject({ tipo: 'ok', documento: { folio: 2 } });
    const envios = e.falso.tabla('envios');
    expect(envios).toHaveLength(2);
    expect(String(envios[0]?.error)).toContain('El folio 1 se anuló');
    expect(envios[1]).toMatchObject({ track_id: '987654321', incierto: false });
    expect(documentos(e)[0]).toMatchObject({ folio: 2, envio_id: envios[1]?.id });
    // El anulado no se vuelve a anular.
    expect(e.falso.tabla('folios_anulados')).toHaveLength(1);
    expect(e.falso.tabla('operaciones_sii')[0]?.detalle).toMatchObject({ folio: 2, intentos: 2 });
    expect(e.rest.enviarBoleta).toHaveBeenCalledTimes(1);
  });

  it('23514 tres veces: se rinde sin enviar y el borrador sigue', async () => {
    const e = escenarioEmision({
      tablas: {
        folios_anulados: [1, 2, 3].map((folio) => ({
          id: `anulado-${folio}`,
          organizacion_id: ORG,
          caf_id: CAF_PRODUCCION,
          folio,
          motivo: 'x',
        })),
      },
    });
    const r = await emitir(e);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'config', motivo: 'folio_anulado' });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('1, 2, 3');
    expect(e.rest.enviarBoleta).not.toHaveBeenCalled();
    expect(documentos(e)[0]?.estado).toBe('borrador');
    expect(e.falso.tabla('folios_anulados')).toHaveLength(3);
  });

  it('la cuota del trigger (P0001) anula el folio y da un mensaje claro', async () => {
    const e = escenarioEmision({
      maxBoletasMes: 5,
      tablas: {
        uso_mensual: [{ organizacion_id: ORG, periodo: '2026-11-01', boletas_produccion: 4 }],
      },
    });
    // Otra emisión usa la última boleta del mes entre el control previo y el update.
    e.rest.obtenerToken.mockImplementationOnce(async () => {
      const uso = e.falso.tabla('uso_mensual')[0];
      if (uso) uso.boletas_produccion = 5;
      return TOKEN_SII;
    });
    const r = await emitir(e);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'config', motivo: 'cuota' });
    if (r.tipo === 'error') {
      expect(r.mensaje.titulo).toBe('Se alcanzó el límite de boletas del mes');
      expect(r.mensaje.detalle).toContain('El folio 1 quedó anulado');
    }
    expect(documentos(e)[0]?.estado).toBe('borrador');
    expect(e.falso.tabla('folios_anulados')).toMatchObject([{ folio: 1 }]);
    expect(e.rest.enviarBoleta).not.toHaveBeenCalled();
  });

  it('0 filas (el borrador se borró entre medio): folio anulado y sin enviar', async () => {
    const e = escenarioEmision();
    e.rest.obtenerToken.mockImplementationOnce(async () => {
      e.falso.db.documentos = [];
      return TOKEN_SII;
    });
    const r = await emitir(e);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'uso', motivo: 'borrador_cambio' });
    expect(e.falso.tabla('folios_anulados')).toMatchObject([{ folio: 1 }]);
    expect(String(e.falso.tabla('envios')[0]?.error)).toContain('no se alcanzó a enviar');
    expect(e.rest.enviarBoleta).not.toHaveBeenCalled();
  });

  it('Track ID recibido pero no guardado: incierto con el Track ID', async () => {
    const e = escenarioEmision();
    e.falso.fallas.set('envios:update', { code: '08006', message: 'sin conexión' });
    const r = await emitir(e);
    expect(r).toMatchObject({
      tipo: 'error',
      resultado: 'incierto',
      documento: { trackId: '987654321', estado: 'incierto' },
    });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('Track ID 987654321');
    expect(e.falso.tabla('folios_anulados')).toEqual([]);
  });

  it('si el PDF o el correo fallan, la emisión sigue ok con avisos', async () => {
    const e = escenarioEmision();
    e.pdf.mockRejectedValue(new Error('pdfkit'));
    const r = await emitir(e, borradorConReceptor());
    expect(r).toMatchObject({ tipo: 'ok', documento: { conPdf: false, correoEnviado: false } });
    if (r.tipo === 'ok') {
      expect(r.avisos?.[0]).toContain('No pudimos generar el PDF');
      expect(r.avisos?.[1]).toContain('no se generó el PDF');
    }
    expect(e.correoBoleta).not.toHaveBeenCalled();
    expect(documentos(e)[0]?.estado).toBe('enviado');

    const e2 = escenarioEmision();
    e2.correoBoleta.mockResolvedValueOnce({ ok: false, motivo: 'red', detalle: 'x' });
    const r2 = await emitir(e2, borradorConReceptor());
    expect(r2).toMatchObject({ tipo: 'ok', documento: { conPdf: true, correoEnviado: false } });
    if (r2.tipo === 'ok')
      expect(r2.avisos).toEqual([
        'No pudimos enviar la boleta a pagos@cliente.cl. Puedes reenviarla desde Documentos.',
      ]);
  });

  it('al cruzar el 15 % de folios, avisa (alerta de la Fase 6)', async () => {
    const e = escenarioEmision({ caf: { desde: 1, hasta: 10, siguiente: 9 } });
    const r = await emitir(e);
    expect(r).toMatchObject({ tipo: 'ok', documento: { folio: 9 } });
    expect(e.correo.enviar).toHaveBeenCalledTimes(1);
    expect(e.correo.enviar.mock.calls[0]?.[0].claveIdempotencia).toContain('folios.por_agotarse');
  });

  it('un descuento global queda en el DTE y en el documento', async () => {
    const e = escenarioEmision();
    const r = await emitir(e, borradorPrueba({ descuento: { tipo: 'monto', valor: 1000 } }));
    expect(r.tipo).toBe('ok');
    expect(documentos(e)[0]).toMatchObject({
      descuento_tipo: 'monto',
      descuento_valor: 1000,
      descuento_aplicado: 1000,
      mnt_total: 25980,
    });
    const sobre = Buffer.from(e.rest.enviarBoleta.mock.calls[0]?.[3] ?? []).toString('latin1');
    expect(sobre).toContain('<DescuentoMonto>1000</DescuentoMonto>');
  });
});
