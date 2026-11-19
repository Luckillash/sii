'use client';

import {
  type ComponentProps,
  type ReactElement,
  useActionState,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  Alerta,
  Boton,
  Campo,
  CampoRut,
  Input,
  Select,
  unirIds,
  useCampo,
} from '@/components/boleteame';
import {
  type ControlTurnstile,
  Turnstile,
  turnstileConfigurado,
} from '@/components/turnstile/Turnstile';
import { type EstadoContacto, enviarContacto } from './acciones';
import estilos from './contacto.module.css';
import {
  ACCION_TURNSTILE_CONTACTO,
  CAMPO_TRAMPA,
  ETIQUETA_MOTIVO,
  LARGOS_CONTACTO,
  MOTIVOS_CONTACTO,
  type MotivoContacto,
} from './esquema';

// Formulario de /contacto. La validación que manda es la del servidor (zod en la Server
// Action); aquí van los topes de largo, el aviso del dígito verificador del RUT al salir
// del campo y el widget de Turnstile. Los campos son controlados: lo escrito no se pierde
// cuando React reinicia el formulario después de un envío con error.

/** `<textarea>` con el aspecto de `Input`, ligado a su `Campo`. */
function AreaTexto({ className, ...resto }: ComponentProps<'textarea'>): ReactElement {
  const campo = useCampo();
  return (
    <textarea
      {...resto}
      id={resto.id ?? campo?.id}
      aria-describedby={unirIds(campo?.idDescripcion, resto['aria-describedby'])}
      aria-invalid={resto['aria-invalid'] ?? (campo?.invalido ? true : undefined)}
      className={[estilos.areaTexto, className].filter(Boolean).join(' ')}
    />
  );
}

interface FormularioProps {
  motivoInicial: MotivoContacto | null;
  onOtro: () => void;
}

function Formulario({ motivoInicial, onOtro }: FormularioProps): ReactElement {
  const [estado, accion, enviando] = useActionState<EstadoContacto | null, FormData>(
    enviarContacto,
    null,
  );
  const [nombre, setNombre] = useState('');
  const [correo, setCorreo] = useState('');
  const [empresa, setEmpresa] = useState('');
  const [rut, setRut] = useState('');
  const [motivo, setMotivo] = useState<string>(motivoInicial ?? '');
  const [mensaje, setMensaje] = useState('');
  const [captcha, setCaptcha] = useState<string | null>(null);
  const turnstile = useRef<ControlTurnstile>(null);
  const exigeCaptcha = turnstileConfigurado();

  // Cada token de Turnstile sirve una vez: tras un error se pide otro.
  useEffect(() => {
    if (estado && !estado.ok) turnstile.current?.reiniciar();
  }, [estado]);

  if (estado?.ok) {
    return (
      <div className={estilos.exito} aria-live="polite">
        <Alerta tono="exito" titulo="Recibimos tu mensaje">
          Te responderemos al correo que nos dejaste. Si en unos días no ves la respuesta, revisa la
          carpeta de spam o correo no deseado.
        </Alerta>
        <div>
          <Boton variante="secundario" onClick={onOtro}>
            Escribir otro mensaje
          </Boton>
        </div>
      </div>
    );
  }

  const errores = estado && !estado.ok ? estado.errores : undefined;

  return (
    <form action={accion} className={estilos.formulario} noValidate>
      <div aria-live="polite" className={estilos.avisos}>
        {estado && !estado.ok ? (
          <Alerta tono="error" titulo={estado.error.titulo}>
            {estado.error.detalle}
          </Alerta>
        ) : null}
      </div>

      <div className={estilos.fila}>
        <Campo etiqueta="Nombre" error={errores?.nombre} anchoCompleto>
          <Input
            className={estilos.anchoTotal}
            name="nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            maxLength={LARGOS_CONTACTO.nombre}
            autoComplete="name"
            required
          />
        </Campo>
        <Campo
          etiqueta="Correo electrónico"
          ayuda="Te responderemos a este correo."
          error={errores?.correo}
          anchoCompleto
        >
          <Input
            className={estilos.anchoTotal}
            name="correo"
            type="email"
            value={correo}
            onChange={(e) => setCorreo(e.target.value)}
            maxLength={LARGOS_CONTACTO.correo}
            autoComplete="email"
            spellCheck={false}
            required
            placeholder="nombre@empresa.cl"
          />
        </Campo>
      </div>

      <div className={estilos.fila}>
        <Campo etiqueta="Empresa (opcional)" error={errores?.empresa} anchoCompleto>
          <Input
            className={estilos.anchoTotal}
            name="empresa"
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
            maxLength={LARGOS_CONTACTO.empresa}
            autoComplete="organization"
          />
        </Campo>
        <div>
          <CampoRut
            etiqueta="RUT de la empresa (opcional)"
            value={rut}
            onChange={(valor) => setRut(valor)}
            placeholder="76.354.771-K"
            error={errores?.rut}
          />
          {/* El CampoRut no tiene `name`: su valor viaja en un input oculto. */}
          <input type="hidden" name="rut" value={rut} />
        </div>
      </div>

      <Campo etiqueta="Motivo" error={errores?.motivo} anchoCompleto>
        <Select
          className={estilos.anchoTotal}
          name="motivo"
          value={motivo}
          onChange={(e) => setMotivo(e.target.value)}
          required
        >
          <option value="" disabled>
            Elige un motivo
          </option>
          {MOTIVOS_CONTACTO.map((m) => (
            <option key={m} value={m}>
              {ETIQUETA_MOTIVO[m]}
            </option>
          ))}
        </Select>
      </Campo>

      <Campo
        etiqueta="Mensaje"
        ayuda={`Si es sobre un envío al SII, incluye el Track ID o el folio. Nunca escribas aquí tu certificado ni su clave. ${mensaje.length.toLocaleString('es-CL')} de ${LARGOS_CONTACTO.mensaje.toLocaleString('es-CL')} caracteres.`}
        error={errores?.mensaje}
        anchoCompleto
      >
        <AreaTexto
          name="mensaje"
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
          minLength={LARGOS_CONTACTO.mensajeMinimo}
          maxLength={LARGOS_CONTACTO.mensaje}
          rows={7}
          required
        />
      </Campo>

      {/* Campo trampa: fuera de la vista y del orden de tabulación. Si llega con algo, es un bot. */}
      <div className={estilos.trampa} aria-hidden="true">
        <label htmlFor="contacto-sitio-web">Sitio web (déjalo en blanco)</label>
        <input
          id="contacto-sitio-web"
          type="text"
          name={CAMPO_TRAMPA}
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      <Turnstile ref={turnstile} onToken={setCaptcha} accion={ACCION_TURNSTILE_CONTACTO} />
      <input type="hidden" name="captcha" value={captcha ?? ''} />

      <div className={estilos.acciones}>
        <Boton
          type="submit"
          variante="primario"
          className={estilos.botonEnviar}
          disabled={enviando || (exigeCaptcha && !captcha)}
        >
          {enviando ? 'Enviando…' : 'Enviar mensaje'}
        </Boton>
      </div>
    </form>
  );
}

export interface FormularioContactoProps {
  /** Motivo de `?motivo=…`, si es uno de la lista. */
  motivoInicial: MotivoContacto | null;
}

/** Formulario de contacto; «Escribir otro mensaje» lo vuelve a montar vacío. */
export function FormularioContacto({ motivoInicial }: FormularioContactoProps): ReactElement {
  const [vuelta, setVuelta] = useState(0);
  return (
    <Formulario key={vuelta} motivoInicial={motivoInicial} onOtro={() => setVuelta((n) => n + 1)} />
  );
}
