'use client';

import { useState, useTransition } from 'react';
import { Alerta, Boton, Dialogo, Select, Tabla, TablaVacia, Td, Th } from '@/components/boleteame';
import { formatearFecha } from '@/lib/formatos';
import {
  DESCRIPCION_ROL,
  ETIQUETA_ROL,
  puedeCambiarRol,
  puedeQuitarMiembro,
  quedaSinPropietario,
  type RolMiembro,
  rolesAsignables,
} from '@/lib/permisos';
import type { InvitacionPendiente, Miembro } from '@/server/equipo';
import { type MensajeError, traducirErrorEquipo } from '@/server/equipo-errores';
import {
  cambiarRol,
  quitarMiembro,
  reenviarInvitacion,
  revocarInvitacion,
  salirDeOrganizacion,
} from './acciones';
import { EnlaceParaCopiar } from './EnlaceParaCopiar';
import estilos from './equipo.module.css';

// Miembros, invitaciones pendientes y salida de la organización. Los botones y
// selectores aparecen solo si el rol los permite (src/lib/permisos.ts), pero la
// autoridad es RLS: cada acción vuelve a verificarse en el servidor.

export interface TablasEquipoProps {
  slug: string;
  organizacion: string;
  usuarioId: string;
  rolActor: RolMiembro;
  miembros: Miembro[];
  /** `null` si quien mira no es administrador (RLS no le muestra invitaciones). */
  invitaciones: InvitacionPendiente[] | null;
}

type Confirmacion =
  | { tipo: 'rol'; miembro: Miembro; rolNuevo: RolMiembro }
  | { tipo: 'quitar'; miembro: Miembro }
  | { tipo: 'revocar'; invitacion: InvitacionPendiente }
  | { tipo: 'salir' };

type Aviso =
  | { tono: 'exito'; titulo: string }
  | { tono: 'error'; error: MensajeError }
  | { tono: 'enlace'; correo: string; error: MensajeError; enlace: string };

function nombreVisible(m: Miembro): string {
  return m.nombre?.trim() || m.correo || 'Sin nombre';
}

