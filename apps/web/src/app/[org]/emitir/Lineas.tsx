'use client';

import { ArrowDown, ArrowUp, Plus, Trash } from 'lucide-react';
import { useId } from 'react';
import {
  Autocompletado,
  Boton,
  Campo,
  Input,
  Monto,
  Select,
  Tarjeta,
} from '@/components/boleteame';
import {
  LARGO_MAXIMO_NOMBRE,
  LARGO_MAXIMO_UNIDAD,
  MAXIMO_LINEAS,
  type ProductoCatalogo,
  type Totales,
} from '@/lib/emision';
import { formatearMonto } from '@/lib/formatos';
import {
  type DescuentoFormulario,
  type LineaFormulario,
  pesosDeTexto,
  textoPesos,
  valorDescuentoDeTexto,
} from '@/stores/emision';
import { useEmisionStore } from '@/stores/ProveedorEmision';
import estilos from './emitir.module.css';
import { avisoDescuento } from './logica';

// Detalle de la boleta (líneas con autocompletado del catálogo de productos) y descuento
// global. Precios brutos, con IVA incluido (H2).

interface PropsLineas {
  buscar: (texto: string) => Promise<ProductoCatalogo[]>;
  totales: Totales;
  errores: Record<string, string>;
  limpiar: (prefijo: string) => void;
  deshabilitado: boolean;
}

const soloPesos = (v: string) => v.replace(/[^0-9.]/g, '');
const soloCantidad = (v: string) => v.replace(/[^0-9.,]/g, '');

/** Al salir del campo, el precio queda con separador de miles. */
function precioFormateado(texto: string): string {
  const n = pesosDeTexto(texto);
  return n !== undefined && Number.isFinite(n) ? textoPesos(n) : texto;
}

function ErrorCampo({ id, texto }: { id: string; texto: string | undefined }) {
  return texto ? (
    <p id={id} className={estilos.errorCampo}>
      {texto}
    </p>
  ) : null;
}

