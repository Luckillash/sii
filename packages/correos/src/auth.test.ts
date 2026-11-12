import { describe, expect, it } from 'vitest';
import { PLANTILLAS_AUTH, type PlantillaAuth } from './auth';

// Además de revisar el contenido, deja cada plantilla en supabase/templates/<nombre>.html
// (lo que se pega en el panel de Supabase Auth). Si cambias auth.ts, actualízalas con
// `pnpm --filter @timbre/correos test -u`.

const EMOJI = /\p{Extended_Pictographic}/u;
const NOMBRES = Object.keys(PLANTILLAS_AUTH) as PlantillaAuth[];

/** Los href del HTML, con las entidades `&amp;` ya resueltas como lo hace el navegador. */
function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((m) => (m[1] ?? '').replaceAll('&amp;', '&'));
}

/**
 * Mínimo de plantillas Go para estas plantillas: `{{ if eq .A .B }}…{{ else }}…{{ end }}`
 * y `{{ .Variable }}`, como las resuelve Supabase al enviar.
 */
function renderizar(plantilla: string, datos: Record<string, string>): string {
  const valor = (nombre: string) => datos[nombre] ?? '';
  return plantilla
    .replace(
      /\{\{ if eq \.(\w+) \.(\w+) \}\}(.*?)\{\{ else \}\}(.*?)\{\{ end \}\}/g,
      (_, a: string, b: string, si: string, no: string) => (valor(a) === valor(b) ? si : no),
    )
    .replace(/\{\{ \.(\w+) \}\}/g, (_, nombre: string) => valor(nombre));
}

const SITIO = 'https://boleteame.dev';
const CALLBACK_APP = `${SITIO}/auth/callback?siguiente=%2Fbienvenida`;

describe('PLANTILLAS_AUTH', () => {
  it.each([
    ['confirmation', 'email'],
    ['magic_link', 'magiclink'],
    ['recovery', 'recovery'],
  ] as const)(
    '%s: con redirectTo de la app sigue con &; sin él usa el callback del sitio',
    (nombre, tipo) => {
      const [href] = hrefs(PLANTILLAS_AUTH[nombre].html);
      const desdeApp = renderizar(href ?? '', {
        RedirectTo: CALLBACK_APP,
        SiteURL: SITIO,
        TokenHash: 'h',
      });
      expect(desdeApp).toBe(`${CALLBACK_APP}&token_hash=h&type=${tipo}`);
      // Panel de Supabase o redirectTo no aceptado: Supabase pone la Site URL.
      const sinRedirect = renderizar(href ?? '', {
        RedirectTo: SITIO,
        SiteURL: SITIO,
        TokenHash: 'h',
      });
      expect(sinRedirect).toBe(`${SITIO}/auth/callback?token_hash=h&type=${tipo}`);
    },
  );

  const conRespaldo = (tipo: string) =>
    `{{ if eq .RedirectTo .SiteURL }}{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=${tipo}` +
    `{{ else }}{{ .RedirectTo }}&token_hash={{ .TokenHash }}&type=${tipo}{{ end }}`;

  it.each([
    ['confirmation', conRespaldo('email'), 4],
    ['magic_link', conRespaldo('magiclink'), 4],
    ['recovery', conRespaldo('recovery'), 4],
    [
      'email_change',
      '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email_change',
      2,
    ],
    [
      'invite',
      '{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite&siguiente=/restablecer',
      2,
    ],
  ] as const)('%s enlaza con token_hash al callback', (nombre, enlace, tokens) => {
    const { html } = PLANTILLAS_AUTH[nombre];
    expect(hrefs(html)).toEqual([enlace]);
    // Botón + enlace de respaldo visible (cada uno con sus dos ramas si hay condicional).
    expect(html.split('{{ .TokenHash }}').length - 1).toBe(tokens);
    expect(html).not.toContain('ConfirmationURL');
  });

  it.each(NOMBRES)(
    '%s: ninguna variable queda después de un {{ end }} dentro de un href',
    (nombre) => {
      // html/template no sabe en qué parte de la URL está tras un condicional cuyas ramas
      // terminan distinto: una variable ahí hace fallar el envío («ambiguous context»).
      for (const href of hrefs(PLANTILLAS_AUTH[nombre].html)) {
        const tras = href.split('{{ end }}').slice(1).join('');
        expect(tras).not.toMatch(/\{\{ \./);
      }
    },
  );

  it('reautenticación muestra el código, sin enlaces', () => {
    const { html } = PLANTILLAS_AUTH.reauthentication;
    expect(html).toContain('{{ .Token }}');
    expect(hrefs(html)).toEqual([]);
  });

  it.each(NOMBRES)('%s: tono Timbre (sin exclamaciones ni emoji) y en español', (nombre) => {
    const { asunto, html } = PLANTILLAS_AUTH[nombre];
    const visible = html.replace(/<[^>]*>/g, ' ');
    for (const texto of [asunto, visible]) {
      expect(texto).not.toMatch(/[!¡]/);
      expect(texto).not.toMatch(EMOJI);
    }
    expect(asunto).toContain('Timbre');
    expect(html).toContain('<html lang="es-CL">');
  });

  it.each(NOMBRES)('%s coincide con supabase/templates', async (nombre) => {
    await expect(`${PLANTILLAS_AUTH[nombre].html}\n`).toMatchFileSnapshot(
      `../../../supabase/templates/${nombre}.html`,
    );
  });
});
