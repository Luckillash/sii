import type { Metadata } from 'next';
import Link from 'next/link';
import { Alerta, Boton, clasesBoton, LayoutIngreso } from '@/components/boleteame';
import { formatearFecha } from '@/lib/formatos';
import { DESCRIPCION_ROL, ETIQUETA_ROL, type RolMiembro } from '@/lib/permisos';
import { urlIngresar } from '@/lib/rutas';
import { obtenerUsuario } from '@/server/sesion';
import { clienteServidor } from '@/server/supabase/servidor';
import { FormularioAceptar } from './FormularioAceptar';
import estilos from './invitacion.module.css';
import { esTokenInvitacion, rutaInvitacion } from './token';

// /invitacion/[token] (PLAN-SAAS Fase 2, punto 4). Pública en el proxy: se ve antes de
// iniciar sesión. `ver_invitacion(token)` (migración 0003) devuelve organización, correo,
// rol y vencimiento solo con el token correcto de una invitación pendiente y vigente.
//
// El token va en la URL: `referrer: no-referrer` evita que salga en la cabecera Referer
// hacia otros sitios, y Sentry lo filtra en `src/lib/sentry/depurar.ts`. Nunca a logs.
//
// Si `ver_invitacion` aún no existe en la base (0003 sin aplicar), la RPC falla y la
// página muestra igual el mensaje de invitación inválida.

export const metadata: Metadata = {
  title: 'Invitación · Boletéame',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

interface DatosInvitacion {
  organizacion: string;
  correo: string;
  rol: RolMiembro;
  expiraEn: string;
}

async function verInvitacion(token: string): Promise<DatosInvitacion | null> {
  if (!esTokenInvitacion(token)) return null;
  try {
    const supabase = await clienteServidor();
    const { data, error } = await supabase.rpc('ver_invitacion', { p_token: token });
    if (error) {
      console.warn('ver_invitacion falló', { codigo: error.code });
      return null;
    }
    const fila = data?.[0];
    return fila
      ? {
          organizacion: fila.organizacion_nombre,
          correo: fila.correo,
          rol: fila.rol,
          expiraEn: fila.expira_en,
        }
      : null;
  } catch (error) {
    console.warn('ver_invitacion falló', (error as Error).name);
    return null;
  }
}

function FormularioSalir({ token }: { token: string }) {
  return (
    <form action="/auth/salir" method="post">
      {/* /auth/salir lleva a /ingresar?siguiente=<esta invitación>. */}
      <input type="hidden" name="siguiente" value={rutaInvitacion(token)} />
      <Boton type="submit" className={estilos.botonGrande}>
        Cerrar sesión
      </Boton>
    </form>
  );
}

export default async function PaginaInvitacion({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [invitacion, usuario] = await Promise.all([verInvitacion(token), obtenerUsuario()]);

  if (!invitacion) {
    return (
      <LayoutIngreso>
        <div className={estilos.titulos}>
          <h1 className={estilos.titulo}>La invitación venció, ya se usó o no existe</h1>
          <p className={estilos.nota}>
            Los enlaces de invitación sirven una sola vez y vencen a los 7 días. Pide a quien te
            invitó que te envíe una nueva desde Configuración, en Equipo.
          </p>
        </div>
        {usuario ? (
          <Link href="/bienvenida" className={clasesBoton('primario', 'md', estilos.botonGrande)}>
            Ir a mis organizaciones
          </Link>
        ) : (
          <Link href="/ingresar" className={clasesBoton('primario', 'md', estilos.botonGrande)}>
            Ingresar
          </Link>
        )}
      </LayoutIngreso>
    );
  }

  const siguiente = rutaInvitacion(token);
  const correoCalza = usuario?.correo.toLowerCase() === invitacion.correo.toLowerCase();

  return (
    <LayoutIngreso
      titular="Te sumaron a un equipo."
      bajada="Acepta la invitación para trabajar en la misma organización."
    >
      <div className={estilos.titulos}>
        <h1 className={estilos.titulo}>Te invitaron a {invitacion.organizacion}</h1>
        <p className={estilos.nota}>{DESCRIPCION_ROL[invitacion.rol]}</p>
      </div>

      <dl className={estilos.datos}>
        <div>
          <dt>Organización</dt>
          <dd>{invitacion.organizacion}</dd>
        </div>
        <div>
          <dt>Rol</dt>
          <dd>{ETIQUETA_ROL[invitacion.rol]}</dd>
        </div>
        <div>
          <dt>Correo invitado</dt>
          <dd className={estilos.correo}>{invitacion.correo}</dd>
        </div>
        <div>
          <dt>Vence</dt>
          <dd className={estilos.mono}>{formatearFecha(invitacion.expiraEn)}</dd>
        </div>
      </dl>

      {!usuario ? (
        <>
          <p className={estilos.nota}>
            Para aceptarla, ingresa o crea tu cuenta con {invitacion.correo}.
          </p>
          <div className={estilos.acciones}>
            <Link
              href={urlIngresar(siguiente)}
              className={clasesBoton('primario', 'md', estilos.botonGrande)}
            >
              Ingresar
            </Link>
            <Link
              href={`/crear-cuenta?${new URLSearchParams({ siguiente }).toString()}`}
              className={clasesBoton('secundario', 'md', estilos.botonGrande)}
            >
              Crear cuenta
            </Link>
          </div>
        </>
      ) : correoCalza ? (
        <FormularioAceptar token={token} organizacion={invitacion.organizacion} />
      ) : (
        <>
          <Alerta tono="aviso" titulo="Ingresaste con otro correo">
            Esta invitación es para {invitacion.correo} y tu sesión es de {usuario.correo}. Cierra
            sesión e ingresa con el correo invitado: volverás a esta invitación.
          </Alerta>
          <FormularioSalir token={token} />
        </>
      )}
    </LayoutIngreso>
  );
}
