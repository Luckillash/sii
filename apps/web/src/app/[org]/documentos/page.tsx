import { Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alerta,
  BannerAmbiente,
  Boton,
  Campo,
  clasesBoton,
  Input,
  Paginacion,
  Select,
  textoEstadoDte,
} from '@/components/boleteame';
import { formatearMiles, formatearRut } from '@/lib/formatos';
import { puedeAdministrar, puedeEmitir } from '@/lib/permisos';
import { ambientePorDefecto, leerDetalleDocumento, listarDocumentos } from '@/server/documentos';
import {
  ESTADOS_FILTRO,
  type FiltrosDocumentos,
  hayFiltros,
  hrefDocumentos,
  leerFiltros,
  nombrePeriodo,
  opcionesPeriodo,
  POR_PAGINA,
  TODOS_LOS_PERIODOS,
} from '@/server/documentos/filtros';
import { nombreAmbiente } from '@/server/documentos/presentacion';
import { listarEmpresas } from '@/server/empresas';
import { exigirMembresia, obtenerPerfil } from '@/server/sesion';
import { ProveedorEnVivo } from '@/stores/ProveedorEnVivo';
import org from '../organizacion.module.css';
import { Detalle } from './Detalle';
import estilos from './documentos.module.css';
import { EnVivo } from './EnVivo';
import { ListaDocumentos } from './ListaDocumentos';

export const metadata: Metadata = { title: 'Documentos emitidos · Boletéame' };

// «Consultar estado en el SII» pide un token (y lo renueva si caducó) y consulta un envío,
// hasta 45 s por petición según `TransporteUndici`: puede pasar de 2 minutos. En Next 16 el
// `maxDuration` de la página aplica a sus Server Actions: 300 s, como Folios. La capa SII
// solo corre en Node.js (H7).
export const maxDuration = 300;
export const runtime = 'nodejs';

async function ultimaEmpresa(): Promise<string | null> {
  try {
    return (await obtenerPerfil())?.ultimaEmpresa ?? null;
  } catch {
    return null;
  }
}

/**
 * «Documentos emitidos» (PLAN-SAAS Fase 8, punto 3). La URL es la fuente de verdad de los
 * filtros (§4.3): el formulario es un GET simple (funciona sin JavaScript), la tabla se
 * pagina en el servidor (`range` + `count`) y el panel de detalle se abre con `?doc=<id>`.
 * Los borradores no se listan: viven en Emitir, sin folio ni estado del SII.
 */
