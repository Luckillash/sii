// `sii certificacion declarar`: declara el cumplimiento (autoriza en producción).

import { ErrorTransporte, RespuestaHttp } from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { CODIGOS } from '../../../src/errores.ts';
import { correr, proyecto } from '../../soporte/cli.ts';
import { GWT, LOGIN_OK, metodoGwt, resumen, siiFalso } from './sii-falso.ts';

const FACADE = 'POST www4.sii.cl/certBolElectDteInternet/facade';
const DATOS = {
  linkConsulta: 'https://www.empresa-prueba.cl/boletas',
  rutProveedor: '22.222.222-2',
  nombreProveedor: 'Proveedor de Prueba SpA',
};

type Autorizar = string | RespuestaHttp | (() => never);
const transporte = (estado: string = GWT.P90, autorizar: Autorizar = GWT.AUTORIZAR_P91) =>
  siiFalso({
    login: LOGIN_OK,
    gwt: {
      obtenerEstadoAutorizaEmp: estado,
      recuperarNombreContribuyente: GWT.NOMBRE,
      listarDocAutorizados: GWT.DOCUMENTOS,
      autorizarEmpresaBolProd: autorizar,
    },
  });

function conDatos(datos: unknown = DATOS) {
  const p = proyecto();
  p.escribir('declaracion.json', typeof datos === 'string' ? datos : JSON.stringify(datos));
  return p;
}

const ARGS = ['certificacion', 'declarar', '--datos', 'declaracion.json'];

describe('certificacion declarar', () => {
  it('con --confirmar: estado P90, razón social, documentos y autorizarEmpresaBolProd', async () => {
    const t = transporte();
    const r = await correr(conDatos(), [...ARGS, '--confirmar'], { transporte: t });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(resumen(t.enviadas)).toEqual([
      'POST herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi',
      `${FACADE} obtenerEstadoAutorizaEmp`,
      `${FACADE} recuperarNombreContribuyente`,
      `${FACADE} listarDocAutorizados`,
      `${FACADE} autorizarEmpresaBolProd`,
    ]);
    const orden = t.enviadas[4];
    expect(orden?.conexionNueva).toBe(true);
    const cuerpo = orden?.bytes?.toString('utf8') ?? '';
    // Datos del JSON, correo de SII_CORREO_PROVEEDOR y fecha de hoy en Chile.
    expect(cuerpo).toContain('|https://www.empresa-prueba.cl/boletas|');
    expect(cuerpo).toContain('|Proveedor de Prueba SpA|');
    expect(cuerpo).toContain('|proveedor@example.com|');
    expect(cuerpo).toContain('|07-11-2026|');
    expect(r.stdout).toContain('Declaración efectuada: P91');
    expect(r.stdout).toContain('quedó autorizada en producción');
  });

  it('el JSON puede traer rutEmpresa y correoProveedor (ganan sobre el .env)', async () => {
    const t = transporte();
    const r = await correr(
      conDatos({ ...DATOS, rutEmpresa: '11111111-1', correoProveedor: 'sw@proveedor.cl' }),
      [...ARGS, '--confirmar'],
      { transporte: t },
    );
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(t.enviadas[1]?.bytes?.toString('utf8')).toContain('|11111111|');
    expect(t.enviadas[4]?.bytes?.toString('utf8')).toContain('|sw@proveedor.cl|');
  });

  it('sin --confirmar: muestra el resumen y no envía nada', async () => {
    const r = await correr(conDatos(), ARGS, { transporte: transporte() });
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(r.stdout).toContain('Proveedor de software: 22222222-2 Proveedor de Prueba SpA');
    expect(r.stdout).toContain('AUTORIZADA EN PRODUCCIÓN');
    expect(r.stdout).toContain('NO se envió nada');
  });

  it('empresa que no está en P90: la librería se detiene sin grabar (código 5)', async () => {
    const t = transporte(GWT.P80);
    const r = await correr(conDatos(), [...ARGS, '--confirmar'], { transporte: t });
    expect(r.codigo).toBe(CODIGOS.SII);
    expect(r.stderr).toContain('no está en el paso de declarar');
    expect(t.enviadas.map(metodoGwt)).not.toContain('autorizarEmpresaBolProd');
  });

  it.each([
    [
      'red caída',
      (): never => {
        throw new ErrorTransporte('Se agotó el tiempo de espera.', 'https://www4.sii.cl');
      },
    ],
    ['HTTP 500', new RespuestaHttp(500)],
    ['sin P91', GWT.NULO],
  ] as const)(
    'declaración incierta (%s): código 6 y pide consultar el estado',
    async (_, autorizar) => {
      const r = await correr(conDatos(), [...ARGS, '--confirmar'], {
        transporte: transporte(GWT.P90, autorizar),
      });
      expect(r.codigo).toBe(CODIGOS.INCIERTO);
      expect(r.stderr).toContain('DeclaracionInciertaError');
      expect(r.stderr).toContain('sii certificacion estado-declaracion 76123456-0');
      expect(r.stderr).toContain('NO repitas');
    },
  );

  it('sin --datos: código 2', async () => {
    const r = await correr(proyecto(), ['certificacion', 'declarar', '--confirmar']);
    expect(r.codigo).toBe(CODIGOS.USO);
    expect(r.stderr).toContain('Falta --datos');
  });

  it.each([
    ['no es JSON', '{ linkConsulta: ', 'no es JSON válido'],
    ['no es objeto', '[]', '(raíz): debe ser un objeto JSON'],
    ['falta un campo', { ...DATOS, rutProveedor: undefined }, 'rutProveedor: debe ser texto'],
    ['RUT inválido', { ...DATOS, rutProveedor: '22222222-3' }, 'rutProveedor: no es un RUT válido'],
    ['campo desconocido', { ...DATOS, nombreProvedor: 'x' }, 'campo desconocido: nombreProvedor'],
    ['nombre largo', { ...DATOS, nombreProveedor: 'x'.repeat(31) }, 'como máximo 30 caracteres'],
    ['correo', { ...DATOS, correoProveedor: 'a+b@x.cl' }, 'no lo acepta el SII'],
  ])('datos inválidos (%s): código 3 sin peticiones', async (_, datos, mensaje) => {
    const r = await correr(conDatos(datos), [...ARGS, '--confirmar'], { transporte: transporte() });
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain(mensaje);
    expect(r.transporte.enviadas).toHaveLength(0);
  });

  it('archivo de datos inexistente: código 3', async () => {
    const r = await correr(proyecto(), ARGS);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('No existe el archivo indicado en --datos');
  });
});
