'use client';

import Link from 'next/link';
import { type ReactNode, useId, useState, useTransition } from 'react';
import {
  Alerta,
  Boton,
  Campo,
  clasesBoton,
  Dialogo,
  Input,
  MedidorFolios,
  Tarjeta,
} from '@/components/boleteame';
import {
  ETIQUETA_ETAPA,
  type EtapaCertificacion,
  type NumeroPaso,
  PASOS,
  pasoDeEtapa,
  type ResultadoPaso,
  type ResumenEnsayo,
} from '@/lib/certificacion';
import { formatearFecha, formatearFechaHora, formatearMiles, formatearRut } from '@/lib/formatos';
// Solo tipos (se borran al compilar): no arrastran `server-only` al bundle.
import type { VistaAsistente } from '@/server/certificacion';
import type { MensajeError } from '@/server/equipo-errores';
import {
  consultarEstadoDeclaracion,
  consultarEstadoSet,
  declarar,
  descargarSet,
  enviarSet,
  marcarRevisada,
  postular,
  solicitarFolios,
  solicitarRevision,
} from './acciones';
import estilos from './certificacion.module.css';
import { EnVivo } from './EnVivo';
import { FormularioDeclaracion, FormularioPostulacion } from './Formularios';
import {
  type AccionAsistente,
  type AccionDisponible,
  type AccionSii,
  type ConsultaSii,
  comoRevisar,
  declaracionCompleta,
  esAccionSii,
  foliosNecesarios,
  inciertasSinRevisar,
  nombreOperacion,
  operacionEnCurso,
  type PlanPaso,
  pasosCompletos,
  planAsistente,
  postulacionCompleta,
  textoEnCurso,
} from './logica';
import {
  AvisosPostulacion,
  ContenidoEnsayo,
  Datos,
  DatosEnvio,
  DatosPostulacion,
  EstadoSii,
  IconoPaso,
  ListaOperaciones,
  TablaCasos,
} from './Piezas';

export interface AsistenteProps {
  slug: string;
  /** Propietario o administrador: ve y usa las acciones. */
  admin: boolean;
  vista: VistaAsistente;
  /** Días hasta que vence el certificado predeterminado (calculado en el servidor). */
  diasCertificado: number | null;
}

type Aviso =
  | { tono: 'exito'; titulo: string; detalle?: string; avisos?: string[] }
  | { tono: 'error'; mensaje: MensajeError; operacionPendienteId?: string };

type Ejecutable = AccionSii | ConsultaSii;

const DESCRIPCION_PASO: Readonly<Record<NumeroPaso, string>> = {
  1: 'Datos de la empresa y del software, y postulación a boleta electrónica en el SII.',
  2: 'El SII prepara un set de casos de prueba para la empresa.',
  3: 'Folios de certificación y envío de las boletas del set al SII.',
  4: 'El SII revisa el set aceptado y deja la empresa lista para declarar (P90).',
  5: 'Declaración de cumplimiento de requisitos: la empresa queda autorizada en producción (P91).',
};

function etiquetaAccion(accion: Ejecutable, reenvio: boolean): string {
  switch (accion) {
    case 'postular':
      return 'Postular en el SII';
    case 'descargarSet':
      return 'Descargar el set de pruebas';
    case 'solicitarFolios':
      return 'Solicitar folios de certificación';
    case 'enviarSet':
      return reenvio ? 'Volver a enviar el set' : 'Enviar el set al SII';
    case 'consultarEstadoSet':
      return 'Consultar el estado del envío';
    case 'solicitarRevision':
      return 'Solicitar revisión';
    case 'consultarEstadoDeclaracion':
      return 'Consultar el estado en el SII';
    case 'declarar':
      return 'Declarar cumplimiento';
  }
}

function esFormulario(accion: AccionAsistente): boolean {
  return accion === 'guardarPostulacion' || accion === 'guardarDeclaracion';
}

