import {
  ALCANCES_OFRECIDOS,
  type Alcance,
  CABECERA_IDEMPOTENCIA,
  CABECERA_REPETIDA,
  CABECERAS_WEBHOOK,
  CODIGOS_ERROR,
  type CodigoError,
  DESCRIPCION_ALCANCE,
  DESCRIPCION_EVENTO,
  EVENTO_PRUEBA,
  EVENTOS_WEBHOOK,
  LIMITE_LOTE,
  LIMITE_PAGINA,
  LIMITE_PAGINA_MAXIMO,
  MAX_INTENTOS_WEBHOOK,
  MAXIMO_CUERPO_BYTES,
  MENSAJES_ERROR,
  RUTA_DOCS_API,
  TOLERANCIA_FIRMA_S,
  URL_API,
} from './api-publica';
import { CANTIDAD_MAXIMA } from './folios';

// Especificación OpenAPI 3.1 de la API pública v1 (PLAN-SAAS Fase 11). Un objeto TS puro:
// lo sirve `app/api/v1/openapi.json/route.ts` y lo recorre la página `/docs/api`, así que
// la documentación y la especificación no se separan. Toma alcances, códigos de error,
// cabeceras y límites del contrato `api-publica.ts`.
//
// Extensiones propias (las ignoran los visores de OpenAPI):
//   x-alcance  alcance que exige la operación (o null si es pública)
//   x-errores  códigos de error que puede devolver (las respuestas de error salen de aquí)
//   x-ejemplo  petición de ejemplo con curl

type Esquema = Record<string, unknown>;

export interface ParametroOpenApi {
  name: string;
  in: 'path' | 'query' | 'header';
  required?: boolean;
  description: string;
  schema: Esquema;
}

export interface RespuestaOpenApi {
  description: string;
  headers?: Record<string, { description: string; schema: Esquema }>;
  content?: Record<string, { schema: Esquema }>;
}

export interface OperacionOpenApi {
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  security?: Record<string, string[]>[];
  parameters?: ParametroOpenApi[];
  requestBody?: { required: boolean; content: Record<string, { schema: Esquema }> };
  responses: Record<string, RespuestaOpenApi>;
  'x-alcance': Alcance | null;
  'x-errores': CodigoError[];
  'x-ejemplo': string;
}

export type MetodoOpenApi = 'get' | 'post';
export type RutaOpenApi = Partial<Record<MetodoOpenApi, OperacionOpenApi>>;

const ref = (nombre: string): Esquema => ({ $ref: `#/components/schemas/${nombre}` });
const json = (schema: Esquema) => ({ 'application/json': { schema } });

const CLAVE_EJEMPLO = 'sk_test_…';

// --- Parámetros comunes -----------------------------------------------------------

const P_ID: ParametroOpenApi = {
  name: 'id',
  in: 'path',
  required: true,
  description: 'Id (UUID) del recurso.',
  schema: { type: 'string', format: 'uuid' },
};

const P_EMPRESA: ParametroOpenApi = {
  name: 'empresa',
  in: 'query',
  description:
    'RUT (76354771-K, con o sin puntos) o id de la empresa. Obligatorio solo si la API key sirve para todas las empresas y la operación es por empresa.',
  schema: { type: 'string' },
};

const P_IDEMPOTENCIA: ParametroOpenApi = {
  name: CABECERA_IDEMPOTENCIA,
  in: 'header',
  required: true,
  description:
    'Clave única por boleta (1 a 200 caracteres ASCII visibles). Repetir la petición con la misma clave devuelve la misma respuesta sin volver a emitir.',
  schema: { type: 'string', pattern: '^[!-~]{1,200}$' },
};

const P_LIMITE: ParametroOpenApi = {
  name: 'limite',
  in: 'query',
  description: `Resultados por página (1 a ${LIMITE_PAGINA_MAXIMO}; ${LIMITE_PAGINA} por defecto).`,
  schema: { type: 'integer', minimum: 1, maximum: LIMITE_PAGINA_MAXIMO, default: LIMITE_PAGINA },
};

const P_CURSOR: ParametroOpenApi = {
  name: 'cursor',
  in: 'query',
  description: 'Valor de siguiente_cursor de la página anterior, sin cambiarlo.',
  schema: { type: 'string' },
};

// --- Esquemas ---------------------------------------------------------------------

const ESTADOS_DOCUMENTO = [
  'borrador',
  'firmado',
  'enviado',
  'aceptado',
  'aceptado_con_reparos',
  'rechazado',
  'incierto',
  'anulado',
];

