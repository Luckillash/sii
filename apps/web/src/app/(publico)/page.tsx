import { ArrowRight, Code, FilePlus2, Hash, LayoutDashboard, Send } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import {
  Alerta,
  clasesBoton,
  EstadoDTE,
  MedidorFolios,
  TablaDTE,
  Tarjeta,
} from '@/components/boleteame';
import { formatearMonto } from '@/lib/formatos';
import { caracteristicasPlan } from '@/lib/planes';
import {
  DESCRIPCION_PLAN,
  PLAN_DESTACADO,
  textoPlanAMedida,
  textoPlanCertificacion,
} from '@/lib/planes-publicos';
import { leerGrillaPublica } from '@/server/planes-publicos';
import { JsonLd } from '../_seo/JsonLd';
import { ID_CONTENIDO, RUTA_CREAR_CUENTA } from './_compartido/enlaces';
import {
  CABECERAS_EJEMPLO,
  CUERPO_EJEMPLO,
  DOCUMENTOS_EJEMPLO,
  FOLIOS_EJEMPLO,
  jsonCompacto,
  PASOS_PUBLICOS,
  RESPUESTA_EJEMPLO,
  URL_EMISION,
} from './contenido';
import estilos from './inicio.module.css';

// Landing (PLAN-SAAS Fase 12) sobre la plantilla «Landing» (`Main.dc.html`), con los
// textos ajustados a lo que existe: boleta electrónica (39) y boleta exenta (41), sin
// factura ni Libro de Compras y Ventas hasta la Fase 14 (H1, H2, D5).
//
// Estática: los precios se leen de `planes` con el cliente anónimo sin cookies y la
// página se regenera cada hora. Si la lectura falla se muestra la grilla de respaldo.

export const revalidate = 3600;

export const metadata: Metadata = {
  title: { absolute: 'Boletéame · Boletas electrónicas ante el SII' },
  description:
    'Emite boletas electrónicas y boletas exentas ante el SII: firma con tu certificado digital, folios (CAF), seguimiento de cada envío, certificación guiada y una API para tu sistema.',
};

const ICONO = { size: 24, strokeWidth: 1.5, 'aria-hidden': true } as const;

const FUNCIONES: { icono: ReactNode; titulo: string; texto: string }[] = [
  {
    icono: <FilePlus2 {...ICONO} />,
    titulo: 'Emite y firma',
    texto:
      'Boleta electrónica y boleta exenta con precios brutos, firmadas con tu certificado digital y timbradas con el folio que corresponde. Si indicas el correo del receptor, le llega el PDF.',
  },
  {
    icono: <Send {...ICONO} />,
    titulo: 'Envía al SII y sigue el Track ID',
    texto:
      'Cada envío guarda su Track ID y la respuesta del SII. Si una boleta se rechaza, ves el motivo que informó el SII.',
  },
  {
    icono: <Hash {...ICONO} />,
    titulo: 'Controla tus folios',
    texto:
      'Ve cuántos folios quedan en cada Código de Autorización de Folios (CAF), pídelos al SII desde Boletéame y recibe un aviso antes de quedarte sin rango.',
  },
  {
    icono: <LayoutDashboard {...ICONO} />,
    titulo: 'Tablero y reportes',
    texto:
      'Ventas, IVA y boletas del mes por empresa, y las boletas del período en CSV o Excel para revisarlas con tu contador.',
  },
];

function Flecha(): ReactElement {
  return <ArrowRight size={16} strokeWidth={1.5} aria-hidden="true" className={estilos.flecha} />;
}

