import 'server-only';
import { nombresArchivos } from '../emision/representacion';
import { ambitoDe } from './documentos';
import type { ContextoApi } from './manejar';
import { CABECERAS_BASE, ErrorApi } from './respuestas';

// `GET /documentos/{id}/xml` y `/pdf` (PLAN-SAAS Fase 11, decisión 11 del diseño): la ruta
// pide la URL firmada de Storage (60 s, `enlaceDocumento` de la Fase 7, que regenera el PDF
// si falta) y reenvía los bytes. La URL firmada nunca sale al cliente y no hace falta que
// siga redirecciones. El documento se busca antes en el ámbito de la clave (organización,
// ambiente y empresa): uno ajeno es 404.

export type FormatoArchivo = 'xml' | 'pdf_carta' | 'pdf_rollo';

const TIPO_CONTENIDO: Record<FormatoArchivo, string> = {
  xml: 'application/xml; charset=ISO-8859-1',
  pdf_carta: 'application/pdf',
  pdf_rollo: 'application/pdf',
};

export function formatoPdf(valor: string | null): FormatoArchivo {
  if (valor === null || valor === '' || valor === 'carta') return 'pdf_carta';
  if (valor === 'rollo') return 'pdf_rollo';
  throw new ErrorApi('parametro_invalido', { campos: { formato: 'Usa carta o rollo.' } });
}

export async function manejarArchivo(
  ctx: ContextoApi,
  id: string,
  formato: FormatoArchivo,
): Promise<Response> {
  const { clave, deps } = ctx;
  const doc = await deps.repo.documento(ambitoDe(clave), id);
  if (!doc) throw new ErrorApi('no_encontrado');
  if (doc.folio === null) {
    throw new ErrorApi('no_encontrado', {
      mensaje: 'La boleta todavía no tiene folio, así que no tiene XML ni PDF.',
    });
  }
  if (formato !== 'xml' && doc.estado === 'anulado') {
    throw new ErrorApi('no_encontrado', {
      mensaje:
        'La boleta quedó anulada (el SII no la recibió), así que no tiene representación impresa. Su XML sigue disponible.',
    });
  }
  const enlace = await deps.enlace(
    { organizacionId: clave.organizacionId, empresaId: doc.empresa_id },
    doc.id,
    formato,
  );
  if (!enlace.ok) throw new Error(`api-publica: sin enlace del ${formato}`);
  const archivo = await deps.descargar(enlace.url);
  if (!archivo.ok || !archivo.body) {
    throw new Error(`api-publica: Storage respondió ${archivo.status} al descargar el ${formato}`);
  }
  const nombres = nombresArchivos(doc.tipo_dte, doc.folio);
  const nombre =
    formato === 'xml' ? nombres.dte : formato === 'pdf_rollo' ? nombres.rollo : nombres.carta;
  return new Response(archivo.body, {
    status: 200,
    headers: {
      ...CABECERAS_BASE,
      'Content-Type': TIPO_CONTENIDO[formato],
      'Content-Disposition': `attachment; filename="${nombre}"`,
      // `fetch` descomprime un cuerpo con `content-encoding` pero conserva el largo
      // comprimido: reenviarlo cortaría el archivo. Solo se reenvía sin codificación.
      ...(archivo.headers.get('content-length') && !archivo.headers.get('content-encoding')
        ? { 'Content-Length': String(archivo.headers.get('content-length')) }
        : {}),
    },
  });
}
