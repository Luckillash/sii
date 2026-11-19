import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import {
  ALCANCES_OFRECIDOS,
  CABECERA_IDEMPOTENCIA,
  CABECERA_REPETIDA,
  CABECERAS_WEBHOOK,
  CODIGOS_ERROR,
  type CodigoError,
  DESCRIPCION_ALCANCE,
  DESCRIPCION_EVENTO,
  ESPERAS_WEBHOOK_MIN,
  ETIQUETA_ESTADO_ENTREGA,
  EVENTO_PRUEBA,
  EVENTOS_WEBHOOK,
  LIMITE_LOTE,
  LIMITE_PAGINA,
  LIMITE_PAGINA_MAXIMO,
  MAX_INTENTOS_WEBHOOK,
  MENSAJES_ERROR,
  TIMEOUT_ENTREGA_MS,
  TOLERANCIA_FIRMA_S,
  URL_API,
} from '@/lib/api-publica';
import { type MetodoOpenApi, type OperacionOpenApi, RUTAS_V1 } from '@/lib/openapi-v1';
import styles from './docs.module.css';

// Documentación pública de la API v1 (PLAN-SAAS Fase 11). Estática y sin librerías: los
// endpoints salen del mismo objeto que sirve /api/v1/openapi.json, y los códigos de error,
// alcances, eventos y límites, del contrato `lib/api-publica.ts`.

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Documentación de la API',
  description:
    'Emite boletas electrónicas ante el SII desde tu sistema: API REST con idempotencia y webhooks firmados.',
};

const SECCIONES: [string, string][] = [
  ['autenticacion', 'Autenticación'],
  ['ambientes', 'Ambientes y empresas'],
  ['idempotencia', 'Idempotencia'],
  ['errores', 'Errores'],
  ['paginacion', 'Paginación'],
  ['limites', 'Límites'],
  ['endpoints', 'Endpoints'],
  ['webhooks', 'Webhooks'],
];

const ETIQUETA_METODO: Record<MetodoOpenApi, string> = { get: 'GET', post: 'POST' };

function anclaDe(metodo: MetodoOpenApi, ruta: string): string {
  return `${metodo}-${ruta
    .replace(/[{}]/g, '')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/-+$/, '')}`;
}

function formatearEspera(minutos: number): string {
  return minutos < 60 ? `${minutos} min` : `${minutos / 60} h`;
}

function Codigo({ children }: { children: ReactNode }) {
  return <code className={styles.codigo}>{children}</code>;
}

/**
 * Bloque de código con desplazamiento horizontal. Es una región con nombre y enfocable para
 * que se pueda desplazar con el teclado (regla `scrollable-region-focusable` de axe).
 */
function Bloque({ children, etiqueta }: { children: string; etiqueta: string }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: región desplazable; axe exige que se pueda enfocar para desplazarla con el teclado
    <section className={styles.bloque} aria-label={etiqueta} tabIndex={0}>
      <pre className={styles.bloquePre}>
        <code>{children}</code>
      </pre>
    </section>
  );
}

function nombreEsquema(op: OperacionOpenApi): string | null {
  const schema = op.requestBody?.content['application/json']?.schema;
  const ref = typeof schema?.$ref === 'string' ? schema.$ref : null;
  return ref ? (ref.split('/').pop() ?? null) : null;
}

