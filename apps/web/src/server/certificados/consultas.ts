import 'server-only';
import { clienteServidor } from '../supabase/servidor';
import { type EstadoCertificado, esEstadoCertificado, type FilaEstadoCertificado } from './estado';

// Lecturas de certificados y de sus asociaciones con empresas, con el cliente de
// sesión (RLS: `lectura` de `certificados`, `empresa_certificados` y `empresas` para
// todo miembro; la vista `v_certificados_estado` es `security_invoker`). Nunca se
// leen `pfx_secret_id` ni `clave_secret_id`: la UI no los necesita.

export interface CertificadoListado {
  id: string;
  rutTitular: string;
  nombreTitular: string | null;
  cn: string | null;
  emisorCa: string | null;
  /** ISO. */
  vigenteDesde: string | null;
  /** ISO. */
  vigenteHasta: string | null;
  estado: EstadoCertificado;
  diasRestantes: number;
  pfxLegacy: boolean;
  revocadoEn: string | null;
}

export interface EmpresaBasica {
  id: string;
  rut: string;
  razonSocial: string;
}

export interface AsociacionEmpresa {
  certificado: CertificadoListado;
  esRepresentanteElectronico: boolean;
  predeterminado: boolean;
}

/** Certificados de la organización, del que vence antes al que vence después. */
export async function listarCertificados(organizacionId: string): Promise<CertificadoListado[]> {
  const supabase = await clienteServidor();
  const [estados, detalles] = await Promise.all([
    supabase
      .from('v_certificados_estado')
      .select(
        'id, rut_titular, nombre_titular, cn, vigente_desde, vigente_hasta, estado, dias_restantes',
      )
      .eq('organizacion_id', organizacionId),
    supabase
      .from('certificados')
      .select('id, emisor_ca, pfx_legacy, revocado_en')
      .eq('organizacion_id', organizacionId),
  ]);
  if (estados.error) {
    throw new Error(`No se pudieron leer los certificados: ${estados.error.code ?? ''}`);
  }
  if (detalles.error) {
    throw new Error(`No se pudieron leer los certificados: ${detalles.error.code ?? ''}`);
  }

  const porId = new Map(detalles.data.map((d) => [d.id, d]));
  const lista: CertificadoListado[] = [];
  for (const fila of estados.data) {
    if (!fila.id || !fila.rut_titular) continue;
    const detalle = porId.get(fila.id);
    lista.push({
      id: fila.id,
      rutTitular: fila.rut_titular,
      nombreTitular: fila.nombre_titular,
      cn: fila.cn,
      emisorCa: detalle?.emisor_ca ?? null,
      vigenteDesde: fila.vigente_desde,
      vigenteHasta: fila.vigente_hasta,
      estado: esEstadoCertificado(fila.estado) ? fila.estado : 'vigente',
      diasRestantes: fila.dias_restantes ?? 0,
      pfxLegacy: detalle?.pfx_legacy ?? false,
      revocadoEn: detalle?.revocado_en ?? null,
    });
  }
  return lista.sort((a, b) => (a.vigenteHasta ?? '').localeCompare(b.vigenteHasta ?? ''));
}

/** Solo lo necesario para los avisos de vencimiento (Tablero). */
export async function estadosCertificados(
  organizacionId: string,
): Promise<FilaEstadoCertificado[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('v_certificados_estado')
    .select('nombre_titular, estado, dias_restantes, vigente_hasta')
    .eq('organizacion_id', organizacionId)
    .in('estado', ['por_vencer', 'vencido']);
  if (error) throw new Error(`No se pudieron leer los certificados: ${error.code ?? ''}`);
  return data.flatMap((f) =>
    esEstadoCertificado(f.estado)
      ? [
          {
            nombreTitular: f.nombre_titular,
            estado: f.estado,
            diasRestantes: f.dias_restantes ?? 0,
            vigenteHasta: f.vigente_hasta,
          },
        ]
      : [],
  );
}

/** ¿El certificado es de la organización? */
export async function existeCertificado(
  organizacionId: string,
  certificadoId: string,
): Promise<boolean> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('certificados')
    .select('id')
    .eq('organizacion_id', organizacionId)
    .eq('id', certificadoId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer el certificado: ${error.code ?? ''}`);
  return data !== null;
}

/** Empresas de la organización (para elegir a cuál asociar un certificado). */
export async function listarEmpresasBasicas(organizacionId: string): Promise<EmpresaBasica[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('empresas')
    .select('id, rut, razon_social')
    .eq('organizacion_id', organizacionId)
    .order('razon_social');
  if (error) throw new Error(`No se pudieron leer las empresas: ${error.code ?? ''}`);
  return data.map((e) => ({ id: e.id, rut: e.rut, razonSocial: e.razon_social }));
}

/** La empresa, solo si es de la organización; `null` si no existe o es de otra. */
export async function obtenerEmpresaBasica(
  organizacionId: string,
  empresaId: string,
): Promise<EmpresaBasica | null> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('empresas')
    .select('id, rut, razon_social')
    .eq('organizacion_id', organizacionId)
    .eq('id', empresaId)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer la empresa: ${error.code ?? ''}`);
  return data ? { id: data.id, rut: data.rut, razonSocial: data.razon_social } : null;
}

/** Certificados asociados a una empresa, con sus opciones; el predeterminado primero. */
export async function listarAsociaciones(
  organizacionId: string,
  empresaId: string,
  certificados: readonly CertificadoListado[],
): Promise<AsociacionEmpresa[]> {
  const supabase = await clienteServidor();
  const { data, error } = await supabase
    .from('empresa_certificados')
    .select('certificado_id, es_representante_electronico, predeterminado')
    .eq('organizacion_id', organizacionId)
    .eq('empresa_id', empresaId);
  if (error) throw new Error(`No se pudieron leer las asociaciones: ${error.code ?? ''}`);

  const porId = new Map(certificados.map((c) => [c.id, c]));
  const lista: AsociacionEmpresa[] = [];
  for (const fila of data) {
    const certificado = porId.get(fila.certificado_id);
    if (!certificado) continue;
    lista.push({
      certificado,
      esRepresentanteElectronico: fila.es_representante_electronico,
      predeterminado: fila.predeterminado,
    });
  }
  return lista.sort((a, b) => Number(b.predeterminado) - Number(a.predeterminado));
}
