import { describe, expect, it } from 'vitest';
import type { ClienteServicio } from '../supabase/service';
import {
  AlmacenDocumentos,
  BUCKET_DOCUMENTOS,
  type DestinoArchivo,
  ErrorAlmacen,
  type MotivoErrorAlmacen,
  rutaDocumento,
} from './almacen';

const ORG = '11111111-1111-4111-8111-111111111111';
const OTRA_ORG = '22222222-2222-4222-8222-222222222222';
const EMPRESA = '33333333-3333-4333-8333-333333333333';
const DESTINO: DestinoArchivo = {
  empresaId: EMPRESA,
  ambiente: 'certificacion',
  archivo: 'EnvioBOLETA-1.xml',
};

// XML en ISO-8859-1 con una «ñ» (0xF1): si alguien lo pasara por un string UTF-8,
// el byte cambiaría.
const XML = Buffer.concat([
  Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?>\n<DTE><RznSoc>Compa', 'latin1'),
  Buffer.from([0xf1]),
  Buffer.from('ia</RznSoc></DTE>', 'latin1'),
]);
const PDF = Buffer.from('%PDF-1.7\n...contenido...', 'latin1');

/** Imita `storage.from(bucket)` con `upload` y `createSignedUrl`, guardando lo recibido. */
function clienteFalso() {
  const subidas: {
    bucket: string;
    ruta: string;
    datos: unknown;
    opciones: Record<string, unknown>;
  }[] = [];
  const firmadas: { bucket: string; ruta: string; segundos: number }[] = [];
  const existentes = new Set<string>();
  let fallar = false;
  const storage = {
    from(bucket: string) {
      return {
        async upload(ruta: string, datos: unknown, opciones: Record<string, unknown>) {
          subidas.push({ bucket, ruta, datos, opciones });
          if (fallar) {
            return {
              data: null,
              error: { status: 500, statusCode: '500', message: `fallo en ${ruta} con detalle` },
            };
          }
          if (existentes.has(ruta) && !opciones.upsert) {
            return {
              data: null,
              error: {
                status: 409,
                statusCode: '409',
                message: `The resource ${ruta} already exists`,
              },
            };
          }
          existentes.add(ruta);
          return { data: { path: ruta, id: 'x', fullPath: `${bucket}/${ruta}` }, error: null };
        },
        async createSignedUrl(ruta: string, segundos: number) {
          firmadas.push({ bucket, ruta, segundos });
          if (fallar) return { data: null, error: { status: 400, message: `detalle ${ruta}` } };
          return { data: { signedUrl: `https://storage.test/${ruta}?token=t` }, error: null };
        },
      };
    },
  };
  return {
    cliente: { storage } as unknown as ClienteServicio,
    subidas,
    firmadas,
    fallar: () => {
      fallar = true;
    },
  };
}

async function motivo(promesa: Promise<unknown> | (() => unknown)): Promise<MotivoErrorAlmacen> {
  try {
    await (typeof promesa === 'function' ? promesa() : promesa);
  } catch (error) {
    if (error instanceof ErrorAlmacen) return error.motivo;
    throw error;
  }
  throw new Error('Se esperaba ErrorAlmacen');
}

