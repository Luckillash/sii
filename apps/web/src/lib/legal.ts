import { formatearRut } from './formatos';

// Datos del responsable de Boletéame para los términos y la política de privacidad
// (PLAN-SAAS Fase 12). Puro: lo usan las páginas de `/legal` y sus pruebas.
//
// Mientras un campo sea `null`, las páginas muestran un texto neutro («el titular de
// Boletéame», «escríbenos desde la página de contacto») y nunca un marcador entre
// corchetes. Completar aquí cuando estén los datos definitivos.

export interface DatosResponsable {
  /** Razón social o nombre de la persona titular del servicio. */
  razonSocial: string | null;
  /** RUT con o sin puntos; se muestra como `76.354.771-K`. */
  rut: string | null;
  /** Domicilio legal: calle, número y comuna. */
  domicilio: string | null;
  /** Correo de contacto general (soporte y consultas sobre los términos). */
  correoContacto: string | null;
  /** Correo para ejercer los derechos sobre datos personales. Si falta, se usa `correoContacto`. */
  correoPrivacidad: string | null;
}

export const RESPONSABLE: DatosResponsable = {
  razonSocial: null,
  rut: null,
  domicilio: null,
  correoContacto: null,
  correoPrivacidad: null,
};

/** Fecha desde la que rigen los términos (`AAAA-MM-DD`). */
export const VIGENCIA_TERMINOS = '2026-11-19';

/** Fecha desde la que rige la política de privacidad (`AAAA-MM-DD`). */
export const VIGENCIA_PRIVACIDAD = '2026-11-19';

export const RUTA_CONTACTO = '/contacto';

const TITULAR_NEUTRO = 'el titular de Boletéame';

function limpio(valor: string | null | undefined): string | null {
  const texto = valor?.trim();
  return texto ? texto : null;
}

function capitalizar(texto: string): string {
  return texto.charAt(0).toLocaleUpperCase('es-CL') + texto.slice(1);
}

/**
 * Cómo se nombra al titular en una frase: la razón social si existe; si no, «el titular
 * de Boletéame» (con mayúscula si `inicio`).
 */
export function nombreTitular(
  responsable: DatosResponsable = RESPONSABLE,
  opciones: { inicio?: boolean } = {},
): string {
  const razon = limpio(responsable.razonSocial);
  if (razon) return razon;
  return opciones.inicio ? capitalizar(TITULAR_NEUTRO) : TITULAR_NEUTRO;
}

/**
 * Identificación completa para la cláusula de responsable: «Razón SpA, RUT 76.354.771-K,
 * con domicilio en Calle 123, Santiago». Solo agrega los datos que existen; sin razón
 * social, empieza con «el titular de Boletéame».
 */
export function identificacionTitular(
  responsable: DatosResponsable = RESPONSABLE,
  opciones: { inicio?: boolean } = {},
): string {
  const partes = [nombreTitular(responsable, opciones)];
  const rut = limpio(responsable.rut);
  if (rut) partes.push(`RUT ${formatearRut(rut)}`);
  const domicilio = limpio(responsable.domicilio);
  if (domicilio) partes.push(`con domicilio en ${domicilio}`);
  return partes.join(', ');
}

export type MotivoContacto = 'general' | 'privacidad';

/** Un canal de contacto listo para una frase: «escríbenos a <correo>» o «escríbenos desde <la página de contacto>». */
export interface CanalContacto {
  /** Texto antes del enlace, con el espacio final. */
  antes: string;
  /** Texto del enlace. */
  texto: string;
  href: string;
  tipo: 'correo' | 'formulario';
}

/**
 * Canal para escribirnos. Para `privacidad` usa `correoPrivacidad` y, si falta,
 * `correoContacto`; sin ninguno, la página de contacto.
 */
export function canalContacto(
  motivo: MotivoContacto = 'general',
  responsable: DatosResponsable = RESPONSABLE,
  opciones: { inicio?: boolean } = {},
): CanalContacto {
  const verbo = opciones.inicio ? 'Escríbenos' : 'escríbenos';
  const correo =
    motivo === 'privacidad'
      ? (limpio(responsable.correoPrivacidad) ?? limpio(responsable.correoContacto))
      : limpio(responsable.correoContacto);
  if (correo) {
    return { antes: `${verbo} a `, texto: correo, href: `mailto:${correo}`, tipo: 'correo' };
  }
  return {
    antes: `${verbo} desde `,
    texto: 'la página de contacto',
    href: RUTA_CONTACTO,
    tipo: 'formulario',
  };
}

/** El canal como texto plano (metadatos, pruebas). */
export function textoCanal(canal: CanalContacto): string {
  return `${canal.antes}${canal.texto}`;
}

const ETIQUETA_CAMPO: Record<keyof DatosResponsable, string> = {
  razonSocial: 'razón social',
  rut: 'RUT',
  domicilio: 'domicilio',
  correoContacto: 'correo de contacto',
  correoPrivacidad: 'correo de privacidad',
};

/** Campos de `RESPONSABLE` que faltan por completar (para revisarlos antes de publicar). */
export function camposPendientes(
  responsable: DatosResponsable = RESPONSABLE,
): (keyof DatosResponsable)[] {
  return (Object.keys(ETIQUETA_CAMPO) as (keyof DatosResponsable)[]).filter(
    (campo) => limpio(responsable[campo]) === null,
  );
}

export function etiquetaCampo(campo: keyof DatosResponsable): string {
  return ETIQUETA_CAMPO[campo];
}