export default async function Inicio() {
  const grilla = await leerGrillaPublica();

  return (
    <main id={ID_CONTENIDO} tabIndex={-1} className={estilos.principal}>
      <JsonLd planes={grilla.tarjetas} />
      {/* --- Hero --------------------------------------------------------------- */}
      <section className={estilos.hero} aria-labelledby="t-inicio">
        <div className={estilos.heroTexto}>
          <p className={estilos.antetitulo}>Boletas electrónicas ante el SII</p>
          <h1 id="t-inicio" className={estilos.titular}>
            Emite, firma y envía tus boletas electrónicas sin vueltas.
          </h1>
          <p className={estilos.bajadaHero}>
            Boletéame arma el XML de cada boleta electrónica o boleta exenta, lo firma con tu
            certificado digital, lo envía al Servicio de Impuestos Internos y te muestra en qué
            estado quedó.
          </p>
          <div className={estilos.botones}>
            <Link
              href={RUTA_CREAR_CUENTA}
              className={clasesBoton('primario', 'md', estilos.grande)}
            >
              Crear cuenta
            </Link>
            <Link href="#producto" className={clasesBoton('secundario', 'md', estilos.grande)}>
              Ver cómo funciona
            </Link>
          </div>
          <p className={estilos.letraChica}>
            Funciona con tu certificado digital y los folios (CAF) que autoriza el SII.
          </p>
        </div>

        <div className={estilos.heroVisual}>
          <div aria-hidden="true" className={estilos.sello} />
          <div aria-hidden="true" className={estilos.perforacionVertical} />
          <div aria-hidden="true" className={estilos.perforacionHorizontal} />
          <div aria-hidden="true" className={estilos.ocre} />
          <Tarjeta
            as="div"
            relleno="ninguno"
            className={estilos.panelEjemplo}
            role="group"
            aria-label="Ejemplo del panel de Boletéame"
          >
            <div className={estilos.panelCabecera}>
              <span className={estilos.panelTitulo}>Boletas emitidas</span>
              <span className={estilos.panelFecha}>Noviembre 2026</span>
            </div>
            {/* Sin filas seleccionables, el marco de TablaDTE no tiene nada enfocable: la
                región desplazable (alcanzable con el teclado) es este envoltorio. */}
            <section
              className={estilos.desplazable}
              aria-label="Boletas emitidas de ejemplo"
              // biome-ignore lint/a11y/noNoninteractiveTabindex: región desplazable, como el marco de `Tabla`
              tabIndex={0}
            >
              <TablaDTE documentos={DOCUMENTOS_EJEMPLO} className={estilos.tablaEjemplo} />
            </section>
            <MedidorFolios {...FOLIOS_EJEMPLO} />
            <p className={estilos.leyendaEjemplo}>Ejemplo con datos ficticios.</p>
          </Tarjeta>
        </div>
      </section>

      {/* --- Producto: ciclo del documento -------------------------------------- */}
      <section id="producto" className={estilos.bandaClara} aria-labelledby="t-producto">
        <div className={estilos.contenedor}>
          <div className={estilos.encabezado}>
            <h2 id="t-producto" className={estilos.tituloSeccion}>
              Todo el ciclo de la boleta, en un solo lugar
            </h2>
            <p className={estilos.bajada}>
              Desde el borrador hasta la respuesta del SII, cada boleta muestra su estado con la
              palabra oficial. Sin adivinar qué pasó con un envío.
            </p>
          </div>

          <Tarjeta as="div" relleno="lg" variante="tenue" className={estilos.ciclo}>
            <EstadoDTE estado="borrador" />
            <Flecha />
            <EstadoDTE estado="firmado" />
            <Flecha />
            <EstadoDTE estado="enviado" />
            <Flecha />
            <EstadoDTE estado="aceptado" />
            <span className={estilos.o}>o</span>
            <EstadoDTE estado="reparos" />
            <span className={estilos.o}>o</span>
            <EstadoDTE estado="rechazado" />
          </Tarjeta>

          <div className={estilos.grillaFunciones}>
            {FUNCIONES.map((f) => (
              <Tarjeta
                key={f.titulo}
                as="article"
                relleno="lg"
                variante="plana"
                className={estilos.funcion}
              >
                <span className={estilos.iconoSello}>{f.icono}</span>
                <h3 className={estilos.tituloTarjeta}>{f.titulo}</h3>
                <p className={estilos.textoTenue}>{f.texto}</p>
              </Tarjeta>
            ))}
          </div>
        </div>
      </section>

      {/* --- Certificación ------------------------------------------------------ */}
      <section
        id="certificacion"
        className={`${estilos.contenedor} ${estilos.dosColumnas}`}
        aria-labelledby="t-certificacion"
      >
        <div className={estilos.columna}>
          <h2 id="t-certificacion" className={estilos.tituloSeccion}>
            Te llevamos paso a paso por la certificación
          </h2>
          <p className={estilos.bajada}>
            Para emitir boletas electrónicas con tu propio sistema, el SII pide pasar por un proceso
            de certificación. Boletéame hace cada trámite contigo y te muestra en qué paso estás y
            qué falta.
          </p>
          <Alerta tono="info" titulo="Ambiente de certificación separado">
            Lo que emitas mientras te certificas no tiene validez tributaria, y Boletéame lo marca
            en todas las pantallas.
          </Alerta>
          <p className={estilos.nota}>
            Si tu empresa ya está autorizada por el SII para emitir boletas electrónicas, no tienes
            que certificarla de nuevo: verificas su autorización en el SII o registras su resolución
            de producción, y queda lista para emitir.
          </p>
        </div>
        <Tarjeta as="ol" relleno="ninguno" className={estilos.pasos}>
          {PASOS_PUBLICOS.map((p, i) => (
            <li key={p.numero} className={estilos.paso}>
              <span
                className={estilos.numeroPaso}
                data-ultimo={i === PASOS_PUBLICOS.length - 1 ? 'true' : undefined}
                aria-hidden="true"
              >
                {p.numero}
              </span>
              <div>
                <p className={estilos.tituloPaso}>{p.titulo}</p>
                <p className={estilos.textoPaso}>{p.descripcion}</p>
              </div>
            </li>
          ))}
        </Tarjeta>
      </section>

      {/* --- API ---------------------------------------------------------------- */}
      <section id="api" className={estilos.bandaHundida} aria-labelledby="t-api">
        <div className={`${estilos.contenedor} ${estilos.dosColumnas} ${estilos.centrado}`}>
          <div className={estilos.columna}>
            <span className={estilos.iconoSello}>
              <Code {...ICONO} />
            </span>
            <h2 id="t-api" className={estilos.tituloSeccion}>
              Una API para tu sistema
            </h2>
            <p className={estilos.bajada}>
              Envía los datos de la boleta en JSON. Boletéame asigna el folio, arma y firma el XML,
              lo envía al SII y te avisa por webhook cuando cambia el estado. Con una clave{' '}
              <code className={estilos.codigoEnLinea}>sk_test_</code> pruebas en el ambiente de
              certificación.
            </p>
            <Link href="/docs/api" className={clasesBoton('secundario')}>
              Leer la documentación
            </Link>
          </div>
          {/* Región desplazable alcanzable con el teclado (como el marco de `Tabla`). */}
          <Tarjeta
            as="div"
            relleno="ninguno"
            variante="plana"
            className={estilos.marcoCodigo}
            role="region"
            aria-label="Ejemplo: emitir una boleta con la API"
            tabIndex={0}
          >
            <pre className={estilos.codigo}>
              <code>
                <span className={estilos.codigoTenue}>POST {URL_EMISION}</span>
                {'\n'}
                {CABECERAS_EJEMPLO.map((c) => (
                  <span key={c} className={estilos.codigoTenue}>
                    {c}
                    {'\n'}
                  </span>
                ))}
                {'\n'}
                {jsonCompacto(CUERPO_EJEMPLO)}
                {'\n\n'}
                <span className={estilos.codigoTenue}>→ 201 Created (extracto)</span>
                {'\n'}
                {jsonCompacto(RESPUESTA_EJEMPLO)}
              </code>
            </pre>
          </Tarjeta>
        </div>
      </section>

      {/* --- Precios ------------------------------------------------------------ */}
      <section
        id="precios"
        className={`${estilos.contenedor} ${estilos.seccionPrecios}`}
        aria-labelledby="t-precios"
      >
        <div className={estilos.encabezado}>
          <h2 id="t-precios" className={estilos.tituloSeccion}>
            Precios
          </h2>
          <p className={estilos.bajada}>
            Montos en pesos chilenos, IVA incluido, cobrados cada mes. Puedes cambiar de plan cuando
            quieras.
          </p>
        </div>

        <div className={estilos.grillaPlanes}>
          {grilla.tarjetas.map((plan) => {
            const destacado = plan.codigo === PLAN_DESTACADO.codigo;
            const descripcion = DESCRIPCION_PLAN[plan.codigo];
            return (
              <Tarjeta
                key={plan.codigo}
                as="article"
                relleno="lg"
                className={estilos.plan}
                data-destacado={destacado ? 'true' : undefined}
                aria-labelledby={`plan-${plan.codigo}`}
              >
                <div className={estilos.cabeceraPlan}>
                  <h3 id={`plan-${plan.codigo}`} className={estilos.tituloTarjeta}>
                    {plan.nombre}
                  </h3>
                  {destacado ? (
                    <span className={estilos.etiquetaDestacado}>{PLAN_DESTACADO.etiqueta}</span>
                  ) : null}
                </div>
                <p className={estilos.precio}>
                  {formatearMonto(plan.precio_mensual_clp)}
                  <span className={estilos.porMes}> al mes</span>
                </p>
                {descripcion ? <p className={estilos.textoTenue}>{descripcion}</p> : null}
                <ul className={estilos.caracteristicas}>
                  {caracteristicasPlan(plan).map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                  <li>Certificación guiada ante el SII</li>
                </ul>
                <Link
                  href={RUTA_CREAR_CUENTA}
                  className={clasesBoton('secundario', 'md', estilos.botonPlan)}
                >
                  Elegir plan {plan.nombre}
                </Link>
              </Tarjeta>
            );
          })}
        </div>

        <div className={estilos.planesExtra}>
          {grilla.certificacion ? (
            <Tarjeta as="article" relleno="lg" variante="tenue" className={estilos.planExtra}>
              <div className={estilos.planExtraTexto}>
                <h3 className={estilos.tituloTarjeta}>Plan {grilla.certificacion.nombre}</h3>
                <p className={estilos.textoTenue}>
                  {textoPlanCertificacion(grilla.certificacion)} Con él haces la certificación ante
                  el SII y eliges un plan pagado cuando quieras emitir en producción.
                </p>
              </div>
              <Link href={RUTA_CREAR_CUENTA} className={clasesBoton('secundario')}>
                Empezar gratis
              </Link>
            </Tarjeta>
          ) : null}
          {grilla.aMedida ? (
            <Tarjeta as="article" relleno="lg" variante="tenue" className={estilos.planExtra}>
              <div className={estilos.planExtraTexto}>
                <h3 className={estilos.tituloTarjeta}>
                  {grilla.aMedida.nombre} <span className={estilos.aMedida}>A medida</span>
                </h3>
                <p className={estilos.textoTenue}>{textoPlanAMedida(grilla.aMedida)}</p>
              </div>
              <Link href="/contacto?motivo=ventas" className={clasesBoton('secundario')}>
                Hablar con ventas
              </Link>
            </Tarjeta>
          ) : null}
        </div>
      </section>

      {/* --- Llamado final ------------------------------------------------------ */}
      <section className={estilos.llamado} aria-labelledby="t-llamado">
        <div className={estilos.llamadoInterior}>
          <div className={estilos.llamadoTexto}>
            <h2 id="t-llamado" className={estilos.tituloLlamado}>
              Empieza por la certificación
            </h2>
            <p className={estilos.textoLlamado}>
              Crea tu cuenta gratis, carga tu certificado digital y emite tu primer set de pruebas.
            </p>
          </div>
          <Link
            href={RUTA_CREAR_CUENTA}
            className={clasesBoton('secundario', 'md', estilos.grande)}
          >
            Crear cuenta
          </Link>
        </div>
      </section>
    </main>
  );
}
