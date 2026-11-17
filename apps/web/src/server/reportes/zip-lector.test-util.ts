import { crc32, inflateRawSync } from 'node:zlib';

// Lector de ZIP para las pruebas del .xlsx: recorre el directorio central, descomprime
// cada archivo y verifica su CRC-32 y su tamaño contra los encabezados. Sin dependencias.

export interface EntradaZip {
  nombre: string;
  datos: Buffer;
  banderas: number;
  metodo: number;
}

export function leerZip(zip: Buffer): Map<string, EntradaZip> {
  const fin = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (fin < 0) throw new Error('Sin fin de directorio central');
  const cantidad = zip.readUInt16LE(fin + 10);
  const tamanoDirectorio = zip.readUInt32LE(fin + 12);
  let p = zip.readUInt32LE(fin + 16);
  if (p + tamanoDirectorio !== fin) throw new Error('El directorio central no calza');
  const entradas = new Map<string, EntradaZip>();
  for (let i = 0; i < cantidad; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error(`Firma central inválida en ${p}`);
    const banderas = zip.readUInt16LE(p + 8);
    const metodo = zip.readUInt16LE(p + 10);
    const crc = zip.readUInt32LE(p + 16);
    const comprimido = zip.readUInt32LE(p + 20);
    const original = zip.readUInt32LE(p + 24);
    const largoNombre = zip.readUInt16LE(p + 28);
    const largoExtra = zip.readUInt16LE(p + 30);
    const largoComentario = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    const nombre = zip.subarray(p + 46, p + 46 + largoNombre).toString('utf8');

    if (zip.readUInt32LE(local) !== 0x04034b50) throw new Error(`Firma local inválida: ${nombre}`);
    if (zip.readUInt32LE(local + 14) !== crc) throw new Error(`CRC local distinto: ${nombre}`);
    const inicio = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const datos = inflateRawSync(zip.subarray(inicio, inicio + comprimido));
    if (datos.length !== original) throw new Error(`Tamaño distinto: ${nombre}`);
    if (crc32(datos) !== crc) throw new Error(`CRC distinto: ${nombre}`);

    entradas.set(nombre, { nombre, datos, banderas, metodo });
    p += 46 + largoNombre + largoExtra + largoComentario;
  }
  return entradas;
}
