'use client';

import { Save, Send } from 'lucide-react';
import Link from 'next/link';
import { Boton, EstadoDTE, MedidorFolios, Monto, Tarjeta, TipoDTE } from '@/components/boleteame';
import { rutReceptorParaMostrar, type Totales, type VistaEmision } from '@/lib/emision';
import { ETIQUETA_AMBIENTE, enAmbiente, nombreTipoFolio } from '@/lib/folios';
import { useEmisionStore } from '@/stores/ProveedorEmision';
import estilos from './emitir.module.css';
import { type Bloqueo, foliosDe, medidorDe, textoFolio } from './logica';

// Resumen lateral: folio que se asignará, totales en vivo, los botones y el medidor de
// folios del tipo y ambiente elegidos. En móvil va debajo del formulario.

export function Resumen({
  vista,
  slug,
  totales,
  bloqueo,
  bloqueoGuardar,
  enMarcha,
  ocupado,
  onEmitir,
  onGuardar,
  onNueva,
}: {
  vista: VistaEmision;
  slug: string;
  totales: Totales;
  /** Por qué no se puede emitir ahora (ambiente, certificado, folios o una incierta). */
  bloqueo: Bloqueo | null;
  /** Por qué no se puede guardar el borrador (producción sin autorización o sin plan). */
  bloqueoGuardar: Bloqueo | null;
  enMarcha: 'ensayo' | 'emitir' | 'guardar' | null;
  ocupado: boolean;
  onEmitir: () => void;
  onGuardar: () => void;
  onNueva: () => void;
}) {
  const tipo = useEmisionStore((s) => s.tipoDte);
  const ambiente = useEmisionStore((s) => s.ambiente);
  const receptor = useEmisionStore((s) => s.receptor);
  const borradorId = useEmisionStore((s) => s.borradorId);
  const folios = foliosDe(vista, ambiente, tipo);
  const medidor = medidorDe(folios);
  const folio = textoFolio(folios?.siguiente);
  const nombreTipo = tipo === 41 ? 'boleta exenta' : 'boleta';

  return (
    <aside aria-labelledby="t-resumen" className={estilos.lateral}>
      <Tarjeta as="section" className={estilos.resumen} aria-labelledby="t-resumen">
        <div className={estilos.seccionCabecera}>
          <h2 id="t-resumen" className={estilos.subtitulo}>
            Resumen
          </h2>
          {borradorId ? <EstadoDTE estado="borrador" detalle="Borrador guardado" /> : null}
        </div>

        <div className={estilos.filaResumen}>
          <span>Documento</span>
          <TipoDTE codigo={tipo} corto />
        </div>
        <div className={estilos.filaResumen}>
          <span>Ambiente</span>
          <span>{ETIQUETA_AMBIENTE[ambiente]}</span>
        </div>
        <div className={estilos.filaResumen}>
          <span>Receptor</span>
          <span>
            <span className={estilos.mono}>{rutReceptorParaMostrar(receptor.rut.trim())}</span>
            {receptor.rut.trim() === '' ? ' Cliente General' : ''}
          </span>
        </div>
        <div className={estilos.filaResumen}>
          <span>Folio que se asignará</span>
          {folio ? (
            <span>
              <span className={estilos.folio}>{folio}</span>
              <span className={estilos.nota}>, se confirma al emitir</span>
            </span>
          ) : (
            <span className={estilos.nota}>Sin folios disponibles</span>
          )}
        </div>

        <dl className={estilos.totales}>
          <div className={estilos.dato}>
            <dt>Subtotal</dt>
            <dd>
              <Monto valor={totales.afectoBruto + totales.exento} tenue />
            </dd>
          </div>
          {totales.descuentoAplicado > 0 ? (
            <div className={estilos.dato}>
              <dt>Descuento</dt>
              <dd>
                <Monto valor={-totales.descuentoAplicado} tenue />
              </dd>
            </div>
          ) : null}
          <div className={estilos.dato}>
            <dt>Neto</dt>
            <dd>
              <Monto valor={totales.neto} tenue />
            </dd>
          </div>
          <div className={estilos.dato}>
            <dt>IVA (19 %)</dt>
            <dd>
              <Monto valor={totales.iva} tenue />
            </dd>
          </div>
          <div className={estilos.dato}>
            <dt>Exento</dt>
            <dd>
              <Monto valor={totales.exento} tenue />
            </dd>
          </div>
          <div className={estilos.total}>
            <dt>Total</dt>
            {/* Región viva: anuncia el total cuando cambia una línea o el descuento. */}
            <dd aria-live="polite" aria-atomic="true">
              <Monto valor={totales.total} destacado />
            </dd>
          </div>
        </dl>

        <div className={estilos.botonesResumen}>
          <Boton
            variante="primario"
            className={estilos.botonPrincipal}
            icono={<Send size={16} strokeWidth={1.5} />}
            onClick={onEmitir}
            disabled={ocupado || bloqueo !== null}
            aria-describedby={bloqueo ? 'motivo-emitir' : undefined}
            aria-busy={enMarcha === 'ensayo' || enMarcha === 'emitir' || undefined}
          >
            {enMarcha === 'ensayo' ? 'Preparando el resumen…' : `Emitir ${nombreTipo}`}
          </Boton>
          <Boton
            icono={<Save size={16} strokeWidth={1.5} />}
            onClick={onGuardar}
            disabled={ocupado || bloqueoGuardar !== null}
            aria-describedby={bloqueoGuardar ? 'motivo-guardar' : undefined}
            aria-busy={enMarcha === 'guardar' || undefined}
          >
            {enMarcha === 'guardar' ? 'Guardando…' : 'Guardar borrador'}
          </Boton>
          <Boton variante="discreto" onClick={onNueva} disabled={ocupado}>
            Empezar una boleta nueva
          </Boton>
        </div>

        {bloqueoGuardar ? (
          <p id="motivo-guardar" className={estilos.nota}>
            {bloqueoGuardar.texto}
          </p>
        ) : null}
        {bloqueo ? (
          <p id="motivo-emitir" className={estilos.opcionBloqueo}>
            {bloqueo.texto}{' '}
            {bloqueo.enlace ? <Link href={bloqueo.enlace.href}>{bloqueo.enlace.texto}</Link> : null}
          </p>
        ) : vista.certificado ? (
          <p className={estilos.nota}>
            Primero verás un resumen sin salir al SII. Al confirmar, firmamos la boleta con el
            certificado de {vista.certificado.titular} y la enviamos al SII {enAmbiente(ambiente)}.
          </p>
        ) : null}
      </Tarjeta>

      {medidor ? (
        <MedidorFolios
          codigo={tipo}
          desde={medidor.desde}
          hasta={medidor.hasta}
          siguiente={medidor.siguiente}
        />
      ) : (
        <p className={estilos.nota}>
          Aún no hay folios de {nombreTipoFolio(tipo)} {enAmbiente(ambiente)}.{' '}
          <Link href={`/${slug}/folios?empresa=${vista.empresa.id}`}>Pide o sube un CAF</Link>.
        </p>
      )}
    </aside>
  );
}
