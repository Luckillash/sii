import { describe, expect, it } from 'vitest';
import {
  codigoErrorAuth,
  type ErrorAuth,
  errorVisibleAlEnviarCorreo,
  esErrorDeConexion,
  MENSAJES_AUTH,
  traducirErrorAuth,
} from './errores-auth';

describe('traducirErrorAuth', () => {
  it('credenciales inválidas: mensaje general, sin decir qué campo falló', () => {
    const r = traducirErrorAuth(
      { code: 'invalid_credentials', status: 400, message: 'Invalid login credentials' },
      'ingresar',
    );
    expect(r).toEqual({ mensaje: MENSAJES_AUTH.credenciales });
  });

  it('correo sin confirmar', () => {
    expect(traducirErrorAuth({ code: 'email_not_confirmed' }, 'ingresar').mensaje).toBe(
      MENSAJES_AUTH.correoSinConfirmar,
    );
  });

  it('usuario ya registrado va al campo correo', () => {
    for (const code of ['user_already_exists', 'email_exists']) {
      expect(traducirErrorAuth({ code }, 'crear-cuenta')).toEqual({
        mensaje: MENSAJES_AUTH.yaRegistrado,
        campo: 'correo',
      });
    }
  });

  it('contraseña débil según el motivo, en el campo clave', () => {
    const debil = (reasons?: string[]): ErrorAuth => ({ code: 'weak_password', reasons });
    expect(traducirErrorAuth(debil(['pwned', 'length']), 'crear-cuenta')).toEqual({
      mensaje: MENSAJES_AUTH.claveFiltrada,
      campo: 'clave',
    });
    expect(traducirErrorAuth(debil(['length']), 'crear-cuenta').mensaje).toBe(
      MENSAJES_AUTH.claveCorta,
    );
    expect(traducirErrorAuth(debil(['characters']), 'restablecer').mensaje).toBe(
      MENSAJES_AUTH.claveCaracteres,
    );
    expect(traducirErrorAuth(debil(), 'restablecer').mensaje).toBe(MENSAJES_AUTH.claveDebil);
  });

  it('límites de tasa', () => {
    expect(traducirErrorAuth({ code: 'over_request_rate_limit' }, 'ingresar').mensaje).toBe(
      MENSAJES_AUTH.limiteIntentos,
    );
    expect(traducirErrorAuth({ code: 'over_email_send_rate_limit' }, 'recuperar').mensaje).toBe(
      MENSAJES_AUTH.limiteCorreos,
    );
    expect(traducirErrorAuth({ status: 429, message: 'Too Many Requests' }, 'enlace').mensaje).toBe(
      MENSAJES_AUTH.limiteIntentos,
    );
  });

  it('captcha fallido', () => {
    expect(traducirErrorAuth({ code: 'captcha_failed' }, 'crear-cuenta').mensaje).toBe(
      MENSAJES_AUTH.captcha,
    );
    expect(
      traducirErrorAuth({ message: 'captcha protection: request disallowed' }, 'ingresar').mensaje,
    ).toBe(MENSAJES_AUTH.captcha);
  });

  it('deduce el código del mensaje cuando el servidor no lo manda', () => {
    expect(codigoErrorAuth({ message: 'Invalid login credentials' })).toBe('invalid_credentials');
    expect(codigoErrorAuth({ message: 'Email not confirmed' })).toBe('email_not_confirmed');
    expect(codigoErrorAuth({ message: 'User already registered' })).toBe('user_already_exists');
    expect(codigoErrorAuth({ message: 'Password should be at least 8 characters.' })).toBe(
      'weak_password',
    );
    expect(codigoErrorAuth({ message: 'Email rate limit exceeded' })).toBe(
      'over_email_send_rate_limit',
    );
    expect(codigoErrorAuth({ name: 'AuthSessionMissingError', message: 'x' })).toBe(
      'session_not_found',
    );
  });

  it('sin sesión al restablecer: pedir un enlace nuevo', () => {
    expect(
      traducirErrorAuth(
        { name: 'AuthSessionMissingError', message: 'Auth session missing!' },
        'restablecer',
      ).mensaje,
    ).toBe(MENSAJES_AUTH.sinSesionRecuperacion);
    expect(traducirErrorAuth({ code: 'same_password' }, 'restablecer')).toEqual({
      mensaje: MENSAJES_AUTH.claveIgual,
      campo: 'clave',
    });
  });

  it('errores de red o del servidor: sin conexión', () => {
    expect(
      traducirErrorAuth({ name: 'AuthRetryableFetchError', status: 0 }, 'ingresar').mensaje,
    ).toBe(MENSAJES_AUTH.sinConexion);
    expect(traducirErrorAuth({ status: 503, message: 'x' }, 'crear-cuenta').mensaje).toBe(
      MENSAJES_AUTH.sinConexion,
    );
    expect(esErrorDeConexion({ status: 400 })).toBe(false);
  });

  it('error desconocido: mensaje genérico del contexto', () => {
    const r = traducirErrorAuth({ code: 'algo_nuevo', status: 400 }, 'crear-cuenta');
    expect(r.mensaje).toMatch(/^No pudimos crear la cuenta\./);
    expect(r.campo).toBeUndefined();
  });

  it('todos los mensajes respetan el tono: sin exclamaciones ni «usted»', () => {
    const contextos = ['ingresar', 'enlace', 'crear-cuenta', 'recuperar', 'restablecer'] as const;
    const textos = [
      ...Object.values(MENSAJES_AUTH),
      ...contextos.map((c) => traducirErrorAuth({}, c).mensaje),
    ];
    for (const texto of textos) {
      expect(texto).not.toMatch(/[!¡]/);
      expect(texto).not.toMatch(/\busted\b/i);
      expect(texto.endsWith('.')).toBe(true);
    }
  });
});

describe('errorVisibleAlEnviarCorreo', () => {
  it('oculta lo que delataría que la cuenta no existe', () => {
    expect(
      errorVisibleAlEnviarCorreo(
        { code: 'otp_disabled', message: 'Signups not allowed for otp' },
        'enlace',
      ),
    ).toBeNull();
    expect(errorVisibleAlEnviarCorreo({ message: 'Signups not allowed for otp' }, 'enlace')).toBe(
      null,
    );
    expect(errorVisibleAlEnviarCorreo({ code: 'user_not_found' }, 'recuperar')).toBeNull();
  });

  it('muestra límite de tasa, captcha y fallas de conexión', () => {
    expect(
      errorVisibleAlEnviarCorreo({ code: 'over_email_send_rate_limit' }, 'recuperar')?.mensaje,
    ).toBe(MENSAJES_AUTH.limiteCorreos);
    expect(errorVisibleAlEnviarCorreo({ code: 'captcha_failed' }, 'enlace')?.mensaje).toBe(
      MENSAJES_AUTH.captcha,
    );
    expect(errorVisibleAlEnviarCorreo({ status: 502 }, 'recuperar')?.mensaje).toBe(
      MENSAJES_AUTH.sinConexion,
    );
  });
});
