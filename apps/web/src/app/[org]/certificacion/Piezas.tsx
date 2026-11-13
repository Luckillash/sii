import type { ReactNode } from 'react';
import { Alerta, Boton, Glifo, Tabla, TablaVacia, Td, Th, TipoDTE } from '@/components/boleteame';
import type { EstadoPaso, ResumenEnsayo } from '@/lib/certificacion';
import {
  formatearFecha,
  formatearFechaHora,
  formatearMiles,
  formatearMonto,
  formatearRut,
} from '@/lib/formatos';
// Solo tipos (se borran al compilar): no arrastran `server-only` al bundle.
import type { VistaAsistente } from '@/server/certificacion';
import estilos from './certificacion.module.css';
import {
  nombreOperacion,
  ordenarOperaciones,
  presentarEstadoEnvio,
  presentarResultado,
  type TonoResultado,
} from './logica';

// Piezas de presentación del asistente (sin estado). Se usan desde `Asistente`.

type Vista = VistaAsistente;

const CLASE_TONO: Readonly<Record<TonoResultado, string | undefined>> = {
  exito: estilos.tonoExito,
  info: estilos.tonoInfo,
  aviso: estilos.tonoAviso,
  error: estilos.tonoError,
};

const GLIFO_TONO: Readonly<
  Record<TonoResultado, 'aceptado' | 'enviado' | 'reparos' | 'rechazado'>
> = {
  exito: 'aceptado',
  info: 'enviado',
  aviso: 'reparos',
  error: 'rechazado',
};

/** Insignia de estado con el aspecto de `EstadoDTE` (glifo + palabra, tono semántico). */
export function Insignia({
  tono,
  glifo,
  children,
}: {
  tono: TonoResultado;
  glifo?: 'aceptado' | 'enviado' | 'incierto' | 'reparos' | 'rechazado';
  children: ReactNode;
}) {
  return (
    <span className={[estilos.insignia, CLASE_TONO[tono]].filter(Boolean).join(' ')}>
      <Glifo nombre={glifo ?? GLIFO_TONO[tono]} size={14} />
      <span>{children}</span>
    </span>
  );
}

const ETIQUETA_ESTADO_PASO: Readonly<Record<EstadoPaso, string>> = {
  completo: 'Completado',
  en_curso: 'En curso',
  pendiente: 'Pendiente',
};

/** Ícono del paso (22 px), como en la plantilla: check, punto o círculo punteado. */
export function IconoPaso({ estado }: { estado: EstadoPaso }) {
  return (
    <svg
      role="img"
      aria-label={ETIQUETA_ESTADO_PASO[estado]}
      width={22}
      height={22}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={estilos.iconoPaso}
    >
      {estado === 'completo' ? (
        <>
          <circle cx={8} cy={8} r={6.5} />
          <path d="M5.4 8.2l1.8 1.8 3.4-3.6" />
        </>
      ) : estado === 'en_curso' ? (
        <>
          <circle cx={8} cy={8} r={6.5} />
          <circle cx={8} cy={8} r={2.4} fill="currentColor" stroke="none" />
        </>
      ) : (
        <circle cx={8} cy={8} r={6.5} strokeDasharray="2.4 2.2" />
      )}
    </svg>
  );
}