function Linea({
  linea,
  indice,
  cantidadLineas,
  bruto,
  exentaFija,
  buscar,
  errores,
  limpiar,
  deshabilitado,
}: {
  linea: LineaFormulario;
  indice: number;
  cantidadLineas: number;
  bruto: number;
  exentaFija: boolean;
  buscar: PropsLineas['buscar'];
  errores: Record<string, string>;
  limpiar: (prefijo: string) => void;
  deshabilitado: boolean;
}) {
  const id = useId();
  const cambiarLinea = useEmisionStore((s) => s.cambiarLinea);
  const usarProducto = useEmisionStore((s) => s.usarProducto);
  const quitarLinea = useEmisionStore((s) => s.quitarLinea);
  const moverLinea = useEmisionStore((s) => s.moverLinea);
  const n = indice + 1;
  const pref = `lineas.${indice}`;
  const err = (campo: string) => errores[`${pref}.${campo}`];
  const desc = (campo: string) => (err(campo) ? `${id}-${campo}-error` : undefined);

  return (
    <li>
      <fieldset className={estilos.linea}>
        <legend className={estilos.leyendaLinea}>Línea {n}</legend>

        <div className={`${estilos.celda} ${estilos.cNombre}`}>
          <label htmlFor={`${id}-nombre`} className={estilos.etiquetaLinea}>
            Producto o servicio, línea {n}
          </label>
          <Autocompletado<ProductoCatalogo>
            id={`${id}-nombre`}
            value={linea.nombre}
            onChange={(v) => {
              cambiarLinea(linea.id, { nombre: v });
              limpiar(`${pref}.nombre`);
            }}
            buscar={buscar}
            onElegir={(p) => {
              usarProducto(linea.id, p);
              limpiar(pref);
            }}
            claveOpcion={(p) => p.id}
            renderOpcion={(p) => (
              <span className={estilos.opcionCatalogo}>
                <span className={estilos.opcionCatalogoFila}>
                  <span>{p.nombre}</span>
                  <span className={estilos.mono}>{formatearMonto(p.precio)}</span>
                </span>
                <span className={estilos.opcionCatalogoDetalle}>
                  {[p.codigo, p.unidad, p.exento ? 'Exento' : null].filter(Boolean).join(' · ') ||
                    'Con IVA'}
                </span>
              </span>
            )}
            sinResultados="No hay productos que coincidan. Puedes escribir el nombre igual."
            maxLength={LARGO_MAXIMO_NOMBRE}
            aria-invalid={err('nombre') ? true : undefined}
            aria-describedby={desc('nombre')}
            disabled={deshabilitado}
          />
          <ErrorCampo id={`${id}-nombre-error`} texto={err('nombre')} />
        </div>

        <div className={`${estilos.celda} ${estilos.cCantidad}`}>
          <label htmlFor={`${id}-cantidad`} className={estilos.etiquetaLinea}>
            Cantidad, línea {n}
          </label>
          <Input
            id={`${id}-cantidad`}
            mono
            inputMode="decimal"
            className={estilos.numero}
            value={linea.cantidad}
            onChange={(e) => {
              cambiarLinea(linea.id, { cantidad: soloCantidad(e.target.value) });
              limpiar(`${pref}.cantidad`);
            }}
            aria-invalid={err('cantidad') ? true : undefined}
            aria-describedby={desc('cantidad')}
            disabled={deshabilitado}
          />
          <ErrorCampo id={`${id}-cantidad-error`} texto={err('cantidad')} />
        </div>

        <div className={`${estilos.celda} ${estilos.cUnidad}`}>
          <label htmlFor={`${id}-unidad`} className={estilos.etiquetaLinea}>
            Unidad, línea {n}
          </label>
          <Input
            id={`${id}-unidad`}
            value={linea.unidad}
            maxLength={LARGO_MAXIMO_UNIDAD}
            placeholder="un"
            onChange={(e) => {
              cambiarLinea(linea.id, { unidad: e.target.value });
              limpiar(`${pref}.unidad`);
            }}
            aria-invalid={err('unidad') ? true : undefined}
            aria-describedby={desc('unidad')}
            disabled={deshabilitado}
          />
          <ErrorCampo id={`${id}-unidad-error`} texto={err('unidad')} />
        </div>

        <div className={`${estilos.celda} ${estilos.cPrecio}`}>
          <label htmlFor={`${id}-precio`} className={estilos.etiquetaLinea}>
            Precio unitario con IVA, línea {n}
          </label>
          <Input
            id={`${id}-precio`}
            mono
            inputMode="numeric"
            className={estilos.numero}
            value={linea.precio}
            placeholder="$ 0"
            onChange={(e) => {
              cambiarLinea(linea.id, { precio: soloPesos(e.target.value) });
              limpiar(`${pref}.precio`);
            }}
            onBlur={() => {
              const f = precioFormateado(linea.precio);
              if (f !== linea.precio) cambiarLinea(linea.id, { precio: f });
            }}
            aria-invalid={err('precio') ? true : undefined}
            aria-describedby={desc('precio')}
            disabled={deshabilitado}
          />
          <ErrorCampo id={`${id}-precio-error`} texto={err('precio')} />
        </div>

        <div className={`${estilos.celda} ${estilos.cExento}`}>
          <label className={estilos.casilla}>
            <input
              type="checkbox"
              checked={linea.exento}
              onChange={(e) => {
                cambiarLinea(linea.id, { exento: e.target.checked });
                limpiar(`${pref}.exento`);
              }}
              disabled={deshabilitado || exentaFija}
              aria-describedby={desc('exento')}
            />
            <span>
              Exento<span className={estilos.leyendaLinea}>, línea {n}</span>
            </span>
          </label>
          <ErrorCampo id={`${id}-exento-error`} texto={err('exento')} />
        </div>

        <div className={`${estilos.celda} ${estilos.cSubtotal}`}>
          <span className={estilos.etiquetaLinea}>Subtotal, línea {n}</span>
          <span className={estilos.subtotal}>
            <Monto valor={bruto} />
          </span>
        </div>

        <div className={`${estilos.celda} ${estilos.cAcciones}`}>
          <Boton
            tamano="sm"
            variante="discreto"
            aria-label={`Subir la línea ${n}`}
            title="Subir"
            icono={<ArrowUp size={16} strokeWidth={1.5} />}
            onClick={() => {
              moverLinea(linea.id, -1);
              limpiar('lineas');
            }}
            disabled={deshabilitado || indice === 0}
          />
          <Boton
            tamano="sm"
            variante="discreto"
            aria-label={`Bajar la línea ${n}`}
            title="Bajar"
            icono={<ArrowDown size={16} strokeWidth={1.5} />}
            onClick={() => {
              moverLinea(linea.id, 1);
              limpiar('lineas');
            }}
            disabled={deshabilitado || indice === cantidadLineas - 1}
          />
          <Boton
            tamano="sm"
            variante="discreto"
            aria-label={`Quitar la línea ${n}`}
            title="Quitar"
            icono={<Trash size={16} strokeWidth={1.5} />}
            onClick={() => {
              quitarLinea(linea.id);
              limpiar('lineas');
            }}
            disabled={
              deshabilitado || (cantidadLineas === 1 && linea.nombre === '' && linea.precio === '')
            }
          />
        </div>
      </fieldset>
    </li>
  );
}

