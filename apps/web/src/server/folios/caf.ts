import 'server-only';
import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto';
import {
  type Ambiente,
  datosAmbiente,
  decodificarUtf8OIso,
  ErrorTimbre,
  parsearDocumento,
  Rut,
  Timbre,
} from '@winex/certificacion';
import { ETIQUETA_AMBIENTE, esTipoFolio, nombreTipoFolio } from '@/lib/folios';
import { formatearRut } from '@/lib/formatos';
import { ErrorFolios } from './errores';

// Lectura y validación de un CAF (PLAN-SAAS Fase 6, puntos 2 y 4).
//
//   - `leerDatosCaf`: el `<DA>` del CAF (RUT, tipo, rango, fecha, IDK), nunca la llave.
//     Lo usan la solicitud de folios (Fase 5 y 6) y la carga manual.
//   - `validarCaf`: la carga manual de un CAF existente. Con la librería (principio 4):
//     `new Timbre(caf)` es el validador del core (XML, `<CAF>`, `<RSASK>` RSA legible,
//     lo mismo que exige para timbrar); el IDK del ambiente sale de `datosAmbiente()`
//     (el mismo candado de `SolicitudFolios`). La coincidencia de `<RSASK>` con `<RSAPK>`
//     replica la de `sii util verificar-ted` de la CLI (no está exportada en el core):
//     si no son del mismo par, el SII rechazaría cada timbre.
//
// Ningún error lleva el contenido del archivo ni la llave: solo el dato que falla y,
// cuando sirve, el RUT, el tipo o el rango (públicos en el `<DA>`). Los errores de la
// librería se descartan sin propagar su `cause`.

/** Lo que se lee del `<DA>` de un CAF. Nunca la llave. */
export interface DatosCaf {
  rutEmisor: string;
  razonSocial: string;
  tipoDte: number;
  desde: number;
  hasta: number;
  fechaAutorizacion: string;
  idk: number;
}

/** Lee el `<DA>` de un CAF (UTF-8 o ISO-8859-1). Lanza `Error` sin el contenido. */
export function leerDatosCaf(caf: Uint8Array | string): DatosCaf {
  const texto = typeof caf === 'string' ? caf : decodificarUtf8OIso(caf);
  const doc = parsearDocumento(texto);
  const da = doc.getElementsByTagName('DA').item(0);
  const rng = da?.getElementsByTagName('RNG').item(0) ?? null;
  if (!da || !rng) throw new Error('El CAF no trae <DA> con <RNG>.');
  const campo = (padre: Element, nombre: string) =>
    (padre.getElementsByTagName(nombre).item(0)?.textContent ?? '').trim();
  const entero = (padre: Element, nombre: string) => {
    const valor = campo(padre, nombre);
    if (!/^[0-9]+$/.test(valor)) throw new Error(`El CAF no trae <${nombre}> entero.`);
    return Number(valor);
  };
  const fecha = campo(da, 'FA');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('El CAF no trae <FA> válida.');
  return {
    rutEmisor: campo(da, 'RE'),
    razonSocial: campo(da, 'RS'),
    tipoDte: entero(da, 'TD'),
    desde: entero(rng, 'D'),
    hasta: entero(rng, 'H'),
    fechaAutorizacion: fecha,
    idk: entero(da, 'IDK'),
  };
}

/** Lee el `<DA>` sin lanzar (para registrar el rango de un CAF que no se pudo guardar). */
export function rangoDelCaf(caf: Uint8Array): { folio_desde: number; folio_hasta: number } | null {
  try {
    const d = leerDatosCaf(caf);
    return { folio_desde: d.desde, folio_hasta: d.hasta };
  } catch {
    return null;
  }
}

function noEsCaf(detalle: string): ErrorFolios {
  return new ErrorFolios(
    'no_es_caf',
    {
      titulo: 'El archivo no es un CAF del SII',
      detalle: `${detalle} Baja el CAF desde «Folios ya autorizados» en el portal del SII y vuelve a subirlo sin modificarlo.`,
    },
    { campo: 'caf' },
  );
}

function mismoRut(a: string, b: string): boolean {
  return Rut.esValido(a) && Rut.esValido(b) && Rut.de(a).equals(Rut.de(b));
}

/** Llave pública del par de `<RSASK>`, reconstruyendo el PEM como `Timbre` y la CLI. */
function publicaDeRsask(rsask: string): KeyObject {
  const cuerpo = rsask
    .replaceAll('-----BEGIN RSA PRIVATE KEY-----', '')
    .replaceAll('-----END RSA PRIVATE KEY-----', '')
    .replace(/[\r\n \t]/g, '');
  const lineas = cuerpo.match(/[\s\S]{1,64}/g) ?? [];
  const pem = `-----BEGIN RSA PRIVATE KEY-----\n${lineas.join('\n')}\n-----END RSA PRIVATE KEY-----`;
  return createPublicKey(createPrivateKey(pem));
}

/** `true` si `<RSASK>` y `<RSAPK>` son del mismo par; `false` si no o si falta `<RSAPK>`. */
function llavesCoinciden(doc: Document, rsask: string): boolean {
  const nodo = doc.getElementsByTagName('RSAPK').item(0);
  const m = nodo?.getElementsByTagName('M').item(0)?.textContent;
  const e = nodo?.getElementsByTagName('E').item(0)?.textContent;
  if (!m || !e) return false;
  try {
    const b64url = (v: string) => Buffer.from(v.replace(/\s/g, ''), 'base64').toString('base64url');
    const rsapk = createPublicKey({
      key: { kty: 'RSA', n: b64url(m), e: b64url(e) },
      format: 'jwk',
    });
    const der = (k: KeyObject) => k.export({ type: 'spki', format: 'der' });
    return der(publicaDeRsask(rsask)).equals(der(rsapk));
  } catch {
    return false;
  }
}

