import { escapar, estilo } from './html';
import { boton, documento, ESTILO_NOTA, ESTILO_PARRAFO, ESTILO_TITULO } from './plantilla';
import { COLOR, FUENTE_MONO, RADIO } from './tokens';

// Plantillas de los correos que manda Supabase Auth (PLAN-SAAS §4.6, Fase 2). Se pegan
// en el panel (Authentication → Emails) o se generan con `pnpm correos:auth`, que las
// escribe en supabase/templates/. No llevan datos: Supabase reemplaza las variables Go
// ({{ .RedirectTo }}, {{ .TokenHash }}, {{ .Token }}, {{ .Email }}, {{ .NewEmail }},
// {{ .SiteURL }}) al enviar.
//
// Enlaces con token_hash (no {{ .ConfirmationURL }}): el callback los verifica con
// verifyOtp, así funcionan aunque el correo se abra en otro navegador (sin el verificador
// PKCE). Los flujos que inicia la app pasan `redirectTo` =
// `${NEXT_PUBLIC_APP_URL}/auth/callback?siguiente=…`, que ya trae `?`: por eso el enlace
// sigue con `&`. Si no hay `redirectTo` aceptado (correo enviado desde el panel, o una URL
// que no está en Redirect URLs), {{ .RedirectTo }} vale la Site URL y el enlace usa
// `{{ .SiteURL }}/auth/callback?…` (ver `enlaceRedirect`).
//
// El cambio de correo y la invitación no los inicia la app con `redirectTo` (la
// invitación de Supabase sale del panel; las de organizaciones van por Resend): usan la
// Site URL con la ruta del callback completa.
//
// Mismo tono que el resto de Timbre: español de Chile con tú, sin exclamaciones ni emoji.

export type PlantillaAuth =
  | 'confirmation'
  | 'magic_link'
  | 'recovery'
  | 'email_change'
  | 'invite'
  | 'reauthentication';

export interface CorreoAuth {
  asunto: string;
  html: string;
}

const PIE = 'Timbre · Boletas electrónicas y certificación ante el SII.';

/**
 * Enlace con token_hash para un flujo que la app inicia con `redirectTo`
 * (`…/auth/callback?siguiente=…`, que ya trae `?`). Si el correo sale sin `redirectTo`
 * válido (p. ej. desde el panel de Supabase), Supabase pone la Site URL en
 * {{ .RedirectTo }}: en ese caso se arma la ruta del callback completa.
 *
 * Supabase usa `html/template`: cada rama lleva la URL entera, con el token dentro. Si
 * el condicional cubriera solo el comienzo, {{ .TokenHash }} quedaría en un contexto de
 * URL ambiguo (una rama tras `?`, la otra no) y el envío falla con 500.
 */
function enlaceRedirect(tipo: 'email' | 'magiclink' | 'recovery'): string {
  const resto = `token_hash={{ .TokenHash }}&type=${tipo}`;
  return `{{ if eq .RedirectTo .SiteURL }}{{ .SiteURL }}/auth/callback?${resto}{{ else }}{{ .RedirectTo }}&${resto}{{ end }}`;
}

/** Enlace con token_hash sobre la Site URL, para flujos sin `redirectTo` de la app. */
function enlaceSitio(tipo: 'email_change' | 'invite', siguiente?: string): string {
  const resto = siguiente ? `&siguiente=${siguiente}` : '';
  return `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=${tipo}${resto}`;
}

const ESTILO_CAJA_MONO = estilo({
  margin: '0 0 16px',
  padding: '8px 12px',
  background: COLOR.surfaceSunken,
  borderRadius: RADIO.sm,
  fontFamily: FUENTE_MONO,
  fontSize: '12px',
  lineHeight: '18px',
  color: COLOR.ink,
  wordBreak: 'break-all',
});

const ESTILO_CODIGO = estilo({
  margin: '8px 0 24px',
  padding: '12px 16px',
  background: COLOR.surfaceSunken,
  borderRadius: RADIO.md,
  fontFamily: FUENTE_MONO,
  fontSize: '24px',
  lineHeight: '32px',
  fontWeight: 600,
  letterSpacing: '4px',
  color: COLOR.ink,
  display: 'inline-block',
});

interface Contenido {
  asunto: string;
  titulo: string;
  /** Párrafos antes del botón (texto plano; se escapa). */
  parrafos: string[];
  accion: { texto: string; enlace: string } | { codigo: string };
  /** Notas después del botón (texto plano; se escapa). */
  notas: string[];
}

