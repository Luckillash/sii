import type { Metadata } from 'next';
import Link from 'next/link';
import { Alerta, Tabla, TablaVacia, Tarjeta, Td, Th } from '@/components/boleteame';
import { formatearFecha, formatearMonto } from '@/lib/formatos';
import { puedeAdministrar } from '@/lib/permisos';
import { ETIQUETA_ESTADO_SUSCRIPCION } from '@/lib/planes';
import { pasarelaConfigurada } from '@/server/pagos';
import { mensajeRetornoPago } from '@/server/pagos/errores';
import { leerVistaPlan, type PagoVista } from '@/server/pagos/lectura';
import { exigirMembresia } from '@/server/sesion';
import org from '../../organizacion.module.css';
import { BarraUso } from './BarraUso';
import { Planes } from './Planes';
import estilos from './plan.module.css';

export const metadata: Metadata = { title: 'Plan · Boletéame' };

// Configuración → Plan (PLAN-SAAS Fase 10): plan vigente, uso del mes contra los límites,
// grilla para cambiar de plan (Flow), tarjeta e historial de pagos. Todos los miembros
// ven el plan y el uso; tarjeta, pagos y acciones son de propietarios y administradores.

const ETIQUETA_PAGO: Record<PagoVista['estado'], string> = {
  pendiente: 'Pendiente',
  vencido: 'Vencido',
  pagado: 'Pagado',
  anulado: 'Anulado',
};

function periodo(inicio: string | null, fin: string | null): string {
  if (!inicio) return '—';
  return fin
    ? `${formatearFecha(inicio)} al ${formatearFecha(fin)}`
    : `desde ${formatearFecha(inicio)}`;
}

