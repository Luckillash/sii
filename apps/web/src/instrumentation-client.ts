import * as Sentry from '@sentry/nextjs';
import { config as configurarZod } from 'zod/v4/core';
import { opcionesSentry } from './lib/sentry/opciones';

// Session Replay apagado en la app (datos tributarios), PLAN-SAAS §4.8.
Sentry.init(opcionesSentry());

// Sin JIT en el navegador: zod prueba `Function("")` para compilar los esquemas, y la CSP no
// permite `eval` (`script-src` sin 'unsafe-eval'): cada prueba sería un reporte de CSP.
// Validar unos formularios no necesita JIT (PLAN-SAAS Fase 13, punto 1).
configurarZod({ jitless: true });

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
