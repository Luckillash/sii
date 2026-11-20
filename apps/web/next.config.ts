import { withSentryConfig } from '@sentry/nextjs/config';
import type { NextConfig } from 'next';
// Con extensión: Node 24 carga next.config.ts con su resolvedor de TypeScript nativo (ESM).
import { cabecerasSeguridad } from './src/lib/cabeceras-seguridad.ts';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Cabeceras de seguridad de toda respuesta (CSP, HSTS, nosniff, X-Frame-Options…), con
  // las NEXT_PUBLIC_* del build. Decisiones en src/lib/cabeceras-seguridad.ts.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: cabecerasSeguridad({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          appUrl: process.env.NEXT_PUBLIC_APP_URL,
          sentryDsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
          ambiente: process.env.NEXT_PUBLIC_VERCEL_ENV,
          desarrollo: process.env.NODE_ENV === 'development',
        }),
      },
    ];
  },
  // La librería del SII usa node-forge (firma) y undici (TLS mutuo): se cargan
  // desde node_modules en tiempo de ejecución, sin empaquetarlas.
  // pdfkit (PDF de la boleta) lee sus fuentes AFM con `fs` desde su propia carpeta
  // (`__dirname/data/*.afm`): empaquetado, esa ruta deja de existir. bwip-js (PDF417)
  // también va aparte: es un módulo grande con su build propio para Node.
  serverExternalPackages: ['node-forge', 'undici', 'pdfkit', 'bwip-js'],
  experimental: {
    serverActions: {
      // Un .pfx o un CAF caben sobrados (PLAN-SAAS §4.1).
      bodySizeLimit: '2mb',
    },
  },
};

export default withSentryConfig(config, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Túnel para que los bloqueadores de anuncios no frenen los eventos del navegador.
  tunnelRoute: '/api/monitoring',
  silent: true,
  widenClientFileUpload: true,
  sourcemaps: {
    // Los source maps se suben a Sentry y no quedan públicos en el deploy.
    deleteSourcemapsAfterUpload: true,
  },
  telemetry: false,
});
