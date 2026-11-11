// Port de tests/Postulacion/DatosPostulacionTest.php (winex/certificacion v1.9.1),
// más casos de DatosDeclaracion.

import { describe, expect, it } from 'vitest';
import { ErrorValidacion } from '../../../src/comun/errores.ts';
import {
  DatosDeclaracion,
  DatosPostulacion,
  type EntradaDeclaracion,
  type EntradaPostulacion,
} from '../../../src/postulacion/datos-postulacion.ts';

function crear(cambios: Partial<EntradaPostulacion> = {}): DatosPostulacion {
  return new DatosPostulacion({
    rutEmpresa: '76123456-0',
    rutAdministrador: '12345678-5',
    correoAdministrador: 'admin@empresa.cl',
    correoContactoSii: 'contacto@empresa.cl',
    correoIntercambio: 'intercambio@empresa.cl',
    nombreSoftware: 'Mi Software',
    ...cambios,
  });
}

describe('DatosPostulacion', () => {
  it('datos válidos', () => {
    const datos = crear();
    expect(String(datos.empresa)).toBe('76123456-0');
    expect(String(datos.administrador)).toBe('12345678-5');
    expect(datos.boletaExenta).toBe(true);
    expect(datos.url).toBe('');
  });

  it('RUT de empresa inválido', () => {
    expect(() => crear({ rutEmpresa: '76123456-1' })).toThrow(ErrorValidacion);
    expect(() => crear({ rutEmpresa: '76123456-1' })).toThrow(/RUT de la empresa/);
  });

  it.each([
    ['sin arroba', 'adminempresa.cl'],
    ['dos arrobas', 'a@b@empresa.cl'],
    ['con más (+)', 'admin+sii@empresa.cl'],
    ['con tilde', 'administración@empresa.cl'],
    ['con espacio', 'admin @empresa.cl'],
    ['sin punto en el dominio', 'admin@empresa'],
    ['punto pegado al arroba', 'admin@.cl'],
    ['empieza con punto', '.admin@empresa.cl'],
    ['termina con punto', 'admin@empresa.cl.'],
    ['empieza con arroba', '@empresa.cl'],
    ['más de 50 caracteres', `${'a'.repeat(45)}@empresa.cl`],
  ])('correo inválido: %s', (_nombre, correo) => {
    expect(() => crear({ correoAdministrador: correo })).toThrow(ErrorValidacion);
  });

  it('acepta un correo de exactamente 50 caracteres', () => {
    const correo = `${'a'.repeat(39)}@empresa.cl`;
    expect(correo).toHaveLength(50);
    expect(crear({ correoIntercambio: correo }).correoIntercambio).toBe(correo);
  });

  it('nombre de software obligatorio y acotado', () => {
    for (const nombre of ['', '   ', 'x'.repeat(31)]) {
      expect(() => crear({ nombreSoftware: nombre })).toThrow(ErrorValidacion);
    }
    expect(crear({ nombreSoftware: 'x'.repeat(30) }).nombreSoftware).toBe('x'.repeat(30));
  });

  it('el largo del nombre se cuenta en caracteres, no en bytes', () => {
    expect(crear({ nombreSoftware: 'ñ'.repeat(30) }).nombreSoftware).toBe('ñ'.repeat(30));
  });

  it('la URL debe empezar con www.', () => {
    expect(crear({ url: 'www.empresa.cl' }).url).toBe('www.empresa.cl');
    expect(() => crear({ url: 'https://empresa.cl' })).toThrow(ErrorValidacion);
  });

  it('boleta exenta se puede desactivar', () => {
    expect(crear({ boletaExenta: false }).boletaExenta).toBe(false);
  });
});

describe('DatosDeclaracion', () => {
  const base: EntradaDeclaracion = {
    rutEmpresa: '76123456-0',
    linkConsulta: 'https://www.empresa.cl/boletas',
    rutProveedor: '12345678-5',
    nombreProveedor: 'Proveedor SpA',
    correoProveedor: 'soporte@proveedor.cl',
  };

  it('datos válidos', () => {
    const datos = new DatosDeclaracion(base);
    expect(String(datos.empresa)).toBe('76123456-0');
    expect(String(datos.proveedor)).toBe('12345678-5');
  });

  it.each<[string, Partial<EntradaDeclaracion>]>([
    ['RUT del proveedor inválido', { rutProveedor: '12345678-0' }],
    ['link vacío', { linkConsulta: '  ' }],
    ['link de más de 100 caracteres', { linkConsulta: `https://${'a'.repeat(93)}` }],
    ['nombre del proveedor vacío', { nombreProveedor: '' }],
    ['nombre del proveedor de más de 30', { nombreProveedor: 'x'.repeat(31) }],
    ['correo del proveedor inválido', { correoProveedor: 'soporte+sii@proveedor.cl' }],
  ])('rechaza: %s', (_nombre, cambios) => {
    expect(() => new DatosDeclaracion({ ...base, ...cambios })).toThrow(ErrorValidacion);
  });
});
