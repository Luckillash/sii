import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { envSupabase, envSupabasePublico } from '../env';
import { configClienteAuth } from './clave-auth';

const URL_SUPABASE = 'https://ejemplo.supabase.co';
const PUBLICABLE = 'sb_publishable_clave-de-prueba-000000';
const SECRETA = 'sb_secret_clave-de-prueba-000000';
const LEGADA = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.firma-de-prueba';
const conIp = () => new Headers({ 'x-forwarded-for': '200.1.2.3, 10.0.0.1' });

beforeEach(() => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', URL_SUPABASE);
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', PUBLICABLE);
  vi.stubEnv('SUPABASE_SECRET_KEY', SECRETA);
  vi.stubEnv('TURNSTILE_SECRET_KEY', 'secreto-turnstile-0000');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('configClienteAuth', () => {
  it('con clave secreta e IP reenvía la IP del cliente en sb-forwarded-for', () => {
    expect(configClienteAuth(conIp())).toEqual({
      url: URL_SUPABASE,
      clave: SECRETA,
      cabeceras: { 'sb-forwarded-for': '200.1.2.3' },
      conClaveSecreta: true,
    });
  });

  it('sin clave secreta usa la publicable, sin cabeceras', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', '');
    expect(configClienteAuth(conIp())).toEqual({
      url: URL_SUPABASE,
      clave: PUBLICABLE,
      cabeceras: {},
      conClaveSecreta: false,
    });
  });

  it('una clave legada en SUPABASE_SECRET_KEY no se usa', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', LEGADA);
    expect(configClienteAuth(conIp()).conClaveSecreta).toBe(false);
  });

  it('sin IP en la petición usa la publicable (no habría nada que reenviar)', () => {
    const config = configClienteAuth(new Headers());
    expect(config.clave).toBe(PUBLICABLE);
    expect(config.cabeceras).toEqual({});
  });

  it('con captcha y sin TURNSTILE_SECRET_KEY usa la publicable para que Auth verifique el captcha', () => {
    vi.stubEnv('TURNSTILE_SECRET_KEY', '');
    expect(configClienteAuth(conIp(), { exigeCaptcha: true }).conClaveSecreta).toBe(false);
    // Sin captcha (callback, proxy) no importa Turnstile.
    expect(configClienteAuth(conIp()).conClaveSecreta).toBe(true);
  });

  it('con captcha y Turnstile configurado usa la clave secreta', () => {
    expect(configClienteAuth(conIp(), { exigeCaptcha: true }).conClaveSecreta).toBe(true);
  });
});

describe('solo claves API nuevas (las legadas se retiran en 2027)', () => {
  it('rechaza una clave legada como publicable, nombrando la variable y no el valor', () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', LEGADA);
    expect(() => envSupabasePublico()).toThrow('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
    expect(() => envSupabasePublico()).not.toThrow(LEGADA);
  });

  it('rechaza una clave legada como secreta del cliente de servicio', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', LEGADA);
    expect(() => envSupabase()).toThrow('SUPABASE_SECRET_KEY');
  });

  it('acepta las claves sb_publishable_ y sb_secret_', () => {
    expect(envSupabasePublico().NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).toBe(PUBLICABLE);
    expect(envSupabase().SUPABASE_SECRET_KEY).toBe(SECRETA);
  });
});
