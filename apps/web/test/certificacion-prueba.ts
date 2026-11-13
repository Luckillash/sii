// Escenario de prueba de la capa de certificación (Fase 5): una organización con una
// empresa, un certificado de MENTIRA en el «Vault» del Supabase falso, los clientes de la
// librería reemplazados por dobles (ninguno sale a la red) y un `TransporteFalso` que
// registra cualquier petición que se escape (las pruebas exigen que no haya ninguna).

import { readFileSync } from 'node:fs';
import {
  Certificado,
  type DatosDeclaracion,
  type DatosPostulacion,
  EstadoDeclaracion,
  huellaCertificado,
  type OpcionesSolicitar,
  Rut,
  relojFijo,
  SesionSii,
  TokenStoreMemoria,
  TransporteFalso,
} from '@winex/certificacion';
import { vi } from 'vitest';
import type { ResultadoPaso } from '../src/lib/certificacion';
import type {
  ClienteDeclaracion,
  ClienteFolios,
  ClientePostulacion,
  ClienteRest,
  DependenciasCertificacion,
} from '../src/server/certificacion/dependencias';
import type { ContextoCertificacion } from '../src/server/certificacion/tipos';
import type { MensajeCorreo, ResultadoEnvio } from '../src/server/correo/resend';
import type { RegistroOperacion } from '../src/server/sii/operacion';
import type { AlmacenSesiones, ClaveSesion } from '../src/server/sii/sesiones';
import { crearTransporte } from '../src/server/sii/transporte';
import { certificado, pfx } from './pfx-prueba';
import { type Fila, supabaseFalso } from './supabase-falso';

export const AHORA = new Date('2026-11-13T15:00:00Z');
export const ORG = '11111111-1111-4111-8111-111111111111';
export const EMPRESA = '22222222-2222-4222-8222-222222222222';
export const USUARIO = '33333333-3333-4333-8333-333333333333';
export const CERTIFICADO = '44444444-4444-4444-8444-444444444444';
export const RUT_EMPRESA = '76123456-0';
export const RUT_TITULAR = '12345678-5';

/** Secretos que nunca pueden aparecer en operaciones_sii, mensajes, Sentry ni consola. */
export const CLAVE_PFX = 'clave-pfx-super-secreta-987';
export const TOKEN_SII = 'TOKENSII0123456789abcdefTOKEN';
export const COOKIE_SII = 'COOKIESII9876543210zyxwvCOOKIE';

