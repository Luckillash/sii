import 'server-only';
import { crc32, deflateRawSync } from 'node:zlib';

// ZIP mínimo para el .xlsx de las exportaciones (PLAN-SAAS Fase 9). Un .xlsx es un ZIP
// con XML adentro; para unos pocos archivos de texto basta con DEFLATE (`node:zlib`) y
// el formato clásico de PKWARE (APPNOTE 6.3.x, secciones 4.3.7, 4.3.12 y 4.3.16), sin
// ZIP64: una exportación tiene a lo más 50.000 filas, muy lejos de los 4 GB. Así no se
// agrega una dependencia para algo de 80 líneas. Puro: se prueba descomprimiendo.

export interface ArchivoZip {
  /** Ruta dentro del ZIP, con `/` (p. ej. `xl/workbook.xml`). */
  nombre: string;
  datos: Buffer;
}

/** Bit 11 de las banderas: el nombre va en UTF-8. */
const BANDERA_UTF8 = 0x0800;
const METODO_DEFLATE = 8;
/** 2.0: la versión que necesita DEFLATE. */
const VERSION = 20;

/** Fecha y hora en formato MS-DOS (resolución de 2 s, años desde 1980). */
function fechaDos(fecha: Date): { hora: number; dia: number } {
  const anio = Math.min(Math.max(fecha.getFullYear(), 1980), 2107);
  return {
    hora: (fecha.getHours() << 11) | (fecha.getMinutes() << 5) | Math.floor(fecha.getSeconds() / 2),
    dia: ((anio - 1980) << 9) | ((fecha.getMonth() + 1) << 5) | fecha.getDate(),
  };
}

/** Arma el ZIP con los archivos en el orden dado (el `[Content_Types].xml` va primero). */
export function armarZip(archivos: readonly ArchivoZip[], fecha: Date = new Date()): Buffer {
  const { hora, dia } = fechaDos(fecha);
  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let desplazamiento = 0;

  for (const archivo of archivos) {
    const nombre = Buffer.from(archivo.nombre, 'utf8');
    const comprimido = deflateRawSync(archivo.datos, { level: 6 });
    const crc = crc32(archivo.datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(VERSION, 4);
    local.writeUInt16LE(BANDERA_UTF8, 6);
    local.writeUInt16LE(METODO_DEFLATE, 8);
    local.writeUInt16LE(hora, 10);
    local.writeUInt16LE(dia, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comprimido.length, 18);
    local.writeUInt32LE(archivo.datos.length, 22);
    local.writeUInt16LE(nombre.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, nombre, comprimido);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(VERSION, 4);
    central.writeUInt16LE(VERSION, 6);
    central.writeUInt16LE(BANDERA_UTF8, 8);
    central.writeUInt16LE(METODO_DEFLATE, 10);
    central.writeUInt16LE(hora, 12);
    central.writeUInt16LE(dia, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comprimido.length, 20);
    central.writeUInt32LE(archivo.datos.length, 24);
    central.writeUInt16LE(nombre.length, 28);
    // Extra, comentario, disco, atributos internos y externos: 0.
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombre);

    desplazamiento += local.length + nombre.length + comprimido.length;
  }

  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, directorio, fin]);
}