describe('rutaDocumento', () => {
  it('arma <org>/<empresa>/<ambiente>/<archivo> en minúsculas', () => {
    expect(rutaDocumento(ORG.toUpperCase(), { ...DESTINO, ambiente: 'produccion' })).toBe(
      `${ORG}/${EMPRESA}/produccion/EnvioBOLETA-1.xml`,
    );
  });

  it.each([
    ['org no uuid', 'org-1', DESTINO],
    ['empresa no uuid', ORG, { ...DESTINO, empresaId: '../otra' }],
    ['ambiente inválido', ORG, { ...DESTINO, ambiente: 'pruebas' as never }],
    ['con barra', ORG, { ...DESTINO, archivo: 'a/b.xml' }],
    ['con barra invertida', ORG, { ...DESTINO, archivo: 'a\\b.xml' }],
    ['con ..', ORG, { ...DESTINO, archivo: 'a..xml' }],
    ['solo ..', ORG, { ...DESTINO, archivo: '..' }],
    ['oculto', ORG, { ...DESTINO, archivo: '.xml' }],
    ['con tilde', ORG, { ...DESTINO, archivo: 'boleta-ñ.xml' }],
    ['con espacio', ORG, { ...DESTINO, archivo: 'mi boleta.xml' }],
    ['con salto de línea', ORG, { ...DESTINO, archivo: 'a\n.xml' }],
    ['extensión rara', ORG, { ...DESTINO, archivo: 'boleta.exe' }],
    ['vacío', ORG, { ...DESTINO, archivo: '' }],
  ])('rechaza: %s', async (_, org, destino) => {
    expect(await motivo(() => rutaDocumento(org, destino as DestinoArchivo))).toBe('ruta');
  });

  it('exige la extensión del tipo', async () => {
    expect(await motivo(() => rutaDocumento(ORG, DESTINO, 'pdf'))).toBe('ruta');
    expect(rutaDocumento(ORG, { ...DESTINO, archivo: 'b.pdf' }, 'pdf')).toMatch(/b\.pdf$/);
  });
});

