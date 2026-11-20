'use client';

import { Download, Mail, RefreshCw } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useRef, useState } from 'react';
import { Alerta, Boton } from '@/components/boleteame';
import {
  type AvisoUi,
  avisoConsulta,
  type EstadoDocumentoBd,
  motivoSinConsulta,
  textoSinConsulta,
} from '@/lib/documentos-presentacion';
import type { ArchivoDocumento } from '@/lib/emision';
import type { MensajeError } from '@/lib/equipo-errores';
import { estadoVigente } from '@/stores/enVivo';
import { useEnVivoStore } from '@/stores/ProveedorEnVivo';
import { consultarEstado, enlaceArchivo, reenviarAlReceptor } from './acciones';
import estilos from './documentos.module.css';
import { type EnvioParaEstado, useEnvioVigente } from './EstadoEnVivo';

// Acciones del panel de detalle y de la página del envío (PLAN-SAAS Fase 8, punto 3):
// descargar XML y PDF, «Consultar estado en el SII» y «Reenviar al receptor». Siguen el
// estado vigente (servidor o Realtime): si el envío pasa a aceptado mientras el panel está
// abierto, la consulta se deshabilita sola.

const ICONO = { size: 16, strokeWidth: 1.5, 'aria-hidden': true } as const;

const ARCHIVOS: readonly { archivo: ArchivoDocumento; texto: string; pdf: boolean }[] = [
  { archivo: 'pdf_carta', texto: 'PDF carta', pdf: true },
  { archivo: 'pdf_rollo', texto: 'PDF rollo', pdf: true },
  { archivo: 'xml', texto: 'XML', pdf: false },
];

const ESTADOS_REENVIABLES: readonly EstadoDocumentoBd[] = [
  'enviado',
  'aceptado',
  'aceptado_con_reparos',
];

const SIN_CONEXION: MensajeError = {
  titulo: 'No pudimos completar la acción',
  detalle: 'Revisa tu conexión y vuelve a intentarlo.',
};

export interface DocumentoParaAcciones {
  id: string;
  estado: EstadoDocumentoBd;
  actualizadoEn: string;
  conXml: boolean;
  correo: string | null;
}

/** «Consultar estado en el SII» de un envío, con el resultado en una `Alerta`. */
export function ConsultarEstado({
  slug,
  envio,
  documento,
}: {
  slug: string;
  envio: EnvioParaEstado | null;
  documento?: Pick<DocumentoParaAcciones, 'id' | 'estado' | 'actualizadoEn'>;
}) {
  const router = useRouter();
  const idAyuda = useId();
  const vigente = useEnvioVigente(envio);
  const enVivo = useEnVivoStore((s) => (documento ? s.documentos[documento.id] : undefined));
  const estado = documento ? estadoVigente(documento, enVivo) : null;
  const [cargando, setCargando] = useState(false);
  const [aviso, setAviso] = useState<AvisoUi | null>(null);
  const corriendo = useRef(false);

  const motivo = motivoSinConsulta({ estado, envio: vigente });

  function consultar() {
    if (!vigente || corriendo.current) return;
    corriendo.current = true;
    setCargando(true);
    setAviso(null);
    consultarEstado(slug, vigente.id)
      .then((r) => {
        setAviso(avisoConsulta(r));
        router.refresh();
      })
      .catch(() => setAviso({ tono: 'error', ...SIN_CONEXION }))
      .finally(() => {
        corriendo.current = false;
        setCargando(false);
      });
  }

  return (
    <div className={estilos.consulta}>
      <div className={estilos.fila}>
        <Boton
          variante="discreto"
          tamano="sm"
          icono={<RefreshCw {...ICONO} />}
          onClick={consultar}
          disabled={motivo !== null || cargando}
          aria-busy={cargando || undefined}
          aria-describedby={motivo ? idAyuda : undefined}
        >
          {cargando ? 'Consultando al SII…' : 'Consultar estado en el SII'}
        </Boton>
        {motivo ? (
          <p id={idAyuda} className={estilos.nota}>
            {textoSinConsulta(motivo)}
          </p>
        ) : null}
      </div>
      {aviso ? (
        <Alerta tono={aviso.tono} titulo={aviso.titulo}>
          <p>{aviso.detalle}</p>
        </Alerta>
      ) : null}
    </div>
  );
}

