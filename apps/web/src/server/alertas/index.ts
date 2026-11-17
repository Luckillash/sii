import 'server-only';
import { createHash } from 'node:crypto';
import {
  correoCertificadoPorVencer,
  correoDocumentosRechazados,
  correoEnvioIncierto,
  type DocumentoRechazado,
} from '@sii/correos';
import {
  formatearFecha,
  formatearFechaHora,
  formatearMonto,
  formatearRut,
  nombreTipoDte,
} from '@/lib/formatos';
import { enviarCorreo, type MensajeCorreo, type ResultadoEnvio } from '../correo/resend';
import { envAuth, envCorreo } from '../env';
import { clienteServicio } from '../supabase/service';
import {
  LARGO_MAXIMO_ERROR,
  MAX_CORREOS_POR_CORRIDA,
  PAUSA_ENTRE_CORREOS_MS,
  PRESUPUESTO_MS,
  TIPO_CERTIFICADO,
  TIPO_INCIERTO,
  TIPO_RECHAZO,
  UMBRALES_CERTIFICADO,
  type UmbralCertificado,
  VENTANA_HORAS,
} from './constantes';
import {
  type Ambiente,
  type CertificadoPorVencerFila,
  type DocumentoRechazadoFila,
  type EmpresaAlerta,
  type EnvioInciertoFila,
  ErrorDatosAlertas,
  type OrganizacionAlerta,
  type Reclamada,
  type RepositorioAlertas,
  repositorioSupabase,
} from './datos';

// Alertas por correo de la Fase 8 (PLAN-SAAS §4.6): documento rechazado, envío incierto y
// certificado por vencer. Las dispara `/api/cron/alertas` (pg_cron, cada 10 min).
//
// Deduplicación en dos capas:
//   1. `notificaciones` (migración 0013): los candidatos ya vienen sin lo avisado, y antes
//      de enviar se RECLAMA la fila por su clave (`reclamar_notificacion`, atómico). Si no
//      devuelve fila, el aviso ya salió (o está saliendo en otra corrida) y no se envía.
//      Después del envío la fila queda `enviada` o `fallida`; una fallida se reintenta
//      sola cuando una corrida posterior vuelve a detectar el evento, hasta 5 intentos.
//   2. `Idempotency-Key` de Resend estable entre reintentos: si el primer intento sí salió
//      (la función murió antes de cerrar la fila, o Resend no respondió a tiempo), el
//      reintento no duplica el correo (Resend recuerda la clave 24 h).
//
// Decisiones:
//   - Rechazos: solo `rechazado`. Un documento `aceptado_con_reparos` es válido
//     tributariamente: los reparos se ven en el detalle del envío y en el webhook
//     `documento.aceptado_con_reparos`; avisarlos por correo sería ruido.
//   - Agrupación de rechazos: un correo por organización, empresa y ambiente (así el
//     enlace a Documentos lleva `empresa` y `ambiente` y muestra justo esos documentos).
//     Cada documento tiene su fila. La `Idempotency-Key` del correo es la huella de las
//     claves de las filas NUEVAS reclamadas juntas, y se guarda en `notificaciones.grupo`
//     ANTES de enviar. Un reintento reagrupa por ese `grupo` y reusa la clave: nunca se
//     mezcla con documentos nuevos (que van en su propio correo), así que la composición
//     y la clave no cambian. Si no se puede guardar el grupo, no se envía (la fila vuelve
//     a estar disponible a los 15 min, sin correo enviado que duplicar).
//   - Inciertos: uno por envío (son raros y cada uno exige revisar el SII). Nunca se
//     reintenta nada en el SII: el correo explica cómo revisarlo y pide marcarlo con
//     «Ya lo revisé» en el detalle del envío.
//   - Certificados: un correo por certificado y umbral (30, 15, 7, 1 días; lo calcula la
//     base). Se avisa solo el umbral vigente: uno al que le quedan 10 días al estrenar
//     recibe el de 15, no también el de 30.
//   - Ventana de 48 h para rechazos e inciertos (al estrenar, nada antiguo).
//   - Volumen: hasta 40 correos por corrida, con 600 ms entre uno y otro (Resend admite 2
//     por segundo) y sin empezar otro después de 40 s (el `maxDuration` es 60 s). Se
//     revisa ANTES de reclamar: lo que no alcanza queda libre y sale en la corrida
//     siguiente (`postergados` en el resumen). Orden: inciertos, rechazos, certificados
//     (de más a menos urgente).
//   - Sin Resend o sin NEXT_PUBLIC_APP_URL: detecta y cuenta, pero no reclama filas ni
//     envía (cuando se configure, lo que siga en la ventana sale).
//   - Destinatarios: propietarios y administradores (igual que la alerta de folios). Sin
//     destinatarios no se reclama (no habría a quién avisar).
//   - Nunca lanza por un aviso: cada categoría y cada correo se aíslan; los errores quedan
//     en el resumen y en avisos de consola sin datos (solo códigos).

