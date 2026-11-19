import { urlSitio } from '@/lib/sitio';
import { construirJsonLd, type PlanJsonLd, serializarJsonLd } from './json-ld';

// Datos estructurados (schema.org) de la landing: `Organization` + `SoftwareApplication`
// con las ofertas en CLP. Server Component sin estado; va una sola vez, en `/`:
//
//   import { JsonLd } from '../_seo/JsonLd';
//   …
//   <JsonLd planes={grilla.tarjetas} />   // o <JsonLd /> con los precios de respaldo
//
// El JSON va escapado (`serializarJsonLd`): ningún texto puede cerrar el `<script>`.

export function JsonLd({ planes }: { planes?: readonly PlanJsonLd[] }) {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: JSON propio, con `<`, `>` y `&` escapados.
      dangerouslySetInnerHTML={{ __html: serializarJsonLd(construirJsonLd(urlSitio(), planes)) }}
    />
  );
}
