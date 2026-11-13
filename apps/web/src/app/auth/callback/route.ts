import type { EmailOtpType } from '@supabase/supabase-js';
import { type NextRequest, NextResponse } from 'next/server';
import { destinoSeguro } from '@/lib/redireccion';
import { clienteAuth } from '@/server/supabase/servidor';

// Destino de los enlaces de los correos de Supabase Auth (PLAN-SAAS §3.1).
//
//   ?code=…                       PKCE: el enlace se abrió en el mismo navegador donde se
//                                 pidió (signUp, signInWithOtp, resetPasswordForEmail).
//   ?token_hash=…&type=…          plantillas de correo con {{ .TokenHash }}: funciona aunque
//                                 se abra en otro navegador. Es lo recomendado.
//   &siguiente=/ruta              adónde ir después (solo rutas internas).
//
// `recovery` siempre termina en /restablecer. En el flujo PKCE el tipo no viaja en la
// URL: `resetPasswordForEmail` debe usar
// redirectTo = `${NEXT_PUBLIC_APP_URL}/auth/callback?siguiente=/restablecer`.
// Cualquier error → /ingresar?error=enlace (la pantalla muestra el mensaje).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIPOS_OTP = new Set<EmailOtpType>([
  'signup',
  'invite',
  'magiclink',
  'recovery',
  'email_change',
  'email',
]);

function esTipoOtp(valor: string | null): valor is EmailOtpType {
  return valor !== null && TIPOS_OTP.has(valor);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const code = params.get('code');
  const tokenHash = params.get('token_hash');
  const tipo = params.get('type');
  const siguiente = destinoSeguro(params.get('siguiente'));

  const ir = (ruta: string) => NextResponse.redirect(new URL(ruta, request.url));
  const fallo = () => ir('/ingresar?error=enlace');

  try {
    // Solo auth.*: reenvía la IP real (límite de verificaciones por IP). Ni verifyOtp ni
    // el canje PKCE piden captcha.
    const { supabase } = await clienteAuth();

    if (tokenHash && esTipoOtp(tipo)) {
      const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: tipo });
      if (error) return fallo();
      return ir(tipo === 'recovery' ? '/restablecer' : siguiente);
    }

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return fallo();
      return ir(siguiente);
    }
  } catch (error) {
    // Configuración incompleta o Auth caído: mismo mensaje para la persona. Al log solo
    // el mensaje (los de env.ts nombran variables, nunca valores; no hay tokens).
    console.error('auth/callback:', error instanceof Error ? error.message : 'error desconocido');
    return fallo();
  }

  // Sin parámetros válidos, o Supabase devolvió ?error=… (enlace vencido o usado).
  return fallo();
}
