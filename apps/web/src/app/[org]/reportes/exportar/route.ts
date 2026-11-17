import { type NextRequest, NextResponse } from 'next/server';
import { formatearMiles } from '@/lib/formatos';
import { urlIngresar } from '@/lib/rutas';
import { ambientePorDefecto } from '@/server/documentos';
import { leerFiltros, type ParametrosUrl } from '@/server/documentos/filtros';
import { listarEmpresas } from '@/server/empresas';
import {
  ExportacionDemasiadoGrande,
  generarExportacion,
  leerPedido,
  MAXIMO_FILAS,
} from '@/server/reportes';
import { obtenerMembresias, obtenerPerfil, obtenerUsuario } from '@/server/sesion';

// Exportación CSV / Excel del período (PLAN-SAAS Fase 9, punto 2). GET con los mismos
// filtros que Documentos (empresa, ambiente, período y, para `reporte=documentos`, tipo,
// estado y búsqueda) más `reporte` y `formato`; ver `server/reportes/filas.ts`.
//
// Lee con la sesión del usuario (RLS), nunca con service_role. El proxy ya manda a
// `/ingresar?siguiente=…` sin sesión; aquí se repite por si acaso. Sin membresía, 404
// (como las páginas de `/[org]`: no se revela qué organizaciones existen). No usa
// `exigirMembresia` porque su `notFound()` es para páginas: aquí se responde texto.

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// 50.000 filas en lotes de 1.000 son 50 peticiones a PostgREST: holgado.
export const maxDuration = 60;

function texto(mensaje: string, status: number): NextResponse {
  return new NextResponse(mensaje, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

function parametrosDe(request: NextRequest): ParametrosUrl {
  const p: ParametrosUrl = {};
  for (const clave of new Set(request.nextUrl.searchParams.keys())) {
    const valores = request.nextUrl.searchParams.getAll(clave);
    p[clave] = valores.length === 1 ? valores[0] : valores;
  }
  return p;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;

  const usuario = await obtenerUsuario();
  if (!usuario) {
    const destino = urlIngresar(`${request.nextUrl.pathname}${request.nextUrl.search}`);
    return NextResponse.redirect(new URL(destino, request.url));
  }
  const membresia = (await obtenerMembresias()).find((m) => m.slug === slug);
  if (!membresia) return texto('No encontramos esa organización.', 404);

  const parametros = parametrosDe(request);
  const filtros = leerFiltros(parametros);
  const pedido = leerPedido(parametros, filtros.periodo);
  if (!pedido.ok) return texto(pedido.mensaje, 400);

  try {
    const organizacionId = membresia.organizacionId;
    const [empresas, perfil] = await Promise.all([
      listarEmpresas(organizacionId),
      obtenerPerfil().catch(() => null),
    ]);
    // Una empresa pedida en la URL que no es de la organización (eliminada, de otra
    // organización o un enlace mal copiado) es un 404: exportar otra sin avisar entregaría
    // un archivo que parece el pedido. Sin `?empresa`, la misma elección que Documentos:
    // la última abierta, la primera activa o la primera.
    if (filtros.empresa && !empresas.some((e) => e.id === filtros.empresa)) {
      return texto(
        'No encontramos esa empresa en esta organización. Vuelve a exportar desde el Tablero o Documentos emitidos.',
        404,
      );
    }
    const empresa =
      empresas.find((e) => e.id === filtros.empresa) ??
      empresas.find((e) => e.id === perfil?.ultimaEmpresa) ??
      empresas.find((e) => e.activa) ??
      empresas[0];
    if (!empresa) {
      return texto('Aún no hay empresas en esta organización: no hay nada que exportar.', 404);
    }
    const ambiente =
      filtros.ambiente ??
      (await ambientePorDefecto({
        organizacionId,
        empresaId: empresa.id,
        autorizadaProduccion: empresa.autorizadaProduccion,
      }));

    const archivo = await generarExportacion({
      reporte: pedido.reporte,
      formato: pedido.formato,
      ctx: { organizacionId, empresaId: empresa.id, ambiente },
      rutEmpresa: empresa.rut,
      filtros,
    });
    return new NextResponse(new Uint8Array(archivo.cuerpo), {
      status: 200,
      headers: {
        'Content-Type': archivo.tipoContenido,
        'Content-Disposition': `attachment; filename="${archivo.nombre}"`,
        'Content-Length': String(archivo.cuerpo.length),
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof ExportacionDemasiadoGrande) {
      // Solo el reporte de boletas admite filtros. El resumen de producción sale de la
      // vista y no tiene tope; el de certificación lee boleta por boleta y solo llegaría
      // aquí con un volumen que certificación no tiene.
      const mensaje =
        pedido.reporte === 'documentos'
          ? `La exportación pasa del máximo de ${formatearMiles(MAXIMO_FILAS)} documentos. Acota el período o filtra por tipo o estado y vuelve a exportar.`
          : `El resumen diario de certificación tiene más de ${formatearMiles(MAXIMO_FILAS)} documentos y no podemos armarlo. Descarga las boletas del período por tipo o estado.`;
      return texto(mensaje, 413);
    }
    console.error('Exportación: no se pudo generar el archivo', {
      tipo: error instanceof Error ? error.name : null,
      mensaje: error instanceof Error ? error.message : null,
    });
    return texto(
      'No pudimos generar el archivo. Intenta de nuevo en unos minutos; si sigue fallando, escríbenos.',
      500,
    );
  }
}