const AMBIENTE_OPCIONAL: Esquema = {
  type: 'string',
  enum: ['certificacion', 'produccion'],
  description:
    'Opcional. Si viene, tiene que ser el ambiente de la API key (sk_test_ = certificacion).',
};

const esquemas: Record<string, Esquema> = {
  Error: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'object',
        required: ['codigo', 'mensaje'],
        properties: {
          codigo: { type: 'string', enum: Object.keys(CODIGOS_ERROR) },
          mensaje: { type: 'string', description: 'Qué pasó y qué hacer, en español.' },
          campos: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Errores por campo (ruta en snake_case, por ejemplo lineas.0.precio).',
          },
          documento: ref('Documento'),
          operacion_pendiente_id: { type: 'string', format: 'uuid' },
        },
      },
    },
  },
  EmpresaRef: {
    type: 'object',
    required: ['id', 'rut', 'razon_social'],
    properties: {
      id: { type: 'string', format: 'uuid' },
      rut: { type: 'string', examples: ['76354771-K'] },
      razon_social: { type: 'string' },
    },
  },
  Linea: {
    type: 'object',
    required: ['nro', 'nombre', 'cantidad', 'precio', 'exento', 'descuento', 'monto'],
    properties: {
      nro: { type: 'integer' },
      nombre: { type: 'string' },
      cantidad: { type: 'number' },
      unidad: { type: ['string', 'null'] },
      precio: { type: 'integer', description: 'Precio unitario bruto (IVA incluido), en pesos.' },
      exento: { type: 'boolean' },
      descuento: { type: 'integer' },
      monto: { type: 'integer' },
    },
  },
  Documento: {
    type: 'object',
    required: [
      'objeto',
      'id',
      'empresa',
      'ambiente',
      'tipo_dte',
      'folio',
      'estado',
      'fecha_emision',
      'receptor',
      'totales',
      'envio',
      'origen',
      'clave_idempotencia',
      'creado_en',
      'actualizado_en',
    ],
    properties: {
      objeto: { const: 'documento' },
      id: { type: 'string', format: 'uuid' },
      empresa: ref('EmpresaRef'),
      ambiente: { type: 'string', enum: ['certificacion', 'produccion'] },
      tipo_dte: { type: 'integer', enum: [39, 41] },
      folio: { type: ['integer', 'null'] },
      estado: { type: 'string', enum: ESTADOS_DOCUMENTO },
      fecha_emision: { type: 'string', format: 'date' },
      receptor: {
        type: 'object',
        properties: {
          rut: { type: 'string' },
          razon_social: { type: ['string', 'null'] },
          correo: { type: ['string', 'null'] },
        },
      },
      totales: {
        type: 'object',
        properties: {
          neto: { type: 'integer' },
          exento: { type: 'integer' },
          iva: { type: 'integer' },
          total: { type: 'integer' },
          descuento: { type: 'integer' },
        },
      },
      lineas: {
        type: 'array',
        items: ref('Linea'),
        description: 'Solo en el detalle y en la respuesta de la emisión.',
      },
      envio: {
        type: ['object', 'null'],
        properties: {
          id: { type: 'string', format: 'uuid' },
          track_id: { type: ['string', 'null'] },
          estado_sii: { type: ['string', 'null'] },
        },
      },
      origen: { type: 'string', enum: ['panel', 'api', 'cli', 'set_pruebas'] },
      clave_idempotencia: { type: ['string', 'null'] },
      aviso: {
        type: 'object',
        description: 'Solo cuando el resultado no es definitivo (incierto, firmado sin envío).',
        properties: { titulo: { type: 'string' }, detalle: { type: 'string' } },
      },
      creado_en: { type: 'string', format: 'date-time' },
      actualizado_en: { type: 'string', format: 'date-time' },
    },
  },
  ListaDocumentos: {
    type: 'object',
    required: ['objeto', 'datos', 'tiene_mas', 'siguiente_cursor'],
    properties: {
      objeto: { const: 'lista' },
      datos: { type: 'array', items: ref('Documento') },
      tiene_mas: { type: 'boolean' },
      siguiente_cursor: { type: ['string', 'null'] },
    },
  },
  EntradaLinea: {
    type: 'object',
    additionalProperties: false,
    required: ['nombre', 'cantidad', 'precio'],
    properties: {
      nombre: { type: 'string', maxLength: 80 },
      cantidad: { type: 'number', exclusiveMinimum: 0, description: 'Hasta 3 decimales.' },
      precio: {
        type: 'integer',
        minimum: 0,
        description: 'Precio unitario BRUTO (IVA incluido), en pesos enteros.',
      },
      exento: {
        type: 'boolean',
        default: false,
        description: 'En la boleta exenta (41) todas las líneas son exentas.',
      },
      unidad: { type: ['string', 'null'], maxLength: 4 },
    },
  },
  EntradaEmision: {
    type: 'object',
    additionalProperties: false,
    required: ['tipo_dte', 'lineas'],
    properties: {
      empresa: {
        type: 'string',
        description: 'RUT o id de la empresa. Obligatorio si la API key sirve para todas.',
      },
      ambiente: AMBIENTE_OPCIONAL,
      tipo_dte: { type: 'integer', enum: [39, 41] },
      receptor: {
        type: ['object', 'null'],
        additionalProperties: false,
        description:
          'Opcional: sin receptor (o con rut vacío) se usa 66666666-6 «Cliente General».',
        properties: {
          rut: { type: ['string', 'null'] },
          razon_social: { type: ['string', 'null'], maxLength: 100 },
          correo: {
            type: ['string', 'null'],
            description: 'Si viene, se le envía el PDF por correo.',
          },
        },
      },
      lineas: { type: 'array', minItems: 1, maxItems: 100, items: ref('EntradaLinea') },
      descuento: {
        type: ['object', 'null'],
        additionalProperties: false,
        required: ['tipo', 'valor'],
        properties: {
          tipo: { type: 'string', enum: ['monto', 'porcentaje'] },
          valor: { type: 'number', minimum: 0 },
          glosa: { type: ['string', 'null'], maxLength: 45 },
        },
      },
    },
  },
  EntradaLote: {
    type: 'object',
    additionalProperties: false,
    required: ['documentos'],
    properties: {
      documentos: {
        type: 'array',
        minItems: 1,
        maxItems: LIMITE_LOTE,
        items: ref('EntradaEmision'),
      },
    },
  },
  ResultadoLote: {
    type: 'object',
    required: ['objeto', 'resultados', 'procesados', 'pendientes'],
    properties: {
      objeto: { const: 'lote' },
      resultados: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            indice: { type: 'integer' },
            clave_idempotencia: { type: 'string', description: '<Idempotency-Key>#<n>' },
            status: { type: ['integer', 'null'], description: 'null si quedó pendiente.' },
            repetida: { type: 'boolean' },
            documento: ref('Documento'),
            error: { $ref: '#/components/schemas/Error/properties/error' },
          },
        },
      },
      procesados: { type: 'integer' },
      pendientes: {
        type: 'integer',
        description: 'Ítems que no alcanzaron: repite el lote con la misma Idempotency-Key.',
      },
    },
  },
  Caf: {
    type: 'object',
    properties: {
      id: { type: 'string', format: 'uuid' },
      folio_desde: { type: 'integer' },
      folio_hasta: { type: 'integer' },
      siguiente_folio: { type: 'integer' },
      disponibles: { type: 'integer' },
      estado: { type: 'string' },
      fecha_autorizacion: { type: 'string', format: 'date' },
    },
  },
  Folios: {
    type: 'object',
    properties: {
      objeto: { const: 'folios' },
      empresa: ref('EmpresaRef'),
      ambiente: { type: 'string', enum: ['certificacion', 'produccion'] },
      tipos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tipo_dte: { type: 'integer', enum: [39, 41] },
            disponibles: { type: 'integer' },
            total: { type: 'integer' },
            siguiente_folio: { type: ['integer', 'null'] },
            estado: { type: 'string', enum: ['ok', 'por_agotarse', 'agotado', 'sin_folios'] },
            cafs: { type: 'array', items: ref('Caf') },
          },
        },
      },
    },
  },
  EntradaSolicitudFolios: {
    type: 'object',
    additionalProperties: false,
    required: ['tipo_dte', 'cantidad', 'nivel'],
    properties: {
      empresa: { type: 'string' },
      ambiente: AMBIENTE_OPCIONAL,
      tipo_dte: { type: 'integer', enum: [39, 41] },
      cantidad: { type: 'integer', minimum: 1, maximum: CANTIDAD_MAXIMA },
      folio_inicial: {
        type: 'integer',
        minimum: 1,
        description: 'Solo si el SII lo pide (primer timbraje).',
      },
      nivel: {
        type: 'string',
        enum: ['ensayo', 'revision', 'timbrar'],
        description:
          'ensayo: valida sin salir al SII. revision: pregunta al SII qué rango asignaría, sin timbrar. timbrar: pide el CAF (en producción exige revision_id).',
      },
      revision_id: {
        type: 'string',
        format: 'uuid',
        description: 'De una revisión de la misma solicitud, de menos de 30 minutos. Un solo uso.',
      },
    },
  },
  SolicitudFolios: {
    type: 'object',
    properties: {
      objeto: { const: 'solicitud_folios' },
      nivel: { type: 'string', enum: ['ensayo', 'revision', 'timbrar'] },
      empresa: ref('EmpresaRef'),
      ambiente: { type: 'string', enum: ['certificacion', 'produccion'] },
      tipo_dte: { type: 'integer', enum: [39, 41] },
      cantidad: { type: 'integer' },
      desde: { type: ['integer', 'null'] },
      hasta: { type: ['integer', 'null'] },
      revision_id: { type: ['string', 'null'] },
      caf: { oneOf: [ref('Caf'), { type: 'null' }] },
      operacion_id: { type: ['string', 'null'] },
      aviso: {
        type: 'object',
        properties: { titulo: { type: 'string' }, detalle: { type: 'string' } },
      },
    },
  },
  Envio: {
    type: 'object',
    properties: {
      objeto: { const: 'envio' },
      id: { type: 'string', format: 'uuid' },
      empresa: ref('EmpresaRef'),
      ambiente: { type: 'string', enum: ['certificacion', 'produccion'] },
      canal: { type: 'string' },
      proposito: { type: 'string', enum: ['emision', 'set_pruebas', 'rcof'] },
      track_id: { type: ['string', 'null'] },
      estado_sii: { type: ['string', 'null'], examples: ['EPR'] },
      glosa_sii: { type: ['string', 'null'] },
      clasificacion: { type: ['string', 'null'] },
      incierto: { type: 'boolean' },
      conteos: {
        type: 'object',
        properties: {
          informados: { type: 'integer' },
          aceptados: { type: 'integer' },
          rechazados: { type: 'integer' },
          reparos: { type: 'integer' },
        },
      },
      caratula: {
        type: 'object',
        properties: {
          rut_envia: { type: 'string' },
          nro_resol: { type: 'integer' },
          fch_resol: { type: 'string', format: 'date' },
        },
      },
      documentos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            tipo_dte: { type: 'integer' },
            folio: { type: ['integer', 'null'] },
            estado: { type: 'string', enum: ESTADOS_DOCUMENTO },
          },
        },
      },
      rechazos: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            tipo_dte: { type: 'integer' },
            folio: { type: 'integer' },
            documento_id: { type: ['string', 'null'] },
            estado: { type: 'string' },
            tipo_observacion: { type: 'string' },
            descripcion: { type: ['string', 'null'] },
            errores: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  seccion: { type: ['string', 'null'] },
                  linea: { type: ['integer', 'null'] },
                  nivel: { type: ['string', 'null'] },
                  codigo: { type: ['string', 'null'] },
                  descripcion: { type: ['string', 'null'] },
                  detalle: { type: ['string', 'null'] },
                },
              },
            },
          },
        },
      },
      consultas: { type: 'integer' },
      enviado_en: { type: ['string', 'null'], format: 'date-time' },
      ultima_consulta_en: { type: ['string', 'null'], format: 'date-time' },
      creado_en: { type: 'string', format: 'date-time' },
      actualizado_en: { type: 'string', format: 'date-time' },
    },
  },
  CuerpoWebhook: {
    type: 'object',
    required: ['id', 'evento', 'creado_en', 'datos'],
    properties: {
      id: {
        type: 'string',
        description: 'Id de la entrega, estable entre intentos: úsalo para deduplicar.',
      },
      evento: { type: 'string', enum: [...EVENTOS_WEBHOOK, EVENTO_PRUEBA] },
      creado_en: { type: 'string', format: 'date-time' },
      datos: { type: 'object', additionalProperties: true },
    },
  },
};

