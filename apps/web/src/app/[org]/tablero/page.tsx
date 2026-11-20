import { Download, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Alerta,
  BannerAmbiente,
  Boton,
  Campo,
  clasesBoton,
  MedidorFolios,
  Monto,
  Select,
  Tarjeta,
  TipoDTE,
} from '@/components/boleteame';
import { type AlertaCertificados, alertasCertificados } from '@/lib/certificados-estado';
import { enAmbiente, nombreAmbiente } from '@/lib/documentos-presentacion';
import { formatearFechaHora, formatearMiles, formatearRut, nombreTipoDte } from '@/lib/formatos';
import { puedeAdministrar, puedeEmitir } from '@/lib/permisos';
import { type FormatoReporte, hrefExportacion, type Reporte } from '@/lib/reportes';
import { estadosCertificados } from '@/server/certificados/consultas';
import {
  ambientePorDefecto,
  type EnvioIncierto,
  enviosInciertos,
  type FilaDocumento,
  listarDocumentos,
} from '@/server/documentos';
import {
  type FiltrosDocumentos,
  hrefDocumentos,
  hrefInciertos,
  nombrePeriodo,
} from '@/server/documentos/filtros';
import { listarEmpresas } from '@/server/empresas';
import { leerResumenFolios, type ResumenTipo } from '@/server/folios';
import { exigirMembresia, obtenerPerfil } from '@/server/sesion';
import {
  alertasFolios,
  type CifrasPeriodo,
  cifrasDocumentos,
  detalleExento,
  detalleVentas,
  leerCifras,
  leerFiltrosTablero,
  medidorFoliosTablero,
  opcionesPeriodoTablero,
} from '@/server/tablero';
import { ProveedorEnVivo } from '@/stores/ProveedorEnVivo';
import { EnVivo } from '../documentos/EnVivo';
import { ListaDocumentos } from '../documentos/ListaDocumentos';
import org from '../organizacion.module.css';
import estilos from './tablero.module.css';

export const metadata: Metadata = { title: 'Tablero' };

/** Cuántos documentos muestra «Últimos documentos emitidos» (como la plantilla). */
const ULTIMOS = 6;

/**
 * Lee una parte del Tablero sin tumbar la página: si falla, esa sección muestra un aviso
 * y el resto se ve igual. Solo se registra el tipo de error (nunca datos).
 */
async function seguro<T>(parte: string, leer: () => Promise<T>): Promise<T | null> {
  try {
    return await leer();
  } catch (error) {
    console.error(`Tablero: no se pudo leer ${parte}`, {
      tipo: error instanceof Error ? error.name : null,
    });
    return null;
  }
}

async function ultimaEmpresa(): Promise<string | null> {
  try {
    return (await obtenerPerfil())?.ultimaEmpresa ?? null;
  } catch {
    return null;
  }
}

/** Avisos de vencimiento (Fase 3, punto 5). Si la lectura falla, el Tablero se muestra igual. */
async function avisosCertificados(organizacionId: string): Promise<AlertaCertificados[]> {
  return (
    (await seguro('el estado de los certificados', async () =>
      alertasCertificados(await estadosCertificados(organizacionId)),
    )) ?? []
  );
}

/** Una combinación empresa+ambiente por cada grupo de envíos (para el enlace a Documentos). */
function enlacesInciertos(
  envios: EnvioIncierto[],
): Pick<EnvioIncierto, 'empresaId' | 'ambiente'>[] {
  const vistos = new Map<string, Pick<EnvioIncierto, 'empresaId' | 'ambiente'>>();
  for (const e of envios) {
    vistos.set(`${e.empresaId}-${e.ambiente}`, { empresaId: e.empresaId, ambiente: e.ambiente });
  }
  return [...vistos.values()];
}

function textoFolios(e: EnvioIncierto): string {
  if (e.folios.length === 0) return 'sin boletas asociadas';
  return e.folios
    .map((f) => `${nombreTipoDte(f.tipoDte, true)} N.º ${formatearMiles(f.folio)}`)
    .join(', ');
}

function Falla({ texto }: { texto: string }) {
  return (
    <Tarjeta variante="plana" relleno="ninguno" className={estilos.falla} role="status">
      <p>{texto}</p>
    </Tarjeta>
  );
}

