import * as Sentry from '@sentry/nextjs';
import { opcionesSentry } from './lib/sentry/opciones';

// Session Replay apagado en la app (datos tributarios), PLAN-SAAS §4.8.
Sentry.init(opcionesSentry());

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