// --- Respuestas de error ----------------------------------------------------------

const RESPUESTA_ERROR = {
  'application/json': { schema: ref('Error') },
} as const;

/** Agrupa los códigos de error por status HTTP y arma una respuesta por status. */
export function respuestasDeError(
  codigos: readonly CodigoError[],
): Record<string, RespuestaOpenApi> {
  const porStatus = new Map<number, CodigoError[]>();
  for (const c of codigos) {
    const s = CODIGOS_ERROR[c];
    porStatus.set(s, [...(porStatus.get(s) ?? []), c]);
  }
  const salida: Record<string, RespuestaOpenApi> = {};
  for (const [status, lista] of [...porStatus].sort((a, b) => a[0] - b[0])) {
    const r: RespuestaOpenApi = {
      description: lista.map((c) => `${c}: ${MENSAJES_ERROR[c]}`).join('\n'),
      content: { ...RESPUESTA_ERROR },
    };
    if (status === 409 || status === 503 || status === 429) {
      r.headers = {
        'Retry-After': {
          description: 'Segundos que conviene esperar antes de repetir.',
          schema: { type: 'integer' },
        },
      };
    }
    salida[String(status)] = r;
  }
  return salida;
}

const ERRORES_AUTENTICACION: CodigoError[] = [
  'no_autenticado',
  'clave_invalida',
  'clave_revocada',
  'clave_vencida',
  'plan_sin_api',
  'alcance_insuficiente',
  'error_interno',
];