function Endpoint({
  metodo,
  ruta,
  op,
}: {
  metodo: MetodoOpenApi;
  ruta: string;
  op: OperacionOpenApi;
}) {
  const exitos = Object.entries(op.responses).filter(([s]) => Number(s) < 400);
  const errores = op['x-errores'];
  const cuerpo = nombreEsquema(op);
  return (
    <article className={styles.endpoint} id={anclaDe(metodo, ruta)}>
      <h3 className={styles.endpointTitulo}>
        <span className={styles.metodo} data-metodo={metodo}>
          {ETIQUETA_METODO[metodo]}
        </span>
        <span className={styles.ruta}>{ruta}</span>
      </h3>
      <p className={styles.resumen}>{op.summary}</p>
      <p>{op.description}</p>
      <p className={styles.meta}>
        {op['x-alcance'] ? (
          <>
            Alcance: <Codigo>{op['x-alcance']}</Codigo>
          </>
        ) : (
          'Pública: no exige API key.'
        )}
        {cuerpo ? (
          <>
            {' · '}Cuerpo: <Codigo>{cuerpo}</Codigo> (ver la especificación)
          </>
        ) : null}
      </p>
      {op.parameters && op.parameters.length > 0 ? (
        <div className={styles.tablaContenedor}>
          <table className={styles.tabla}>
            <caption className={styles.oculto}>Parámetros de {ruta}</caption>
            <thead>
              <tr>
                <th scope="col">Parámetro</th>
                <th scope="col">Dónde</th>
                <th scope="col">Descripción</th>
              </tr>
            </thead>
            <tbody>
              {op.parameters.map((p) => (
                <tr key={`${p.in}-${p.name}`}>
                  <td>
                    <Codigo>{p.name}</Codigo>
                    {p.required ? <span className={styles.obligatorio}> obligatorio</span> : null}
                  </td>
                  <td>{p.in === 'path' ? 'ruta' : p.in === 'query' ? 'consulta' : 'cabecera'}</td>
                  <td>{p.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      <ul className={styles.respuestas}>
        {exitos.map(([status, r]) => (
          <li key={status}>
            <Codigo>{status}</Codigo> {r.description}
          </li>
        ))}
        {errores.length > 0 ? (
          <li>
            Errores posibles:{' '}
            {errores.map((c, i) => (
              <span key={c}>
                {i > 0 ? ', ' : null}
                <a href={`#error-${c}`} className={styles.enlace}>
                  {c}
                </a>
              </span>
            ))}
          </li>
        ) : null}
      </ul>
      <Bloque etiqueta={`Ejemplo de ${ETIQUETA_METODO[metodo]} ${ruta}`}>{op['x-ejemplo']}</Bloque>
    </article>
  );
}

const EJEMPLO_VERIFICACION = `import { createHmac, timingSafeEqual } from 'node:crypto';

// cuerpo: el texto crudo de la petición, ANTES de JSON.parse.
export function verificarFirma(cuerpo, cabecera, secreto, toleranciaSegundos = ${TOLERANCIA_FIRMA_S}) {
  const partes = Object.groupBy((cabecera ?? '').split(','), (p) => p.split('=')[0].trim());
  const t = Number(partes.t?.[0]?.split('=')[1]);
  const firmas = (partes.v1 ?? []).map((p) => p.split('=')[1]?.trim());
  if (!Number.isInteger(t) || firmas.length === 0) return false;
  if (Math.abs(Date.now() / 1000 - t) > toleranciaSegundos) return false;
  const esperada = createHmac('sha256', secreto).update(\`\${t}.\${cuerpo}\`).digest();
  return firmas.some((f) => {
    const recibida = Buffer.from(f ?? '', 'hex');
    return recibida.length === esperada.length && timingSafeEqual(recibida, esperada);
  });
}`;

const EJEMPLO_CUERPO_WEBHOOK = `{
  "id": "1842",
  "evento": "documento.aceptado",
  "creado_en": "2026-11-18T20:05:12.345Z",
  "datos": {
    "documento_id": "6f1c…",
    "empresa_id": "0b7e…",
    "ambiente": "certificacion",
    "tipo_dte": 39,
    "folio": 43,
    "mnt_total": 1190,
    "envio_id": "9a3d…",
    "estado": "aceptado",
    "origen": "api",
    "clave_idempotencia": "venta-000123"
  }
}`;

export default function DocumentacionApi() {
  const rutas = Object.entries(RUTAS_V1).flatMap(([ruta, metodos]) =>
    (Object.entries(metodos) as [MetodoOpenApi, OperacionOpenApi][]).map(([metodo, op]) => ({
      ruta,
      metodo,
      op,
    })),
  );
  const codigos = Object.keys(CODIGOS_ERROR) as CodigoError[];

  return (
    <div className={styles.pagina}>
      <header className={styles.cabecera}>
        <p className={styles.marca}>
          <a href="/" className={styles.enlace}>
            Boletéame
          </a>{' '}
          · Desarrolladores
        </p>
        <h1 className={styles.titulo}>API de Boletéame</h1>
        <p className={styles.bajada}>
          Emite boletas electrónicas (39 y 41) ante el SII desde tu sistema, consulta su estado,
          descarga el XML y el PDF, y recibe un webhook cuando el SII responde. Base:{' '}
          <Codigo>{URL_API}</Codigo>. Especificación OpenAPI 3.1:{' '}
          <a href="/api/v1/openapi.json" className={styles.enlace}>
            /api/v1/openapi.json
          </a>
          .
        </p>
      </header>

      <div className={styles.cuerpo}>
        <nav className={styles.indice} aria-label="Contenido">
          <ol>
            {SECCIONES.map(([id, titulo]) => (
              <li key={id}>
                <a href={`#${id}`} className={styles.enlace}>
                  {titulo}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <main className={styles.contenido}>
          <section id="autenticacion" className={styles.seccion}>
            <h2>Autenticación</h2>
            <p>
              Crea una API key en <strong>Configuración → API</strong> (solo administradores, con un
              plan que incluya API). La clave se muestra una sola vez: guárdala en un gestor de
              secretos. Envíala en cada petición:
            </p>
            <Bloque etiqueta="Cabecera de autenticación">
              {'Authorization: Bearer sk_test_…'}
            </Bloque>
            <p>
              Cada clave tiene alcances. Pide solo los que tu sistema usa; sin el alcance de una
              operación, la API responde <Codigo>403 alcance_insuficiente</Codigo>.
            </p>
            <div className={styles.tablaContenedor}>
              <table className={styles.tabla}>
                <caption className={styles.oculto}>Alcances</caption>
                <thead>
                  <tr>
                    <th scope="col">Alcance</th>
                    <th scope="col">Permite</th>
                  </tr>
                </thead>
                <tbody>
                  {ALCANCES_OFRECIDOS.map((a) => (
                    <tr key={a}>
                      <td>
                        <Codigo>{a}</Codigo>
                      </td>
                      <td>{DESCRIPCION_ALCANCE[a]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p>
              Una clave revocada o vencida deja de funcionar al instante. Es una API de servidor a
              servidor: no la llames desde el navegador ni publiques la clave en una app.
            </p>
          </section>

          <section id="ambientes" className={styles.seccion}>
            <h2>Ambientes y empresas</h2>
            <p>
              El ambiente lo fija la clave: las <Codigo>sk_test_…</Codigo> emiten en{' '}
              <strong>certificación</strong> (el ambiente de pruebas del SII, sin validez
              tributaria) y las <Codigo>sk_live_…</Codigo>, en <strong>producción</strong>. Los
              documentos, folios y envíos de un ambiente no se ven con la clave del otro.
            </p>
            <p>
              Una clave puede servir para una empresa o para todas las de tu organización. Con una
              clave para todas, indica la empresa en el campo <Codigo>empresa</Codigo> del cuerpo (o
              en la consulta) con su RUT (<Codigo>76.354.771-K</Codigo>, con o sin puntos) o su id.
              Con una clave de una empresa, no hace falta.
            </p>
          </section>

          <section id="idempotencia" className={styles.seccion}>
            <h2>Idempotencia</h2>
            <p>
              Emitir boletas exige la cabecera <Codigo>{CABECERA_IDEMPOTENCIA}</Codigo>: una clave
              única por boleta (por ejemplo, el id de la venta en tu sistema), de 1 a 200 caracteres
              ASCII visibles. Si se corta la conexión o no sabes si la boleta salió, repite la
              petición con la <strong>misma</strong> clave: recibes la misma respuesta (mismo
              status, mismo documento y folio) con <Codigo>{CABECERA_REPETIDA}: true</Codigo>, y no
              se emite otra boleta.
            </p>
            <ul className={styles.lista}>
              <li>
                Misma clave con otra boleta: <Codigo>422 idempotencia_conflicto</Codigo>. Usa una
                clave nueva para cada boleta distinta.
              </li>
              <li>
                Misma clave mientras la primera petición sigue en curso:{' '}
                <Codigo>409 idempotencia_en_curso</Codigo> con <Codigo>Retry-After</Codigo>.
              </li>
              <li>
                Un error que no llegó a emitir (datos, folios, cuota, el SII no respondió antes de
                enviar) no se guarda: corrige y repite con la misma clave.
              </li>
              <li>
                En un lote, cada boleta usa la clave <Codigo>{'<clave>#<n>'}</Codigo> (n desde 1).
              </li>
            </ul>
            <p>
              Si la respuesta es <Codigo>202</Codigo> (resultado incierto: no sabemos si el envío
              llegó al SII), <strong>no emitas la boleta otra vez con otra clave</strong>: revísala
              en el panel o espera el webhook. Emitirla de nuevo puede duplicarla ante el SII.
            </p>
          </section>

          <section id="errores" className={styles.seccion}>
            <h2>Errores</h2>
            <p>
              Los errores responden JSON con un código estable y un mensaje que dice qué pasó y qué
              hacer. Programa contra <Codigo>codigo</Codigo>; el mensaje puede cambiar.
            </p>
            <Bloque etiqueta="Ejemplo de error">
              {JSON.stringify(
                {
                  error: {
                    codigo: 'datos_invalidos',
                    mensaje: MENSAJES_ERROR.datos_invalidos,
                    campos: { 'lineas.0.precio': 'El precio va en pesos, sin decimales.' },
                  },
                },
                null,
                2,
              )}
            </Bloque>
            <div className={styles.tablaContenedor}>
              <table className={styles.tabla}>
                <caption className={styles.oculto}>Códigos de error</caption>
                <thead>
                  <tr>
                    <th scope="col">HTTP</th>
                    <th scope="col">Código</th>
                    <th scope="col">Mensaje</th>
                  </tr>
                </thead>
                <tbody>
                  {codigos.map((c) => (
                    <tr key={c} id={`error-${c}`}>
                      <td className={styles.numero}>{CODIGOS_ERROR[c]}</td>
                      <td>
                        <Codigo>{c}</Codigo>
                      </td>
                      <td>{MENSAJES_ERROR[c]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section id="paginacion" className={styles.seccion}>
            <h2>Paginación</h2>
            <p>
              Los listados devuelven{' '}
              <Codigo>{'{ objeto: "lista", datos, tiene_mas, siguiente_cursor }'}</Codigo>, del más
              nuevo al más antiguo. Pide la página siguiente con <Codigo>?cursor=</Codigo> y el
              valor de <Codigo>siguiente_cursor</Codigo>, sin cambiarlo. <Codigo>?limite=</Codigo>{' '}
              va de 1 a {LIMITE_PAGINA_MAXIMO} ({LIMITE_PAGINA} por defecto).
            </p>
          </section>

          <section id="limites" className={styles.seccion}>
            <h2>Límites</h2>
            <ul className={styles.lista}>
              <li>
                Peticiones por minuto: si te pasas, el firewall responde <Codigo>429</Codigo> antes
                de llegar a la API, y su cuerpo no es el JSON de error (no leas{' '}
                <Codigo>error.codigo</Codigo>). Espera unos segundos y repite con la misma{' '}
                <Codigo>Idempotency-Key</Codigo>.
              </li>
              <li>Cuerpo de hasta 256 KB; una boleta admite hasta 100 líneas.</li>
              <li>Lote: hasta {LIMITE_LOTE} boletas por petición.</li>
              <li>
                Las boletas del mes las limita tu plan (<Codigo>403 cuota_agotada</Codigo>) y los
                folios disponibles (<Codigo>422 sin_folios</Codigo>).
              </li>
            </ul>
          </section>

          <section id="endpoints" className={styles.seccion}>
            <h2>Endpoints</h2>
            <ul className={styles.listaEndpoints}>
              {rutas.map(({ ruta, metodo, op }) => (
                <li key={`${metodo} ${ruta}`}>
                  <a href={`#${anclaDe(metodo, ruta)}`} className={styles.enlace}>
                    <span className={styles.metodoCorto}>{ETIQUETA_METODO[metodo]}</span> {ruta}
                  </a>{' '}
                  · {op.summary}
                </li>
              ))}
            </ul>
            {rutas.map(({ ruta, metodo, op }) => (
              <Endpoint key={`${metodo} ${ruta}`} metodo={metodo} ruta={ruta} op={op} />
            ))}
          </section>

          <section id="webhooks" className={styles.seccion}>
            <h2>Webhooks</h2>
            <p>
              Crea un webhook en <strong>Configuración → Webhooks</strong> con una URL pública{' '}
              <Codigo>https://</Codigo> (puerto 443, sin IP ni dominios locales) y los eventos que
              te interesan. El secreto <Codigo>whsec_…</Codigo> se muestra una sola vez; si se
              filtra, rótalo desde la misma pantalla. «Enviar prueba» manda un evento{' '}
              <Codigo>{EVENTO_PRUEBA}</Codigo> para comprobar tu receptor.
            </p>
            <div className={styles.tablaContenedor}>
              <table className={styles.tabla}>
                <caption className={styles.oculto}>Eventos</caption>
                <thead>
                  <tr>
                    <th scope="col">Evento</th>
                    <th scope="col">Cuándo</th>
                  </tr>
                </thead>
                <tbody>
                  {EVENTOS_WEBHOOK.map((e) => (
                    <tr key={e}>
                      <td>
                        <Codigo>{e}</Codigo>
                      </td>
                      <td>{DESCRIPCION_EVENTO[e]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className={styles.subtitulo}>Cada entrega</h3>
            <p>
              Un <Codigo>POST</Codigo> con JSON y estas cabeceras:
            </p>
            <ul className={styles.lista}>
              <li>
                <Codigo>{CABECERAS_WEBHOOK.firma}</Codigo>:{' '}
                <Codigo>{'t=<segundos unix>,v1=<firma>'}</Codigo>
              </li>
              <li>
                <Codigo>{CABECERAS_WEBHOOK.evento}</Codigo>: el nombre del evento
              </li>
              <li>
                <Codigo>{CABECERAS_WEBHOOK.entrega}</Codigo>: id de la entrega (igual al{' '}
                <Codigo>id</Codigo> del cuerpo)
              </li>
              <li>
                <Codigo>{CABECERAS_WEBHOOK.intento}</Codigo>: 1 a {MAX_INTENTOS_WEBHOOK}
              </li>
            </ul>
            <Bloque etiqueta="Ejemplo de cuerpo de un webhook">{EJEMPLO_CUERPO_WEBHOOK}</Bloque>
            <p>
              El <Codigo>id</Codigo> es el mismo en todos los intentos y en los reenvíos manuales:
              úsalo para no procesar dos veces la misma entrega. El orden de llegada no está
              garantizado; para el estado actual consulta el recurso con la API.
            </p>

            <h3 className={styles.subtitulo}>Verificar la firma</h3>
            <p>
              La firma <Codigo>v1</Codigo> es el HMAC-SHA256, en hexadecimal, de{' '}
              <Codigo>{'<t>.<cuerpo>'}</Codigo> con tu secreto <Codigo>whsec_…</Codigo> completo
              como clave. Calcúlala sobre el cuerpo crudo (antes de parsear el JSON), compárala en
              tiempo constante y rechaza las entregas con <Codigo>t</Codigo> de más de{' '}
              {TOLERANCIA_FIRMA_S / 60} minutos.
            </p>
            <Bloque etiqueta="Verificación de la firma en Node.js">{EJEMPLO_VERIFICACION}</Bloque>

            <h3 className={styles.subtitulo}>Respuestas y reintentos</h3>
            <p>
              Responde cualquier <Codigo>2xx</Codigo> en menos de {TIMEOUT_ENTREGA_MS / 1000}{' '}
              segundos (procesa después si tarda). Cualquier otra respuesta, una redirección (no se
              siguen) o la falta de respuesta se reintenta después de{' '}
              {ESPERAS_WEBHOOK_MIN.map(formatearEspera).join(', ')} (±10 %). Después del intento{' '}
              {MAX_INTENTOS_WEBHOOK}, la entrega queda descartada; puedes reenviarla desde el
              historial del webhook.
            </p>
            <div className={styles.tablaContenedor}>
              <table className={styles.tabla}>
                <caption className={styles.oculto}>Estados de una entrega</caption>
                <thead>
                  <tr>
                    <th scope="col">Estado</th>
                    <th scope="col">Significa</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>{ETIQUETA_ESTADO_ENTREGA.pendiente}</td>
                    <td>En cola, sin intentos (o reenviada a mano).</td>
                  </tr>
                  <tr>
                    <td>{ETIQUETA_ESTADO_ENTREGA.fallido}</td>
                    <td>Falló al menos una vez y tiene otro intento programado.</td>
                  </tr>
                  <tr>
                    <td>{ETIQUETA_ESTADO_ENTREGA.entregado}</td>
                    <td>Tu URL respondió 2xx.</td>
                  </tr>
                  <tr>
                    <td>{ETIQUETA_ESTADO_ENTREGA.descartado}</td>
                    <td>
                      Se agotaron los {MAX_INTENTOS_WEBHOOK} intentos, el webhook está pausado, el
                      plan ya no incluye webhooks o la URL apunta a una dirección no permitida.
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
