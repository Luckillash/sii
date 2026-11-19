import { DESCRIPCION_SITIO, NOMBRE_SITIO, urlAbsoluta } from '@/lib/sitio';

// Datos estructurados de la landing (PLAN-SAAS Fase 12): `Organization` y
// `SoftwareApplication` con un `Offer` en CLP por plan con precio. Puro; el componente
// `JsonLd.tsx` lo inserta en un `<script type="application/ld+json">`.

/** Lo mínimo de un plan para ofrecerlo (calza con `Plan` de `lib/planes.ts`). */
export interface PlanJsonLd {
  codigo: string;
  nombre: string;
  precio_mensual_clp: number;
}

/**
 * Planes con precio de la grilla D5 (`0015_planes_comerciales`), por si la página no
 * pasa los que leyó de `planes`. Certificación (gratis, sin producción) y Empresa (a
 * medida) no llevan oferta.
 */
export const PLANES_JSON_LD: readonly PlanJsonLd[] = [
  { codigo: 'pyme', nombre: 'Pyme', precio_mensual_clp: 14990 },
  { codigo: 'contador', nombre: 'Contador', precio_mensual_clp: 49990 },
  { codigo: 'api', nombre: 'API', precio_mensual_clp: 39990 },
];

export type ObjetoJsonLd = Record<string, unknown>;

export function construirJsonLd(
  base: string,
  planes: readonly PlanJsonLd[] = PLANES_JSON_LD,
): ObjetoJsonLd {
  const inicio = urlAbsoluta('/', base);
  const idOrganizacion = `${inicio}#organizacion`;
  const precios = urlAbsoluta('/#precios', base);

  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': idOrganizacion,
        name: NOMBRE_SITIO,
        url: inicio,
        logo: urlAbsoluta('/apple-icon', base),
      },
      {
        '@type': 'SoftwareApplication',
        '@id': `${inicio}#aplicacion`,
        name: NOMBRE_SITIO,
        url: inicio,
        description: DESCRIPCION_SITIO,
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        inLanguage: 'es-CL',
        publisher: { '@id': idOrganizacion },
        offers: planes
          .filter((p) => p.precio_mensual_clp > 0)
          .map((p) => ({
            '@type': 'Offer',
            name: `Plan ${p.nombre}`,
            price: p.precio_mensual_clp,
            priceCurrency: 'CLP',
            url: precios,
            priceSpecification: {
              '@type': 'UnitPriceSpecification',
              price: p.precio_mensual_clp,
              priceCurrency: 'CLP',
              billingDuration: 'P1M',
              unitText: 'mes',
            },
          })),
      },
    ],
  };
}

/**
 * JSON para un `<script>` en el HTML: escapa `<`, `>` y `&` (y los separadores de línea
 * U+2028/U+2029) como `\uXXXX`, para que un texto con `</script>` no cierre la etiqueta.
 * Sigue siendo el mismo JSON al parsearlo.
 */
export function serializarJsonLd(datos: ObjetoJsonLd): string {
  return JSON.stringify(datos).replace(
    /[<>&\u2028\u2029]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
}