export function TablasEquipo({
  slug,
  organizacion,
  usuarioId,
  rolActor,
  miembros,
  invitaciones,
}: TablasEquipoProps) {
  const [confirmacion, setConfirmacion] = useState<Confirmacion | null>(null);
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [pendiente, iniciar] = useTransition();

  const propietarios = miembros.filter((m) => m.rol === 'propietario').length;
  const yo = miembros.find((m) => m.usuarioId === usuarioId);
  const asignables = rolesAsignables(rolActor);

  function ejecutar(
    accion: () => Promise<{ ok: true; mensaje: string } | { ok: false; error: MensajeError }>,
  ) {
    iniciar(async () => {
      const r = await accion();
      setConfirmacion(null);
      setAviso(r.ok ? { tono: 'exito', titulo: r.mensaje } : { tono: 'error', error: r.error });
    });
  }

  function confirmar() {
    if (!confirmacion) return;
    switch (confirmacion.tipo) {
      case 'rol':
        ejecutar(() => cambiarRol(slug, confirmacion.miembro.usuarioId, confirmacion.rolNuevo));
        break;
      case 'quitar':
        ejecutar(() => quitarMiembro(slug, confirmacion.miembro.usuarioId));
        break;
      case 'revocar':
        ejecutar(() => revocarInvitacion(slug, confirmacion.invitacion.id));
        break;
      case 'salir':
        // Si sale bien, la acción redirige a /bienvenida.
        ejecutar(() => salirDeOrganizacion(slug));
        break;
    }
  }

  function reenviar(invitacion: InvitacionPendiente) {
    iniciar(async () => {
      const r = await reenviarInvitacion(slug, invitacion.id);
      if (!r.ok) setAviso({ tono: 'error', error: r.error });
      else if (r.enviado)
        setAviso({ tono: 'exito', titulo: `Reenviamos la invitación a ${r.correo}.` });
      else setAviso({ tono: 'enlace', correo: r.correo, error: r.aviso, enlace: r.enlace });
    });
  }

  function pedirCambioRol(miembro: Miembro, valor: string) {
    const rolNuevo = asignables.find((r) => r === valor);
    if (!rolNuevo || rolNuevo === miembro.rol) return;
    if (quedaSinPropietario(miembro.rol, rolNuevo, propietarios)) {
      setAviso({
        tono: 'error',
        error: traducirErrorEquipo(
          { message: 'La organización debe tener al menos un propietario' },
          'cambiar_rol',
        ),
      });
      return;
    }
    setConfirmacion({ tipo: 'rol', miembro, rolNuevo });
  }

  function pedirSalida() {
    if (yo && quedaSinPropietario(yo.rol, null, propietarios)) {
      setAviso({
        tono: 'error',
        error: traducirErrorEquipo(
          { message: 'La organización debe tener al menos un propietario' },
          'salir',
        ),
      });
      return;
    }
    setConfirmacion({ tipo: 'salir' });
  }

  const hayAccionesMiembros = miembros.some(
    (m) => m.usuarioId !== usuarioId && puedeQuitarMiembro(rolActor, m.rol, false),
  );

  return (
    <>
      <div aria-live="polite" className={estilos.avisos}>
        {aviso?.tono === 'exito' ? (
          <Alerta
            tono="exito"
            titulo={aviso.titulo}
            accion={
              <Boton tamano="sm" variante="discreto" onClick={() => setAviso(null)}>
                Cerrar
              </Boton>
            }
          />
        ) : null}
        {aviso?.tono === 'error' ? (
          <Alerta
            tono="error"
            titulo={aviso.error.titulo}
            accion={
              <Boton tamano="sm" variante="discreto" onClick={() => setAviso(null)}>
                Cerrar
              </Boton>
            }
          >
            {aviso.error.detalle}
          </Alerta>
        ) : null}
        {aviso?.tono === 'enlace' ? (
          <Alerta tono="aviso" titulo={aviso.error.titulo}>
            <p>{aviso.error.detalle}</p>
            <EnlaceParaCopiar
              enlace={aviso.enlace}
              etiqueta={`Enlace de invitación para ${aviso.correo}`}
              onCerrar={() => setAviso(null)}
            />
          </Alerta>
        ) : null}
      </div>

      <section aria-labelledby="t-miembros" className={estilos.seccion}>
        <h2 id="t-miembros" className={estilos.subtitulo}>
          Miembros
        </h2>
        <Tabla etiqueta="Miembros de la organización">
          <thead>
            <tr>
              <Th>Nombre</Th>
              <Th>Correo</Th>
              <Th>Rol</Th>
              <Th>Desde</Th>
              {hayAccionesMiembros ? (
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {miembros.map((m) => {
              const esYo = m.usuarioId === usuarioId;
              const opciones = asignables.filter(
                (r) => r === m.rol || puedeCambiarRol(rolActor, m.rol, r),
              );
              const nombre = nombreVisible(m);
              return (
                <tr key={m.usuarioId}>
                  <Td>
                    {nombre}
                    {esYo ? <span className={estilos.tu}> (tú)</span> : null}
                  </Td>
                  <Td className={estilos.correoCelda}>{m.correo ?? '—'}</Td>
                  <Td>
                    {opciones.length > 1 ? (
                      <Select
                        aria-label={`Rol de ${nombre}`}
                        value={m.rol}
                        disabled={pendiente}
                        onChange={(e) => pedirCambioRol(m, e.target.value)}
                        className={estilos.selectRol}
                      >
                        {opciones.map((r) => (
                          <option key={r} value={r}>
                            {ETIQUETA_ROL[r]}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      ETIQUETA_ROL[m.rol]
                    )}
                  </Td>
                  <Td mono>{formatearFecha(m.desde)}</Td>
                  {hayAccionesMiembros ? (
                    <Td num>
                      {!esYo && puedeQuitarMiembro(rolActor, m.rol, false) ? (
                        <Boton
                          tamano="sm"
                          variante="discreto"
                          disabled={pendiente}
                          onClick={() => setConfirmacion({ tipo: 'quitar', miembro: m })}
                          aria-label={`Quitar a ${nombre}`}
                        >
                          Quitar
                        </Boton>
                      ) : null}
                    </Td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </Tabla>
      </section>

      {invitaciones ? (
        <section aria-labelledby="t-invitaciones" className={estilos.seccion}>
          <h2 id="t-invitaciones" className={estilos.subtitulo}>
            Invitaciones pendientes
          </h2>
          <Tabla etiqueta="Invitaciones pendientes">
            <thead>
              <tr>
                <Th>Correo</Th>
                <Th>Rol</Th>
                <Th>Vence</Th>
                <Th>
                  <span className="sr-only">Acciones</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {invitaciones.length === 0 ? (
                <TablaVacia columnas={4}>
                  No hay invitaciones pendientes. Invita a alguien con el formulario de arriba.
                </TablaVacia>
              ) : (
                invitaciones.map((i) => (
                  <tr key={i.id}>
                    <Td className={estilos.correoCelda}>{i.correo}</Td>
                    <Td>{ETIQUETA_ROL[i.rol]}</Td>
                    <Td mono>
                      {formatearFecha(i.expiraEn)}
                      {i.vencida ? <span className={estilos.vencida}> Vencida</span> : null}
                    </Td>
                    <Td num>
                      <span className={estilos.accionesFila}>
                        <Boton
                          tamano="sm"
                          variante="discreto"
                          disabled={pendiente}
                          onClick={() => reenviar(i)}
                          aria-label={`Reenviar la invitación a ${i.correo}`}
                        >
                          Reenviar
                        </Boton>
                        <Boton
                          tamano="sm"
                          variante="discreto"
                          disabled={pendiente}
                          onClick={() => setConfirmacion({ tipo: 'revocar', invitacion: i })}
                          aria-label={`Revocar la invitación a ${i.correo}`}
                        >
                          Revocar
                        </Boton>
                      </span>
                    </Td>
                  </tr>
                ))
              )}
            </tbody>
          </Tabla>
        </section>
      ) : null}

      <section aria-labelledby="t-salir" className={estilos.seccion}>
        <h2 id="t-salir" className={estilos.subtitulo}>
          Salir de la organización
        </h2>
        <p className={estilos.nota}>
          Dejarás de ver las empresas y los documentos de {organizacion}. Para volver, alguien del
          equipo tendrá que invitarte de nuevo.
        </p>
        <div>
          <Boton variante="peligro" disabled={pendiente} onClick={pedirSalida}>
            Salir de {organizacion}
          </Boton>
        </div>
      </section>

      <Dialogo
        abierto={confirmacion !== null}
        onCerrar={() => setConfirmacion(null)}
        onConfirmar={confirmar}
        cargando={pendiente}
        variante={confirmacion?.tipo === 'rol' ? 'primario' : 'peligro'}
        titulo={tituloConfirmacion(confirmacion, organizacion)}
        textoConfirmar={textoConfirmar(confirmacion)}
      >
        {cuerpoConfirmacion(confirmacion, organizacion)}
      </Dialogo>
    </>
  );
}

function tituloConfirmacion(c: Confirmacion | null, organizacion: string): string {
  switch (c?.tipo) {
    case 'rol':
      return `Cambiar el rol de ${nombreVisible(c.miembro)}`;
    case 'quitar':
      return `Quitar a ${nombreVisible(c.miembro)}`;
    case 'revocar':
      return 'Revocar la invitación';
    case 'salir':
      return `Salir de ${organizacion}`;
    default:
      return '';
  }
}

function textoConfirmar(c: Confirmacion | null): string {
  switch (c?.tipo) {
    case 'rol':
      return 'Cambiar rol';
    case 'quitar':
      return 'Quitar de la organización';
    case 'revocar':
      return 'Revocar invitación';
    case 'salir':
      return 'Salir de la organización';
    default:
      return 'Confirmar';
  }
}

function cuerpoConfirmacion(c: Confirmacion | null, organizacion: string) {
  switch (c?.tipo) {
    case 'rol':
      return (
        <>
          <p>
            Pasará de {ETIQUETA_ROL[c.miembro.rol]} a {ETIQUETA_ROL[c.rolNuevo]}.
          </p>
          <p>{DESCRIPCION_ROL[c.rolNuevo]}</p>
        </>
      );
    case 'quitar':
      return (
        <p>
          {nombreVisible(c.miembro)} perderá el acceso a {organizacion} de inmediato. Para que
          vuelva, tendrás que invitarlo de nuevo.
        </p>
      );
    case 'revocar':
      return (
        <p>
          El enlace enviado a {c.invitacion.correo} dejará de servir. Puedes invitar a ese correo
          otra vez cuando quieras.
        </p>
      );
    case 'salir':
      return (
        <p>
          Perderás el acceso a {organizacion} de inmediato. Para volver, alguien del equipo tendrá
          que invitarte de nuevo.
        </p>
      );
    default:
      return null;
  }
}
