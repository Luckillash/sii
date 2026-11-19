---
title: "Ejemplos de código"
description: "Snippets supabase-js (panel) y Node con service_role + librería (backend). Hoy cubre la API pública: emitir con Idempotency-Key, paginar, descargar el PDF y verificar la firma de un webhook (Fase 11)."
keywords: [ejemplos, API pública, curl, fetch, Idempotency-Key, Idempotent-Replayed, cursor, siguiente_cursor, webhook, Boleteame-Firma, verificarFirma, HMAC-SHA256, scripts/ejemplo-api, emitir.mjs, receptor.mjs, verificar-firma.mjs, Fase 11]
related: ["02-guias/emision-boletas.md", "02-guias/api-publica.md", "06-integraciones/webhooks.md", "06-integraciones/api-keys.md"]
source: ["supabase_saas_sii.sql", "certificacion-node/docs/guia-de-uso.md", "scripts/ejemplo-api/", "apps/web/src/lib/openapi-v1.ts"]
---

# Ejemplos de código

> **Úsalo cuando:** quieres copiar un ejemplo listo.

<!-- TODO: snippets de supabase-js para el panel y de service_role + librería para el backend (Fases 2–8). -->

## API pública (Fase 11)

Ejemplos completos y ejecutables en `scripts/ejemplo-api/` (Node ≥ 22, sin dependencias;
[README](../../scripts/ejemplo-api/README.md)). Los de `curl` de cada ruta están en
`/docs/api` y en `x-ejemplo` de `lib/openapi-v1.ts`.

### Emitir una boleta con idempotencia (Node)

```js
const respuesta = await fetch('https://boleteame.dev/api/v1/documentos', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${process.env.BOLETEAME_API_KEY}`,
    'Content-Type': 'application/json',
    // Una por venta: si la conexión se corta, repite con la MISMA clave.
    'Idempotency-Key': `venta-${venta.id}`,
  },
  body: JSON.stringify({
    tipo_dte: 39,
    receptor: { rut: '', correo: venta.correo ?? null }, // rut vacío = Cliente General
    lineas: venta.items.map((i) => ({ nombre: i.nombre, cantidad: i.cantidad, precio: i.precioBruto })),
  }),
});
const cuerpo = await respuesta.json();
if (respuesta.status === 201) {
  // Emitida y enviada al SII: el resultado llega por webhook (documento.aceptado / rechazado).
  guardar(venta.id, cuerpo.id, cuerpo.folio);
} else if (respuesta.status === 202) {
  // Incierta: NO la emitas con otra clave. Revísala en el panel o espera el webhook.
} else if (respuesta.status === 409 || respuesta.status === 503) {
  // Repite más tarde con la misma Idempotency-Key (Retry-After dice cuánto esperar).
} else {
  console.error(cuerpo.error.codigo, cuerpo.error.mensaje, cuerpo.error.campos);
}
```

`respuesta.headers.get('Idempotent-Replayed') === 'true'` indica que es la respuesta
guardada de una petición anterior con esa clave.

### Recorrer un listado con cursor

```js
let cursor = null;
do {
  const url = new URL('https://boleteame.dev/api/v1/documentos');
  url.searchParams.set('estado', 'aceptado');
  url.searchParams.set('limite', '100');
  if (cursor) url.searchParams.set('cursor', cursor);
  const r = await fetch(url, { headers: { Authorization: `Bearer ${clave}` } });
  const pagina = await r.json();
  for (const documento of pagina.datos) procesar(documento);
  cursor = pagina.tiene_mas ? pagina.siguiente_cursor : null;
} while (cursor);
```

### Descargar el PDF en rollo

```sh
curl -o boleta.pdf "https://boleteame.dev/api/v1/documentos/<id>/pdf?formato=rollo" \
  -H "Authorization: Bearer $BOLETEAME_API_KEY"
```

### Recibir un webhook y verificar la firma (Node, `node:http`)

```js
import { createServer } from 'node:http';
import { verificarFirma } from './verificar-firma.mjs'; // scripts/ejemplo-api/

createServer((req, res) => {
  const partes = [];
  req.on('data', (p) => partes.push(p));
  req.on('end', () => {
    const cuerpo = Buffer.concat(partes); // crudo: la firma es sobre estos bytes
    const r = verificarFirma({
      cuerpo,
      cabecera: req.headers['boleteame-firma'],
      secreto: process.env.BOLETEAME_WEBHOOK_SECRET,
    });
    if (!r.ok) return res.writeHead(400).end(); // cabecera_invalida | fuera_de_tolerancia | firma_invalida
    const evento = JSON.parse(cuerpo.toString('utf8'));
    if (yaProcesado(evento.id)) return res.writeHead(200).end(); // deduplicar por id
    encolarParaProcesar(evento); // responde rápido: hay 10 s
    res.writeHead(200).end();
  });
}).listen(3000);
```

Con Express u otro framework, lee el cuerpo **crudo** (por ejemplo `express.raw({ type:
'application/json' })`) antes de verificar: si el framework ya parseó el JSON, volver a
serializarlo puede cambiar los bytes y la firma no calza.