function PrimerosPasos({ slug, admin }: { slug: string; admin: boolean }) {
  return (
    <Tarjeta as="section" aria-labelledby="t-proximo" className={org.tarjeta}>
      <h2 id="t-proximo" className={org.subtitulo}>
        Lo que viene
      </h2>
      <p className={org.texto}>
        Tu organización ya está creada. Para emitir, cada empresa necesita:
      </p>
      <ul className={org.lista}>
        <li>
          el RUT, la razón social y el giro, en{' '}
          <Link href={`/${slug}/configuracion/empresas`}>Empresas</Link>
          {';'}
        </li>
        <li>
          el certificado digital (.pfx) de quien firma, en{' '}
          <Link href={`/${slug}/configuracion/certificados`}>Certificados</Link>
          {';'}
        </li>
        <li>la resolución del SII que autoriza a emitir, en la página de cada empresa.</li>
      </ul>
      <p className={org.texto}>
        Cuando emitas, aquí verás las cifras del mes, tus folios y los últimos documentos.
        {admin ? (
          <>
            {' '}
            Mientras tanto, puedes{' '}
            <Link href={`/${slug}/configuracion/equipo`}>invitar a tu equipo</Link>.
          </>
        ) : null}
      </p>
    </Tarjeta>
  );
}

function Cifras({ cifras }: { cifras: CifrasPeriodo }) {
  const docs = cifrasDocumentos(cifras.conteo);
  const exento = detalleExento(cifras.ventas);
  return (
    <div className={estilos.cifras}>
      <Tarjeta as="div" relleno="ninguno" className={estilos.cifra}>
        <span className={estilos.etiquetaCifra}>Ventas netas</span>
        <Monto valor={cifras.ventas.neto} destacado />
        <span className={estilos.notaCifra}>{detalleVentas(cifras.ventas)}</span>
        {exento ? <span className={estilos.notaCifra}>{exento}</span> : null}
      </Tarjeta>
      <Tarjeta as="div" relleno="ninguno" className={estilos.cifra}>
        <span className={estilos.etiquetaCifra}>IVA débito</span>
        <Monto valor={cifras.ventas.iva} destacado />
        <span className={estilos.notaCifra}>19% sobre ventas afectas</span>
      </Tarjeta>
      <Tarjeta as="div" relleno="ninguno" className={estilos.cifra}>
        <span className={estilos.etiquetaCifra}>Documentos emitidos</span>
        <span className={estilos.numero}>{formatearMiles(docs.emitidos)}</span>
        <span className={estilos.notaCifra}>{docs.detalle}</span>
        {docs.anulados ? <span className={estilos.notaCifra}>{docs.anulados}</span> : null}
      </Tarjeta>
      <Tarjeta as="div" relleno="ninguno" className={estilos.cifra}>
        <span className={estilos.etiquetaCifra}>Esperando al SII</span>
        <span className={estilos.numero}>{formatearMiles(docs.esperando)}</span>
        <span className={estilos.notaCifra}>Enviados con Track ID, sin respuesta</span>
      </Tarjeta>
    </div>
  );
}

/**
 * Un tipo con CAF en uso va con su `MedidorFolios`, con los mismos números que la alerta
 * (todos los CAF activos, `medidorFoliosTablero`); sin folios, una tarjeta que lo dice.
 */
