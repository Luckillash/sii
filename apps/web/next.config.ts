import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // La librería del SII usa node-forge (firma) y undici (TLS mutuo): se cargan
  // desde node_modules en tiempo de ejecución, sin empaquetarlas.
  serverExternalPackages: ['node-forge', 'undici'],
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
  silent: !process.env.CI,
  widenClientFileUpload: true,
  sourcemaps: {
    // Los source maps se suben a Sentry y no quedan públicos en el deploy.
    deleteSourcemapsAfterUpload: true,
  },
  telemetry: false,
});
