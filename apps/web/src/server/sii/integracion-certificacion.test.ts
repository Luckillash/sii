// Prueba de integración MANUAL contra el SII de certificación (PLAN-SAAS Fase 4 y §8:
// «ejecución manual contra certificación; nunca automática»). Sin `SII_INTEGRACION=1`
// se omite, así que `pnpm test` no sale a la red ni toca la base.
//
// Qué hace, con el certificado real de una empresa (leído de Vault):
//   1. `ejecutarOperacion('obtener_token')` en certificación por REST (semilla + token en
//      apicert) con el TokenStore de Supabase: deja una fila `ok` en `operaciones_sii` y el
//      token cifrado en `tokens_sii`; ni la fila ni lo que recibe Sentry contienen el token.
//   2. Repite la operación: el token sale del caché (`tokens_sii` no cambia).
//   3. `tomar_bloqueo_certificado` / `liberar_bloqueo_certificado` por PostgREST: un segundo
//      titular no lo toma mientras el primero lo tiene.
//
// Escribe en producción (una fila de `operaciones_sii` por corrida y la fila del token en
// `tokens_sii`, que es un caché). No emite, no pide folios, no postula ni declara.
//
// Cómo correrlo (desde apps/web, con .env.local completo):
//   SII_INTEGRACION=1 SII_INTEGRACION_ORG=<uuid> SII_INTEGRACION_EMPRESA=<uuid> \
//     pnpm vitest run src/server/sii/integracion-certificacion.test.ts

import { ClienteBoletaRest } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { aBytea, leerLlave } from '../cifrado';
import { clienteServicio } from '../supabase/service';
import { BloqueoOcupadoError, conBloqueoCertificado } from './bloqueos';
import { crearCredenciales } from './credenciales';
import { ejecutarOperacion, type RegistroOperacion } from './operacion';
import { TokenStoreSupabase } from './token-store-supabase';
import { crearTransporte } from './transporte';

const activa = process.env.SII_INTEGRACION === '1';
if (activa) process.loadEnvFile('.env.local');

describe.skipIf(!activa)('integración con el SII de certificación (manual)', () => {
  const organizacionId = process.env.SII_INTEGRACION_ORG ?? '';
  const empresaId = process.env.SII_INTEGRACION_EMPRESA ?? '';

  async function obtenerToken(registros: RegistroOperacion[]) {
    const cliente = clienteServicio();
    const { data: empresa, error } = await cliente
      .from('empresas')
      .select('rut')
      .eq('id', empresaId)
      .eq('organizacion_id', organizacionId)
      .single();
    if (error || !empresa) throw new Error('No se encontró la empresa de la prueba.');

    const resultado = await ejecutarOperacion(
      {
        cliente,
        organizacionId,
        empresaId,
        usuarioId: null,
        operacion: 'obtener_token',
        ambiente: 'certificacion',
        canal: 'rest',
        confirmada: true,
        dependencias: { registrar: (r) => registros.push(r) },
      },
      async ({ agregarDetalle }) => {
        const credenciales = await crearCredenciales(cliente).certificadoDeEmpresa({
          organizacionId,
          empresaId,
        });
        await using transporte = crearTransporte();
        const rest = new ClienteBoletaRest(credenciales.certificado, {
          ambiente: 'certificacion',
          transporte,
          tokenStore: new TokenStoreSupabase(cliente, leerLlave(process.env.SII_TOKENS_KEY)),
        });
        const token = await rest.obtenerToken(empresa.rut);
        agregarDetalle({ largo_token: token.length });
        return {
          token,
          huella: credenciales.huellaSha256,
          certificadoId: credenciales.certificadoId,
        };
      },
    );
    return { cliente, resultado, rut: empresa.rut };
  }

  it('obtiene el token, audita sin secretos, lo reutiliza y el bloqueo funciona por PostgREST', {
    timeout: 120_000,
  }, async () => {
    expect(organizacionId, 'falta SII_INTEGRACION_ORG').not.toBe('');
    expect(empresaId, 'falta SII_INTEGRACION_EMPRESA').not.toBe('');

    // 1. Token nuevo (o vigente del caché, si ya había uno).
    const registros: RegistroOperacion[] = [];
    const { cliente, resultado, rut } = await obtenerToken(registros);
    if (!resultado.ok)
      throw new Error(`La operación no terminó bien: ${JSON.stringify(resultado)}`);
    const { token, huella, certificadoId } = resultado.valor;
    expect(token.length).toBeGreaterThan(5);

    const { data: fila } = await cliente
      .from('operaciones_sii')
      .select('*')
      .eq('id', resultado.operacionId)
      .single();
    expect(fila?.resultado).toBe('ok');
    expect(fila?.terminada_en).not.toBeNull();
    expect(JSON.stringify(fila)).not.toContain(token);
    expect(JSON.stringify(registros)).not.toContain(token);

    const clave = {
      p_canal: 'rest' as const,
      p_ambiente: 'certificacion' as const,
      p_rut: rut,
      p_huella: huella,
    };
    const { data: guardado } = await cliente.rpc('token_obtener', clave);
    expect(guardado?.[0]).toBeDefined();
    const cifrado = String(guardado?.[0]?.token_cifrado);
    expect(cifrado).not.toContain(aBytea(Buffer.from(token, 'utf8')).slice(2));

    // 2. Segunda vez: mismo token, desde el caché (la fila de tokens_sii no se reescribe).
    const { resultado: segundo } = await obtenerToken([]);
    if (!segundo.ok)
      throw new Error(`La segunda operación no terminó bien: ${JSON.stringify(segundo)}`);
    expect(segundo.valor.token).toBe(token);
    const { data: guardado2 } = await cliente.rpc('token_obtener', clave);
    expect(String(guardado2?.[0]?.token_cifrado)).toBe(cifrado);

    // 3. Bloqueo con arriendo contra la base real.
    const claveBloqueo = { certificadoId, ambiente: 'certificacion' as const };
    const dentro = await conBloqueoCertificado(
      cliente,
      claveBloqueo,
      async () => {
        await expect(
          conBloqueoCertificado(cliente, claveBloqueo, async () => 'no debería entrar', {
            esperaMs: 0,
          }),
        ).rejects.toBeInstanceOf(BloqueoOcupadoError);
        return 'entró';
      },
      { segundos: 30 },
    );
    expect(dentro).toBe('entró');
    const libre = await conBloqueoCertificado(cliente, claveBloqueo, async () => 'libre', {
      esperaMs: 0,
      segundos: 5,
    });
    expect(libre).toBe('libre');
  });
});
