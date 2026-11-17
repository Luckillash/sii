import { describe, expect, it } from 'vitest';
import { supabaseFalso } from '../../../test/supabase-falso';
import type { ClienteServicio } from '../supabase/service';
import { acotarMotivo, ErrorDatosAlertas, repositorioSupabase } from './datos';

// `repositorioSupabase` contra el cliente falso (tablas en memoria): qué funciones de la
// 0013 llama y con qué parámetros, qué completa con lecturas directas, y cómo reclama,
// fija el grupo y cierra. El filtrado y el reparto por turnos de las funciones SQL se
// prueban en rls-fase8-notificaciones.sql.

const ORG = '11111111-1111-4111-8111-111111111111';
const ORG2 = '22222222-2222-4222-8222-222222222222';
const EMP = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const DESDE = '2026-11-14T15:00:00.000Z';

type Rpc = (args: Record<string, unknown>) => { data: unknown; error: { code: string } | null };

/** El falso con las RPC de la 0013 reemplazadas (el falso compartido no las implementa). */
function conRpc(f: ReturnType<typeof supabaseFalso>, rpcs: Record<string, Rpc>) {
  const llamadas: { nombre: string; args: Record<string, unknown> }[] = [];
  const cliente = {
    ...(f.cliente as unknown as Record<string, unknown>),
    rpc: async (nombre: string, args: Record<string, unknown>) => {
      llamadas.push({ nombre, args });
      const impl = rpcs[nombre];
      if (!impl) throw new Error(`RPC no esperada: ${nombre}`);
      return impl(args);
    },
  } as unknown as ClienteServicio;
  return { cliente, llamadas };
}

function base() {
  return supabaseFalso({
    tablas: {
      envio_rechazos: [
        {
          documento_id: 'd1',
          tipo_observacion: 'rechazo',
          descripcion: 'Rechazado',
          errores: [{ codigo: 'X1', descripcion: '  Error en\n el   monto total  ' }],
        },
        {
          documento_id: 'd2',
          tipo_observacion: 'reparo',
          descripcion: 'Reparo menor',
          errores: [],
        },
      ],
      envios: [{ id: 'envio-2', glosa_sii: 'Envío rechazado por error en carátula' }],
      documentos: [
        { id: 'd9', envio_id: 'inc-1', tipo_dte: 39, folio: 78, mnt_total: 990 },
        { id: 'd8', envio_id: 'inc-1', tipo_dte: 39, folio: 77, mnt_total: 1190 },
      ],
      empresas: [{ id: EMP, razon_social: 'Servicios Andinos SpA', rut: '76354771-K' }],
      organizaciones: [{ id: ORG, nombre: 'Servicios Andinos', slug: 'servicios-andinos' }],
      miembros_organizacion: [
        { organizacion_id: ORG, usuario_id: 'u1', rol: 'propietario' },
        { organizacion_id: ORG, usuario_id: 'u2', rol: 'administrador' },
        { organizacion_id: ORG, usuario_id: 'u3', rol: 'lector' },
        { organizacion_id: ORG, usuario_id: 'u4', rol: 'administrador' },
        { organizacion_id: ORG2, usuario_id: 'u5', rol: 'propietario' },
      ],
      perfiles: [
        { id: 'u1', correo: 'Duena@Empresa.cl ' },
        { id: 'u2', correo: 'duena@empresa.cl' },
        { id: 'u3', correo: 'lector@empresa.cl' },
        { id: 'u4', correo: null },
        { id: 'u5', correo: 'otra@org.cl' },
      ],
    },
  });
}

const fila = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  organizacion_id: ORG,
  empresa_id: EMP,
  ambiente: 'certificacion',
  tipo_dte: 39,
  folio: 41,
  mnt_total: 1190,
  fecha_emision: '2026-11-16',
  envio_id: 'envio-1',
  ...extra,
});

