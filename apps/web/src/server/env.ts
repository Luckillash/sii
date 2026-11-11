import 'server-only';
import { z } from 'zod';

// Variables de entorno del servidor (PLAN-SAAS §5). Se validan al usarlas, no al
// importar el módulo, para que `next build` funcione sin secretos.

const esquemaSupabase = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
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
