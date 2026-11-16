'use client';

import Link from 'next/link';
import { useId } from 'react';
import { Tarjeta, TipoDTE } from '@/components/boleteame';
import type { VistaEmision } from '@/lib/emision';
import { AMBIENTES_FOLIO, ETIQUETA_AMBIENTE, TIPOS_FOLIO } from '@/lib/folios';
import { useEmisionStore } from '@/stores/ProveedorEmision';
import estilos from './emitir.module.css';
import { ambienteDe, explicarMotivo } from './logica';

// Tipo de boleta (39/41) y ambiente del SII, con el estado de cada ambiente: uno
// bloqueado queda deshabilitado con el motivo y un enlace a lo que lo arregla.

const TEXTO_TIPO = {
  39: 'Precios con IVA incluido. Puedes marcar líneas exentas.',
  41: 'Para ventas exentas de IVA: todas las líneas son exentas.',
} as const;

const TEXTO_AMBIENTE = {
  produccion: 'Boletas reales, con validez tributaria.',
  certificacion: 'Pruebas ante el SII, sin validez tributaria.',
} as const;

export function Documento({
  vista,
  slug,
  deshabilitado,
}: {
  vista: VistaEmision;
  slug: string;
  deshabilitado: boolean;
}) {
  const tipo = useEmisionStore((s) => s.tipoDte);
  const ambiente = useEmisionStore((s) => s.ambiente);
  const cambiarTipo = useEmisionStore((s) => s.cambiarTipo);
  const cambiarAmbiente = useEmisionStore((s) => s.cambiarAmbiente);
  const nombre = useId();

  return (
    <Tarjeta aria-labelledby="t-documento" className={estilos.seccion}>
      <h2 id="t-documento" className={estilos.subtitulo}>
        Documento
      </h2>

      <fieldset className={estilos.opciones}>
        <legend className={estilos.leyenda}>Tipo de boleta</legend>
        <div className={estilos.opcionesFila}>
          {TIPOS_FOLIO.map((t) => (
            <div key={t} className={estilos.opcion}>
              <label className={estilos.opcionEtiqueta}>
                <input
                  type="radio"
                  className={estilos.radio}
                  name={`${nombre}-tipo`}
                  value={t}
                  checked={tipo === t}
                  onChange={() => cambiarTipo(t)}
                  disabled={deshabilitado}
                  aria-describedby={`${nombre}-tipo-${t}`}
                />
                <TipoDTE codigo={t} />
              </label>
              <span id={`${nombre}-tipo-${t}`} className={estilos.opcionTexto}>
                {TEXTO_TIPO[t]}
              </span>
            </div>
          ))}
        </div>
      </fieldset>

      <fieldset className={estilos.opciones}>
        <legend className={estilos.leyenda}>Ambiente del SII</legend>
        <div className={estilos.opcionesFila}>
          {AMBIENTES_FOLIO.map((a) => {
            const estado = ambienteDe(vista, a);
            const habilitado = estado?.habilitado ?? false;
            const bloqueo = habilitado
              ? null
              : explicarMotivo(estado?.motivo ?? 'sin_resolucion', a, slug, vista.empresa.id);
            const idTexto = `${nombre}-amb-${a}`;
            return (
              <div key={a} className={estilos.opcion}>
                <label className={estilos.opcionEtiqueta}>
                  <input
                    type="radio"
                    className={estilos.radio}
                    name={`${nombre}-ambiente`}
                    value={a}
                    checked={ambiente === a}
                    onChange={() => cambiarAmbiente(a)}
                    disabled={deshabilitado || !habilitado}
                    aria-describedby={idTexto}
                  />
                  {ETIQUETA_AMBIENTE[a]}
                </label>
                <span
                  id={idTexto}
                  className={bloqueo ? estilos.opcionBloqueo : estilos.opcionTexto}
                >
                  {bloqueo ? `No disponible: ${bloqueo.texto}` : TEXTO_AMBIENTE[a]}
                </span>
                {bloqueo?.enlace ? (
                  <Link href={bloqueo.enlace.href} className={estilos.enlaceChico}>
                    {bloqueo.enlace.texto}
                  </Link>
                ) : null}
              </div>
            );
          })}
        </div>
      </fieldset>
    </Tarjeta>
  );
}