function Medidor({ r }: { r: ResumenTipo }) {
  const m = medidorFoliosTablero(r);
  if (m) {
    return (
      <div>
        <MedidorFolios codigo={r.tipoDte} desde={m.desde} hasta={m.hasta} siguiente={m.siguiente} />
        {m.varios ? (
          <p className={estilos.notaCifra}>
            Suma los folios de todos los CAF activos de este tipo.
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <Tarjeta as="div" relleno="ninguno" className={estilos.sinFolios}>
      <div className={estilos.sinFoliosCabecera}>
        <TipoDTE codigo={r.tipoDte} corto />
        <span className={estilos.notaCifra}>0 disponibles</span>
      </div>
      <p className={r.tuvoCaf ? estilos.agotado : estilos.notaCifra}>
        {r.tuvoCaf
          ? 'CAF agotado: no puedes emitir este tipo hasta que pidas o subas uno nuevo.'
          : 'Aún no hay folios de este tipo.'}
      </p>
    </Tarjeta>
  );
}

const DESCARGAS: readonly { reporte: Reporte; formato: FormatoReporte; texto: string }[] = [
  { reporte: 'documentos', formato: 'csv', texto: 'Boletas del período (CSV)' },
  { reporte: 'documentos', formato: 'xlsx', texto: 'Boletas del período (Excel)' },
  { reporte: 'resumen', formato: 'csv', texto: 'Resumen diario por tipo (CSV)' },
  { reporte: 'resumen', formato: 'xlsx', texto: 'Resumen diario por tipo (Excel)' },
];

/**
 * Tablero (PLAN-SAAS Fase 9): resumen del período tributario de una empresa en un
 * ambiente. Empresa, ambiente y período van en la URL (formulario GET, como Documentos);
 * las cifras se leen con RLS y se refrescan por Realtime cuando cambia un documento.
 */
export default async function Tablero({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { org: slug } = await params;
  const filtros = leerFiltrosTablero(await searchParams);
  const { organizacion, rol } = await exigirMembresia(slug);
  const admin = puedeAdministrar(rol);

  const [empresas, ultima, avisos] = await Promise.all([
    listarEmpresas(organizacion.id),
    ultimaEmpresa(),
    avisosCertificados(organizacion.id),
  ]);
  const empresa =
    empresas.find((e) => e.id === filtros.empresa) ??
    empresas.find((e) => e.id === ultima) ??
    empresas.find((e) => e.activa) ??
    empresas[0] ??
    null;

  const alertasCertificado = avisos.map((a) => (
    <Alerta key={a.tono} tono={a.tono} titulo={a.titulo}>
      <p>{a.detalle}</p>
      <p className={estilos.accionAviso}>
        <Link
          href={`/${slug}/configuracion/certificados`}
          className={clasesBoton('secundario', 'sm')}
        >
          {admin ? 'Cargar certificado' : 'Ver certificados'}
        </Link>
      </p>
    </Alerta>
  ));

  if (!empresa) {
    return (
      <>
        <header className={org.cabecera}>
          <p className={org.nota}>{organizacion.nombre}</p>
          <h1 className={org.titulo}>Tablero</h1>
        </header>
        {alertasCertificado}
        <PrimerosPasos slug={slug} admin={admin} />
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
  const { periodo } = filtros;
  // Los enlaces a Documentos fijan empresa, ambiente y período: muestran lo mismo que aquí.
  const vistaDocumentos: FiltrosDocumentos = {
    ambiente,
    empresa: empresa.id,
    periodo,
    tipo: null,
    estado: null,
    q: '',
    pagina: 1,
    doc: null,
  };
  const ctx = { organizacionId: organizacion.id, empresaId: empresa.id, ambiente, periodo };

  const [cifras, resumenFolios, ultimos, inciertos] = await Promise.all([
    seguro('las cifras del período', () => leerCifras(ctx)),
    seguro('los folios', () => leerResumenFolios(organizacion.id, empresa.id)),
    seguro('los últimos documentos', async (): Promise<FilaDocumento[]> => {
      const lista = await listarDocumentos(ctx, vistaDocumentos);
      return lista.filas.slice(0, ULTIMOS);
    }),
    // Los `incierto` de la empresa en los dos ambientes (Fase 8, punto 2): un envío por
    // verificar hay que revisarlo aunque se esté mirando el otro ambiente.
    seguro('los envíos por verificar', () =>
      enviosInciertos({ organizacionId: organizacion.id, empresaId: empresa.id }),
    ),
  ]);
  const foliosAmbiente = resumenFolios?.filter((r) => r.ambiente === ambiente) ?? null;
  const avisosFolios = resumenFolios ? alertasFolios(resumenFolios, ambiente) : [];
  const nombreMes = nombrePeriodo(periodo);
  const consultaEmpresa = filtros.empresa ? `?empresa=${empresa.id}` : '';

  return (
    <ProveedorEnVivo>
      <EnVivo organizacionId={organizacion.id} canal="tablero" />
      <BannerAmbiente ambiente={ambiente} />
      <div className={estilos.cabeceraFila}>
        <header className={org.cabecera}>
          <p className={org.nota}>
            Período tributario {nombreMes.toLowerCase()} · Actualizado{' '}
            {formatearFechaHora(new Date())} · {empresa.razonSocial} ({formatearRut(empresa.rut)})
          </p>
          <h1 className={org.titulo}>Resumen del mes</h1>
        </header>
        {puedeEmitir(rol) ? (
          <Link
            href={`/${slug}/emitir${consultaEmpresa}`}
            className={clasesBoton('primario', 'md')}
          >
            <Plus size={16} strokeWidth={1.5} aria-hidden="true" />
            Emitir boleta
          </Link>
        ) : null}
      </div>

      <form method="get" className={estilos.filtros} aria-label="Período y ambiente">
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
        <Campo etiqueta="Período tributario" className={estilos.filtro}>
          <Select name="periodo" defaultValue={periodo}>
            {opcionesPeriodoTablero(periodo).map((o) => (
              <option key={o.valor} value={o.valor}>
                {o.texto}
              </option>
            ))}
          </Select>
        </Campo>
        <Boton type="submit" tamano="md" variante="secundario">
          Ver período
        </Boton>
      </form>

      {inciertos && inciertos.total > 0 ? (
        <Alerta
          tono="aviso"
          titulo={
            inciertos.total === 1
              ? 'Hay un envío por verificar en el SII'
              : `Hay ${formatearMiles(inciertos.total)} envíos por verificar en el SII`
          }
        >
          <p>
            La conexión con el SII se cortó antes de recibir el Track ID, así que no sabemos si
            llegaron. No los reintentamos solos: revisa en el sitio del SII (Boleta electrónica,
            consulta de boletas emitidas) si cada folio quedó recibido antes de volver a emitirlo.
            Si ya había llegado y lo emites de nuevo, quedaría duplicado. Cuando lo revises, márcalo
            con «Ya lo revisé» en la página del envío.
          </p>
          <ul className={estilos.listaInciertos}>
            {inciertos.envios.map((e) => (
              <li key={e.id}>
                <Link href={`/${slug}/envios/${e.id}`}>
                  Envío del {formatearFechaHora(e.creadoEn)} {enAmbiente(e.ambiente)}
                </Link>
                : {textoFolios(e)}
              </li>
            ))}
          </ul>
          {inciertos.total > inciertos.envios.length ? (
            <p className={estilos.accionAviso}>
              Mostramos los {formatearMiles(inciertos.envios.length)} más recientes. Para ver el
              resto, filtra por «Por verificar» en Documentos emitidos:{' '}
              {enlacesInciertos(inciertos.envios).map((g, i) => (
                <span key={`${g.empresaId}-${g.ambiente}`}>
                  {i > 0 ? ', ' : null}
                  <Link href={hrefInciertos(slug, g.empresaId, g.ambiente)}>
                    {enAmbiente(g.ambiente)}
                  </Link>
                </span>
              ))}
              .
            </p>
          ) : null}
        </Alerta>
      ) : null}

      {alertasCertificado}

      {avisosFolios.map((a) => (
        <Alerta key={a.tono} tono={a.tono} titulo={`${a.titulo} ${enAmbiente(ambiente)}`}>
          <p>{a.detalle}</p>
          <p className={estilos.accionAviso}>
            <Link
              href={`/${slug}/folios${consultaEmpresa}`}
              className={clasesBoton('secundario', 'sm')}
            >
              {admin ? 'Pedir folios' : 'Ver folios'}
            </Link>
          </p>
        </Alerta>
      ))}

      <section aria-labelledby="t-cifras" className={estilos.seccion}>
        <h2 id="t-cifras" className={org.subtitulo}>
          Cifras del período
        </h2>
        {cifras ? (
          <Cifras cifras={cifras} />
        ) : (
          <Falla texto="No pudimos leer las cifras del período. Recarga la página en un momento; si sigue igual, revisa Documentos emitidos." />
        )}
      </section>

      <section aria-labelledby="t-folios" className={estilos.seccion}>
        <div className={estilos.seccionCabecera}>
          <h2 id="t-folios" className={org.subtitulo}>
            Folios disponibles
          </h2>
          <Link href={`/${slug}/folios${consultaEmpresa}`} className={estilos.enlaceSeccion}>
            Administrar folios
          </Link>
        </div>
        {foliosAmbiente ? (
          <div className={estilos.medidores}>
            {foliosAmbiente.map((r) => (
              <Medidor key={r.tipoDte} r={r} />
            ))}
          </div>
        ) : (
          <Falla texto="No pudimos leer los folios. Recarga la página en un momento o revisa la página de Folios." />
        )}
      </section>

      <section aria-labelledby="t-ultimos" className={estilos.seccion}>
        <div className={estilos.seccionCabecera}>
          <h2 id="t-ultimos" className={org.subtitulo}>
            Últimos documentos emitidos
          </h2>
          <Link href={hrefDocumentos(slug, vistaDocumentos)} className={estilos.enlaceSeccion}>
            Ver todos
          </Link>
        </div>
        {ultimos ? (
          <ListaDocumentos
            titulo={`${nombreMes} · ${nombreAmbiente(ambiente)}`}
            filas={ultimos}
            seleccionado={null}
            hrefBase={hrefDocumentos(slug, vistaDocumentos)}
            vacio={`Aún no hay boletas emitidas ${enAmbiente(ambiente)} en ${nombreMes.toLowerCase()}.`}
          />
        ) : (
          <Falla texto="No pudimos leer los últimos documentos. Recarga la página en un momento." />
        )}
      </section>

      <section aria-labelledby="t-descargas" className={estilos.seccion}>
        <h2 id="t-descargas" className={org.subtitulo}>
          Descargas
        </h2>
        <p className={org.texto}>
          Las boletas de {nombreMes.toLowerCase()} {enAmbiente(ambiente)}, una por fila, y el
          resumen diario por tipo de las aceptadas por el SII.
        </p>
        <div className={estilos.descargas}>
          {DESCARGAS.map((d) => (
            <a
              key={`${d.reporte}-${d.formato}`}
              href={hrefExportacion(slug, {
                empresa: empresa.id,
                ambiente,
                periodo,
                reporte: d.reporte,
                formato: d.formato,
              })}
              download
              className={clasesBoton('secundario', 'sm')}
            >
              <Download size={16} strokeWidth={1.5} aria-hidden="true" />
              {d.texto}
            </a>
          ))}
        </div>
      </section>
    </ProveedorEnVivo>
  );
}
