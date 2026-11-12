import type { Metadata } from 'next';
import Link from 'next/link';
import { Tarjeta } from '@/components/timbre';
import { puedeAdministrar, rolesInvitables } from '@/lib/permisos';
import { envCorreo } from '@/server/env';
import { cupoUsuarios, listarInvitaciones, listarMiembros } from '@/server/equipo';
import { exigirMembresia } from '@/server/sesion';
import org from '../../organizacion.module.css';
import estilos from './equipo.module.css';
import { FormularioInvitar } from './FormularioInvitar';
import { TablasEquipo } from './TablasEquipo';

export const metadata: Metadata = { title: 'Equipo · Timbre' };

export default async function PaginaEquipo({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { usuario, organizacion, rol } = await exigirMembresia(slug);
  const admin = puedeAdministrar(rol);

  const [miembros, invitaciones, cupo] = await Promise.all([
    listarMiembros(organizacion.id),
    admin ? listarInvitaciones(organizacion.id) : Promise.resolve(null),
    admin ? cupoUsuarios(organizacion.id) : Promise.resolve(null),
  ]);

  const cupoLleno = cupo?.maximo != null && cupo.usados >= cupo.maximo;
  const avisoCupo =
    cupo && cupoLleno
      ? `El plan ${cupo.plan ?? 'vigente'} permite hasta ${cupo.maximo} usuarios y ya están todos ocupados. Quita a un miembro o cambia de plan para invitar a alguien más.`
      : null;

  return (
    <>
      <header className={org.cabecera}>
        <p className={org.nota}>
          <Link href={`/${slug}/configuracion`}>Configuración</Link> · {organizacion.nombre}
        </p>
        <h1 className={org.titulo}>Equipo</h1>
        <p className={org.texto}>
          Quienes pueden entrar a {organizacion.nombre} y qué puede hacer cada uno.
          {admin ? null : ' Solo un propietario o un administrador puede invitar o cambiar roles.'}
        </p>
      </header>

      {admin ? (
        <Tarjeta as="section" aria-labelledby="t-invitar" className={estilos.bloque}>
          <h2 id="t-invitar" className={estilos.subtitulo}>
            Invitar a una persona
          </h2>
          <FormularioInvitar
            slug={slug}
            roles={rolesInvitables(rol)}
            correoConfigurado={envCorreo() !== null}
            avisoCupo={avisoCupo}
          />
        </Tarjeta>
      ) : null}

      <TablasEquipo
        slug={slug}
        organizacion={organizacion.nombre}
        usuarioId={usuario.id}
        rolActor={rol}
        miembros={miembros}
        invitaciones={invitaciones}
      />
    </>
  );
}
