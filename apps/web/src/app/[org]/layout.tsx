import { LogOut } from 'lucide-react';
import type { ReactNode } from 'react';
import { Boton } from '@/components/boleteame';
import { ETIQUETA_ROL } from '@/lib/permisos';
import { exigirUsuario, obtenerMembresias, obtenerPerfil, type Perfil } from '@/server/sesion';
import { clienteServidor } from '@/server/supabase/servidor';
import { MarcoApp } from './MarcoApp';
import org from './organizacion.module.css';
import { SelectorOrganizacion } from './SelectorOrganizacion';

// App autenticada de una organización (PLAN-SAAS Fase 2).
//
// Membresía: si el usuario no es miembro de `[org]` (o no existe), este layout NO lanza
// notFound(): un `not-found.tsx` no atrapa lo que lanza el layout de su mismo segmento,
// y caería en el 404 genérico. En su lugar pasa `children` sin el armazón y cada página
// llama a `exigirMembresia()`, que lanza notFound() → `./not-found.tsx` (404, sin
// revelar si la organización existe). Toda página nueva bajo /[org] debe llamar a
// `exigirMembresia()`: además le da el id de la organización y el rol para RLS y la UI.
//
// Permisos en componentes cliente: por ahora las páginas pasan el rol como prop (Equipo
// es el único que lo usa), así que no hay provider ni store. Cuando haga falta en
// muchos componentes, va en `useContextoStore` (PLAN-SAAS §4.3).

async function perfilSeguro(): Promise<Perfil | null> {
  try {
    return await obtenerPerfil();
  } catch (error) {
    // Sin la migración 0003 la consulta de preferencias falla: la página sigue.
    console.warn('No se pudo leer el perfil', (error as Error).message);
    return null;
  }
}

/** Guarda `perfiles.ultima_organizacion` (pista para /bienvenida). Nunca rompe la página. */
async function recordarOrganizacion(usuarioId: string, organizacionId: string): Promise<void> {
  try {
    const supabase = await clienteServidor();
    const { error } = await supabase
      .from('perfiles')
      .update({ ultima_organizacion: organizacionId })
      .eq('id', usuarioId);
    if (error) {
      console.warn('No se pudo guardar la última organización', {
        codigo: error.code,
        mensaje: error.message,
      });
    }
  } catch (error) {
    console.warn('No se pudo guardar la última organización', (error as Error).message);
  }
}

export default async function LayoutOrganizacion({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ org: string }>;
}) {
  const { org: slug } = await params;
  const usuario = await exigirUsuario();
  const membresias = await obtenerMembresias();
  const actual = membresias.find((m) => m.slug === slug);
  if (!actual) return children;

  const perfil = await perfilSeguro();
  // Solo si cambió (y si el perfil se pudo leer: sin 0003 la columna no existe).
  if (perfil && perfil.ultimaOrganizacion !== actual.organizacionId) {
    await recordarOrganizacion(usuario.id, actual.organizacionId);
  }

  const nombre = perfil?.nombre?.trim() || usuario.correo;

  return (
    <MarcoApp
      org={slug}
      usuario={{ nombre, rol: ETIQUETA_ROL[actual.rol] }}
      selectorOrganizacion={<SelectorOrganizacion actual={actual} membresias={membresias} />}
      aviso={
        <div className={org.barra}>
          <span className={org.barraCorreo}>{usuario.correo}</span>
          <form action="/auth/salir" method="post">
            <Boton
              type="submit"
              tamano="sm"
              variante="discreto"
              icono={<LogOut size={16} strokeWidth={1.5} />}
            >
              Cerrar sesión
            </Boton>
          </form>
        </div>
      }
    >
      {children}
    </MarcoApp>
  );
}