/**
 * 429 del Firewall de Vercel (límite por IP en /api/v1/*). Lo responde Vercel antes de
 * llegar a la app: su cuerpo no es el JSON de error de la API (puede ser HTML o vacío).
 */
const RESPUESTA_LIMITE: RespuestaOpenApi = {
  description:
    'Demasiadas peticiones: lo responde el Firewall de Vercel, no la API. El cuerpo no es JSON garantizado (no traigas error.codigo); espera unos segundos y repite (con la misma Idempotency-Key si la petición la lleva).',
};

function operacion(
  datos: Omit<OperacionOpenApi, 'responses' | 'x-errores' | 'tags'> & {
    tags?: string[];
    exito: Record<string, RespuestaOpenApi>;
    errores: CodigoError[];
  },
): OperacionOpenApi {
  const { exito, errores, ...resto } = datos;
  const todos = resto['x-alcance'] === null ? errores : [...ERRORES_AUTENTICACION, ...errores];
  const unicos = [...new Set(todos)];
  return {
    tags: resto.tags ?? [],
    ...resto,
    responses: {
      ...exito,
      ...respuestasDeError(unicos),
      ...(resto['x-alcance'] === null ? {} : { '429': RESPUESTA_LIMITE }),
    },
    'x-errores': unicos,
  };
}

