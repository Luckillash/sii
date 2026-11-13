'use client';

import { useActionState, useMemo, useState } from 'react';
import { Alerta, Boton, Campo, Input, Select } from '@/components/boleteame';
import { formatearFecha } from '@/lib/formatos';
import { type ResultadoResolucion, registrarResolucion } from '../acciones';
import estilos from '../empresas.module.css';
import { AMBIENTES, type Ambiente, ETIQUETA_AMBIENTE } from '../esquemas';

// Registra la resolución vigente de un ambiente con `registrar_resolucion()`, que deja
// la anterior en el historial en la misma transacción. En certificación el SII entrega
// solo la fecha: el número es 0 y el campo va deshabilitado (no viaja en el formulario;
// el servidor fija el 0).

export interface FormularioResolucionProps {
  slug: string;
  empresaId: string;
  /** Hoy en Chile (`AAAA-MM-DD`), calculado en el servidor: tope del selector de fecha. */
  hoy: string;
  /** La vigente de cada ambiente, para avisar qué se reemplaza. */
  vigentes: Partial<Record<Ambiente, { numero: number; fecha: string }>>;
}

function esAmbiente(valor: string): valor is Ambiente {
  return (AMBIENTES as readonly string[]).includes(valor);
}

export function FormularioResolucion({
  slug,
  empresaId,
  hoy,
  vigentes,
}: FormularioResolucionProps) {
  const accionServidor = useMemo(
    () => registrarResolucion.bind(null, slug, empresaId),
    [slug, empresaId],
  );
  const [estado, accion, enviando] = useActionState<ResultadoResolucion | null, FormData>(
    accionServidor,
    null,
  );
  const [ambiente, setAmbiente] = useState<Ambiente>(
    vigentes.certificacion && !vigentes.produccion ? 'produccion' : 'certificacion',
  );
  const errores = estado && !estado.ok ? estado.errores : undefined;
  const valores = estado && !estado.ok ? estado.valores : undefined;
  const vigente = vigentes[ambiente];
  const certificacion = ambiente === 'certificacion';

  return (
    <form action={accion} className={estilos.bloque} noValidate>
      <div aria-live="polite" className={estilos.avisos}>
        {estado?.ok ? <Alerta tono="exito" titulo={estado.mensaje} /> : null}
        {estado && !estado.ok ? (
          <Alerta tono="error" titulo={estado.error.titulo}>
            {estado.error.detalle}
          </Alerta>
        ) : null}
      </div>

      <div className={estilos.filaResolucion}>
        <Campo etiqueta="Ambiente" error={errores?.ambiente}>
          <Select
            name="ambiente"
            value={ambiente}
            onChange={(e) => {
              if (esAmbiente(e.target.value)) setAmbiente(e.target.value);
            }}
          >
            {AMBIENTES.map((a) => (
              <option key={a} value={a}>
                {ETIQUETA_AMBIENTE[a]}
              </option>
            ))}
          </Select>
        </Campo>

        <Campo
          etiqueta="Número"
          ayuda={
            certificacion
              ? 'En certificación el SII entrega solo la fecha: el número es siempre 0.'
              : 'El número de la resolución que autoriza a la empresa a emitir en producción.'
          }
          error={certificacion ? undefined : errores?.numero}
        >
          {certificacion ? (
            <Input key="certificacion" value="0" disabled mono />
          ) : (
            <Input
              key="produccion"
              name="numero"
              inputMode="numeric"
              pattern="[0-9]*"
              defaultValue={valores?.numero ?? ''}
              autoComplete="off"
              required
              mono
              placeholder="80"
            />
          )}
        </Campo>

        <Campo etiqueta="Fecha" ayuda="No puede ser posterior a hoy." error={errores?.fecha}>
          <Input
            name="fecha"
            type="date"
            max={hoy}
            defaultValue={valores?.fecha ?? ''}
            required
            mono
          />
        </Campo>
      </div>

      <p className={estilos.nota}>
        {vigente
          ? `Reemplazará a la vigente de ${ETIQUETA_AMBIENTE[ambiente]}${
              certificacion ? '' : ` (N° ${vigente.numero})`
            }, del ${formatearFecha(vigente.fecha)}, que pasará al historial.`
          : `Aún no hay una resolución vigente de ${ETIQUETA_AMBIENTE[ambiente]}.`}
      </p>

      <div>
        <Boton type="submit" disabled={enviando}>
          {enviando ? 'Registrando…' : 'Registrar resolución'}
        </Boton>
      </div>
    </form>
  );
}
