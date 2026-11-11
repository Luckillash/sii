// Tests de SolicitudFolios (port de src/Folios/SolicitudFolios.php de
// winex/certificacion v1.9.1, que no tenía tests: pend. 6.1). Todo pasa por el
// TransporteFalso: ninguna petición sale a la red. Cubren los candados
// (soloAmbiente, soloSii, revisión del CAF), qué se considera "pudo haberse
// timbrado" (FoliosSinCafError) y lo que el PHP no tenía (códigos HTTP, FECHA en
// hora de Chile con reloj inyectable, conexión propia para timbrar).
//
// Las páginas son las sintéticas de paridad/folios/paginas/ (mismo estilo que el
// asistente del SII, sin datos reales).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  ErrorSolicitudFolios,
  ErrorTransporte,
  ErrorValidacion,
  FolioInicialRequeridoError,
  FoliosSinCafError,
  SesionCaducaError,
} from '../../../src/comun/errores.ts';
import { RespuestaHttp } from '../../../src/comun/http/respuesta.ts';
import {
  type PeticionRegistrada,
  TransporteFalso,
} from '../../../src/comun/http/transporte-falso.ts';
import { relojFijo } from '../../../src/comun/reloj.ts';
import { Certificado } from '../../../src/core/certificado.ts';
import { SesionSii } from '../../../src/folios/sesion-sii.ts';
import { formularioFolios, SolicitudFolios } from '../../../src/folios/solicitud-folios.ts';

const PARIDAD = join(dirname(fileURLToPath(import.meta.url)), '../../../../../paridad');
const pagina = (nombre: string): Buffer =>
  Buffer.from(readFileSync(join(PARIDAD, 'folios/paginas', `${nombre}.html`), 'utf8'), 'latin1');
const CAF = readFileSync(join(PARIDAD, 'material/caf-39.xml'));
const certificado = (): Certificado =>
  Certificado.desdeContenido(readFileSync(join(PARIDAD, 'material/cert-cadena.pem')), '');

type Respuesta = Buffer | string | RespuestaHttp | (() => never);

/** Transporte falso que responde en orden, sin importar la URL. */
function secuencia(respuestas: Respuesta[]): TransporteFalso {
  const pendientes = [...respuestas];
  return new TransporteFalso([
    [
      '*',
      () => {
        const r = pendientes.shift();
        if (r === undefined) return new RespuestaHttp(500, {}, 'sin respuesta configurada');
        return typeof r === 'function' ? r() : r;
      },
    ],
  ]);
}

const redireccion = (location: string, status = 302): RespuestaHttp =>
  new RespuestaHttp(status, { location });

function sesion(): SesionSii {
  return SesionSii.desdeArreglo([
    { name: 'TOKEN', value: 'TOKENDEPRUEBA', domain: 'sii.cl', host_only: false },
  ]);
}

function folios(transporte: TransporteFalso, instante = '2026-11-06T15:00:00Z'): SolicitudFolios {
  return new SolicitudFolios({ ambiente: 'certificacion', transporte, reloj: relojFijo(instante) });
}

const flujoCompleto = (caf: Buffer = CAF): Respuesta[] => [
  pagina('paso1-rut'),
  pagina('paso2-cantidad'),
  pagina('paso3-confirma'),
  pagina('paso4-genera'),
  caf,
];

const campos = (p: PeticionRegistrada | undefined): Map<string, string> => {
  const cuerpo = p?.cuerpo;
  if (cuerpo?.tipo !== 'formulario') throw new Error('sin formulario');
  return new Map([...(cuerpo.campos as Iterable<[string, string]>)]);
};

describe('SolicitudFolios: construcción', () => {
  it('exige un ambiente válido', () => {
    expect(() => new SolicitudFolios({ ambiente: 'pruebas' as never })).toThrow(TypeError);
  });
});

