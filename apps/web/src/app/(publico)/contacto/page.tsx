import type { Metadata } from 'next';
import { Tarjeta } from '@/components/boleteame';
import { ID_CONTENIDO } from '../_compartido/enlaces';
import estilos from './contacto.module.css';
import { motivoDesdeParametro } from './esquema';
import { FormularioContacto } from './FormularioContacto';

// /contacto (PLAN-SAAS Fase 12, punto 4). Pública: el layout de (publico) pone la
// cabecera y el pie; esta página solo el <main>. `?motivo=ventas|soporte|certificacion|
// privacidad|otro` deja elegido el motivo (la landing enlaza `/contacto?motivo=ventas`).
// El envío lo hace la Server Action de `acciones.ts` (Turnstile en el servidor y Resend).

export const metadata: Metadata = {
  // La plantilla del layout raíz agrega « · Boletéame»; la canónica (sin ?motivo=) la hereda.
  title: 'Contacto',
  description:
    'Escríbenos por ventas y el plan Empresa, soporte, certificación ante el SII o privacidad de tus datos.',
};

export default async function PaginaContacto({
  searchParams,
}: {
  searchParams: Promise<{ [clave: string]: string | string[] | undefined }>;
}) {
  const { motivo } = await searchParams;
  const motivoInicial = motivoDesdeParametro(motivo);

  return (
    <main id={ID_CONTENIDO} tabIndex={-1} className={estilos.pagina}>
      <div className={estilos.contenedor}>
        <header className={estilos.cabecera}>
          <h1 className={estilos.titulo}>Escríbenos</h1>
          <p className={estilos.bajada}>
            Cuéntanos qué necesitas: una cotización del plan Empresa, ayuda con la emisión o la
            certificación ante el SII, o una consulta sobre tus datos personales. Te respondemos por
            correo en días hábiles, lo antes posible.
          </p>
        </header>

        <div className={estilos.columnas}>
          <Tarjeta relleno="lg" className={estilos.tarjeta} aria-labelledby="titulo-formulario">
            <h2 id="titulo-formulario" className={estilos.subtitulo}>
              Formulario de contacto
            </h2>
            <FormularioContacto motivoInicial={motivoInicial} />
          </Tarjeta>

          <aside className={estilos.notas} aria-label="Antes de escribir">
            <section>
              <h2 className={estilos.subtituloNota}>Si es sobre un envío al SII</h2>
              <p>
                Incluye el Track ID del envío o el tipo y folio de la boleta, y la empresa emisora.
                Con eso lo ubicamos.
              </p>
            </section>
            <section>
              <h2 className={estilos.subtituloNota}>Nunca nos mandes tu certificado</h2>
              <p>
                No necesitamos tu certificado digital (.pfx) ni su clave para ayudarte, y nunca te
                los pediremos por correo ni por este formulario. Si alguien te los pide en nuestro
                nombre, no los entregues.
              </p>
            </section>
            <section>
              <h2 className={estilos.subtituloNota}>Tus datos personales</h2>
              <p>
                Para consultar, corregir o eliminar tus datos, elige el motivo «Privacidad y datos
                personales». Lo que escribas aquí llega por correo a nuestro equipo y lo usamos para
                responderte.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