export interface CorreoAlertas {
  enviar(mensaje: MensajeCorreo): Promise<ResultadoEnvio>;
}

export interface DependenciasAlertas {
  repositorio: RepositorioAlertas;
  correo: CorreoAlertas;
  /** `envCorreo() !== null`: si es false no se reclama ni se envía nada. */
  correoConfigurado: boolean;
  /** Origen público de la app (`NEXT_PUBLIC_APP_URL`, sin `/` final) o null. */
  urlApp: string | null;
  ahora: () => Date;
  /** Pausa entre correos (en las pruebas, sin espera). */
  esperar: (ms: number) => Promise<void>;
}

export interface ResumenCategoria {
  /** Eventos detectados en esta corrida (sin los ya avisados). */
  detectados: number;
  /** Notificaciones (filas) que salieron en un correo aceptado por Resend. */
  enviados: number;
  /** En curso en otra corrida o cerradas entre la lectura y el reclamo. */
  yaAvisados: number;
  /** Resend no aceptó el correo: la fila queda `fallida` y se reintenta. */
  fallidos: number;
  /** Organizaciones (o eventos) sin propietarios ni administradores con correo. */
  sinDestinatarios: number;
  /** No alcanzó el tope de correos o de tiempo: salen en la corrida siguiente. */
  postergados: number;
  /** La categoría no se pudo leer o falló a medias (lectura o escritura en la base). */
  error: boolean;
}

export interface ResumenAlertas {
  /** `sin_configurar`: falta Resend; `sin_url`: falta NEXT_PUBLIC_APP_URL. */
  correo: 'configurado' | 'sin_configurar' | 'sin_url';
  correosEnviados: number;
  /** Se llegó al tope de correos o de tiempo de la corrida. */
  limiteAlcanzado: boolean;
  rechazos: ResumenCategoria;
  inciertos: ResumenCategoria;
  certificados: ResumenCategoria;
}

const categoriaVacia = (): ResumenCategoria => ({
  detectados: 0,
  enviados: 0,
  yaAvisados: 0,
  fallidos: 0,
  sinDestinatarios: 0,
  postergados: 0,
  error: false,
});

/**
 * El umbral que corresponde a los días que faltan, o null si falta más de 30. La base
 * calcula lo mismo en `alertas_certificados_por_vencer` (0013): van sincronizados.
 */
export function umbralCertificado(dias: number): UmbralCertificado | null {
  let elegido: UmbralCertificado | null = null;
  for (const u of UMBRALES_CERTIFICADO) if (dias <= u) elegido = u;
  return elegido;
}

export const claveRechazo = (documentoId: string) => `${TIPO_RECHAZO}:${documentoId}`;
export const claveIncierto = (envioId: string) => `${TIPO_INCIERTO}:${envioId}`;
export const claveCertificado = (certificadoId: string, umbral: UmbralCertificado) =>
  `${TIPO_CERTIFICADO}:${certificadoId}:${umbral}`;