describe('SolicitudFolios.autenticar', () => {
  it('hace POST a CAutInicio.cgi con el certificado y la cadena, y lee las cookies del HTML', async () => {
    const transporte = secuencia([
      redireccion('/cgi_AUT2000/CAutValida.cgi?x'),
      new RespuestaHttp(200, {}, pagina('login-ok')),
    ]);
    const s = await folios(transporte).autenticar(certificado());

    expect(s.valor('TOKEN')).toBe('TOKENDEPRUEBAAUT2000');
    const [login, valida] = transporte.enviadas;
    expect(login?.metodo).toBe('POST');
    expect(login?.url).toBe(
      'https://herculesr.sii.cl/cgi_AUT2000/CAutInicio.cgi?https://maullin.sii.cl/cvc_cgi/dte/of_solicita_folios',
    );
    expect(login?.tls).toBe(true);
    expect(login?.msRespuesta).toBe(45_000);
    expect(login?.cabeceras.Origin).toBe('https://zeusr.sii.cl');
    // La redirección sigue con GET, conserva el certificado y el Origin, y actualiza Referer.
    expect(valida?.metodo).toBe('GET');
    expect(valida?.tls).toBe(true);
    expect(valida?.cabeceras.Origin).toBe('https://zeusr.sii.cl');
    expect(valida?.cabeceras.Referer).toBe(login?.url);
  });

  it('usa la URL de vuelta de producción con ambiente produccion', async () => {
    const transporte = secuencia([new RespuestaHttp(200, {}, pagina('login-ok'))]);
    await new SolicitudFolios({ ambiente: 'produccion', transporte }).autenticar(certificado());
    expect(transporte.urls()[0]).toContain('CAutInicio.cgi?https://palena.sii.cl/cvc_cgi/dte/');
  });

  it('lanza ErrorSolicitudFolios si el SII no entrega TOKEN', async () => {
    const transporte = secuencia([new RespuestaHttp(200, {}, pagina('login-rechazado'))]);
    await expect(folios(transporte).autenticar(certificado())).rejects.toThrow(
      ErrorSolicitudFolios,
    );
  });

  it('no sigue una redirección fuera de sii.cl (ni por http)', async () => {
    for (const destino of [
      'https://sii.cl.example.com/',
      'http://maullin.sii.cl/x',
      'https://u:p@zeusr.sii.cl/',
    ]) {
      const transporte = secuencia([redireccion(destino)]);
      await expect(folios(transporte).autenticar(certificado())).rejects.toThrow(
        /fuera de sii\.cl/,
      );
      expect(transporte.enviadas).toHaveLength(1);
    }
  });

  it('lanza ErrorTransporte si el login no responde 200 (pend. 1.9)', async () => {
    const transporte = secuencia([new RespuestaHttp(503, {}, 'mantención')]);
    await expect(folios(transporte).autenticar(certificado())).rejects.toThrow(ErrorTransporte);
  });
});

