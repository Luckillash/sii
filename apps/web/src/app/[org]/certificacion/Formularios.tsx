'use client';

import { useActionState, useId, useMemo, useState } from 'react';
import { Alerta, Boton, Campo, CampoRut, Input } from '@/components/boleteame';
import type { ResultadoPaso } from '@/lib/certificacion';
import { formatearRut } from '@/lib/formatos';
// Solo tipos (se borran al compilar): no arrastran `server-only` al bundle.
import type { VistaAsistente } from '@/server/certificacion';
import { guardarDeclaracion, guardarPostulacion } from './acciones';
import estilos from './certificacion.module.css';

type Proceso = VistaAsistente['proceso'];

function errorDe(estado: ResultadoPaso | null, campo: string): string | undefined {
  return estado?.tipo === 'error' ? estado.errores?.[campo] : undefined;
}

function Resultado({ estado }: { estado: ResultadoPaso | null }) {
  if (!estado) return null;
  if (estado.tipo === 'ok') {
    return <Alerta tono="exito" titulo={estado.mensaje.titulo} />;
  }
  if (estado.tipo === 'error') {
    return (
      <Alerta tono="error" titulo={estado.mensaje.titulo}>
        {estado.mensaje.detalle}
      </Alerta>
    );
  }
  return null;
}

// --- Paso 1: datos de la postulación --------------------------------------------------

export function FormularioPostulacion({
  slug,
  empresaId,
  proceso,
  rutSugerido,
  habilitado,
}: {
  slug: string;
  empresaId: string;
  proceso: Proceso;
  /** RUT del titular del certificado predeterminado (suele ser el administrador). */
  rutSugerido: string | null;
  habilitado: boolean;
}) {
  const accion = useMemo(() => guardarPostulacion.bind(null, slug, empresaId), [slug, empresaId]);
  const [estado, despachar, enviando] = useActionState<ResultadoPaso | null, FormData>(
    accion,
    null,
  );
  const [rut, setRut] = useState(formatearRut(proceso?.rutAdministrador ?? rutSugerido ?? ''));
  const idExenta = useId();

  return (
    <form action={despachar} className={estilos.formulario} noValidate aria-label="Postulación">
      <Alerta tono="aviso" titulo="Escribe sin tildes, ñ ni símbolos especiales">
        El asistente de postulación del SII solo acepta ASCII: con tildes o ñ la confirmación no
        calza y la postulación no se graba. Escribe, por ejemplo, «Boleteame» en vez de «Boletéame».
      </Alerta>
      <Resultado estado={estado} />
      <div className={estilos.filaCampos}>
        <div>
          <CampoRut
            etiqueta="RUT del usuario administrador"
            value={rut}
            onChange={(v) => setRut(v)}
            error={errorDe(estado, 'rutAdministrador')}
            ayuda="Quien después inicia sesión en el SII para ver el avance y declarar. Normalmente es el titular del certificado."
            disabled={!habilitado}
          />
          <input type="hidden" name="rutAdministrador" value={rut} />
        </div>
        <Campo
          etiqueta="Nombre del software"
          error={errorDe(estado, 'nombreSoftware')}
          ayuda="Hasta 30 caracteres."
        >
          <Input
            name="nombreSoftware"
            maxLength={30}
            defaultValue={proceso?.nombreSoftware ?? ''}
            placeholder="Boleteame"
            autoComplete="off"
            required
            disabled={!habilitado}
          />
        </Campo>
      </div>
      <div className={estilos.filaCampos}>
        <Campo etiqueta="Correo del administrador" error={errorDe(estado, 'correoAdministrador')}>
          <Input
            name="correoAdministrador"
            type="email"
            maxLength={50}
            defaultValue={proceso?.correoAdministrador ?? ''}
            autoComplete="email"
            required
            disabled={!habilitado}
          />
        </Campo>
        <Campo
          etiqueta="Correo de contacto con el SII"
          error={errorDe(estado, 'correoContactoSii')}
        >
          <Input
            name="correoContactoSii"
            type="email"
            maxLength={50}
            defaultValue={proceso?.correoContactoSii ?? ''}
            required
            disabled={!habilitado}
          />
        </Campo>
      </div>
      <div className={estilos.filaCampos}>
        <Campo
          etiqueta="Correo de intercambio"
          error={errorDe(estado, 'correoIntercambio')}
          ayuda="Donde la empresa recibe documentos de otros contribuyentes."
        >
          <Input
            name="correoIntercambio"
            type="email"
            maxLength={50}
            defaultValue={proceso?.correoIntercambio ?? ''}
            required
            disabled={!habilitado}
          />
        </Campo>
        <Campo
          etiqueta="Sitio web (opcional)"
          error={errorDe(estado, 'url')}
          ayuda="Empieza con «www.»."
        >
          <Input
            name="url"
            maxLength={100}
            defaultValue={proceso?.url ?? ''}
            placeholder="www.tuempresa.cl"
            autoComplete="url"
            disabled={!habilitado}
          />
        </Campo>
      </div>
      <label className={estilos.casilla} htmlFor={idExenta}>
        <input
          id={idExenta}
          type="checkbox"
          name="boletaExenta"
          defaultChecked={proceso?.boletaExenta ?? true}
          disabled={!habilitado}
        />
        <span>También emitirás boletas exentas (tipo 41)</span>
      </label>
      <div className={estilos.acciones}>
        <Boton type="submit" disabled={!habilitado || enviando}>
          {enviando ? 'Guardando…' : 'Guardar datos'}
        </Boton>
      </div>
    </form>
  );
}

