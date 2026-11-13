import type { Metadata } from 'next';
import Link from 'next/link';
import { Alerta, Tarjeta } from '@/components/boleteame';
import { puedeAdministrar } from '@/lib/permisos';
import { bloqueoPorPlan, cupoEmpresas } from '@/server/empresas';
import { mensajeCupoEmpresas, SIN_PERMISO, SIN_PLAN_VIGENTE } from '@/server/empresas-errores';
import { exigirMembresia } from '@/server/sesion';
import org from '../../../organizacion.module.css';
import estilos from '../empresas.module.css';
import { FormularioEmpresa } from '../FormularioEmpresa';

export const metadata: Metadata = { title: 'Agregar empresa · Boletéame' };

export default async function PaginaNuevaEmpresa({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { organizacion, rol } = await exigirMembresia(slug);
  const admin = puedeAdministrar(rol);
  const rutaLista = `/${slug}/configuracion/empresas`;

  const cupo = admin ? await cupoEmpresas(organizacion.id) : null;
  const bloqueo = cupo ? bloqueoPorPlan(cupo) : null;
  const impedimento = !admin
    ? SIN_PERMISO
    : bloqueo === 'sin_plan'
      ? SIN_PLAN_VIGENTE
      : bloqueo === 'cupo_lleno' && cupo?.maximo != null
        ? mensajeCupoEmpresas(cupo.plan ?? 'vigente', cupo.maximo)
        : null;

  return (
    <>
      <header className={org.cabecera}>
        <p className={org.nota}>
          <Link href={`/${slug}/configuracion`}>Configuración</Link> ·{' '}
          <Link href={rutaLista}>Empresas</Link>
        </p>
        <h1 className={org.titulo}>Agregar empresa</h1>
        <p className={org.texto}>
          Los datos tributarios del contribuyente que emite, tal como figuran en el SII. Van en cada
          documento que emitas.
        </p>
      </header>

      {impedimento ? (
        <Alerta tono={admin ? 'aviso' : 'info'} titulo={impedimento.titulo}>
          <p>{impedimento.detalle}</p>
          <p>
            <Link href={rutaLista}>Volver a Empresas</Link>
          </p>
        </Alerta>
      ) : (
        <Tarjeta as="section" aria-label="Datos de la empresa" className={estilos.seccion}>
          <FormularioEmpresa slug={slug} />
        </Tarjeta>
      )}
    </>
  );
}