describe('SolicitudFolios.solicitar: flujo', () => {
  it('recorre el asistente y devuelve el CAF tal como llegó', async () => {
    const transporte = secuencia(flujoCompleto());
    const caf = await folios(transporte).solicitar(sesion(), '76.123.456-0', 39, 5);

    expect(caf.equals(CAF)).toBe(true);
    expect(transporte.enviadas.map((p) => `${p.metodo} ${new URL(p.url).pathname}`)).toEqual([
      'GET /cvc_cgi/dte/of_solicita_folios',
      'POST /cvc_cgi/dte/of_solicita_folios_dcto',
      'POST /cvc_cgi/dte/of_confirma_folio',
      'POST /cvc_cgi/dte/of_genera_folio',
      'POST /cvc_cgi/dte/of_genera_archivo',
    ]);
    // Solo el login lleva certificado; el asistente va con la sesión.
    expect(transporte.enviadas.every((p) => !p.tls)).toBe(true);
    expect(transporte.enviadas.every((p) => p.cabeceras.Cookie === 'TOKEN=TOKENDEPRUEBA')).toBe(
      true,
    );
    // Solo la orden de timbrar abre una conexión propia.
    expect(transporte.enviadas.map((p) => p.conexionNueva)).toEqual([
      false,
      false,
      false,
      true,
      false,
    ]);
    expect(transporte.enviadas.every((p) => p.msRespuesta === 70_000)).toBe(true);
  });

  it('reemplaza los campos del SII en su lugar y agrega los que faltan al final', async () => {
    const transporte = secuencia(flujoCompleto());
    await folios(transporte).solicitar(sesion(), '76123456-0', 39, 5);
    const paso2 = campos(transporte.enviadas[1]);
    expect([...paso2.keys()]).toEqual([
      'RUT_EMP',
      'DV_EMP',
      'ORIGEN',
      'ACEPTAR',
      'FOLIO_INICIAL',
      'COD_DOCTO',
      'CANT_DOCTOS',
    ]);
    expect(paso2.get('RUT_EMP')).toBe('76123456');
    expect(paso2.get('CANT_DOCTOS')).toBe('5');
    const genera = campos(transporte.enviadas[3]);
    expect(genera.get('ACEPTAR')).toBe('Obtener Folios');
    expect(genera.get('NOMUSU')).toBe('JOSÉ PÉREZ ÑÚÑEZ');
  });

  it('FECHA es la fecha de Chile, no la UTC (TED-1-646)', async () => {
    // 2026-11-07 01:30 UTC = 2026-11-06 22:30 en Santiago (UTC-3).
    const transporte = secuencia(flujoCompleto());
    await folios(transporte, '2026-11-07T01:30:00Z').solicitar(sesion(), '76123456-0', 39, 5);
    expect(campos(transporte.enviadas[4]).get('FECHA')).toBe('2026-11-06');
  });

  it('valida la cantidad, el tipo y el RUT antes de enviar nada', async () => {
    const transporte = secuencia([]);
    const f = folios(transporte);
    await expect(f.solicitar(sesion(), '76123456-0', 39, 0)).rejects.toThrow(ErrorSolicitudFolios);
    await expect(f.solicitar(sesion(), '76123456-0', 39, 1.5)).rejects.toThrow(
      ErrorSolicitudFolios,
    );
    await expect(f.solicitar(sesion(), '76123456-0', 0, 5)).rejects.toThrow(ErrorSolicitudFolios);
    await expect(f.solicitar(sesion(), '76123456-1', 39, 5)).rejects.toThrow(ErrorValidacion);
    expect(transporte.enviadas).toHaveLength(0);
  });
});