const CABECERA_REPETIDA_RESPUESTA = {
  [CABECERA_REPETIDA]: {
    description: 'true si es la respuesta guardada de una petición anterior con la misma clave.',
    schema: { type: 'string', enum: ['true'] },
  },
};

// --- Rutas ------------------------------------------------------------------------

const EJEMPLO_EMISION = `curl -X POST ${URL_API}/documentos \\
  -H "Authorization: Bearer ${CLAVE_EJEMPLO}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: venta-000123" \\
  -d '{"tipo_dte":39,"lineas":[{"nombre":"Café americano","cantidad":1,"precio":1190}]}'`;

export const RUTAS_V1: Record<string, RutaOpenApi> = {
  '/documentos': {
    post: operacion({
      operationId: 'emitirDocumento',
      summary: 'Emitir una boleta',
      description:
        'Valida la boleta, asigna el folio, la timbra, la firma y la envía al SII. El resultado del SII llega después (consulta el documento o escucha documento.aceptado). Con un resultado incierto (no sabemos si llegó al SII) responde 202: no la emitas de nuevo con otra clave sin revisarla.',
      tags: ['Documentos'],
      parameters: [P_IDEMPOTENCIA],
      requestBody: { required: true, content: json(ref('EntradaEmision')) },
      exito: {
        '201': {
          description: 'Boleta emitida y enviada al SII.',
          headers: {
            Location: {
              description: 'URL del documento.',
              schema: { type: 'string' },
            },
            ...CABECERA_REPETIDA_RESPUESTA,
          },
          content: json(ref('Documento')),
        },
        '202': {
          description:
            'Resultado incierto: la boleta se firmó pero no sabemos si llegó al SII. Revísala antes de volver a emitir.',
          headers: CABECERA_REPETIDA_RESPUESTA,
          content: json(ref('Documento')),
        },
      },
      errores: [
        'json_invalido',
        'idempotencia_requerida',
        'idempotencia_invalida',
        'empresa_no_permitida',
        'plan_sin_produccion',
        'cuota_agotada',
        'no_encontrado',
        'idempotencia_en_curso',
        'operacion_en_curso',
        'incierto_sin_revisar',
        'cuerpo_muy_grande',
        'tipo_contenido',
        'datos_invalidos',
        'ambiente_no_coincide',
        'empresa_requerida',
        'empresa_inactiva',
        'idempotencia_conflicto',
        'sin_folios',
        'sin_certificado',
        'sin_resolucion',
        'sin_autorizacion',
        'rechazado_por_sii',
        'sii_no_disponible',
      ],
      'x-alcance': 'documentos:emitir',
      'x-ejemplo': EJEMPLO_EMISION,
    }),
    get: operacion({
      operationId: 'listarDocumentos',
      summary: 'Listar boletas',
      description:
        'Boletas del ambiente de la API key, de la más nueva a la más antigua, sin líneas. Sin filtro de estado no incluye borradores; con estado=borrador sí los devuelve (también los guardados desde el panel). Nunca incluye el set de pruebas de la certificación.',
      tags: ['Documentos'],
      parameters: [
        P_EMPRESA,
        { name: 'tipo_dte', in: 'query', description: '39 o 41.', schema: { type: 'integer' } },
        {
          name: 'estado',
          in: 'query',
          description: 'Uno o varios estados separados por comas (por ejemplo aceptado,rechazado).',
          schema: { type: 'string' },
        },
        {
          name: 'desde',
          in: 'query',
          description: 'Fecha de emisión desde (AAAA-MM-DD).',
          schema: { type: 'string', format: 'date' },
        },
        {
          name: 'hasta',
          in: 'query',
          description: 'Fecha de emisión hasta (AAAA-MM-DD).',
          schema: { type: 'string', format: 'date' },
        },
        { name: 'folio', in: 'query', description: 'Folio exacto.', schema: { type: 'integer' } },
        {
          name: 'receptor_rut',
          in: 'query',
          description: 'RUT del receptor.',
          schema: { type: 'string' },
        },
        {
          name: 'clave_idempotencia',
          in: 'query',
          description: 'La Idempotency-Key con que se emitió.',
          schema: { type: 'string' },
        },
        {
          name: 'origen',
          in: 'query',
          description: 'panel o api.',
          schema: { type: 'string', enum: ['panel', 'api'] },
        },
        P_LIMITE,
        P_CURSOR,
      ],
      exito: {
        '200': { description: 'Una página de boletas.', content: json(ref('ListaDocumentos')) },
      },
      errores: ['parametro_invalido', 'cursor_invalido', 'empresa_no_permitida'],
      'x-alcance': 'documentos:leer',
      'x-ejemplo': `curl "${URL_API}/documentos?estado=aceptado&limite=50" \\
  -H "Authorization: Bearer ${CLAVE_EJEMPLO}"`,
    }),
  },
  '/documentos/lote': {
    post: operacion({
      operationId: 'emitirLote',
      summary: 'Emitir varias boletas',
      description: `Hasta ${LIMITE_LOTE} boletas por petición. Todas se validan antes de emitir la primera: si una no es válida, responde 422 sin emitir ninguna. Cada boleta se emite y se envía por separado, con la clave <Idempotency-Key>#<n> (n desde 1). Si se acaba el tiempo, las que faltan quedan pendientes: repite el lote con la misma Idempotency-Key y solo se emiten esas.`,
      tags: ['Documentos'],
      parameters: [P_IDEMPOTENCIA],
      requestBody: { required: true, content: json(ref('EntradaLote')) },
      exito: {
        '200': {
          description: 'Resultado por boleta (cada una con el status que habría tenido sola).',
          content: json(ref('ResultadoLote')),
        },
      },
      errores: [
        'json_invalido',
        'idempotencia_requerida',
        'idempotencia_invalida',
        'empresa_no_permitida',
        'idempotencia_en_curso',
        'cuerpo_muy_grande',
        'tipo_contenido',
        'datos_invalidos',
        'ambiente_no_coincide',
        'empresa_requerida',
        'idempotencia_conflicto',
      ],
      'x-alcance': 'documentos:emitir',
      'x-ejemplo': `curl -X POST ${URL_API}/documentos/lote \\
  -H "Authorization: Bearer ${CLAVE_EJEMPLO}" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: cierre-caja-2026-11-18" \\
  -d '{"documentos":[{"tipo_dte":39,"lineas":[{"nombre":"Pan","cantidad":2,"precio":500}]}]}'`,
    }),
  },
  '/documentos/{id}': {
    get: operacion({
      operationId: 'verDocumento',
      summary: 'Ver una boleta',
      description:
        'La boleta con sus líneas y su envío al SII (Track ID y estado). Los rechazos y reparos con el error del SII están en GET /envios/{id}. Las boletas del set de pruebas de la certificación responden 404.',
      tags: ['Documentos'],
      parameters: [P_ID],
      exito: { '200': { description: 'La boleta.', content: json(ref('Documento')) } },
      errores: ['no_encontrado'],
      'x-alcance': 'documentos:leer',
      'x-ejemplo': `curl ${URL_API}/documentos/<id> \\
  -H "Authorization: Bearer ${CLAVE_EJEMPLO}"`,
    }),
  },
  '/documentos/{id}/xml': {
    get: operacion({
      operationId: 'descargarXml',
      summary: 'Descargar el XML',
      description: 'El DTE firmado, tal como se envió al SII (ISO-8859-1).',
      tags: ['Documentos'],
      parameters: [P_ID],
      exito: {
        '200': {
          description: 'XML del DTE.',
          content: { 'application/xml': { schema: { type: 'string' } } },
        },
      },
      errores: ['no_encontrado'],
      'x-alcance': 'documentos:leer',
      'x-ejemplo': `curl -o boleta.xml ${URL_API}/documentos/<id>/xml \\
  -H "Authorization: Bearer ${CLAVE_EJEMPLO}"`,
    }),
  },
  '/documentos/{id}/pdf': {
    get: operacion({
      operationId: 'descargarPdf',
      summary: 'Descargar el PDF',
      description: 'La representación impresa con el timbre (PDF417), en carta o rollo de 80 mm.',
      tags: ['Documentos'],
      parameters: [
        P_ID,
        {
          name: 'formato',
          in: 'query',
          description: 'carta (por defecto) o rollo.',
          schema: { type: 'string', enum: ['carta', 'rollo'], default: 'carta' },
        },
      ],
      exito: {
        '200': {
          description: 'PDF de la boleta.',
          content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
        },
      },
      errores: ['no_encontrado', 'parametro_invalido'],
      'x-alcance': 'documentos:leer',
      'x-ejemplo': `curl -o boleta.pdf "${URL_API}/documentos/<id>/pdf?formato=rollo" \\
  -H "Authorization: Bearer ${CLAVE_EJEMPLO}"`,
    }),
  },
  '/folios': {
    get: operacion({
      operationId: 'verFolios',
      summary: 'Ver los folios disponibles',
      description: 'Folios disponibles por tipo de documento en el ambiente de la API key.',
      tags: ['Folios'],
      parameters: [
        P_EMPRESA,
        { name: 'tipo_dte', in: 'query', description: '39 o 41.', schema: { type: 'integer' } },
      ],
      exito: { '200': { description: 'Folios por tipo.', content: json(ref('Folios')) } },
      errores: ['parametro_invalido', 'empresa_no_permitida', 'empresa_requerida', 'no_encontrado'],
      'x-alcance': 'folios:leer',
      'x-ejemplo': `curl ${URL_API}/folios \\
  -H "Authorization: Bearer ${CLAVE_EJEMPLO}"`,
    }),
  },
  '/folios/solicitudes': {
    post: operacion({
      operationId: 'solicitarFolios',
      summary: 'Pedir folios al SII',
      description:
        'Tres niveles: ensayo (valida sin salir al SII), revision (pregunta al SII qué rango asignaría, sin timbrar) y timbrar (pide el CAF). En producción, timbrar exige el revision_id de una revisión de menos de 30 minutos, igual que en el panel. timbrar exige Idempotency-Key.',
      tags: ['Folios'],
      parameters: [{ ...P_IDEMPOTENCIA, required: false }],
      requestBody: { required: true, content: json(ref('EntradaSolicitudFolios')) },
      exito: {
        '200': { description: 'Ensayo o revisión.', content: json(ref('SolicitudFolios')) },
        '201': { description: 'CAF timbrado.', content: json(ref('SolicitudFolios')) },
        '202': {
          description:
            'Resultado incierto: no sabemos si el SII timbró. Revisa «Folios ya autorizados» en el SII.',
          content: json(ref('SolicitudFolios')),
        },
      },
      errores: [
        'json_invalido',
        'idempotencia_requerida',
        'idempotencia_invalida',
        'empresa_no_permitida',
        'plan_sin_produccion',
        'idempotencia_en_curso',
        'operacion_en_curso',
        'incierto_sin_revisar',
        'tipo_contenido',
        'no_encontrado',
        'datos_invalidos',
        'ambiente_no_coincide',
        'empresa_requerida',
        'empresa_inactiva',
        'idempotencia_conflicto',
        'sin_certificado',
        'sin_autorizacion',
        'revision_requerida',
        'rechazado_por_sii',
        'sii_no_disponible',
      ],
      'x-alcance': 'folios:solicitar',
      'x-ejemplo': `curl -X POST ${URL_API}/folios/solicitudes \\
  -H "Authorization: Bearer ${CLAVE_EJEMPLO}" \\
  -H "Content-Type: application/json" \\
  -d '{"tipo_dte":39,"cantidad":100,"nivel":"revision"}'`,
    }),
  },
  '/envios/{id}': {
    get: operacion({
      operationId: 'verEnvio',
      summary: 'Ver un envío al SII',
      description:
        'Estado del envío (Track ID, estado del SII, conteos), sus documentos y los rechazos o reparos con el error del SII.',
      tags: ['Envíos'],
      parameters: [P_ID],
      exito: { '200': { description: 'El envío.', content: json(ref('Envio')) } },
      errores: ['no_encontrado'],
      'x-alcance': 'envios:leer',
      'x-ejemplo': `curl ${URL_API}/envios/<id> \\
  -H "Authorization: Bearer ${CLAVE_EJEMPLO}"`,
    }),
  },
  '/openapi.json': {
    get: operacion({
      operationId: 'especificacion',
      summary: 'Esta especificación',
      description: 'La especificación OpenAPI 3.1 de la API. No exige API key.',
      tags: ['General'],
      security: [],
      exito: {
        '200': {
          description: 'OpenAPI 3.1.',
          content: json({ type: 'object' }),
        },
      },
      errores: [],
      'x-alcance': null,
      'x-ejemplo': `curl ${URL_API}/openapi.json`,
    }),
  },
};

