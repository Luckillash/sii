import { Certificado, FirmaElectronica, huellaCertificado, relojFijo } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { certificado, pfx } from '../../../test/pfx-prueba';
import type { ClienteServicio } from '../supabase/service';
import { crearCredenciales, ErrorCredenciales, type MotivoCredenciales } from './credenciales';

// Sin red ni base: un cliente falso filtra tablas en memoria (así se prueba que cada
// consulta filtra por organización) y responde `leer_secreto` desde un Map.

const DIA = 86_400_000;
const AHORA = new Date('2026-11-13T15:00:00Z');
const ORG = '11111111-1111-4111-8111-111111111111';
const OTRA_ORG = '22222222-2222-4222-8222-222222222222';
const EMPRESA = '33333333-3333-4333-8333-333333333333';
const CLAVE = 'clave-super-secreta-123';

type Fila = Record<string, unknown>;

interface Material {
  fila: Fila;
  pfxBase64: string;
}

let secuencia = 0;

/** Un certificado con su .pfx y su fila de `certificados` (secretos en el Map). */
function material(
  secretos: Map<string, string>,
  opciones: {
    org?: string;
    desde?: Date;
    hasta?: Date;
    revocado?: boolean;
    huella?: string;
    filaHasta?: string;
    clave?: string;
  } = {},
): Material {
  secuencia += 1;
  const titular = certificado({
    desde: opciones.desde ?? new Date(AHORA.getTime() - DIA),
    hasta: opciones.hasta ?? new Date(AHORA.getTime() + 365 * DIA),
  });
  const bytes = pfx(titular, opciones.clave ?? CLAVE);
  const pfxBase64 = bytes.toString('base64');
  const huella = huellaCertificado(
    Certificado.desdeContenido(bytes, opciones.clave ?? CLAVE).certificado,
  );
  const id = `00000000-0000-4000-8000-${String(secuencia).padStart(12, '0')}`;
  secretos.set(`pfx-${id}`, pfxBase64);
  secretos.set(`clave-${id}`, CLAVE);
  return {
    pfxBase64,
    fila: {
      id,
      organizacion_id: opciones.org ?? ORG,
      rut_titular: '12345678-5',
      huella_sha256: opciones.huella ?? huella,
      pfx_secret_id: `pfx-${id}`,
      clave_secret_id: `clave-${id}`,
      vigente_desde: new Date(AHORA.getTime() - DIA).toISOString(),
      vigente_hasta:
        opciones.filaHasta ??
        (opciones.hasta ?? new Date(AHORA.getTime() + 365 * DIA)).toISOString(),
      revocado_en: opciones.revocado ? AHORA.toISOString() : null,
    },
  };
}

