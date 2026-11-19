import type { Plan } from './planes';

// Grilla de precios del sitio público (PLAN-SAAS Fase 12, D5). Puro: la landing lee la
// tabla `planes` (las activas, con el cliente anónimo) y esto la ordena y la reparte en
// el plan gratis de certificación, las tarjetas con precio y el plan a medida. Si la
// lectura falla o viene vacía se usa `PLANES_RESPALDO`, con los mismos valores que deja
// `0015_planes_comerciales` (una prueba los compara con la migración).

/** Copia de la grilla D5 para cuando no se puede leer `planes`. */
export const PLANES_RESPALDO: readonly Plan[] = [
  {
    id: 'respaldo-certificacion',
    codigo: 'certificacion',
    nombre: 'Certificación',
    precio_mensual_clp: 0,
    max_empresas: 1,
    max_usuarios: 2,
    max_boletas_mes: 0,
    permite_produccion: false,
    incluye_api: false,
    incluye_webhooks: false,
    autoservicio: false,
    orden: 0,
  },
  {
    id: 'respaldo-pyme',
    codigo: 'pyme',
    nombre: 'Pyme',
    precio_mensual_clp: 14990,
    max_empresas: 1,
    max_usuarios: 3,
    max_boletas_mes: 1000,
    permite_produccion: true,
    incluye_api: false,
    incluye_webhooks: false,
    autoservicio: true,
    orden: 1,
  },
  {
    id: 'respaldo-contador',
    codigo: 'contador',
    nombre: 'Contador',
    precio_mensual_clp: 49990,
    max_empresas: 15,
    max_usuarios: 10,
    max_boletas_mes: 10000,
    permite_produccion: true,
    incluye_api: false,
    incluye_webhooks: false,
    autoservicio: true,
    orden: 2,
  },
  {
    id: 'respaldo-api',
    codigo: 'api',
    nombre: 'API',
    precio_mensual_clp: 39990,
    max_empresas: 3,
    max_usuarios: 5,
    max_boletas_mes: 20000,
    permite_produccion: true,
    incluye_api: true,
    incluye_webhooks: true,
    autoservicio: true,
    orden: 3,
  },
  {
    id: 'respaldo-empresa',
    codigo: 'empresa',
    nombre: 'Empresa',
    precio_mensual_clp: 0,
    max_empresas: null,
    max_usuarios: null,
    max_boletas_mes: null,
    permite_produccion: true,
    incluye_api: true,
    incluye_webhooks: true,
    autoservicio: false,
    orden: 4,
  },
];

/** El plan que la grilla destaca, con su etiqueta. */
export const PLAN_DESTACADO = { codigo: 'contador', etiqueta: 'Varias empresas' } as const;

/** Para quién es cada plan con precio (si el código no está, la tarjeta va sin bajada). */
export const DESCRIPCION_PLAN: Readonly<Record<string, string>> = {
  pyme: 'Para una empresa que emite boletas desde el navegador.',
  contador:
    'Para estudios contables que llevan a varios clientes. Las boletas del mes se comparten entre todas las empresas.',
  api: 'Para integrar la emisión de boletas a tu propio sistema.',
};

export interface GrillaPublica {
  /** Plan gratis para certificarse (sin producción). */
  certificacion: Plan | null;
  /** Planes que se contratan solos, con precio, en el orden de la grilla. */
  tarjetas: Plan[];
  /** Plan a medida (lo asigna ventas): «Hablar con ventas». */
  aMedida: Plan | null;
}

/** Por `orden`, luego por precio y por código (para que el resultado sea estable). */
export function ordenarPlanes(planes: readonly Plan[]): Plan[] {
  return [...planes].sort(
    (a, b) =>
      a.orden - b.orden ||
      a.precio_mensual_clp - b.precio_mensual_clp ||
      a.codigo.localeCompare(b.codigo),
  );
}

function esCertificacion(p: Plan): boolean {
  return p.codigo === 'certificacion' || (!p.permite_produccion && p.precio_mensual_clp === 0);
}

export function armarGrilla(planes: readonly Plan[]): GrillaPublica {
  const ordenados = ordenarPlanes(planes);
  return {
    certificacion: ordenados.find(esCertificacion) ?? null,
    tarjetas: ordenados.filter(
      (p) => p.autoservicio && p.permite_produccion && p.precio_mensual_clp > 0,
    ),
    aMedida: ordenados.find((p) => !p.autoservicio && p.permite_produccion) ?? null,
  };
}

/**
 * La grilla a partir de lo leído de `planes`. Sin filas, o sin ningún plan con precio
 * (p. ej. RLS devolvió vacío), usa el respaldo y lo indica para avisar a Sentry.
 */
export function grillaPublica(filas: readonly Plan[] | null | undefined): {
  grilla: GrillaPublica;
  respaldo: boolean;
} {
  if (filas && filas.length > 0) {
    const grilla = armarGrilla(filas);
    if (grilla.tarjetas.length > 0) return { grilla, respaldo: false };
  }
  return { grilla: armarGrilla(PLANES_RESPALDO), respaldo: true };
}

const plural = (n: number, uno: string, varios: string) =>
  `${n.toLocaleString('es-CL')} ${n === 1 ? uno : varios}`;

function enumerar(partes: readonly string[]): string {
  if (partes.length <= 1) return partes.join('');
  return `${partes.slice(0, -1).join(', ')} y ${partes.at(-1)}`;
}

/** «Para volúmenes mayores: empresas, usuarios y boletas sin límite, con API y webhooks.» */
export function textoPlanAMedida(plan: Plan): string {
  const sinLimite = [
    plan.max_empresas === null ? 'empresas' : null,
    plan.max_usuarios === null ? 'usuarios' : null,
    plan.max_boletas_mes === null ? 'boletas' : null,
  ].filter((p): p is string => p !== null);
  const conApi =
    plan.incluye_api && plan.incluye_webhooks
      ? 'con API y webhooks'
      : plan.incluye_api
        ? 'con API'
        : null;
  const detalle = [sinLimite.length > 0 ? `${enumerar(sinLimite)} sin límite` : null, conApi]
    .filter((p): p is string => p !== null)
    .join(', ');
  return detalle ? `Para volúmenes mayores: ${detalle}.` : 'Para volúmenes mayores.';
}

/** «Gratis y sin plazo, con 1 empresa y 2 usuarios.» */
export function textoPlanCertificacion(plan: Plan): string {
  const partes = [
    plan.max_empresas === null ? null : plural(plan.max_empresas, 'empresa', 'empresas'),
    plan.max_usuarios === null ? null : plural(plan.max_usuarios, 'usuario', 'usuarios'),
  ].filter((p): p is string => p !== null);
  return partes.length > 0 ? `Gratis y sin plazo, con ${enumerar(partes)}.` : 'Gratis y sin plazo.';
}
