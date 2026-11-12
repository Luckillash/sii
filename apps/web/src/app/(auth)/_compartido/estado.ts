import type { ErroresCampos } from './esquemas';

/** Lo que devuelven las Server Actions de las pantallas de acceso a `useActionState`. */
export interface EstadoAuth {
  /** Errores por campo (qué pasó y qué hacer). */
  errores?: ErroresCampos;
  /** Error general del formulario. */
  mensaje?: string;
  /** El correo salió (o se responde como si hubiera salido): pantalla «Revisa tu correo». */
  enviado?: { tipo: 'enlace' | 'confirmacion' | 'recuperacion'; correo: string };
  /** `/restablecer` sin sesión de recuperación. */
  sinSesion?: boolean;
}

export const ESTADO_INICIAL: EstadoAuth = {};