/**
 * `Idempotency-Key` de un correo agrupado de rechazos: organización + huella de las claves
 * de las notificaciones que lleva (ordenadas). Determinista y sin datos sensibles (< 256).
 * Se guarda en `notificaciones.grupo` para que un reintento use exactamente la misma.
 */
export function claveIdempotenciaRechazos(organizacionId: string, claves: string[]): string {
  const huella = createHash('sha256')
    .update([...claves].sort().join(','))
    .digest('hex')
    .slice(0, 32);
  return `${TIPO_RECHAZO}/${organizacionId}/${huella}`;
}

const nombreAmbiente = (a: Ambiente) => (a === 'produccion' ? 'producción' : 'certificación');

function nombreDocumento(tipoDte: number, folio: number | null): string {
  return folio ? `${nombreTipoDte(tipoDte)} N.º ${folio}` : nombreTipoDte(tipoDte);
}

function errorDeEnvio(r: Exclude<ResultadoEnvio, { ok: true }>): string {
  return `${r.motivo}: ${r.detalle}`.slice(0, LARGO_MAXIMO_ERROR);
}

function avisar(texto: string, error: unknown) {
  console.warn(`alertas: ${texto}`, {
    tipo: error instanceof Error ? error.name : typeof error,
    ...(error instanceof ErrorDatosAlertas
      ? { operacion: error.operacion, codigo: error.codigo }
      : {}),
  });
}

/** Contexto compartido por las tres categorías en una corrida. */
interface Corrida {
  deps: DependenciasAlertas;
  urlApp: string;
  organizaciones: Map<string, OrganizacionAlerta>;
  destinatarios: Map<string, string[]>;
  inicio: number;
  correosIntentados: number;
  correosEnviados: number;
  limiteAlcanzado: boolean;
}

/** ¿Queda cupo para otro correo en esta corrida? (se mira antes de reclamar) */
function hayCupo(corrida: Corrida): boolean {
  const ok =
    corrida.correosIntentados < MAX_CORREOS_POR_CORRIDA &&
    corrida.deps.ahora().getTime() - corrida.inicio < PRESUPUESTO_MS;
  if (!ok) corrida.limiteAlcanzado = true;
  return ok;
}

/**
 * Envía un correo para las notificaciones ya reclamadas y las cierra. Si falla el cierre
 * después de enviar, la fila queda `pendiente`: a los 15 min se vuelve a reclamar y la
 * `Idempotency-Key` (estable) evita el duplicado.
 */
async function enviarYCerrar(
  corrida: Corrida,
  ids: string[],
  para: string[],
  mensaje: Omit<MensajeCorreo, 'para'>,
  resumen: ResumenCategoria,
): Promise<void> {
  if (corrida.correosIntentados > 0) await corrida.deps.esperar(PAUSA_ENTRE_CORREOS_MS);
  corrida.correosIntentados += 1;
  let resultado: ResultadoEnvio;
  try {
    resultado = await corrida.deps.correo.enviar({ ...mensaje, para });
  } catch (error) {
    // `enviarCorreo` no lanza; un doble de pruebas o un cambio futuro sí podría.
    avisar('el envío del correo lanzó una excepción', error);
    resultado = { ok: false, motivo: 'red', detalle: 'Excepción al enviar el correo.' };
  }
  if (resultado.ok) {
    corrida.correosEnviados += 1;
    resumen.enviados += ids.length;
  } else {
    resumen.fallidos += ids.length;
    console.warn(`alertas: el correo no salió (${resultado.motivo})`);
  }
  try {
    await corrida.deps.repositorio.cerrar(
      ids,
      resultado.ok
        ? {
            estado: 'enviada',
            resendId: resultado.id,
            destinatarios: para,
            enviadoEn: corrida.deps.ahora().toISOString(),
          }
        : { estado: 'fallida', error: errorDeEnvio(resultado), destinatarios: para },
    );
  } catch (error) {
    resumen.error = true;
    avisar('no se pudo cerrar la notificación', error);
  }
}

