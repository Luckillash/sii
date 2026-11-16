'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Alerta, BannerAmbiente, Boton, Dialogo } from '@/components/boleteame';
import {
  type ArchivoDocumento,
  type Borrador,
  type BorradorGuardado,
  esquemaBorrador,
  type ResultadoEmision,
  type ResumenEmision,
  type VistaEmision,
} from '@/lib/emision';
import { formatearRut } from '@/lib/formatos';
import { aBorrador, claveSesion, datosDe, tieneContenido } from '@/stores/emision';
import {
  ProveedorEmision,
  useEmisionStore,
  useStoreEmision,
  useTotalesEmision,
} from '@/stores/ProveedorEmision';
import {
  borrarBorrador,
  buscarProductos,
  buscarReceptores,
  emitir,
  enlaceDocumento,
  guardarBorrador,
} from './acciones';
import { Borradores } from './Borradores';
import { Documento } from './Documento';
import estilos from './emitir.module.css';
import { Descuento, Lineas } from './Lineas';
import {
  ambientePorDefecto,
  bloqueoEmision,
  bloqueoGuardado,
  erroresDelBorrador,
  erroresSinCampo,
  reaccionAError,
  sinErroresDe,
} from './logica';
import { Receptor } from './Receptor';
import { AlertaIncierta, ContenidoEnsayo, ResultadoOk } from './Resultado';
import { Resumen } from './Resumen';

// Pantalla de emisión de una empresa (PLAN-SAAS Fase 7): formulario de la boleta, resumen
// con totales en vivo, ensayo en un `Dialogo` antes de emitir (⚠️), resultado y
// borradores. El estado del formulario vive en `useEmisionStore` (un store por montaje).

export interface EmisionProps {
  slug: string;
  organizacionId: string;
  vista: VistaEmision;
  /** La URL trae `?borrador=` (se quita al emitirlo o al empezar otra boleta). */
  borradorEnUrl: boolean;
}

export function Emision({ slug, organizacionId, vista, borradorEnUrl }: EmisionProps) {
  return (
    <ProveedorEmision
      clave={claveSesion(organizacionId, vista.empresa.id)}
      ambiente={ambientePorDefecto(vista)}
      borrador={vista.borrador}
      borradoresIds={vista.borradores.map((b) => b.id)}
    >
      <Pantalla slug={slug} vista={vista} borradorEnUrl={borradorEnUrl} />
    </ProveedorEmision>
  );
}

type Mensaje = { titulo: string; detalle: string };
type Aviso = {
  tono: 'exito' | 'error';
  mensaje: Mensaje;
  /** Errores por campo sin un control donde mostrarse. */
  extra?: string[];
  /** El borrador ya se emitió: se ofrece empezar otra boleta. */
  ofrecerNueva?: boolean;
};
type ResultadoOkEmision = Extract<ResultadoEmision, { tipo: 'ok' }>;
type ResultadoError = Extract<ResultadoEmision, { tipo: 'error' }>;
type Destino = 'resultado' | 'incierta' | 'aviso';

interface Ensayo {
  resumen: ResumenEmision;
  /** Exactamente lo que se ensayó: es lo que se emite al confirmar. */
  borrador: Borrador;
  borradorId: string | null;
}

const REVISA: Mensaje = {
  titulo: 'Revisa la boleta',
  detalle: 'Hay campos con errores. Corrígelos y vuelve a intentarlo.',
};