describe('SolicitudFolios.solicitar: primer timbraje (folio inicial)', () => {
  // Como la página real de palena (2026-11-10) sin datos de la empresa: el SII pide
  // el folio inicial antes de la confirmación y propone 1.
  const PAGINA_FOLIO_INICIAL = Buffer.from(
    `<HTML><HEAD><TITLE>Solicitud de Timbraje Electr&oacute;nico de Documentos</TITLE></HEAD>
<BODY>
<FORM NAME="form1" METHOD="POST" ACTION="/cvc_cgi/dte/of_confirma_folio" onSubmit="return validaconfirma()">
<TABLE><TR><TD>Cantidad Solicitada</TD><TD>5</TD></TR>
<TR><TD>Disponible</TD><TD>0</TD></TR>
<TR><TD>M&aacute;ximo Autorizado</TD><TD>0</TD></TR>
<TR><TD>Ingrese Folio Inicial</TD><TD><input name="FOLIO_INICIAL" type="text" value=1 size=8 maxlength=8></TD></TR>
</TABLE>
<INPUT NAME="CON_CREDITO" TYPE=HIDDEN value="0">
<INPUT NAME="CON_AJUSTE" TYPE=HIDDEN value="0">
No registra timbraje anterior.
<input name="RUT_EMP" type="hidden" value="76123456">
<input name="DV_EMP" type="hidden" value="0">
<input name="COD_DOCTO" type="hidden" value="39">
<input name="CANT_DOCTOS" type="hidden" value="5">
<input name="ACEPTAR" type="submit" value="Confirmar Folio Inicial">
</FORM></BODY></HTML>`,
    'latin1',
  );
  const flujoPrimerTimbraje = (): Respuesta[] => [
    pagina('paso1-rut'),
    pagina('paso2-cantidad'),
    PAGINA_FOLIO_INICIAL,
    pagina('paso3-confirma'),
    pagina('paso4-genera'),
    CAF,
  ];

  it('sin folioInicial se detiene sin enviar esa página ni timbrar', async () => {
    const transporte = secuencia(flujoPrimerTimbraje());
    const error = await folios(transporte)
      .solicitar(sesion(), '76123456-0', 39, 5)
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(FolioInicialRequeridoError);
    expect(error).toBeInstanceOf(ErrorSolicitudFolios);
    expect(error).not.toBeInstanceOf(FoliosSinCafError);
    expect((error as FolioInicialRequeridoError).folioSugerido).toBe('1');
    expect((error as Error).message).toContain('el SII sugiere 1');
    expect(transporte.enviadas.map((p) => `${p.metodo} ${new URL(p.url).pathname}`)).toEqual([
      'GET /cvc_cgi/dte/of_solicita_folios',
      'POST /cvc_cgi/dte/of_solicita_folios_dcto',
      'POST /cvc_cgi/dte/of_confirma_folio',
    ]);
  });

  it('con folioInicial lo envía solo en esa página, con el botón de la página', async () => {
    const transporte = secuencia(flujoPrimerTimbraje());
    const caf = await folios(transporte).solicitar(sesion(), '76123456-0', 39, 5, {
      folioInicial: 1,
    });

    expect(caf.equals(CAF)).toBe(true);
    expect(transporte.enviadas.map((p) => `${p.metodo} ${new URL(p.url).pathname}`)).toEqual([
      'GET /cvc_cgi/dte/of_solicita_folios',
      'POST /cvc_cgi/dte/of_solicita_folios_dcto',
      'POST /cvc_cgi/dte/of_confirma_folio',
      'POST /cvc_cgi/dte/of_confirma_folio',
      'POST /cvc_cgi/dte/of_genera_folio',
      'POST /cvc_cgi/dte/of_genera_archivo',
    ]);
    // Los pasos normales siguen como el PHP.
    expect(campos(transporte.enviadas[1]).get('FOLIO_INICIAL')).toBe('0');
    expect(campos(transporte.enviadas[2]).get('FOLIO_INICIAL')).toBe('0');
    expect(campos(transporte.enviadas[2]).get('ACEPTAR')).toBe('Continuar');
    // La página del folio inicial: el valor pedido y su propio botón.
    const pagina = campos(transporte.enviadas[3]);
    expect(pagina.get('FOLIO_INICIAL')).toBe('1');
    expect(pagina.get('ACEPTAR')).toBe('Confirmar Folio Inicial');
    expect(pagina.get('CANT_DOCTOS')).toBe('5');
    expect(pagina.get('CON_CREDITO')).toBe('0');
  });

  it('si el SII no pide el folio inicial, folioInicial no cambia nada (paridad)', async () => {
    const sin = secuencia(flujoCompleto());
    const con = secuencia(flujoCompleto());
    await folios(sin).solicitar(sesion(), '76123456-0', 39, 5);
    await folios(con).solicitar(sesion(), '76123456-0', 39, 5, { folioInicial: 7 });
    const resumen = (t: TransporteFalso) =>
      t.enviadas.map((p) => [
        p.metodo,
        p.url,
        p.cuerpo?.tipo === 'formulario' ? [...campos(p)] : null,
      ]);
    expect(resumen(con)).toEqual(resumen(sin));
  });

  it('valida folioInicial antes de enviar nada', async () => {
    const transporte = secuencia([]);
    const f = folios(transporte);
    for (const folioInicial of [0, -1, 1.5, Number.NaN]) {
      await expect(f.solicitar(sesion(), '76123456-0', 39, 5, { folioInicial })).rejects.toThrow(
        ErrorSolicitudFolios,
      );
    }
    expect(transporte.enviadas).toHaveLength(0);
  });
});