const destinatariosDe = (corrida: Corrida, organizacionId: string) =>
  corrida.destinatarios.get(organizacionId) ?? [];

// -----------------------------------------------------------------------------------
// Envíos inciertos (uno por envío)
// -----------------------------------------------------------------------------------

async function procesarInciertos(
  corrida: Corrida,
  inciertos: EnvioInciertoFila[],
  resumen: ResumenCategoria,
): Promise<void> {
  let empresas = new Map<string, EmpresaAlerta>();
  try {
    empresas = await corrida.deps.repositorio.empresas(inciertos.map((i) => i.empresaId));
  } catch (error) {
    resumen.error = true;
    avisar('no se pudieron leer las empresas de los envíos inciertos', error);
    return;
  }
  for (const [i, envio] of inciertos.entries()) {
    const organizacion = corrida.organizaciones.get(envio.organizacionId);
    const empresa = empresas.get(envio.empresaId);
    const para = destinatariosDe(corrida, envio.organizacionId);
    if (!organizacion || !empresa) continue;
    if (para.length === 0) {
      resumen.sinDestinatarios += 1;
      continue;
    }
    if (!hayCupo(corrida)) {
      resumen.postergados += inciertos.length - i;
      return;
    }
    try {
      const reclamada = await corrida.deps.repositorio.reclamar({
        organizacionId: envio.organizacionId,
        tipo: TIPO_INCIERTO,
        clave: claveIncierto(envio.id),
        referenciaId: envio.id,
        datos: { empresa_id: envio.empresaId, ambiente: envio.ambiente },
      });
      if (!reclamada) {
        resumen.yaAvisados += 1;
        continue;
      }
      const correo = correoEnvioIncierto({
        organizacion: organizacion.nombre,
        empresa: empresa.razonSocial,
        rut: formatearRut(empresa.rut),
        ambiente: nombreAmbiente(envio.ambiente),
        fecha: formatearFechaHora(envio.creadoEn),
        documentos: envio.documentos.map((d) => ({
          documento: nombreDocumento(d.tipoDte, d.folio),
          total: formatearMonto(d.mntTotal),
        })),
        enlace: `${corrida.urlApp}/${encodeURIComponent(organizacion.slug)}/envios/${encodeURIComponent(envio.id)}`,
      });
      await enviarYCerrar(
        corrida,
        [reclamada.id],
        para,
        {
          asunto: correo.asunto,
          html: correo.html,
          texto: correo.texto,
          claveIdempotencia: `${TIPO_INCIERTO}/${envio.id}`,
        },
        resumen,
      );
    } catch (error) {
      resumen.error = true;
      avisar('falló el aviso de un envío incierto', error);
    }
  }
}

// -----------------------------------------------------------------------------------
// Documentos rechazados (un correo por organización, empresa y ambiente)
// -----------------------------------------------------------------------------------

/** Lo que va en un correo de rechazos: las filas reclamadas y su `Idempotency-Key`. */
interface LoteRechazos {
  grupo: string;
  /** La clave todavía no está guardada en las filas (filas nuevas). */
  nuevo: boolean;
  filas: { reclamada: Reclamada; documento: DocumentoRechazadoFila }[];
}

function enlaceDocumentos(
  corrida: Corrida,
  slug: string,
  documento: Pick<DocumentoRechazadoFila, 'empresaId' | 'ambiente'>,
  doc?: string,
): string {
  const p = new URLSearchParams({
    empresa: documento.empresaId,
    ambiente: documento.ambiente,
    estado: 'rechazado',
    periodo: 'todos',
  });
  if (doc) p.set('doc', doc);
  return `${corrida.urlApp}/${encodeURIComponent(slug)}/documentos?${p.toString()}`;
}

