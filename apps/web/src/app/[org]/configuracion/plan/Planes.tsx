'use client';

import { useRouter } from 'next/navigation';
import { type ReactElement, useState, useTransition } from 'react';
import { Alerta, Boton, Dialogo, Tarjeta } from '@/components/boleteame';
import { formatearFecha, formatearMonto } from '@/lib/formatos';
import {
  caracteristicasPlan,
  limitesExcedidos,
  type Plan,
  type UsoOrganizacion,
} from '@/lib/planes';
import type { MensajeError } from '@/server/equipo-errores';
import { cambiarPlan, cancelarPlan, contratar, vistaPreviaCambio } from './acciones';
import estilos from './plan.module.css';

// Grilla de planes con contratar / cambiar / cancelar (PLAN-SAAS Fase 10). Sin una
// suscripción pagada, elegir un plan lleva a Flow a registrar la tarjeta (se avisa
// antes en un diálogo). Con una suscripción de Flow, primero se muestra el prorrateo
// que calcula Flow y después se confirma el cambio.

export interface PlanesProps {
  slug: string;
  admin: boolean;
  planes: Plan[];
  planActual: string | null;
  /** Tiene una suscripción cobrada por Flow vigente. */
  pagada: boolean;
  /** La cancelación ya está pedida (rige hasta el fin del período). */
  cancelacionPedida: boolean;
  periodoFin: string | null;
  uso: UsoOrganizacion;
  /** Flow configurado en el servidor. */
  pasarelaLista: boolean;
}

type EstadoDialogo =
  | { tipo: 'contratar'; plan: Plan }
  | { tipo: 'cambiar'; plan: Plan; saldo: number; proximoCobro: string | null }
  | { tipo: 'cancelar' }
  | null;

type Aviso = { tono: 'exito' | 'error'; titulo: string; detalle?: string } | null;

function avisoDeError(error: MensajeError): Aviso {
  return { tono: 'error', titulo: error.titulo, detalle: error.detalle };
}