describe('SolicitudFolios.solicitar: antes de timbrar (se puede reintentar)', () => {
  it('SesionCaducaError si el paso 1 redirige al login, sin seguir la redirección', async () => {
    const transporte = secuencia([
      redireccion('https://zeusr.sii.cl/AUT2000/InicioAutenticacion/IngresoCertificado.html'),
    ]);
    await expect(folios(transporte).solicitar(sesion(), '76123456-0', 39, 5)).rejects.toThrow(
      SesionCaducaError,
    );
    expect(transporte.enviadas).toHaveLength(1);
  });

  it('SesionCaducaError si una página trae el login', async () => {
    const transporte = secuencia([pagina('login-caducado')]);
    await expect(folios(transporte).solicitar(sesion(), '76123456-0', 39, 5)).rejects.toThrow(
      SesionCaducaError,
    );
  });

  it('ErrorSolicitudFolios (no FoliosSinCaf) si el SII rechaza en el paso 2', async () => {
    const transporte = secuencia([pagina('paso1-rut'), pagina('error-no-autorizado')]);
    const error = await folios(transporte)
      .solicitar(sesion(), '76123456-0', 39, 5)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorSolicitudFolios);
    expect(error).not.toBeInstanceOf(FoliosSinCafError);
    expect((error as Error).message).toContain('no está autorizado');
  });

  it.each([
    ['otro ambiente', 'https://palena.sii.cl/cvc_cgi/dte/of_genera_folio'],
    ['http', 'http://maullin.sii.cl/cvc_cgi/dte/of_genera_folio'],
    ['otro puerto', 'https://maullin.sii.cl:8443/cvc_cgi/dte/of_genera_folio'],
    ['con usuario', 'https://x@maullin.sii.cl/cvc_cgi/dte/of_genera_folio'],
    ['host parecido', 'https://maullin.sii.cl.example.com/cvc_cgi/dte/of_genera_folio'],
  ])('no envía la orden de timbrar si la confirmación apunta a %s', async (_, action) => {
    const confirma = pagina('paso3-confirma')
      .toString('latin1')
      .replace('ACTION="of_genera_folio"', `ACTION="${action}"`);
    const transporte = secuencia([
      pagina('paso1-rut'),
      pagina('paso2-cantidad'),
      Buffer.from(confirma, 'latin1'),
    ]);
    const error = await folios(transporte)
      .solicitar(sesion(), '76123456-0', 39, 5)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorSolicitudFolios);
    expect(error).not.toBeInstanceOf(FoliosSinCafError);
    expect(transporte.enviadas).toHaveLength(3);
  });

  it('no sigue una redirección del asistente hacia otro host', async () => {
    const transporte = secuencia([
      redireccion('https://palena.sii.cl/cvc_cgi/dte/of_solicita_folios'),
    ]);
    await expect(folios(transporte).solicitar(sesion(), '76123456-0', 39, 5)).rejects.toThrow(
      /fuera del ambiente de certificacion/,
    );
    expect(transporte.enviadas).toHaveLength(1);
  });

  it('se detiene después de 10 redirecciones', async () => {
    const transporte = secuencia(Array.from({ length: 20 }, (_, i) => redireccion(`of_x?${i}`)));
    await expect(folios(transporte).solicitar(sesion(), '76123456-0', 39, 5)).rejects.toThrow(
      /demasiadas veces/,
    );
    expect(transporte.enviadas).toHaveLength(11);
  });

  it('ErrorTransporte si un paso previo responde un código inesperado (pend. 1.9)', async () => {
    const transporte = secuencia([new RespuestaHttp(500, {}, pagina('paso1-rut'))]);
    await expect(folios(transporte).solicitar(sesion(), '76123456-0', 39, 5)).rejects.toThrow(
      ErrorTransporte,
    );
  });

  it('falla si la confirmación no trae FOLIO_INI, FOLIO_FIN o NOMUSU', async () => {
    for (const campo of ['FOLIO_INI', 'FOLIO_FIN', 'NOMUSU']) {
      const confirma = pagina('paso3-confirma')
        .toString('latin1')
        .replace(new RegExp(`<INPUT TYPE="hidden" NAME="${campo}"[^>]*>`), '');
      const transporte = secuencia([
        pagina('paso1-rut'),
        pagina('paso2-cantidad'),
        Buffer.from(confirma, 'latin1'),
      ]);
      await expect(folios(transporte).solicitar(sesion(), '76123456-0', 39, 5)).rejects.toThrow(
        new RegExp(`no trae ${campo}`),
      );
    }
  });

  it('falla si el asistente no llega a la confirmación en 4 vueltas', async () => {
    const transporte = secuencia([pagina('paso1-rut'), ...Array(4).fill(pagina('paso2-tipo'))]);
    await expect(folios(transporte).solicitar(sesion(), '76123456-0', 39, 5)).rejects.toThrow(
      /no llegó a la confirmación/,
    );
    expect(transporte.enviadas).toHaveLength(5);
  });
});