function clienteFalso(tablas: Record<string, Fila[]>, secretos: Map<string, string>) {
  const consultas: { tabla: string; filtros: [string, unknown][] }[] = [];
  const secretosLeidos: string[] = [];
  const fallas = { tabla: null as string | null, rpc: false };

  function from(tabla: string) {
    const registro = { tabla, filtros: [] as [string, unknown][] };
    consultas.push(registro);
    const predicados: ((f: Fila) => boolean)[] = [];
    const resolver = () =>
      fallas.tabla === tabla
        ? { data: null, error: { code: '57014', message: 'detalle con datos de la fila' } }
        : { data: (tablas[tabla] ?? []).filter((f) => predicados.every((p) => p(f))), error: null };
    const consulta = {
      select: () => consulta,
      eq: (columna: string, valor: unknown) => {
        registro.filtros.push([columna, valor]);
        predicados.push((f) => f[columna] === valor);
        return consulta;
      },
      in: (columna: string, valores: unknown[]) => {
        registro.filtros.push([columna, valores]);
        predicados.push((f) => valores.includes(f[columna]));
        return consulta;
      },
      maybeSingle: async () => {
        const r = resolver();
        return r.error ? r : { data: r.data?.[0] ?? null, error: null };
      },
      // biome-ignore lint/suspicious/noThenProperty: imita el builder de PostgREST, que es thenable.
      then: (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
        Promise.resolve(resolver()).then(ok, ko),
    };
    return consulta;
  }

  async function rpc(funcion: string, argumentos: { p_id: string }) {
    if (funcion !== 'leer_secreto') throw new Error(`RPC inesperada: ${funcion}`);
    secretosLeidos.push(argumentos.p_id);
    if (fallas.rpc) return { data: null, error: { code: 'XX000', message: 'detalle de vault' } };
    return { data: secretos.get(argumentos.p_id) ?? null, error: null };
  }

  return {
    cliente: { from, rpc } as unknown as ClienteServicio,
    consultas,
    secretosLeidos,
    fallas,
  };
}

const reloj = relojFijo(AHORA);

async function capturar(promesa: Promise<unknown>): Promise<ErrorCredenciales> {
  const error = await promesa.then(
    () => {
      throw new Error('Se esperaba ErrorCredenciales');
    },
    (e: unknown) => e,
  );
  if (!(error instanceof ErrorCredenciales)) throw error;
  return error;
}

async function esperarMotivo(promesa: Promise<unknown>, motivo: MotivoCredenciales) {
  const error = await capturar(promesa);
  expect(error.motivo).toBe(motivo);
  expect(error.cause).toBeUndefined();
  expect(error.message).toBe(error.mensaje.titulo);
  return error;
}

describe('crearCredenciales', () => {
  it('carga el predeterminado de la empresa: Certificado y FirmaElectronica en memoria', async () => {
    const secretos = new Map<string, string>();
    const otro = material(secretos);
    const pred = material(secretos);
    const { cliente, consultas } = clienteFalso(
      {
        certificados: [otro.fila, pred.fila],
        empresa_certificados: [
          {
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            certificado_id: otro.fila.id,
            es_representante_electronico: false,
            predeterminado: false,
          },
          {
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            certificado_id: pred.fila.id,
            es_representante_electronico: false,
            predeterminado: true,
          },
        ],
      },
      secretos,
    );

    const c = await crearCredenciales(cliente, { reloj }).certificadoDeEmpresa({
      organizacionId: ORG,
      empresaId: EMPRESA,
    });

    expect(c.certificadoId).toBe(pred.fila.id);
    expect(c.organizacionId).toBe(ORG);
    expect(c.rutTitular).toBe('12345678-5');
    expect(c.huellaSha256).toBe(pred.fila.huella_sha256);
    expect(c.certificado).toBeInstanceOf(Certificado);
    expect(c.firma).toBeInstanceOf(FirmaElectronica);
    expect(c.firma.firmarSemilla('123')).toContain('<SignatureValue>');
    // Cada consulta filtra por organización (service_role salta RLS).
    for (const consulta of consultas) {
      expect(consulta.filtros).toContainEqual(['organizacion_id', ORG]);
    }
  });

  it('caché por invocación: Vault se lee una vez, también con llamadas simultáneas', async () => {
    const secretos = new Map<string, string>();
    const m = material(secretos);
    const falso = clienteFalso(
      {
        certificados: [m.fila],
        empresa_certificados: [
          {
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            certificado_id: m.fila.id,
            es_representante_electronico: true,
            predeterminado: true,
          },
        ],
      },
      secretos,
    );
    const credenciales = crearCredenciales(falso.cliente, { reloj });
    const id = { organizacionId: ORG, certificadoId: String(m.fila.id) };

    const [a, b] = await Promise.all([
      credenciales.certificadoPorId(id),
      credenciales.certificadoDeEmpresa({ organizacionId: ORG, empresaId: EMPRESA }),
    ]);
    const c = await credenciales.certificadoPorId(id);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(falso.secretosLeidos).toHaveLength(2);

    // Otra invocación no comparte el caché.
    await crearCredenciales(falso.cliente, { reloj }).certificadoPorId(id);
    expect(falso.secretosLeidos).toHaveLength(4);
  });

  it('un certificado de otra organización no existe para esta', async () => {
    const secretos = new Map<string, string>();
    const ajeno = material(secretos, { org: OTRA_ORG });
    const falso = clienteFalso({ certificados: [ajeno.fila] }, secretos);
    const error = await esperarMotivo(
      crearCredenciales(falso.cliente, { reloj }).certificadoPorId({
        organizacionId: ORG,
        certificadoId: String(ajeno.fila.id),
      }),
      'sin_certificado',
    );
    expect(error.resultado).toBe('config');
    expect(falso.secretosLeidos).toHaveLength(0);
  });

  it('revocado: no se usa ni se abre Vault', async () => {
    const secretos = new Map<string, string>();
    const m = material(secretos, { revocado: true });
    const falso = clienteFalso({ certificados: [m.fila] }, secretos);
    const error = await esperarMotivo(
      crearCredenciales(falso.cliente, { reloj }).certificadoPorId({
        organizacionId: ORG,
        certificadoId: String(m.fila.id),
      }),
      'revocado',
    );
    expect(error.mensaje.detalle).toContain('Configuración');
    expect(falso.secretosLeidos).toHaveLength(0);
  });

  it('el predeterminado revocado no se reemplaza en silencio por otro', async () => {
    const secretos = new Map<string, string>();
    const revocado = material(secretos, { revocado: true });
    const vigente = material(secretos);
    const falso = clienteFalso(
      {
        certificados: [revocado.fila, vigente.fila],
        empresa_certificados: [
          {
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            certificado_id: revocado.fila.id,
            es_representante_electronico: false,
            predeterminado: true,
          },
          {
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            certificado_id: vigente.fila.id,
            es_representante_electronico: false,
            predeterminado: false,
          },
        ],
      },
      secretos,
    );
    const error = await esperarMotivo(
      crearCredenciales(falso.cliente, { reloj }).certificadoDeEmpresa({
        organizacionId: ORG,
        empresaId: EMPRESA,
      }),
      'revocado',
    );
    expect(error.mensaje.titulo).toBe('El certificado predeterminado de la empresa está revocado');
  });

  it('vencido según la fila: no abre Vault y dice la fecha', async () => {
    const secretos = new Map<string, string>();
    const m = material(secretos, { filaHasta: '2026-10-01T03:00:00Z' });
    const falso = clienteFalso({ certificados: [m.fila] }, secretos);
    const error = await esperarMotivo(
      crearCredenciales(falso.cliente, { reloj }).certificadoPorId({
        organizacionId: ORG,
        certificadoId: String(m.fila.id),
      }),
      'vencido',
    );
    expect(error.mensaje.detalle).toContain('Venció el 01-10-2026');
    expect(falso.secretosLeidos).toHaveLength(0);
  });

  it('vencido según el certificado aunque la fila diga otra cosa', async () => {
    const secretos = new Map<string, string>();
    const m = material(secretos, {
      desde: new Date(AHORA.getTime() - 400 * DIA),
      hasta: new Date(AHORA.getTime() - 2 * DIA),
      filaHasta: new Date(AHORA.getTime() + DIA).toISOString(),
    });
    const falso = clienteFalso({ certificados: [m.fila] }, secretos);
    await esperarMotivo(
      crearCredenciales(falso.cliente, { reloj }).certificadoPorId({
        organizacionId: ORG,
        certificadoId: String(m.fila.id),
      }),
      'vencido',
    );
  });

  it('todavía no vigente', async () => {
    const secretos = new Map<string, string>();
    const m = material(secretos, { desde: new Date(AHORA.getTime() + 2 * DIA) });
    const falso = clienteFalso({ certificados: [m.fila] }, secretos);
    await esperarMotivo(
      crearCredenciales(falso.cliente, { reloj }).certificadoPorId({
        organizacionId: ORG,
        certificadoId: String(m.fila.id),
      }),
      'no_vigente',
    );
  });

  it('huella distinta: el .pfx de Vault no es el de la fila', async () => {
    const secretos = new Map<string, string>();
    const m = material(secretos, { huella: 'f'.repeat(64) });
    const falso = clienteFalso({ certificados: [m.fila] }, secretos);
    await esperarMotivo(
      crearCredenciales(falso.cliente, { reloj }).certificadoPorId({
        organizacionId: ORG,
        certificadoId: String(m.fila.id),
      }),
      'huella_distinta',
    );
  });

  it('falta un secreto en Vault', async () => {
    const secretos = new Map<string, string>();
    const m = material(secretos);
    secretos.delete(String(m.fila.clave_secret_id));
    const falso = clienteFalso({ certificados: [m.fila] }, secretos);
    await esperarMotivo(
      crearCredenciales(falso.cliente, { reloj }).certificadoPorId({
        organizacionId: ORG,
        certificadoId: String(m.fila.id),
      }),
      'vault',
    );
  });

  it('el .pfx no abre con la clave guardada: ilegible, sin la clave ni el .pfx en el error', async () => {
    const secretos = new Map<string, string>();
    const m = material(secretos, { clave: 'otra-clave-distinta' });
    const falso = clienteFalso({ certificados: [m.fila] }, secretos);
    const error = await esperarMotivo(
      crearCredenciales(falso.cliente, { reloj }).certificadoPorId({
        organizacionId: ORG,
        certificadoId: String(m.fila.id),
      }),
      'ilegible',
    );
    const todo = JSON.stringify({ m: error.message, d: error.mensaje, s: error.stack });
    expect(todo).not.toContain(CLAVE);
    expect(todo).not.toContain('otra-clave-distinta');
    expect(todo).not.toContain(m.pfxBase64.slice(0, 40));
  });

  it('falla de Supabase: `base` (resultado error) con el código y sin el detalle', async () => {
    const secretos = new Map<string, string>();
    const m = material(secretos);
    const falso = clienteFalso({ certificados: [m.fila] }, secretos);
    falso.fallas.rpc = true;
    const credenciales = crearCredenciales(falso.cliente, { reloj });
    const id = { organizacionId: ORG, certificadoId: String(m.fila.id) };
    const error = await esperarMotivo(credenciales.certificadoPorId(id), 'base');
    expect(error.resultado).toBe('error');
    expect(error.mensaje.detalle).toContain('XX000');
    expect(error.mensaje.detalle).not.toContain('detalle de vault');

    // El error no queda en caché: un reintento en la misma invocación vuelve a leer.
    falso.fallas.rpc = false;
    await expect(credenciales.certificadoPorId(id)).resolves.toMatchObject({
      certificadoId: m.fila.id,
    });

    falso.fallas.tabla = 'certificados';
    const otra = crearCredenciales(falso.cliente, { reloj });
    const errorTabla = await esperarMotivo(otra.certificadoPorId(id), 'base');
    expect(errorTabla.message).not.toContain('detalle con datos');
  });

  it('la empresa sin predeterminado', async () => {
    const secretos = new Map<string, string>();
    const m = material(secretos);
    const falso = clienteFalso(
      {
        certificados: [m.fila],
        empresa_certificados: [
          {
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            certificado_id: m.fila.id,
            es_representante_electronico: false,
            predeterminado: false,
          },
        ],
      },
      secretos,
    );
    const error = await esperarMotivo(
      crearCredenciales(falso.cliente, { reloj }).certificadoDeEmpresa({
        organizacionId: ORG,
        empresaId: EMPRESA,
      }),
      'sin_certificado',
    );
    expect(error.mensaje.titulo).toBe('La empresa no tiene un certificado predeterminado');
  });

  it('la empresa de otra organización no entrega su certificado', async () => {
    const secretos = new Map<string, string>();
    const m = material(secretos, { org: OTRA_ORG });
    const falso = clienteFalso(
      {
        certificados: [m.fila],
        empresa_certificados: [
          {
            organizacion_id: OTRA_ORG,
            empresa_id: EMPRESA,
            certificado_id: m.fila.id,
            es_representante_electronico: true,
            predeterminado: true,
          },
        ],
      },
      secretos,
    );
    await esperarMotivo(
      crearCredenciales(falso.cliente, { reloj }).certificadoDeEmpresa({
        organizacionId: ORG,
        empresaId: EMPRESA,
      }),
      'sin_certificado',
    );
  });

  describe('representante electrónico', () => {
    it('prefiere el predeterminado si es representante y está vigente', async () => {
      const secretos = new Map<string, string>();
      const otro = material(secretos, { hasta: new Date(AHORA.getTime() + 700 * DIA) });
      const pred = material(secretos);
      const falso = clienteFalso(
        {
          certificados: [otro.fila, pred.fila],
          empresa_certificados: [
            {
              organizacion_id: ORG,
              empresa_id: EMPRESA,
              certificado_id: otro.fila.id,
              es_representante_electronico: true,
              predeterminado: false,
            },
            {
              organizacion_id: ORG,
              empresa_id: EMPRESA,
              certificado_id: pred.fila.id,
              es_representante_electronico: true,
              predeterminado: true,
            },
          ],
        },
        secretos,
      );
      const c = await crearCredenciales(falso.cliente, { reloj }).certificadoDeEmpresa({
        organizacionId: ORG,
        empresaId: EMPRESA,
        representante: true,
      });
      expect(c.certificadoId).toBe(pred.fila.id);
    });

    it('si el predeterminado no es representante (o está revocado), toma el representante que vence más tarde', async () => {
      const secretos = new Map<string, string>();
      const pred = material(secretos);
      const revocado = material(secretos, { revocado: true });
      const corto = material(secretos, { hasta: new Date(AHORA.getTime() + 30 * DIA) });
      const largo = material(secretos, { hasta: new Date(AHORA.getTime() + 600 * DIA) });
      const vencido = material(secretos, { filaHasta: '2026-01-01T00:00:00Z' });
      const falso = clienteFalso(
        {
          certificados: [pred.fila, revocado.fila, corto.fila, largo.fila, vencido.fila],
          empresa_certificados: [
            {
              organizacion_id: ORG,
              empresa_id: EMPRESA,
              certificado_id: pred.fila.id,
              es_representante_electronico: false,
              predeterminado: true,
            },
            {
              organizacion_id: ORG,
              empresa_id: EMPRESA,
              certificado_id: revocado.fila.id,
              es_representante_electronico: true,
              predeterminado: false,
            },
            {
              organizacion_id: ORG,
              empresa_id: EMPRESA,
              certificado_id: corto.fila.id,
              es_representante_electronico: true,
              predeterminado: false,
            },
            {
              organizacion_id: ORG,
              empresa_id: EMPRESA,
              certificado_id: largo.fila.id,
              es_representante_electronico: true,
              predeterminado: false,
            },
            {
              organizacion_id: ORG,
              empresa_id: EMPRESA,
              certificado_id: vencido.fila.id,
              es_representante_electronico: true,
              predeterminado: false,
            },
          ],
        },
        secretos,
      );
      const c = await crearCredenciales(falso.cliente, { reloj }).certificadoDeEmpresa({
        organizacionId: ORG,
        empresaId: EMPRESA,
        representante: true,
      });
      expect(c.certificadoId).toBe(largo.fila.id);
    });

    it('sin representante vigente', async () => {
      const secretos = new Map<string, string>();
      const pred = material(secretos);
      const revocado = material(secretos, { revocado: true });
      const falso = clienteFalso(
        {
          certificados: [pred.fila, revocado.fila],
          empresa_certificados: [
            {
              organizacion_id: ORG,
              empresa_id: EMPRESA,
              certificado_id: pred.fila.id,
              es_representante_electronico: false,
              predeterminado: true,
            },
            {
              organizacion_id: ORG,
              empresa_id: EMPRESA,
              certificado_id: revocado.fila.id,
              es_representante_electronico: true,
              predeterminado: false,
            },
          ],
        },
        secretos,
      );
      const error = await esperarMotivo(
        crearCredenciales(falso.cliente, { reloj }).certificadoDeEmpresa({
          organizacionId: ORG,
          empresaId: EMPRESA,
          representante: true,
        }),
        'sin_representante',
      );
      expect(error.mensaje.detalle).toContain('representante electrónico');
      expect(falso.secretosLeidos).toHaveLength(0);
    });
  });
});
