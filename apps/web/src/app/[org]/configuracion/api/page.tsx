import type { Metadata } from 'next';
import Link from 'next/link';
import { Alerta, Tarjeta } from '@/components/boleteame';
import { RUTA_DOCS_API, URL_API } from '@/lib/api-publica';
import { puedeAdministrar } from '@/lib/permisos';
import { listarEmpresas } from '@/server/empresas';
import { leerClavesApi, leerPlanIntegraciones } from '@/server/integraciones/lectura';
import { exigirMembresia } from '@/server/sesion';
import org from '../../organizacion.module.css';
import estilos from './api.module.css';
import { FormularioClave } from './FormularioClave';
import { TablaClaves } from './TablaClaves';

export const metadata: Metadata = { title: 'API' };

// Configuración → API (PLAN-SAAS Fase 11, punto 1): crear API keys (la clave se muestra
// una vez), ver su prefijo, permisos, ambiente, empresa, vencimiento y último uso, y
// revocarlas. Solo propietarios y administradores (RLS `es_admin` de `api_keys`).

export default async function PaginaApi({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { organizacion, rol } = await exigirMembresia(slug);
  const admin = puedeAdministrar(rol);

  const cabecera = (
    <header className={org.cabecera}>
      <p className={org.nota}>
        <Link href={`/${slug}/configuracion`}>Configuración</Link> · {organizacion.nombre}
      </p>
      <h1 className={org.titulo}>API</h1>
      <p className={org.texto}>
        Conecta tu sistema para emitir boletas, consultar su estado y descargar el XML y el PDF. La
        URL base es <span className={estilos.mono}>{URL_API}</span>. Revisa la{' '}
        <Link href={RUTA_DOCS_API}>documentación de la API</Link>.
      </p>
    </header>
  );

  if (!admin) {
    return (
      <>
        {cabecera}
        <Alerta tono="info" titulo="Solo un propietario o un administrador gestiona la API">
          Pide a uno de ellos que cree la API key que necesitas.
        </Alerta>
      </>
    );
  }

  const [plan, claves, empresas] = await Promise.all([
    leerPlanIntegraciones(organizacion.id),
    leerClavesApi(organizacion.id),
    listarEmpresas(organizacion.id),
  ]);

  return (
    <>
      {cabecera}

      {plan.incluyeApi ? null : (
        <Alerta
          tono="aviso"
          titulo={
            plan.morosa
              ? 'La API está detenida por un pago vencido'
              : 'Tu plan no incluye acceso por API'
          }
        >
          {plan.morosa
            ? 'Mientras el pago esté vencido, las API keys responden 403. '
            : `El plan ${plan.nombre ?? 'actual'} no incluye la API: las claves existentes responden 403 y no puedes crear nuevas. `}
          <Link href={`/${slug}/configuracion/plan`}>Revisa tu plan</Link>.
        </Alerta>
      )}

      <Tarjeta as="section" aria-labelledby="t-crear" className={estilos.bloque}>
        <h2 id="t-crear" className={estilos.subtitulo}>
          Crear una API key
        </h2>
        <FormularioClave
          slug={slug}
          empresas={empresas
            .filter((e) => e.activa)
            .map((e) => ({ id: e.id, rut: e.rut, razonSocial: e.razonSocial }))}
          permiteProduccion={plan.permiteProduccion}
          deshabilitado={!plan.incluyeApi}
        />
      </Tarjeta>

      <section aria-labelledby="t-claves" className={estilos.seccion}>
        <h2 id="t-claves" className={estilos.subtitulo}>
          API keys
        </h2>
        <p className={estilos.nota}>
          Solo guardamos una huella de cada clave: si pierdes una, revócala y crea otra.
        </p>
        <TablaClaves slug={slug} claves={claves} />
      </section>
    </>
  );
}
