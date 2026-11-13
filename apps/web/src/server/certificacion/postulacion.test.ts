import { ErrorPostulacion } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import {
  CLAVE_PFX,
  COOKIE_SII,
  EMPRESA,
  escenario,
  ORG,
  todoLoEscrito,
} from '../../../test/certificacion-prueba';
import { postular } from './postulacion';

describe('postular', () => {
  it('ensayo: valida y resume sin salir al SII ni dejar filas', async () => {
    const e = escenario();
    const r = await postular(e.ctx, { confirmada: false }, e.deps);
    expect(r.tipo).toBe('ensayo');
    if (r.tipo !== 'ensayo') return;
    expect(r.resumen.operacion).toBe('postular');
    expect(r.resumen.ambiente).toBe('certificacion');
    expect(r.resumen.certificado).toMatchObject({
      titular: 'Titular de Prueba',
      rut: '12345678-5',
    });
    expect(r.resumen.filas.map((f) => f.etiqueta)).toContain('Nombre del software');
    expect(e.falso.escrituras).toEqual([]);
    expect(e.falso.tabla('operaciones_sii')).toEqual([]);
    expect(e.postulacion.autenticar).not.toHaveBeenCalled();
    expect(e.declaracion.verificarPortal).not.toHaveBeenCalled();
    expect(e.transporteFalso.enviadas).toEqual([]);
  });

  it('ensayo con datos incompletos: error de uso sin filas', async () => {
    const e = escenario({ proceso: { nombre_software: null } });
    const r = await postular(e.ctx, { confirmada: false }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'uso', operacionId: null });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('el nombre del software');
    expect(e.falso.escrituras).toEqual([]);
  });

  it('rechaza textos con tildes (ASCII imprimible) antes de salir al SII', async () => {
    const e = escenario({ proceso: { nombre_software: 'Señal' } });
    const r = await postular(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'config' });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('charset=iso-8859-1');
    expect(e.falso.tabla('operaciones_sii')).toEqual([]);
    expect(e.declaracion.verificarPortal).not.toHaveBeenCalled();
  });

  it('confirmada: verifica el portal, postula, deja la etapa, la resolución y avisa por correo', async () => {
    const e = escenario();
    const r = await postular(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'ok' });
    if (r.tipo !== 'ok') return;
    expect(r.avisos).toEqual(['La empresa dejará de usar el facturador gratuito del SII.']);

    const ops = e.falso.tabla('operaciones_sii');
    expect(ops.map((o) => [o.operacion, o.resultado, o.confirmada])).toEqual([
      ['verificar_portal', 'ok', true],
      ['postular', 'ok', true],
    ]);
    expect(r.operacionId).toBe(ops[1]?.id);

    const proceso = e.falso.tabla('procesos_certificacion')[0];
    expect(proceso).toMatchObject({
      etapa: 'postulada',
      avisos_postulacion: ['La empresa dejará de usar el facturador gratuito del SII.'],
    });
    expect(proceso?.postulada_en).toBe('2026-11-13T15:00:00.000Z');

    // Resolución de certificación: número 0, fecha de la postulación en Chile.
    expect(e.falso.tabla('resoluciones')).toMatchObject([
      {
        empresa_id: EMPRESA,
        organizacion_id: ORG,
        ambiente: 'certificacion',
        numero: 0,
        fecha: '2026-11-13',
        vigente: true,
      },
    ]);

    // El login fue con el certificado y la sesión quedó guardada (cifrada, en la app real).
    expect(e.postulacion.autenticar).toHaveBeenCalledTimes(1);
    expect(e.sesiones.mapa.size).toBe(1);

    // Correo a propietarios y administradores (no al lector), idempotente por operación.
    expect(e.correo.enviar).toHaveBeenCalledTimes(1);
    const mensaje = e.correo.enviar.mock.calls[0]?.[0] as unknown as {
      para: string[];
      claveIdempotencia: string;
      asunto: string;
    };
    expect(mensaje.para).toEqual(['duena@empresa.cl']);
    expect(mensaje.claveIdempotencia).toBe(`certificacion/${r.operacionId}/postulada`);
    expect(mensaje.asunto).toContain('Postulada');

    expect(e.transporteFalso.enviadas).toEqual([]);
    const escrito = todoLoEscrito(e);
    for (const secreto of [CLAVE_PFX, COOKIE_SII]) expect(escrito).not.toContain(secreto);
  });

  it('no registra otra resolución si ya hay una vigente', async () => {
    const e = escenario({
      tablas: {
        resoluciones: [
          {
            id: 'r1',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            ambiente: 'certificacion',
            numero: 0,
            fecha: '2026-10-01',
            vigente: true,
          },
        ],
      },
    });
    const r = await postular(e.ctx, { confirmada: true }, e.deps);
    expect(r.tipo).toBe('ok');
    expect(e.falso.tabla('resoluciones')).toHaveLength(1);
    expect(e.falso.rpcs.map((x) => x.nombre)).not.toContain('registrar_resolucion');
  });

  it('portal cambiado: verificacion_fallida y no postula', async () => {
    const e = escenario();
    e.declaracion.verificarPortal.mockResolvedValueOnce([
      'El portal de boletas del SII cambió: falta POLICY.',
    ]);
    const r = await postular(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'verificacion_fallida' });
    expect(e.postulacion.postular).not.toHaveBeenCalled();
    expect(e.falso.tabla('operaciones_sii').map((o) => [o.operacion, o.resultado])).toEqual([
      ['verificar_portal', 'verificacion_fallida'],
    ]);
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('borrador');
    expect(e.registros.some((x) => x.etiquetas.resultado === 'verificacion_fallida')).toBe(true);
  });

  it('rechazo del SII: rechazo_sii, la etapa no cambia y no hay correo', async () => {
    const e = escenario();
    e.postulacion.postular.mockRejectedValueOnce(
      new ErrorPostulacion('El SII rechazó la postulación. (SII: RUT sin inicio de actividades)'),
    );
    const r = await postular(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', resultado: 'rechazo_sii' });
    if (r.tipo === 'error') expect(r.mensaje.detalle).toContain('sin inicio de actividades');
    expect(e.falso.tabla('procesos_certificacion')[0]?.etapa).toBe('borrador');
    expect(e.correo.enviar).not.toHaveBeenCalled();
  });

  it('una postulación incierta sin revisar bloquea la siguiente (efecto global)', async () => {
    const e = escenario({
      tablas: {
        operaciones_sii: [
          {
            id: '77777777-7777-4777-8777-777777777777',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            operacion: 'postular',
            ambiente: 'certificacion',
            confirmada: true,
            resultado: 'incierto',
            detalle: {},
            iniciada_en: '2026-11-13T14:00:00.000Z',
          },
        ],
      },
    });
    const r = await postular(e.ctx, { confirmada: true }, e.deps);
    expect(r).toMatchObject({
      tipo: 'error',
      motivo: 'incierto_sin_revisar',
      operacionPendienteId: '77777777-7777-4777-8777-777777777777',
    });
    expect(e.postulacion.postular).not.toHaveBeenCalled();
  });

  it('si el correo falla, la operación igual termina bien', async () => {
    const e = escenario();
    e.correo.enviar.mockRejectedValueOnce(new Error('Resend caído'));
    const r = await postular(e.ctx, { confirmada: true }, e.deps);
    expect(r.tipo).toBe('ok');
  });

  it('en por_declarar no se vuelve a postular', async () => {
    const e = escenario({ etapa: 'por_declarar' });
    const r = await postular(e.ctx, { confirmada: false }, e.deps);
    expect(r).toMatchObject({ tipo: 'error', motivo: 'uso' });
  });
});