function armar({ asunto, titulo, parrafos, accion, notas }: Contenido): CorreoAuth {
  const partes = [
    `<h1 style="${ESTILO_TITULO}">${escapar(titulo)}</h1>`,
    ...parrafos.map((p) => `<p style="${ESTILO_PARRAFO}">${escapar(p)}</p>`),
  ];
  if ('enlace' in accion) {
    partes.push(
      boton(accion.enlace, accion.texto),
      `<p style="${ESTILO_NOTA}">${escapar('Si el botón no funciona, copia este enlace en tu navegador:')}</p>`,
      `<p style="${ESTILO_CAJA_MONO}">${escapar(accion.enlace)}</p>`,
    );
  } else {
    partes.push(`<p style="${ESTILO_CODIGO}">${escapar(accion.codigo)}</p>`);
  }
  partes.push(...notas.map((n) => `<p style="${ESTILO_NOTA}">${escapar(n)}</p>`));

  const html = documento({
    titulo: asunto,
    previa: parrafos[0] ?? titulo,
    cuerpo: partes.join('\n'),
    pie: escapar(PIE),
  });
  return { asunto, html };
}

const UNA_VEZ = 'El enlace sirve una sola vez y vence en 1 hora.';

export const PLANTILLAS_AUTH: Record<PlantillaAuth, CorreoAuth> = {
  confirmation: armar({
    asunto: 'Confirma tu correo en Timbre',
    titulo: 'Confirma tu correo',
    parrafos: [
      'Creaste una cuenta en Timbre con {{ .Email }}. Confirma que este correo es tuyo para empezar a usarla.',
    ],
    accion: { texto: 'Confirmar correo', enlace: enlaceRedirect('email') },
    notas: [
      `${UNA_VEZ} Si venció, vuelve a crear la cuenta con el mismo correo y te enviaremos otro.`,
      'Si no creaste esta cuenta, ignora este correo: sin confirmar no se puede usar.',
    ],
  }),

  magic_link: armar({
    asunto: 'Tu enlace para ingresar a Timbre',
    titulo: 'Ingresa a Timbre',
    parrafos: ['Pediste un enlace para ingresar a Timbre con {{ .Email }}, sin contraseña.'],
    accion: { texto: 'Ingresar a Timbre', enlace: enlaceRedirect('magiclink') },
    notas: [
      `${UNA_VEZ} Si venció, pide otro desde la pantalla de ingreso.`,
      'Si no lo pediste, ignora este correo: nadie puede ingresar sin abrir el enlace.',
    ],
  }),

  recovery: armar({
    asunto: 'Restablece tu contraseña de Timbre',
    titulo: 'Restablece tu contraseña',
    parrafos: [
      'Pediste restablecer la contraseña de la cuenta {{ .Email }}. Abre el enlace y elige una nueva.',
    ],
    accion: { texto: 'Elegir una contraseña nueva', enlace: enlaceRedirect('recovery') },
    notas: [
      `${UNA_VEZ} Si venció, pide otro en «¿Olvidaste tu contraseña?».`,
      'Si no lo pediste, ignora este correo: tu contraseña actual sigue funcionando.',
    ],
  }),

  email_change: armar({
    asunto: 'Confirma el cambio de correo en Timbre',
    titulo: 'Confirma el cambio de correo',
    parrafos: [
      'Pediste cambiar el correo de tu cuenta de Timbre de {{ .Email }} a {{ .NewEmail }}. Confirma el cambio desde este enlace.',
    ],
    accion: { texto: 'Confirmar el cambio', enlace: enlaceSitio('email_change') },
    notas: [
      `${UNA_VEZ} El cambio se aplica cuando lo confirmas desde los dos correos.`,
      'Si no lo pediste, ignora este correo y cambia tu contraseña: alguien podría tener acceso a tu cuenta.',
    ],
  }),

  invite: armar({
    asunto: 'Te invitaron a Timbre',
    titulo: 'Te invitaron a Timbre',
    parrafos: [
      'Te crearon una cuenta en Timbre con {{ .Email }}. Timbre emite boletas electrónicas y lleva la certificación ante el SII en un solo lugar.',
    ],
    accion: {
      texto: 'Aceptar y elegir contraseña',
      enlace: enlaceSitio('invite', '/restablecer'),
    },
    notas: [
      UNA_VEZ,
      'Si no esperabas esta invitación, ignora este correo: la cuenta no se usa hasta que la aceptes.',
    ],
  }),

  reauthentication: armar({
    asunto: 'Tu código de verificación de Timbre',
    titulo: 'Confirma que eres tú',
    parrafos: ['Para continuar con el cambio en tu cuenta de Timbre, ingresa este código:'],
    accion: { codigo: '{{ .Token }}' },
    notas: [
      'El código sirve una sola vez y vence en 1 hora.',
      'Si no lo pediste, ignora este correo y cambia tu contraseña.',
    ],
  }),
};
