'use client';

import Link from 'next/link';
import { useActionState, useMemo, useState } from 'react';
import { Alerta, Boton, Campo, CampoRut, clasesBoton, Input } from '@/components/boleteame';
import { formatearRut } from '@/lib/formatos';
import { crearEmpresa, editarEmpresa, type ResultadoFormularioEmpresa } from './acciones';
import estilos from './empresas.module.css';
import { LARGOS_EMPRESA, type ValoresEmpresa } from './esquemas';

// Alta y edición de una empresa. La validación que manda es la del servidor (zod en
// la Server Action, espejo de los checks de la base); aquí solo se ponen topes de
// largo y el CampoRut avisa un dígito verificador malo al salir del campo.

export interface FormularioEmpresaProps {
  slug: string;
  /** Sin empresa: alta. Con empresa: edición (el RUT queda fijo). */
  empresa?: { id: string; valores: ValoresEmpresa };
}

const VACIO: ValoresEmpresa = {
  rut: '',
  razonSocial: '',
  giro: '',
  direccion: '',
  comuna: '',
  correoIntercambio: '',
};

export function FormularioEmpresa({ slug, empresa }: FormularioEmpresaProps) {
  const empresaId = empresa?.id;
  const accionServidor = useMemo(
    () => (empresaId ? editarEmpresa.bind(null, slug, empresaId) : crearEmpresa.bind(null, slug)),
    [slug, empresaId],
  );
  const [estado, accion, enviando] = useActionState<ResultadoFormularioEmpresa | null, FormData>(
    accionServidor,
    null,
  );
  const inicial = empresa?.valores ?? VACIO;
  // Tras un error se conserva lo escrito; tras guardar, los datos nuevos (la página se
  // vuelve a renderizar con ellos por revalidatePath).
  const valores = estado && !estado.ok && estado.valores ? estado.valores : inicial;
  const errores = estado && !estado.ok ? estado.errores : undefined;
  // El CampoRut no tiene `name`: su valor viaja en un input oculto.
  const [rut, setRut] = useState(inicial.rut);

  return (
    <form action={accion} className={estilos.formulario} noValidate>
      <div aria-live="polite" className={`${estilos.anchoTotal} ${estilos.avisos}`}>
        {estado?.ok ? <Alerta tono="exito" titulo={estado.mensaje} /> : null}
        {estado && !estado.ok ? (
          <Alerta tono="error" titulo={estado.error.titulo}>
            {estado.error.detalle}
          </Alerta>
        ) : null}
      </div>

      {empresa ? (
        <Campo
          etiqueta="RUT"
          ayuda="El RUT no se puede cambiar. Si necesitas otro, agrega una empresa nueva."
          anchoCompleto
        >
          <Input value={formatearRut(empresa.valores.rut)} readOnly mono />
        </Campo>
      ) : (
        <div>
          <CampoRut
            etiqueta="RUT de la empresa"
            value={rut}
            onChange={(valor) => setRut(valor)}
            placeholder="76.354.771-K"
            ayuda="Después no se puede cambiar: si te equivocas, agrega otra empresa."
            error={errores?.rut}
          />
          <input type="hidden" name="rut" value={rut} />
        </div>
      )}

      <Campo
        etiqueta="Razón social"
        ayuda="Tal como figura en el SII."
        error={errores?.razonSocial}
        anchoCompleto
        className={estilos.anchoTotal}
      >
        <Input
          name="razonSocial"
          defaultValue={valores.razonSocial}
          maxLength={LARGOS_EMPRESA.razonSocial}
          autoComplete="organization"
          required
          placeholder="Servicios Andinos SpA"
        />
      </Campo>

      <Campo
        etiqueta="Giro"
        ayuda={`Sin abreviaciones, tal como figura en el SII. Hasta ${LARGOS_EMPRESA.giro} caracteres.`}
        error={errores?.giro}
        anchoCompleto
        className={estilos.anchoTotal}
      >
        <Input
          name="giro"
          defaultValue={valores.giro}
          maxLength={LARGOS_EMPRESA.giro}
          autoComplete="off"
          required
          placeholder="Venta al por menor de artículos de ferretería"
        />
      </Campo>

      <Campo
        etiqueta="Dirección"
        ayuda="La dirección desde donde emites; va en cada documento."
        error={errores?.direccion}
        anchoCompleto
      >
        <Input
          name="direccion"
          defaultValue={valores.direccion}
          maxLength={LARGOS_EMPRESA.direccion}
          autoComplete="street-address"
          required
          placeholder="Av. Providencia 1234, oficina 56"
        />
      </Campo>

      <Campo etiqueta="Comuna" error={errores?.comuna} anchoCompleto>
        <Input
          name="comuna"
          defaultValue={valores.comuna}
          maxLength={LARGOS_EMPRESA.comuna}
          autoComplete="address-level2"
          required
          placeholder="Providencia"
        />
      </Campo>

      <Campo
        etiqueta="Correo de intercambio (opcional)"
        ayuda="El correo donde recibes documentos de otros contribuyentes, como lo registraste en el SII."
        error={errores?.correoIntercambio}
        anchoCompleto
        className={estilos.anchoTotal}
      >
        <Input
          name="correoIntercambio"
          type="email"
          defaultValue={valores.correoIntercambio}
          maxLength={LARGOS_EMPRESA.correoIntercambio}
          autoComplete="off"
          spellCheck={false}
          placeholder="dte@empresa.cl"
        />
      </Campo>

      <div className={estilos.acciones}>
        <Boton type="submit" variante="primario" disabled={enviando}>
          {empresa
            ? enviando
              ? 'Guardando…'
              : 'Guardar cambios'
            : enviando
              ? 'Agregando la empresa…'
              : 'Agregar empresa'}
        </Boton>
        {empresa ? null : (
          <Link href={`/${slug}/configuracion/empresas`} className={clasesBoton('discreto')}>
            Cancelar
          </Link>
        )}
      </div>
    </form>
  );
}
