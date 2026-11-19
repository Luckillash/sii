import type { Metadata } from 'next';
import { identificacionTitular, nombreTitular, VIGENCIA_TERMINOS } from '@/lib/legal';
import { Contacto, DocumentoLegal, Enlace, type SeccionLegal } from '../DocumentoLegal';

// Términos y condiciones de Boletéame (PLAN-SAAS Fase 12). Describen lo que el sistema
// hace hoy: boleta electrónica (39) y boleta exenta electrónica (41), certificación ante
// el SII, folios, seguimiento, planes con Flow (D4, D5), API y webhooks (Fase 11). Sin
// factura ni Registro de Compras y Ventas hasta la Fase 14 (H1).
//
// Los datos del titular salen de `lib/legal.ts`: mientras falten, el texto es neutro.

export const metadata: Metadata = {
  title: 'Términos y condiciones',
  description:
    'Condiciones de uso de Boletéame: emisión de boletas electrónicas ante el SII, certificación, folios, planes y pagos, API y webhooks.',
};

const SECCIONES: SeccionLegal[] = [
  {
    id: 'aceptacion',
    titulo: 'Quiénes somos y aceptación',
    contenido: (
      <>
        <p>
          Estos términos y condiciones regulan el uso de Boletéame, el servicio disponible en
          boleteame.dev, que presta {identificacionTitular()} (en adelante, «Boletéame» o
          «nosotros»).
        </p>
        <p>
          Al crear una cuenta, contratar un plan o usar el servicio, incluida su API, aceptas estos
          términos y la <Enlace href="/legal/privacidad">política de privacidad</Enlace>. Si los
          aceptas en nombre de una empresa u otra organización, declaras que tienes facultades para
          obligarla; en ese caso, «tú» se refiere también a ella.
        </p>
        <p>
          Para usar Boletéame debes ser mayor de edad y tener capacidad para contratar según la ley
          chilena.
        </p>
      </>
    ),
  },
  {
    id: 'servicio',
    titulo: 'Qué es Boletéame',
    contenido: (
      <>
        <p>
          Boletéame es un servicio en línea para emitir documentos tributarios electrónicos ante el
          Servicio de Impuestos Internos (SII). Hoy permite:
        </p>
        <ul>
          <li>emitir boleta electrónica (tipo 39) y boleta exenta electrónica (tipo 41);</li>
          <li>
            firmar cada documento con tu certificado digital y timbrarlo con los folios (CAF) que
            autoriza el SII;
          </li>
          <li>enviar los documentos al SII y seguir automáticamente el estado de cada envío;</li>
          <li>recorrer la certificación de tu empresa ante el SII con un asistente;</li>
          <li>
            descargar los documentos (XML y PDF), exportar reportes y enviar el PDF al correo del
            receptor;
          </li>
          <li>integrar tu sistema mediante una API y recibir avisos por webhooks.</li>
        </ul>
        <p>
          Hoy Boletéame no emite facturas, notas de crédito o débito, guías de despacho ni lleva el
          Registro de Compras y Ventas. Si incorporamos esas funciones, lo informaremos en el sitio.
        </p>
        <p>
          <strong>Boletéame no es parte del SII ni está afiliado a él.</strong> El SII es un
          servicio público independiente; sus sistemas, criterios, plazos y decisiones no dependen
          de nosotros. Boletéame tampoco presta asesoría tributaria, contable ni legal.
        </p>
      </>
    ),
  },
  {
    id: 'cuenta',
    titulo: 'Cuenta, organización y equipo',
    contenido: (
      <>
        <p>
          Para usar el servicio creas una cuenta personal con tu nombre y correo, y una organización
          donde se agrupan tus empresas, documentos y equipo. Te comprometes a entregar datos
          verdaderos y a mantenerlos al día.
        </p>
        <p>
          Puedes invitar a otras personas a tu organización con un rol (propietario, administrador,
          emisor o lector). Cada rol permite acciones distintas, y la cantidad de usuarios depende
          de tu plan. La organización responde por lo que hagan sus miembros y sus API keys dentro
          de Boletéame.
        </p>
        <p>
          Tu contraseña y tus API keys son personales y secretas. Si crees que alguien más las
          conoce, cámbialas o revócalas de inmediato y <Contacto />.
        </p>
      </>
    ),
  },
  {
    id: 'responsabilidad-tributaria',
    titulo: 'Tu responsabilidad tributaria',
    contenido: (
      <>
        <p>
          El contribuyente que emite es el único responsable ante el SII de sus documentos
          tributarios: de su contenido, montos, impuestos, datos del receptor y oportunidad, de
          revisar que el SII los haya aceptado, de declarar y pagar los impuestos que correspondan y
          de conservar los documentos por el plazo que exige la ley.
        </p>
        <p>
          Boletéame ejecuta las instrucciones que tú, tu equipo o tu sistema le dan. No revisa si
          una venta corresponde, si el monto es correcto ni si el documento elegido es el adecuado
          para tu caso. Ante cualquier duda tributaria, consulta a tu contador o al SII.
        </p>
      </>
    ),
  },
  {
    id: 'certificado',
    titulo: 'Certificado digital y autorizaciones',
    contenido: (
      <>
        <p>
          Para firmar documentos y operar ante el SII necesitas un certificado digital vigente
          (archivo .pfx o .p12) emitido por una entidad certificadora. Al subirlo declaras que eres
          su titular o que su titular te autorizó a usarlo para la empresa, y que esa persona tiene
          ante el SII las facultades que cada trámite exige (por ejemplo, representante legal para
          postular y declarar el cumplimiento, o permiso en el SII para pedir folios).
        </p>
        <p>Nos autorizas a usar el certificado y su clave, solo desde nuestros servidores, para:</p>
        <ul>
          <li>
            firmar los documentos, sobres y solicitudes que tú o tu equipo ordenen, por el panel o
            por la API;
          </li>
          <li>autenticarte ante el SII para hacer esas operaciones;</li>
          <li>
            consultar automáticamente, cada pocos minutos, el estado de tus envíos, sin enviar
            documentos nuevos.
          </li>
        </ul>
        <p>
          Cómo guardamos y protegemos el certificado se explica en la{' '}
          <Enlace href="/legal/privacidad#certificados">política de privacidad</Enlace>. Puedes
          revocarlo en Boletéame (deja de usarse) o eliminarlo (se borra) cuando quieras. Si el
          certificado se ve comprometido, revócalo además ante la entidad que lo emitió.
        </p>
      </>
    ),
  },
  {
    id: 'ambientes',
    titulo: 'Certificación y producción',
    contenido: (
      <>
        <p>El SII opera dos ambientes, y Boletéame los mantiene separados:</p>
        <ul>
          <li>
            <strong>Certificación:</strong> ambiente de pruebas del SII. Ahí se hace la
            certificación de la empresa y se pueden emitir documentos de prueba. Lo emitido en
            certificación <strong>no tiene validez tributaria</strong> y no reemplaza a un documento
            real.
          </li>
          <li>
            <strong>Producción:</strong> documentos con validez tributaria. Exige que el SII haya
            autorizado a la empresa como emisora y un plan que incluya producción.
          </li>
        </ul>
        <p>
          Completar los pasos de certificación en Boletéame no garantiza que el SII autorice a la
          empresa: la revisión, los plazos y la resolución son del SII.
        </p>
      </>
    ),
  },
  {
    id: 'envios',
    titulo: 'Envíos al SII y documentos por verificar',
    contenido: (
      <>
        <p>
          Cuando emites, Boletéame firma el documento, lo envía al SII y guarda el número de
          atención (Track ID) que entrega el SII. Después consulta el estado del envío en forma
          automática hasta que el SII lo acepta, lo acepta con reparos o lo rechaza. Un rechazo o un
          reparo es una decisión del SII sobre el documento.
        </p>
        <p>
          A veces no es posible saber si el SII recibió un envío: por ejemplo, si la conexión se
          corta después de enviarlo y antes de recibir el Track ID. En ese caso el documento queda{' '}
          <strong>«Por verificar»</strong>. Boletéame <strong>no lo reenvía por su cuenta</strong> y
          bloquea volver a emitirlo hasta que indiques que lo revisaste, porque reenviar a ciegas
          puede duplicar un documento. Te corresponde revisar en el sitio del SII si llegó antes de
          emitirlo de nuevo. La misma regla aplica a otras operaciones que graban en el SII, como
          pedir folios o declarar el cumplimiento.
        </p>
        <p>
          Si marcas una operación como revisada sin haberla revisado en el SII, las consecuencias
          (por ejemplo, un documento duplicado o folios gastados) son de tu responsabilidad.
        </p>
      </>
    ),
  },
  {
    id: 'folios',
    titulo: 'Folios (CAF)',
    contenido: (
      <>
        <p>
          Los folios los autoriza el SII mediante archivos CAF, por empresa, tipo de documento y
          ambiente. Boletéame puede pedirlos al SII en tu nombre o recibir un CAF que descargaste
          del sitio del SII, lo guarda cifrado y asigna los folios en orden al emitir.
        </p>
        <p>
          Es tu responsabilidad contar con folios suficientes. Boletéame te avisa cuando quedan
          pocos, pero no puede emitir sin folios disponibles. Anular folios en Boletéame los deja
          fuera de uso en tu cuenta y no reemplaza los trámites que el SII exija.
        </p>
      </>
    ),
  },
  {
    id: 'planes',
    titulo: 'Planes, precios y pagos',
    contenido: (
      <>
        <p>
          Los planes, sus precios y sus límites están publicados en la{' '}
          <Enlace href="/#precios">sección de precios</Enlace>. Los precios están en pesos chilenos,
          con IVA incluido, y se cobran por mes.
        </p>
        <ul>
          <li>
            <strong>Certificación:</strong> gratis y sin plazo. Permite certificar la empresa y
            emitir en el ambiente de certificación, pero no en producción.
          </li>
          <li>
            <strong>Planes pagados:</strong> se contratan desde el panel. El cobro lo hace Flow, con
            la tarjeta que registras en su sitio; Boletéame no ve ni guarda el número completo de tu
            tarjeta. El primer mes se cobra al contratar y después cada mes, en forma automática,
            hasta que canceles.
          </li>
          <li>
            <strong>Plan Empresa:</strong> condiciones a medida, acordadas por escrito.
          </li>
        </ul>
        <h3>Cupos y bloqueo al llegar al límite</h3>
        <p>
          Cada plan tiene un cupo mensual de boletas en producción y un máximo de empresas y
          usuarios. Te avisamos al llegar al 80 % y al 100 % del cupo de boletas. Al alcanzar el
          límite, Boletéame no envía más boletas de producción ese mes calendario (hora de Chile)
          hasta que subas de plan o empiece el mes siguiente. No hay cobros por exceso: el límite es
          un bloqueo. Las boletas de certificación no cuentan.
        </p>
        <h3>Cambios de plan, cobros fallidos y cancelación</h3>
        <ul>
          <li>
            Al cambiar de plan, Flow calcula la diferencia del período en curso y te la muestra
            antes de confirmar.
          </li>
          <li>
            Si un cobro no se puede hacer, Flow lo reintenta durante los días siguientes y tu plan
            sigue activo. Si el pago queda vencido, la organización no puede emitir en producción ni
            agregar empresas o usuarios hasta pagarlo; la certificación sigue disponible y tus datos
            se conservan.
          </li>
          <li>
            Puedes cancelar cuando quieras desde el panel. La cancelación rige al terminar el
            período pagado y después la organización vuelve al plan Certificación. No se devuelven
            períodos parciales, salvo que la ley disponga otra cosa.
          </li>
          <li>
            Si cambiamos el precio de tu plan, te avisaremos por correo con al menos 30 días de
            anticipación; podrás cancelar antes de que el cambio rija.
          </li>
        </ul>
        <p>
          Por cada cobro emitiremos el documento tributario que corresponda. Flow te envía además el
          comprobante del pago.
        </p>
      </>
    ),
  },
  {
    id: 'api',
    titulo: 'API y webhooks',
    contenido: (
      <>
        <p>
          Los planes que la incluyen permiten usar la API de Boletéame, documentada en{' '}
          <Enlace href="/docs/api">la documentación de la API</Enlace>. Al usarla:
        </p>
        <ul>
          <li>
            Las API keys se muestran una sola vez, tienen alcances y ambiente, y se pueden revocar
            en cualquier momento. Lo que se haga con una clave de tu organización es tu
            responsabilidad.
          </li>
          <li>
            Debes usar la cabecera de idempotencia al emitir, para que un reintento de tu sistema no
            duplique documentos, y respetar los límites de uso; si los excedes, la API responde con
            un error y debes esperar antes de reintentar.
          </li>
          <li>
            Los webhooks se envían a la dirección HTTPS que configures, firmados con un secreto que
            solo tú conoces. Debes verificar la firma. Una entrega puede repetirse o llegar fuera de
            orden, y se reintenta durante un tiempo antes de descartarse; tu sistema debe tolerarlo.
          </li>
        </ul>
        <p>
          Podemos cambiar la API con aviso razonable. Los cambios que rompan la compatibilidad se
          anunciarán con anticipación en la documentación.
        </p>
      </>
    ),
  },
  {
    id: 'uso-aceptable',
    titulo: 'Uso aceptable y suspensión',
    contenido: (
      <>
        <p>No puedes usar Boletéame para:</p>
        <ul>
          <li>emitir documentos falsos o simular operaciones;</li>
          <li>usar certificados, empresas o datos de terceros sin su autorización;</li>
          <li>
            intentar acceder a datos de otras organizaciones, vulnerar la seguridad del servicio o
            eludir sus límites;
          </li>
          <li>
            sobrecargar el servicio o los sistemas del SII, o hacer pruebas de carga sin acordarlo
            con nosotros;
          </li>
          <li>cualquier fin contrario a la ley.</li>
        </ul>
        <p>
          Si detectamos un uso de este tipo, un riesgo para la seguridad del servicio o de otros
          clientes, o recibimos una orden de autoridad competente, podemos limitar o suspender la
          cuenta, una API key o un webhook. Cuando sea posible, te avisaremos antes y te diremos el
          motivo.
        </p>
      </>
    ),
  },
  {
    id: 'disponibilidad',
    titulo: 'Disponibilidad y soporte',
    contenido: (
      <>
        <p>
          Hacemos esfuerzos razonables para que Boletéame esté disponible en todo momento, pero no
          garantizamos un funcionamiento ininterrumpido. Puede haber mantenciones, interrupciones de
          nuestros proveedores o fallas imprevistas. Salvo acuerdo escrito, el servicio no incluye
          un nivel de servicio garantizado.
        </p>
        <p>
          La disponibilidad del SII está fuera de nuestro control: sus sistemas pueden tener
          intermitencias o mantenciones que demoren o impidan emitir, consultar o certificar. Puedes
          revisar el estado de nuestra conexión con el SII en{' '}
          <Enlace href="/estado">la página de estado</Enlace>.
        </p>
        <p>
          El soporte se presta por escrito. Revisa la <Enlace href="/ayuda">ayuda</Enlace> o{' '}
          <Contacto />.
        </p>
      </>
    ),
  },
  {
    id: 'propiedad',
    titulo: 'Tus datos y nuestra propiedad intelectual',
    contenido: (
      <>
        <p>
          Los datos que cargas y los documentos que emites son tuyos. Nos das el permiso necesario
          para tratarlos con el único fin de prestarte el servicio, según la política de privacidad.
          Puedes descargar tus documentos (XML y PDF) y exportar reportes desde el panel.
        </p>
        <p>
          El software, el diseño, la marca Boletéame y la documentación son de {nombreTitular()} o
          de sus licenciantes. Estos términos no te ceden ningún derecho sobre ellos más allá del
          uso del servicio.
        </p>
      </>
    ),
  },
  {
    id: 'responsabilidad',
    titulo: 'Limitación de responsabilidad',
    contenido: (
      <>
        <p>En la medida en que la ley lo permita, Boletéame no responde por:</p>
        <ul>
          <li>
            decisiones, demoras, intermitencias o cambios del SII, ni por rechazos o reparos de
            documentos;
          </li>
          <li>
            multas, intereses o diferencias de impuestos que se originen en datos o instrucciones
            entregados por ti, tu equipo o tu sistema, o en no haber revisado un documento por
            verificar;
          </li>
          <li>
            el uso de tu certificado, tus credenciales o tus API keys por personas a las que tú les
            diste acceso o que los obtuvieron por falta de cuidado de tu parte;
          </li>
          <li>daños indirectos, lucro cesante o pérdida de oportunidades de negocio.</li>
        </ul>
        <p>
          Nuestra responsabilidad total por daños directos no superará lo que hayas pagado por el
          servicio en los tres meses anteriores al hecho que la origine. Estas limitaciones no se
          aplican en caso de dolo o culpa grave, ni limitan los derechos irrenunciables que la Ley
          19.496 sobre Protección de los Derechos de los Consumidores te otorga si eres consumidor.
        </p>
      </>
    ),
  },
  {
    id: 'termino',
    titulo: 'Término del servicio',
    contenido: (
      <>
        <p>
          Puedes dejar de usar Boletéame cuando quieras: cancela tu plan desde el panel y, si además
          quieres que eliminemos tus datos, <Contacto />. Antes de pedirlo, descarga tus documentos:
          la obligación de conservarlos es tuya y, una vez eliminados, no podremos recuperarlos.
        </p>
        <p>
          Podemos terminar el servicio con un aviso de al menos 30 días, o de inmediato si hay un
          incumplimiento grave de estos términos. Qué pasa con tus datos al terminar se explica en
          la <Enlace href="/legal/privacidad#conservacion">política de privacidad</Enlace>.
        </p>
      </>
    ),
  },
  {
    id: 'cambios',
    titulo: 'Cambios a estos términos',
    contenido: (
      <p>
        Podemos actualizar estos términos. Si el cambio es importante, te avisaremos por correo o en
        el panel al menos 15 días antes de que rija. Si no estás de acuerdo, puedes cancelar antes
        de esa fecha; si sigues usando el servicio después, se entiende que aceptas la nueva
        versión. La fecha de vigencia está al comienzo de esta página.
      </p>
    ),
  },
  {
    id: 'ley-aplicable',
    titulo: 'Ley aplicable y controversias',
    contenido: (
      <p>
        Estos términos se rigen por las leyes de la República de Chile. Cualquier controversia se
        someterá a los tribunales ordinarios de justicia competentes de Chile, sin perjuicio del
        derecho de los consumidores a recurrir ante el tribunal que corresponda según la Ley 19.496.
      </p>
    ),
  },
  {
    id: 'contacto',
    titulo: 'Contacto',
    contenido: (
      <p>
        Si tienes preguntas sobre estos términos, <Contacto />.
      </p>
    ),
  },
];

export default function PaginaTerminos() {
  return (
    <DocumentoLegal
      titulo="Términos y condiciones"
      bajada="Las reglas para usar Boletéame: qué hace el servicio, qué te corresponde a ti ante el SII, cómo funcionan los planes y pagos, y qué pasa si algo falla."
      vigencia={VIGENCIA_TERMINOS}
      secciones={SECCIONES}
      otro={{ href: '/legal/privacidad', texto: 'Política de privacidad' }}
    />
  );
}