async function enviarLoteRechazos(
  corrida: Corrida,
  organizacion: OrganizacionAlerta,
  empresa: EmpresaAlerta | undefined,
  para: string[],
  lote: LoteRechazos,
  resumen: ResumenCategoria,
): Promise<void> {
  const ids = lote.filas.map((f) => f.reclamada.id);
  if (lote.nuevo) {
    try {
      await corrida.deps.repositorio.fijarGrupo(ids, lote.grupo);
    } catch (error) {
      // Sin el grupo guardado, un reintento no sabría qué clave usar: no se envía. Las
      // filas siguen `pendiente` y se vuelven a reclamar (como nuevas) a los 15 min.
      resumen.error = true;
      avisar('no se pudo guardar el grupo del correo de rechazos', error);
      return;
    }
  }
  const slug = organizacion.slug;
  const base = `${corrida.urlApp}/${encodeURIComponent(slug)}`;
  const primero = lote.filas[0]?.documento;
  if (!primero) return;
  const documentos: DocumentoRechazado[] = lote.filas.map(({ documento: d }) => ({
    documento: nombreDocumento(d.tipoDte, d.folio),
    empresa: empresa?.razonSocial ?? 'Empresa',
    rut: formatearRut(empresa?.rut ?? ''),
    total: formatearMonto(d.mntTotal),
    fecha: formatearFecha(d.fechaEmision),
    ambiente: nombreAmbiente(d.ambiente),
    motivo: d.motivo,
    enlace: d.envioId
      ? `${base}/envios/${encodeURIComponent(d.envioId)}`
      : enlaceDocumentos(corrida, slug, d, d.id),
  }));
  const correo = correoDocumentosRechazados({
    organizacion: organizacion.nombre,
    documentos,
    enlace: enlaceDocumentos(
      corrida,
      slug,
      primero,
      lote.filas.length === 1 ? primero.id : undefined,
    ),
  });
  await enviarYCerrar(
    corrida,
    ids,
    para,
    {
      asunto: correo.asunto,
      html: correo.html,
      texto: correo.texto,
      claveIdempotencia: lote.grupo,
    },
    resumen,
  );
}

async function procesarRechazos(
  corrida: Corrida,
  filas: DocumentoRechazadoFila[],
  resumen: ResumenCategoria,
): Promise<void> {
  let empresas = new Map<string, EmpresaAlerta>();
  try {
    empresas = await corrida.deps.repositorio.empresas(filas.map((f) => f.empresaId));
  } catch (error) {
    resumen.error = true;
    avisar('no se pudieron leer las empresas de los documentos rechazados', error);
    return;
  }
  // Grupos por organización + empresa + ambiente, en el orden en que llegaron (la base
  // ya los repartió por turnos entre organizaciones).
  const grupos = new Map<string, DocumentoRechazadoFila[]>();
  for (const f of filas) {
    const llave = `${f.organizacionId}|${f.empresaId}|${f.ambiente}`;
    grupos.set(llave, [...(grupos.get(llave) ?? []), f]);
  }

  let restantes = filas.length;
  for (const documentos of grupos.values()) {
    const [primero] = documentos;
    if (!primero) continue;
    const organizacion = corrida.organizaciones.get(primero.organizacionId);
    const para = destinatariosDe(corrida, primero.organizacionId);
    if (!organizacion) {
      restantes -= documentos.length;
      continue;
    }
    if (para.length === 0) {
      resumen.sinDestinatarios += 1;
      restantes -= documentos.length;
      continue;
    }
    if (!hayCupo(corrida)) {
      resumen.postergados += restantes;
      return;
    }
    restantes -= documentos.length;
    try {
      // Nuevas juntas en un lote; las de un reintento, por el grupo que ya tenían.
      const nuevas: LoteRechazos['filas'] = [];
      const reintentos = new Map<string, LoteRechazos['filas']>();
      for (const documento of documentos) {
        const reclamada = await corrida.deps.repositorio.reclamar({
          organizacionId: documento.organizacionId,
          tipo: TIPO_RECHAZO,
          clave: claveRechazo(documento.id),
          referenciaId: documento.id,
          datos: {
            empresa_id: documento.empresaId,
            ambiente: documento.ambiente,
            envio_id: documento.envioId,
          },
        });
        if (!reclamada) {
          resumen.yaAvisados += 1;
        } else if (reclamada.grupo) {
          reintentos.set(reclamada.grupo, [
            ...(reintentos.get(reclamada.grupo) ?? []),
            { reclamada, documento },
          ]);
        } else {
          nuevas.push({ reclamada, documento });
        }
      }
      const lotes: LoteRechazos[] = [...reintentos].map(([grupo, f]) => ({
        grupo,
        nuevo: false,
        filas: f,
      }));
      if (nuevas.length > 0) {
        lotes.push({
          grupo: claveIdempotenciaRechazos(
            primero.organizacionId,
            nuevas.map((n) => claveRechazo(n.documento.id)),
          ),
          nuevo: true,
          filas: nuevas,
        });
      }
      const empresa = empresas.get(primero.empresaId);
      for (const lote of lotes) {
        await enviarLoteRechazos(corrida, organizacion, empresa, para, lote, resumen);
      }
    } catch (error) {
      resumen.error = true;
      avisar('falló el aviso de documentos rechazados', error);
    }
  }
}

