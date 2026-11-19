import 'server-only';
import * as Sentry from '@sentry/nextjs';
import type { ArchivoDocumento, ResultadoEmision } from '@/lib/emision';
import type { ResultadoFolios } from '@/lib/folios';
import { emitirDocumento } from '../emision/emitir';
import { enlaceDocumento } from '../emision/enlaces';
import type { ContextoEmision, EntradaEmision } from '../emision/tipos';
import { type OpcionesSolicitud, solicitarFolios } from '../folios/solicitar';
import type { ContextoFoliosApi } from '../folios/tipos';
import { type ClienteServicio, clienteServicio } from '../supabase/service';
import { type RepositorioApi, repositorioSupabase } from './repositorio';

// Dependencias de la API pública (PLAN-SAAS Fase 11), inyectables para probar sin red ni
// base. Se arman en cada petición (nunca en una variable de módulo): el cliente de
// service_role se crea al primer uso y lo comparten el repositorio, la emisión y la
// descarga de archivos.

export type ResultadoEnlace = Awaited<ReturnType<typeof enlaceDocumento>>;

export interface DependenciasApi {
  repo: RepositorioApi;
  /** `emitirDocumento` de la Fase 7 (con un contexto de API: `usuarioId: null`, `apiKeyId`). */
  emitir: (ctx: ContextoEmision, entrada: EntradaEmision) => Promise<ResultadoEmision>;
  /** `solicitarFolios` de la Fase 6 con el contexto de la API. */
  solicitarFolios: (ctx: ContextoFoliosApi, op: OpcionesSolicitud) => Promise<ResultadoFolios>;
  /** URL firmada del XML o del PDF (regenera el PDF si falta), leída con service_role. */
  enlace: (
    ctx: { organizacionId: string; empresaId: string },
    documentoId: string,
    archivo: ArchivoDocumento,
  ) => Promise<ResultadoEnlace>;
  /** Descarga de la URL firmada de Storage (para reenviar los bytes). */
  descargar: (url: string) => Promise<Response>;
  reloj: () => Date;
  /** Fallas inesperadas (5xx) a Sentry, que depura en `beforeSend`. */
  capturar: (error: unknown, etiquetas: Record<string, string>) => void;
}

export function capturarEnSentry(error: unknown, etiquetas: Record<string, string>): void {
  Sentry.withScope((scope) => {
    scope.setTags(etiquetas);
    Sentry.captureException(error);
  });
}

/** Las dependencias reales, con lo que se pase reemplazado. */
export function resolverDependenciasApi(parciales: Partial<DependenciasApi> = {}): DependenciasApi {
  let cliente: ClienteServicio | undefined;
  const servicio = () => {
    cliente ??= clienteServicio();
    return cliente;
  };
  let repo = parciales.repo;
  return {
    get repo() {
      repo ??= repositorioSupabase(servicio());
      return repo;
    },
    emitir: parciales.emitir ?? ((ctx, entrada) => emitirDocumento(ctx, entrada)),
    solicitarFolios: parciales.solicitarFolios ?? ((ctx, op) => solicitarFolios(ctx, op)),
    enlace:
      parciales.enlace ??
      ((ctx, id, archivo) =>
        enlaceDocumento(ctx, id, archivo, {
          sesion: async () => servicio(),
          servicio,
        })),
    descargar:
      parciales.descargar ??
      ((url) => fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20_000) })),
    reloj: parciales.reloj ?? (() => new Date()),
    capturar: parciales.capturar ?? capturarEnSentry,
  };
}