describe('SolicitudFolios.solicitar: desde la orden de timbrar (NO reintentar)', () => {
  const inicio = (): Respuesta[] => [
    pagina('paso1-rut'),
    pagina('paso2-cantidad'),
    pagina('paso3-confirma'),
  ];

  async function sinCaf(respuestas: Respuesta[]): Promise<FoliosSinCafError> {
    const error = await folios(secuencia(respuestas))
      .solicitar(sesion(), '76123456-0', 39, 5)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FoliosSinCafError);
    return error as FoliosSinCafError;
  }

  it('falla de red en el POST que timbra', async () => {
    const error = await sinCaf([
      ...inicio(),
      () => {
        throw new ErrorTransporte('se cortó', 'https://maullin.sii.cl/cvc_cgi/dte/of_genera_folio');
      },
    ]);
    expect(error.folioDesde).toBe(101);
    expect(error.folioHasta).toBe(105);
    expect(error.ambiente).toBe('certificacion');
    expect(error.message).toContain('maullin.sii.cl');
    expect(error.cause).toBeInstanceOf(ErrorTransporte);
  });

  it('HTTP 500 en el POST que timbra', async () => {
    await sinCaf([...inicio(), new RespuestaHttp(500, {}, 'error')]);
  });

  it('la sesión caduca justo después de timbrar', async () => {
    const error = await sinCaf([...inicio(), pagina('login-caducado')]);
    expect(error.message).toContain('Folios ya autorizados');
  });

  it('la descarga no trae un CAF', async () => {
    await sinCaf([...inicio(), pagina('paso4-genera'), '<HTML>No se pudo</HTML>']);
  });

  it.each([
    ['IDK de producción', (x: string) => x.replace('<IDK>100</IDK>', '<IDK>300</IDK>')],
    ['otra empresa', (x: string) => x.replace('<RE>76123456-0</RE>', '<RE>11111111-1</RE>')],
    ['otro tipo', (x: string) => x.replace('<TD>39</TD>', '<TD>41</TD>')],
    ['XML roto', (x: string) => x.replace('</AUTORIZACION>', '')],
  ])('el CAF no cuadra (%s): FoliosSinCafError (pend. 1.2)', async (_, cambiar) => {
    const caf = Buffer.from(cambiar(CAF.toString('latin1')), 'latin1');
    const error = await sinCaf([...inicio(), pagina('paso4-genera'), caf]);
    expect(error.message).toContain('No se usó');
  });

  it('acepta un CAF en ISO-8859-1 con tildes y con BOM UTF-8', async () => {
    const iso = Buffer.from(
      CAF.toString('latin1').replace('EMPRESA DE PRUEBA SPA', 'EMPRESA ÑANDÚ SPA'),
      'latin1',
    );
    const conBom = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), CAF]);
    for (const caf of [iso, conBom]) {
      const resultado = await folios(secuencia(flujoCompleto(caf))).solicitar(
        sesion(),
        '76123456-0',
        39,
        5,
      );
      expect(resultado.equals(caf)).toBe(true);
    }
  });
});

describe('formularioFolios', () => {
  it('devuelve null sin formulario', () => {
    expect(formularioFolios('<p>nada</p>')).toBeNull();
  });

  it('incluye submit, checkbox sin marcar y disabled; excluye button y reset', () => {
    const form = formularioFolios(
      '<form action="x"><input name="s" type="submit" value="S"><input name="c" type="checkbox">' +
        '<input name="d" disabled value="1"><input name="b" type="button"><input name="r" type="RESET"></form>',
    );
    expect([...(form?.inputs ?? [])]).toEqual([
      ['s', 'S'],
      ['c', ''],
      ['d', '1'],
    ]);
  });
});
