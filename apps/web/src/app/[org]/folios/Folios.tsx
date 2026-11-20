'use client';

import Link from 'next/link';
import {
  type ReactNode,
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  Alerta,
  Boton,
  Campo,
  Dialogo,
  Glifo,
  Input,
  MedidorFolios,
  Select,
  Tabla,
  TablaVacia,
  Tarjeta,
  Td,
  Th,
  TipoDTE,
} from '@/components/boleteame';
import type { MensajeError } from '@/lib/equipo-errores';
import {
  AMBIENTES_FOLIO,
  type AmbienteSii,
  ETIQUETA_AMBIENTE,
  ETIQUETA_ESTADO_CAF,
  ETIQUETA_ESTADO_SOLICITUD,
  enAmbiente,
  enteroDeTexto,
  esquemaCantidad,
  LARGO_MAXIMO_MOTIVO,
  nombreTipoFolio,
  type ResultadoFolios,
  type ResumenSolicitud,
  type RevisionFolios,
  revisionCalza,
  TIPOS_FOLIO,
  type TipoFolio,
  textoRango,
  tieneCola,
  validarRangoAnulacion,
} from '@/lib/folios';
import { formatearFecha, formatearFechaHora, formatearMiles, formatearRut } from '@/lib/formatos';
// Solo tipos (se borran al compilar): no arrastran `server-only` al bundle.
import type { FilaCaf, ResumenTipo, VistaFolios } from '@/server/folios';
import { anularFolios, marcarRevisada, solicitarFolios, subirCaf } from './acciones';
import { EnVivo } from './EnVivo';
import estilos from './folios.module.css';
import {
  bloqueoSolicitud,
  enCurso,
  type InciertaFolios,
  inciertaSinRevisar,
  rangoIncierta,
  TONO_CAF,
  TONO_SOLICITUD,
  type TonoEstado,
} from './logica';

// Vista de folios de una empresa (PLAN-SAAS Fase 6): resumen por tipo y ambiente,
// solicitud (ensayo → revisión con el SII → timbraje), carga de un CAF existente,
// anulación y los historiales. Los lectores y emisores ven; las acciones son de
// administradores. Se actualiza sola por Realtime (`EnVivo`).

export interface FoliosProps {
  slug: string;
  admin: boolean;
  vista: VistaFolios;
  /** Para filtrar por Realtime los folios anulados (no tienen empresa_id). */
  organizacionId: string;
}

type Aviso =
  | { tono: 'exito' | 'info' | 'aviso'; titulo: string; detalle?: string; avisos?: string[] }
  | { tono: 'error'; mensaje: MensajeError; operacionPendienteId?: string };

interface Anulacion {
  caf: FilaCaf;
  /** `asignados`: rango bajo el siguiente folio; `cola`: los que quedan (rango fijo). */
  modo: 'asignados' | 'cola';
  desde: string;
  hasta: string;
  motivo: string;
  error?: string;
}

const CLASE_TONO: Readonly<Record<TonoEstado, string | undefined>> = {
  exito: estilos.tonoExito,
  info: estilos.tonoInfo,
  aviso: estilos.tonoAviso,
  error: estilos.tonoError,
};

const GLIFO_TONO = {
  exito: 'aceptado',
  info: 'enviado',
  aviso: 'reparos',
  error: 'rechazado',
} as const;

function Insignia({ tono, children }: { tono: TonoEstado; children: ReactNode }) {
  return (
    <span className={[estilos.insignia, CLASE_TONO[tono]].filter(Boolean).join(' ')}>
      <Glifo nombre={GLIFO_TONO[tono]} size={14} />
      <span>{children}</span>
    </span>
  );
}

