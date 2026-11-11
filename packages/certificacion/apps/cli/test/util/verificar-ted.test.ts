// `sii util verificar-ted`: el sobre se arma en el test con ArmadorBoleta y
// EnvioBoleta, con el CAF del proyecto. Sin red.

import { join } from 'node:path';
import {
  ArmadorBoleta,
  Certificado,
  EnvioBoleta,
  FirmaElectronica,
  relojFijo,
} from '@winex/certificacion';
import { describe, expect, it } from 'vitest';
import { cafPrueba } from '../../../../packages/core/test/soporte/caf.ts';
import { CODIGOS } from '../../src/errores.ts';
import {
  CLAVE_PFX,
  correr,
  INSTANTE,
  type Proyecto,
  proyecto,
  RUT_EMPRESA,
} from '../soporte/cli.ts';

/** Sobre con las boletas de los folios indicados, timbradas con el CAF del proyecto. */
async function sobre(
  p: Proyecto,
  folios: number[],
  razonSocial = 'Cliente General',
): Promise<Buffer> {
  const cert = await Certificado.desdeArchivo(join(p.dir, 'data/certs/prueba.pfx'), CLAVE_PFX);
  const firmador = new FirmaElectronica(cert.llavePrivada, cert.certificado);
  const reloj = relojFijo(INSTANTE);
  const armador = new ArmadorBoleta(firmador, { reloj });
  const dtes = folios.map((folio) =>
    armador.armar(
      {
        emisor: {
          rut: RUT_EMPRESA,
          razonSocial: 'EMPRESA DE PRUEBA SPA',
          giro: 'VENTA',
          direccion: 'CALLE 1',
          comuna: 'SANTIAGO',
        },
        receptor: { rut: '66666666-6', razonSocial },
        folio,
        detalles: [{ nombre: 'Café con ñandú', cantidad: 1, precio: 1190 }],
      },
      p.caf,
    ),
  );
  return new EnvioBoleta(
    firmador,
    { rutEmisor: RUT_EMPRESA, rutEnvia: '11111111-1', nroResol: 0, fchResol: '2026-09-05' },
    { reloj },
  ).empaquetar(dtes);
}

describe('sii util verificar-ted', () => {
  it('un sobre válido: OK por cada TED (con tildes en ISO-8859-1)', async () => {
    const p = proyecto();
    p.escribir('sobre.xml', await sobre(p, [1, 2], 'Peñalolén Ltda.'));
    const r = await correr(p, ['util', 'verificar-ted', 'sobre.xml']);
    expect(r.stderr).toBe('');
    expect(r.codigo).toBe(CODIGOS.OK);
    expect(r.stdout).toContain('OK     TED de TipoDTE: 39 | Folio: 1');
    expect(r.stdout).toContain('OK     TED de TipoDTE: 39 | Folio: 2');
    expect(r.stdout).toContain('2 TED revisado(s): 2 OK, 0 con falla.');
    expect(r.transporte.enviadas).toHaveLength(0);
    expect(r.stdout).not.toContain('PRIVATE KEY');
  });

  it('un TED adulterado falla con código 7', async () => {
    const p = proyecto();
    const original = (await sobre(p, [1, 2])).toString('latin1');
    // Cambia el monto del TED del folio 2 (solo dentro del <DD>).
    const inicio = original.indexOf('<TED', original.indexOf('<Folio>2</Folio>'));
    const adulterado =
      original.slice(0, inicio) +
      original.slice(inicio).replace('<MNT>1190</MNT>', '<MNT>1191</MNT>');
    expect(adulterado).not.toBe(original);
    p.escribir('sobre.xml', Buffer.from(adulterado, 'latin1'));
    const r = await correr(p, ['util', 'verificar-ted', 'sobre.xml']);
    expect(r.codigo).toBe(CODIGOS.VERIFICACION);
    expect(r.stdout).toContain('OK     TED de TipoDTE: 39 | Folio: 1');
    expect(r.stdout).toContain('FALLA  TED de TipoDTE: 39 | Folio: 2');
  });

  it('un sobre reconvertido a UTF-8 falla si el <DD> trae tildes', async () => {
    const p = proyecto();
    const latin1 = await sobre(p, [1], 'Peñalolén Ltda.');
    p.escribir('sobre.xml', Buffer.from(latin1.toString('latin1'), 'utf8'));
    const r = await correr(p, ['util', 'verificar-ted', 'sobre.xml']);
    expect(r.codigo).toBe(CODIGOS.VERIFICACION);
    expect(r.stdout).toContain('FALLA');
  });

  it('con el CAF de otra llave (--caf) falla', async () => {
    const p = proyecto();
    p.escribir('sobre.xml', await sobre(p, [1]));
    p.escribir('otro-caf.xml', cafPrueba({ rut: RUT_EMPRESA, bits: 768 }).xml);
    const r = await correr(p, ['util', 'verificar-ted', 'sobre.xml', '--caf', 'otro-caf.xml']);
    expect(r.codigo).toBe(CODIGOS.VERIFICACION);
    expect(r.stdout).toContain('FALLA  TED de TipoDTE: 39 | Folio: 1');
  });

  it('avisa y falla si <RSASK> y <RSAPK> no coinciden', async () => {
    const p = proyecto();
    p.escribir('sobre.xml', await sobre(p, [1]));
    const otraRsapk = /<RSAPK>[\s\S]*?<\/RSAPK>/.exec(cafPrueba({ bits: 768 }).xml)?.[0] ?? '';
    p.escribir('caf-raro.xml', p.caf.replace(/<RSAPK>[\s\S]*?<\/RSAPK>/, otraRsapk));
    const r = await correr(p, ['util', 'verificar-ted', 'sobre.xml', '--caf', 'caf-raro.xml']);
    expect(r.codigo).toBe(CODIGOS.VERIFICACION);
    expect(r.stderr).toContain('no coincide con la <RSAPK>');
    expect(r.stdout).toContain('OK     TED de TipoDTE: 39 | Folio: 1');
  });

  it('un sobre sin TED es código 7', async () => {
    const p = proyecto();
    p.escribir('vacio.xml', '<EnvioBOLETA></EnvioBOLETA>');
    const r = await correr(p, ['util', 'verificar-ted', 'vacio.xml']);
    expect(r.codigo).toBe(CODIGOS.VERIFICACION);
    expect(r.stdout).toContain('No se encontró ningún TED');
  });

  it('un TED con otra estructura cuenta como falla', async () => {
    const p = proyecto();
    p.escribir('raro.xml', '<X><TED version="1.0"><DD><TD>39</TD><F>1</F></DD></TED></X>');
    const r = await correr(p, ['util', 'verificar-ted', 'raro.xml']);
    expect(r.codigo).toBe(CODIGOS.VERIFICACION);
    expect(r.stdout).toContain(
      'FALLA  TED de TipoDTE: N/A | Folio: N/A (estructura de TED inesperada)',
    );
  });

  it('sobre o CAF inexistentes: error de configuración', async () => {
    const p = proyecto();
    expect((await correr(p, ['util', 'verificar-ted', 'no-existe.xml'])).codigo).toBe(
      CODIGOS.CONFIG,
    );
    p.escribir('sobre.xml', await sobre(p, [1]));
    p.escribirEnv({ SII_CAF_39: '' });
    const r = await correr(p, ['util', 'verificar-ted', 'sobre.xml']);
    expect(r.codigo).toBe(CODIGOS.CONFIG);
    expect(r.stderr).toContain('SII_CAF_39 (o --caf): falta');
    expect((await correr(p, ['util', 'verificar-ted'])).codigo).toBe(CODIGOS.USO);
  });
});
