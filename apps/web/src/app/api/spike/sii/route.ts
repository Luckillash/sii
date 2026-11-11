import { Certificado, ClienteBoletaRest, TransporteUndici } from '@winex/certificacion';
import { leerLlave } from '@/server/cifrado';
import { envSpike } from '@/server/env';
import { rechazoSpike } from '@/server/spike/autorizar';
import {
  HOSTS_CERTIFICACION,
  huellaCorta,
  type MaterialTls,
  ocultarRut,
  probarHost,
  rsaSha1Disponible,
} from '@/server/spike/conectividad';
import { clienteServicio } from '@/server/supabase/service';
import { TokenStoreSupabase } from '@/server/sii/token-store-supabase';

// Spike de red Vercel → SII (Fase 0). Temporal: se borra al cerrar la fase.
//
//   curl -H "Authorization: Bearer $SPIKE_TOKEN" https://<preview>/api/spike/sii
//   ...?nuevo=1  fuerza un token nuevo (olvida el guardado antes de pedirlo)
//
// Criterio de aceptación: obtiene un token de apicert y lo guarda cifrado en tokens_sii.

export const runtime = 'nodejs';
export const preferredRegion = 'gru1';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

function describirError(error: unknown): { tipo: string; mensaje: string } {
  if (error instanceof Error) {
    // Los errores de la librería no incluyen tokens, cookies ni PEM (regla de la librería).
    return { tipo: error.name, mensaje: ocultarRut(error.message) };
  }
  return { tipo: 'desconocido', mensaje: ocultarRut(String(error)) };
}

async function probarToken(certificado: Certificado, rutEmpresa: string, nuevo: boolean) {
  const inicio = performance.now();
  const store = new TokenStoreSupabase(clienteServicio(), leerLlave(process.env.SII_TOKENS_KEY));
  const transporte = new TransporteUndici();
  try {
    const cliente = new ClienteBoletaRest(certificado, {
      ambiente: 'certificacion',
      transporte,
      tokenStore: store,
    });
    if (nuevo) await cliente.olvidarToken(rutEmpresa);
    const token = await cliente.obtenerToken(rutEmpresa);
    const msToken = Math.round(performance.now() - inicio);

    // Verificación independiente: la fila existe en tokens_sii, cifrada, y descifra
    // al mismo token.
    const clave = cliente.claveToken(rutEmpresa);
    const { data: fila, error } = await clienteServicio()
      .from('tokens_sii')
      .select('vence_en, actualizado_en, token_cifrado')
      .eq('canal', clave.canal)
      .eq('ambiente', clave.ambiente)
      .eq('rut_empresa', clave.rutEmpresa)
      .eq('huella_certificado', clave.huellaCertificado)
      .maybeSingle();
    if (error) throw new Error(`No se pudo leer tokens_sii (código ${error.code}).`);
    const releido = await store.obtener(clave);
    const cifrado = typeof fila?.token_cifrado === 'string' ? fila.token_cifrado : '';

    return {
      ok: Boolean(fila) && releido?.token === token,
      ms: msToken,
      guardadoEnTokensSii: Boolean(fila),
      cifrado: cifrado !== '' && !Buffer.from(cifrado.slice(2), 'hex').includes(token),
      bytesCifrados: cifrado ? (cifrado.length - 2) / 2 : 0,
      descifraAlMismoToken: releido?.token === token,
      venceEn: fila?.vence_en ?? null,
      actualizadoEn: fila?.actualizado_en ?? null,
    };
  } catch (error) {
    return { ok: false, ms: Math.round(performance.now() - inicio), error: describirError(error) };
  } finally {
    await transporte.close();
  }
}

export async function GET(request: Request) {
  const rechazo = rechazoSpike(request);
  if (rechazo) return rechazo;

  const env = envSpike();
  const nuevo = new URL(request.url).searchParams.get('nuevo') === '1';
  const inicio = performance.now();

  let certificado: Certificado | null = null;
  let errorCertificado: { tipo: string; mensaje: string } | null = null;
  if (env.SPIKE_CERT_PFX_BASE64) {
    try {
      certificado = Certificado.desdeContenido(
        Buffer.from(env.SPIKE_CERT_PFX_BASE64, 'base64'),
        env.SPIKE_CERT_PASS ?? '',
      );
    } catch (error) {
      errorCertificado = describirError(error);
    }
  }
  const material: MaterialTls | null = certificado
    ? { key: certificado.llavePrivada, cert: certificado.cadena }
    : null;

  const [hosts, token] = await Promise.all([
    Promise.all(HOSTS_CERTIFICACION.map((h) => probarHost(h, material))),
    certificado && env.SPIKE_RUT_EMPRESA
      ? probarToken(certificado, env.SPIKE_RUT_EMPRESA, nuevo)
      : Promise.resolve({
          ok: false,
          omitido: 'Falta SPIKE_CERT_PFX_BASE64 / SPIKE_CERT_PASS / SPIKE_RUT_EMPRESA.',
        }),
  ]);

  const info = certificado?.info();
  const informe = {
    fecha: new Date().toISOString(),
    entorno: {
      region: process.env.VERCEL_REGION ?? 'local',
      vercelEnv: process.env.VERCEL_ENV ?? 'local',
      node: process.version,
      openssl: process.versions.openssl,
      rsaSha1: rsaSha1Disponible(),
    },
    certificado: certificado
      ? {
          huella: huellaCorta(certificado.certificado),
          cn: info?.cn ? ocultarRut(info.cn) : null,
          vigenteHasta: info?.vigenteHasta ?? null,
        }
      : errorCertificado
        ? { error: errorCertificado }
        : null,
    hosts,
    token,
    ok:
      hosts.every(
        (h) => h.handshake.ok && h.get.ok && (h.handshakeConCertificado?.ok ?? true),
      ) && token.ok,
    msTotal: Math.round(performance.now() - inicio),
  };

  return Response.json(informe, {
    status: informe.ok ? 200 : 502,
    headers: { 'Cache-Control': 'no-store' },
  });
}
