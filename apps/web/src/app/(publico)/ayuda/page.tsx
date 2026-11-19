import { Activity, ChevronDown, Code, Mail } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { clasesBoton, Tarjeta } from '@/components/boleteame';
import { ID_CONTENIDO } from '../_compartido/enlaces';
import { AbrirPreguntaDelHash } from './AbrirPreguntaDelHash';
import estilos from './ayuda.module.css';

// Ayuda y soporte (PLAN-SAAS Fase 12): preguntas frecuentes sobre lo que existe hoy
// (boleta 39 y 41, certificación, folios, planes con Flow, equipo, API y webhooks), sin
// factura hasta la Fase 14. Respuestas basadas en `documentación/02-guias/` y el código.
// Estática: `<details>`/`<summary>` nativos. Lo único con JavaScript es
// `AbrirPreguntaDelHash`, que abre la pregunta del hash (`/ayuda#por-verificar`, enlazada
// desde /estado); sin él, el enlace igual lleva a la pregunta.

export const metadata: Metadata = {
  title: 'Ayuda',
  description:
    'Preguntas frecuentes de Boletéame: qué necesitas para empezar, certificación ante el SII, envíos por verificar, folios (CAF), planes, equipo y API.',
};

const ICONO = { size: 20, strokeWidth: 1.5, 'aria-hidden': true } as const;

function A({ href, children }: { href: string; children: ReactNode }): ReactElement {
  return (
    <Link className={estilos.enlace} href={href}>
      {children}
    </Link>
  );
}

/** Una ruta del panel, como «Configuración → Plan». */
function Ruta({ children }: { children: ReactNode }): ReactElement {
  return <span className={estilos.ruta}>{children}</span>;
}

interface Pregunta {
  id: string;
  pregunta: string;
  respuesta: ReactNode;
}

interface Grupo {
  id: string;
  titulo: string;
  preguntas: Pregunta[];
}