// --- Paso 5: datos de la declaración de cumplimiento ----------------------------------

export function FormularioDeclaracion({
  slug,
  empresaId,
  proceso,
  habilitado,
}: {
  slug: string;
  empresaId: string;
  proceso: Proceso;
  habilitado: boolean;
}) {
  const accion = useMemo(() => guardarDeclaracion.bind(null, slug, empresaId), [slug, empresaId]);
  const [estado, despachar, enviando] = useActionState<ResultadoPaso | null, FormData>(
    accion,
    null,
  );
  const [rut, setRut] = useState(formatearRut(proceso?.rutProveedor ?? ''));

  return (
    <form action={despachar} className={estilos.formulario} noValidate aria-label="Declaración">
      <p className={estilos.nota}>
        El SII pide los datos del proveedor del software de boletas: la empresa que lo desarrolla o
        lo vende. Si el software es de la propia empresa, usa sus datos.
      </p>
      <Resultado estado={estado} />
      <div className={estilos.filaCampos}>
        <Campo
          etiqueta="Link de consulta de boletas"
          error={errorDe(estado, 'linkConsulta')}
          ayuda="Página donde tus clientes consultan sus boletas. Hasta 100 caracteres."
          anchoCompleto
        >
          <Input
            name="linkConsulta"
            type="url"
            maxLength={100}
            defaultValue={proceso?.linkConsulta ?? ''}
            placeholder="https://www.tuempresa.cl/boletas"
            required
            disabled={!habilitado}
          />
        </Campo>
      </div>
      <div className={estilos.filaCampos}>
        <div>
          <CampoRut
            etiqueta="RUT del proveedor de software"
            value={rut}
            onChange={(v) => setRut(v)}
            error={errorDe(estado, 'rutProveedor')}
            disabled={!habilitado}
          />
          <input type="hidden" name="rutProveedor" value={rut} />
        </div>
        <Campo
          etiqueta="Nombre del proveedor"
          error={errorDe(estado, 'nombreProveedor')}
          ayuda="Hasta 30 caracteres."
        >
          <Input
            name="nombreProveedor"
            maxLength={30}
            defaultValue={proceso?.nombreProveedor ?? ''}
            required
            disabled={!habilitado}
          />
        </Campo>
        <Campo etiqueta="Correo del proveedor" error={errorDe(estado, 'correoProveedor')}>
          <Input
            name="correoProveedor"
            type="email"
            maxLength={50}
            defaultValue={proceso?.correoProveedor ?? ''}
            required
            disabled={!habilitado}
          />
        </Campo>
      </div>
      <div className={estilos.acciones}>
        <Boton type="submit" disabled={!habilitado || enviando}>
          {enviando ? 'Guardando…' : 'Guardar datos'}
        </Boton>
      </div>
    </form>
  );
}
