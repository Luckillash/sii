import { describe, expect, it } from 'vitest';
import {
  avisoConsulta,
  estadoDeEnvio,
  estadoUi,
  guiaIncierto,
  leerErroresSii,
  mensajeRechazoEnvio,
  motivoSinConsulta,
  textoBitacora,
  textoError,
  textoEstadoSii,
  textoRevisado,
  textoSinConsulta,
  ubicacionError,
} from './documentos-presentacion';

describe('bitácora y revisión', () => {
  it('textoBitacora distingue una falla sin respuesta de una nota sobre una respuesta', () => {
    expect(
      textoBitacora({ estadoSii: null, glosaSii: null, error: 'ErrorTransporte: tiempo agotado' }),
    ).toEqual({
      respuesta: 'No respondió: ErrorTransporte: tiempo agotado',
      nota: null,
      fallo: true,
    });
    // EPR con rechazos sin detalle (persistencia.ts guarda `error` explicativo con estado).
    expect(
      textoBitacora({
        estadoSii: 'EPR',
        glosaSii: null,
        error: 'QueryEstUp (SOAP) no trae el detalle por documento.',
      }),
    ).toEqual({
      respuesta: 'EPR · Envío procesado',
      nota: 'QueryEstUp (SOAP) no trae el detalle por documento.',
      fallo: false,
    });
    expect(textoBitacora({ estadoSii: 'REC', glosaSii: null, error: null })).toEqual({
      respuesta: 'REC · Recibido',
      nota: null,
      fallo: false,
    });
    expect(textoBitacora({ estadoSii: null, glosaSii: null, error: '  ' }).respuesta).toBe(
      'Sin estado',
    );
  });

  it('textoRevisado en hora de Chile, 24 h', () => {
    expect(textoRevisado('2026-11-17T13:05:00Z')).toBe('Revisado el 17-11-2026 10:05');
  });

  it('un rechazo EPR sin detalle pide emitir solo las rechazadas', () => {
    const m = mensajeRechazoEnvio('EPR', null);
    expect(m.titulo).toBe('El SII rechazó boletas de este envío');
    expect(m.detalle).toContain('solo las rechazadas');
  });
});

// Traducción de estados y errores del SII al texto del design system (qué pasó y qué
// hacer), sin exclamaciones ni emoji.

const ENVIO = {
  id: 'e1',
  clasificacion: 'en_proceso' as const,
  incierto: false,
  trackId: '34015200',
};

describe('estados', () => {
  it('estadoUi: `aceptado_con_reparos` es `reparos`; lo desconocido, borrador', () => {
    expect(estadoUi('aceptado_con_reparos')).toBe('reparos');
    expect(estadoUi('incierto')).toBe('incierto');
    expect(estadoUi('enviado')).toBe('enviado');
    expect(estadoUi('otro')).toBe('borrador');
  });

  it('estadoDeEnvio sigue a la clasificación (como `sincronizar_documentos_envio`)', () => {
    expect(estadoDeEnvio({ ...ENVIO })).toBe('enviado');
    expect(estadoDeEnvio({ ...ENVIO, clasificacion: 'aceptado' })).toBe('aceptado');
    expect(estadoDeEnvio({ ...ENVIO, clasificacion: 'aceptado_con_reparos' })).toBe('reparos');
    expect(estadoDeEnvio({ ...ENVIO, clasificacion: 'rechazado' })).toBe('rechazado');
    expect(estadoDeEnvio({ ...ENVIO, clasificacion: 'inconsistente' })).toBe('enviado');
    expect(estadoDeEnvio({ ...ENVIO, clasificacion: 'pendiente' })).toBe('enviado');
    expect(estadoDeEnvio({ clasificacion: 'pendiente', incierto: false, trackId: null })).toBe(
      'firmado',
    );
    expect(estadoDeEnvio({ clasificacion: 'incierto', incierto: true, trackId: null })).toBe(
      'incierto',
    );
  });

  it('textoEstadoSii: código y glosa (la de `estados_sii` si el SII no trajo una)', () => {
    expect(textoEstadoSii('EPR', null)).toBe('EPR · Envío procesado');
    expect(textoEstadoSii('rfr', '')).toBe('rfr · Rechazado por error en la firma');
    expect(textoEstadoSii('REC', 'Recibido conforme')).toBe('REC · Recibido conforme');
    expect(textoEstadoSii('XYZ')).toBe('XYZ');
    expect(textoEstadoSii(null)).toBeNull();
  });
});