// -----------------------------------------------------------------------------------
// Certificados por vencer (uno por certificado y umbral)
// -----------------------------------------------------------------------------------

async function procesarCertificados(
  corrida: Corrida,
  certificados: CertificadoPorVencerFila[],
  resumen: ResumenCategoria,
): Promise<void> {
  for (const [i, cert] of certificados.entries()) {
    const organizacion = corrida.organizaciones.get(cert.organizacionId);
    const para = destinatariosDe(corrida, cert.organizacionId);
    if (!organizacion) continue;
    if (para.length === 0) {
      resumen.sinDestinatarios += 1;
      continue;
    }
    if (!hayCupo(corrida)) {
      resumen.postergados += certificados.length - i;
      return;
    }
    try {
      const reclamada = await corrida.deps.repositorio.reclamar({
        organizacionId: cert.organizacionId,
        tipo: TIPO_CERTIFICADO,
        clave: claveCertificado(cert.id, cert.umbral),
        referenciaId: cert.id,
        datos: { umbral: cert.umbral, dias: cert.dias },
      });
      if (!reclamada) {
        resumen.yaAvisados += 1;
        continue;
      }
      const correo = correoCertificadoPorVencer({
        organizacion: organizacion.nombre,
        titular: cert.titular,
        rut: formatearRut(cert.rut),
        vence: formatearFecha(new Date(cert.venceEn)),
        dias: cert.dias,
        empresas: cert.empresas,
        enlace: `${corrida.urlApp}/${encodeURIComponent(organizacion.slug)}/configuracion/certificados`,
      });
      await enviarYCerrar(
        corrida,
        [reclamada.id],
        para,
        {
          asunto: correo.asunto,
          html: correo.html,
          texto: correo.texto,
          claveIdempotencia: `${TIPO_CERTIFICADO}/${cert.id}/${cert.umbral}`,
        },
        resumen,
      );
    } catch (error) {
      resumen.error = true;
      avisar('falló el aviso de un certificado por vencer', error);
    }
  }
}