describe('repositorioSupabase: candidatos por las funciones de la 0013', () => {
  it('documentos rechazados: llama a alertas_documentos_rechazados con la ventana y el tope, y completa el motivo del SII o la glosa del envío', async () => {
    const { cliente, llamadas } = conRpc(base(), {
      alertas_documentos_rechazados: () => ({
        data: [fila('d1'), fila('d2', { envio_id: 'envio-2', folio: 42 })],
        error: null,
      }),
    });
    const filas = await repositorioSupabase(cliente).documentosRechazados(DESDE);
    expect(llamadas).toEqual([
      { nombre: 'alertas_documentos_rechazados', args: { p_desde: DESDE, p_limite: 200 } },
    ]);
    expect(filas.map((d) => [d.id, d.motivo])).toEqual([
      ['d1', 'Error en el monto total'],
      // d2 solo tiene un reparo: el motivo es la glosa del envío.
      ['d2', 'Envío rechazado por error en carátula'],
    ]);
    expect(filas[0]).toMatchObject({
      organizacionId: ORG,
      empresaId: EMP,
      ambiente: 'certificacion',
      tipoDte: 39,
      folio: 41,
      mntTotal: 1190,
      envioId: 'envio-1',
    });
  });

  it('envíos inciertos: llama a alertas_envios_inciertos y trae sus documentos ordenados por folio', async () => {
    const { cliente, llamadas } = conRpc(base(), {
      alertas_envios_inciertos: () => ({
        data: [
          {
            id: 'inc-1',
            organizacion_id: ORG,
            empresa_id: EMP,
            ambiente: 'produccion',
            creado_en: '2026-11-16T13:15:00.000Z',
          },
        ],
        error: null,
      }),
    });
    const filas = await repositorioSupabase(cliente).enviosInciertos(DESDE);
    expect(llamadas[0]).toEqual({
      nombre: 'alertas_envios_inciertos',
      args: { p_desde: DESDE, p_limite: 200 },
    });
    expect(filas).toEqual([
      {
        id: 'inc-1',
        organizacionId: ORG,
        empresaId: EMP,
        ambiente: 'produccion',
        creadoEn: '2026-11-16T13:15:00.000Z',
        documentos: [
          { tipoDte: 39, folio: 77, mntTotal: 1190 },
          { tipoDte: 39, folio: 78, mntTotal: 990 },
        ],
      },
    ]);
  });

  it('certificados: usa el umbral de la base y omite el ya reemplazado que no es predeterminado de nadie', async () => {
    const lejos = new Date(Date.now() + 400 * 86_400_000).toISOString();
    const f = supabaseFalso({
      tablas: {
        empresa_certificados: [
          { certificado_id: 'c1', empresa_id: EMP, predeterminado: true },
          { certificado_id: 'c2', empresa_id: EMP, predeterminado: true },
          { certificado_id: 'c3', empresa_id: EMP, predeterminado: false },
        ],
        empresas: [{ id: EMP, razon_social: 'Servicios Andinos SpA', rut: '76354771-K' }],
        certificados: [
          // Reemplazo de Juan Soto ya subido y vigente por más de 30 días.
          {
            id: 'c5',
            organizacion_id: ORG,
            rut_titular: '9876543-3',
            vigente_hasta: lejos,
            revocado_en: null,
          },
          // Un certificado con RUT nulo no reemplaza a nadie (y no empareja con otro nulo).
          {
            id: 'c6',
            organizacion_id: ORG,
            rut_titular: null,
            vigente_hasta: lejos,
            revocado_en: null,
          },
        ],
      },
    });
    const cert = (id: string, extra: Record<string, unknown>) => ({
      id,
      organizacion_id: ORG,
      cn: null,
      vigente_hasta: '2026-12-01T00:00:00Z',
      ...extra,
    });
    const { cliente, llamadas } = conRpc(f, {
      alertas_certificados_por_vencer: () => ({
        data: [
          cert('c1', {
            rut_titular: '12345678-5',
            nombre_titular: 'Ana Pérez',
            dias_restantes: 14,
            umbral: 15,
          }),
          cert('c2', {
            rut_titular: '9876543-3',
            nombre_titular: null,
            cn: 'JUAN SOTO',
            dias_restantes: 3,
            umbral: 7,
          }),
          cert('c3', {
            rut_titular: '9876543-3',
            nombre_titular: 'Juan Soto',
            dias_restantes: 8,
            umbral: 15,
          }),
          cert('c4', {
            rut_titular: null,
            nombre_titular: 'Sin RUT',
            dias_restantes: 20,
            umbral: 30,
          }),
        ],
        error: null,
      }),
    });
    const filas = await repositorioSupabase(cliente).certificadosPorVencer();
    expect(llamadas[0]).toEqual({
      nombre: 'alertas_certificados_por_vencer',
      args: { p_limite: 200 },
    });
    // c2 sigue siendo predeterminado: se avisa aunque haya reemplazo. c3 no: se omite. c4
    // no tiene RUT: el c6 (también sin RUT) no cuenta como su reemplazo.
    expect(filas.map((c) => [c.id, c.titular, c.dias, c.umbral, c.empresas])).toEqual([
      ['c1', 'Ana Pérez', 14, 15, ['Servicios Andinos SpA']],
      ['c2', 'JUAN SOTO', 3, 7, ['Servicios Andinos SpA']],
      ['c4', 'Sin RUT', 20, 30, []],
    ]);
  });

  it('destinatarios: propietarios y administradores, correos normalizados y sin repetir; nunca el lector', async () => {
    const f = base();
    const mapa = await repositorioSupabase(f.cliente).destinatarios([ORG, ORG2, ORG]);
    expect(mapa.get(ORG)).toEqual(['duena@empresa.cl']);
    expect(mapa.get(ORG2)).toEqual(['otra@org.cl']);
  });

  it('un error de la base lanza ErrorDatosAlertas con el código, sin el mensaje', async () => {
    const { cliente } = conRpc(base(), {
      alertas_documentos_rechazados: () => ({
        data: null,
        error: { code: '42883', message: 'function secreta does not exist' } as { code: string },
      }),
    });
    const promesa = repositorioSupabase(cliente).documentosRechazados(DESDE);
    await expect(promesa).rejects.toBeInstanceOf(ErrorDatosAlertas);
    await expect(promesa).rejects.toThrow(
      'alertas: falló leer documentos rechazados (código 42883)',
    );
    await expect(promesa).rejects.not.toThrow('secreta');
  });
});

