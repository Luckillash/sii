'use client';

import Link from 'next/link';
import { Boton, clasesBoton, Monto, Tabla, Td, Th, TipoDTE } from '@/components/boleteame';
import { type BorradorGuardado, rutReceptorParaMostrar } from '@/lib/emision';
import { ETIQUETA_AMBIENTE } from '@/lib/folios';
import { formatearFechaHora } from '@/lib/formatos';
import estilos from './emitir.module.css';

// Borradores recientes de la empresa: retomar uno (`?borrador=<id>`) o borrarlo.

export function Borradores({
  borradores,
  slug,
  empresaId,
  actual,
  ocupado,
  onBorrar,
}: {
  borradores: readonly BorradorGuardado[];
  slug: string;
  empresaId: string;
  /** Borrador que se está editando. */
  actual: string | null;
  ocupado: boolean;
  onBorrar: (b: BorradorGuardado) => void;
}) {
  if (borradores.length === 0) return null;
  return (
    <section aria-labelledby="t-borradores" className={estilos.bloque}>
      <h2 id="t-borradores" className={estilos.subtitulo}>
        Borradores guardados
      </h2>
      <Tabla etiqueta="Borradores guardados">
        <thead>
          <tr>
            <Th>Guardado</Th>
            <Th>Tipo</Th>
            <Th>Ambiente</Th>
            <Th>Receptor</Th>
            <Th num>Total</Th>
            <Th>Acciones</Th>
          </tr>
        </thead>
        <tbody>
          {borradores.map((b) => (
            <tr key={b.id}>
              <Td>{formatearFechaHora(b.actualizadoEn)}</Td>
              <Td>
                <TipoDTE codigo={b.tipoDte} soloCodigo />
              </Td>
              <Td>{ETIQUETA_AMBIENTE[b.ambiente]}</Td>
              <Td>
                <span className={estilos.mono}>{rutReceptorParaMostrar(b.receptorRut)}</span>
                {b.receptorRazonSocial ? ` ${b.receptorRazonSocial}` : ''}
              </Td>
              <Td num>
                <Monto valor={b.total} />
              </Td>
              <Td>
                <div className={estilos.accionesFila}>
                  {b.id === actual ? (
                    <span className={estilos.nota}>Lo estás editando</span>
                  ) : (
                    <Link
                      href={`/${slug}/emitir?empresa=${empresaId}&borrador=${b.id}`}
                      className={clasesBoton('discreto', 'sm')}
                      aria-label={`Retomar el borrador del ${formatearFechaHora(b.actualizadoEn)}`}
                    >
                      Retomar
                    </Link>
                  )}
                  <Boton
                    tamano="sm"
                    variante="discreto"
                    onClick={() => onBorrar(b)}
                    disabled={ocupado}
                    aria-label={`Borrar el borrador del ${formatearFechaHora(b.actualizadoEn)}`}
                  >
                    Borrar
                  </Boton>
                </div>
              </Td>
            </tr>
          ))}
        </tbody>
      </Tabla>
      <p className={estilos.nota}>
        Al retomar un borrador, reemplaza lo que tengas sin guardar en el formulario.
      </p>
    </section>
  );
}
