// Cliente de ejemplo de la API de Boletéame (criterio de aceptación de la Fase 11):
// emite una boleta 39 de $ 1.190, repite la petición con la misma Idempotency-Key y
// comprueba que no se duplicó; al final consulta el documento. Node.js ≥ 22, sin
// dependencias. EMITE DE VERDAD: consume un folio del ambiente de la clave.
//
//   BOLETEAME_API_KEY=sk_test_… [BOLETEAME_EMPRESA=76354771-K] node emitir.mjs
//     [--clave=<Idempotency-Key>] [--conflicto]
//
// BOLETEAME_URL cambia la base (por defecto https://boleteame.dev/api/v1).
// --conflicto: además envía OTRA boleta con la misma clave y espera 422 idempotencia_conflicto.
// Nunca imprime la API key.

const clave = process.env.BOLETEAME_API_KEY ?? '';
const base = (process.env.BOLETEAME_URL ?? 'https://boleteame.dev/api/v1').replace(/\/+$/, '');
const empresa = process.env.BOLETEAME_EMPRESA || undefined;
const argumentos = process.argv.slice(2);
const conConflicto = argumentos.includes('--conflicto');
const idempotencia =
  argumentos.find((a) => a.startsWith('--clave='))?.slice('--clave='.length) ||
  `ejemplo-${new Date().toISOString().replace(/[:.]/g, '-')}`;

if (!/^sk_(test|live)_[0-9a-f]{64}$/.test(clave)) {
  console.error('Falta BOLETEAME_API_KEY (sk_test_… o sk_live_…): créala en Configuración → API.');
  process.exit(2);
}

const boleta = {
  ...(empresa ? { empresa } : {}),
  tipo_dte: 39,
  lineas: [{ nombre: 'Prueba de la API', cantidad: 1, precio: 1190 }],
};

let fallas = 0;
function comprobar(condicion, texto) {
  console.log(`${condicion ? 'OK   ' : 'FALLA'} ${texto}`);
  if (!condicion) fallas += 1;
}

async function pedir(metodo, ruta, cuerpo, claveIdempotencia) {
  const cabeceras = { Authorization: `Bearer ${clave}`, Accept: 'application/json' };
  if (cuerpo !== undefined) cabeceras['Content-Type'] = 'application/json';
  if (claveIdempotencia) cabeceras['Idempotency-Key'] = claveIdempotencia;
  const r = await fetch(`${base}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    // Respuesta que no es JSON: se muestra el status.
  }
  return { status: r.status, cabeceras: r.headers, json };
}

function resumen(r) {
  if (r.json?.error) return `${r.status} ${r.json.error.codigo}: ${r.json.error.mensaje}`;
  const d = r.json ?? {};
  return `${r.status} documento ${d.id ?? '—'} folio ${d.folio ?? '—'} estado ${d.estado ?? '—'}`;
}

console.log(`API: ${base}`);
console.log(`Idempotency-Key: ${idempotencia}`);

const primera = await pedir('POST', '/documentos', boleta, idempotencia);
console.log(`1. Emitir:  ${resumen(primera)}`);
comprobar(primera.status === 201 || primera.status === 202, 'la emisión responde 201 o 202');

const segunda = await pedir('POST', '/documentos', boleta, idempotencia);
console.log(`2. Repetir: ${resumen(segunda)}`);
comprobar(segunda.status === primera.status, 'la repetición responde el mismo status');
comprobar(
  segunda.cabeceras.get('Idempotent-Replayed') === 'true',
  'la repetición trae Idempotent-Replayed: true',
);
comprobar(
  Boolean(primera.json?.id) && segunda.json?.id === primera.json?.id,
  'la repetición devuelve el mismo documento',
);
comprobar(segunda.json?.folio === primera.json?.folio, 'la repetición no usa otro folio');

if (conConflicto) {
  const otra = { ...boleta, lineas: [{ nombre: 'Otra boleta', cantidad: 1, precio: 2000 }] };
  const tercera = await pedir('POST', '/documentos', otra, idempotencia);
  console.log(`3. Otra boleta con la misma clave: ${resumen(tercera)}`);
  comprobar(
    tercera.status === 422 && tercera.json?.error?.codigo === 'idempotencia_conflicto',
    'otra boleta con la misma clave da 422 idempotencia_conflicto',
  );
}

if (primera.json?.id) {
  const consulta = await pedir('GET', `/documentos/${primera.json.id}`);
  console.log(`4. Consultar: ${resumen(consulta)}`);
  comprobar(consulta.status === 200, 'el documento se puede consultar');
  if (consulta.json?.envio) {
    console.log(
      `   Envío ${consulta.json.envio.id}, Track ID ${consulta.json.envio.track_id ?? '—'}, estado SII ${consulta.json.envio.estado_sii ?? '—'}`,
    );
  }
}

console.log(fallas === 0 ? 'Todo en orden.' : `${fallas} comprobación(es) fallaron.`);
process.exit(fallas === 0 ? 0 : 1);
