import type { Metadata } from 'next';
import { identificacionTitular, VIGENCIA_PRIVACIDAD } from '@/lib/legal';
import { Contacto, DocumentoLegal, Enlace, type SeccionLegal, TablaLegal } from '../DocumentoLegal';

// Política de privacidad de Boletéame (PLAN-SAAS Fase 12), conforme a la Ley 19.628 y su
// reforma por la Ley 21.719. Describe lo que el sistema hace de verdad: certificados y CAF
// en Supabase Vault, tokens del SII con AES-256-GCM, RLS por organización, Storage privado,
// depuración de Sentry, solo cookies de sesión de Supabase y los encargados reales
// (Supabase, Vercel, Resend, Cloudflare Turnstile, Sentry, Flow).

export const metadata: Metadata = {
  title: 'Política de privacidad',
  description:
    'Cómo Boletéame trata tus datos personales y tributarios, cómo protege tu certificado digital y cómo ejercer tus derechos según la Ley 19.628.',
};

const DATOS: (readonly string[])[] = [
  [
    'Cuenta',
    'Nombre, correo y contraseña (la guarda nuestro proveedor de autenticación como hash; nadie en Boletéame la puede ver). Preferencias como el tema y la última organización que abriste.',
  ],
  [
    'Organización y equipo',
    'Nombre y dirección de la organización, miembros y sus roles, invitaciones (correo invitado; el enlace de invitación se guarda solo como hash).',
  ],
  [
    'Empresas',
    'RUT, razón social, giro, dirección, comuna, correo de intercambio, resoluciones del SII y los datos de la postulación y la declaración de cumplimiento (correos y RUT de contacto).',
  ],
  [
    'Certificado digital',
    'El archivo .pfx o .p12 y su clave (cifrados, ver más abajo) y sus datos públicos: titular, RUT del titular, emisor, vigencia y huella.',
  ],
  [
    'Folios',
    'Los archivos CAF que autoriza el SII, incluida la llave con que se timbra (cifrados).',
  ],
  [
    'Documentos tributarios',
    'Boletas y su detalle, montos, receptores (RUT, nombre o razón social y, si lo indicas, correo), productos, XML firmado, PDF, envíos, Track ID y respuestas del SII.',
  ],
  [
    'Operaciones con el SII',
    'Un registro de cada operación con el SII: cuál, cuándo, quién la ordenó (persona o API key) y su resultado. Nunca guarda tokens, claves ni cookies.',
  ],
  [
    'Pagos',
    'Plan, estado de la suscripción, cobros, fechas, el identificador de cliente en Flow, y la marca y últimos cuatro dígitos de la tarjeta. No vemos ni guardamos el número completo ni el código de seguridad.',
  ],
  [
    'Integraciones',
    'API keys (solo su hash y un prefijo visible), direcciones de webhooks y el registro de entregas con la respuesta de tu servidor, recortada.',
  ],
  ['Contacto y soporte', 'Lo que nos escribes y los datos de contacto que nos das.'],
  [
    'Datos técnicos',
    'Dirección IP y datos del navegador, para la verificación anti-bots, los límites de uso y la seguridad; y reportes de errores de la aplicación, sin contraseñas, claves, tokens ni archivos.',
  ],
];

const ENCARGADOS: (readonly string[])[] = [
  [
    'Supabase',
    'Base de datos, autenticación, almacenamiento de archivos y bóveda de secretos (Vault)',
    'São Paulo, Brasil (empresa con sede en EE. UU.)',
  ],
  [
    'Vercel',
    'Alojamiento del sitio y ejecución de la aplicación',
    'Funciones en São Paulo, Brasil; red de distribución global (empresa con sede en EE. UU.)',
  ],
  [
    'Resend',
    'Envío de correos: acceso a la cuenta, invitaciones, alertas, avisos de pago y el PDF de una boleta al receptor',
    'EE. UU.',
  ],
  [
    'Cloudflare (Turnstile)',
    'Verificación anti-bots en los formularios de ingreso, registro, recuperación de contraseña, invitaciones y contacto',
    'Red global (empresa con sede en EE. UU.)',
  ],
  [
    'Sentry',
    'Registro de errores de la aplicación, con los datos sensibles filtrados antes de enviarse',
    'EE. UU.',
  ],
  ['Flow', 'Cobro de los planes pagados con tarjeta', 'Chile'],
];