export function Planes({
  slug,
  admin,
  planes,
  planActual,
  pagada,
  cancelacionPedida,
  periodoFin,
  uso,
  pasarelaLista,
}: PlanesProps): ReactElement {
  const router = useRouter();
  const [dialogo, setDialogo] = useState<EstadoDialogo>(null);
  const [aviso, setAviso] = useState<Aviso>(null);
  const [pendiente, iniciar] = useTransition();
  const [cargandoPlan, setCargandoPlan] = useState<string | null>(null);

  const visibles = planes.filter((p) => p.autoservicio || p.codigo === planActual);

  function elegir(plan: Plan) {
    setAviso(null);
    if (!pagada) {
      setDialogo({ tipo: 'contratar', plan });
      return;
    }
    setCargandoPlan(plan.codigo);
    iniciar(async () => {
      const r = await vistaPreviaCambio(slug, plan.codigo);
      setCargandoPlan(null);
      if (!r.ok) {
        setAviso(avisoDeError(r.error));
        return;
      }
      setDialogo({ tipo: 'cambiar', plan, saldo: r.saldo, proximoCobro: r.proximoCobro });
    });
  }

  function confirmar() {
    if (!dialogo) return;
    iniciar(async () => {
      if (dialogo.tipo === 'contratar') {
        const r = await contratar(slug, dialogo.plan.codigo);
        if (!r.ok) {
          setDialogo(null);
          setAviso(avisoDeError(r.error));
          return;
        }
        if ('url' in r) {
          // A Flow, a registrar la tarjeta. Vuelve por /api/pagos/flow/registro.
          window.location.assign(r.url);
          return;
        }
        // Ya tenía suscripción de Flow (la página estaba desactualizada).
        setDialogo(null);
        router.refresh();
        return;
      }
      if (dialogo.tipo === 'cambiar') {
        const r = await cambiarPlan(slug, dialogo.plan.codigo);
        setDialogo(null);
        setAviso(r.ok ? { tono: 'exito', titulo: r.mensaje } : avisoDeError(r.error));
        router.refresh();
        return;
      }
      const r = await cancelarPlan(slug);
      setDialogo(null);
      setAviso(r.ok ? { tono: 'exito', titulo: r.mensaje } : avisoDeError(r.error));
      router.refresh();
    });
  }

  return (
    <section aria-labelledby="t-planes" className={estilos.bloque}>
      <h2 id="t-planes" className={estilos.subtitulo}>
        Planes
      </h2>
      <p className={estilos.nota}>
        Montos en pesos chilenos, IVA incluido, cobrados cada mes con tu tarjeta por Flow. Puedes
        cambiar de plan cuando quieras: Flow calcula la diferencia del período.
      </p>
      {!pasarelaLista && admin ? (
        <Alerta tono="info" titulo="Los pagos todavía no están habilitados">
          Puedes revisar los planes, pero la contratación se activa cuando la pasarela de pagos
          quede configurada.
        </Alerta>
      ) : null}
      {aviso ? (
        <Alerta tono={aviso.tono} titulo={aviso.titulo}>
          {aviso.detalle}
        </Alerta>
      ) : null}

      <div className={estilos.grilla}>
        {visibles.map((plan) => {
          const actual = plan.codigo === planActual;
          const motivos = actual ? [] : limitesExcedidos(uso, plan);
          const contratable = plan.autoservicio && !actual && admin && pasarelaLista;
          return (
            <Tarjeta
              key={plan.id}
              as="article"
              className={estilos.tarjetaPlan}
              data-actual={actual ? 'true' : undefined}
              aria-labelledby={`plan-${plan.codigo}`}
            >
              <div className={estilos.cabeceraPlan}>
                <h3 id={`plan-${plan.codigo}`} className={estilos.subtitulo}>
                  {plan.nombre}
                </h3>
                {actual ? <span className={estilos.marcaActual}>Tu plan</span> : null}
              </div>
              <p className={estilos.precio}>
                {plan.precio_mensual_clp > 0 ? formatearMonto(plan.precio_mensual_clp) : 'Gratis'}
                {plan.precio_mensual_clp > 0 ? (
                  <span className={estilos.porMes}> al mes</span>
                ) : null}
              </p>
              <ul className={estilos.caracteristicas}>
                {caracteristicasPlan(plan).map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
              {contratable ? (
                <div className={estilos.accionPlan}>
                  {motivos.length > 0 ? (
                    <p className={estilos.motivo}>{motivos.join(' ')}</p>
                  ) : null}
                  <Boton
                    variante="secundario"
                    onClick={() => elegir(plan)}
                    disabled={pendiente || motivos.length > 0}
                    aria-describedby={`plan-${plan.codigo}`}
                  >
                    {cargandoPlan === plan.codigo ? 'Calculando…' : `Cambiar a ${plan.nombre}`}
                  </Boton>
                </div>
              ) : null}
            </Tarjeta>
          );
        })}
      </div>

      {admin && pagada && !cancelacionPedida ? (
        <div className={estilos.acciones}>
          <Boton
            variante="discreto"
            onClick={() => {
              setAviso(null);
              setDialogo({ tipo: 'cancelar' });
            }}
            disabled={pendiente}
          >
            Cancelar la suscripción
          </Boton>
        </div>
      ) : null}

      <Dialogo
        abierto={dialogo !== null}
        onCerrar={() => setDialogo(null)}
        onConfirmar={confirmar}
        cargando={pendiente}
        variante={dialogo?.tipo === 'cancelar' ? 'peligro' : 'primario'}
        titulo={
          dialogo?.tipo === 'contratar'
            ? `Contratar el plan ${dialogo.plan.nombre}`
            : dialogo?.tipo === 'cambiar'
              ? `Cambiar al plan ${dialogo.plan.nombre}`
              : 'Cancelar la suscripción'
        }
        textoConfirmar={
          dialogo?.tipo === 'contratar'
            ? 'Ir a Flow'
            : dialogo?.tipo === 'cambiar'
              ? 'Cambiar de plan'
              : 'Cancelar la suscripción'
        }
        textoCancelar={dialogo?.tipo === 'cancelar' ? 'Mantener el plan' : 'Cancelar'}
      >
        {dialogo?.tipo === 'contratar' ? (
          <>
            <p>
              Te llevaremos a Flow para registrar tu tarjeta. Al volver, se crea la suscripción y se
              cobra el primer mes:{' '}
              <strong>{formatearMonto(dialogo.plan.precio_mensual_clp)}</strong> (IVA incluido).
              Después, Flow cobra lo mismo cada mes.
            </p>
            <p>El plan nuevo rige apenas Flow confirme el registro.</p>
          </>
        ) : dialogo?.tipo === 'cambiar' ? (
          <>
            <p>
              El plan {dialogo.plan.nombre} cuesta{' '}
              <strong>{formatearMonto(dialogo.plan.precio_mensual_clp)}</strong> al mes.
            </p>
            <p>
              {dialogo.saldo > 0
                ? `Flow cobrará ahora ${formatearMonto(dialogo.saldo)} por la diferencia del período en curso.`
                : dialogo.saldo < 0
                  ? `Te queda un saldo a favor de ${formatearMonto(-dialogo.saldo)}, que Flow descuenta de los próximos cobros.`
                  : 'No hay diferencia que cobrar en el período en curso.'}
              {dialogo.proximoCobro
                ? ` El próximo cobro es el ${formatearFecha(dialogo.proximoCobro)}.`
                : ''}
            </p>
          </>
        ) : dialogo?.tipo === 'cancelar' ? (
          <p>
            Tu plan sigue vigente
            {periodoFin
              ? ` hasta el ${formatearFecha(periodoFin)}`
              : ' hasta el fin del período pagado'}
            . Después vuelves al plan Certificación: sin cobros, pero sin emitir en producción ni
            agregar empresas o usuarios por sobre su cupo.
          </p>
        ) : null}
      </Dialogo>
    </section>
  );
}
