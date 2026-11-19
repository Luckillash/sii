import type { EstadoEntregaWebhook } from '@/lib/api-publica';
import estilos from '../api/api.module.css';

/** Color del estado de una entrega (texto; la etiqueta sale de `ETIQUETA_ESTADO_ENTREGA`). */
export function claseEstadoEntrega(estado: EstadoEntregaWebhook): string | undefined {
  switch (estado) {
    case 'entregado':
      return estilos.estadoActivo;
    case 'fallido':
      return estilos.estadoAviso;
    case 'descartado':
      return estilos.estadoError;
    default:
      return estilos.estadoInactivo;
  }
}
