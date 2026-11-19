# Cliente de ejemplo de la API de Boletéame

Tres archivos en Node.js puro (≥ 22), sin dependencias, para probar la API pública y los
webhooks (PLAN-SAAS, Fase 11). Documentación completa: <https://boleteame.dev/docs/api>.

| Archivo | Qué hace |
|---|---|
| `emitir.mjs` | Emite una boleta 39 de $ 1.190, la repite con la misma `Idempotency-Key`, comprueba que no se duplicó (mismo status, mismo documento y folio, `Idempotent-Replayed: true`) y consulta el documento. Con `--conflicto`, además envía otra boleta con la misma clave y espera `422 idempotencia_conflicto`. |
| `receptor.mjs` | Servidor HTTP que recibe los webhooks, verifica la firma y escribe una línea JSON por entrega (`evento`, `entrega`, `intento`, `firma: válida/inválida`, `documento_id`, `folio`). |
| `verificar-firma.mjs` | Verificación de `Boleteame-Firma` para copiar en tu sistema. |

> `emitir.mjs` **emite de verdad**: consume un folio del ambiente de la clave. Usa una
> clave `sk_test_…` (certificación) para probar.

## Emitir

```sh
BOLETEAME_API_KEY=sk_test_… node scripts/ejemplo-api/emitir.mjs
# Si la clave sirve para todas las empresas, indica cuál:
BOLETEAME_API_KEY=sk_test_… BOLETEAME_EMPRESA=76354771-K node scripts/ejemplo-api/emitir.mjs --conflicto
```

`--clave=<valor>` fija la `Idempotency-Key` (por defecto `ejemplo-<fecha y hora>`):
volver a correr el script con la misma clave no emite otra boleta. `BOLETEAME_URL` cambia
la base (por defecto `https://boleteame.dev/api/v1`). El script nunca imprime la API key y
termina con código 0 si todas las comprobaciones pasan.

## Recibir webhooks

```sh
BOLETEAME_WEBHOOK_SECRET=whsec_… PORT=3000 node scripts/ejemplo-api/receptor.mjs
```

El secreto `whsec_…` se muestra una sola vez al crear el webhook (o al rotarlo) en
Configuración → Webhooks. El receptor responde 200 si la firma es válida y 400 si no;
todo lo que no sea 2xx se reintenta (1 min, 5 min, 30 min, 2 h, 6 h, 12 h y 24 h; se
descarta después del intento 8).

Boletéame solo entrega a URL **públicas https en el puerto 443** (sin IP literal ni
dominios locales), así que el receptor necesita algo que publique su puerto:

- **Vercel Sandbox** (lo que se usó para el criterio de aceptación): un sandbox con el
  puerto 3000 expuesto, `receptor.mjs` y `verificar-firma.mjs` subidos, y el comando
  anterior corriendo. La URL del sandbox es la del webhook.
- **Túnel local:** `cloudflared tunnel --url http://localhost:3000` entrega una URL
  `https://….trycloudflare.com`.

No uses servicios de inspección de terceros para datos reales: el cuerpo trae datos
tributarios de tus boletas.

## Verificar la firma en tu sistema

```js
import { verificarFirma } from './verificar-firma.mjs';

// `cuerpo` tiene que ser el cuerpo crudo (Buffer o string), antes de JSON.parse.
const r = verificarFirma({ cuerpo, cabecera: req.headers['boleteame-firma'], secreto });
if (!r.ok) return responder(400); // r.motivo: cabecera_invalida | fuera_de_tolerancia | firma_invalida
```

La firma es `t=<segundos unix>,v1=<hex de HMAC-SHA256(secreto, "<t>.<cuerpo>")>`. Rechaza
las firmas con `t` de más de 5 minutos y deduplica por el `id` del cuerpo, que es el
mismo en todos los intentos de una entrega.
