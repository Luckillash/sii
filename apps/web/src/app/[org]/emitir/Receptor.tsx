'use client';

import { UserRound } from 'lucide-react';
import { useState } from 'react';
import { Autocompletado, Boton, Campo, CampoRut, Input, Tarjeta } from '@/components/boleteame';
import { LARGO_MAXIMO_RAZON_SOCIAL, RECEPTOR_GENERICO, type ReceptorCatalogo } from '@/lib/emision';
import { formatearRut, LARGO_MAXIMO_CORREO_SII } from '@/lib/formatos';
import { useEmisionStore } from '@/stores/ProveedorEmision';
import estilos from './emitir.module.css';

// Receptor de la boleta: opcional. Por defecto 66.666.666-6 «Cliente General»; se puede
// buscar en el catálogo de receptores (razón social y correo) o escribirlo. El correo
// sirve para enviarle el PDF, también sin RUT.

export function Receptor({
  buscar,
  errores,
  limpiar,
  deshabilitado,
}: {
  buscar: (texto: string) => Promise<ReceptorCatalogo[]>;
  errores: Record<string, string>;
  limpiar: (prefijo: string) => void;
  deshabilitado: boolean;
}) {
  const receptor = useEmisionStore((s) => s.receptor);
  const cambiarReceptor = useEmisionStore((s) => s.cambiarReceptor);
  const usarReceptor = useEmisionStore((s) => s.usarReceptor);
  const quitarReceptor = useEmisionStore((s) => s.quitarReceptor);
  const [busqueda, setBusqueda] = useState('');
  const [manual, setManual] = useState(false);

  const conDatos =
    receptor.rut.trim() !== '' ||
    receptor.razonSocial.trim() !== '' ||
    receptor.correo.trim() !== '' ||
    Object.keys(errores).some((k) => k.startsWith('receptor.'));
  const abierto = manual || conDatos;

  if (!abierto) {
    return (
      <Tarjeta aria-labelledby="t-receptor" className={estilos.seccion}>
        <h2 id="t-receptor" className={estilos.subtitulo}>
          Receptor
        </h2>
        <div className={estilos.receptorFijo}>
          <p>
            <span className={estilos.mono}>{formatearRut(RECEPTOR_GENERICO.rut)}</span>{' '}
            {RECEPTOR_GENERICO.razonSocial}
            <br />
            <span className={estilos.nota}>
              La boleta no exige receptor. Indícalo si te lo piden o para enviarle el PDF por
              correo.
            </span>
          </p>
          <Boton
            tamano="sm"
            icono={<UserRound size={16} strokeWidth={1.5} />}
            onClick={() => setManual(true)}
            disabled={deshabilitado}
          >
            Indicar receptor
          </Boton>
        </div>
      </Tarjeta>
    );
  }

  return (
    <Tarjeta aria-labelledby="t-receptor" className={estilos.seccion}>
      <div className={estilos.seccionCabecera}>
        <h2 id="t-receptor" className={estilos.subtitulo}>
          Receptor
        </h2>
        <Boton
          tamano="sm"
          variante="discreto"
          onClick={() => {
            quitarReceptor();
            limpiar('receptor');
            setBusqueda('');
            setManual(false);
          }}
          disabled={deshabilitado}
        >
          Usar Cliente General
        </Boton>
      </div>

      <Campo
        etiqueta="Buscar en tus receptores"
        ayuda="Escribe parte del RUT o de la razón social."
        anchoCompleto
      >
        <Autocompletado<ReceptorCatalogo>
          value={busqueda}
          onChange={setBusqueda}
          buscar={buscar}
          onElegir={(r) => {
            usarReceptor(r);
            limpiar('receptor');
            setBusqueda('');
          }}
          claveOpcion={(r) => r.id}
          renderOpcion={(r) => (
            <span className={estilos.opcionCatalogo}>
              <span className={estilos.opcionCatalogoFila}>
                <span>{r.razonSocial}</span>
                <span className={estilos.mono}>{formatearRut(r.rut)}</span>
              </span>
              {r.correo ? <span className={estilos.opcionCatalogoDetalle}>{r.correo}</span> : null}
            </span>
          )}
          sinResultados="No hay receptores que coincidan. Escribe sus datos abajo."
          disabled={deshabilitado}
          maxLength={100}
        />
      </Campo>

      <div className={estilos.rejilla}>
        <CampoRut
          etiqueta="RUT del receptor"
          value={receptor.rut}
          onChange={(v) => {
            cambiarReceptor('rut', v);
            limpiar('receptor.rut');
          }}
          ayuda="Déjalo vacío para usar 66.666.666-6 Cliente General."
          error={errores['receptor.rut']}
          disabled={deshabilitado}
        />
        <Campo
          etiqueta="Razón social o nombre"
          error={errores['receptor.razonSocial']}
          anchoCompleto
        >
          <Input
            value={receptor.razonSocial}
            maxLength={LARGO_MAXIMO_RAZON_SOCIAL}
            autoComplete="off"
            onChange={(e) => {
              cambiarReceptor('razonSocial', e.target.value);
              limpiar('receptor.razonSocial');
            }}
            disabled={deshabilitado}
          />
        </Campo>
        <Campo
          etiqueta="Correo"
          ayuda="Si lo escribes, le enviamos el PDF de la boleta."
          error={errores['receptor.correo']}
          anchoCompleto
        >
          <Input
            type="email"
            value={receptor.correo}
            maxLength={LARGO_MAXIMO_CORREO_SII}
            autoComplete="off"
            onChange={(e) => {
              cambiarReceptor('correo', e.target.value);
              limpiar('receptor.correo');
            }}
            disabled={deshabilitado}
          />
        </Campo>
      </div>
    </Tarjeta>
  );
}
