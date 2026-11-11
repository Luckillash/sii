// Registro de los comandos, en el orden en que aparecen en la ayuda.

import { comando as declarar } from './certificacion/declarar.ts';
import { comando as descargarSet } from './certificacion/descargar-set.ts';
import { comando as enviarRcof } from './certificacion/enviar-rcof.ts';
import { comando as enviarSet } from './certificacion/enviar-set.ts';
import { comando as estadoDeclaracion } from './certificacion/estado-declaracion.ts';
import { comando as estadoEnvio } from './certificacion/estado-envio.ts';
import { comando as postular } from './certificacion/postular.ts';
import { comando as solicitarFolios } from './certificacion/solicitar-folios.ts';
import { comando as solicitarRevision } from './certificacion/solicitar-revision.ts';
import { comando as verificarPortal } from './certificacion/verificar-portal.ts';
import { comando as consultar } from './produccion/consultar.ts';
import { comando as emitir } from './produccion/emitir.ts';
import { comando as seguimiento } from './produccion/seguimiento.ts';
import type { DefinicionComando } from './tipos.ts';
import { comando as firmarSemilla } from './util/firmar-semilla.ts';
import { comando as verificarTed } from './util/verificar-ted.ts';

export const COMANDOS: readonly DefinicionComando[] = [
  // Flujo de certificación, en el orden en que se usa.
  postular,
  descargarSet,
  solicitarFolios,
  enviarSet,
  estadoEnvio,
  solicitarRevision,
  verificarPortal,
  estadoDeclaracion,
  declarar,
  enviarRcof,
  emitir,
  consultar,
  seguimiento,
  firmarSemilla,
  verificarTed,
];
