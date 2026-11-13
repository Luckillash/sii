import { KeyRound } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { Alerta, Tabla, TablaVacia, Tarjeta, Td, Th } from '@/components/boleteame';
import { formatearFecha, formatearFechaHora, formatearRut, hoyEnChile } from '@/lib/formatos';
import { puedeAdministrar } from '@/lib/permisos';
import {
  type Empresa,
  listarResoluciones,
  obtenerEmpresa,
  type Resolucion,
} from '@/server/empresas';
import { exigirMembresia } from '@/server/sesion';
import org from '../../../organizacion.module.css';
import estilos from '../empresas.module.css';
import { AMBIENTES, type Ambiente, ETIQUETA_AMBIENTE } from '../esquemas';
import { FormularioEmpresa } from '../FormularioEmpresa';
import { AvisoEmpresaCreada } from './AvisoEmpresaCreada';
import { EstadoEmpresa } from './EstadoEmpresa';
import { FormularioResolucion } from './FormularioResolucion';

export const metadata: Metadata = { title: 'Empresa · Boletéame' };

// Detalle de una empresa: datos tributarios, resoluciones del SII, certificados y
// activación. Todos los miembros la ven; solo los administradores ven formularios y
// botones (la autoridad es RLS: cada acción se vuelve a verificar en el servidor).

const esquemaId = z.guid();

