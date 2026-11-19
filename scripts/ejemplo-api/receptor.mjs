// Receptor de webhooks de ejemplo: verifica la firma de cada entrega y escribe una línea
// JSON por entrega en la salida estándar. Node.js puro.
//
//   BOLETEAME_WEBHOOK_SECRET=whsec_… PORT=3000 node receptor.mjs
//
// Responde 200 si la firma es válida y 400 si no (Boletéame reintenta lo que no es 2xx).
// Necesita una URL pública https en el puerto 443 que llegue a este puerto (ver README).

import { createServer } from 'node:http';
import { verificarFirma } from './verificar-firma.mjs';

const secreto = process.env.BOLETEAME_WEBHOOK_SECRET;
if (!secreto?.startsWith('whsec_')) {
  console.error('Falta BOLETEAME_WEBHOOK_SECRET (whsec_…): cópialo al crear el webhook.');
  process.exit(2);
}
const puerto = Number(process.env.PORT ?? 3000);
const MAXIMO_BYTES = 1_048_576;
const vistas = new Set();

function registrar(datos) {
  console.log(JSON.stringify({ en: new Date().toISOString(), ...datos }));
}

const servidor = createServer((req, res) => {
  if (req.method !== 'POST') {
    res.writeHead(req.url === '/' ? 200 : 404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Receptor de webhooks de Boletéame: envía un POST.\n');
    return;
  }
  const partes = [];
  let largo = 0;
  req.on('data', (parte) => {
    largo += parte.length;
    if (largo > MAXIMO_BYTES) {
      res.writeHead(413).end();
      req.destroy();
      return;
    }
    partes.push(parte);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    const cuerpo = Buffer.concat(partes);
    const resultado = verificarFirma({
      cuerpo,
      cabecera: req.headers['boleteame-firma'],
      secreto,
    });
    let datos = {};
    try {
      datos = JSON.parse(cuerpo.toString('utf8'));
    } catch {
      // Se registra igual; la firma ya dice si el cuerpo es de Boletéame.
    }
    const repetida = typeof datos.id === 'string' && vistas.has(datos.id);
    if (resultado.ok && typeof datos.id === 'string') vistas.add(datos.id);
    registrar({
      evento: req.headers['boleteame-evento'] ?? null,
      entrega: req.headers['boleteame-entrega'] ?? null,
      intento: req.headers['boleteame-intento'] ?? null,
      firma: resultado.ok ? 'válida' : 'inválida',
      motivo: resultado.ok ? null : resultado.motivo,
      repetida,
      documento_id: datos.datos?.documento_id ?? null,
      folio: datos.datos?.folio ?? null,
      estado: datos.datos?.estado ?? null,
    });
    res.writeHead(resultado.ok ? 200 : 400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ recibido: resultado.ok }));
  });
});

servidor.listen(puerto, () => {
  registrar({ mensaje: `Escuchando en el puerto ${puerto}` });
});
