import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alerta, Tarjeta } from '@/components/boleteame';
import { RUTA_DOCS_API } from '@/lib/api-publica';
import { formatearFechaHora } from '@/lib/formatos';
import { puedeAdministrar } from '@/lib/permisos';
import {
  ENTREGAS_POR_PAGINA,
  leerEntregas,
  leerPlanIntegraciones,
  leerWebhook,
} from '@/server/integraciones/lectura';
import { exigirMembresia } from '@/server/sesion';
import org from '../../../organizacion.module.css';
import estilos from '../../api/api.module.css';
import { AccionesWebhook } from './AccionesWebhook';
import { EditarWebhook } from './EditarWebhook';
import { HistorialEntregas } from './HistorialEntregas';

export const metadata: Metadata = { title: 'Webhook' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `?antes=<id>` del historial: entero positivo, o `null` (primera página). */
function leerAntes(valor: string | string[] | undefined): number | null {
  const texto = Array.isArray(valor) ? valor[0] : valor;
  if (!texto || !/^\d{1,15}$/.test(texto)) return null;
  const n = Number(texto);
  return n > 0 ? n : null;
}

export default async function PaginaWebhook({
  params,
  searchParams,
}: {
  params: Promise<{ org: string; id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ org: slug, id }, consulta] = await Promise.all([params, searchParams]);
  const { organizacion, rol } = await exigirMembresia(slug);
  const ruta = `/${slug}/configuracion/webhooks`;

  if (!puedeAdministrar(rol)) {
    return (
      <>
        <header className={org.cabecera}>
          <p className={org.nota}>
            <Link href={`/${slug}/configuracion`}>Configuración</Link> · {organizacion.nombre}
          </p>
          <h1 className={org.titulo}>Webhook</h1>
        </header>
        <Alerta tono="info" titulo="Solo un propietario o un administrador gestiona los webhooks">
          Pide a uno de ellos que revise este webhook.
        </Alerta>
      </>
    );
  }

  if (!UUID.test(id)) notFound();
  const antes = leerAntes(consulta.antes);
  const [webhook, plan, pagina] = await Promise.all([
    leerWebhook(organizacion.id, id),
    leerPlanIntegraciones(organizacion.id),
    leerEntregas(organizacion.id, id, antes),
  ]);
  if (!webhook) notFound();

  return (
    <>
      <header className={org.cabecera}>
        <p className={org.nota}>
          <Link href={`/${slug}/configuracion`}>Configuración</Link> ·{' '}
          <Link href={ruta}>Webhooks</Link> · {organizacion.nombre}
        </p>
        <h1 className={org.titulo}>Webhook</h1>
        <p className={`${org.texto} ${estilos.url}`}>{webhook.url}</p>
        <p className={estilos.nota}>
          {webhook.activo ? 'Activo' : 'Pausado'} · creado el {formatearFechaHora(webhook.creadoEn)}
          {' · '}
          <Link href={`${RUTA_DOCS_API}#webhooks`}>Cómo verificar la firma</Link>
        </p>
      </header>

      {plan.incluyeWebhooks ? null : (
        <Alerta tono="aviso" titulo="Tu plan no incluye webhooks">
          No enviamos eventos ni pruebas mientras el plan no los incluya.{' '}
          <Link href={`/${slug}/configuracion/plan`}>Revisa tu plan</Link>.
        </Alerta>
      )}
      {webhook.activo ? null : (
        <Alerta tono="info" titulo="El webhook está pausado">
          No recibe eventos nuevos. Actívalo para volver a recibirlos.
        </Alerta>
      )}

      <Tarjeta as="section" aria-labelledby="t-acciones" className={estilos.bloque}>
        <h2 id="t-acciones" className={estilos.subtitulo}>
          Acciones
        </h2>
        <AccionesWebhook
          slug={slug}
          webhookId={webhook.id}
          url={webhook.url}
          activo={webhook.activo}
          planConWebhooks={plan.incluyeWebhooks}
        />
      </Tarjeta>

      <Tarjeta as="section" aria-labelledby="t-editar" className={estilos.bloque}>
        <h2 id="t-editar" className={estilos.subtitulo}>
          URL y eventos
        </h2>
        <EditarWebhook
          slug={slug}
          webhookId={webhook.id}
          url={webhook.url}
          eventos={webhook.eventos}
        />
      </Tarjeta>

      <section aria-labelledby="t-entregas" className={estilos.seccion}>
        <h2 id="t-entregas" className={estilos.subtitulo}>
          Historial de entregas
        </h2>
        <p className={estilos.nota}>
          Una entrega cuenta como recibida cuando tu endpoint responde 2xx en menos de 10 segundos.
          Si falla, reintentamos con esperas crecientes hasta 8 veces; después queda descartada y
          puedes reenviarla. Guardamos las entregas terminadas por 30 días.
        </p>
        <HistorialEntregas
          slug={slug}
          webhookId={webhook.id}
          entregas={pagina.entregas}
          puedeReenviar={webhook.activo && plan.incluyeWebhooks}
        />
        {antes !== null || pagina.antesSiguiente !== null ? (
          <nav aria-label="Páginas del historial" className={estilos.paginacion}>
            {antes !== null ? (
              <Link href={`${ruta}/${webhook.id}`}>Ver las más recientes</Link>
            ) : (
              <span />
            )}
            {pagina.antesSiguiente !== null ? (
              <Link href={`${ruta}/${webhook.id}?antes=${pagina.antesSiguiente}`}>
                Ver {ENTREGAS_POR_PAGINA} más antiguas
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    </>
  );
}
