import { contextoAdministrador, PIE_ALERTA } from './alertas-comun';
import { enlaceSeguro, escapar } from './html';
import {
  boton,
  type Correo,
  documento,
  ESTILO_NOTA,
  ESTILO_PARRAFO,
  ESTILO_TITULO,
} from './plantilla';

// Alerta `certificado.por_vencer` (PLAN-SAAS §4.6 y Fase 8) para propietarios y
// administradores, a 30, 15, 7 y 1 días del vencimiento (`v_certificados_estado`). Un
// correo por certificado y umbral. Español de Chile con tú, sin exclamaciones ni emoji.
// Sin secretos: titular, RUT, fecha y enlace.

export interface DatosCertificadoPorVencer {
  organizacion: string;
  /** Nombre del titular (o el CN si no hay nombre). */
  titular: string;
  /** RUT del titular, `12.345.678-5`. */
  rut: string;
  /** Fecha de vencimiento, `10-11-2026` (hora de Chile). */
  vence: string;
  /** Días que faltan (0 = vence en menos de 24 h). */
  dias: number;
  /** Razones sociales de las empresas que firman con él (puede venir vacío). */
  empresas: string[];
  /** `${NEXT_PUBLIC_APP_URL}/${slug}/configuracion/certificados` */
  enlace: string;
}

function cuandoVence(dias: number): string {
  if (dias <= 0) return 'vence en menos de 24 h';
  // dias_restantes = 1 son entre 24 y 48 h: «mañana» podría ser falso.
  if (dias === 1) return 'vence en menos de 2 días';
  return `vence en ${dias} días`;
}

export function correoCertificadoPorVencer(datos: DatosCertificadoPorVencer): Correo {
  const enlace = enlaceSeguro(datos.enlace);
  const cuando = cuandoVence(datos.dias);
  const titulo = `El certificado digital de ${datos.titular} ${cuando}`;
  const asunto = `${titulo} (${datos.vence})`;
  const empresas =
    datos.empresas.length > 0
      ? ` Con él se firman los documentos de ${datos.empresas.join(', ')}.`
      : '';
  const intro = `El certificado digital de ${datos.titular} (RUT ${datos.rut}) ${cuando}, el ${datos.vence}.${empresas}`;
  const queHacer =
    'Sin un certificado vigente no se pueden firmar documentos, pedir folios ni enviar nada al SII. Renuévalo con tu proveedor de certificados y sube el archivo .pfx nuevo en Boletéame antes de esa fecha. Si ya subiste el nuevo, márcalo como predeterminado en cada empresa.';
  const contexto = contextoAdministrador(datos.organizacion);

  const cuerpo = [
    `<h1 style="${ESTILO_TITULO}">${escapar(titulo)}</h1>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(intro)}</p>`,
    `<p style="${ESTILO_PARRAFO}">${escapar(queHacer)}</p>`,
    boton(enlace, 'Ver los certificados'),
    `<p style="${ESTILO_NOTA}">${escapar(contexto)}</p>`,
  ].join('\n');

  const html = documento({ titulo: asunto, previa: intro, cuerpo, pie: escapar(PIE_ALERTA) });

  const texto = [
    titulo,
    '',
    intro,
    queHacer,
    '',
    'Revisa los certificados en este enlace:',
    enlace,
    '',
    contexto,
    '',
    '--',
    PIE_ALERTA,
  ].join('\n');

  return { asunto, html, texto };
}
