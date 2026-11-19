import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement } from 'react';
import { Alerta, Glifo, type NombreGlifo, Tarjeta, type Tono } from '@/components/boleteame';
import tonos from '@/components/boleteame/tonos.module.css';
import {
  ETIQUETA_AMBIENTE,
  ETIQUETA_NIVEL,
  MINUTOS_ATRASO_SEGUIMIENTO,
  MINUTOS_CORRIDA_VIGENTE,
  type NivelEstado,
  RESUMEN_GENERAL,
  TONO_NIVEL,
  VENTANA_SII_MINUTOS,
} from '@/lib/estado';
import { formatearFechaHora } from '@/lib/formatos';
import { type EstadoServicio, leerEstadoServicio } from '@/server/estado';
import { ID_CONTENIDO } from '../_compartido/enlaces';
import estilos from './estado.module.css';

// Estado del servicio (PLAN-SAAS Fase 12). Pública y sin datos de ninguna organización:
// `leerEstadoServicio` devuelve solo niveles y frases fijas, y nunca lanza. No se muestra
// ninguna hora de actividad (última respuesta del SII, última consulta automática): solo
// la hora en que se generó la página.
// Se regenera como mucho cada 60 s, así que la base recibe unas pocas lecturas por minuto
// aunque la visiten muchas personas.

export const revalidate = 60;

export const metadata: Metadata = {
  title: 'Estado del servicio',
  description:
    'Estado de la plataforma de Boletéame, su base de datos, la conexión con el SII en certificación y producción, y el seguimiento automático de envíos.',
};

const GLIFO_NIVEL: Readonly<Record<NivelEstado, NombreGlifo>> = {
  operativo: 'aceptado',
  demoras: 'reparos',
  problemas: 'rechazado',
  sin_datos: 'borrador',
};

const TONO_ALERTA: Readonly<Record<NivelEstado, Tono>> = {
  operativo: 'exito',
  demoras: 'aviso',
  problemas: 'error',
  sin_datos: 'info',
};

function Nivel({ nivel }: { nivel: NivelEstado }): ReactElement {
  return (
    <span className={[estilos.nivel, tonos[TONO_NIVEL[nivel]]].join(' ')}>
      <Glifo nombre={GLIFO_NIVEL[nivel]} size={14} />
      <span>{ETIQUETA_NIVEL[nivel]}</span>
    </span>
  );
}

function Hora({ iso }: { iso: string }): ReactElement {
  return <time dateTime={iso}>{formatearFechaHora(iso)}</time>;
}

interface Fila {
  id: string;
  titulo: string;
  nivel: NivelEstado;
  detalle: string;
}

function filasDe(estado: EstadoServicio): Fila[] {
  // Producción primero: es la que importa para las boletas con validez tributaria.
  const sii = [...estado.sii].sort((a, b) =>
    a.ambiente === b.ambiente ? 0 : a.ambiente === 'produccion' ? -1 : 1,
  );
  return [
    { id: 'plataforma', titulo: 'Plataforma', ...estado.plataforma },
    { id: 'base-datos', titulo: 'Base de datos', ...estado.baseDatos },
    ...sii.map((fila) => ({
      id: `sii-${fila.ambiente}`,
      titulo: `Conexión con el SII · ${ETIQUETA_AMBIENTE[fila.ambiente]}`,
      nivel: fila.nivel,
      detalle: fila.detalle,
    })),
    { id: 'seguimiento', titulo: 'Seguimiento automático de envíos', ...estado.seguimiento },
  ];
}

export default async function PaginaEstado() {
  const estado = await leerEstadoServicio();
  const filas = filasDe(estado);

  return (
    <main id={ID_CONTENIDO} tabIndex={-1}>
      <div className={estilos.contenedor}>
        <header className={estilos.cabecera}>
          <p className={estilos.antetitulo}>Soporte</p>
          <h1 className={estilos.titulo}>Estado del servicio</h1>
          <p className={estilos.bajada}>
            Cómo están funcionando Boletéame y su conexión con el SII en este momento.
          </p>
        </header>

        <Alerta tono={TONO_ALERTA[estado.general]} titulo={RESUMEN_GENERAL[estado.general]}>
          <p className={estilos.medido}>
            Medido el <Hora iso={estado.medidoEn} /> (hora de Chile). Esta página se actualiza cada
            minuto.
          </p>
        </Alerta>

        <Tarjeta relleno="ninguno" aria-labelledby="componentes-titulo">
          <h2 id="componentes-titulo" className="sr-only">
            Componentes del servicio
          </h2>
          <ul className={estilos.filas}>
            {filas.map((fila) => (
              <li key={fila.id} className={estilos.fila}>
                <div className={estilos.filaTexto}>
                  <h3 className={estilos.filaTitulo}>{fila.titulo}</h3>
                  <p className={estilos.detalle}>{fila.detalle}</p>
                </div>
                <Nivel nivel={fila.nivel} />
              </li>
            ))}
          </ul>
        </Tarjeta>

        <section className={estilos.explicacion} aria-labelledby="como-se-mide">
          <h2 id="como-se-mide">Cómo se mide</h2>
          <ul>
            <li>
              <strong>Conexión con el SII:</strong> miramos las operaciones con el SII de todos los
              clientes en los últimos {VENTANA_SII_MINUTOS} minutos, sin datos de ninguno. Si el SII
              no responde o la conexión se corta en una parte de ellas, la fila pasa a «Con demoras»
              o «Con problemas». «Sin datos» significa que no hay mediciones recientes, no que haya
              una falla.
            </li>
            <li>
              <strong>Seguimiento automático:</strong> revisa cada 5 minutos el estado de los envíos
              en el SII. La fila pasa a «Con problemas» si hay envíos que llevan más de{' '}
              {MINUTOS_ATRASO_SEGUIMIENTO} minutos sin su primera consulta y el seguimiento no
              completó bien ninguna corrida en los últimos {MINUTOS_CORRIDA_VIGENTE} minutos. Un
              envío que se atrasa por algo de su propia empresa (por ejemplo, un certificado
              vencido) se ve en el panel de esa empresa, no aquí.
            </li>
            <li>
              <strong>Base de datos:</strong> hacemos una lectura de prueba y medimos cuánto tarda.
            </li>
          </ul>
          <p>
            El SII tiene sus propias intermitencias y mantenciones, que no dependen de Boletéame.
            Cuando ocurren, los envíos pueden demorar o quedar «Por verificar»: en ese caso no
            vuelvas a emitir sin revisar antes en el SII (
            <Link className={estilos.enlace} href="/ayuda#por-verificar">
              cómo hacerlo
            </Link>
            ).
          </p>
          <p>
            Si algo no funciona y aquí todo aparece operativo,{' '}
            <Link className={estilos.enlace} href="/contacto">
              escríbenos
            </Link>
            .
          </p>
        </section>
      </div>
    </main>
  );
}
