import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alerta, BannerAmbiente, Boton, Campo, clasesBoton, Select } from '@/components/boleteame';
import { formatearRut } from '@/lib/formatos';
import { puedeAdministrar } from '@/lib/permisos';
import { leerAsistente } from '@/server/certificacion';
import { listarEmpresas } from '@/server/empresas';
import { exigirMembresia, obtenerPerfil } from '@/server/sesion';
import org from '../organizacion.module.css';
import { Asistente } from './Asistente';
import estilos from './certificacion.module.css';
import { diasHasta, elegirEmpresa } from './logica';

export const metadata: Metadata = { title: 'Certificación · Boletéame' };

// Las Server Actions de esta página (postular, solicitar folios, declarar…) hacen varias
// peticiones al SII de hasta 45 s cada una (PLAN-SAAS §4.1). En Next 16 el `maxDuration`
// de la página aplica a todas las Server Actions que se usan en ella
// (docs: route-segment-config/maxDuration, «Server Actions»). Sin Cache Components, el
// runtime se declara explícito: la capa SII solo corre en Node.js (H7).
export const maxDuration = 300;
export const runtime = 'nodejs';

async function ultimaEmpresa(): Promise<string | null> {
  try {
    return (await obtenerPerfil())?.ultimaEmpresa ?? null;
  } catch {
    // Sin la migración 0003 la consulta de preferencias falla: se elige otra empresa.
    return null;
  }
}

export default async function PaginaCertificacion({
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
  const empresa = elegirEmpresa(empresas, typeof pedida === 'string' ? pedida : null, ultima);

  const cabecera = (
    <header className={org.cabecera}>
      <p className={org.nota}>{organizacion.nombre}</p>
      <h1 className={org.titulo}>Certificación ante el SII</h1>
      <p className={org.texto}>
        Los cinco pasos para que el SII autorice a una empresa a emitir boletas electrónicas. Todo
        ocurre en el ambiente de certificación hasta la declaración de cumplimiento.
      </p>
    </header>
  );

  if (!empresa) {
    return (
      <>
        <BannerAmbiente ambiente="certificacion" />
        {cabecera}
        <Alerta tono="info" titulo="Aún no hay empresas que certificar">
          <p>
            {admin
              ? 'Agrega la empresa con su RUT y razón social, y asóciale el certificado digital de quien firma.'
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

  const vista = await leerAsistente(organizacion.id, empresa.id);
  if (!vista) notFound();

  const diasCertificado = vista.certificado ? diasHasta(vista.certificado.vigenteHasta) : null;

  return (
    <>
      <BannerAmbiente ambiente="certificacion" />
      <div className={estilos.cabeceraFila}>
        {cabecera}
        {empresas.length > 1 ? (
          // GET simple: funciona sin JavaScript y deja la empresa en la URL.
          <form method="get" className={estilos.selectorEmpresa} aria-label="Elegir empresa">
            <Campo etiqueta="Empresa que certificas">
              <Select name="empresa" defaultValue={empresa.id}>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.razonSocial} ({formatearRut(e.rut)})
                    {e.autorizadaProduccion ? ', autorizada' : ''}
                    {e.activa ? '' : ', desactivada'}
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

      <Asistente
        key={empresa.id}
        slug={slug}
        admin={admin}
        vista={vista}
        diasCertificado={diasCertificado}
      />
    </>
  );
}