const SECCIONES: SeccionLegal[] = [
  {
    id: 'responsable',
    titulo: 'Quién es el responsable',
    contenido: (
      <>
        <p>
          Esta política explica cómo Boletéame trata los datos personales, conforme a la Ley 19.628
          sobre Protección de la Vida Privada y sus modificaciones, incluida la Ley 21.719. El
          responsable del tratamiento es {identificacionTitular()}.
        </p>
        <p>
          Para cualquier consulta sobre tus datos, <Contacto motivo="privacidad" />.
        </p>
      </>
    ),
  },
  {
    id: 'roles',
    titulo: 'Cuándo somos responsables y cuándo encargados',
    contenido: (
      <>
        <p>
          <strong>Somos responsables</strong> de los datos de tu cuenta, de tu organización y su
          equipo, de la facturación de tu plan, de lo que nos escribes y de los datos técnicos del
          sitio.
        </p>
        <p>
          <strong>Somos encargados</strong> de los datos que aparecen en tus documentos tributarios
          y en tu catálogo, por ejemplo el nombre, RUT o correo de los receptores de tus boletas.
          Ahí el responsable es la empresa que emite: nosotros tratamos esos datos solo para
          prestarle el servicio y según sus instrucciones. Si eres receptor de una boleta emitida
          con Boletéame y quieres ejercer tus derechos, dirígete a la empresa que la emitió; si nos
          escribes, le haremos llegar tu solicitud.
        </p>
      </>
    ),
  },
  {
    id: 'datos',
    titulo: 'Qué datos tratamos',
    contenido: (
      <>
        <p>
          Tratamos los datos que nos entregas al usar el servicio, los que genera tu uso y los que
          nos devuelven el SII y Flow:
        </p>
        <TablaLegal
          etiqueta="Datos que tratamos"
          columnas={['Categoría', 'Qué incluye']}
          filas={DATOS}
        />
        <p>
          No tratamos datos sensibles en los términos de la ley, salvo que tú los escribas en un
          documento o en un mensaje; te pedimos no hacerlo.
        </p>
      </>
    ),
  },
  {
    id: 'finalidades',
    titulo: 'Para qué los usamos',
    contenido: (
      <>
        <ul>
          <li>
            <strong>Prestar el servicio que contrataste</strong>: emitir, firmar y enviar tus
            documentos al SII, seguir su estado, certificar tu empresa, gestionar folios, generar
            PDF y reportes, operar la API y los webhooks. Base: el contrato.
          </li>
          <li>
            <strong>Avisarte lo que necesitas saber</strong>: certificados por vencer, folios por
            agotarse, documentos rechazados o por verificar, cambios en la certificación, cobros
            vencidos. Base: el contrato.
          </li>
          <li>
            <strong>Cobrar tu plan</strong> y emitir los documentos tributarios de ese cobro. Bases:
            el contrato y obligaciones legales.
          </li>
          <li>
            <strong>Proteger el servicio</strong>: verificación anti-bots, límites de uso, auditoría
            de operaciones con el SII y diagnóstico de errores. Base: interés legítimo en la
            seguridad del servicio y de sus clientes.
          </li>
          <li>
            <strong>Responder tus consultas</strong> y dar soporte. Base: tu solicitud.
          </li>
          <li>
            <strong>Cumplir la ley</strong> y los requerimientos de autoridades competentes.
          </li>
        </ul>
        <p>
          No vendemos tus datos, no los usamos para publicidad de terceros y no tomamos decisiones
          automatizadas que te produzcan efectos jurídicos. No te enviaremos publicidad sin tu
          consentimiento.
        </p>
      </>
    ),
  },
  {
    id: 'certificados',
    titulo: 'Certificado digital, CAF y secretos',
    contenido: (
      <>
        <p>
          Tu certificado digital permite firmar en nombre de su titular, así que lo tratamos con el
          máximo cuidado:
        </p>
        <ul>
          <li>
            El archivo .pfx y su clave se guardan <strong>cifrados en Supabase Vault</strong>, una
            bóveda de secretos separada de las tablas que consulta la aplicación. Lo mismo ocurre
            con los archivos CAF de tus folios y con los secretos de tus webhooks.
          </li>
          <li>
            <strong>Nunca se envían al navegador</strong>, ni a ti ni a nadie. Solo nuestros
            servidores los leen, en el momento de firmar un documento o de autenticarse ante el SII,
            y los usan en memoria sin escribirlos en disco, registros ni reportes de errores.
          </li>
          <li>
            Al subir el certificado lo validamos y borramos la copia de trabajo. Antes de firmar
            comprobamos que el certificado guardado sea el mismo que registraste.
          </li>
          <li>
            Los tokens y sesiones que entrega el SII se guardan{' '}
            <strong>cifrados con AES-256-GCM</strong>, con una llave que no está en la base de
            datos.
          </li>
          <li>
            Las API keys y los enlaces de invitación se guardan solo como hash: nadie, ni siquiera
            nosotros, puede leer la clave original.
          </li>
          <li>
            Si revocas un certificado deja de usarse; si lo eliminas, se borra también de la bóveda.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'seguridad',
    titulo: 'Cómo protegemos tus datos',
    contenido: (
      <ul>
        <li>
          <strong>Separación por organización:</strong> la base de datos aplica reglas de seguridad
          por fila, de modo que cada persona solo ve los datos de las organizaciones de las que es
          miembro, según su rol.
        </li>
        <li>
          <strong>Archivos privados:</strong> el XML y el PDF de tus documentos se guardan en un
          almacenamiento privado y se descargan con enlaces que vencen al minuto.
        </li>
        <li>
          <strong>Conexiones cifradas:</strong> todo el tráfico va por HTTPS, y la conexión con el
          SII se autentica con tu certificado.
        </li>
        <li>
          <strong>Auditoría:</strong> cada operación con el SII queda registrada, con quién la
          ordenó y su resultado.
        </li>
        <li>
          <strong>Reportes de errores depurados:</strong> antes de salir hacia Sentry se quitan
          contraseñas, claves, tokens, cookies, archivos y el contenido de los formularios. La
          grabación de sesiones de Sentry está apagada.
        </li>
        <li>
          <strong>Acceso mínimo:</strong> solo el personal que lo necesita para operar o dar soporte
          accede a los sistemas, y nunca a tus secretos en claro.
        </li>
      </ul>
    ),
  },
  {
    id: 'destinatarios',
    titulo: 'Con quién compartimos datos',
    contenido: (
      <>
        <p>
          <strong>Con el SII</strong>, porque es la razón de ser del servicio: le enviamos tus
          documentos, solicitudes y trámites, y nos autenticamos con tu certificado cuando tú o tu
          equipo lo ordenan (y para consultar el estado de tus envíos).
        </p>
        <p>
          <strong>Con los receptores de tus boletas</strong>, cuando eliges enviarles el PDF por
          correo.
        </p>
        <p>
          <strong>Con proveedores que tratan datos por nuestra cuenta</strong> (encargados), solo en
          lo necesario para su función:
        </p>
        <TablaLegal
          etiqueta="Proveedores que tratan datos por nuestra cuenta"
          columnas={['Proveedor', 'Para qué', 'Dónde']}
          filas={ENCARGADOS}
        />
        <p>
          <strong>Con autoridades</strong>, cuando una ley o una resolución judicial nos lo exija.
          Fuera de estos casos, no compartimos tus datos.
        </p>
      </>
    ),
  },
  {
    id: 'transferencias',
    titulo: 'Transferencias internacionales',
    contenido: (
      <>
        <p>
          Nuestros servidores principales (base de datos y aplicación) están en São Paulo, Brasil,
          la región más cercana a Chile disponible para ambos. Algunos proveedores tienen sede en
          Estados Unidos y pueden tratar datos allí o en su red global, como se indica en la tabla
          anterior.
        </p>
        <p>
          Elegimos proveedores que ofrecen acuerdos de tratamiento de datos y medidas de seguridad
          adecuadas, y les entregamos solo lo necesario. Al usar Boletéame, tus datos se transfieren
          a esos países con esas garantías.
        </p>
      </>
    ),
  },
  {
    id: 'cookies',
    titulo: 'Cookies y almacenamiento en tu navegador',
    contenido: (
      <>
        <p>
          Boletéame usa <strong>solo las cookies necesarias para mantener tu sesión</strong>: las de
          inicio de sesión de Supabase. Sin ellas no puedes ingresar al panel. No usamos cookies de
          analítica ni de publicidad, ni herramientas de seguimiento de terceros.
        </p>
        <ul>
          <li>
            Tus preferencias, como el tema claro u oscuro, se guardan en tu perfil, no en cookies.
          </li>
          <li>
            Mientras emites, el borrador de la boleta se guarda en el almacenamiento de la pestaña
            del navegador (se borra al cerrarla) para no perderlo si recargas.
          </li>
          <li>
            Los formularios con verificación anti-bots cargan Cloudflare Turnstile, que procesa
            datos técnicos de tu navegador para distinguir personas de programas automáticos.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'conservacion',
    titulo: 'Cuánto tiempo conservamos los datos',
    contenido: (
      <>
        <ul>
          <li>
            <strong>Cuenta, organización y documentos:</strong> mientras tengas una cuenta en
            Boletéame. Si cancelas tu plan, la organización vuelve al plan Certificación y tus datos
            se mantienen disponibles.
          </li>
          <li>
            <strong>Documentos tributarios:</strong> el Código Tributario obliga al contribuyente a
            conservarlos mientras el SII pueda revisarlos (artículos 17 y 200), un plazo que puede
            llegar a seis años. Esa obligación es de la empresa emisora: te recomendamos descargar
            tus XML y PDF antes de pedir que eliminemos tus datos.
          </li>
          <li>
            <strong>Datos de facturación de tu plan:</strong> el tiempo que exigen las normas
            tributarias y contables.
          </li>
          <li>
            <strong>Registros técnicos:</strong> los tokens del SII se borran al día siguiente de
            vencer. Del registro de entregas de webhooks borramos las entregas terminadas
            (entregadas o descartadas) cuando cumplen 30 días; las que siguen pendientes o en
            reintento se conservan hasta que terminan.
          </li>
        </ul>
        <p>
          Si pides la eliminación, borraremos o anonimizaremos tus datos dentro del plazo legal,
          salvo lo que la ley nos obligue a conservar. Las copias de respaldo se renuevan
          periódicamente, y lo eliminado desaparece de ellas al completarse su ciclo. Lo que ya
          enviaste al SII queda en los registros del SII, que no controlamos.
        </p>
      </>
    ),
  },
  {
    id: 'derechos',
    titulo: 'Tus derechos',
    contenido: (
      <>
        <p>Como titular de datos personales tienes derecho a:</p>
        <ul>
          <li>
            <strong>Acceso:</strong> saber qué datos tuyos tratamos, para qué, de dónde vienen y a
            quién se comunican.
          </li>
          <li>
            <strong>Rectificación:</strong> corregir datos inexactos o incompletos. Muchos los
            puedes cambiar tú mismo en el panel.
          </li>
          <li>
            <strong>Supresión:</strong> pedir que eliminemos tus datos cuando ya no sean necesarios
            o el tratamiento no tenga base legal, con las excepciones que la ley establece (por
            ejemplo, la conservación tributaria).
          </li>
          <li>
            <strong>Oposición:</strong> oponerte a un tratamiento basado en nuestro interés
            legítimo.
          </li>
          <li>
            <strong>Portabilidad:</strong> recibir tus datos en un formato estructurado y de uso
            común. Tus documentos ya puedes descargarlos en XML y PDF, y tus reportes en CSV y
            Excel.
          </li>
          <li>
            <strong>Bloqueo:</strong> pedir la suspensión temporal del tratamiento mientras se
            resuelve una solicitud.
          </li>
        </ul>
        <p>
          Para ejercerlos, <Contacto motivo="privacidad" /> indicando qué derecho quieres ejercer.
          Podemos pedirte que acredites tu identidad. Es gratis y responderemos dentro del plazo que
          fija la ley. Si no quedas conforme con la respuesta, puedes reclamar ante la Agencia de
          Protección de Datos Personales o ante los tribunales, según corresponda.
        </p>
      </>
    ),
  },
  {
    id: 'menores',
    titulo: 'Menores de edad',
    contenido: (
      <p>
        Boletéame es un servicio para empresas y personas que emiten documentos tributarios. No está
        dirigido a menores de edad y no tratamos a sabiendas sus datos como usuarios.
      </p>
    ),
  },
  {
    id: 'cambios',
    titulo: 'Cambios a esta política',
    contenido: (
      <p>
        Si cambiamos esta política de forma importante, te avisaremos por correo o en el panel antes
        de que rija. La fecha de vigencia está al comienzo de esta página. Revisa también los{' '}
        <Enlace href="/legal/terminos">términos y condiciones</Enlace>.
      </p>
    ),
  },
  {
    id: 'contacto',
    titulo: 'Contacto',
    contenido: (
      <p>
        Para consultas sobre privacidad o para ejercer tus derechos,{' '}
        <Contacto motivo="privacidad" />.
      </p>
    ),
  },
];

export default function PaginaPrivacidad() {
  return (
    <DocumentoLegal
      titulo="Política de privacidad"
      bajada="Qué datos tratamos, para qué, cómo protegemos tu certificado digital y tus documentos tributarios, y cómo ejercer tus derechos."
      vigencia={VIGENCIA_PRIVACIDAD}
      secciones={SECCIONES}
      otro={{ href: '/legal/terminos', texto: 'Términos y condiciones' }}
    />
  );
}