/** Lista de definiciones con el aspecto de la tarjeta «Certificado digital» de la plantilla. */
export function Datos({
  filas,
}: {
  filas: { etiqueta: string; valor: ReactNode; mono?: boolean }[];
}) {
  return (
    <dl className={estilos.datos}>
      {filas.map((f) => (
        <div key={f.etiqueta} className={estilos.dato}>
          <dt>{f.etiqueta}</dt>
          <dd className={f.mono ? estilos.mono : undefined}>{f.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

const SIN_DATO = '—';

export function DatosPostulacion({ proceso }: { proceso: NonNullable<Vista['proceso']> }) {
  return (
    <Datos
      filas={[
        {
          etiqueta: 'Usuario administrador',
          valor: proceso.rutAdministrador ? formatearRut(proceso.rutAdministrador) : SIN_DATO,
          mono: true,
        },
        { etiqueta: 'Correo del administrador', valor: proceso.correoAdministrador ?? SIN_DATO },
        { etiqueta: 'Correo de contacto con el SII', valor: proceso.correoContactoSii ?? SIN_DATO },
        { etiqueta: 'Correo de intercambio', valor: proceso.correoIntercambio ?? SIN_DATO },
        { etiqueta: 'Nombre del software', valor: proceso.nombreSoftware ?? SIN_DATO },
        { etiqueta: 'Boletas exentas', valor: proceso.boletaExenta ? 'Sí' : 'No' },
        { etiqueta: 'Sitio web', valor: proceso.url || SIN_DATO },
      ]}
    />
  );
}

export function AvisosPostulacion({ avisos }: { avisos: readonly string[] }) {
  if (avisos.length === 0) return null;
  return (
    <Alerta tono="aviso" titulo="Avisos del SII en la postulación">
      <ul className={estilos.listaAvisos}>
        {avisos.map((a) => (
          <li key={a}>{a}</li>
        ))}
      </ul>
    </Alerta>
  );
}

export function TablaCasos({ casos }: { casos: Vista['casos'] }) {
  return (
    <Tabla etiqueta="Casos del set de pruebas">
      <thead>
        <tr>
          <Th num>Caso</Th>
          <Th>Tipo</Th>
          <Th>Ítems</Th>
          <Th>Boleta</Th>
        </tr>
      </thead>
      <tbody>
        {casos.length === 0 ? (
          <TablaVacia columnas={4}>
            El set todavía no tiene casos. Descárgalo en el paso 2.
          </TablaVacia>
        ) : (
          casos.map((c) => (
            <tr key={c.numero}>
              <Td num mono>
                {c.numero}
              </Td>
              <Td>
                <TipoDTE codigo={c.tipoDte} corto />
              </Td>
              <Td>
                <ul className={estilos.items}>
                  {c.detalles.map((d, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: el orden de los ítems del caso es fijo
                    <li key={i}>
                      {d.nombre}: {formatearMiles(d.cantidad)}
                      {d.unidad ? ` ${d.unidad}` : ''} × {formatearMonto(d.precio)}
                      {d.exento ? ' (exento)' : ''}
                    </li>
                  ))}
                </ul>
              </Td>
              <Td>
                {c.documentoId ? (
                  <Insignia tono="exito">Generada</Insignia>
                ) : (
                  <span className={estilos.secundario}>Se genera al enviar el set</span>
                )}
              </Td>
            </tr>
          ))
        )}
      </tbody>
    </Tabla>
  );
}

export function DatosEnvio({ envio }: { envio: NonNullable<Vista['envioSet']> }) {
  const estado = envio.incierto
    ? presentarEstadoEnvio('incierto')
    : presentarEstadoEnvio(envio.estado);
  const cifra = (n: number | null) => (n === null ? SIN_DATO : formatearMiles(n));
  return (
    <div className={estilos.bloque}>
      <Datos
        filas={[
          { etiqueta: 'Track ID', valor: envio.trackId ?? 'Sin Track ID', mono: true },
          {
            etiqueta: 'Estado',
            valor: (
              <Insignia tono={estado.tono} glifo={envio.incierto ? 'incierto' : undefined}>
                {estado.texto}
              </Insignia>
            ),
          },
          {
            etiqueta: 'Enviado',
            valor: envio.enviadoEn ? formatearFechaHora(envio.enviadoEn) : SIN_DATO,
          },
          {
            etiqueta: 'Última consulta',
            valor: envio.ultimaConsultaEn ? formatearFechaHora(envio.ultimaConsultaEn) : 'Aún no',
          },
          { etiqueta: 'Aceptadas', valor: cifra(envio.aceptados), mono: true },
          { etiqueta: 'Con reparos', valor: cifra(envio.reparos), mono: true },
          { etiqueta: 'Rechazadas', valor: cifra(envio.rechazados), mono: true },
        ]}
      />
      {envio.rechazos.length > 0 ? (
        <Tabla etiqueta="Rechazos y reparos del SII">
          <thead>
            <tr>
              <Th num>Folio</Th>
              <Th>Código</Th>
              <Th>Descripción del SII</Th>
            </tr>
          </thead>
          <tbody>
            {envio.rechazos.map((r, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: el SII puede repetir folio y código
              <tr key={i}>
                <Td num mono>
                  {r.folio ?? SIN_DATO}
                </Td>
                <Td mono>{r.codigo ?? SIN_DATO}</Td>
                <Td>{r.descripcion}</Td>
              </tr>
            ))}
          </tbody>
        </Tabla>
      ) : null}
    </div>
  );
}

/** Estado de la declaración en el SII (código, glosa y paso, p. ej. P90). */
export function EstadoSii({ proceso }: { proceso: NonNullable<Vista['proceso']> }) {
  if (!proceso.estadoConsultadoEn && !proceso.codigoEstadoSii) {
    return <p className={estilos.nota}>Aún no consultas el estado de la declaración en el SII.</p>;
  }
  return (
    <Datos
      filas={[
        {
          etiqueta: 'Estado en el SII',
          valor:
            [proceso.codigoEstadoSii, proceso.glosaEstadoSii].filter(Boolean).join(' · ') ||
            SIN_DATO,
        },
        {
          etiqueta: 'Paso',
          valor: proceso.pasoSii != null ? `P${proceso.pasoSii}` : SIN_DATO,
          mono: true,
        },
        {
          etiqueta: 'Consultado',
          valor: proceso.estadoConsultadoEn
            ? formatearFechaHora(proceso.estadoConsultadoEn)
            : SIN_DATO,
        },
      ]}
    />
  );
}

/** Últimas operaciones con el SII y su resultado (de `operaciones_sii`). */
export function ListaOperaciones({
  operaciones,
  admin,
  alRevisar,
  deshabilitado,
}: {
  operaciones: Vista['operaciones'];
  admin: boolean;
  alRevisar: (operacionId: string) => void;
  deshabilitado: boolean;
}) {
  const lista = ordenarOperaciones(operaciones).slice(0, 8);
  if (lista.length === 0) {
    return <p className={estilos.nota}>Todavía no hay operaciones con el SII para esta empresa.</p>;
  }
  return (
    <ul className={estilos.operaciones}>
      {lista.map((o) => {
        const r = presentarResultado(o.resultado);
        return (
          <li key={o.id} className={estilos.operacion}>
            <div className={estilos.operacionCabecera}>
              <span className={estilos.operacionNombre}>{nombreOperacion(o.operacion)}</span>
              <Insignia tono={r.tono} glifo={r.glifo}>
                {r.texto}
              </Insignia>
            </div>
            <span className={estilos.secundario}>
              {formatearFechaHora(o.iniciadaEn)}
              {o.resultado === 'incierto' && o.revisada ? ' · Revisada' : ''}
            </span>
            {o.mensaje ? <span className={estilos.operacionMensaje}>{o.mensaje}</span> : null}
            {admin && o.resultado === 'incierto' && !o.revisada ? (
              <Boton
                tamano="sm"
                variante="discreto"
                onClick={() => alRevisar(o.id)}
                disabled={deshabilitado}
                className={estilos.operacionAccion}
              >
                Marcar como revisada
              </Boton>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Cuerpo del `Dialogo` de una acción ⚠️: qué se enviará, con qué certificado y a qué ambiente. */
export function ContenidoEnsayo({
  resumen,
  razonSocial,
  enviando,
}: {
  resumen: ResumenEnsayo;
  razonSocial: string;
  enviando: boolean;
}) {
  const { certificado } = resumen;
  return (
    <>
      {resumen.operacion === 'declarar' ? (
        <Alerta tono="error" titulo={`Esto deja a ${razonSocial} AUTORIZADA EN PRODUCCIÓN`}>
          Desde que el SII registre la declaración, la empresa emite boletas electrónicas con
          validez tributaria y deja de estar en certificación. No se puede deshacer desde Boletéame.
        </Alerta>
      ) : null}
      <p>Revisa lo que se enviará. Nada sale al SII hasta que confirmes.</p>
      <Datos
        filas={[
          { etiqueta: 'Ambiente', valor: 'Certificación del SII' },
          {
            etiqueta: 'Certificado',
            valor: `${certificado.titular} (${formatearRut(certificado.rut)}), vence el ${formatearFecha(certificado.vigenteHasta)}`,
          },
          ...resumen.filas.map((f) => ({ etiqueta: f.etiqueta, valor: f.valor })),
        ]}
      />
      {resumen.avisos.length > 0 ? (
        <Alerta tono="aviso" titulo="Antes de confirmar">
          <ul className={estilos.listaAvisos}>
            {resumen.avisos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Alerta>
      ) : null}
      {enviando ? (
        <p className={estilos.nota} aria-live="polite">
          Enviando al SII. Puede tardar unos minutos; el resultado también quedará en «Últimas
          operaciones».
        </p>
      ) : null}
    </>
  );
}
