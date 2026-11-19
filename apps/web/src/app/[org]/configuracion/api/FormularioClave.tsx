'use client';

import { useActionState, useEffect, useId, useMemo, useState } from 'react';
import { Alerta, Boton, Campo, Input, Select } from '@/components/boleteame';
import { ALCANCES_OFRECIDOS, ALCANCES_POR_DEFECTO, DESCRIPCION_ALCANCE } from '@/lib/api-publica';
import { formatearRut } from '@/lib/formatos';
import { PLAZOS_EXPIRACION } from '@/server/integraciones/presentacion';
import { crearClaveApi, type ResultadoCrearClave } from './acciones';
import estilos from './api.module.css';
import { SecretoParaCopiar } from './SecretoParaCopiar';

export interface EmpresaOpcion {
  id: string;
  rut: string;
  razonSocial: string;
}

export interface FormularioClaveProps {
  slug: string;
  empresas: EmpresaOpcion[];
  /** El plan permite producción: si no, solo claves `sk_test_` (certificación). */
  permiteProduccion: boolean;
  /** El plan no incluye API: el formulario se ve, pero no se puede enviar. */
  deshabilitado: boolean;
}

export function FormularioClave({
  slug,
  empresas,
  permiteProduccion,
  deshabilitado,
}: FormularioClaveProps) {
  const crear = useMemo(() => crearClaveApi.bind(null, slug), [slug]);
  const [estado, accion, enviando] = useActionState<ResultadoCrearClave | null, FormData>(
    crear,
    null,
  );
  const idAlcances = useId();
  // La clave se muestra una sola vez: se descarta al cerrarla o al crear otra.
  const [claveVisible, setClaveVisible] = useState(false);
  // Cambia con cada clave creada: remonta el formulario para dejarlo en sus valores iniciales.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    setClaveVisible(Boolean(estado?.ok));
    if (estado?.ok) setVersion((v) => v + 1);
  }, [estado]);

  const errores = estado && !estado.ok ? estado.errores : undefined;
  const valores = estado && !estado.ok ? estado.valores : undefined;
  const alcancesMarcados: readonly string[] = valores?.alcances ?? ALCANCES_POR_DEFECTO;

  return (
    <div className={estilos.bloque}>
      {estado?.ok && claveVisible ? (
        <Alerta tono="exito" titulo={`Creaste la API key «${estado.nombre}»`}>
          <p>
            Copia la API key ahora. No la volveremos a mostrar; si la pierdes, revócala y crea otra.
          </p>
          <SecretoParaCopiar
            valor={estado.clave}
            etiqueta={`API key ${estado.nombre}`}
            textoCopiar="Copiar API key"
            onCerrar={() => setClaveVisible(false)}
          />
        </Alerta>
      ) : null}
      {estado && !estado.ok ? (
        <Alerta tono="error" titulo={estado.error.titulo}>
          {estado.error.detalle}
        </Alerta>
      ) : null}

      <form
        key={version}
        action={accion}
        className={estilos.formulario}
        noValidate
        onSubmit={() => setClaveVisible(false)}
      >
        <div className={estilos.fila}>
          <Campo etiqueta="Nombre" ayuda="Para reconocerla después." error={errores?.nombre}>
            <Input
              name="nombre"
              required
              maxLength={80}
              autoComplete="off"
              placeholder="ERP de la tienda"
              defaultValue={valores?.nombre ?? ''}
            />
          </Campo>
          <Campo
            etiqueta="Ambiente"
            ayuda={
              permiteProduccion
                ? 'Certificación crea una clave sk_test_; producción, una sk_live_.'
                : 'Tu plan no incluye producción: por ahora solo claves de certificación (sk_test_).'
            }
            error={errores?.ambiente}
          >
            <Select name="ambiente" defaultValue={valores?.ambiente || 'certificacion'}>
              <option value="certificacion">Certificación</option>
              <option value="produccion" disabled={!permiteProduccion}>
                Producción
              </option>
            </Select>
          </Campo>
        </div>
        <div className={estilos.fila}>
          <Campo
            etiqueta="Empresa"
            ayuda="Limita la clave a una empresa, o deja que sirva para todas."
            error={errores?.empresa}
          >
            <Select name="empresa" defaultValue={valores?.empresa ?? ''}>
              <option value="">Todas las empresas</option>
              {empresas.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.razonSocial} ({formatearRut(e.rut)})
                </option>
              ))}
            </Select>
          </Campo>
          <Campo etiqueta="Vence" error={errores?.expiracion}>
            <Select name="expiracion" defaultValue={valores?.expiracion ?? ''}>
              {PLAZOS_EXPIRACION.map((p) => (
                <option key={p.valor} value={p.valor}>
                  {p.etiqueta}
                </option>
              ))}
            </Select>
          </Campo>
        </div>

        <fieldset
          className={estilos.opciones}
          aria-describedby={errores?.alcances ? `${idAlcances}-error` : undefined}
        >
          <legend>Permisos</legend>
          {ALCANCES_OFRECIDOS.map((alcance) => (
            <label key={alcance} className={estilos.casilla}>
              <input
                type="checkbox"
                name="alcances"
                value={alcance}
                defaultChecked={alcancesMarcados.includes(alcance)}
              />
              <span className={estilos.casillaTexto}>
                <span className={estilos.mono}>{alcance}</span>
                <span className={estilos.casillaAyuda}>{DESCRIPCION_ALCANCE[alcance]}</span>
              </span>
            </label>
          ))}
          {errores?.alcances ? (
            <p id={`${idAlcances}-error`} className={estilos.errorCampo}>
              {errores.alcances}
            </p>
          ) : null}
        </fieldset>

        <div className={estilos.acciones}>
          <Boton type="submit" variante="primario" disabled={enviando || deshabilitado}>
            {enviando ? 'Creando la API key…' : 'Crear API key'}
          </Boton>
        </div>
      </form>
    </div>
  );
}