describe('errores del SII', () => {
  it('leerErroresSii: lee la forma del SII y descarta lo que no entiende', () => {
    const errores = leerErroresSii([
      {
        seccion: 'Encabezado',
        linea: 3,
        nivel: 1,
        codigo: 105,
        descripcion: 'RUT receptor no válido',
        detalle: 'El dígito verificador no corresponde',
      },
      { seccion: '', linea: '7', codigo: null, descripcion: 'Monto total no cuadra', detalle: '' },
      { descripcion: 'Repetido', detalle: 'Repetido' },
      'texto suelto',
      null,
      { seccion: 'Sin descripción' },
    ]);
    expect(errores).toEqual([
      {
        seccion: 'Encabezado',
        linea: 3,
        codigo: '105',
        descripcion: 'RUT receptor no válido',
        detalle: 'El dígito verificador no corresponde',
      },
      {
        seccion: null,
        linea: 7,
        codigo: null,
        descripcion: 'Monto total no cuadra',
        detalle: null,
      },
      { seccion: null, linea: null, codigo: null, descripcion: 'Repetido', detalle: null },
    ]);
    expect(leerErroresSii({ no: 'es un arreglo' })).toEqual([]);
  });

  it('ubicación y texto con el tono del design system', () => {
    const [e] = leerErroresSii([
      { seccion: 'Detalle', linea: 1200, codigo: 7, descripcion: 'Falta el nombre del ítem' },
    ]);
    if (!e) throw new Error('sin error');
    expect(ubicacionError(e)).toBe('Sección Detalle, línea 1.200');
    expect(ubicacionError({ seccion: null, linea: 2 })).toBe('Línea 2');
    expect(ubicacionError({ seccion: null, linea: null })).toBeNull();
    expect(textoError(e)).toBe('Falta el nombre del ítem.');
    expect(textoError({ descripcion: 'RUT no válido.', detalle: 'Revisa el dígito' })).toBe(
      'RUT no válido. Revisa el dígito.',
    );
  });

  it('rechazo del sobre: qué pasó (código y glosa) y qué hacer', () => {
    const firma = mensajeRechazoEnvio('RFR', null);
    expect(firma.titulo).toBe('El SII rechazó el envío completo');
    expect(firma.detalle).toMatch(
      /^RFR · Rechazado por error en la firma\. Revisa que el certificado/,
    );
    expect(mensajeRechazoEnvio('RCT', null).detalle).toContain('resolución');
    expect(mensajeRechazoEnvio('RSC', null).detalle).toContain('soporte');
    expect(mensajeRechazoEnvio(null, null).detalle).toBe(
      'Rechazado. Revisa el detalle del SII y emite las boletas de nuevo.',
    );
  });
});

describe('«Consultar estado en el SII»', () => {
  it('motivoSinConsulta: incierto, final, sin envío y sin Track ID', () => {
    expect(motivoSinConsulta({ estado: 'enviado', envio: ENVIO })).toBeNull();
    expect(motivoSinConsulta({ estado: 'incierto', envio: ENVIO })).toBe('incierto');
    expect(
      motivoSinConsulta({ estado: 'enviado', envio: { ...ENVIO, incierto: true, trackId: null } }),
    ).toBe('incierto');
    expect(motivoSinConsulta({ estado: 'aceptado', envio: ENVIO })).toBe('final');
    expect(motivoSinConsulta({ estado: 'anulado', envio: ENVIO })).toBe('final');
    expect(
      motivoSinConsulta({ estado: 'enviado', envio: { ...ENVIO, clasificacion: 'rechazado' } }),
    ).toBe('final');
    // `inconsistente` no es final: otra consulta puede traer la respuesta completa.
    expect(
      motivoSinConsulta({ estado: 'enviado', envio: { ...ENVIO, clasificacion: 'inconsistente' } }),
    ).toBeNull();
    expect(motivoSinConsulta({ estado: 'firmado', envio: null })).toBe('sin_envio');
    expect(
      motivoSinConsulta({
        estado: 'firmado',
        envio: { ...ENVIO, clasificacion: 'pendiente', trackId: null },
      }),
    ).toBe('sin_track_id');
    // Página del envío: sin documento.
    expect(motivoSinConsulta({ envio: ENVIO })).toBeNull();
    expect(textoSinConsulta('incierto')).toContain('sitio del SII');
  });

  it('avisoConsulta: tono según el resultado', () => {
    expect(
      avisoConsulta({
        tipo: 'consultado',
        estadoSii: 'EPR',
        glosaSii: null,
        clasificacion: 'aceptado',
        cambio: true,
      }),
    ).toEqual({
      tono: 'exito',
      titulo: 'El SII aceptó el envío',
      detalle: 'Las boletas quedaron aceptadas. Estado en el SII: EPR · Envío procesado.',
    });
    const rechazo = avisoConsulta({
      tipo: 'consultado',
      estadoSii: 'EPR',
      glosaSii: null,
      clasificacion: 'rechazado',
      cambio: true,
    });
    expect(rechazo.tono).toBe('error');
    // Rechazo parcial (EPR con rechazos): se emiten de nuevo solo las rechazadas.
    expect(rechazo.detalle).toContain('emite de nuevo las rechazadas');
    expect(rechazo.detalle).not.toContain('las boletas de nuevo');
    expect(
      avisoConsulta({
        tipo: 'consultado',
        estadoSii: 'EPR',
        glosaSii: null,
        clasificacion: 'aceptado_con_reparos',
        cambio: true,
      }).tono,
    ).toBe('aviso');
    const enProceso = avisoConsulta({
      tipo: 'consultado',
      estadoSii: 'REC',
      glosaSii: null,
      clasificacion: 'en_proceso',
      cambio: false,
    });
    expect(enProceso.tono).toBe('info');
    expect(enProceso.titulo).toBe('El SII todavía está revisando el envío');
    expect(enProceso.detalle).toContain('REC · Recibido');
    const mensaje = { titulo: 'Este envío no tiene Track ID', detalle: 'Revisa en el SII.' };
    expect(avisoConsulta({ tipo: 'sin_track_id', mensaje })).toEqual({ tono: 'aviso', ...mensaje });
    expect(avisoConsulta({ tipo: 'error', mensaje })).toEqual({ tono: 'error', ...mensaje });
    expect(avisoConsulta({ tipo: 'final', clasificacion: 'aceptado' }).tono).toBe('info');
  });

  it('ningún texto lleva exclamaciones ni emoji', () => {
    const textos = [
      guiaIncierto(41),
      guiaIncierto(),
      mensajeRechazoEnvio('RFR', null),
      ...(['incierto', 'final', 'sin_envio', 'sin_track_id'] as const).map((m) => ({
        titulo: textoSinConsulta(m),
        detalle: '',
      })),
    ];
    for (const t of textos) {
      expect(`${t.titulo} ${t.detalle}`).not.toMatch(/[!¡]|\p{Extended_Pictographic}/u);
    }
    expect(guiaIncierto(1234).detalle).toContain('N.º 1.234');
  });
});
