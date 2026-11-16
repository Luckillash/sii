import type { Metadata } from 'next';
import Link from 'next/link';
import { z } from 'zod';
import { Alerta, Boton, Campo, clasesBoton, Select } from '@/components/boleteame';
import { formatearRut } from '@/lib/formatos';
import { ETIQUETA_ROL, puedeAdministrar, puedeEmitir } from '@/lib/permisos';
import { leerVistaEmision } from '@/server/emision';
import { listarEmpresas } from '@/server/empresas';
import { exigirMembresia, obtenerPerfil } from '@/server/sesion';
import org from '../organizacion.module.css';
import { Emision } from './Emision';
import estilos from './emitir.module.css';

export const metadata: Metadata = { title: 'Emitir documento · Boletéame' };

// La emisión pide un token al SII y hace una subida (PLAN-SAAS §4.1: 60 s). En Next 16 el
// `maxDuration` de la página aplica a todas las Server Actions que se usan en ella
// (docs: route-segment-config/maxDuration, «Server Actions»). La capa SII solo corre en
// Node.js (H7).
export const maxDuration = 60;
export const runtime = 'nodejs';

const esquemaId = z.uuid();

async function ultimaEmpresa(): Promise<string | null> {
  try {
    return (await obtenerPerfil())?.ultimaEmpresa ?? null;
  } catch {
    return null;
  }
}

function unico(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function PaginaEmitir({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org: slug } = await params;
  const consulta = await searchParams;
  const pedida = unico(consulta.empresa);
  const borradorPedido = unico(consulta.borrador);
  const { organizacion, rol } = await exigirMembresia(slug);

  const cabecera = (
    <header className={org.cabecera}>
      <p className={org.nota}>{organizacion.nombre}</p>
      <h1 className={org.titulo}>Emitir boleta</h1>
      <p className={org.texto}>
        Arma la boleta, revisa el resumen y confírmala: la firmamos con el certificado de la empresa
        y la enviamos al SII.
      </p>
    </header>
  );

  if (!puedeEmitir(rol)) {
    return (
      <>
        {cabecera}
        <Alerta tono="info" titulo={`Con el rol ${ETIQUETA_ROL[rol]} no puedes emitir`}>
          <p>
            Puedes consultar los documentos emitidos y los folios, pero emitir boletas es de los
            propietarios, administradores y emisores. Si lo necesitas, pide a un administrador que
            cambie tu rol en Equipo.
          </p>
        </Alerta>
      </>
    );
  }

  const admin = puedeAdministrar(rol);
  const [empresas, ultima] = await Promise.all([listarEmpresas(organizacion.id), ultimaEmpresa()]);
  const empresa =
    empresas.find((e) => e.id === pedida) ??
    empresas.find((e) => e.id === ultima) ??
    empresas.find((e) => e.activa) ??
    empresas[0] ??
    null;

  if (!empresa) {
    return (
      <>
        {cabecera}
        <Alerta tono="info" titulo="Aún no hay empresas">
          <p>
            {admin
              ? 'Para emitir, agrega la empresa con su RUT y razón social, asóciale el certificado de su representante y pide folios.'
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

  const borradorId =
    borradorPedido && esquemaId.safeParse(borradorPedido).success ? borradorPedido : undefined;
  const vista = await leerVistaEmision(
    { organizacionId: organizacion.id, empresaId: empresa.id },
    borradorId ? { borradorId } : {},
  );

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

      {borradorPedido && !vista.borrador ? (
        <Alerta tono="aviso" titulo="No encontramos ese borrador">
          Puede que ya se haya emitido o borrado. Sigue con el formulario o elige otro de tus
          borradores.
        </Alerta>
      ) : null}

      <Emision
        key={empresa.id}
        slug={slug}
        organizacionId={organizacion.id}
        vista={vista}
        borradorEnUrl={borradorPedido !== undefined}
      />
    </>
  );
}
