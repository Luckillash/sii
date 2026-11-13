import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LayoutIngreso } from '@/components/boleteame';
import { exigirUsuario, obtenerMembresias, obtenerPerfil } from '@/server/sesion';
import estilos from './bienvenida.module.css';
import { FormularioOrganizacion } from './FormularioOrganizacion';

// Onboarding (PLAN-SAAS Fase 2, punto 3). Quien ya pertenece a alguna organización no
// ve el formulario: se va a la última que abrió (si sigue siendo miembro) o a la
// primera. Quien llega con `?invitacion=<token>` se va a aceptar la invitación.

export const metadata: Metadata = { title: 'Crea tu organización · Boletéame' };

/** Forma de un token de `token_aleatorio()` (64 hex); se acepta algo más amplio. */
const FORMA_TOKEN = /^[A-Za-z0-9_-]{16,128}$/;

async function ultimaOrganizacion(): Promise<string | null> {
  try {
    return (await obtenerPerfil())?.ultimaOrganizacion ?? null;
  } catch (error) {
    // Sin la migración 0003 la columna no existe: se elige la primera organización.
    console.warn('No se pudo leer la última organización', (error as Error).message);
    return null;
  }
}

export default async function Bienvenida({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const usuario = await exigirUsuario();

  const { invitacion } = await searchParams;
  if (typeof invitacion === 'string' && FORMA_TOKEN.test(invitacion)) {
    redirect(`/invitacion/${invitacion}`);
  }

  const membresias = await obtenerMembresias();
  if (membresias.length > 0) {
    const ultima = await ultimaOrganizacion();
    const destino = membresias.find((m) => m.organizacionId === ultima) ?? membresias[0];
    if (destino) redirect(`/${destino.slug}/tablero`);
  }

  return (
    <LayoutIngreso
      titular="Empecemos por tu organización."
      bajada="En ella agruparás tus empresas emisoras, tu equipo y tus documentos."
    >
      <div className={estilos.titulos}>
        <h1 className={estilos.titulo}>Crea tu organización</h1>
        <p className={estilos.nota}>
          Parte con el plan Certificación en prueba durante 30 días, para que certifiques tu empresa
          ante el SII.
        </p>
      </div>

      <FormularioOrganizacion />

      <div className={estilos.cuenta}>
        <p className={estilos.nota}>
          Ingresaste como <strong className={estilos.correo}>{usuario.correo}</strong>. Si te
          invitaron a una organización existente, abre el enlace de la invitación.
        </p>
        <form action="/auth/salir" method="post">
          <button type="submit" className={estilos.enlace}>
            Cerrar sesión
          </button>
        </form>
      </div>
    </LayoutIngreso>
  );
}
