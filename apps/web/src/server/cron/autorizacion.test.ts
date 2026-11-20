import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MONITOR_SEGUIMIENTO } from '@/lib/seguimiento';
import { MONITOR_ALERTAS } from '@/server/alertas/constantes';
import { MONITOR_SUSCRIPCIONES } from '@/server/pagos/constantes';
import { MONITOR_WEBHOOKS } from '@/server/webhooks/constantes';

// `conMonitorCron` manda la configuración completa del monitor en cada check-in (el SDK la
// reescribe), así que los umbrales de issue tienen que ir en el código, por monitor.

const llamadas = vi.hoisted(() => [] as { slug: string; config: Record<string, unknown> }[]);

vi.mock('@sentry/nextjs', () => ({
  withMonitor: (slug: string, trabajo: () => unknown, config: Record<string, unknown>) => {
    llamadas.push({ slug, config });
    return trabajo();
  },
}));

const { autorizarCron, conMonitorCron } = await import('./autorizacion');

beforeEach(() => {
  llamadas.length = 0;
});

describe('conMonitorCron', () => {
  const esperados: [string, number][] = [
    [MONITOR_WEBHOOKS, 3],
    [MONITOR_SEGUIMIENTO, 2],
    [MONITOR_ALERTAS, 1],
    [MONITOR_SUSCRIPCIONES, 1],
  ];

  for (const [slug, fallas] of esperados) {
    it(`${slug}: issue tras ${fallas} falla(s) seguidas y se recupera con 1 ok`, async () => {
      expect(await conMonitorCron(slug, '*/5 * * * *', async () => 'listo')).toBe('listo');
      expect(llamadas).toHaveLength(1);
      expect(llamadas[0]?.slug).toBe(slug);
      expect(llamadas[0]?.config).toMatchObject({
        schedule: { type: 'crontab', value: '*/5 * * * *' },
        failureIssueThreshold: fallas,
        recoveryThreshold: 1,
        timezone: 'UTC',
      });
    });
  }

  it('los cuatro monitores son distintos (ningún umbral pisa a otro)', () => {
    expect(new Set(esperados.map(([s]) => s)).size).toBe(4);
  });

  it('un monitor sin umbral propio abre el issue a la primera', async () => {
    await conMonitorCron('cron-nuevo', '0 * * * *', async () => null, { maxMinutos: 9 });
    expect(llamadas[0]?.config).toMatchObject({
      failureIssueThreshold: 1,
      recoveryThreshold: 1,
      maxRuntime: 9,
    });
  });
});

describe('autorizarCron', () => {
  const con = (valor: string) => new Headers({ authorization: valor });

  it('acepta solo el Bearer igual a CRON_SECRET', () => {
    expect(autorizarCron(con('Bearer secreto'), 'secreto')).toBe('ok');
    expect(autorizarCron(con('Bearer otro'), 'secreto')).toBe('no_autorizado');
    expect(autorizarCron(con('secreto'), 'secreto')).toBe('no_autorizado');
    expect(autorizarCron(new Headers(), 'secreto')).toBe('no_autorizado');
    expect(autorizarCron(con('Bearer secreto'), null)).toBe('sin_configurar');
  });
});
