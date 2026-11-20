// SOLO PARA PRUEBAS (lo importan `index.test.ts` y `timbre.test.ts`; nada de la app lo usa).
// Arma una boleta REAL con `@winex/certificacion`: CAF de prueba (con `<RSASK>`) y
// certificado de prueba generados al vuelo, sin red. De ella salen el `<TED>` como texto
// `latin1` y los `DatosRepresentacion` con las cifras que escribió la librería.

import 'server-only';
import { ArmadorBoleta, Certificado, FirmaElectronica, relojFijo } from '@winex/certificacion';
import { cafPrueba } from '../../../test/caf-prueba';
import { certificado, pfx } from '../../../test/pfx-prueba';
import type { DatosRepresentacion } from './index';

export const RUT_EMISOR = '76123456-0';
const CLAVE = 'clave-de-prueba-pdf';
const INSTANTE = new Date('2026-11-13T15:00:00Z');

export interface DetallePrueba {
  nombre: string;
  cantidad: number;
  precio: number;
  exento?: boolean;
  unidad?: string;
}

export interface OpcionesBoleta {
  folio?: number;
  tipoDte?: 39 | 41;
  razonSocialEmisor?: string;
  receptor?: { rut: string; razonSocial: string };
  detalles?: DetallePrueba[];
  ambiente?: DatosRepresentacion['ambiente'];
}

export interface BoletaPrueba {
  /** DTE firmado (bytes ISO-8859-1). */
  dte: Buffer;
  /** `<TED>…</TED>` como texto `latin1`. */
  tedXml: string;
  /** XML del CAF (con la `<RSASK>`). */
  caf: string;
  /** Llave privada del CAF (PEM PKCS#1). */
  rsask: string;
  datos: DatosRepresentacion;
}

let firmador: FirmaElectronica | undefined;

function firma(): FirmaElectronica {
  if (!firmador) {
    const bytes = pfx(
      certificado({
        cn: 'Titular de Prueba',
        desde: new Date(INSTANTE.getTime() - 86_400_000),
        hasta: new Date(INSTANTE.getTime() + 365 * 86_400_000),
      }),
      CLAVE,
    );
    const cert = Certificado.desdeContenido(bytes, CLAVE);
    firmador = new FirmaElectronica(cert.llavePrivada, cert.certificado);
  }
  return firmador;
}

function numero(xml: string, etiqueta: string): number {
  const m = new RegExp(`<${etiqueta}>([^<]*)</${etiqueta}>`).exec(xml);
  return m?.[1] ? Number(m[1]) : 0;
}

export const DETALLES_BASE: DetallePrueba[] = [
  { nombre: 'Café con ñandú de Peñalolén', cantidad: 2, precio: 1190 },
  { nombre: 'Queso mantecoso', cantidad: 1.5, unidad: 'Kg', precio: 7990 },
  { nombre: 'Bolsa reutilizable', cantidad: 1, precio: 500, exento: true },
];

export function boletaPrueba(opciones: OpcionesBoleta = {}): BoletaPrueba {
  const folio = opciones.folio ?? 41;
  const tipoDte = opciones.tipoDte ?? 39;
  const detalles =
    opciones.detalles ??
    (tipoDte === 41 ? DETALLES_BASE.map((d) => ({ ...d, exento: true })) : DETALLES_BASE);
  const receptor = opciones.receptor ?? { rut: '66666666-6', razonSocial: 'Cliente General' };
  const emisor = {
    rut: RUT_EMISOR,
    razonSocial: opciones.razonSocialEmisor ?? 'Comercial Ñuñoa y Peñalolén SpA',
    giro: 'Venta al por menor de alimentos en almacenes',
    direccion: 'Avenida Irarrázaval 1234, oficina 56',
    comuna: 'Ñuñoa',
  };
  const { xml: caf, rsask } = cafPrueba({
    rut: RUT_EMISOR,
    tipoDte,
    desde: 1,
    hasta: Math.max(100, folio),
  });
  const armador = new ArmadorBoleta(firma(), { reloj: relojFijo(INSTANTE) });
  const dte = armador.armar({ emisor, receptor, folio, detalles, tipoDte }, caf);
  const texto = dte.toString('latin1');
  const ted = /<TED version="1\.0">[\s\S]*?<\/TED>/.exec(texto)?.[0];
  if (!ted) throw new Error('La boleta de prueba no trae TED');

  const montos = [...texto.matchAll(/<MontoItem>([^<]*)<\/MontoItem>/g)].map((m) => Number(m[1]));
  const datos: DatosRepresentacion = {
    ambiente: opciones.ambiente ?? 'certificacion',
    tipoDte,
    folio,
    fechaEmision: /<FchEmis>([^<]*)<\/FchEmis>/.exec(texto)?.[1] ?? '2026-11-13',
    emisor,
    receptor: { rut: receptor.rut, razonSocial: receptor.razonSocial },
    lineas: detalles.map((d, i) => ({
      nombre: d.nombre,
      cantidad: d.cantidad,
      unidad: d.unidad ?? null,
      precio: d.precio,
      exento: d.exento === true || tipoDte === 41,
      descuento: 0,
      montoItem: montos[i] ?? Math.round(d.cantidad * d.precio),
    })),
    totales: {
      neto: numero(texto, 'MntNeto'),
      exento: numero(texto, 'MntExe'),
      iva: numero(texto, 'IVA'),
      total: numero(texto, 'MntTotal'),
      descuentoAplicado: 0,
    },
    resolucion: { numero: 0, fecha: '2026-11-10' },
    tedXml: ted,
  };
  return { dte, tedXml: ted, caf, rsask, datos };
}
