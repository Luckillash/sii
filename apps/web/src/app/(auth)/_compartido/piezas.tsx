import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { Alerta, Boton, clasesBoton } from '@/components/timbre';
import estilos from './auth.module.css';

// Piezas de las pantallas de acceso (plantilla «Ingreso»). Sin estado: sirven en
// Server y Client Components.

/** Primer valor de un parámetro de búsqueda (`searchParams`). */
export function primerValor(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

/** `ruta?siguiente=…` (o solo `ruta` si no hay destino). */
export function conSiguiente(ruta: string, siguiente: string): string {
  return siguiente ? `${ruta}?${new URLSearchParams({ siguiente }).toString()}` : ruta;
}

export function Titulos({ titulo, nota }: { titulo: ReactNode; nota?: ReactNode }): ReactElement {
  return (
    <div className={estilos.titulos}>
      <h1 className={estilos.titulo}>{titulo}</h1>
      {nota ? <p className={estilos.nota}>{nota}</p> : null}
    </div>
  );
}

/** Línea con texto al centro, p. ej. «¿Aún no tienes cuenta?». */
export function Separador({ children }: { children: ReactNode }): ReactElement {
  return <p className={estilos.separador}>{children}</p>;
}

/** Enlace con aspecto de botón grande (44px), como en la plantilla. */
export function EnlaceBoton({
  href,
  variante = 'secundario',
  children,
}: {
  href: string;
  variante?: 'primario' | 'secundario';
  children: ReactNode;
}): ReactElement {
  return (
    <Link href={href} className={clasesBoton(variante, 'md', estilos.botonGrande)}>
      {children}
    </Link>
  );
}

/** Pantalla «Revisa tu correo» después de pedir un enlace. */
export function RevisaTuCorreo({
  children,
  volver,
}: {
  children: ReactNode;
  /** Botón para volver al formulario (p. ej. «Usar otro correo»). */
  volver?: { texto: string; alPulsar: () => void } | { texto: string; href: string };
}): ReactElement {
  return (
    <>
      <Titulos titulo="Revisa tu correo" />
      <Alerta tono="info">{children}</Alerta>
      <p className={estilos.notaPequena}>
        Si no llega en unos minutos, revisa la carpeta de spam o promociones.
      </p>
      {volver ? (
        'href' in volver ? (
          <EnlaceBoton href={volver.href}>{volver.texto}</EnlaceBoton>
        ) : (
          <Boton className={estilos.botonGrande} onClick={volver.alPulsar}>
            {volver.texto}
          </Boton>
        )
      ) : null}
    </>
  );
}

/** `/restablecer` sin la sesión que abre el enlace de recuperación. */
export function SinSesionRecuperacion(): ReactElement {
  return (
    <>
      <Titulos titulo="Restablecer contraseña" />
      <Alerta tono="aviso" titulo="Tu enlace de recuperación venció o ya se usó.">
        Para cambiar la contraseña abre el enlace más reciente que te enviamos, o pide uno nuevo.
      </Alerta>
      <EnlaceBoton href="/recuperar" variante="primario">
        Pedir un enlace nuevo
      </EnlaceBoton>
      <Link href="/ingresar" className={estilos.enlace}>
        Volver a ingresar
      </Link>
    </>
  );
}
