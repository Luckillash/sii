import { createHash, X509Certificate } from 'node:crypto';
import { Certificado, huellaCertificado } from '@winex/certificacion';
import forge from 'node-forge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAVE_MATERIAL, caPrueba, certificado, leerMaterial, pfx } from '../../../test/pfx-prueba';
import { analizarCertificado } from './analizar';
import { ErrorAnalisisCertificado, type MotivoErrorCertificado } from './errores';

const CLAVE = 'clave-de-prueba-123';
const DIA = 86_400_000;

function capturar(fn: () => unknown): ErrorAnalisisCertificado {
  try {
    fn();
  } catch (error) {
    if (error instanceof ErrorAnalisisCertificado) return error;
    throw new Error(`Se esperaba ErrorAnalisisCertificado y llegó ${String(error)}`);
  }
  throw new Error('Se esperaba un error');
}

function esperarMotivo(fn: () => unknown, motivo: MotivoErrorCertificado) {
  const error = capturar(fn);
  expect(error.motivo).toBe(motivo);
  expect(error.cause).toBeUndefined();
  return error;
}

describe('analizarCertificado', () => {
  it('autofirmado sin RUT: datos públicos, huella de la librería y no legacy', () => {
    const titular = certificado({ cn: 'María José Pérez Soto' });
    const bytes = pfx(titular, CLAVE);
    const r = analizarCertificado(bytes, CLAVE);

    const der = Buffer.from(
      forge.asn1.toDer(forge.pki.certificateToAsn1(titular.forge)).getBytes(),
      'binary',
    );
    expect(r.cn).toBe('María José Pérez Soto');
    expect(r.nombreTitular).toBe('María José Pérez Soto');
    expect(r.rutTitular).toBeNull();
    // Autofirmado: el emisor es el mismo sujeto.
    expect(r.emisorCa).toBe('María José Pérez Soto');
    expect(r.vigenteDesde.getTime()).toBe(
      Math.floor(titular.forge.validity.notBefore.getTime() / 1000) * 1000,
    );
    expect(r.vigenteHasta.getTime()).toBe(
      Math.floor(titular.forge.validity.notAfter.getTime() / 1000) * 1000,
    );
    expect(r.huellaSha256).toBe(createHash('sha256').update(der).digest('hex'));
    expect(r.huellaSha256).toBe(
      huellaCertificado(Certificado.desdeContenido(bytes, CLAVE).certificado),
    );
    expect(r.pfxLegacy).toBe(false);
  });

  it('emitido por una CA de prueba con el RUT en el subjectAltName (otherName 8321.1)', () => {
    const ca = caPrueba('E-Certchile CA de Prueba');
    const titular = certificado({ emisor: ca, rutSan: '12.345.678-5' });
    const r = analizarCertificado(pfx(titular, CLAVE, { intermedios: [ca] }), CLAVE);
    expect(r.rutTitular).toBe('12345678-5');
    expect(r.emisorCa).toBe('E-Certchile CA de Prueba');
    expect(r.cn).toBe('Titular de Prueba');
  });

  it('normaliza el RUT (sin puntos, K mayúscula) y descarta uno con DV inválido', () => {
    const conK = certificado({ rutSan: '76354771-k' });
    expect(analizarCertificado(pfx(conK, CLAVE), CLAVE).rutTitular).toBe('76354771-K');

    const malo = certificado({ rutSan: '12345678-9' });
    expect(analizarCertificado(pfx(malo, CLAVE), CLAVE).rutTitular).toBeNull();
  });

  it('ignora otherName con otro OID', () => {
    const titular = certificado({
      otroOtherName: { oid: '1.3.6.1.4.1.9999.1', valor: '12345678-5' },
    });
    expect(analizarCertificado(pfx(titular, CLAVE), CLAVE).rutTitular).toBeNull();
  });

  it('toma el RUT del serialNumber del sujeto si no viene en el subjectAltName', () => {
    const titular = certificado({ serialNumberSujeto: 'RUT:12.345.678-5' });
    expect(analizarCertificado(pfx(titular, CLAVE), CLAVE).rutTitular).toBe('12345678-5');

    // Un número de serie que no es RUT (sin guion) no se toma.
    const sinRut = certificado({ serialNumberSujeto: '123456785' });
    expect(analizarCertificado(pfx(sinRut, CLAVE), CLAVE).rutTitular).toBeNull();
  });

  it('el subjectAltName manda sobre el serialNumber', () => {
    const titular = certificado({ rutSan: '12345678-5', serialNumberSujeto: '76354771-K' });
    expect(analizarCertificado(pfx(titular, CLAVE), CLAVE).rutTitular).toBe('12345678-5');
  });

  it('usa la O del emisor si no tiene CN', () => {
    const titular = certificado({ sinCn: true });
    const r = analizarCertificado(pfx(titular, CLAVE), CLAVE);
    expect(r.cn).toBeNull();
    expect(r.emisorCa).toBe('Material de prueba Boleteame');
  });

  it('rechaza un certificado vencido', () => {
    const titular = certificado({
      desde: new Date(Date.now() - 400 * DIA),
      hasta: new Date(Date.now() - 2 * DIA),
    });
    const error = esperarMotivo(() => analizarCertificado(pfx(titular, CLAVE), CLAVE), 'vencido');
    expect(error.mensaje.titulo).toBe('El certificado está vencido');
    expect(error.mensaje.detalle).toMatch(/^Venció el \d{2}-\d{2}-\d{4}\./);
  });

  it('rechaza un certificado que todavía no está vigente', () => {
    const titular = certificado({
      desde: new Date(Date.now() + 3 * DIA),
      hasta: new Date(Date.now() + 400 * DIA),
    });
    esperarMotivo(() => analizarCertificado(pfx(titular, CLAVE), CLAVE), 'no_vigente');
  });

  it('usa el reloj recibido para la vigencia', () => {
    const titular = certificado();
    const bytes = pfx(titular, CLAVE);
    esperarMotivo(
      () => analizarCertificado(bytes, CLAVE, { ahora: new Date(Date.now() + 400 * DIA) }),
      'vencido',
    );
  });

  it('contraseña incorrecta', () => {
    const bytes = pfx(certificado(), CLAVE);
    esperarMotivo(() => analizarCertificado(bytes, 'otra-clave'), 'clave_incorrecta');
    esperarMotivo(() => analizarCertificado(bytes, ''), 'clave_incorrecta');
  });

  it('no es un .pfx: bytes al azar, PEM, vacío, .pfx truncado', () => {
    esperarMotivo(() => analizarCertificado(new Uint8Array(0), CLAVE), 'no_es_pfx');
    esperarMotivo(
      () =>
        analizarCertificado(
          new Uint8Array(2048).map((_, i) => (i * 37) % 256),
          CLAVE,
        ),
      'no_es_pfx',
    );
    const pem = leerMaterial('cert-titular.pem');
    esperarMotivo(() => analizarCertificado(pem, ''), 'no_es_pfx');
    const bytes = pfx(certificado(), CLAVE);
    esperarMotivo(
      () => analizarCertificado(bytes.subarray(0, bytes.length / 2), CLAVE),
      'no_es_pfx',
    );
    // Un DER válido que no es PKCS#12 (un certificado suelto).
    const der = new X509Certificate(forge.pki.certificateToPem(certificado().forge)).raw;
    esperarMotivo(() => analizarCertificado(der, CLAVE), 'no_es_pfx');
  });

  it('dañado: .pfx sin llave privada', () => {
    const titular = certificado();
    const asn1 = forge.pkcs12.toPkcs12Asn1(null, [titular.forge], CLAVE, { algorithm: 'aes256' });
    const bytes = Buffer.from(forge.asn1.toDer(asn1).getBytes(), 'binary');
    esperarMotivo(() => analizarCertificado(bytes, CLAVE), 'danado');
  });

  describe('material de paridad (paridad/material, clave documentada)', () => {
    // Oráculo de la librería: por la ruta legacy (`openssl pkcs12 -legacy`) la hoja
    // no termina en "\n"; por la nativa sí (ver el encabezado de certificado.ts).
    function legacySegunLibreria(bytes: Buffer): boolean {
      return !Certificado.desdeContenido(bytes, CLAVE_MATERIAL).certificado.endsWith('\n');
    }

    it.each([
      ['cert-legacy.pfx', true],
      ['cert-legacy-cadena.pfx', true],
      ['cert-moderno.pfx', false],
      ['cert-moderno-cadena.pfx', false],
      // 3DES (pbeWithSHAAnd3-KeyTripleDES-CBC) lo lee OpenSSL 3 sin el proveedor legacy.
      ['cert-3des-cadena.pfx', false],
    ])('%s → pfxLegacy = %s, igual que la librería', (archivo, legacy) => {
      const bytes = leerMaterial(archivo);
      const r = analizarCertificado(bytes, CLAVE_MATERIAL);
      expect(r.pfxLegacy).toBe(legacy);
      expect(r.pfxLegacy).toBe(legacySegunLibreria(bytes));
      expect(r.cn).toBe('Titular de Prueba Ñuñoa');
      expect(r.emisorCa).not.toBeNull();
      expect(r.huellaSha256).toMatch(/^[0-9a-f]{64}$/);
    });

    it('la huella del legacy y la del moderno son la misma hoja', () => {
      const legacy = analizarCertificado(leerMaterial('cert-legacy.pfx'), CLAVE_MATERIAL);
      const moderno = analizarCertificado(leerMaterial('cert-moderno.pfx'), CLAVE_MATERIAL);
      expect(legacy.huellaSha256).toBe(moderno.huellaSha256);
    });

    it('legacy con contraseña incorrecta', () => {
      esperarMotivo(
        () => analizarCertificado(leerMaterial('cert-legacy.pfx'), 'no-es-la-clave'),
        'clave_incorrecta',
      );
    });
  });
});