export default async function PaginaDocumentos({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org: slug } = await params;
  const filtros = leerFiltros(await searchParams);
  const { organizacion, rol } = await exigirMembresia(slug);
  const admin = puedeAdministrar(rol);

  const [empresas, ultima] = await Promise.all([listarEmpresas(organizacion.id), ultimaEmpresa()]);
  const empresa =
    empresas.find((e) => e.id === filtros.empresa) ??
    empresas.find((e) => e.id === ultima) ??
    empresas.find((e) => e.activa) ??
    empresas[0] ??
    null;

  if (!empresa) {
    return (
      <>
        <header className={org.cabecera}>
          <p className={org.nota}>{organizacion.nombre}</p>
          <h1 className={org.titulo}>Documentos emitidos</h1>
        </header>
        <Alerta tono="info" titulo="Aún no hay empresas">
          <p>
            {admin
              ? 'Agrega la empresa con su RUT y razón social para empezar a emitir boletas.'
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

  const ambiente =
    filtros.ambiente ??
    (await ambientePorDefecto({
      organizacionId: organizacion.id,
      empresaId: empresa.id,
      autorizadaProduccion: empresa.autorizadaProduccion,
    }));
  // Los enlaces fijan la empresa elegida solo si vino en la URL (si no, sigue la activa).
  const vigentes: FiltrosDocumentos = { ...filtros, ambiente };
  const ctx = { organizacionId: organizacion.id, empresaId: empresa.id, ambiente };

  const [lista, detalle] = await Promise.all([
    listarDocumentos(ctx, vigentes),
    filtros.doc
      ? leerDetalleDocumento(
          { organizacionId: organizacion.id, empresaId: empresa.id },
          filtros.doc,
        )
      : Promise.resolve(null),
  ]);
  const pagina = { ...vigentes, pagina: lista.pagina };
  const hrefSinDoc = hrefDocumentos(slug, pagina, { doc: null });
  const periodo = nombrePeriodo(vigentes.periodo);
  const enPeriodo = vigentes.periodo === TODOS_LOS_PERIODOS ? '' : ` en ${periodo.toLowerCase()}`;

  return (
    <ProveedorEnVivo>
      <EnVivo organizacionId={organizacion.id} canal="documentos" />
      <BannerAmbiente ambiente={ambiente} />
      <div className={estilos.cabeceraFila}>
        <header className={org.cabecera}>
          <p className={org.nota}>
            {formatearMiles(lista.total)} {lista.total === 1 ? 'documento' : 'documentos'}
            {vigentes.periodo === TODOS_LOS_PERIODOS ? '' : ' en el período'} ·{' '}
            {empresa.razonSocial} ({formatearRut(empresa.rut)})
          </p>
          <h1 className={org.titulo}>Documentos emitidos</h1>
        </header>
        {puedeEmitir(rol) ? (
          <Link
            href={`/${slug}/emitir${filtros.empresa ? `?empresa=${empresa.id}` : ''}`}
            className={clasesBoton('primario', 'md')}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Emitir boleta
          </Link>
        ) : null}
      </div>

      <form method="get" className={estilos.filtros} aria-label="Filtros">
        {empresas.length > 1 ? (
          <Campo etiqueta="Empresa" className={estilos.filtroAncho}>
            <Select name="empresa" defaultValue={empresa.id}>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.razonSocial} ({formatearRut(e.rut)}){e.activa ? '' : ', desactivada'}
                </option>
              ))}
            </Select>
          </Campo>
        ) : null}
        <Campo etiqueta="Ambiente" className={estilos.filtro}>
          <Select name="ambiente" defaultValue={ambiente}>
            <option value="produccion">{nombreAmbiente('produccion')}</option>
            <option value="certificacion">{nombreAmbiente('certificacion')}</option>
          </Select>
        </Campo>
        <Campo etiqueta="Período" className={estilos.filtro}>
          <Select name="periodo" defaultValue={vigentes.periodo}>
            {opcionesPeriodo(vigentes.periodo).map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Tipo de documento" className={estilos.filtro}>
          <Select name="tipo" defaultValue={vigentes.tipo ? String(vigentes.tipo) : ''}>
            <option value="">Todos los tipos</option>
            <option value="39">39 · Boleta electrónica</option>
            <option value="41">41 · Boleta exenta electrónica</option>
          </Select>
        </Campo>
        <Campo etiqueta="Estado" className={estilos.filtro}>
          <Select name="estado" defaultValue={vigentes.estado ?? ''}>
            <option value="">Todos los estados</option>
            {ESTADOS_FILTRO.map((e) => (
              <option key={e} value={e}>
                {textoEstadoDte(e)}
              </option>
            ))}
          </Select>
        </Campo>
        <Campo etiqueta="Buscar" className={estilos.filtroBusqueda} anchoCompleto>
          <Input
            name="q"
            type="search"
            defaultValue={vigentes.q}
            placeholder="Folio, RUT o razón social"
            maxLength={60}
          />
        </Campo>
        <div className={estilos.botonesFiltro}>
          <Boton type="submit" tamano="md">
            Filtrar
          </Boton>
          {hayFiltros(vigentes) ? (
            <Link
              href={hrefDocumentos(slug, vigentes, {
                tipo: null,
                estado: null,
                q: '',
                pagina: 1,
                doc: null,
              })}
              className={clasesBoton('discreto', 'md')}
            >
              Limpiar
            </Link>
          ) : null}
        </div>
      </form>

      <div className={estilos.contenido}>
        <div className={estilos.columnaTabla}>
          <ListaDocumentos
            titulo={`${periodo} · ${nombreAmbiente(ambiente)}`}
            filas={lista.filas}
            seleccionado={detalle?.id ?? null}
            hrefBase={hrefSinDoc}
            vacio={
              hayFiltros(vigentes)
                ? `Ningún documento calza con esos filtros${enPeriodo}. Prueba con otros o límpialos.`
                : `Aún no hay boletas emitidas ${ambiente === 'produccion' ? 'en producción' : 'en certificación'}${enPeriodo}.`
            }
          />
          <Paginacion
            pagina={lista.pagina}
            porPagina={POR_PAGINA}
            total={lista.total}
            hrefPagina={(n) => hrefDocumentos(slug, pagina, { pagina: n, doc: null })}
            etiqueta="Páginas de documentos"
          />
        </div>
        {filtros.doc && !detalle ? (
          <div className={estilos.panel}>
            <Alerta tono="aviso" titulo="No encontramos ese documento">
              <p>
                Puede que sea de otra empresa o que todavía sea un borrador (los borradores están en
                Emitir). Elige otro de la lista.
              </p>
            </Alerta>
          </div>
        ) : null}
        {detalle ? (
          <Detalle
            slug={slug}
            doc={detalle}
            hrefCerrar={hrefSinDoc}
            puedeReenviar={puedeEmitir(rol)}
          />
        ) : null}
      </div>
    </ProveedorEnVivo>
  );
}
