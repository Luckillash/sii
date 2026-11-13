'use client';

import {
  type ReactElement,
  type Ref,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Boton } from '@/components/boleteame';
import estilos from './Turnstile.module.css';

// Widget de Cloudflare Turnstile (PLAN-SAAS §4.7), modo *managed*.
//
// - Formularios de Supabase Auth: el token va en `options.captchaToken` y lo verifica
//   Supabase (captcha nativo). Formularios propios (invitación, contacto): el token se
//   verifica en el servidor con `verificarTurnstile()` de `@/server/turnstile`.
// - Sin NEXT_PUBLIC_TURNSTILE_SITE_KEY devuelve `null` y nunca llama a `onToken`: el
//   formulario no debe bloquearse (usa `turnstileConfigurado()` para saberlo).
// - Cada token sirve una sola vez: después de enviar (con éxito o con error) hay que
//   pedir otro con `ref.current.reiniciar()` o remontando el widget con otra `key`.
//
// Sin dependencias: carga el script oficial a mano, una sola vez por pestaña.

const URL_SCRIPT = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

type TemaTurnstile = 'auto' | 'light' | 'dark';

interface OpcionesRender {
  sitekey: string;
  action?: string;
  theme?: TemaTurnstile;
  language?: string;
  size?: 'normal' | 'flexible' | 'compact';
  appearance?: 'always' | 'execute' | 'interaction-only';
  callback?: (token: string) => void;
  'expired-callback'?: () => void;
  'timeout-callback'?: () => void;
  'error-callback'?: (codigo: string) => boolean | undefined;
}

interface ApiTurnstile {
  render(contenedor: HTMLElement, opciones: OpcionesRender): string | undefined;
  reset(id?: string): void;
  remove(id?: string): void;
}

declare global {
  interface Window {
    turnstile?: ApiTurnstile;
  }
}

/** Lo que expone el `ref` del widget. */
export interface ControlTurnstile {
  /** Descarta el token actual (llama a `onToken(null)`) y pide uno nuevo. */
  reiniciar(): void;
}

export interface TurnstileProps {
  /** Token nuevo, o `null` cuando el anterior venció, falló o se reinició el widget. */
  onToken: (token: string | null) => void;
  /** `action` de Turnstile (letras, números, `-` y `_`; hasta 32), p. ej. `ingresar`. */
  accion?: string;
  /** Para reiniciar el widget tras un envío o un error. */
  ref?: Ref<ControlTurnstile>;
}

/** `true` si hay clave de sitio (el widget se muestra y hay que esperar su token). */
export function turnstileConfigurado(): boolean {
  // Acceso literal: Next solo reemplaza así las NEXT_PUBLIC_* en el bundle.
  return Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY);
}

let carga: Promise<ApiTurnstile> | null = null;

function cargarScript(): Promise<ApiTurnstile> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (carga) return carga;
  carga = new Promise<ApiTurnstile>((resolver, rechazar) => {
    const script = document.createElement('script');
    script.src = URL_SCRIPT;
    script.async = true;
    script.onload = () => {
      if (window.turnstile) resolver(window.turnstile);
      else rechazar(new Error('Turnstile no quedó disponible'));
    };
    script.onerror = () => {
      script.remove();
      rechazar(new Error('No se pudo cargar Turnstile'));
    };
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    // Permite reintentar (otro montaje o «Reintentar»).
    carga = null;
    throw error;
  });
  return carga;
}

// Tema: el de `data-theme` en <html> si está fijado; si no, el del sistema ('auto').
function suscribirTema(aviso: () => void): () => void {
  const observador = new MutationObserver(aviso);
  observador.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme'],
  });
  return () => observador.disconnect();
}

function leerTema(): TemaTurnstile {
  const tema = document.documentElement.getAttribute('data-theme');
  return tema === 'dark' || tema === 'light' ? tema : 'auto';
}

const temaServidor = (): TemaTurnstile => 'auto';

type Estado = 'cargando' | 'listo' | 'error' | 'sin-script';

export function Turnstile({ onToken, accion, ref }: TurnstileProps): ReactElement | null {
  const clave = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const tema = useSyncExternalStore(suscribirTema, leerTema, temaServidor);
  const contenedor = useRef<HTMLDivElement>(null);
  const idWidget = useRef<string | undefined>(undefined);
  const [estado, setEstado] = useState<Estado>('cargando');
  // Cambiarlo vuelve a montar el widget (y a intentar cargar el script).
  const [intento, setIntento] = useState(0);

  // El último `onToken` sin volver a montar el widget en cada render del padre.
  const alToken = useRef(onToken);
  useEffect(() => {
    alToken.current = onToken;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: `intento` vuelve a montar el widget a propósito («Reintentar»).
  useEffect(() => {
    if (!clave) return;
    let cancelado = false;
    let id: string | undefined;
    setEstado('cargando');

    cargarScript()
      .then((api) => {
        if (cancelado || !contenedor.current) return;
        id = api.render(contenedor.current, {
          sitekey: clave,
          action: accion,
          theme: tema,
          language: 'es',
          size: 'flexible',
          callback: (token) => {
            setEstado('listo');
            alToken.current(token);
          },
          // Con refresh-expired 'auto' (por defecto) Turnstile pide otro solo.
          'expired-callback': () => alToken.current(null),
          'timeout-callback': () => alToken.current(null),
          'error-callback': () => {
            alToken.current(null);
            setEstado('error');
            // Manejado: el mensaje lo muestra este componente.
            return true;
          },
        });
        idWidget.current = id;
      })
      .catch(() => {
        if (!cancelado) setEstado('sin-script');
      });

    return () => {
      cancelado = true;
      if (id !== undefined) window.turnstile?.remove(id);
      idWidget.current = undefined;
    };
  }, [clave, accion, tema, intento]);

  useImperativeHandle(
    ref,
    () => ({
      reiniciar() {
        alToken.current(null);
        const api = window.turnstile;
        if (api && idWidget.current !== undefined) {
          setEstado('cargando');
          api.reset(idWidget.current);
        } else {
          setIntento((n) => n + 1);
        }
      },
    }),
    [],
  );

  if (!clave) return null;

  const mensaje =
    estado === 'error'
      ? 'No pudimos completar la verificación de seguridad. Vuelve a intentarlo; si sigue fallando, recarga la página.'
      : estado === 'sin-script'
        ? 'No se pudo cargar la verificación de seguridad. Revisa tu conexión o si un bloqueador de contenido la está frenando, y vuelve a intentarlo.'
        : null;

  return (
    <div className={estilos.turnstile}>
      <div ref={contenedor} className={estilos.widget} />
      {mensaje ? (
        <div className={estilos.error} role="alert">
          <p className={estilos.texto}>{mensaje}</p>
          <Boton
            variante="secundario"
            tamano="sm"
            onClick={() => {
              alToken.current(null);
              setIntento((n) => n + 1);
            }}
          >
            Reintentar
          </Boton>
        </div>
      ) : null}
    </div>
  );
}
