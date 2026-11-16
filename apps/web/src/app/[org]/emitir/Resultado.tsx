'use client';

import { Download, FileDown, Printer } from 'lucide-react';
import type { ReactNode, Ref } from 'react';
import { Alerta, Boton, EstadoDTE, Monto, TipoDTE } from '@/components/boleteame';
import type {
  ArchivoDocumento,
  DocumentoEmitido,
  ResultadoEmision,
  ResumenEmision,
} from '@/lib/emision';
import { ETIQUETA_AMBIENTE, enAmbiente } from '@/lib/folios';
import { formatearFecha, formatearFechaHora, formatearRut } from '@/lib/formatos';
import type { EmisionIncierta } from '@/stores/emision';
import estilos from './emitir.module.css';
import { estadoParaMostrar, textoFolio } from './logica';

// Piezas del flujo de emisión: el resumen del ensayo (dentro del `Dialogo`), el resultado
// de una boleta emitida y el aviso de una emisión por verificar.

export function Datos({ filas }: { filas: { etiqueta: string; valor: ReactNode }[] }) {
  return (
    <dl className={estilos.datos}>
      {filas.map((f) => (
        <div key={f.etiqueta} className={estilos.dato}>
          <dt>{f.etiqueta}</dt>
          <dd>{f.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Lo que se emitirá: lo arma el servidor en el ensayo, sin asignar folio ni salir al SII. */
export function ContenidoEnsayo({ resumen }: { resumen: ResumenEmision }) {
  const t = resumen.totales;
  return (
    <div className={estilos.ensayo}>
      {resumen.ambiente === 'produccion' ? (
        <Alerta tono="aviso" titulo="Boleta real">
          En producción la boleta queda informada al SII con validez tributaria y consume un folio.
          No se puede deshacer: si hay un error, se corrige con una nota de crédito.
        </Alerta>
      ) : (
        <Alerta tono="info" titulo="Ambiente de certificación">
          La boleta va al SII de pruebas y no tiene validez tributaria, pero sí consume un folio de
          certificación.
        </Alerta>
      )}
      <Datos
        filas={[
          ...resumen.filas,
          {
            etiqueta: 'Folio',
            valor:
              resumen.folioPrevisto !== null
                ? `${textoFolio(resumen.folioPrevisto)} (se confirma al emitir)`
                : 'Sin folios disponibles',
          },
          { etiqueta: 'Neto', valor: <Monto valor={t.neto} /> },
          { etiqueta: 'IVA (19 %)', valor: <Monto valor={t.iva} /> },
          ...(t.exento > 0 ? [{ etiqueta: 'Exento', valor: <Monto valor={t.exento} /> }] : []),
          ...(t.descuentoAplicado > 0
            ? [{ etiqueta: 'Descuento', valor: <Monto valor={-t.descuentoAplicado} /> }]
            : []),
          { etiqueta: 'Total', valor: <Monto valor={t.total} destacado /> },
          {
            etiqueta: 'Certificado',
            valor: `${resumen.certificado.titular} (${formatearRut(resumen.certificado.rut)}), vence el ${formatearFecha(resumen.certificado.vigenteHasta)}`,
          },
        ]}
      />
      {resumen.avisos.length > 0 ? (
        <ul className={estilos.listaAvisos}>
          {resumen.avisos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

const ARCHIVOS: readonly { archivo: ArchivoDocumento; texto: string; pdf: boolean }[] = [
  { archivo: 'pdf_carta', texto: 'PDF carta', pdf: true },
  { archivo: 'pdf_rollo', texto: 'PDF rollo 80 mm', pdf: true },
  { archivo: 'xml', texto: 'XML', pdf: false },
];

const ICONO_ARCHIVO: Readonly<Record<ArchivoDocumento, ReactNode>> = {
  pdf_carta: <FileDown size={16} strokeWidth={1.5} />,
  pdf_rollo: <Printer size={16} strokeWidth={1.5} />,
  xml: <Download size={16} strokeWidth={1.5} />,
};

function datosDocumento(d: DocumentoEmitido) {
  return [
    { etiqueta: 'Documento', valor: <TipoDTE codigo={d.tipoDte} corto /> },
    { etiqueta: 'Folio', valor: <span className={estilos.mono}>{textoFolio(d.folio)}</span> },
    { etiqueta: 'Ambiente', valor: ETIQUETA_AMBIENTE[d.ambiente] },
    { etiqueta: 'Estado', valor: <EstadoDTE estado={estadoParaMostrar(d.estado)} /> },
    {
      etiqueta: 'Track ID',
      valor: d.trackId ? <span className={estilos.mono}>{d.trackId}</span> : 'Sin Track ID',
    },
    { etiqueta: 'Total', valor: <Monto valor={d.total} destacado /> },
  ];
}

/** Boleta emitida: datos, descargas y «Emitir otra». */
export function ResultadoOk({
  resultado,
  descargando,
  errorDescarga,
  onDescargar,
  onOtra,
  ref,
}: {
  resultado: Extract<ResultadoEmision, { tipo: 'ok' }>;
  descargando: ArchivoDocumento | null;
  errorDescarga: { titulo: string; detalle: string } | null;
  onDescargar: (archivo: ArchivoDocumento) => void;
  onOtra: () => void;
  ref?: Ref<HTMLElement>;
}) {
  const d = resultado.documento;
  const avisos = [...(resultado.avisos ?? [])];
  if (!d.conPdf && !avisos.some((a) => a.includes('PDF'))) {
    avisos.push(
      'La boleta se emitió, pero no pudimos generar su PDF. Puedes descargar el XML ahora y el PDF más tarde desde Documentos emitidos.',
    );
  }
  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-labelledby="t-resultado"
      className={`${estilos.resultado} ${estilos.enfocable}`}
    >
      <h2 id="t-resultado" className={estilos.subtitulo}>
        {d.tipoDte === 41 ? 'Boleta exenta emitida' : 'Boleta emitida'}
      </h2>
      <Alerta tono="exito" titulo={resultado.mensaje.titulo}>
        <p>{resultado.mensaje.detalle}</p>
      </Alerta>
      <Datos filas={datosDocumento(d)} />
      {avisos.length > 0 ? (
        <Alerta tono="aviso" titulo="Revisa esto">
          <ul className={estilos.listaAvisos}>
            {avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alerta>
      ) : null}
      <div className={estilos.acciones}>
        {ARCHIVOS.filter((a) => d.conPdf || !a.pdf).map((a) => (
          <Boton
            key={a.archivo}
            tamano="sm"
            icono={ICONO_ARCHIVO[a.archivo]}
            onClick={() => onDescargar(a.archivo)}
            disabled={descargando !== null}
            aria-busy={descargando === a.archivo || undefined}
          >
            {descargando === a.archivo ? 'Abriendo…' : `Descargar ${a.texto}`}
          </Boton>
        ))}
      </div>
      {errorDescarga ? (
        <Alerta tono="error" titulo={errorDescarga.titulo}>
          {errorDescarga.detalle}
        </Alerta>
      ) : null}
      <div className={estilos.acciones}>
        <Boton variante="primario" onClick={onOtra}>
          Emitir otra
        </Boton>
      </div>
    </section>
  );
}

/**
 * Emisión por verificar: no se sabe si el SII recibió la boleta. No se reintenta en un
 * clic: el formulario queda como estaba y emitir sigue bloqueado hasta que la persona
 * empiece otra boleta a propósito.
 */
export function AlertaIncierta({
  incierta,
  mensaje,
  onRevisada,
  ref,
}: {
  incierta: EmisionIncierta;
  mensaje: { titulo: string; detalle: string } | null;
  onRevisada: () => void;
  ref?: Ref<HTMLDivElement>;
}) {
  const folio = textoFolio(incierta.folio);
  return (
    <div ref={ref} tabIndex={-1} className={estilos.enfocable}>
      <Alerta
        tono="aviso"
        titulo={mensaje?.titulo ?? 'No sabemos si el SII recibió la última boleta'}
        accion={
          <Boton tamano="sm" variante="secundario" onClick={onRevisada}>
            Ya la revisé
          </Boton>
        }
      >
        {mensaje ? <p>{mensaje.detalle}</p> : null}
        <p>
          La boleta{folio ? ` ${folio}` : ''} del {formatearFechaHora(incierta.en)} quedó por
          verificar {enAmbiente(incierta.ambiente)}
          {incierta.trackId ? ` (Track ID ${incierta.trackId})` : ''}.{' '}
          <strong>No la vuelvas a emitir</strong> hasta revisar si llegó: búscala en el SII
          {folio ? ' por su folio' : ''} o en Documentos emitidos. Si la emites de nuevo y sí había
          llegado, quedaría duplicada.
        </p>
      </Alerta>
    </div>
  );
}