// --- Webhooks ---------------------------------------------------------------------

const CABECERAS_ENTREGA: ParametroOpenApi[] = [
  {
    name: CABECERAS_WEBHOOK.firma,
    in: 'header',
    required: true,
    description: `t=<segundos unix>,v1=<hex de HMAC-SHA256 con el secreto whsec_… sobre "<t>.<cuerpo>">. Rechaza firmas con t de más de ${TOLERANCIA_FIRMA_S} s.`,
    schema: { type: 'string' },
  },
  {
    name: CABECERAS_WEBHOOK.evento,
    in: 'header',
    required: true,
    description: 'Nombre del evento.',
    schema: { type: 'string' },
  },
  {
    name: CABECERAS_WEBHOOK.entrega,
    in: 'header',
    required: true,
    description: 'Id de la entrega (igual al id del cuerpo).',
    schema: { type: 'string' },
  },
  {
    name: CABECERAS_WEBHOOK.intento,
    in: 'header',
    required: true,
    description: `Número de intento (1 a ${MAX_INTENTOS_WEBHOOK}).`,
    schema: { type: 'integer' },
  },
];

const webhooks: Record<string, { post: Record<string, unknown> }> = Object.fromEntries(
  [...EVENTOS_WEBHOOK, EVENTO_PRUEBA].map((evento) => [
    evento,
    {
      post: {
        operationId: `webhook_${evento.replace(/\./g, '_')}`,
        summary: evento,
        description:
          evento === EVENTO_PRUEBA
            ? 'Lo envía «Enviar prueba» en Configuración → Webhooks. No se puede suscribir.'
            : DESCRIPCION_EVENTO[evento],
        parameters: CABECERAS_ENTREGA,
        requestBody: { required: true, content: json(ref('CuerpoWebhook')) },
        responses: {
          '2XX': {
            description: 'Entregado. Cualquier otra respuesta o 10 s sin respuesta se reintenta.',
          },
        },
      },
    },
  ]),
);

