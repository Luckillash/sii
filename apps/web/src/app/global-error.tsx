'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="es-CL">
      <body>
        <main style={{ fontFamily: 'system-ui, sans-serif', padding: '48px 16px', maxWidth: 560 }}>
          <h1 style={{ fontSize: 20 }}>No pudimos cargar esta página</h1>
          <p>
            Ocurrió un error inesperado y ya quedó registrado. Recarga la página; si se repite,
            escríbenos con la hora en que pasó.
          </p>
        </main>
      </body>
    </html>
  );
}
