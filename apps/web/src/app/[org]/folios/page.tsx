import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alerta, Boton, Campo, clasesBoton, Select } from '@/components/boleteame';
import { formatearRut } from '@/lib/formatos';
import { puedeAdministrar } from '@/lib/permisos';
import { listarEmpresas } from '@/server/empresas';
import { leerFolios } from '@/server/folios';
import { exigirMembresia, obtenerPerfil } from '@/server/sesion';
import org from '../organizacion.module.css';
import { Folios } from './Folios';
import estilos from './folios.module.css';

export const metadata: Metadata = { title: 'Folios (CAF) · Boletéame' };

// La solicitud de folios hace varias peticiones al SII de hasta 45 s cada una (login
// AUT2000 y los pasos del asistente `of_*`; PLAN-SAAS §4.1). En Next 16 el `maxDuration`
// de la página aplica a todas las Server Actions que se usan en ella
// (docs: route-segment-config/maxDuration, «Server Actions»). La capa SII solo corre en
// Node.js (H7).
export const maxDuration = 300;
export const runtime = 'nodejs';

async function ultimaEmpresa(): Promise<string | null> {
  try {
    return (await obtenerPerfil())?.ultimaEmpresa ?? null;
  } catch {
    return null;
  }
}

export default async function PaginaFolios({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org: slug } = await params;
  const { empresa: pedida } = await searchParams;
  const { organizacion, rol } = await exigirMembresia(slug);
  const admin = puedeAdministrar(rol);

  const [empresas, ultima] = await Promise.all([listarEmpresas(organizacion.id), ultimaEmpresa()]);
  const empresa =
    empresas.find((e) => e.id === pedida) ??
    empresas.find((e) => e.id === ultima) ??
    empresas.find((e) => e.activa) ??
    empresas[0] ??
    null;

  const cabecera = (
    <header className={org.cabecera}>
      <p className={org.nota}>{organizacion.nombre}</p>
      <h1 className={org.titulo}>Folios (CAF)</h1>
      <p className={org.texto}>
        Los folios que el SII autoriza a cada empresa para timbrar boletas, en producción y en
        certificación. Pide un CAF nuevo antes de que se agoten.
      </p>
    </header>
  );

  if (!empresa) {
    return (
      <>
        {cabecera}
        <Alerta tono="info" titulo="Aún no hay empresas">
          <p>
            {admin
              ? 'Agrega la empresa con su RUT y razón social, y asóciale el certificado de su representante electrónico.'
              : 'Pide a un propietario o administrador que agregue la primera empresa.'}
          </p>
          {admin ? (
            <p className={estilos.accionAlerta}>
              <Link
                href={`/${slug}/configuracion/empresas/nueva`}
                className={clasesBoton('secundario', 'sm')}
              >
                Agregar empresa
              </Link>
            </p>
          ) : null}
        </Alerta>
      </>
    );
  }

  const vista = await leerFolios(organizacion.id, empresa.id);
  if (!vista) notFound();

  return (
    <>
      <div className={estilos.cabeceraFila}>
        {cabecera}
        {empresas.length > 1 ? (
          // GET simple: funciona sin JavaScript y deja la empresa en la URL.
          <form method="get" className={estilos.selectorEmpresa} aria-label="Elegir empresa">
            <Campo etiqueta="Empresa">
              <Select name="empresa" defaultValue={empresa.id}>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.razonSocial} ({formatearRut(e.rut)}){e.activa ? '' : ', desactivada'}
                  </option>
                ))}
              </Select>
            </Campo>
            <Boton type="submit" tamano="sm">
              Ver
            </Boton>
          </form>
        ) : null}
      </div>

      <Folios
        key={empresa.id}
        slug={slug}
        admin={admin}
        vista={vista}
        organizacionId={organizacion.id}
      />
    </>
  );
}