function Datos({ filas }: { filas: { etiqueta: string; valor: ReactNode }[] }) {
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

function TarjetaTipo({ r }: { r: ResumenTipo }) {
  if (r.enUso) {
    return (
      <div className={estilos.tipo}>
        <MedidorFolios
          codigo={r.tipoDte}
          desde={r.enUso.desde}
          hasta={r.enUso.hasta}
          siguiente={r.enUso.siguiente}
        />
        {r.disponibles !== r.enUso.hasta - r.enUso.siguiente + 1 ? (
          <p className={estilos.nota}>
            En total quedan {formatearMiles(r.disponibles)} folios sumando los CAF que vienen
            después.
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <div className={estilos.tipo}>
      <div className={estilos.tipoCabecera}>
        <TipoDTE codigo={r.tipoDte} corto />
        <span className={estilos.cifra}>
          <strong>0</strong> disponibles
        </span>
      </div>
      <p className={r.tuvoCaf ? estilos.agotado : estilos.nota}>
        {r.tuvoCaf
          ? 'CAF agotado: no se pueden emitir documentos de este tipo hasta que pidas o subas un CAF nuevo.'
          : 'Aún no hay folios de este tipo.'}
      </p>
    </div>
  );
}

function ContenidoEnsayo({
  resumen,
  revision,
  mensajeRevision,
}: {
  resumen: ResumenSolicitud;
  revision: RevisionFolios | null;
  mensajeRevision: { titulo: string; detalle: string } | null;
}) {
  const calza = revisionCalza(revision, resumen);
  return (
    <div className={estilos.ensayo}>
      {resumen.ambiente === 'produccion' ? (
        <Alerta tono="aviso" titulo="Folios reales">
          En producción los folios quedan autorizados para la empresa ante el SII.
        </Alerta>
      ) : null}
      <Datos
        filas={[
          ...resumen.filas,
          {
            etiqueta: 'Certificado',
            valor: `${resumen.certificado.titular} (${formatearRut(resumen.certificado.rut)}), vence el ${formatearFecha(resumen.certificado.vigenteHasta)}`,
          },
        ]}
      />
      <ul className={estilos.listaAvisos}>
        {resumen.avisos.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
      {calza && mensajeRevision ? (
        <Alerta tono="exito" titulo={mensajeRevision.titulo}>
          {mensajeRevision.detalle}
        </Alerta>
      ) : null}
    </div>
  );
}

export function Folios({ slug, admin, vista, organizacionId }: FoliosProps) {
  const { empresa } = vista;
  const ambientePorDefecto: AmbienteSii = empresa.autorizadaProduccion
    ? 'produccion'
    : 'certificacion';

  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [pendiente, iniciar] = useTransition();
  const [enMarcha, setEnMarcha] = useState<'ensayo' | 'revision' | 'timbrar' | null>(null);

  // Solicitud.
  const [tipo, setTipo] = useState<TipoFolio>(39);
  const [ambiente, setAmbiente] = useState<AmbienteSii>(ambientePorDefecto);
  const [cantidad, setCantidad] = useState('');
  const [folio, setFolio] = useState<{ sugerido: string; valor: string } | null>(null);
  const [erroresCampo, setErroresCampo] = useState<Record<string, string>>({});
  const [ensayo, setEnsayo] = useState<ResumenSolicitud | null>(null);
  const [revision, setRevision] = useState<RevisionFolios | null>(null);
  const [mensajeRevision, setMensajeRevision] = useState<{
    titulo: string;
    detalle: string;
  } | null>(null);

  // Anulación y revisión de inciertas.
  const [anulacion, setAnulacion] = useState<Anulacion | null>(null);
  const [revisar, setRevisar] = useState<InciertaFolios | null>(null);

  // Carga de un CAF.
  const subirEnEmpresa = useMemo(() => subirCaf.bind(null, slug, empresa.id), [slug, empresa.id]);
  const [estadoSubida, despacharSubida, subiendo] = useActionState<
    ResultadoFolios | null,
    FormData
  >(subirEnEmpresa, null);
  const [ambienteSubida, setAmbienteSubida] = useState<AmbienteSii>(ambientePorDefecto);
  const formularioSubida = useRef<HTMLFormElement>(null);
  const archivoSubida = useRef<HTMLInputElement>(null);
  const idCantidad = useId();
  const idFolio = useId();

  useEffect(() => {
    if (estadoSubida?.tipo === 'ok') formularioSubida.current?.reset();
  }, [estadoSubida]);

  const ahora = new Date();
  const inciertas = AMBIENTES_FOLIO.flatMap((a) => {
    const i = inciertaSinRevisar(vista, a, ahora);
    return i ? [i] : [];
  });
  const enCursoAhora = AMBIENTES_FOLIO.flatMap((a) => {
    const o = enCurso(vista.operaciones, a, ahora);
    return o ? [o] : [];
  });
  const bloqueo = bloqueoSolicitud(vista, ambiente, ahora);

  function datosSolicitud() {
    return {
      tipoDte: tipo,
      ambiente,
      cantidad: enteroDeTexto(cantidad),
      ...(folio?.valor.trim() ? { folioInicial: enteroDeTexto(folio.valor) } : {}),
    };
  }

  function manejarError(r: Extract<ResultadoFolios, { tipo: 'error' }>) {
    setErroresCampo(r.errores ?? {});
    const requerido = r.requiere?.folioInicial;
    if (requerido) {
      setFolio((f) => ({ sugerido: requerido.sugerido, valor: f?.valor || requerido.sugerido }));
    }
    setAviso({ tono: 'error', mensaje: r.mensaje, operacionPendienteId: r.operacionPendienteId });
  }

  function cerrarSolicitud() {
    setEnsayo(null);
    setRevision(null);
    setMensajeRevision(null);
  }

  function preparar() {
    const n = enteroDeTexto(cantidad);
    const v = esquemaCantidad.safeParse(n);
    if (!v.success) {
      setErroresCampo({ cantidad: v.error.issues[0]?.message ?? 'Revisa la cantidad.' });
      return;
    }
    setAviso(null);
    setErroresCampo({});
    setEnMarcha('ensayo');
    iniciar(async () => {
      try {
        const r = await solicitarFolios(slug, empresa.id, { nivel: 'ensayo', ...datosSolicitud() });
        if (r.tipo === 'ensayo') {
          setRevision(null);
          setMensajeRevision(null);
          setEnsayo(r.resumen);
        } else if (r.tipo === 'error') manejarError(r);
      } finally {
        setEnMarcha(null);
      }
    });
  }

  function entradaDelEnsayo(resumen: ResumenSolicitud) {
    return {
      tipoDte: resumen.tipoDte,
      ambiente: resumen.ambiente,
      cantidad: resumen.cantidad,
      ...(resumen.folioInicial !== null ? { folioInicial: resumen.folioInicial } : {}),
    };
  }

  function revisarConSii() {
    if (!ensayo) return;
    const resumen = ensayo;
    setEnMarcha('revision');
    iniciar(async () => {
      try {
        const r = await solicitarFolios(slug, empresa.id, {
          nivel: 'revision',
          ...entradaDelEnsayo(resumen),
        });
        if (r.tipo === 'revision') {
          setRevision(r.revision);
          setMensajeRevision(r.mensaje);
        } else if (r.tipo === 'error') {
          cerrarSolicitud();
          manejarError(r);
        }
      } finally {
        setEnMarcha(null);
      }
    });
  }

  function timbrar() {
    if (!ensayo) return;
    const resumen = ensayo;
    const rev = revisionCalza(revision, resumen) ? revision : null;
    if (resumen.revisionObligatoria && !rev) return;
    setEnMarcha('timbrar');
    iniciar(async () => {
      try {
        const r = await solicitarFolios(slug, empresa.id, {
          nivel: 'timbrar',
          ...entradaDelEnsayo(resumen),
          ...(rev ? { revisionId: rev.revisionId } : {}),
        });
        cerrarSolicitud();
        if (r.tipo === 'ok') {
          setCantidad('');
          setFolio(null);
          setErroresCampo({});
          setAviso({
            tono: 'exito',
            titulo: r.mensaje.titulo,
            detalle: r.mensaje.detalle,
            avisos: r.avisos,
          });
        } else if (r.tipo === 'error') manejarError(r);
      } finally {
        setEnMarcha(null);
      }
    });
  }

  function abrirAnulacion(caf: FilaCaf, modo: Anulacion['modo']) {
    setAviso(null);
    setAnulacion({
      caf,
      modo,
      desde: modo === 'cola' ? String(caf.siguiente) : '',
      hasta: modo === 'cola' ? String(caf.hasta) : '',
      motivo: '',
    });
  }

  function confirmarAnulacion() {
    if (!anulacion) return;
    const desde = enteroDeTexto(anulacion.desde);
    const hasta = enteroDeTexto(anulacion.hasta);
    if (desde === undefined || hasta === undefined) {
      setAnulacion({ ...anulacion, error: 'Escribe el primer y el último folio.' });
      return;
    }
    const problema = validarRangoAnulacion(anulacion.caf, desde, hasta);
    if (problema) {
      setAnulacion({ ...anulacion, error: problema });
      return;
    }
    if (anulacion.motivo.trim() === '') {
      setAnulacion({ ...anulacion, error: 'Escribe por qué anulas estos folios.' });
      return;
    }
    const entrada = { cafId: anulacion.caf.id, desde, hasta, motivo: anulacion.motivo };
    iniciar(async () => {
      const r = await anularFolios(slug, empresa.id, entrada);
      setAnulacion(null);
      if (r.tipo === 'ok') {
        setAviso({ tono: r.tono ?? 'exito', titulo: r.mensaje.titulo, detalle: r.mensaje.detalle });
      } else if (r.tipo === 'error') {
        setAviso({ tono: 'error', mensaje: r.mensaje });
      }
    });
  }

  function confirmarRevisada() {
    const id = revisar?.operacion.id;
    if (!id) return;
    iniciar(async () => {
      const r = await marcarRevisada(slug, empresa.id, id);
      setRevisar(null);
      if (r.tipo === 'ok')
        setAviso({ tono: 'exito', titulo: r.mensaje.titulo, detalle: r.mensaje.detalle });
      else if (r.tipo === 'error') setAviso({ tono: 'error', mensaje: r.mensaje });
    });
  }

  function irASubir(a: AmbienteSii) {
    setAmbienteSubida(a);
    formularioSubida.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    archivoSubida.current?.focus();
  }

  const calza = revisionCalza(revision, ensayo);
  const puedeTimbrar = ensayo !== null && (!ensayo.revisionObligatoria || calza);
  const textoConfirmar = !ensayo
    ? ''
    : enMarcha === 'revision'
      ? 'Revisando con el SII…'
      : enMarcha === 'timbrar'
        ? 'Timbrando en el SII…'
        : puedeTimbrar
          ? `Timbrar ${formatearMiles(ensayo.cantidad)} folios`
          : 'Revisar con el SII';

  const cerrarAviso = (
    <Boton tamano="sm" variante="discreto" onClick={() => setAviso(null)}>
      Cerrar
    </Boton>
  );
  const pendienteRevisar =
    aviso?.tono === 'error' && aviso.operacionPendienteId
      ? (inciertas.find((i) => i.operacion.id === aviso.operacionPendienteId) ?? null)
      : null;

  return (
    <>
      <EnVivo empresaId={empresa.id} organizacionId={organizacionId} />

      <p className={estilos.nota}>
        {empresa.razonSocial} · <span className={estilos.mono}>{formatearRut(empresa.rut)}</span>
        {empresa.autorizadaProduccion
          ? ' · Autorizada en producción'
          : ' · Sin autorización de producción'}
      </p>

      <div aria-live="polite" className={estilos.avisos}>
        {enCursoAhora.map((o) => (
          <Alerta
            key={o.id}
            tono="info"
            titulo={`Solicitud de folios en curso ${enAmbiente(o.ambiente)} desde ${formatearFechaHora(o.iniciadaEn)}`}
          >
            La página se actualiza sola cuando el SII responda.
          </Alerta>
        ))}
        {aviso && aviso.tono !== 'error' ? (
          <Alerta tono={aviso.tono} titulo={aviso.titulo} accion={cerrarAviso}>
            {aviso.detalle ? <p>{aviso.detalle}</p> : null}
            {aviso.avisos && aviso.avisos.length > 0 ? (
              <ul className={estilos.listaAvisos}>
                {aviso.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            ) : null}
          </Alerta>
        ) : null}
        {aviso?.tono === 'error' ? (
          <Alerta
            tono="error"
            titulo={aviso.mensaje.titulo}
            accion={
              admin && pendienteRevisar ? (
                <Boton
                  tamano="sm"
                  onClick={() => setRevisar(pendienteRevisar)}
                  disabled={pendiente}
                >
                  Marcar como revisada
                </Boton>
              ) : (
                cerrarAviso
              )
            }
          >
            {aviso.mensaje.detalle}
          </Alerta>
        ) : null}
      </div>

      <div className={estilos.avisos}>
        {inciertas.map((i) => {
          const rango = rangoIncierta(i);
          return (
            <Alerta
              key={i.operacion.id}
              tono="aviso"
              titulo={`Solicitud de folios por verificar ${enAmbiente(i.operacion.ambiente)}`}
              accion={
                admin ? (
                  <Boton tamano="sm" onClick={() => setRevisar(i)} disabled={pendiente}>
                    Marcar como revisada
                  </Boton>
                ) : null
              }
            >
              <p>
                La solicitud del {formatearFechaHora(i.operacion.iniciadaEn)}
                {i.solicitud
                  ? ` (${formatearMiles(i.solicitud.cantidad)} folios de ${nombreTipoFolio(i.solicitud.tipoDte)})`
                  : ''}{' '}
                pudo haberse timbrado
                {rango ? `: el SII iba a asignar los folios ${rango}` : ''}. No vuelvas a pedir
                folios
                {` ${enAmbiente(i.operacion.ambiente)}`} hasta revisarlo.
              </p>
              {i.operacion.traslape ? (
                // El CAF timbrado choca con uno ya cargado: subirlo también fallaría.
                <p>
                  Los folios sí se timbraron, pero chocan con el CAF
                  {i.operacion.traslape.desde !== undefined &&
                  i.operacion.traslape.hasta !== undefined
                    ? ` de los folios ${textoRango(i.operacion.traslape.desde, i.operacion.traslape.hasta)}`
                    : ''}{' '}
                  que ya estaba cargado, así que no se pudieron guardar y subirlos aquí tampoco
                  funcionaría. Revisa los dos CAF en «Folios ya autorizados» del portal del SII (
                  {i.operacion.ambiente === 'produccion' ? 'palena.sii.cl' : 'maullin.sii.cl'}) y
                  escríbenos a soporte antes de marcarla como revisada.
                </p>
              ) : (
                <p>
                  Entra al portal del SII (
                  {i.operacion.ambiente === 'produccion' ? 'palena.sii.cl' : 'maullin.sii.cl'}) con
                  el certificado de la empresa, abre «Folios ya autorizados», baja el CAF
                  {rango ? ` de los folios ${rango}` : ''} y súbelo aquí: queda resuelta sola. Si el
                  SII no muestra un CAF nuevo, márcala como revisada.
                </p>
              )}
              {admin && !i.operacion.traslape ? (
                <p className={estilos.accionAlerta}>
                  <Boton
                    tamano="sm"
                    variante="secundario"
                    onClick={() => irASubir(i.operacion.ambiente)}
                  >
                    Subir el CAF
                  </Boton>
                </p>
              ) : null}
            </Alerta>
          );
        })}
        {!vista.representante ? (
          <Alerta tono="aviso" titulo="Falta un representante electrónico">
            El SII solo entrega folios a un representante electrónico de la empresa. Asocia su
            certificado y márcalo como representante en{' '}
            <Link href={`/${slug}/configuracion/empresas/${empresa.id}/certificados`}>
              los certificados de la empresa
            </Link>
            .
          </Alerta>
        ) : null}
        {!admin ? (
          <Alerta tono="info" titulo="Solo un propietario o un administrador gestiona los folios">
            Aquí ves los folios disponibles y el historial, que se actualizan en vivo.
          </Alerta>
        ) : null}
      </div>

      <div className={estilos.resumen}>
        {AMBIENTES_FOLIO.map((a) => (
          <Tarjeta key={a} aria-labelledby={`t-${a}`} className={estilos.seccion}>
            <h2 id={`t-${a}`} className={estilos.subtitulo}>
              {ETIQUETA_AMBIENTE[a]}
            </h2>
            <p className={estilos.nota}>
              {a === 'produccion'
                ? empresa.autorizadaProduccion
                  ? 'Folios reales, con validez tributaria.'
                  : 'La empresa aún no está autorizada en producción.'
                : 'Folios de prueba (IDK 100), sin validez tributaria.'}
            </p>
            {vista.resumen
              .filter((r) => r.ambiente === a)
              .map((r) => (
                <TarjetaTipo key={`${a}-${r.tipoDte}`} r={r} />
              ))}
          </Tarjeta>
        ))}
      </div>

      {admin ? (
        <div className={estilos.resumen}>
          <Tarjeta aria-labelledby="t-solicitar" className={estilos.seccion}>
            <h2 id="t-solicitar" className={estilos.subtitulo}>
              Solicitar folios
            </h2>
            <p className={estilos.nota}>
              Primero verás un resumen sin salir al SII. En producción, además, revisas con el SII
              el rango que asignaría antes de timbrar.
            </p>
            <div className={estilos.filaCampos}>
              <Campo etiqueta="Tipo de documento">
                <Select
                  value={tipo}
                  onChange={(e) => setTipo(Number(e.target.value) as TipoFolio)}
                  disabled={pendiente}
                >
                  {TIPOS_FOLIO.map((t) => (
                    <option key={t} value={t}>
                      {nombreTipoFolio(t)}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo etiqueta="Ambiente">
                <Select
                  value={ambiente}
                  onChange={(e) => setAmbiente(e.target.value as AmbienteSii)}
                  disabled={pendiente}
                >
                  {AMBIENTES_FOLIO.map((a) => (
                    <option key={a} value={a}>
                      {ETIQUETA_AMBIENTE[a]}
                    </option>
                  ))}
                </Select>
              </Campo>
              <Campo
                etiqueta="Cantidad"
                id={idCantidad}
                ayuda="Entre 1 y 10.000 folios."
                error={erroresCampo.cantidad}
              >
                <Input
                  mono
                  inputMode="numeric"
                  value={cantidad}
                  onChange={(e) => setCantidad(e.target.value.replace(/[^0-9.]/g, ''))}
                  disabled={pendiente}
                />
              </Campo>
              {folio ? (
                <Campo
                  etiqueta="Folio inicial"
                  id={idFolio}
                  ayuda={`El SII lo pide en el primer timbraje del tipo de documento. Sugerido: ${folio.sugerido}.`}
                  error={erroresCampo.folioInicial}
                >
                  <Input
                    mono
                    inputMode="numeric"
                    value={folio.valor}
                    onChange={(e) =>
                      setFolio({ ...folio, valor: e.target.value.replace(/[^0-9]/g, '') })
                    }
                    disabled={pendiente}
                  />
                </Campo>
              ) : null}
            </div>
            <div className={estilos.acciones}>
              <Boton
                variante="primario"
                onClick={preparar}
                disabled={pendiente || bloqueo !== null}
                aria-describedby={bloqueo ? 'motivo-solicitar' : undefined}
              >
                {enMarcha === 'ensayo' ? 'Preparando el resumen…' : 'Preparar la solicitud'}
              </Boton>
            </div>
            {bloqueo ? (
              <p id="motivo-solicitar" className={estilos.nota}>
                {bloqueo}
              </p>
            ) : null}
          </Tarjeta>

          <Tarjeta aria-labelledby="t-subir" className={estilos.seccion}>
            <h2 id="t-subir" className={estilos.subtitulo}>
              Subir un CAF
            </h2>
            <p className={estilos.nota}>
              Para un CAF que la empresa ya tiene: el que bajaste de «Folios ya autorizados» en el
              portal del SII. No sale nada al SII.
            </p>
            <form
              ref={formularioSubida}
              action={despacharSubida}
              className={estilos.formulario}
              noValidate
            >
              <div className={estilos.filaCampos}>
                <Campo
                  etiqueta="Ambiente del CAF"
                  error={
                    estadoSubida?.tipo === 'error' ? estadoSubida.errores?.ambiente : undefined
                  }
                >
                  <Select
                    name="ambiente"
                    value={ambienteSubida}
                    onChange={(e) => setAmbienteSubida(e.target.value as AmbienteSii)}
                    disabled={subiendo}
                  >
                    {AMBIENTES_FOLIO.map((a) => (
                      <option key={a} value={a}>
                        {ETIQUETA_AMBIENTE[a]} (IDK {a === 'produccion' ? 300 : 100})
                      </option>
                    ))}
                  </Select>
                </Campo>
                <Campo
                  etiqueta="Archivo XML del CAF"
                  ayuda="Hasta 64 KB. Trae la llave para timbrar: no lo compartas."
                  error={estadoSubida?.tipo === 'error' ? estadoSubida.errores?.caf : undefined}
                >
                  <Input
                    ref={archivoSubida}
                    type="file"
                    name="caf"
                    accept=".xml,application/xml,text/xml"
                    disabled={subiendo}
                  />
                </Campo>
              </div>
              <div className={estilos.acciones}>
                <Boton type="submit" disabled={subiendo}>
                  {subiendo ? 'Subiendo…' : 'Subir CAF'}
                </Boton>
              </div>
              {estadoSubida?.tipo === 'ok' ? (
                <Alerta tono={estadoSubida.tono ?? 'exito'} titulo={estadoSubida.mensaje.titulo}>
                  <p>{estadoSubida.mensaje.detalle}</p>
                  {estadoSubida.avisos?.map((a) => (
                    <p key={a}>{a}</p>
                  ))}
                </Alerta>
              ) : null}
              {estadoSubida?.tipo === 'error' ? (
                <Alerta tono="error" titulo={estadoSubida.mensaje.titulo}>
                  {estadoSubida.mensaje.detalle}
                </Alerta>
              ) : null}
            </form>
          </Tarjeta>
        </div>
      ) : null}

      <section aria-labelledby="t-cafs" className={estilos.bloque}>
        <h2 id="t-cafs" className={estilos.subtitulo}>
          Historial de CAF
        </h2>
        <Tabla etiqueta="Historial de CAF">
          <thead>
            <tr>
              <Th>Ambiente</Th>
              <Th>Tipo</Th>
              <Th mono>Folios</Th>
              <Th>Autorizado</Th>
              <Th>Estado</Th>
              <Th num>Siguiente</Th>
              <Th num>Anulados</Th>
              {admin ? <Th>Acciones</Th> : null}
            </tr>
          </thead>
          <tbody>
            {vista.cafs.length === 0 ? (
              <TablaVacia columnas={admin ? 8 : 7}>
                Aún no hay CAF. {admin ? 'Solicita folios o sube un CAF que ya tengas.' : ''}
              </TablaVacia>
            ) : (
              vista.cafs.map((c) => {
                const asignados = c.siguiente > c.desde;
                return (
                  <tr key={c.id}>
                    <Td>{ETIQUETA_AMBIENTE[c.ambiente]}</Td>
                    <Td>
                      <TipoDTE codigo={c.tipoDte} soloCodigo />
                    </Td>
                    <Td mono>{textoRango(c.desde, c.hasta)}</Td>
                    <Td>{formatearFecha(c.fechaAutorizacion)}</Td>
                    <Td>
                      <Insignia tono={TONO_CAF[c.estado]}>{ETIQUETA_ESTADO_CAF[c.estado]}</Insignia>
                    </Td>
                    <Td num mono>
                      {c.siguiente > c.hasta ? '—' : formatearMiles(c.siguiente)}
                    </Td>
                    <Td num mono>
                      {formatearMiles(c.anulados)}
                    </Td>
                    {admin ? (
                      <Td>
                        <div className={estilos.accionesFila}>
                          {asignados ? (
                            <Boton
                              tamano="sm"
                              variante="discreto"
                              onClick={() => abrirAnulacion(c, 'asignados')}
                              disabled={pendiente}
                            >
                              Anular folios
                            </Boton>
                          ) : null}
                          {tieneCola(c) ? (
                            <Boton
                              tamano="sm"
                              variante="discreto"
                              onClick={() => abrirAnulacion(c, 'cola')}
                              disabled={pendiente}
                            >
                              Anular los que quedan
                            </Boton>
                          ) : null}
                        </div>
                      </Td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </Tabla>
      </section>

      <section aria-labelledby="t-solicitudes" className={estilos.bloque}>
        <h2 id="t-solicitudes" className={estilos.subtitulo}>
          Historial de solicitudes
        </h2>
        <Tabla etiqueta="Historial de solicitudes de folios">
          <thead>
            <tr>
              <Th>Fecha</Th>
              <Th>Ambiente</Th>
              <Th>Tipo</Th>
              <Th num>Cantidad</Th>
              <Th mono>Folios</Th>
              <Th>Estado</Th>
              <Th>Quién</Th>
              <Th>Mensaje</Th>
            </tr>
          </thead>
          <tbody>
            {vista.solicitudes.length === 0 ? (
              <TablaVacia columnas={8}>Aún no hay solicitudes de folios.</TablaVacia>
            ) : (
              vista.solicitudes.map((s) => (
                <tr key={s.id}>
                  <Td>{formatearFechaHora(s.creadoEn)}</Td>
                  <Td>{ETIQUETA_AMBIENTE[s.ambiente]}</Td>
                  <Td>
                    <TipoDTE codigo={s.tipoDte} soloCodigo />
                  </Td>
                  <Td num mono>
                    {formatearMiles(s.cantidad)}
                  </Td>
                  <Td mono>
                    {s.desde !== null && s.hasta !== null ? textoRango(s.desde, s.hasta) : '—'}
                  </Td>
                  <Td>
                    <Insignia tono={TONO_SOLICITUD[s.estado]}>
                      {ETIQUETA_ESTADO_SOLICITUD[s.estado]}
                    </Insignia>
                  </Td>
                  <Td>{s.solicitadoPor ?? '—'}</Td>
                  <Td className={estilos.mensaje}>{s.mensaje ?? '—'}</Td>
                </tr>
              ))
            )}
          </tbody>
        </Tabla>
      </section>

      <Dialogo
        abierto={ensayo !== null}
        onCerrar={cerrarSolicitud}
        onConfirmar={puedeTimbrar ? timbrar : revisarConSii}
        cargando={pendiente}
        variante={puedeTimbrar && ensayo?.ambiente === 'produccion' ? 'peligro' : 'primario'}
        titulo={ensayo?.titulo ?? ''}
        textoConfirmar={textoConfirmar}
      >
        {ensayo ? (
          <>
            <ContenidoEnsayo
              resumen={ensayo}
              revision={revision}
              mensajeRevision={mensajeRevision}
            />
            {!ensayo.revisionObligatoria && !calza ? (
              <p>
                <Boton
                  tamano="sm"
                  variante="secundario"
                  onClick={revisarConSii}
                  disabled={pendiente}
                >
                  {enMarcha === 'revision' ? 'Revisando con el SII…' : 'Revisar antes con el SII'}
                </Boton>
              </p>
            ) : null}
          </>
        ) : null}
      </Dialogo>

      <Dialogo
        abierto={anulacion !== null}
        onCerrar={() => setAnulacion(null)}
        onConfirmar={confirmarAnulacion}
        cargando={pendiente}
        variante="peligro"
        titulo={
          anulacion?.modo === 'cola' ? 'Anular los folios que quedan' : 'Anular folios sin usar'
        }
        textoConfirmar={pendiente ? 'Anulando…' : 'Anular folios'}
      >
        {anulacion ? (
          <div className={estilos.formulario}>
            <p>
              CAF de {nombreTipoFolio(anulacion.caf.tipoDte)} {enAmbiente(anulacion.caf.ambiente)},
              folios {textoRango(anulacion.caf.desde, anulacion.caf.hasta)}.{' '}
              {anulacion.modo === 'cola'
                ? `Se anulan los folios ${textoRango(anulacion.caf.siguiente, anulacion.caf.hasta)}, que aún no se asignan, y el CAF queda anulado: ya no se usará para emitir.`
                : `Solo se anulan folios ya asignados que no se usaron (antes del ${formatearMiles(anulacion.caf.siguiente)}). Un folio con documento emitido no se anula.`}
            </p>
            <p>
              Los folios anulados se informan al SII en el resumen diario de boletas y no se pueden
              recuperar.
            </p>
            {anulacion.modo === 'asignados' ? (
              <div className={estilos.filaCampos}>
                <Campo etiqueta="Desde el folio">
                  <Input
                    mono
                    inputMode="numeric"
                    value={anulacion.desde}
                    onChange={(e) =>
                      setAnulacion({
                        ...anulacion,
                        desde: e.target.value.replace(/[^0-9]/g, ''),
                        error: undefined,
                      })
                    }
                  />
                </Campo>
                <Campo etiqueta="Hasta el folio">
                  <Input
                    mono
                    inputMode="numeric"
                    value={anulacion.hasta}
                    onChange={(e) =>
                      setAnulacion({
                        ...anulacion,
                        hasta: e.target.value.replace(/[^0-9]/g, ''),
                        error: undefined,
                      })
                    }
                  />
                </Campo>
              </div>
            ) : null}
            <Campo
              etiqueta="Motivo"
              ayuda={`Obligatorio, hasta ${LARGO_MAXIMO_MOTIVO} caracteres.`}
              anchoCompleto
            >
              <Input
                value={anulacion.motivo}
                maxLength={LARGO_MAXIMO_MOTIVO}
                onChange={(e) =>
                  setAnulacion({ ...anulacion, motivo: e.target.value, error: undefined })
                }
              />
            </Campo>
            {anulacion.error ? (
              <Alerta tono="error" titulo="Revisa la anulación">
                {anulacion.error}
              </Alerta>
            ) : null}
          </div>
        ) : null}
      </Dialogo>

      <Dialogo
        abierto={revisar !== null}
        onCerrar={() => setRevisar(null)}
        onConfirmar={confirmarRevisada}
        cargando={pendiente}
        titulo="Marcar la solicitud como revisada"
        textoConfirmar="Ya revisé en el SII"
      >
        <p>
          Hazlo solo después de revisar «Folios ya autorizados» en el portal del SII. Al marcarla,
          se vuelve a permitir pedir folios {revisar ? enAmbiente(revisar.operacion.ambiente) : ''}:
          si los folios sí se timbraron, quedarían pedidos dos veces.
        </p>
        {revisar?.operacion.traslape ? (
          <p>
            Los folios de esta solicitud chocan con un CAF ya cargado: márcala como revisada solo
            después de aclarar con soporte cuál de los dos CAF es el correcto.
          </p>
        ) : (
          <p>
            Si el SII muestra un CAF nuevo
            {revisar && rangoIncierta(revisar) ? ` (folios ${rangoIncierta(revisar)})` : ''}, es
            mejor bajarlo y subirlo aquí: la solicitud queda resuelta sola.
          </p>
        )}
      </Dialogo>
    </>
  );
}