/** Corre las tres alertas una vez. Nunca lanza: los errores quedan en el resumen. */
export async function ejecutarAlertas(
  deps: DependenciasAlertas = resolverDependenciasAlertas(),
): Promise<ResumenAlertas> {
  const resumen: ResumenAlertas = {
    correo: !deps.correoConfigurado ? 'sin_configurar' : !deps.urlApp ? 'sin_url' : 'configurado',
    correosEnviados: 0,
    limiteAlcanzado: false,
    rechazos: categoriaVacia(),
    inciertos: categoriaVacia(),
    certificados: categoriaVacia(),
  };
  const inicio = deps.ahora().getTime();
  const desde = new Date(inicio - VENTANA_HORAS * 3_600_000).toISOString();
  const { repositorio } = deps;

  const leer = async <T>(categoria: ResumenCategoria, fn: () => Promise<T[]>): Promise<T[]> => {
    try {
      const filas = await fn();
      categoria.detectados = filas.length;
      return filas;
    } catch (error) {
      categoria.error = true;
      avisar('no se pudo leer una categoría', error);
      return [];
    }
  };
  const [inciertos, rechazos, certificados] = await Promise.all([
    leer(resumen.inciertos, () => repositorio.enviosInciertos(desde)),
    leer(resumen.rechazos, () => repositorio.documentosRechazados(desde)),
    leer(resumen.certificados, () => repositorio.certificadosPorVencer()),
  ]);

  // Sin Resend o sin URL pública no se reclama nada: el evento sigue en la ventana (o el
  // certificado en su umbral) y sale cuando se configure.
  if (resumen.correo !== 'configurado' || !deps.urlApp) return resumen;

  const organizacionesIds = [
    ...inciertos.map((i) => i.organizacionId),
    ...rechazos.map((r) => r.organizacionId),
    ...certificados.map((c) => c.organizacionId),
  ];
  if (organizacionesIds.length === 0) return resumen;

  let corrida: Corrida;
  try {
    const [organizaciones, destinatarios] = await Promise.all([
      repositorio.organizaciones(organizacionesIds),
      repositorio.destinatarios(organizacionesIds),
    ]);
    corrida = {
      deps,
      urlApp: deps.urlApp,
      organizaciones,
      destinatarios,
      inicio,
      correosIntentados: 0,
      correosEnviados: 0,
      limiteAlcanzado: false,
    };
  } catch (error) {
    avisar('no se pudieron leer organizaciones o destinatarios', error);
    for (const c of [resumen.rechazos, resumen.inciertos, resumen.certificados]) {
      if (c.detectados > 0) c.error = true;
    }
    return resumen;
  }

  // De más a menos urgente; cada etapa respeta el tope de correos y de tiempo.
  const etapas: [ResumenCategoria, () => Promise<void>][] = [
    [resumen.inciertos, () => procesarInciertos(corrida, inciertos, resumen.inciertos)],
    [resumen.rechazos, () => procesarRechazos(corrida, rechazos, resumen.rechazos)],
    [resumen.certificados, () => procesarCertificados(corrida, certificados, resumen.certificados)],
  ];
  for (const [categoria, etapa] of etapas) {
    if (categoria.detectados === 0) continue;
    try {
      await etapa();
    } catch (error) {
      categoria.error = true;
      avisar('falló una categoría de alertas', error);
    }
  }

  resumen.correosEnviados = corrida.correosEnviados;
  resumen.limiteAlcanzado = corrida.limiteAlcanzado;
  return resumen;
}

function urlAppPorDefecto(): string | null {
  try {
    return envAuth().NEXT_PUBLIC_APP_URL.replace(/\/+$/, '');
  } catch {
    return null;
  }
}

/** Dependencias reales, armadas por invocación (nada en variables de módulo). */
export function resolverDependenciasAlertas(
  parciales: Partial<DependenciasAlertas> = {},
): DependenciasAlertas {
  return {
    repositorio: parciales.repositorio ?? repositorioSupabase(clienteServicio()),
    correo: parciales.correo ?? { enviar: (m) => enviarCorreo(m) },
    correoConfigurado: parciales.correoConfigurado ?? envCorreo() !== null,
    urlApp: parciales.urlApp !== undefined ? parciales.urlApp : urlAppPorDefecto(),
    ahora: parciales.ahora ?? (() => new Date()),
    esperar: parciales.esperar ?? ((ms) => new Promise((resolver) => setTimeout(resolver, ms))),
  };
}
