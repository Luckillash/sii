import { describe, expect, it } from 'vitest';
import { mensajeFallaPagos, mensajeRetornoPago } from './errores';

describe('mensajeFallaPagos', () => {
  it('cuenta de Flow sin cargos automáticos: no culpa a la tarjeta', () => {
    const m = mensajeFallaPagos({
      ok: false,
      codigo: 'pasarela',
      detalle: 'customer/register: Commerce has not automatic charge contract',
    });
    expect(m.titulo).toBe('Los pagos con tarjeta todavía no están habilitados');
    expect(m.detalle).not.toMatch(/tarjeta/i);
  });

  it('otro rechazo de Flow: el mensaje general', () => {
    expect(mensajeFallaPagos({ ok: false, codigo: 'pasarela', detalle: 'x: y' }).titulo).toBe(
      'Flow rechazó la operación',
    );
  });

  it('no cabe: incluye el motivo armado por la app', () => {
    const m = mensajeFallaPagos({
      ok: false,
      codigo: 'no_cabe',
      detalle: 'El plan Pyme permite 1 empresa y tienes 2.',
    });
    expect(m.detalle).toContain('tienes 2');
  });

  it('ningún mensaje lleva exclamaciones', () => {
    for (const codigo of [
      'sin_configuracion',
      'plan_invalido',
      'no_cabe',
      'ya_en_plan',
      'sin_suscripcion',
      'pasarela',
      'pasarela_red',
      'base',
    ] as const) {
      const m = mensajeFallaPagos({ ok: false, codigo });
      expect(`${m.titulo} ${m.detalle}`).not.toMatch(/[!¡]/);
    }
  });
});

describe('mensajeRetornoPago', () => {
  it('reconoce los resultados del retorno y descarta los desconocidos', () => {
    expect(mensajeRetornoPago('suscrita')?.tono).toBe('exito');
    expect(mensajeRetornoPago('tarjeta_rechazada')?.tono).toBe('aviso');
    expect(mensajeRetornoPago('error')?.tono).toBe('error');
    expect(mensajeRetornoPago('<script>')).toBeNull();
    expect(mensajeRetornoPago(undefined)).toBeNull();
  });
});