// --- Documento --------------------------------------------------------------------

export const ESPECIFICACION_V1 = {
  openapi: '3.1.0',
  info: {
    title: 'API de Boletéame',
    version: '1.0.0',
    description: `Emite boletas electrónicas (39 y 41) ante el SII, consulta su estado, descarga su XML y PDF, y administra folios. Documentación: https://boleteame.dev${RUTA_DOCS_API}`,
  },
  servers: [{ url: URL_API }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: 'Documentos', description: 'Emisión y consulta de boletas.' },
    { name: 'Folios', description: 'Folios (CAF) disponibles y solicitudes al SII.' },
    { name: 'Envíos', description: 'Envíos al SII y su resultado.' },
    { name: 'General' },
  ],
  paths: RUTAS_V1,
  webhooks,
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        description:
          'API key de Configuración → API: sk_test_… (certificación) o sk_live_… (producción). Alcances: ' +
          ALCANCES_OFRECIDOS.map((a) => `${a} (${DESCRIPCION_ALCANCE[a]})`).join('; '),
      },
    },
    schemas: esquemas,
  },
  'x-limites': {
    cuerpo_maximo_bytes: MAXIMO_CUERPO_BYTES,
    lote_maximo: LIMITE_LOTE,
    pagina_por_defecto: LIMITE_PAGINA,
    pagina_maxima: LIMITE_PAGINA_MAXIMO,
  },
} as const;