export function Lineas({ buscar, totales, errores, limpiar, deshabilitado }: PropsLineas) {
  const lineas = useEmisionStore((s) => s.lineas);
  const tipo = useEmisionStore((s) => s.tipoDte);
  const agregarLinea = useEmisionStore((s) => s.agregarLinea);
  const exentaFija = tipo === 41;
  const errorGeneral = errores.lineas;

  return (
    <section aria-labelledby="t-detalle" className={`${estilos.seccion} ${estilos.lineas}`}>
      <div className={estilos.seccionCabecera}>
        <h2 id="t-detalle" className={estilos.subtitulo}>
          Detalle
        </h2>
        <Boton
          tamano="sm"
          variante="discreto"
          icono={<Plus size={16} strokeWidth={1.5} />}
          onClick={agregarLinea}
          disabled={deshabilitado || lineas.length >= MAXIMO_LINEAS}
        >
          Agregar línea
        </Boton>
      </div>

      <div className={estilos.encabezado} aria-hidden="true">
        <span>Producto o servicio</span>
        <span className={estilos.numero}>Cantidad</span>
        <span>Unidad</span>
        <span className={estilos.numero}>Precio con IVA</span>
        <span>Exento</span>
        <span className={estilos.numero}>Subtotal</span>
        <span />
      </div>

      <ol className={estilos.lista} aria-label="Líneas de la boleta">
        {lineas.map((l, i) => (
          <Linea
            key={l.id}
            linea={l}
            indice={i}
            cantidadLineas={lineas.length}
            bruto={totales.lineas[i]?.bruto ?? 0}
            exentaFija={exentaFija}
            buscar={buscar}
            errores={errores}
            limpiar={limpiar}
            deshabilitado={deshabilitado}
          />
        ))}
      </ol>

      {errorGeneral ? (
        <p className={estilos.errorCampo} role="alert">
          {errorGeneral}
        </p>
      ) : null}
      <p className={estilos.nota}>
        Precios con IVA incluido, como en la boleta: el neto y el IVA se calculan sobre el total.
        {exentaFija ? ' En la boleta exenta todas las líneas son exentas.' : ''}
        {lineas.length >= MAXIMO_LINEAS ? ` Llegaste al máximo de ${MAXIMO_LINEAS} líneas.` : ''}
      </p>
    </section>
  );
}

export function Descuento({
  totales,
  errores,
  limpiar,
  deshabilitado,
}: Omit<PropsLineas, 'buscar'>) {
  const descuento = useEmisionStore((s) => s.descuento);
  const cambiarDescuento = useEmisionStore((s) => s.cambiarDescuento);
  const valor = valorDescuentoDeTexto(descuento.tipo, descuento.valor);
  const aviso = avisoDescuento(
    totales,
    valor !== undefined && Number.isFinite(valor) ? { tipo: descuento.tipo, valor } : null,
  );

  return (
    <Tarjeta aria-labelledby="t-descuento" className={estilos.seccion} variante="plana">
      <h2 id="t-descuento" className={estilos.subtitulo}>
        Descuento global
      </h2>
      <div className={estilos.rejilla}>
        <Campo etiqueta="Tipo de descuento" error={errores['descuento.tipo']} anchoCompleto>
          <Select
            value={descuento.tipo}
            onChange={(e) => {
              cambiarDescuento({ tipo: e.target.value as DescuentoFormulario['tipo'] });
              limpiar('descuento');
            }}
            disabled={deshabilitado}
          >
            <option value="monto">Monto en pesos</option>
            <option value="porcentaje">Porcentaje</option>
          </Select>
        </Campo>
        <Campo
          etiqueta={descuento.tipo === 'monto' ? 'Monto del descuento' : 'Porcentaje de descuento'}
          ayuda={aviso ?? 'Opcional. Rebaja solo las líneas afectas, antes de calcular el IVA.'}
          error={errores['descuento.valor']}
          anchoCompleto
        >
          <Input
            mono
            inputMode={descuento.tipo === 'monto' ? 'numeric' : 'decimal'}
            className={estilos.numero}
            placeholder={descuento.tipo === 'monto' ? '$ 0' : '0 %'}
            value={descuento.valor}
            onChange={(e) => {
              cambiarDescuento({
                valor:
                  descuento.tipo === 'monto'
                    ? soloPesos(e.target.value)
                    : soloCantidad(e.target.value),
              });
              limpiar('descuento');
            }}
            onBlur={() => {
              if (descuento.tipo !== 'monto') return;
              const f = precioFormateado(descuento.valor);
              if (f !== descuento.valor) cambiarDescuento({ valor: f });
            }}
            disabled={deshabilitado}
          />
        </Campo>
      </div>
    </Tarjeta>
  );
}