const GRUPOS: Grupo[] = [
  {
    id: 'empezar',
    titulo: 'Para empezar',
    preguntas: [
      {
        id: 'que-necesito',
        pregunta: '¿Qué necesito para empezar?',
        respuesta: (
          <>
            <p>Tres cosas:</p>
            <ul>
              <li>
                <strong>Una cuenta y una organización</strong> en Boletéame. Al crearla quedas en el
                plan Certificación, que es gratis y no vence.
              </li>
              <li>
                <strong>Los datos de tu empresa</strong>: RUT, razón social, giro, dirección y
                comuna, tal como están en el SII. Se cargan en <Ruta>Configuración → Empresas</Ruta>
                .
              </li>
              <li>
                <strong>Un certificado digital vigente</strong> (archivo .pfx o .p12) de una persona
                con facultades ante el SII para la empresa. Para postular y declarar el
                cumplimiento, el titular debe ser representante legal; para pedir folios, debe tener
                permiso en el SII para hacerlo. Se sube en <Ruta>Configuración → Certificados</Ruta>{' '}
                y después se asocia a la empresa.
              </li>
            </ul>
            <p>
              Con eso puedes empezar la certificación. Si tu empresa ya emite boletas electrónicas
              con otro sistema, no necesitas certificarla de nuevo: mira la pregunta siguiente.
            </p>
          </>
        ),
      },
      {
        id: 'certificacion',
        pregunta: '¿Qué es la certificación y cuánto demora?',
        respuesta: (
          <>
            <p>
              Antes de autorizar a una empresa a emitir boletas electrónicas reales, el SII le pide
              demostrar que su sistema las genera bien. Boletéame te guía con un asistente de cinco
              pasos, todos en el ambiente de certificación del SII:
            </p>
            <ol>
              <li>Postulación.</li>
              <li>Set de pruebas: el SII entrega los casos que hay que emitir.</li>
              <li>Folios y envío del set: Boletéame pide los folios y envía las boletas.</li>
              <li>Revisión: se pide al SII que revise el envío.</li>
              <li>Declaración de cumplimiento: con ella la empresa queda autorizada.</li>
            </ol>
            <p>
              Los pasos que haces en Boletéame toman minutos. La revisión la hace el SII, que
              responde por correo, y su plazo depende del SII: no lo podemos acelerar ni garantizar.
              El asistente muestra en todo momento en qué paso estás.
            </p>
            <p>
              Si tu empresa ya está autorizada (por ejemplo, porque se certificó con otro
              proveedor), registra su resolución de producción en la ficha de la empresa y quedará
              lista para producción sin repetir el proceso.
            </p>
          </>
        ),
      },
      {
        id: 'ambientes',
        pregunta: '¿Qué diferencia hay entre certificación y producción?',
        respuesta: (
          <>
            <p>Son los dos ambientes del SII, y Boletéame los mantiene separados:</p>
            <ul>
              <li>
                <strong>Certificación</strong> es el ambiente de pruebas. Ahí se certifica la
                empresa y se puede emitir para probar, pero lo emitido{' '}
                <strong>no tiene validez tributaria</strong>. El panel lo avisa con un mensaje fijo.
              </li>
              <li>
                <strong>Producción</strong> es donde se emiten las boletas reales. Exige que la
                empresa esté autorizada por el SII y un plan pagado.
              </li>
            </ul>
            <p>
              Los folios, los documentos y las API keys son distintos en cada ambiente: un folio de
              certificación no sirve en producción.
            </p>
          </>
        ),
      },
    ],
  },
  {
    id: 'emitir',
    titulo: 'Emitir y seguir tus boletas',
    preguntas: [
      {
        id: 'por-verificar',
        pregunta: '¿Qué hago si un envío queda «Por verificar»?',
        respuesta: (
          <>
            <p>
              «Por verificar» significa que no sabemos si el SII recibió el envío: por ejemplo, la
              conexión se cortó después de enviarlo y antes de que el SII entregara el número de
              atención (Track ID). Puede haber llegado o no.
            </p>
            <ol>
              <li>
                <strong>No vuelvas a emitir la boleta todavía.</strong> Si ya había llegado,
                quedaría duplicada. Por eso Boletéame nunca la reenvía por su cuenta.
              </li>
              <li>
                Revisa en el sitio del SII, en la sección de boleta electrónica, si el folio quedó
                recibido.
              </li>
              <li>
                Si llegó, no tienes que hacer nada más. Si no llegó, emítela de nuevo desde{' '}
                <Ruta>Emitir documento</Ruta>.
              </li>
              <li>
                En la página del envío, marca <Ruta>Ya lo revisé</Ruta> para que deje de aparecer
                como pendiente.
              </li>
            </ol>
            <p>
              Los envíos por verificar aparecen en el Tablero y llegan por correo a los
              administradores. Si el SII tiene problemas, lo verás también en{' '}
              <A href="/estado">el estado del servicio</A>.
            </p>
          </>
        ),
      },
      {
        id: 'estado-boleta',
        pregunta: '¿Cómo sé si el SII aceptó mi boleta?',
        respuesta: (
          <>
            <p>
              Boletéame consulta automáticamente el estado de cada envío en el SII, cada pocos
              minutos al principio y con menos frecuencia después. En{' '}
              <Ruta>Documentos emitidos</Ruta> cada boleta muestra su estado (Enviado, Aceptado,
              Aceptado con reparos o Rechazado) y cambia sola, sin recargar la página.
            </p>
            <p>
              Desde el detalle del documento también puedes consultar el estado en el SII en el
              momento. Si el SII rechaza una boleta, avisamos por correo a los administradores, y el
              detalle del envío muestra los errores que informó el SII.
            </p>
          </>
        ),
      },
    ],
  },
  {
    id: 'folios',
    titulo: 'Folios',
    preguntas: [
      {
        id: 'folios-caf',
        pregunta: '¿Qué son los folios (CAF) y cómo los pido?',
        respuesta: (
          <>
            <p>
              Cada boleta lleva un número, el folio, que autoriza el SII. El SII entrega los folios
              en un archivo llamado CAF (Código de Autorización de Folios), por empresa, tipo de
              documento y ambiente. Boletéame lo guarda cifrado y usa los folios en orden al emitir.
            </p>
            <p>
              En <Ruta>Folios (CAF)</Ruta> un administrador puede:
            </p>
            <ul>
              <li>
                <strong>Pedir folios al SII</strong> indicando tipo, ambiente y cantidad. En
                producción, Boletéame primero revisa la solicitud con el SII y te muestra el rango
                que asignaría; los folios se timbran solo cuando confirmas.
              </li>
              <li>
                <strong>Subir un CAF</strong> que descargaste del sitio del SII.
              </li>
            </ul>
            <p>
              El certificado que se use debe ser de una persona con permiso en el SII para pedir
              folios. Te avisamos por correo cuando queda el 15 % o menos de los folios de un tipo.
              Durante la certificación, el asistente pide los folios del set de pruebas por ti.
            </p>
          </>
        ),
      },
    ],
  },
  {
    id: 'planes',
    titulo: 'Planes y pagos',
    preguntas: [
      {
        id: 'cupo',
        pregunta: '¿Qué incluye cada plan y qué pasa al llegar al cupo?',
        respuesta: (
          <>
            <p>
              Los planes y sus límites (boletas de producción al mes, empresas, usuarios, API) están
              en <A href="/#precios">la sección de precios</A>. Puedes ver tu uso del mes en{' '}
              <Ruta>Configuración → Plan</Ruta>.
            </p>
            <p>
              Te avisamos al llegar al 80 % y al 100 % del cupo de boletas. Al llegar al límite,
              Boletéame no envía más boletas de producción ese mes hasta que subas de plan o empiece
              el mes siguiente. No hay cobros por exceso. Las boletas de certificación no cuentan.
            </p>
          </>
        ),
      },
      {
        id: 'cobro-fallido',
        pregunta: '¿Qué pasa si falla un cobro?',
        respuesta: (
          <p>
            Los cobros los hace Flow con la tarjeta que registraste. Si uno falla, Flow lo reintenta
            durante los días siguientes y tu plan sigue funcionando. Si el pago queda vencido, no
            podrás emitir en producción ni agregar empresas o usuarios hasta pagarlo; la
            certificación sigue disponible. Puedes pagar desde <Ruta>Configuración → Plan</Ruta>,
            donde aparece el enlace de pago de Flow.
          </p>
        ),
      },
      {
        id: 'cancelar',
        pregunta: '¿Cómo cancelo mi plan?',
        respuesta: (
          <>
            <p>
              Un propietario o administrador puede cancelarlo en{' '}
              <Ruta>Configuración → Plan → Cancelar la suscripción</Ruta>. La cancelación rige al
              terminar el período ya pagado; después, la organización vuelve al plan Certificación.
              Tus documentos y datos se conservan.
            </p>
            <p>
              Si además quieres que eliminemos tus datos, <A href="/contacto">escríbenos</A>. Antes,
              descarga tus documentos: la ley te obliga a conservarlos.
            </p>
          </>
        ),
      },
    ],
  },
  {
    id: 'equipo-api',
    titulo: 'Equipo e integraciones',
    preguntas: [
      {
        id: 'invitar',
        pregunta: '¿Cómo invito a mi equipo?',
        respuesta: (
          <>
            <p>
              En <Ruta>Configuración → Equipo</Ruta> un propietario o administrador escribe el
              correo de la persona y elige su rol:
            </p>
            <ul>
              <li>
                <strong>Administrador:</strong> gestiona empresas, certificados, folios, equipo e
                integraciones.
              </li>
              <li>
                <strong>Emisor:</strong> emite boletas y mantiene receptores y productos.
              </li>
              <li>
                <strong>Lector:</strong> consulta documentos, envíos y reportes, sin hacer cambios.
              </li>
            </ul>
            <p>
              La persona recibe un correo con el enlace y acepta ingresando con ese mismo correo. La
              cantidad de usuarios depende de tu plan.
            </p>
          </>
        ),
      },
      {
        id: 'api',
        pregunta: '¿Puedo emitir desde mi propio sistema?',
        respuesta: (
          <>
            <p>
              Sí, con la API de Boletéame, incluida en los planes API y Empresa. Un administrador
              crea una API key en <Ruta>Configuración → API</Ruta>: elige la empresa, el ambiente y
              los permisos, y la clave se muestra una sola vez. Con ella tu sistema emite boletas,
              consulta documentos, folios y envíos, y descarga el XML y el PDF.
            </p>
            <p>
              En <Ruta>Configuración → Webhooks</Ruta> puedes recibir avisos firmados cuando el SII
              acepta o rechaza un documento. Todo está en{' '}
              <A href="/docs/api">la documentación de la API</A>.
            </p>
          </>
        ),
      },
      {
        id: 'certificado-seguro',
        pregunta: '¿Es seguro subir mi certificado digital?',
        respuesta: (
          <p>
            El archivo y su clave se guardan cifrados en una bóveda de secretos, nunca se envían a
            ningún navegador y solo nuestros servidores los usan para firmar y autenticarse ante el
            SII cuando tú o tu equipo lo ordenan, y para consultar el estado de tus envíos. Lo
            puedes revocar o eliminar cuando quieras. El detalle está en la{' '}
            <A href="/legal/privacidad#certificados">política de privacidad</A>.
          </p>
        ),
      },
    ],
  },
];