class SesionesMemoria implements AlmacenSesiones {
  readonly mapa = new Map<string, SesionSii>();
  #clave(c: ClaveSesion) {
    return `${c.certificadoId}:${c.ambiente}`;
  }
  async obtener(c: ClaveSesion) {
    return this.mapa.get(this.#clave(c));
  }
  async guardar(c: ClaveSesion, s: SesionSii) {
    this.mapa.set(this.#clave(c), s);
  }
  async descartar(c: ClaveSesion) {
    this.mapa.delete(this.#clave(c));
  }
}

export function sesionConCookie(): SesionSii {
  const s = new SesionSii({ reloj: relojFijo(AHORA) });
  s.recibirDesdeHtml(`<script>document.cookie="TOKEN=${COOKIE_SII}"</script>`);
  return s;
}

export function estadoDeclaracion(codigo: string | null, glosa = '', paso: number | null = null) {
  return new EstadoDeclaracion(Rut.de(RUT_EMPRESA), codigo, glosa, paso);
}

let material: { base64: string; huella: string } | undefined;
function materialPfx(): { base64: string; huella: string } {
  if (!material) {
    const bytes = pfx(
      certificado({
        cn: 'Titular de Prueba',
        desde: new Date(AHORA.getTime() - 86_400_000),
        hasta: new Date(AHORA.getTime() + 365 * 86_400_000),
      }),
      CLAVE_PFX,
    );
    material = {
      base64: bytes.toString('base64'),
      huella: huellaCertificado(Certificado.desdeContenido(bytes, CLAVE_PFX).certificado),
    };
  }
  return material;
}

export interface OpcionesEscenario {
  etapa?: string;
  proceso?: Partial<Fila> | null;
  tablas?: Record<string, Fila[]>;
}

/** Datos de postulación válidos (lo que dejaría el formulario). */
export const DATOS_POSTULACION: Fila = {
  rut_administrador: RUT_TITULAR,
  correo_administrador: 'admin@empresa.cl',
  correo_contacto_sii: 'contacto@empresa.cl',
  correo_intercambio: 'dte@empresa.cl',
  nombre_software: 'Boleteame',
  boleta_exenta: true,
  url: null,
};

export const DATOS_DECLARACION: Fila = {
  link_consulta: 'https://www.empresa.cl/boletas',
  rut_proveedor: '77777777-7',
  nombre_proveedor: 'Proveedor SpA',
  correo_proveedor: 'sw@proveedor.cl',
};

export function escenario(opciones: OpcionesEscenario = {}) {
  const secretos = new Map<string, string>([
    ['pfx-secreto', materialPfx().base64],
    ['clave-secreto', CLAVE_PFX],
  ]);
  const proceso =
    opciones.proceso === null
      ? []
      : [
          {
            id: '55555555-5555-4555-8555-555555555555',
            organizacion_id: ORG,
            empresa_id: EMPRESA,
            etapa: opciones.etapa ?? 'borrador',
            avisos_postulacion: [],
            boleta_exenta: true,
            ...DATOS_POSTULACION,
            ...opciones.proceso,
          },
        ];
  const tablas: Record<string, Fila[]> = {
    organizaciones: [{ id: ORG, nombre: 'Servicios Andinos', slug: 'servicios-andinos' }],
    empresas: [
      {
        id: EMPRESA,
        organizacion_id: ORG,
        rut: RUT_EMPRESA,
        razon_social: 'EMPRESA DE PRUEBA SPA',
        giro: 'Servicios informaticos',
        direccion: 'Calle Falsa 123',
        comuna: 'Santiago',
        activa: true,
        autorizada_produccion: false,
      },
    ],
    certificados: [
      {
        id: CERTIFICADO,
        organizacion_id: ORG,
        rut_titular: RUT_TITULAR,
        nombre_titular: 'Titular de Prueba',
        cn: 'Titular de Prueba',
        huella_sha256: materialPfx().huella,
        pfx_secret_id: 'pfx-secreto',
        clave_secret_id: 'clave-secreto',
        vigente_desde: new Date(AHORA.getTime() - 86_400_000).toISOString(),
        vigente_hasta: new Date(AHORA.getTime() + 365 * 86_400_000).toISOString(),
        revocado_en: null,
      },
    ],
    empresa_certificados: [
      {
        organizacion_id: ORG,
        empresa_id: EMPRESA,
        certificado_id: CERTIFICADO,
        es_representante_electronico: true,
        predeterminado: true,
      },
    ],
    miembros_organizacion: [
      { organizacion_id: ORG, usuario_id: USUARIO, rol: 'propietario' },
      { organizacion_id: ORG, usuario_id: '66666666-6666-4666-8666-666666666666', rol: 'lector' },
    ],
    perfiles: [
      { id: USUARIO, correo: 'duena@empresa.cl' },
      { id: '66666666-6666-4666-8666-666666666666', correo: 'lector@empresa.cl' },
    ],
    procesos_certificacion: proceso,
    ...opciones.tablas,
  };
  const falso = supabaseFalso({ tablas, secretos });
  // El cliente de sesión comparte las tablas del de servicio (misma «base»).
  const sesion = supabaseFalso({ db: falso.db, secretos, rol: 'authenticated' });

  const transporteFalso = new TransporteFalso();
  const registros: RegistroOperacion[] = [];
  const sesiones = new SesionesMemoria();
  const tokenStore = new TokenStoreMemoria();
  const correo = {
    enviar: vi.fn(
      async (_m: MensajeCorreo): Promise<ResultadoEnvio> => ({ ok: true, id: 'correo-1' }),
    ),
    urlApp: () => 'https://boleteame.dev',
  };

  const postulacion = {
    autenticar: vi.fn(async (_c: Certificado) => sesionConCookie()),
    postular: vi.fn(async (_s: SesionSii, _d: DatosPostulacion) => ({
      empresa: Rut.de(RUT_EMPRESA),
      avisos: ['La empresa dejará de usar el facturador gratuito del SII.'],
      mensaje: 'Postulación grabada.',
    })),
  } satisfies ClientePostulacion;
  const declaracion = {
    verificarPortal: vi.fn(async (): Promise<string[]> => []),
    estado: vi.fn(async (_s: SesionSii, _rut: string | Rut) => estadoDeclaracion(null)),
    descargarSetPruebas: vi.fn(
      async (_s: SesionSii, _rut: string | Rut, _correo: string): Promise<string> => SET_PRUEBAS,
    ),
    solicitarRevisionSet: vi.fn(
      async (_s: SesionSii, _rut: string | Rut, _trackId: string): Promise<void> => {},
    ),
    declarar: vi.fn(async (_s: SesionSii, _d: DatosDeclaracion) =>
      estadoDeclaracion('P91', 'Declaración efectuada', 91),
    ),
  } satisfies ClienteDeclaracion;
  const folios = {
    autenticar: vi.fn(async (_c: Certificado) => sesionConCookie()),
    solicitar: vi.fn(
      async (
        _s: SesionSii,
        _rut: string | Rut,
        _tipo: number,
        _cantidad: number,
        _opciones?: OpcionesSolicitar,
      ): Promise<Buffer> => Buffer.from(''),
    ),
  } satisfies ClienteFolios;
  const rest = {
    obtenerToken: vi.fn(async () => TOKEN_SII),
    enviarBoleta: vi.fn(async () => ({
      trackId: '123456789',
      estado: 'REC',
      fechaRecepcion: '2026-11-13 12:00:00',
      rutEmisor: RUT_EMPRESA,
      rutEnvia: RUT_TITULAR,
      archivo: 'envio.xml',
      json: { trackid: 123456789, estado: 'REC' },
    })),
    consultarEnvio: vi.fn(),
  } satisfies Partial<ClienteRest> as unknown as ClienteRest & {
    obtenerToken: ReturnType<typeof vi.fn>;
    enviarBoleta: ReturnType<typeof vi.fn>;
    consultarEnvio: ReturnType<typeof vi.fn>;
  };

  const deps: Partial<DependenciasCertificacion> = {
    servicio: () => falso.cliente,
    sesion: async () => sesion.cliente,
    reloj: relojFijo(AHORA),
    transporte: () => crearTransporte({ transporte: transporteFalso }),
    sesionesSii: () => sesiones,
    tokenStore: () => tokenStore,
    sii: {
      postulacion: () => postulacion,
      declaracion: () => declaracion,
      folios: () => folios,
      rest: () => rest,
    },
    operacion: {
      confirmarSesion: async () => true,
      registrar: (r) => {
        registros.push(r);
      },
    },
    bloqueo: { esperaMs: 0 },
    correo,
  };
  const ctx: ContextoCertificacion = {
    organizacionId: ORG,
    empresaId: EMPRESA,
    usuarioId: USUARIO,
  };

  return {
    falso,
    sesion,
    deps,
    ctx,
    registros,
    sesiones,
    transporteFalso,
    correo,
    postulacion,
    declaracion,
    folios,
    rest,
  };
}

export type Escenario = ReturnType<typeof escenario>;

/** El set de ejemplo versionado en la librería (5 casos, uno con un ítem exento). */
export const SET_PRUEBAS = readFileSync(
  new URL('../../../packages/certificacion/data/set_pruebas/Set Prueba BE.txt', import.meta.url),
  'utf8',
);

/**
 * Todo lo que la capa escribió (salvo la RPC que lleva el CAF a Vault, que es su único
 * camino legítimo), las filas de `operaciones_sii` y lo que recibió «Sentry».
 */
export function todoLoEscrito(e: Escenario): string {
  return JSON.stringify([
    e.falso.escrituras.filter((w) => w.accion !== 'rpc' || w.tabla !== 'registrar_caf'),
    e.falso.tabla('operaciones_sii'),
    e.registros,
  ]);
}

/** El id de la operación de un resultado (null en el ensayo). */
export function operacionDe(r: ResultadoPaso): string | null {
  return r.tipo === 'ensayo' ? null : r.operacionId;
}
