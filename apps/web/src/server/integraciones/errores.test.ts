import { describe, expect, it } from 'vitest';
import {
  DATOS_INVALIDOS,
  MENSAJE_GENERICO,
  PLAN_SIN_API,
  PLAN_SIN_WEBHOOKS,
  SIN_PERMISO,
  traducirErrorIntegracion,
  URL_NO_PERMITIDA,
} from './errores';

// Cada caso sale de un `raise` o un check de las migraciones 0001 y 0018.

describe('traducirErrorIntegracion', () => {
  it('plan sin API (crear_api_key, P0001 sin código propio)', () => {
    const e = { code: 'P0001', message: 'El plan vigente no incluye acceso por API' };
    expect(traducirErrorIntegracion(e, 'crear_clave')).toBe(PLAN_SIN_API);
  });

  it('plan sin webhooks (crear_webhook, probar, reenviar)', () => {
    const e = { code: 'P0001', message: 'El plan vigente no incluye webhooks' };
    expect(traducirErrorIntegracion(e, 'crear_webhook')).toBe(PLAN_SIN_WEBHOOKS);
    expect(traducirErrorIntegracion(e, 'probar_webhook')).toBe(PLAN_SIN_WEBHOOKS);
    expect(traducirErrorIntegracion(e, 'reenviar_entrega')).toBe(PLAN_SIN_WEBHOOKS);
  });

  it('empresa de otra organización', () => {
    const r = traducirErrorIntegracion(
      { code: 'P0001', message: 'La empresa no pertenece a la organización' },
      'crear_clave',
    );
    expect(r.titulo).toMatch(/empresa/);
  });

  it('42501 es falta de permiso', () => {
    expect(
      traducirErrorIntegracion({ code: '42501', message: 'Sin permiso' }, 'rotar_secreto'),
    ).toBe(SIN_PERMISO);
  });

  it('P0002 distingue entrega de webhook', () => {
    expect(
      traducirErrorIntegracion(
        { code: 'P0002', message: 'La entrega no existe' },
        'reenviar_entrega',
      ).titulo,
    ).toMatch(/entrega/);
    expect(
      traducirErrorIntegracion({ code: 'P0002', message: 'El webhook no existe' }, 'probar_webhook')
        .titulo,
    ).toMatch(/webhook/);
  });

  it('22023: webhook pausado o entrega ya en cola', () => {
    expect(
      traducirErrorIntegracion(
        { code: '22023', message: 'El webhook está desactivado' },
        'probar_webhook',
      ).titulo,
    ).toMatch(/pausado/);
    expect(
      traducirErrorIntegracion(
        { code: '22023', message: 'La entrega ya está en cola' },
        'reenviar_entrega',
      ).titulo,
    ).toMatch(/en cola/);
    expect(traducirErrorIntegracion({ code: '22023', message: 'otro' }, 'probar_webhook')).toBe(
      DATOS_INVALIDOS,
    );
  });

  it('22023 del trigger de api_keys: revocar es definitivo y la expiración no se alarga', () => {
    expect(
      traducirErrorIntegracion(
        {
          code: '22023',
          message: 'Una API key revocada no se puede reactivar ni cambiar su revocación',
        },
        'revocar_clave',
      ).titulo,
    ).toMatch(/ya está revocada/);
    expect(
      traducirErrorIntegracion(
        { code: '22023', message: 'La expiración de una API key no se puede alargar ni quitar' },
        'revocar_clave',
      ).titulo,
    ).toMatch(/alargar la expiración/);
  });

  it('23514 de la URL (check de la 0018 o el https de la 0001)', () => {
    const permitida = {
      code: '23514',
      message: 'new row for relation "webhooks" violates check constraint "webhooks_url_permitida"',
    };
    const https = {
      code: '23514',
      message: 'new row for relation "webhooks" violates check constraint "webhooks_url_check"',
    };
    expect(traducirErrorIntegracion(permitida, 'actualizar_webhook')).toBe(URL_NO_PERMITIDA);
    expect(traducirErrorIntegracion(https, 'crear_webhook')).toBe(URL_NO_PERMITIDA);
  });

  it('23514 de eventos o alcances y 22P02 son datos inválidos', () => {
    expect(
      traducirErrorIntegracion(
        { code: '23514', message: 'violates check constraint "webhooks_eventos_check"' },
        'crear_webhook',
      ),
    ).toBe(DATOS_INVALIDOS);
    expect(traducirErrorIntegracion({ code: '22P02' }, 'revocar_clave')).toBe(DATOS_INVALIDOS);
  });

  it('lo desconocido es el mensaje genérico', () => {
    expect(traducirErrorIntegracion({ code: '08006' }, 'crear_clave')).toBe(MENSAJE_GENERICO);
    expect(traducirErrorIntegracion({}, 'crear_clave')).toBe(MENSAJE_GENERICO);
  });

  it('los mensajes siguen el tono: sin exclamaciones', () => {
    for (const m of [
      MENSAJE_GENERICO,
      SIN_PERMISO,
      PLAN_SIN_API,
      PLAN_SIN_WEBHOOKS,
      URL_NO_PERMITIDA,
    ]) {
      expect(`${m.titulo} ${m.detalle}`).not.toMatch(/[!¡]/);
    }
  });
});