export default async function PaginaPlan({
  params,
  searchParams,
}: {
  params: Promise<{ org: string }>;
  searchParams: Promise<{ pago?: string | string[] }>;
}) {
  const { org: slug } = await params;
  const { pago } = await searchParams;
  const { organizacion, rol } = await exigirMembresia(slug);
  const admin = puedeAdministrar(rol);
  const vista = await leerVistaPlan(organizacion.id, admin);
  const retorno = mensajeRetornoPago(typeof pago === 'string' ? pago : undefined);
  const { suscripcion, uso } = vista;
  const plan = suscripcion?.plan ?? null;
  const vencido = vista.pagos?.find((p) => p.estado === 'vencido' && p.enlacePago) ?? null;

  return (
    <>
      <header className={org.cabecera}>
        <p className={org.nota}>
          <Link href={`/${slug}/configuracion`}>Configuración</Link> · {organizacion.nombre}
        </p>
        <h1 className={org.titulo}>Plan</h1>
        <p className={org.texto}>
          Tu plan define cuántas empresas, usuarios y boletas en producción puedes tener cada mes.
          {admin ? null : ' Solo un propietario o un administrador puede cambiarlo.'}
        </p>
      </header>

      {retorno ? (
        <Alerta tono={retorno.tono} titulo={retorno.titulo}>
          {retorno.detalle}
        </Alerta>
      ) : null}

      {suscripcion?.estado === 'morosa' ? (
        <Alerta
          tono="error"
          titulo="Tu suscripción tiene un pago vencido"
          accion={
            admin && vencido?.enlacePago ? (
              <a href={vencido.enlacePago} rel="noopener noreferrer">
                Pagar {formatearMonto(vencido.monto)} en Flow
              </a>
            ) : undefined
          }
        >
          Mientras esté vencido no puedes emitir en producción ni agregar empresas o usuarios. La
          certificación sigue funcionando.
          {admin
            ? ' Paga el importe pendiente o revisa tu tarjeta.'
            : ' Avísale a un administrador.'}
        </Alerta>
      ) : null}

      <Tarjeta as="section" aria-labelledby="t-tu-plan" className={estilos.bloque}>
        <h2 id="t-tu-plan" className={estilos.subtitulo}>
          Tu plan
        </h2>
        {suscripcion && plan ? (
          <>
            <div className={estilos.resumenPlan}>
              <p className={estilos.nombrePlan}>
                {plan.nombre}{' '}
                <span className={estilos.estado} data-estado={suscripcion.estado}>
                  {ETIQUETA_ESTADO_SUSCRIPCION[suscripcion.estado]}
                </span>
              </p>
              <p className={estilos.precio}>
                {plan.precio_mensual_clp > 0 ? formatearMonto(plan.precio_mensual_clp) : 'Gratis'}
                {plan.precio_mensual_clp > 0 ? (
                  <span className={estilos.porMes}> al mes</span>
                ) : null}
              </p>
            </div>
            <dl className={estilos.datos}>
              {suscripcion.pagada ? (
                <>
                  <dt>Período actual</dt>
                  <dd>{periodo(suscripcion.periodoInicio, suscripcion.periodoFin)}</dd>
                </>
              ) : null}
              {suscripcion.cancelarAlFinPeriodo ? (
                <>
                  <dt>Cancelación</dt>
                  <dd>
                    Pedida. Rige hasta
                    {suscripcion.periodoFin
                      ? ` el ${formatearFecha(suscripcion.periodoFin)}`
                      : ' el fin del período'}
                    ; después vuelves al plan Certificación.
                  </dd>
                </>
              ) : null}
              {admin && suscripcion.pagada ? (
                <>
                  <dt>Tarjeta</dt>
                  <dd>
                    {vista.tarjeta?.ultimos4
                      ? `${vista.tarjeta.marca ?? 'Tarjeta'} terminada en ${vista.tarjeta.ultimos4}`
                      : 'Registrada en Flow'}
                  </dd>
                </>
              ) : null}
              {!suscripcion.pagada && plan.codigo === 'certificacion' ? (
                <>
                  <dt>Qué incluye</dt>
                  <dd>
                    Certificarte ante el SII sin costo y sin plazo. Para emitir boletas en
                    producción, elige un plan pagado.
                  </dd>
                </>
              ) : null}
            </dl>
          </>
        ) : (
          <Alerta tono="aviso" titulo="Tu organización no tiene un plan vigente">
            No puedes emitir en producción ni agregar empresas o usuarios.
            {admin ? ' Elige un plan más abajo.' : ' Avísale a un administrador.'}
          </Alerta>
        )}
      </Tarjeta>

      <Tarjeta as="section" aria-labelledby="t-uso" className={estilos.bloque}>
        <h2 id="t-uso" className={estilos.subtitulo}>
          Uso de este mes
        </h2>
        <div className={estilos.usos}>
          <BarraUso
            etiqueta="Boletas en producción"
            usadas={uso.boletasProduccionMes}
            maximo={plan?.permite_produccion ? plan.max_boletas_mes : 0}
            nota={
              plan && !plan.permite_produccion
                ? 'Tu plan no permite emitir en producción.'
                : 'Se reinicia el primer día de cada mes. Las de certificación no cuentan.'
            }
          />
          <BarraUso etiqueta="Empresas" usadas={uso.empresas} maximo={plan?.max_empresas ?? null} />
          <BarraUso etiqueta="Usuarios" usadas={uso.usuarios} maximo={plan?.max_usuarios ?? null} />
        </div>
      </Tarjeta>

      <Planes
        slug={slug}
        admin={admin}
        planes={vista.planes}
        planActual={plan?.codigo ?? null}
        pagada={suscripcion?.pagada ?? false}
        cancelacionPedida={suscripcion?.cancelarAlFinPeriodo ?? false}
        periodoFin={suscripcion?.periodoFin ?? null}
        uso={uso}
        pasarelaLista={pasarelaConfigurada()}
      />

      {vista.pagos ? (
        <section aria-labelledby="t-pagos" className={estilos.bloque}>
          <h2 id="t-pagos" className={estilos.subtitulo}>
            Pagos
          </h2>
          <Tabla etiqueta="Pagos de la suscripción">
            <thead>
              <tr>
                <Th>Período</Th>
                <Th num>Monto</Th>
                <Th>Estado</Th>
                <Th>Fecha</Th>
              </tr>
            </thead>
            <tbody>
              {vista.pagos.length === 0 ? (
                <TablaVacia columnas={4}>
                  Todavía no hay cobros. Aparecen aquí cuando contratas un plan.
                </TablaVacia>
              ) : (
                vista.pagos.map((p) => (
                  <tr key={p.id}>
                    <Td>{periodo(p.periodoInicio, p.periodoFin)}</Td>
                    <Td num>{formatearMonto(p.monto)}</Td>
                    <Td>
                      {ETIQUETA_PAGO[p.estado]}
                      {(p.estado === 'vencido' || p.estado === 'pendiente') && p.enlacePago ? (
                        <>
                          {' · '}
                          <a href={p.enlacePago} rel="noopener noreferrer">
                            Pagar en Flow
                          </a>
                        </>
                      ) : null}
                    </Td>
                    <Td>
                      {p.pagadoEn
                        ? formatearFecha(p.pagadoEn)
                        : p.venceEn
                          ? `Vence el ${formatearFecha(p.venceEn)}`
                          : '—'}
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Tabla>
          <p className={estilos.nota}>
            Flow envía el comprobante de cada cobro al correo con que registraste la tarjeta.
          </p>
        </section>
      ) : null}
    </>
  );
}