describe('analizarCertificado no filtra la clave ni el archivo (criterio de la Fase 3)', () => {
  const CENTINELA = 'CENTINELA-clave-7f3a9c1e-ÑandúZ';
  const espias: ReturnType<typeof vi.spyOn>[] = [];

  beforeEach(() => {
    for (const metodo of ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const) {
      espias.push(vi.spyOn(console, metodo).mockImplementation(() => {}));
    }
  });
  afterEach(() => {
    for (const espia of espias.splice(0)) espia.mockRestore();
  });

  it('ningún camino de error lleva la clave, el base64 ni los bytes', () => {
    const vigente = pfx(certificado(), CENTINELA);
    const vencido = pfx(
      certificado({ desde: new Date(Date.now() - 400 * DIA), hasta: new Date(Date.now() - DIA) }),
      CENTINELA,
    );
    const futuro = pfx(
      certificado({ desde: new Date(Date.now() + 2 * DIA), hasta: new Date(Date.now() + 9 * DIA) }),
      CENTINELA,
    );
    const sinLlave = Buffer.from(
      forge.asn1
        .toDer(forge.pkcs12.toPkcs12Asn1(null, [certificado().forge], CENTINELA, {}))
        .getBytes(),
      'binary',
    );
    const casos: [Uint8Array, string][] = [
      [vigente, `${CENTINELA}-mal`], // clave incorrecta (la centinela es prefijo)
      [vencido, CENTINELA],
      [futuro, CENTINELA],
      [sinLlave, CENTINELA],
      [Buffer.from(`-----BEGIN CERTIFICATE-----\n${CENTINELA}\n`), CENTINELA],
      [vigente.subarray(0, 100), CENTINELA],
    ];

    for (const [bytes, clave] of casos) {
      const error = capturar(() => analizarCertificado(bytes, clave));
      const base64 = Buffer.from(bytes).toString('base64');
      const textos = [
        error.message,
        String(error),
        error.stack ?? '',
        JSON.stringify(error),
        JSON.stringify(error.mensaje),
      ];
      for (const texto of textos) {
        expect(texto).not.toContain(CENTINELA);
        expect(texto).not.toContain(base64.slice(0, 40));
      }
      expect(error.cause).toBeUndefined();
    }

    for (const espia of espias) expect(espia).not.toHaveBeenCalled();
  });
});
