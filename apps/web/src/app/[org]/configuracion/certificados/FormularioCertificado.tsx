'use client';

import {
  type FormEvent,
  useActionState,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import { Alerta, Boton, Campo, CampoRut, Input, Select } from '@/components/boleteame';
import { formatearRut } from '@/lib/formatos';
import { type ResultadoSubida, subirCertificado } from './acciones';
import estilos from './certificados.module.css';

// Carga de un .pfx. El envío pasa por `onSubmit` (como en los formularios de acceso)
// para que React no vacíe el formulario al responder: así el archivo elegido se
// conserva si hay que pedir el RUT. La contraseña, en cambio, se borra tras cada
// respuesta. La respuesta del servidor nunca trae la clave ni el archivo.

const TAMANO_MAXIMO = 100 * 1024;

export interface EmpresaOpcion {
  id: string;
  rut: string;
  razonSocial: string;
}

export interface FormularioCertificadoProps {
  slug: string;
  empresas: EmpresaOpcion[];
}

export function FormularioCertificado({ slug, empresas }: FormularioCertificadoProps) {
  const subirEnOrganizacion = useMemo(() => subirCertificado.bind(null, slug), [slug]);
  const [estado, despachar, enviando] = useActionState<ResultadoSubida | null, FormData>(
    subirEnOrganizacion,
    null,
  );
  const [, iniciar] = useTransition();
  const formulario = useRef<HTMLFormElement>(null);
  const campoClave = useRef<HTMLInputElement>(null);
  const idRepresentante = useId();
  const idPredeterminado = useId();

  const [errorLocal, setErrorLocal] = useState<string | null>(null);
  const [mostrarRut, setMostrarRut] = useState(false);
  const [rut, setRut] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [exitoVisible, setExitoVisible] = useState(false);

  useEffect(() => {
    if (!estado) return;
    // La contraseña nunca queda escrita después de una respuesta.
    if (campoClave.current) campoClave.current.value = '';
    if (estado.ok) {
      formulario.current?.reset();
      setRut('');
      setEmpresa('');
      setMostrarRut(false);
      setExitoVisible(true);
      return;
    }
    if (estado.pedirRut) setMostrarRut(true);
    formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [estado]);

  function alEnviar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    const datos = new FormData(evento.currentTarget);
    const archivo = datos.get('pfx');
    if (archivo instanceof File && archivo.size > TAMANO_MAXIMO) {
      setErrorLocal(
        'El archivo pesa más de 100 KB y un certificado .pfx pesa unos pocos KB. Revisa que sea el archivo correcto.',
      );
      return;
    }
    setErrorLocal(null);
    setExitoVisible(false);
    iniciar(() => despachar(datos));
  }

  const fallo = estado && !estado.ok && !enviando ? estado : null;
  const errores = fallo?.errores ?? {};

  return (
    <div className={estilos.bloque}>
      <div aria-live="polite" className={estilos.avisos}>
        {estado?.ok && exitoVisible ? (
          <Alerta
            tono="exito"
            titulo={estado.mensaje}
            accion={
              <Boton tamano="sm" variante="discreto" onClick={() => setExitoVisible(false)}>
                Cerrar
              </Boton>
            }
          />
        ) : null}
        {estado?.ok && exitoVisible && estado.aviso ? (
          <Alerta tono="aviso" titulo={estado.aviso.titulo}>
            {estado.aviso.detalle}
          </Alerta>
        ) : null}
        {fallo ? (
          <Alerta tono={fallo.tono ?? 'error'} titulo={fallo.error.titulo}>
            {fallo.error.detalle}
          </Alerta>
        ) : null}
      </div>

      <form ref={formulario} className={estilos.formulario} noValidate onSubmit={alEnviar}>
        <div className={estilos.filaCampos}>
          <Campo
            etiqueta="Archivo del certificado (.pfx o .p12)"
            error={errorLocal ?? errores.pfx}
            ayuda="El que te entregó la entidad certificadora. Pesa pocos KB."
            anchoCompleto
          >
            <Input
              name="pfx"
              type="file"
              required
              accept=".pfx,.p12,application/x-pkcs12"
              className={estilos.archivo}
              onChange={() => setErrorLocal(null)}
            />
          </Campo>
          <Campo etiqueta="Contraseña del certificado" error={errores.clave} anchoCompleto>
            <Input
              ref={campoClave}
              name="clave"
              type="password"
              required
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={256}
            />
          </Campo>
        </div>

        {mostrarRut ? (
          <div className={estilos.filaCampos}>
            <div>
              <CampoRut
                etiqueta="RUT del titular"
                value={rut}
                onChange={(valor) => setRut(valor)}
                error={errores.rut_titular}
                ayuda="El certificado no trae el RUT de su titular: escríbelo tal como lo registra el SII."
              />
              <input type="hidden" name="rut_titular" value={rut} />
            </div>
          </div>
        ) : null}

        {empresas.length > 0 ? (
          <div className={estilos.filaCampos}>
            <Campo
              etiqueta="Asociar a una empresa (opcional)"
              error={errores.empresa_id}
              ayuda="También puedes hacerlo después, desde la empresa."
              anchoCompleto
            >
              <Select
                name="empresa_id"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
              >
                <option value="">No asociar ahora</option>
                {empresas.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.razonSocial} ({formatearRut(e.rut)})
                  </option>
                ))}
              </Select>
            </Campo>
            <fieldset className={estilos.opciones} disabled={!empresa}>
              <legend>Para esa empresa</legend>
              <label className={estilos.casilla} htmlFor={idRepresentante}>
                <input id={idRepresentante} type="checkbox" name="representante" />
                <span>El titular es representante electrónico</span>
              </label>
              <label className={estilos.casilla} htmlFor={idPredeterminado}>
                <input id={idPredeterminado} type="checkbox" name="predeterminado" />
                <span>Usar como certificado predeterminado</span>
              </label>
            </fieldset>
          </div>
        ) : null}

        <div className={estilos.acciones}>
          <Boton type="submit" variante="primario" disabled={enviando}>
            {enviando ? 'Revisando el certificado…' : 'Subir certificado'}
          </Boton>
        </div>
        <p className={estilos.nota}>
          Revisamos el certificado aquí mismo y guardamos el archivo y la contraseña cifrados en la
          bóveda de la base de datos. Nadie del equipo podrá descargarlos ni verlos: solo se usan
          para firmar y para autenticarse ante el SII.
        </p>
      </form>
    </div>
  );
}