describe('repositorioSupabase: reclamar, grupo y cierre', () => {
  it('reclamar llama a reclamar_notificacion con los nombres de la 0013 y devuelve id, intentos y grupo (o null)', async () => {
    let respuesta: unknown = [{ id: 'n1', intentos: 2, grupo: 'documento.rechazado/x/abc' }];
    const { cliente, llamadas } = conRpc(base(), {
      reclamar_notificacion: () => ({ data: respuesta, error: null }),
    });
    const repo = repositorioSupabase(cliente);
    const n = {
      organizacionId: ORG,
      tipo: 'documento.rechazado',
      clave: 'documento.rechazado:d1',
      referenciaId: 'd1',
      datos: { ambiente: 'certificacion' },
    };
    expect(await repo.reclamar(n)).toEqual({
      id: 'n1',
      intentos: 2,
      grupo: 'documento.rechazado/x/abc',
    });
    respuesta = [];
    expect(await repo.reclamar(n)).toBeNull();
    respuesta = null;
    expect(await repo.reclamar(n)).toBeNull();
    expect(llamadas[0]).toEqual({
      nombre: 'reclamar_notificacion',
      args: {
        p_organizacion: ORG,
        p_tipo: 'documento.rechazado',
        p_clave: 'documento.rechazado:d1',
        p_referencia: 'd1',
        p_datos: { ambiente: 'certificacion' },
      },
    });
  });

  it('fijarGrupo y cerrar actualizan solo las filas pendientes indicadas', async () => {
    const f = supabaseFalso({
      tablas: {
        notificaciones: [
          { id: 'n1', estado: 'pendiente', grupo: null },
          { id: 'n2', estado: 'pendiente', grupo: null },
          { id: 'n3', estado: 'enviada', grupo: 'otro' },
          { id: 'n4', estado: 'pendiente', grupo: null },
        ],
      },
    });
    const repo = repositorioSupabase(f.cliente);
    await repo.fijarGrupo(['n1', 'n2', 'n3'], 'documento.rechazado/o/h');
    await repo.cerrar(['n1', 'n3'], {
      estado: 'enviada',
      resendId: 're-1',
      destinatarios: ['a@b.cl'],
      enviadoEn: '2026-11-16T15:00:00.000Z',
    });
    await repo.cerrar(['n2'], { estado: 'fallida', error: 'red: x', destinatarios: ['a@b.cl'] });
    const filas = f.tabla('notificaciones');
    expect(filas.find((x) => x.id === 'n1')).toMatchObject({
      estado: 'enviada',
      resend_id: 're-1',
      error: null,
      grupo: 'documento.rechazado/o/h',
    });
    expect(filas.find((x) => x.id === 'n2')).toMatchObject({
      estado: 'fallida',
      error: 'red: x',
      grupo: 'documento.rechazado/o/h',
    });
    expect(filas.find((x) => x.id === 'n3')).toMatchObject({ grupo: 'otro' });
    expect(filas.find((x) => x.id === 'n3')?.resend_id).toBeUndefined();
    expect(filas.find((x) => x.id === 'n4')).toMatchObject({ estado: 'pendiente', grupo: null });
  });
});

describe('acotarMotivo', () => {
  it('una línea, sin controles, recortada a 200 caracteres', () => {
    expect(acotarMotivo('  a\n\tb  ')).toBe('a b');
    expect(acotarMotivo('')).toBeNull();
    expect(acotarMotivo(null)).toBeNull();
    const largo = acotarMotivo('x'.repeat(500));
    expect(largo?.length).toBe(200);
    expect(largo?.endsWith('…')).toBe(true);
  });
});