export default function PaginaAyuda() {
  return (
    <main id={ID_CONTENIDO} tabIndex={-1}>
      <div className={estilos.contenedor}>
        <header className={estilos.cabecera}>
          <p className={estilos.antetitulo}>Soporte</p>
          <h1 className={estilos.titulo}>Ayuda</h1>
          <p className={estilos.bajada}>
            Respuestas a las preguntas más comunes sobre Boletéame. Si no encuentras lo que buscas,
            escríbenos.
          </p>
        </header>

        <ul className={estilos.accesos} aria-label="Otras formas de ayuda">
          <li>
            <Tarjeta as="article" className={estilos.acceso}>
              <h2 className={estilos.accesoTitulo}>
                <span className={estilos.icono}>
                  <Mail {...ICONO} />
                </span>
                <A href="/contacto">Contacto</A>
              </h2>
              <p className={estilos.textoTenue}>
                Escríbenos si tienes un problema o una pregunta que no está aquí.
              </p>
            </Tarjeta>
          </li>
          <li>
            <Tarjeta as="article" className={estilos.acceso}>
              <h2 className={estilos.accesoTitulo}>
                <span className={estilos.icono}>
                  <Activity {...ICONO} />
                </span>
                <A href="/estado">Estado del servicio</A>
              </h2>
              <p className={estilos.textoTenue}>
                Revisa si la plataforma y la conexión con el SII funcionan con normalidad.
              </p>
            </Tarjeta>
          </li>
          <li>
            <Tarjeta as="article" className={estilos.acceso}>
              <h2 className={estilos.accesoTitulo}>
                <span className={estilos.icono}>
                  <Code {...ICONO} />
                </span>
                <A href="/docs/api">Documentación de la API</A>
              </h2>
              <p className={estilos.textoTenue}>
                Emite desde tu sistema y recibe avisos por webhooks.
              </p>
            </Tarjeta>
          </li>
        </ul>

        <nav aria-label="Temas de la ayuda">
          <ul className={estilos.indice}>
            {GRUPOS.map((g) => (
              <li key={g.id}>
                <a className={estilos.enlace} href={`#${g.id}`}>
                  {g.titulo}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        {GRUPOS.map((g) => (
          <section
            key={g.id}
            id={g.id}
            className={estilos.grupo}
            aria-labelledby={`${g.id}-titulo`}
          >
            <h2 id={`${g.id}-titulo`} className={estilos.grupoTitulo}>
              {g.titulo}
            </h2>
            <div className={estilos.preguntas}>
              {g.preguntas.map((p) => (
                <details key={p.id} id={p.id} className={estilos.pregunta}>
                  <summary className={estilos.resumen}>
                    <span>{p.pregunta}</span>
                    <ChevronDown
                      size={16}
                      strokeWidth={1.5}
                      aria-hidden
                      className={estilos.chevron}
                    />
                  </summary>
                  <div className={estilos.respuesta}>{p.respuesta}</div>
                </details>
              ))}
            </div>
          </section>
        ))}

        <section className={estilos.cierre} aria-labelledby="cierre-titulo">
          <h2 id="cierre-titulo" className={estilos.grupoTitulo}>
            ¿No encontraste tu respuesta?
          </h2>
          <p className={estilos.bajada}>Cuéntanos qué necesitas y te responderemos por correo.</p>
          <Link href="/contacto" className={clasesBoton('primario')}>
            Escríbenos
          </Link>
        </section>
      </div>
      <AbrirPreguntaDelHash />
    </main>
  );
}
