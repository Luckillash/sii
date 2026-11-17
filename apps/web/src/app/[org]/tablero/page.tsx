import type { Metadata } from 'next';
import Link from 'next/link';
import { Alerta, clasesBoton, Tarjeta } from '@/components/boleteame';
import { formatearFechaHora, formatearMiles, nombreTipoDte } from '@/lib/formatos';
import { puedeAdministrar } from '@/lib/permisos';
import { estadosCertificados } from '@/server/certificados/consultas';
import { type AlertaCertificados, alertasCertificados } from '@/server/certificados/estado';
import { type EnvioIncierto, enviosInciertos } from '@/server/documentos';
import { hrefInciertos } from '@/server/documentos/filtros';
import { enAmbiente } from '@/server/documentos/presentacion';
import { listarEmpresas } from '@/server/empresas';
import { exigirMembresia, obtenerPerfil } from '@/server/sesion';
import org from '../organizacion.module.css';
import estilos from './tablero.module.css';

export const metadata: Metadata = { title: 'Tablero · Boletéame' };

/**
 * Envíos `incierto` de la empresa activa (PLAN-SAAS Fase 8, punto 2): nunca se reintentan
 * solos. Se muestran los de los dos ambientes, cada uno con el suyo: el Tablero aún no
 * tiene selector de ambiente (Fase 9) y un incierto de cualquiera de ellos hay que
 * revisarlo. Si la lectura falla, el Tablero se muestra igual.
 */
async function inciertosEmpresaActiva(
  organizacionId: string,
): Promise<{ envios: EnvioIncierto[]; total: number }> {
  try {
    const [empresas, perfil] = await Promise.all([
      listarEmpresas(organizacionId),
      obtenerPerfil().catch(() => null),
    ]);
    const empresa =
      empresas.find((e) => e.id === perfil?.ultimaEmpresa) ??
      empresas.find((e) => e.activa) ??
      empresas[0];
    if (!empresa) return { envios: [], total: 0 };
    return await enviosInciertos({ organizacionId, empresaId: empresa.id });
  } catch (error) {
    console.error('Tablero: no se pudieron leer los envíos por verificar', {
      tipo: error instanceof Error ? error.name : null,
    });
    return { envios: [], total: 0 };
  }
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

/** Avisos de vencimiento (Fase 3, punto 5). Si la lectura falla, el Tablero se muestra igual. */
async function avisosCertificados(organizacionId: string): Promise<AlertaCertificados[]> {
  try {
    return alertasCertificados(await estadosCertificados(organizacionId));
  } catch (error) {
    console.error('Tablero: no se pudo leer el estado de los certificados', {
      mensaje: error instanceof Error ? error.message : null,
    });
    return [];
  }
}

// Provisorio: los avisos de certificados llegan en la Fase 3; los indicadores, en la
// Fase 9.
export default async function Tablero({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { organizacion, rol } = await exigirMembresia(slug);
  const [avisos, inciertos] = await Promise.all([
    avisosCertificados(organizacion.id),
    inciertosEmpresaActiva(organizacion.id),
  ]);
  const admin = puedeAdministrar(rol);

  return (
    <>
      <header className={org.cabecera}>
        <p className={org.nota}>{organizacion.nombre}</p>
        <h1 className={org.titulo}>Tablero</h1>
      </header>

      {inciertos.total > 0 ? (
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

      {avisos.map((a) => (
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
      ))}

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
          Más adelante, aquí verás el estado de tus documentos y folios.
          {admin ? (
            <>
              {' '}
              Mientras tanto, puedes{' '}
              <Link href={`/${slug}/configuracion/equipo`}>invitar a tu equipo</Link>.
            </>
          ) : null}
        </p>
      </Tarjeta>
    </>
  );
}
