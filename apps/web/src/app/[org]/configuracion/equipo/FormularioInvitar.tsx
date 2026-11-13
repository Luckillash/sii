'use client';

import { useActionState, useEffect, useMemo, useState } from 'react';
import { Alerta, Boton, Campo, Input, Select } from '@/components/boleteame';
import { DESCRIPCION_ROL, ETIQUETA_ROL, type RolMiembro } from '@/lib/permisos';
import { invitar, type ResultadoInvitacion } from './acciones';
import { EnlaceParaCopiar } from './EnlaceParaCopiar';
import estilos from './equipo.module.css';

export interface FormularioInvitarProps {
  slug: string;
  /** `rolesInvitables(rolActor)`. */
  roles: RolMiembro[];
  /** Si hay Resend: si no, la invitación muestra el enlace para copiar. */
  correoConfigurado: boolean;
  /** Aviso de cupo lleno (se calcula en el servidor). */
  avisoCupo?: string | null;
}

export function FormularioInvitar({
  slug,
  roles,
  correoConfigurado,
  avisoCupo,
}: FormularioInvitarProps) {
  const invitarEnOrganizacion = useMemo(() => invitar.bind(null, slug), [slug]);
  const [estado, accion, enviando] = useActionState<ResultadoInvitacion | null, FormData>(
    invitarEnOrganizacion,
    null,
  );
  const rolInicial = roles.includes('lector') ? 'lector' : (roles[0] ?? 'lector');
  const [rol, setRol] = useState<RolMiembro>(rolInicial);
  // El enlace se muestra una sola vez: se descarta al cerrarlo o al enviar otra invitación.
  const [enlaceVisible, setEnlaceVisible] = useState(false);

  useEffect(() => {
    setEnlaceVisible(Boolean(estado?.ok && !estado.enviado));
    if (estado && !estado.ok && estado.valores?.rol) {
      const r = roles.find((x) => x === estado.valores?.rol);
      if (r) setRol(r);
    }
  }, [estado, roles]);

  const errores = estado && !estado.ok ? estado.errores : undefined;

  return (
    <div className={estilos.bloque}>
      {estado?.ok && estado.enviado ? (
        <Alerta tono="exito" titulo="Invitación enviada">
          Enviamos la invitación a {estado.correo}. El enlace vence en 7 días.
        </Alerta>
      ) : null}
      {estado?.ok && !estado.enviado && enlaceVisible ? (
        <Alerta tono="aviso" titulo={estado.aviso.titulo}>
          <p>{estado.aviso.detalle}</p>
          <EnlaceParaCopiar
            enlace={estado.enlace}
            etiqueta={`Enlace de invitación para ${estado.correo}`}
            onCerrar={() => setEnlaceVisible(false)}
          />
        </Alerta>
      ) : null}
      {estado && !estado.ok ? (
        <Alerta tono="error" titulo={estado.error.titulo}>
          {estado.error.detalle}
        </Alerta>
      ) : null}
      {avisoCupo ? <Alerta tono="aviso">{avisoCupo}</Alerta> : null}

      <form
        action={accion}
        className={estilos.formularioInvitar}
        noValidate
        onSubmit={() => setEnlaceVisible(false)}
      >
        <Campo etiqueta="Correo electrónico" error={errores?.correo}>
          <Input
            name="correo"
            type="email"
            required
            autoComplete="off"
            placeholder="nombre@empresa.cl"
            defaultValue={estado && !estado.ok ? estado.valores?.correo : ''}
          />
        </Campo>
        <Campo etiqueta="Rol" ayuda={DESCRIPCION_ROL[rol]} error={errores?.rol}>
          <Select name="rol" value={rol} onChange={(e) => setRol(e.target.value as RolMiembro)}>
            {roles.map((r) => (
              <option key={r} value={r}>
                {ETIQUETA_ROL[r]}
              </option>
            ))}
          </Select>
        </Campo>
        <Boton type="submit" variante="primario" disabled={enviando} className={estilos.enviar}>
          {enviando
            ? 'Creando la invitación…'
            : correoConfigurado
              ? 'Enviar invitación'
              : 'Crear invitación'}
        </Boton>
      </form>
      {correoConfigurado ? null : (
        <p className={estilos.nota}>
          El envío de correos aún no está configurado: al crear la invitación verás el enlace para
          compartirlo tú.
        </p>
      )}
    </div>
  );
}
