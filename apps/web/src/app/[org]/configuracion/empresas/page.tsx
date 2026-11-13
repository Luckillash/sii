import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Alerta, clasesBoton, Tabla, TablaVacia, Td, Th } from '@/components/boleteame';
import { formatearRut } from '@/lib/formatos';
import { puedeAdministrar } from '@/lib/permisos';
import { bloqueoPorPlan, cupoEmpresas, listarEmpresas } from '@/server/empresas';
import { mensajeCupoEmpresas, SIN_PLAN_VIGENTE } from '@/server/empresas-errores';
import { exigirMembresia } from '@/server/sesion';
import org from '../../organizacion.module.css';
import estilos from './empresas.module.css';

export const metadata: Metadata = { title: 'Empresas · Boletéame' };

export default async function PaginaEmpresas({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { organizacion, rol } = await exigirMembresia(slug);
  const admin = puedeAdministrar(rol);

  const [empresas, cupo] = await Promise.all([
    listarEmpresas(organizacion.id),
    admin ? cupoEmpresas(organizacion.id) : Promise.resolve(null),
  ]);

  // Aviso temprano: la base lo exige igual con tg_limite_empresas.
  const bloqueo = cupo ? bloqueoPorPlan(cupo) : null;
  const avisoPlan =
    bloqueo === 'sin_plan'
      ? SIN_PLAN_VIGENTE
      : bloqueo === 'cupo_lleno' && cupo?.maximo != null
        ? mensajeCupoEmpresas(cupo.plan ?? 'vigente', cupo.maximo)
        : null;

  return (
    <>
      <header className={estilos.cabeceraFila}>
        <div className={org.cabecera}>
          <p className={org.nota}>
            <Link href={`/${slug}/configuracion`}>Configuración</Link> · {organizacion.nombre}
          </p>
          <h1 className={org.titulo}>Empresas</h1>
          <p className={org.texto}>
            Los contribuyentes que emiten documentos desde {organizacion.nombre}, con sus datos
            tributarios y las resoluciones del SII.
            {admin ? null : ' Solo un propietario o un administrador puede agregarlas o editarlas.'}
          </p>
        </div>
        {admin && !avisoPlan ? (
          <Link href={`/${slug}/configuracion/empresas/nueva`} className={clasesBoton('primario')}>
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" /> Agregar empresa
          </Link>
        ) : null}
      </header>

      {avisoPlan ? (
        <Alerta tono="aviso" titulo={avisoPlan.titulo}>
          {avisoPlan.detalle}
        </Alerta>
      ) : null}

      <Tabla etiqueta="Empresas de la organización">
        <thead>
          <tr>
            <Th>RUT</Th>
            <Th>Razón social</Th>
            <Th>Comuna</Th>
            <Th>Estado</Th>
            <Th>Producción</Th>
          </tr>
        </thead>
        <tbody>
          {empresas.length === 0 ? (
            <TablaVacia columnas={5}>
              {admin
                ? 'Aún no hay empresas. Agrega la primera para registrar su resolución del SII y asociar su certificado digital.'
                : 'Aún no hay empresas. Pide a un propietario o administrador que agregue la primera.'}
            </TablaVacia>
          ) : (
            empresas.map((e) => (
              <tr key={e.id}>
                <Td mono>{formatearRut(e.rut)}</Td>
                <Td className={estilos.celdaNombre}>
                  <Link href={`/${slug}/configuracion/empresas/${e.id}`}>{e.razonSocial}</Link>
                </Td>
                <Td>{e.comuna}</Td>
                <Td>
                  <span
                    className={[estilos.estado, e.activa && estilos.estadoExito]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {e.activa ? 'Activa' : 'Desactivada'}
                  </span>
                </Td>
                <Td>
                  <span
                    className={[estilos.estado, e.autorizadaProduccion && estilos.estadoSello]
                      .filter(Boolean)
                      .join(' ')}
                  >
                    {e.autorizadaProduccion ? 'Autorizada' : 'Sin autorizar'}
                  </span>
                </Td>
              </tr>
            ))
          )}
        </tbody>
      </Tabla>
    </>
  );
}
