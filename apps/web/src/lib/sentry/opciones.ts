import { depurarBreadcrumb, depurarEvento } from './depurar';

/**
 * Opciones comunes de Sentry para navegador, servidor y edge. Sin DSN, Sentry queda
 * apagado (desarrollo local y CI).
 */
export function opcionesSentry() {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.NODE_ENV,
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA,
    // Datos tributarios: nada de IP, cookies ni cuerpos por defecto.
    sendDefaultPii: false,
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1,
    beforeSend: depurarEvento,
    beforeSendTransaction: depurarEvento,
    beforeBreadcrumb: depurarBreadcrumb,
  };
}
