import * as Sentry from '@sentry/nextjs';
import { rechazoSpike } from '@/server/spike/autorizar';

// Prueba de Sentry de la Fase 0: un error visible con source maps y con secretos
// FALSOS en el evento, para comprobar en Sentry que la depuración los reemplazó por
// "[Filtrado]". Temporal: se borra al cerrar la fase.
//
//   curl -H "Authorization: Bearer $SPIKE_TOKEN" https://<preview>/api/spike/sentry

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

class ErrorPruebaSentry extends Error {
  override name = 'ErrorPruebaSentry';
}

export async function GET(request: Request) {
  const rechazo = rechazoSpike(request);
  if (rechazo) return rechazo;

  // Se arma en ejecución para que el valor no aparezca en las líneas de código que
  // Sentry adjunta al stack trace (eso daría un falso positivo al revisar).
  const falso = ['FALSO', 'NO', 'DEBE', 'VERSE'].join('-');
  const eventId = Sentry.captureException(
    new ErrorPruebaSentry(`Error de prueba de la Fase 0 con TOKEN=${falso}`),
    {
      tags: { operacion_sii: 'spike', resultado: 'error' },
      extra: {
        token: falso,
        clave: falso,
        cookies: [`TOKEN=${falso}`],
        caf: `<CAF><RSASK>${falso}</RSASK></CAF>`,
        folio: 1520,
      },
    },
  );
  await Sentry.flush(2000);
  return Response.json(
    { eventId, revisar: `En Sentry, ningún campo debe mostrar ${falso}.` },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
