import 'server-only';
import { z } from 'zod';

// Variables de entorno del servidor (PLAN-SAAS §5). Se validan al usarlas, no al
// importar el módulo, para que `next build` funcione sin secretos.

const esquemaSupabase = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
});

const esquemaSpike = z.object({
  /** Bearer que protege las rutas /api/spike/* mientras existan. */
  SPIKE_TOKEN: z.string().min(32),
  /** Certificado de prueba del spike: .pfx en base64 y su clave (solo Preview). */
  SPIKE_CERT_PFX_BASE64: z.string().min(100).optional(),
  SPIKE_CERT_PASS: z.string().optional(),
  /** RUT de la empresa para pedir el token (`76543210-3`). */
  SPIKE_RUT_EMPRESA: z
    .string()
    .regex(/^\d{1,8}-[\dkK]$/)
    .optional(),
});

function validar<T extends z.ZodType>(esquema: T, nombre: string): z.infer<T> {
  const resultado = esquema.safeParse(process.env);
  if (!resultado.success) {
    // Solo los nombres de las variables, nunca sus valores.
    const faltan = resultado.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Configuración incompleta (${nombre}): revisa ${faltan}.`);
  }
  return resultado.data;
}

export const envSupabase = () => validar(esquemaSupabase, 'Supabase');
export const envSpike = () => validar(esquemaSpike, 'spike');