export default async function PaginaEmpresa({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<{ [clave: string]: string | string[] | undefined }>;
}) {
  const { org: slug, id } = await params;
  const { organizacion, rol } = await exigirMembresia(slug);
  if (!esquemaId.safeParse(id).success) notFound();
  const empresa = await obtenerEmpresa(organizacion.id, id);
  if (!empresa) notFound();

  const admin = puedeAdministrar(rol);
  const [resoluciones, { creada }] = await Promise.all([
    listarResoluciones(organizacion.id, empresa.id),
    searchParams,
  ]);
  const vigentes: Partial<Record<Ambiente, Resolucion>> = {};
  for (const r of resoluciones) if (r.vigente) vigentes[r.ambiente] = r;

  const rutaEmpresa = `/${slug}/configuracion/empresas/${empresa.id}`;

  return (
    <>
      <header className={org.cabecera}>
        <p className={org.nota}>
          <Link href={`/${slug}/configuracion`}>Configuración</Link> ·{' '}
          <Link href={`/${slug}/configuracion/empresas`}>Empresas</Link>
        </p>
        <h1 className={org.titulo}>{empresa.razonSocial}</h1>
        <div className={estilos.estados}>
          <span className={`${org.texto} ${estilos.mono}`}>RUT {formatearRut(empresa.rut)}</span>
          <span
            className={[estilos.estado, empresa.activa && estilos.estadoExito]
              .filter(Boolean)
              .join(' ')}
          >
            {empresa.activa ? 'Activa' : 'Desactivada'}
          </span>
          <span
            className={[estilos.estado, empresa.autorizadaProduccion && estilos.estadoSello]
              .filter(Boolean)
              .join(' ')}
          >
            {empresa.autorizadaProduccion
              ? 'Autorizada a producción'
              : 'Sin autorización a producción'}
          </span>
        </div>
        {admin ? null : (
          <p className={org.texto}>
            Solo un propietario o un administrador puede editar esta empresa.
          </p>
        )}
      </header>

      {creada === '1' && admin ? <AvisoEmpresaCreada /> : null}
      {empresa.activa ? null : (
        <Alerta tono="aviso" titulo="Esta empresa está desactivada">
          No se puede elegir para emitir ni pedir folios.
          {admin ? ' Puedes activarla al final de esta página.' : null}
        </Alerta>
      )}

      <Tarjeta as="section" aria-labelledby="t-datos" className={estilos.seccion}>
        <h2 id="t-datos" className={org.subtitulo}>
          Datos tributarios
        </h2>
        {admin ? (
          <FormularioEmpresa
            slug={slug}
            empresa={{ id: empresa.id, valores: valoresDe(empresa) }}
          />
        ) : (
          <DatosEmpresa empresa={empresa} />
        )}
        <p className={estilos.nota}>
          {empresa.autorizadaProduccion && empresa.autorizadaEn
            ? `La empresa está autorizada a emitir en producción desde el ${formatearFecha(empresa.autorizadaEn)}.`
            : 'La autorización a producción la marca el sistema cuando el SII aprueba la certificación de la empresa, o cuando registras su resolución de producción si ya se certificó fuera de Boletéame.'}
        </p>
      </Tarjeta>

      <Tarjeta as="section" aria-labelledby="t-resoluciones" className={estilos.seccion}>
        <h2 id="t-resoluciones" className={org.subtitulo}>
          Resoluciones del SII
        </h2>
        <p className={estilos.nota}>
          El número y la fecha de la resolución van en la carátula de cada envío al SII. Hay una
          vigente por ambiente; al registrar otra, la anterior pasa al historial.
        </p>

        <ul className={estilos.vigentes} aria-label="Resolución vigente por ambiente">
          {AMBIENTES.map((a) => {
            const r = vigentes[a];
            return (
              <li key={a} className={estilos.vigente}>
                <span className={estilos.vigenteAmbiente}>{ETIQUETA_AMBIENTE[a]}</span>
                {r ? (
                  <span className={estilos.vigenteDato}>
                    N° {r.numero} · {formatearFecha(r.fecha)}
                  </span>
                ) : (
                  <span className={estilos.vigenteVacia}>Sin resolución vigente</span>
                )}
              </li>
            );
          })}
        </ul>

        {admin ? (
          <FormularioResolucion
            slug={slug}
            empresaId={empresa.id}
            hoy={hoyEnChile()}
            vigentes={Object.fromEntries(
              Object.entries(vigentes).map(([a, r]) => [a, { numero: r.numero, fecha: r.fecha }]),
            )}
          />
        ) : null}

        <Tabla etiqueta="Historial de resoluciones">
          <thead>
            <tr>
              <Th>Ambiente</Th>
              <Th num>Número</Th>
              <Th>Fecha</Th>
              <Th>Estado</Th>
              <Th>Registrada</Th>
            </tr>
          </thead>
          <tbody>
            {resoluciones.length === 0 ? (
              <TablaVacia columnas={5}>
                {admin
                  ? 'Aún no hay resoluciones. Registra la de certificación con el formulario de arriba cuando el SII te entregue la fecha.'
                  : 'Aún no hay resoluciones registradas.'}
              </TablaVacia>
            ) : (
              resoluciones.map((r) => (
                <tr key={r.id}>
                  <Td>{ETIQUETA_AMBIENTE[r.ambiente]}</Td>
                  <Td num mono>
                    {r.numero}
                  </Td>
                  <Td mono>{formatearFecha(r.fecha)}</Td>
                  <Td>
                    <span
                      className={[estilos.estado, r.vigente && estilos.estadoExito]
                        .filter(Boolean)
                        .join(' ')}
                    >
                      {r.vigente ? 'Vigente' : 'Reemplazada'}
                    </span>
                  </Td>
                  <Td mono>{formatearFechaHora(r.creadaEn)}</Td>
                </tr>
              ))
            )}
          </tbody>
        </Tabla>
      </Tarjeta>

      <Tarjeta as="section" aria-labelledby="t-certificados" className={org.tarjeta}>
        <h2 id="t-certificados" className={org.subtitulo}>
          <KeyRound size={20} strokeWidth={1.5} aria-hidden="true" /> Certificados
        </h2>
        <p className={org.texto}>
          Qué certificados digitales firman los documentos de esta empresa, quién es representante
          electrónico y cuál se usa por defecto.
        </p>
        <p>
          <Link href={`${rutaEmpresa}/certificados`}>Certificados que firman por esta empresa</Link>
        </p>
      </Tarjeta>

      {admin ? (
        <Tarjeta as="section" aria-labelledby="t-estado" className={org.tarjeta}>
          <h2 id="t-estado" className={org.subtitulo}>
            {empresa.activa ? 'Desactivar empresa' : 'Activar empresa'}
          </h2>
          <EstadoEmpresa
            slug={slug}
            empresaId={empresa.id}
            razonSocial={empresa.razonSocial}
            activa={empresa.activa}
          />
        </Tarjeta>
      ) : null}
    </>
  );
}

function valoresDe(empresa: Empresa) {
  return {
    rut: empresa.rut,
    razonSocial: empresa.razonSocial,
    giro: empresa.giro,
    direccion: empresa.direccion,
    comuna: empresa.comuna,
    correoIntercambio: empresa.correoIntercambio ?? '',
  };
}

function DatosEmpresa({ empresa }: { empresa: Empresa }) {
  const filas: [string, string, boolean?][] = [
    ['RUT', formatearRut(empresa.rut), true],
    ['Razón social', empresa.razonSocial],
    ['Giro', empresa.giro],
    ['Dirección', empresa.direccion],
    ['Comuna', empresa.comuna],
    ['Correo de intercambio', empresa.correoIntercambio ?? 'Sin registrar'],
  ];
  return (
    <dl className={estilos.datos}>
      {filas.map(([etiqueta, valor, mono]) => (
        <div key={etiqueta} className={estilos.dato}>
          <dt className={estilos.datoEtiqueta}>{etiqueta}</dt>
          <dd className={[estilos.datoValor, mono && estilos.mono].filter(Boolean).join(' ')}>
            {valor}
          </dd>
        </div>
      ))}
    </dl>
  );
}