/** Descargas y reenvío de una boleta. */
export function AccionesDocumento({
  slug,
  documento,
  puedeReenviar,
}: {
  slug: string;
  documento: DocumentoParaAcciones;
  /** `puede_emitir` del rol (la Server Action lo vuelve a revisar). */
  puedeReenviar: boolean;
}) {
  const router = useRouter();
  const enVivo = useEnVivoStore((s) => s.documentos[documento.id]);
  const estado = estadoVigente(documento, enVivo);
  const [descargando, setDescargando] = useState<ArchivoDocumento | null>(null);
  const [errorDescarga, setErrorDescarga] = useState<MensajeError | null>(null);
  const [reenviando, setReenviando] = useState(false);
  const [reenvio, setReenvio] = useState<{ ok: boolean; mensaje: MensajeError } | null>(null);
  const reenviandoRef = useRef(false);

  function descargar(archivo: ArchivoDocumento) {
    if (descargando) return;
    setErrorDescarga(null);
    setDescargando(archivo);
    // La ventana se abre en el clic (después de un `await` el navegador la bloquearía).
    const ventana = window.open('', '_blank');
    enlaceArchivo(slug, documento.id, archivo)
      .then((r) => {
        if (r.ok) {
          if (ventana) {
            ventana.opener = null;
            ventana.location.href = r.url;
          } else {
            window.location.assign(r.url);
          }
        } else {
          ventana?.close();
          setErrorDescarga(r.mensaje);
        }
      })
      .catch(() => {
        ventana?.close();
        setErrorDescarga({
          titulo: 'No pudimos abrir el archivo',
          detalle: 'Revisa tu conexión y vuelve a intentarlo.',
        });
      })
      .finally(() => setDescargando(null));
  }

  function reenviar() {
    if (reenviandoRef.current) return;
    reenviandoRef.current = true;
    setReenviando(true);
    setReenvio(null);
    reenviarAlReceptor(slug, documento.id)
      .then((r) => {
        setReenvio(r);
        if (r.ok) router.refresh();
      })
      .catch(() => setReenvio({ ok: false, mensaje: SIN_CONEXION }))
      .finally(() => {
        reenviandoRef.current = false;
        setReenviando(false);
      });
  }

  const archivos = ARCHIVOS.filter((a) => (a.pdf ? estado !== 'anulado' : true));
  const reenviable = ESTADOS_REENVIABLES.includes(estado);

  return (
    <div className={estilos.acciones}>
      {documento.conXml ? (
        <div className={estilos.fila}>
          {archivos.map((a) => (
            <Boton
              key={a.archivo}
              tamano="sm"
              icono={<Download {...ICONO} />}
              onClick={() => descargar(a.archivo)}
              disabled={descargando !== null}
              aria-busy={descargando === a.archivo || undefined}
            >
              {descargando === a.archivo ? 'Abriendo…' : `Descargar ${a.texto}`}
            </Boton>
          ))}
        </div>
      ) : null}
      {errorDescarga ? (
        <Alerta tono="error" titulo={errorDescarga.titulo}>
          <p>{errorDescarga.detalle}</p>
        </Alerta>
      ) : null}

      {puedeReenviar && reenviable ? (
        documento.correo ? (
          <div className={estilos.fila}>
            <Boton
              variante="discreto"
              tamano="sm"
              icono={<Mail {...ICONO} />}
              onClick={reenviar}
              disabled={reenviando}
              aria-busy={reenviando || undefined}
            >
              {reenviando ? 'Reenviando…' : 'Reenviar al receptor'}
            </Boton>
            <span className={estilos.nota}>{documento.correo}</span>
          </div>
        ) : (
          <p className={estilos.nota}>
            La boleta se emitió sin correo del receptor, así que no hay a quién reenviarla.
          </p>
        )
      ) : null}
      {reenvio ? (
        <Alerta tono={reenvio.ok ? 'exito' : 'error'} titulo={reenvio.mensaje.titulo}>
          <p>{reenvio.mensaje.detalle}</p>
        </Alerta>
      ) : null}
    </div>
  );
}