describe('AlmacenDocumentos', () => {
  it('sube el XML con sus bytes intactos, application/xml y sin sobrescribir', async () => {
    const falso = clienteFalso();
    const ruta = await new AlmacenDocumentos(falso.cliente, ORG).subirXml(DESTINO, XML);

    expect(ruta).toBe(`${ORG}/${EMPRESA}/certificacion/EnvioBOLETA-1.xml`);
    const [subida] = falso.subidas;
    expect(subida?.bucket).toBe(BUCKET_DOCUMENTOS);
    expect(subida?.ruta).toBe(ruta);
    expect(subida?.opciones).toEqual({ contentType: 'application/xml', upsert: false });
    const datos = subida?.datos;
    if (!Buffer.isBuffer(datos)) throw new Error('Se esperaba un Buffer');
    expect(datos.equals(XML)).toBe(true);
    expect(datos.includes(0xf1)).toBe(true);
  });

  it('el content-type es uno de allowed_mime_types del bucket', async () => {
    const falso = clienteFalso();
    const almacen = new AlmacenDocumentos(falso.cliente, ORG);
    await almacen.subirXml(DESTINO, XML);
    await almacen.subirPdf({ ...DESTINO, archivo: 'boleta-1.pdf' }, PDF);
    const permitidos = ['application/xml', 'text/xml', 'application/pdf'];
    for (const s of falso.subidas) expect(permitidos).toContain(s.opciones.contentType);
    expect(falso.subidas[1]?.opciones.contentType).toBe('application/pdf');
  });

  it('un archivo existente no se pisa salvo con sobrescribir', async () => {
    const falso = clienteFalso();
    const almacen = new AlmacenDocumentos(falso.cliente, ORG);
    await almacen.subirXml(DESTINO, XML);
    expect(await motivo(almacen.subirXml(DESTINO, XML))).toBe('existe');
    await expect(almacen.subirXml(DESTINO, XML, { sobrescribir: true })).resolves.toBeDefined();
    expect(falso.subidas.at(-1)?.opciones.upsert).toBe(true);
  });

  it('rechaza contenido que no corresponde, sin subir nada', async () => {
    const falso = clienteFalso();
    const almacen = new AlmacenDocumentos(falso.cliente, ORG);
    expect(await motivo(() => almacen.subirXml(DESTINO, '<DTE/>' as never))).toBe('contenido');
    expect(await motivo(() => almacen.subirXml(DESTINO, PDF))).toBe('contenido');
    expect(await motivo(() => almacen.subirPdf({ ...DESTINO, archivo: 'a.pdf' }, XML))).toBe(
      'contenido',
    );
    expect(await motivo(almacen.subirXml(DESTINO, Buffer.alloc(0)))).toBe('contenido');
    expect(await motivo(almacen.subirXml({ ...DESTINO, archivo: 'a.pdf' }, XML))).toBe('ruta');
    expect(falso.subidas).toHaveLength(0);
  });

  it('acepta un Uint8Array que es vista de un buffer mayor, sin bytes de más', async () => {
    const falso = clienteFalso();
    const grande = Buffer.concat([Buffer.from('basura'), XML, Buffer.from('cola')]);
    const vista = new Uint8Array(grande.buffer, grande.byteOffset + 6, XML.length);
    await new AlmacenDocumentos(falso.cliente, ORG).subirXml(DESTINO, vista);
    const datos = falso.subidas[0]?.datos;
    if (!Buffer.isBuffer(datos)) throw new Error('Se esperaba un Buffer');
    expect(datos.equals(XML)).toBe(true);
  });

  it('los errores de Storage no llevan la ruta ni el detalle', async () => {
    const falso = clienteFalso();
    falso.fallar();
    const almacen = new AlmacenDocumentos(falso.cliente, ORG);
    const error = await almacen.subirXml(DESTINO, XML).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorAlmacen);
    expect((error as ErrorAlmacen).motivo).toBe('storage');
    expect((error as Error).message).toContain('HTTP 500');
    expect((error as Error).message).not.toContain(ORG);
    expect((error as Error).message).not.toContain('detalle');

    const errorUrl = await almacen
      .urlFirmada(`${ORG}/${EMPRESA}/certificacion/EnvioBOLETA-1.xml`)
      .catch((e: unknown) => e);
    expect((errorUrl as ErrorAlmacen).motivo).toBe('storage');
    expect((errorUrl as Error).message).not.toContain(EMPRESA);
  });

  describe('urlFirmada', () => {
    it('firma por 60 segundos por defecto', async () => {
      const falso = clienteFalso();
      const ruta = `${ORG}/${EMPRESA}/certificacion/EnvioBOLETA-1.xml`;
      const url = await new AlmacenDocumentos(falso.cliente, ORG).urlFirmada(ruta);
      expect(url).toBe(`https://storage.test/${ruta}?token=t`);
      expect(falso.firmadas).toEqual([{ bucket: BUCKET_DOCUMENTOS, ruta, segundos: 60 }]);
    });

    it('acepta otra duración dentro del máximo', async () => {
      const falso = clienteFalso();
      const almacen = new AlmacenDocumentos(falso.cliente, ORG);
      await almacen.urlFirmada(`${ORG}/${EMPRESA}/produccion/b.pdf`, 300);
      expect(falso.firmadas[0]?.segundos).toBe(300);
      expect(await motivo(almacen.urlFirmada(`${ORG}/${EMPRESA}/produccion/b.pdf`, 0))).toBe(
        'ruta',
      );
      expect(await motivo(almacen.urlFirmada(`${ORG}/${EMPRESA}/produccion/b.pdf`, 86_400))).toBe(
        'ruta',
      );
    });

    it.each([
      ['de otra organización', `${OTRA_ORG}/${EMPRESA}/certificacion/a.xml`],
      ['con segmentos de más', `${ORG}/${EMPRESA}/certificacion/x/a.xml`],
      ['con segmentos de menos', `${ORG}/${EMPRESA}/a.xml`],
      ['con ..', `${ORG}/${EMPRESA}/certificacion/..`],
      ['con ambiente inválido', `${ORG}/${EMPRESA}/pruebas/a.xml`],
      ['con barra inicial', `/${ORG}/${EMPRESA}/certificacion/a.xml`],
    ])('rechaza una ruta %s sin llamar a Storage', async (_, ruta) => {
      const falso = clienteFalso();
      expect(await motivo(new AlmacenDocumentos(falso.cliente, ORG).urlFirmada(ruta))).toBe('ruta');
      expect(falso.firmadas).toHaveLength(0);
    });
  });

  it('exige un uuid de organización al crearlo', async () => {
    expect(await motivo(() => new AlmacenDocumentos(clienteFalso().cliente, 'org'))).toBe('ruta');
  });
});