export function Asistente({ slug, admin, vista, diasCertificado }: AsistenteProps) {
  const { empresa, proceso, casos, envioSet, cafSet, certificado, operaciones } = vista;
  const etapa: EtapaCertificacion = empresa.autorizadaProduccion
    ? 'autorizada'
    : (proceso?.etapa ?? 'borrador');
  const enCurso = operacionEnCurso(operaciones);
  const inciertas = inciertasSinRevisar(operaciones);
  const plan = planAsistente({
    etapa,
    admin,
    empresaActiva: empresa.activa,
    autorizadaProduccion: empresa.autorizadaProduccion,
    tieneCertificado: certificado !== null,
    operacionEnCurso: enCurso !== null,
    inciertaSinRevisar: inciertas.length > 0,
    postulacionCompleta: postulacionCompleta(proceso),
    declaracionCompleta: declaracionCompleta(proceso),
    casos: casos.length,
    foliosDisponibles: cafSet?.disponibles ?? null,
    envio: envioSet
      ? { trackId: envioSet.trackId, estado: envioSet.estado, incierto: envioSet.incierto }
      : null,
  });

  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [ensayo, setEnsayo] = useState<{ accion: AccionSii; resumen: ResumenEnsayo } | null>(null);
  const [revisar, setRevisar] = useState<string | null>(null);
  const [folio, setFolio] = useState<{ sugerido: string; valor: string } | null>(null);
  const [correoSet, setCorreoSet] = useState(proceso?.correoProveedorSet ?? '');
  const [erroresCampo, setErroresCampo] = useState<Record<string, string>>({});
  const [activa, setActiva] = useState<Ejecutable | null>(null);
  const [pendiente, iniciar] = useTransition();
  const idFolio = useId();

  function llamar(accion: Ejecutable, confirmada: boolean): Promise<ResultadoPaso> {
    switch (accion) {
      case 'postular':
        return postular(slug, empresa.id, confirmada);
      case 'descargarSet':
        return descargarSet(slug, empresa.id, confirmada, correoSet.trim() || undefined);
      case 'solicitarFolios': {
        const valor = folio?.valor.trim();
        return solicitarFolios(slug, empresa.id, confirmada, valor ? Number(valor) : undefined);
      }
      case 'enviarSet':
        return enviarSet(slug, empresa.id, confirmada);
      case 'solicitarRevision':
        return solicitarRevision(slug, empresa.id, confirmada);
      case 'declarar':
        return declarar(slug, empresa.id, confirmada);
      case 'consultarEstadoSet':
        return consultarEstadoSet(slug, empresa.id);
      case 'consultarEstadoDeclaracion':
        return consultarEstadoDeclaracion(slug, empresa.id);
    }
  }

  function manejar(r: ResultadoPaso, accion: Ejecutable | null) {
    if (r.tipo === 'ensayo') {
      if (accion && esAccionSii(accion)) setEnsayo({ accion, resumen: r.resumen });
      return;
    }
    setEnsayo(null);
    if (r.tipo === 'ok') {
      setErroresCampo({});
      if (accion === 'solicitarFolios') setFolio(null);
      setAviso({
        tono: 'exito',
        titulo: r.mensaje.titulo,
        detalle: r.mensaje.detalle,
        avisos: r.avisos,
      });
      return;
    }
    setErroresCampo(r.errores ?? {});
    const requerido = r.requiere?.folioInicial;
    if (requerido) {
      setFolio((f) => ({ sugerido: requerido.sugerido, valor: f?.valor || requerido.sugerido }));
    }
    setAviso({ tono: 'error', mensaje: r.mensaje, operacionPendienteId: r.operacionPendienteId });
  }

  /** Primer paso de una acción: el ensayo (⚠️) o la consulta directa (solo lectura). */
  function ejecutar(accion: Ejecutable) {
    setAviso(null);
    setActiva(accion);
    iniciar(async () => {
      try {
        manejar(await llamar(accion, false), accion);
      } finally {
        setActiva(null);
      }
    });
  }

  function confirmar() {
    if (!ensayo) return;
    const { accion } = ensayo;
    setActiva(accion);
    iniciar(async () => {
      try {
        manejar(await llamar(accion, true), accion);
      } finally {
        setActiva(null);
      }
    });
  }

  function confirmarRevisada() {
    const id = revisar;
    if (!id) return;
    iniciar(async () => {
      const r = await marcarRevisada(slug, empresa.id, id);
      setRevisar(null);
      manejar(r, null);
    });
  }

  const reenvio = envioSet !== null && ['rechazado', 'inconsistente'].includes(envioSet.estado);
  const operacionARevisar = revisar ? (operaciones.find((o) => o.id === revisar) ?? null) : null;
  const rutaCertificados = `/${slug}/configuracion/empresas/${empresa.id}/certificados`;
  const autorizada = etapa === 'autorizada';
  const completos = pasosCompletos(etapa);

  function botones(paso: PlanPaso): ReactNode {
    const ejecutables = paso.acciones.filter(
      (a): a is AccionDisponible & { accion: Ejecutable } => !esFormulario(a.accion),
    );
    if (ejecutables.length === 0) return null;
    // Una sola acción primaria: la primera ⚠️ habilitada (o la primera consulta).
    const primaria =
      ejecutables.find((a) => a.habilitada && esAccionSii(a.accion)) ??
      ejecutables.find((a) => a.habilitada);
    const motivos = [...new Set(ejecutables.flatMap((a) => (a.motivo ? [a.motivo] : [])))];
    const idMotivo = `motivo-paso-${paso.numero}`;
    return (
      <div className={estilos.bloque}>
        <div className={estilos.acciones}>
          {ejecutables.map((a) => {
            const enMarcha = pendiente && activa === a.accion && !ensayo;
            return (
              <Boton
                key={a.accion}
                variante={a === primaria ? 'primario' : 'secundario'}
                disabled={!a.habilitada || pendiente}
                aria-describedby={!a.habilitada && motivos.length > 0 ? idMotivo : undefined}
                onClick={() => ejecutar(a.accion)}
              >
                {enMarcha
                  ? esAccionSii(a.accion)
                    ? 'Preparando el resumen…'
                    : 'Consultando al SII…'
                  : etiquetaAccion(a.accion, reenvio)}
              </Boton>
            );
          })}
        </div>
        {motivos.length > 0 ? (
          <p id={idMotivo} className={estilos.nota}>
            {motivos.join(' ')}
          </p>
        ) : null}
      </div>
    );
  }

  function fechaCompleto(numero: NumeroPaso): string | null {
    const fecha =
      numero === 1
        ? proceso?.postuladaEn
        : numero === 2
          ? proceso?.setDescargadoEn
          : numero === 3
            ? envioSet?.ultimaConsultaEn
            : numero === 4
              ? proceso?.estadoConsultadoEn
              : proceso?.declaradaEn;
    return fecha ? formatearFecha(fecha) : null;
  }

  function contenido(paso: PlanPaso): ReactNode {
    const enCursoPaso = paso.estado === 'en_curso';
    const puedeFormulario = paso.acciones.some((a) => esFormulario(a.accion) && a.habilitada);
    switch (paso.numero) {
      case 1:
        return (
          <>
            {proceso ? <AvisosPostulacion avisos={proceso.avisosPostulacion ?? []} /> : null}
            {enCursoPaso && admin ? (
              <FormularioPostulacion
                slug={slug}
                empresaId={empresa.id}
                proceso={proceso}
                rutSugerido={certificado?.rut ?? null}
                habilitado={puedeFormulario}
              />
            ) : proceso && paso.estado !== 'pendiente' ? (
              <details className={estilos.detalle} open={enCursoPaso}>
                <summary>Datos de la postulación</summary>
                <DatosPostulacion proceso={proceso} />
              </details>
            ) : null}
            {enCursoPaso ? botones(paso) : null}
          </>
        );
      case 2:
        return enCursoPaso ? (
          <>
            {admin ? (
              <Campo
                etiqueta="Correo del proveedor de software (opcional)"
                ayuda="El SII asocia el set de pruebas a este correo. Déjalo en blanco para usar el que ya está registrado."
                error={erroresCampo.correoProveedorSet}
              >
                <Input
                  type="email"
                  maxLength={50}
                  value={correoSet}
                  onChange={(e) => setCorreoSet(e.target.value)}
                  disabled={pendiente}
                />
              </Campo>
            ) : null}
            {botones(paso)}
          </>
        ) : paso.estado === 'completo' && casos.length > 0 ? (
          <details className={estilos.detalle}>
            <summary>Ver los {casos.length} casos del set</summary>
            <TablaCasos casos={casos} />
          </details>
        ) : null;
      case 3:
        if (paso.estado === 'pendiente') return null;
        return (
          <>
            {enCursoPaso ? (
              <>
                <p className={estilos.texto}>
                  {cafSet
                    ? `CAF de certificación activo: folios ${formatearMiles(cafSet.folioDesde)} a ${formatearMiles(cafSet.folioHasta)}, quedan ${formatearMiles(cafSet.disponibles)}. El set necesita ${foliosNecesarios(casos.length)}.`
                    : `Aún no hay folios de certificación. El set necesita ${foliosNecesarios(casos.length)} folios de boleta electrónica (tipo 39).`}
                </p>
                {certificado && !certificado.representante && !cafSet ? (
                  <Alerta
                    tono="aviso"
                    titulo="El titular del certificado no figura como representante electrónico"
                  >
                    El SII solo entrega folios a un representante electrónico de la empresa. Si ya
                    lo registraste en sii.cl, márcalo en{' '}
                    <Link href={rutaCertificados}>los certificados de la empresa</Link>.
                  </Alerta>
                ) : null}
                <details className={estilos.detalle}>
                  <summary>Ver los {casos.length} casos del set</summary>
                  <TablaCasos casos={casos} />
                </details>
              </>
            ) : null}
            {envioSet?.incierto ? (
              <Alerta tono="aviso" titulo="No sabemos si el set llegó al SII">
                El envío salió sin una respuesta clara del SII. No lo vuelvas a enviar: revisa en el
                SII si llegó y, si no, marca la operación como revisada para reintentar.
              </Alerta>
            ) : null}
            {envioSet ? (
              <details className={estilos.detalle} open={enCursoPaso}>
                <summary>Envío del set</summary>
                <DatosEnvio envio={envioSet} />
              </details>
            ) : null}
            {enCursoPaso && admin && folio ? (
              <Campo
                etiqueta="Folio inicial"
                id={idFolio}
                ayuda={`El SII pide indicar desde qué folio timbrar. Sugerido: ${folio.sugerido}.`}
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
            {enCursoPaso ? botones(paso) : null}
          </>
        );
      case 4:
        if (paso.estado === 'pendiente' || !proceso) return null;
        return (
          <>
            {proceso.revisionSolicitadaEn ? (
              <p className={estilos.texto}>
                Revisión solicitada el {formatearFechaHora(proceso.revisionSolicitadaEn)}.
              </p>
            ) : null}
            {enCursoPaso ? <EstadoSii proceso={proceso} /> : null}
            {enCursoPaso ? botones(paso) : null}
          </>
        );
      case 5:
        if (paso.estado === 'pendiente' || !proceso) return null;
        if (paso.estado === 'completo') {
          return (
            <p className={estilos.texto}>
              {proceso.declaradaEn
                ? `Declaraste el cumplimiento el ${formatearFechaHora(proceso.declaradaEn)}.`
                : 'El SII registra a la empresa como autorizada en producción.'}
            </p>
          );
        }
        return (
          <>
            <Alerta tono="aviso" titulo="Declarar deja a la empresa autorizada en producción">
              Desde ese momento {empresa.razonSocial} emite boletas con validez tributaria. Revisa
              los datos con calma: el SII no permite deshacer la declaración desde aquí.
            </Alerta>
            <EstadoSii proceso={proceso} />
            {admin ? (
              <FormularioDeclaracion
                slug={slug}
                empresaId={empresa.id}
                proceso={proceso}
                habilitado={puedeFormulario}
              />
            ) : (
              <details className={estilos.detalle}>
                <summary>Datos de la declaración</summary>
                <Datos
                  filas={[
                    { etiqueta: 'Link de consulta', valor: proceso.linkConsulta ?? '—' },
                    {
                      etiqueta: 'RUT del proveedor',
                      valor: proceso.rutProveedor ? formatearRut(proceso.rutProveedor) : '—',
                      mono: true,
                    },
                    { etiqueta: 'Proveedor', valor: proceso.nombreProveedor ?? '—' },
                    { etiqueta: 'Correo del proveedor', valor: proceso.correoProveedor ?? '—' },
                  ]}
                />
              </details>
            )}
            {botones(paso)}
          </>
        );
    }
  }

  const cerrarAviso = (
    <Boton tamano="sm" variante="discreto" onClick={() => setAviso(null)}>
      Cerrar
    </Boton>
  );

  return (
    <>
      <EnVivo empresaId={empresa.id} />

      <div className={estilos.progreso}>
        <p className={estilos.nota}>
          {empresa.razonSocial} · <span className={estilos.mono}>{formatearRut(empresa.rut)}</span>
          {proceso?.creadoEn ? ` · Iniciada el ${formatearFecha(proceso.creadoEn)}` : ''}
          {' · '}
          {autorizada
            ? ETIQUETA_ETAPA.autorizada
            : `Paso ${pasoDeEtapa(etapa)} de ${PASOS.length}: ${ETIQUETA_ETAPA[etapa]}`}
        </p>
        {/* biome-ignore lint/a11y/useSemanticElements: mismo medidor que la plantilla y MedidorFolios */}
        <div
          className={estilos.medidor}
          role="meter"
          aria-label={`Pasos completados: ${completos} de ${PASOS.length}`}
          aria-valuemin={0}
          aria-valuemax={PASOS.length}
          aria-valuenow={completos}
        >
          <div
            className={estilos.medidorUso}
            style={{ width: `${(completos / PASOS.length) * 100}%` }}
          />
        </div>
      </div>

      {/* Estado en vivo: la operación en curso (desde operaciones_sii) y el resultado. */}
      <div aria-live="polite" className={estilos.avisos}>
        {enCurso ? (
          <Alerta tono="info" titulo={textoEnCurso(enCurso.operacion, enCurso.iniciadaEn)}>
            La página se actualiza sola cuando el SII responda.
          </Alerta>
        ) : null}
        {aviso?.tono === 'exito' ? (
          <Alerta tono="exito" titulo={aviso.titulo} accion={cerrarAviso}>
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
              admin && aviso.operacionPendienteId ? (
                <Boton
                  tamano="sm"
                  onClick={() => setRevisar(aviso.operacionPendienteId ?? null)}
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
        {autorizada ? (
          <Alerta
            tono="exito"
            titulo="La empresa está autorizada para emitir boletas en producción"
          >
            El SII registró la declaración de cumplimiento (P91). Ya puedes pedir folios de
            producción y emitir boletas electrónicas con validez tributaria.
          </Alerta>
        ) : null}
        {!autorizada && !empresa.activa ? (
          <Alerta tono="aviso" titulo="La empresa está desactivada">
            Actívala en{' '}
            <Link href={`/${slug}/configuracion/empresas/${empresa.id}`}>Configuración</Link> para
            continuar con la certificación.
          </Alerta>
        ) : null}
        {!autorizada && !certificado ? (
          <Alerta tono="aviso" titulo="La empresa no tiene certificado predeterminado">
            <p>
              Cada paso inicia sesión en el SII con el certificado digital predeterminado de la
              empresa.{' '}
              {admin
                ? 'Elige uno en Configuración y vuelve aquí.'
                : 'Pide a un administrador que elija uno.'}
            </p>
            <p className={estilos.accionAlerta}>
              <Link href={rutaCertificados} className={clasesBoton('secundario', 'sm')}>
                {admin ? 'Elegir certificado' : 'Ver certificados'}
              </Link>
            </p>
          </Alerta>
        ) : null}
        {inciertas.map((o) => (
          <Alerta
            key={o.id}
            tono="aviso"
            titulo={`${nombreOperacion(o.operacion)}: por verificar`}
            accion={
              admin ? (
                <Boton tamano="sm" onClick={() => setRevisar(o.id)} disabled={pendiente}>
                  Marcar como revisada
                </Boton>
              ) : null
            }
          >
            No sabemos si la operación del {formatearFechaHora(o.iniciadaEn)} llegó al SII. No la
            repitas sin revisar: {comoRevisar(o.operacion)}
          </Alerta>
        ))}
        {!admin ? (
          <Alerta
            tono="info"
            titulo="Solo un propietario o un administrador avanza la certificación"
          >
            Aquí ves el estado de cada paso, que se actualiza en vivo.
          </Alerta>
        ) : null}
      </div>

      <div className={estilos.cuerpo}>
        <Tarjeta as="ol" relleno="ninguno" className={estilos.pasos} aria-label="Pasos">
          {plan.map((paso) => {
            const fecha = paso.estado === 'completo' ? fechaCompleto(paso.numero) : null;
            return (
              <li
                key={paso.numero}
                className={[estilos.paso, estilos[`paso_${paso.estado}`]].filter(Boolean).join(' ')}
                aria-current={paso.estado === 'en_curso' ? 'step' : undefined}
              >
                <IconoPaso estado={paso.estado} />
                <div className={estilos.pasoCuerpo}>
                  <div className={estilos.pasoCabecera}>
                    <h2 className={estilos.pasoTitulo}>
                      {paso.numero}. {paso.titulo}
                    </h2>
                    <p className={estilos.pasoEstado}>
                      {paso.estado === 'completo'
                        ? `Completado${fecha ? ` el ${fecha}` : ''}`
                        : paso.estado === 'en_curso'
                          ? 'En curso'
                          : 'Pendiente'}
                    </p>
                  </div>
                  {paso.estado === 'pendiente' ? (
                    <p className={estilos.nota}>{DESCRIPCION_PASO[paso.numero]}</p>
                  ) : null}
                  {paso.falta ? <p className={estilos.texto}>{paso.falta}</p> : null}
                  {contenido(paso)}
                </div>
              </li>
            );
          })}
        </Tarjeta>

        <aside className={estilos.lateral} aria-label="Datos de la certificación">
          <Tarjeta aria-labelledby="t-cert" className={estilos.seccionLateral}>
            <h2 id="t-cert" className={estilos.subtitulo}>
              Certificado digital
            </h2>
            {certificado ? (
              <Datos
                filas={[
                  { etiqueta: 'Titular', valor: certificado.titular },
                  { etiqueta: 'RUT', valor: formatearRut(certificado.rut), mono: true },
                  {
                    etiqueta: 'Vence',
                    valor: (
                      <span
                        className={
                          diasCertificado !== null && diasCertificado <= 30
                            ? estilos.vencePronto
                            : undefined
                        }
                      >
                        {formatearFecha(certificado.vigenteHasta)}
                        {diasCertificado !== null && diasCertificado >= 0 && diasCertificado <= 30
                          ? `, en ${diasCertificado} ${diasCertificado === 1 ? 'día' : 'días'}`
                          : ''}
                        {diasCertificado !== null && diasCertificado < 0 ? ', vencido' : ''}
                      </span>
                    ),
                  },
                  {
                    etiqueta: 'Representante electrónico',
                    valor: certificado.representante ? 'Sí' : 'No',
                  },
                ]}
              />
            ) : (
              <p className={estilos.nota}>La empresa no tiene certificado predeterminado.</p>
            )}
            {admin ? (
              <Link href={rutaCertificados} className={clasesBoton('secundario', 'sm')}>
                {certificado ? 'Cambiar certificado' : 'Elegir certificado'}
              </Link>
            ) : null}
          </Tarjeta>

          <section aria-labelledby="t-caf" className={estilos.seccionLateral}>
            <h2 id="t-caf" className={estilos.subtitulo}>
              Folios de certificación
            </h2>
            {cafSet ? (
              <MedidorFolios
                codigo={39}
                desde={cafSet.folioDesde}
                hasta={cafSet.folioHasta}
                siguiente={cafSet.siguienteFolio}
              />
            ) : (
              <p className={estilos.nota}>
                Aún no hay folios de certificación. Se piden en el paso 3.
              </p>
            )}
            <p className={estilos.nota}>
              {vista.resolucionCertificacion
                ? `Resolución de certificación n.º ${vista.resolucionCertificacion.numero} del ${formatearFecha(vista.resolucionCertificacion.fecha)}.`
                : 'La resolución de certificación se registra al postular.'}
            </p>
          </section>

          <Tarjeta aria-labelledby="t-ops" variante="tenue" className={estilos.seccionLateral}>
            <h2 id="t-ops" className={estilos.subtitulo}>
              Últimas operaciones
            </h2>
            <ListaOperaciones
              operaciones={operaciones}
              admin={admin}
              alRevisar={setRevisar}
              deshabilitado={pendiente}
            />
          </Tarjeta>
        </aside>
      </div>

      <Dialogo
        abierto={ensayo !== null}
        onCerrar={() => setEnsayo(null)}
        onConfirmar={confirmar}
        cargando={pendiente}
        variante={
          ensayo?.accion === 'declarar' || ensayo?.accion === 'enviarSet' ? 'peligro' : 'primario'
        }
        titulo={ensayo?.resumen.titulo ?? ''}
        textoConfirmar={pendiente ? 'Enviando al SII…' : (ensayo?.resumen.textoConfirmar ?? '')}
      >
        {ensayo ? (
          <ContenidoEnsayo
            resumen={ensayo.resumen}
            razonSocial={empresa.razonSocial}
            enviando={pendiente}
          />
        ) : null}
      </Dialogo>

      <Dialogo
        abierto={revisar !== null}
        onCerrar={() => setRevisar(null)}
        onConfirmar={confirmarRevisada}
        cargando={pendiente}
        titulo="Marcar la operación como revisada"
        textoConfirmar="Ya revisé en el SII"
      >
        <p>
          Hazlo solo después de comprobar en el SII qué pasó con la operación
          {operacionARevisar
            ? ` «${nombreOperacion(operacionARevisar.operacion)}» del ${formatearFechaHora(operacionARevisar.iniciadaEn)}`
            : ''}
          . Al marcarla, el asistente vuelve a permitir repetirla: si ya se había completado en el
          SII, quedaría hecha dos veces.
        </p>
        <p>
          {operacionARevisar
            ? comoRevisar(operacionARevisar.operacion)
            : 'Revisa en el SII si la operación se completó antes de repetirla.'}
        </p>
      </Dialogo>
    </>
  );
}