function Pantalla({
  slug,
  vista,
  borradorEnUrl,
}: {
  slug: string;
  vista: VistaEmision;
  borradorEnUrl: boolean;
}) {
  const empresaId = vista.empresa.id;
  const store = useStoreEmision();
  const router = useRouter();
  const ruta = usePathname();
  const totales = useTotalesEmision();
  const tipo = useEmisionStore((s) => s.tipoDte);
  const ambiente = useEmisionStore((s) => s.ambiente);
  const borradorId = useEmisionStore((s) => s.borradorId);
  const incierta = useEmisionStore((s) => s.incierta);

  const [pendiente, iniciar] = useTransition();
  const [enMarcha, setEnMarcha] = useState<'ensayo' | 'emitir' | 'guardar' | 'borrar' | null>(null);
  // Freno contra el doble envío: el estado de React llega un render tarde.
  const corriendo = useRef(false);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [aviso, setAviso] = useState<Aviso | null>(null);
  const [ensayo, setEnsayo] = useState<Ensayo | null>(null);
  const [emitido, setEmitido] = useState<ResultadoOkEmision | null>(null);
  const [mensajeIncierto, setMensajeIncierto] = useState<Mensaje | null>(null);
  const [descargando, setDescargando] = useState<ArchivoDocumento | null>(null);
  const [errorDescarga, setErrorDescarga] = useState<Mensaje | null>(null);
  const [nueva, setNueva] = useState<'normal' | 'incierta' | null>(null);
  const [porBorrar, setPorBorrar] = useState<BorradorGuardado | null>(null);

  const refResultado = useRef<HTMLElement>(null);
  const refIncierta = useRef<HTMLDivElement>(null);
  const refAviso = useRef<HTMLDivElement>(null);
  // Un contador para que pedir dos veces el mismo destino vuelva a enfocar.
  const [foco, setFoco] = useState<{ destino: Destino; vez: number } | null>(null);
  const pedirFoco = useCallback((destino: Destino) => {
    setFoco((f) => ({ destino, vez: (f?.vez ?? 0) + 1 }));
  }, []);

  // Foco al mostrar un resultado. En una tarea aparte: el `Dialogo` que se acaba de
  // cerrar devuelve antes el foco a quien lo abrió, y esto lo lleva al mensaje.
  useEffect(() => {
    if (!foco) return;
    const ref =
      foco.destino === 'resultado'
        ? refResultado
        : foco.destino === 'incierta'
          ? refIncierta
          : refAviso;
    const t = setTimeout(() => ref.current?.focus(), 0);
    return () => clearTimeout(t);
  }, [foco]);

  const ocupado = pendiente || enMarcha !== null;

  const limpiar = useCallback((prefijo: string) => {
    setErrores((e) => sinErroresDe(e, prefijo));
  }, []);

  const buscarR = useCallback(
    (t: string) => buscarReceptores(slug, empresaId, t),
    [slug, empresaId],
  );
  const buscarP = useCallback(
    (t: string) => buscarProductos(slug, empresaId, t),
    [slug, empresaId],
  );

  const bloqueoBase = bloqueoEmision(vista, ambiente, tipo, slug, empresaId);
  const bloqueo = incierta
    ? {
        texto:
          'Hay una boleta por verificar: revísala antes de emitir otra. Cuando lo hayas hecho, pulsa «Ya la revisé».',
        enlace: null,
      }
    : bloqueoBase;
  const bloqueoGuardar = bloqueoGuardado(vista, ambiente, slug, empresaId);

  /** Arranca una acción del servidor si no hay otra en curso. */
  function correr(cual: NonNullable<typeof enMarcha>, accion: () => Promise<void>) {
    if (corriendo.current) return;
    corriendo.current = true;
    setEnMarcha(cual);
    iniciar(async () => {
      try {
        await accion();
      } catch {
        setAviso({
          tono: 'error',
          mensaje: {
            titulo: 'No pudimos comunicarnos con el servidor',
            detalle: 'Revisa tu conexión y vuelve a intentarlo.',
          },
        });
        pedirFoco('aviso');
      } finally {
        corriendo.current = false;
        setEnMarcha(null);
      }
    });
  }

  /** Valida en el navegador con el mismo esquema que el servidor. */
  function borradorValido(): Borrador | null {
    const b = aBorrador(datosDe(store));
    const v = esquemaBorrador.safeParse(b);
    if (!v.success) {
      setErrores(erroresDelBorrador(v.error));
      setAviso({ tono: 'error', mensaje: REVISA });
      pedirFoco('aviso');
      return null;
    }
    setErrores({});
    return b;
  }

  function mostrarError(r: ResultadoError, ofrecerNueva = false) {
    const errores = r.errores ?? {};
    setErrores(errores);
    setAviso({ tono: 'error', mensaje: r.mensaje, extra: erroresSinCampo(errores), ofrecerNueva });
    pedirFoco('aviso');
  }

  /** Error de `emitir` (ensayo o emisión): bloquea, suelta el borrador o solo lo muestra. */
  function manejarErrorEmision(r: ResultadoError, ambienteEmision: Borrador['ambiente']) {
    const reaccion = reaccionAError(r);
    if (reaccion.soltarBorrador) store.getState().fijarBorradorId(null);
    if (reaccion.tipo === 'incierta') {
      store.getState().marcarIncierta({
        ambiente: ambienteEmision,
        documentoId: r.documento?.id ?? null,
        folio: r.documento?.folio ?? null,
        trackId: r.documento?.trackId ?? null,
        en: new Date().toISOString(),
      });
      setErrores({});
      setMensajeIncierto(r.mensaje);
      setAviso(null);
      pedirFoco('incierta');
      return;
    }
    mostrarError(r, reaccion.ofrecerNueva);
  }

  function prepararEmision() {
    if (corriendo.current || bloqueo) return;
    setAviso(null);
    const borrador = borradorValido();
    if (!borrador) return;
    const id = store.getState().borradorId;
    correr('ensayo', async () => {
      const r = await emitir(slug, empresaId, {
        nivel: 'ensayo',
        borrador,
        ...(id ? { borradorId: id } : {}),
      });
      if (r.tipo === 'ensayo') setEnsayo({ resumen: r.resumen, borrador, borradorId: id });
      else if (r.tipo === 'error') manejarErrorEmision(r, borrador.ambiente);
    });
  }

  function confirmarEmision() {
    if (!ensayo) return;
    const e = ensayo;
    correr('emitir', async () => {
      let r: ResultadoEmision;
      try {
        r = await emitir(slug, empresaId, {
          nivel: 'emitir',
          borrador: e.borrador,
          ...(e.borradorId ? { borradorId: e.borradorId } : {}),
        });
      } catch {
        // Se cortó la comunicación (red, tiempo de la función): el servidor pudo haber
        // emitido igual. Se trata como por verificar, nunca como «inténtalo de nuevo».
        r = {
          tipo: 'error',
          resultado: 'incierto',
          mensaje: {
            titulo: 'No sabemos si la boleta se emitió',
            detalle:
              'Se cortó la comunicación con el servidor mientras la emitíamos. Puede que haya llegado al SII.',
          },
          operacionId: null,
        };
      }
      setEnsayo(null);
      if (r.tipo === 'ok') {
        // El borrador ya es una boleta: se vacía el formulario (y la sesión) para que
        // recargar la página no la deje lista para emitirla otra vez.
        store.getState().reiniciar();
        setErrores({});
        setAviso(null);
        setErrorDescarga(null);
        setEmitido(r);
        pedirFoco('resultado');
        if (borradorEnUrl) {
          router.replace(`${ruta}?empresa=${empresaId}`, { scroll: false });
        }
        return;
      }
      if (r.tipo === 'error') manejarErrorEmision(r, e.borrador.ambiente);
    });
  }

  function guardar() {
    if (corriendo.current || bloqueoGuardar) return;
    setAviso(null);
    const borrador = borradorValido();
    if (!borrador) return;
    const id = store.getState().borradorId;
    correr('guardar', async () => {
      const r = await guardarBorrador(slug, empresaId, {
        borrador,
        ...(id ? { borradorId: id } : {}),
      });
      if (r.tipo === 'borrador') {
        store.getState().fijarBorradorId(r.documentoId);
        setAviso({ tono: 'exito', mensaje: r.mensaje });
        pedirFoco('aviso');
      } else if (r.tipo === 'error') mostrarError(r);
    });
  }

  function confirmarBorrado() {
    const b = porBorrar;
    if (!b) return;
    correr('borrar', async () => {
      const r = await borrarBorrador(slug, empresaId, b.id);
      setPorBorrar(null);
      if (r.ok) {
        if (store.getState().borradorId === b.id) store.getState().fijarBorradorId(null);
        setAviso({
          tono: 'exito',
          mensaje: { titulo: 'Borrador borrado', detalle: 'Ya no aparece en tus borradores.' },
        });
      } else {
        setAviso({ tono: 'error', mensaje: r.mensaje });
      }
      pedirFoco('aviso');
    });
  }

  function descargar(archivo: ArchivoDocumento) {
    const doc = emitido?.documento;
    if (!doc || descargando) return;
    setErrorDescarga(null);
    setDescargando(archivo);
    // La ventana se abre en el clic (después de un `await` el navegador la bloquearía).
    const ventana = window.open('', '_blank');
    enlaceDocumento(slug, empresaId, doc.id, archivo)
      .then((r) => {
        if (r.ok) {
          if (ventana) {
            ventana.opener = null;
            ventana.location.href = r.url;
          } else {
            window.location.assign(r.url);
          }
        } else {
          ventana?.close();
          setErrorDescarga(r.mensaje);
        }
      })
      .catch(() => {
        ventana?.close();
        setErrorDescarga({
          titulo: 'No pudimos abrir el archivo',
          detalle: 'Revisa tu conexión y vuelve a intentarlo.',
        });
      })
      .finally(() => setDescargando(null));
  }

  function pedirNueva() {
    if (tieneContenido(datosDe(store)) || store.getState().borradorId) setNueva('normal');
    else empezarNueva();
  }

  function empezarNueva() {
    const s = store.getState();
    s.reiniciar();
    setNueva(null);
    setErrores({});
    setAviso(null);
    setMensajeIncierto(null);
    if (borradorEnUrl) router.replace(`${ruta}?empresa=${empresaId}`, { scroll: false });
  }

  function emitirOtra() {
    setEmitido(null);
    setErrorDescarga(null);
  }

  const avisoVisible = aviso ? (
    <div ref={refAviso} tabIndex={-1} className={estilos.enfocable}>
      <Alerta
        tono={aviso.tono}
        titulo={aviso.mensaje.titulo}
        accion={
          aviso.ofrecerNueva ? (
            <Boton tamano="sm" variante="secundario" onClick={pedirNueva}>
              Empezar una boleta nueva
            </Boton>
          ) : (
            <Boton tamano="sm" variante="discreto" onClick={() => setAviso(null)}>
              Cerrar
            </Boton>
          )
        }
      >
        <p>{aviso.mensaje.detalle}</p>
        {aviso.extra && aviso.extra.length > 0 ? (
          <ul className={estilos.listaAvisos}>
            {aviso.extra.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
      </Alerta>
    </div>
  ) : null;

  return (
    <>
      <p className={estilos.nota}>
        {vista.empresa.razonSocial} ·{' '}
        <span className={estilos.mono}>{formatearRut(vista.empresa.rut)}</span>
        {vista.empresa.autorizadaProduccion
          ? ' · Autorizada en producción'
          : ' · Sin autorización de producción'}
      </p>

      <div aria-live="polite" className={estilos.avisos}>
        {incierta ? (
          <AlertaIncierta
            ref={refIncierta}
            incierta={incierta}
            mensaje={mensajeIncierto}
            onRevisada={() => setNueva('incierta')}
          />
        ) : null}
        {avisoVisible}
      </div>

      {emitido ? (
        <ResultadoOk
          ref={refResultado}
          resultado={emitido}
          descargando={descargando}
          errorDescarga={errorDescarga}
          onDescargar={descargar}
          onOtra={emitirOtra}
        />
      ) : (
        <>
          <BannerAmbiente ambiente={ambiente} />
          <div className={estilos.disposicion}>
            <div className={estilos.formulario}>
              <Documento vista={vista} slug={slug} deshabilitado={ocupado} />
              <Receptor
                buscar={buscarR}
                errores={errores}
                limpiar={limpiar}
                deshabilitado={ocupado}
              />
              <Lineas
                buscar={buscarP}
                totales={totales}
                errores={errores}
                limpiar={limpiar}
                deshabilitado={ocupado}
              />
              <Descuento
                totales={totales}
                errores={errores}
                limpiar={limpiar}
                deshabilitado={ocupado}
              />
            </div>
            <Resumen
              vista={vista}
              slug={slug}
              totales={totales}
              bloqueo={bloqueo}
              bloqueoGuardar={bloqueoGuardar}
              enMarcha={enMarcha === 'borrar' ? null : enMarcha}
              ocupado={ocupado}
              onEmitir={prepararEmision}
              onGuardar={guardar}
              onNueva={pedirNueva}
            />
          </div>
        </>
      )}

      <Borradores
        borradores={vista.borradores}
        slug={slug}
        empresaId={empresaId}
        actual={borradorId}
        ocupado={ocupado}
        onBorrar={setPorBorrar}
      />

      <Dialogo
        abierto={ensayo !== null}
        onCerrar={() => setEnsayo(null)}
        onConfirmar={confirmarEmision}
        cargando={ocupado}
        variante={ensayo?.resumen.ambiente === 'produccion' ? 'peligro' : 'primario'}
        titulo={ensayo?.resumen.titulo ?? ''}
        textoConfirmar={
          enMarcha === 'emitir'
            ? 'Emitiendo en el SII…'
            : (ensayo?.resumen.textoConfirmar ?? 'Emitir')
        }
      >
        {ensayo ? <ContenidoEnsayo resumen={ensayo.resumen} /> : null}
      </Dialogo>

      <Dialogo
        abierto={nueva !== null}
        onCerrar={() => setNueva(null)}
        onConfirmar={empezarNueva}
        titulo={nueva === 'incierta' ? 'Empezar otra boleta' : 'Empezar una boleta nueva'}
        textoConfirmar={
          nueva === 'incierta' ? 'Ya la revisé: empezar otra' : 'Vaciar el formulario'
        }
        variante={nueva === 'incierta' ? 'peligro' : 'primario'}
      >
        {nueva === 'incierta' ? (
          <>
            <p>
              Hazlo solo después de revisar en el SII o en Documentos emitidos si la boleta por
              verificar llegó.
            </p>
            <p>
              Si llegó y emites otra igual, quedarán dos boletas por la misma venta. El formulario
              se vacía y vuelve a permitir emitir.
            </p>
          </>
        ) : (
          <p>
            Se borra lo que escribiste en el formulario.
            {borradorId ? ' El borrador guardado se conserva en tus borradores.' : ''}
          </p>
        )}
      </Dialogo>

      <Dialogo
        abierto={porBorrar !== null}
        onCerrar={() => setPorBorrar(null)}
        onConfirmar={confirmarBorrado}
        cargando={ocupado}
        variante="peligro"
        titulo="Borrar el borrador"
        textoConfirmar={enMarcha === 'borrar' ? 'Borrando…' : 'Borrar borrador'}
      >
        <p>
          El borrador se borra y no se puede recuperar. No afecta folios ni documentos emitidos.
        </p>
      </Dialogo>
    </>
  );
}
