import type { Metadata } from 'next';
import Link from 'next/link';
import { Alerta, Tabla, TablaVacia, Tarjeta, Td, Th } from '@/components/boleteame';
import { ETIQUETA_ESTADO_ENTREGA, RUTA_DOCS_API } from '@/lib/api-publica';
import { formatearFechaHora } from '@/lib/formatos';
import { fallasSeguidas } from '@/lib/integraciones-presentacion';
import { puedeAdministrar } from '@/lib/permisos';
import { leerPlanIntegraciones, leerWebhooks } from '@/server/integraciones/lectura';
import { exigirMembresia } from '@/server/sesion';
import org from '../../organizacion.module.css';
import estilos from '../api/api.module.css';
import { claseEstadoEntrega } from './estilosEntrega';
import { FormularioWebhook } from './FormularioWebhook';

export const metadata: Metadata = { title: 'Webhooks' };

// Configuración → Webhooks (PLAN-SAAS Fase 11, punto 4): crear webhooks (el secreto HMAC
// se muestra una vez) y ver su estado y su última entrega. El detalle, la edición, la
// prueba, la rotación del secreto y el historial están en `webhooks/[id]`. Solo
// propietarios y administradores (RLS `es_admin` de `webhooks` y `webhook_entregas`).

export default async function PaginaWebhooks({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const { organizacion, rol } = await exigirMembresia(slug);
  const admin = puedeAdministrar(rol);

  const cabecera = (
    <header className={org.cabecera}>
      <p className={org.nota}>
        <Link href={`/${slug}/configuracion`}>Configuración</Link> · {organizacion.nombre}
      </p>
      <h1 className={org.titulo}>Webhooks</h1>
      <p className={org.texto}>
        Recibe en tu sistema un aviso firmado cada vez que el SII acepta o rechaza una boleta, o
        cuando cambia algo que te importa. Revisa{' '}
        <Link href={`${RUTA_DOCS_API}#webhooks`}>cómo verificar la firma</Link>.
      </p>
    </header>
  );

  if (!admin) {
    return (
      <>
        {cabecera}
        <Alerta tono="info" titulo="Solo un propietario o un administrador gestiona los webhooks">
          Pide a uno de ellos que configure el webhook que necesitas.
        </Alerta>
      </>
    );
  }

  const [plan, webhooks] = await Promise.all([
    leerPlanIntegraciones(organizacion.id),
    leerWebhooks(organizacion.id),
  ]);
  const conFallas = webhooks.filter((w) => w.activo && fallasSeguidas(w.ultimas));

  return (
    <>
      {cabecera}

      {plan.incluyeWebhooks ? null : (
        <Alerta
          tono="aviso"
          titulo={
            plan.morosa
              ? 'Los webhooks están detenidos por un pago vencido'
              : 'Tu plan no incluye webhooks'
          }
        >
          {plan.morosa
            ? 'Mientras el pago esté vencido no enviamos eventos. '
            : `El plan ${plan.nombre ?? 'actual'} no incluye webhooks: no enviamos eventos y no puedes crear nuevos. `}
          <Link href={`/${slug}/configuracion/plan`}>Revisa tu plan</Link>.
        </Alerta>
      )}

      {conFallas.length > 0 ? (
        <Alerta tono="aviso" titulo="Hay webhooks que no están respondiendo">
          Las últimas 3 entregas de{' '}
          {conFallas.length === 1 ? 'un webhook fallaron' : `${conFallas.length} webhooks fallaron`}
          . Revisa que tu endpoint responda con un código 2xx en menos de 10 segundos; seguiremos
          reintentando hasta 8 veces por entrega.
        </Alerta>
      ) : null}

      <Tarjeta as="section" aria-labelledby="t-crear" className={estilos.bloque}>
        <h2 id="t-crear" className={estilos.subtitulo}>
          Crear un webhook
        </h2>
        <FormularioWebhook slug={slug} deshabilitado={!plan.incluyeWebhooks} />
      </Tarjeta>

      <section aria-labelledby="t-webhooks" className={estilos.seccion}>
        <h2 id="t-webhooks" className={estilos.subtitulo}>
          Webhooks
        </h2>
        <Tabla etiqueta="Webhooks de la organización">
          <thead>
            <tr>
              <Th>URL</Th>
              <Th>Eventos</Th>
              <Th>Estado</Th>
              <Th>Última entrega</Th>
            </tr>
          </thead>
          <tbody>
            {webhooks.length === 0 ? (
              <TablaVacia columnas={4}>
                Aún no hay webhooks. Crea uno con el formulario de arriba.
              </TablaVacia>
            ) : (
              webhooks.map((w) => {
                const ultima = w.ultimas[0];
                return (
                  <tr key={w.id}>
                    <Td className={estilos.url}>
                      <Link href={`/${slug}/configuracion/webhooks/${w.id}`}>{w.url}</Link>
                    </Td>
                    <Td>
                      <ul className={estilos.etiquetas} aria-label="Eventos suscritos">
                        {w.eventos.map((e) => (
                          <li key={e} className={estilos.etiqueta}>
                            {e}
                          </li>
                        ))}
                      </ul>
                    </Td>
                    <Td>
                      <span className={w.activo ? estilos.estadoActivo : estilos.estadoInactivo}>
                        {w.activo ? 'Activo' : 'Pausado'}
                      </span>
                    </Td>
                    <Td>
                      {ultima ? (
                        <>
                          <span className={claseEstadoEntrega(ultima.estado)}>
                            {ETIQUETA_ESTADO_ENTREGA[ultima.estado]}
                          </span>{' '}
                          <span className={estilos.mono}>
                            {formatearFechaHora(ultima.creadoEn)}
                          </span>
                        </>
                      ) : (
                        'Sin entregas'
                      )}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </Tabla>
      </section>
    </>
  );
}
