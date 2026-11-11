import * as Sentry from '@sentry/nextjs';
import { opcionesSentry } from './lib/sentry/opciones';

export async function register() {
  // Mismas opciones (y misma depuración de secretos) en Node.js y en edge.
  if (process.env.NEXT_RUNTIME === 'nodejs' || process.env.NEXT_RUNTIME === 'edge') {
    Sentry.init(opcionesSentry());
  }
}

export const onRequestError = Sentry.captureRequestError;
