import type * as React from 'react';

export type EstadoDte = 'borrador' | 'firmado' | 'enviado' | 'aceptado' | 'reparos' | 'rechazado' | 'anulado' | 'incierto';
export type CodigoDte = 33 | 34 | 39 | 41 | 43 | 46 | 52 | 56 | 61 | 110 | 111 | 112;
export type Tono = 'info' | 'exito' | 'aviso' | 'error';

export interface BotonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** primario: una sola acción principal por pantalla. Por defecto 'secundario'. */
  variante?: 'primario' | 'secundario' | 'discreto' | 'peligro';
  tamano?: 'md' | 'sm';
  /** Ícono Lucide de 16px antes del texto. */
  icono?: React.ReactNode;
  children?: React.ReactNode;
}
export declare function Boton(props: BotonProps): React.ReactElement;

export interface EstadoDTEProps {
  estado: EstadoDte;
  /** Texto del tooltip: glosa del SII, Track ID, fecha. */
  detalle?: string;
  className?: string;
}
export declare function EstadoDTE(props: EstadoDTEProps): React.ReactElement;

export interface TipoDTEProps {
  codigo: CodigoDte | number;
  /** Nombre corto ("Factura") en vez del oficial ("Factura electrónica"). */
  corto?: boolean;
  /** Solo el código; el nombre queda para lectores de pantalla y tooltip. */
  soloCodigo?: boolean;
  className?: string;
}
export declare function TipoDTE(props: TipoDTEProps): React.ReactElement;

export interface MontoProps {
  valor: number;
  /** Por defecto 'CLP' (sin decimales). USD, UF u otro código: dos decimales con coma. */
  moneda?: 'CLP' | 'USD' | 'UF' | string;
  destacado?: boolean;
  tenue?: boolean;
  className?: string;
}
export declare function Monto(props: MontoProps): React.ReactElement;

export interface CampoRutProps {
  etiqueta?: string;
  value?: string;
  defaultValue?: string;
  /** Recibe el texto y si el dígito verificador es válido. */
  onChange?: (valor: string, valido: boolean) => void;
  ayuda?: string;
  /** Error externo (p. ej. "El receptor no está inscrito como contribuyente"). */
  error?: string;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  className?: string;
}
export declare const CampoRut: ((props: CampoRutProps) => React.ReactElement) & {
  formatear(rut: string): string;
  validar(rut: string): boolean;
};

export interface AlertaProps {
  tono?: Tono;
  titulo?: React.ReactNode;
  children?: React.ReactNode;
  /** Un Boton secundario o discreto, alineado a la derecha. */
  accion?: React.ReactNode;
  className?: string;
}
export declare function Alerta(props: AlertaProps): React.ReactElement;

export interface MedidorFoliosProps {
  /** Tipo de DTE del CAF. */
  codigo?: CodigoDte | number;
  /** Primer folio del rango autorizado en el CAF. */
  desde: number;
  /** Último folio del rango autorizado. */
  hasta: number;
  /** Próximo folio que se asignará. */
  siguiente: number;
  /** Fracción restante bajo la cual se avisa. Por defecto 0.15. */
  umbralAviso?: number;
  className?: string;
}
export declare function MedidorFolios(props: MedidorFoliosProps): React.ReactElement;

export interface DocumentoFila {
  id: string;
  tipo: CodigoDte | number;
  folio: number;
  receptor: string;
  rut: string;
  /** Ya formateada: '10-11-2026'. */
  fecha: string;
  total: number;
  moneda?: string;
  estado: EstadoDte;
}
export interface TablaDTEProps {
  documentos: DocumentoFila[];
  titulo?: string;
  seleccionado?: string | null;
  onSeleccionar?: (id: string) => void;
  vacio?: React.ReactNode;
  className?: string;
}
export declare function TablaDTE(props: TablaDTEProps): React.ReactElement;

declare global {
  interface Window {
    Boleteame: {
      Boton: typeof Boton; EstadoDTE: typeof EstadoDTE; TipoDTE: typeof TipoDTE; Monto: typeof Monto;
      CampoRut: typeof CampoRut; Alerta: typeof Alerta; MedidorFolios: typeof MedidorFolios; TablaDTE: typeof TablaDTE;
      utils: {
        formatearMonto(valor: number, moneda?: string): string;
        formatearRut(rut: string): string;
        validarRut(rut: string): boolean;
        calcularDv(cuerpo: string): string;
        TIPOS_DTE: Record<number, [string, string]>;
      };
    };
  }
}