export interface EsperadoCaf {
  /** Ambiente que eligió quien sube el CAF. */
  ambiente: Ambiente;
  /** RUT de la empresa (`76123456-0`). */
  rutEmpresa: string;
}

/**
 * Valida un CAF que sube un administrador: que sea un CAF del SII, de boleta (39/41), del
 * ambiente elegido (IDK 100/300), de la empresa (RUT emisor) y con su llave (`<RSASK>`,
 * legible y del mismo par que `<RSAPK>`). Devuelve el `<DA>` y el texto Unicode que va a
 * Vault (vía `registrar_caf`).
 *
 * @throws ErrorFolios con el motivo (sin el contenido del archivo)
 */
export function validarCaf(
  contenido: Uint8Array,
  esperado: EsperadoCaf,
): { datos: DatosCaf; xml: string } {
  const xml = decodificarUtf8OIso(contenido);
  if (!/<AUTORIZACION[\s>]/.test(xml) || !/<CAF[\s>]/.test(xml)) {
    throw noEsCaf(
      'No trae los nodos <AUTORIZACION> y <CAF> de un archivo de autorización de folios.',
    );
  }
  let doc: Document;
  let datos: DatosCaf;
  try {
    doc = parsearDocumento(xml);
    datos = leerDatosCaf(xml);
  } catch {
    throw noEsCaf(
      'No es un XML válido o le faltan los datos de autorización (<DA>, <RNG>, <FA>, <IDK>).',
    );
  }
  if (datos.desde < 1 || datos.hasta < datos.desde) {
    throw noEsCaf('El rango de folios que trae no es válido.');
  }

  if (!esTipoFolio(datos.tipoDte)) {
    throw new ErrorFolios(
      'tipo_no_permitido',
      {
        titulo: 'Ese CAF no es de boletas',
        detalle: `El CAF es de ${nombreTipoFolio(datos.tipoDte)}. Por ahora Boletéame emite boleta electrónica (39) y boleta exenta electrónica (41): sube un CAF de uno de esos tipos.`,
      },
      { campo: 'caf' },
    );
  }

  const idkEsperado = Number(datosAmbiente(esperado.ambiente).idk);
  if (datos.idk !== idkEsperado) {
    const otro = esperado.ambiente === 'produccion' ? 'certificacion' : 'produccion';
    const delOtro = Number(datosAmbiente(otro).idk) === datos.idk;
    throw new ErrorFolios(
      'idk',
      {
        titulo: 'El CAF es de otro ambiente',
        detalle: delOtro
          ? `El CAF es de ${ETIQUETA_AMBIENTE[otro].toLowerCase()} (IDK ${datos.idk}) y elegiste ${ETIQUETA_AMBIENTE[esperado.ambiente].toLowerCase()} (IDK ${idkEsperado}). Elige el ambiente correcto y vuelve a subirlo.`
          : `El CAF trae el IDK ${datos.idk}, que no es de ningún ambiente del SII (certificación usa 100 y producción 300). Baja el CAF otra vez desde el portal del SII.`,
      },
      { campo: 'ambiente' },
    );
  }

  if (!mismoRut(datos.rutEmisor, esperado.rutEmpresa)) {
    throw new ErrorFolios(
      'rut',
      {
        titulo: 'El CAF es de otra empresa',
        detalle: `El CAF es del RUT ${formatearRut(datos.rutEmisor) || 'sin RUT'} y la empresa es ${formatearRut(esperado.rutEmpresa)}. Elige la empresa correcta o baja el CAF de esta empresa desde el portal del SII.`,
      },
      { campo: 'caf' },
    );
  }

  const rsask = doc.getElementsByTagName('RSASK').item(0)?.textContent?.trim() ?? '';
  if (rsask === '') {
    throw new ErrorFolios(
      'sin_rsask',
      {
        titulo: 'Al CAF le falta la llave para timbrar',
        detalle:
          'El archivo no trae la llave privada (<RSASK>) con que se timbran las boletas. Baja el CAF completo desde «Folios ya autorizados» en el portal del SII, sin abrirlo ni editarlo, y vuelve a subirlo.',
      },
      { campo: 'caf' },
    );
  }
  try {
    // Validador del core: el mismo que se usa para timbrar (XML, <CAF>, <RSASK> RSA).
    new Timbre(xml);
  } catch (error) {
    if (!(error instanceof ErrorTimbre)) throw noEsCaf('No pudimos leerlo.');
    throw new ErrorFolios(
      'llave_invalida',
      {
        titulo: 'No pudimos leer la llave del CAF',
        detalle:
          'La llave privada (<RSASK>) del archivo está dañada o incompleta. Baja el CAF otra vez desde «Folios ya autorizados» en el portal del SII y súbelo sin editarlo.',
      },
      { campo: 'caf' },
    );
  }
  if (!llavesCoinciden(doc, rsask)) {
    throw new ErrorFolios(
      'llaves_distintas',
      {
        titulo: 'La llave del CAF no calza con la del SII',
        detalle:
          'La llave privada (<RSASK>) no es del mismo par que la llave pública (<RSAPK>) que publica el SII: el SII rechazaría cada boleta timbrada con este archivo. Baja el CAF otra vez desde el portal del SII.',
      },
      { campo: 'caf' },
    );
  }
  return { datos, xml };
}
