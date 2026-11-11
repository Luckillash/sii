-- =============================================================================
-- Esquema Supabase (PostgreSQL 15+) para un SaaS de boleta electrónica (SII Chile)
-- construido sobre @winex/certificacion (certificacion-node).
--
-- Cubre cada función de la librería y de la CLI `sii`:
--
--   Librería / CLI                                  Tablas
--   ----------------------------------------------  -----------------------------------
--   Certificado (.pfx), FirmaElectronica            certificados, empresa_certificados
--   TokenStore (REST / SOAP, por empresa,            tokens_sii
--     ambiente y huella del certificado)
--   SesionSii (cookies AUT2000, reutilizables)       sesiones_sii
--   SolicitudFolios (asistente of_*), CAF, Timbre    solicitudes_folios, cafs,
--                                                    folios_anulados, asignar_folio()
--   GeneradorBoleta, ArmadorBoleta, TED              documentos, documento_detalles
--   EnvioBoleta + ClienteBoletaRest / ClienteDtews   envios, envio_estadisticas,
--     (enviarBoleta, consultarEnvio, estadoEnvio)    envio_rechazos, consultas_envio
--   GeneradorConsumoFolios (RCOF, hasta 2022-07)     rcof
--   PostulacionSii, DeclaracionBoletas,              procesos_certificacion,
--     parsearSetPruebas, EstadoDeclaracion           set_pruebas_casos
--   Códigos de salida de la CLI (0..7), --confirmar  operaciones_sii
--   Resolución (NroResol / FchResol)                 resoluciones
--
-- Más la capa SaaS: organizaciones (tenants), miembros con roles, invitaciones,
-- planes, suscripciones, cuotas de uso, API keys, webhooks y catálogos
-- (receptores, productos).
--
-- Seguridad
--   * RLS en todas las tablas. Los usuarios (rol `authenticated`) solo ven los
--     datos de sus organizaciones. Lo que habla con el SII (firmar, timbrar,
--     enviar, consultar) lo hace un backend con `service_role`, que salta RLS.
--   * Secretos (el .pfx y su clave, el XML del CAF con su llave RSASK, el secreto
--     de cada webhook) van en Supabase Vault: las tablas solo guardan el id.
--   * Tokens del SII y cookies de sesión: cifrados por el backend (AES-256-GCM,
--     llave fuera de la base) en tablas sin ninguna política (solo service_role).
--     Regla de la librería: un token es una credencial, nunca a logs.
--
-- Montos en pesos enteros (bigint): la librería rechaza montos desde 1e15.
-- Fechas del SII en hora de Chile (America/Santiago).
--
-- Ejecutar completo en el SQL Editor de Supabase (o como migración). Es
-- idempotente solo en la primera corrida: está pensado para una base nueva.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. Tipos
-- -----------------------------------------------------------------------------

-- Ambiente del SII. certificacion: maullin / apicert / pangal (IDK 100).
-- produccion: palena / api / rahue (IDK 300). Nunca un string libre.
create type public.ambiente_sii as enum ('certificacion', 'produccion');

-- Canal de envío: API REST de boleta o DTEWS (SOAP).
create type public.canal_sii as enum ('rest', 'soap');

create type public.rol_miembro as enum ('propietario', 'administrador', 'emisor', 'lector');

create type public.estado_suscripcion as enum ('prueba', 'activa', 'morosa', 'cancelada');

create type public.estado_caf as enum ('activo', 'agotado', 'anulado');

-- Resultado de SolicitudFolios.solicitar:
--   simulada  sin --confirmar: recorrió el asistente y se detuvo antes de timbrar
--   timbrada  CAF obtenido y validado (IDK, RUT y tipo)
--   incierta  FoliosSinCafError: la orden de timbrar salió y no llegó un CAF.
--             NO reintentar: bajar el CAF desde "Folios ya autorizados".
--   rechazada ErrorSolicitudFolios / FolioInicialRequeridoError antes de timbrar
--   error     red u otro error antes de timbrar
create type public.estado_solicitud_folios as enum
  ('en_curso', 'simulada', 'timbrada', 'incierta', 'rechazada', 'error');

create type public.tipo_descuento as enum ('monto', 'porcentaje');

create type public.estado_documento as enum (
  'borrador',              -- datos cargados, sin folio
  'firmado',               -- con folio, TED y firma; aún no sale al SII
  'enviado',               -- en un envío que el SII todavía procesa
  'incierto',              -- el envío no devolvió trackId: revisar en el SII
  'aceptado',
  'aceptado_con_reparos',
  'rechazado',
  'anulado'                -- folio anulado (no se envía)
);

create type public.origen_documento as enum ('panel', 'api', 'cli', 'set_pruebas');

-- Qué lleva un envío: boletas de la operación normal, el set de pruebas de la
-- certificación (EnvioBOLETA en maullin/pangal) o un RCOF.
create type public.proposito_envio as enum ('emision', 'set_pruebas', 'rcof');

-- Clasificación de `sii produccion seguimiento`.
create type public.clasificacion_envio as enum (
  'pendiente',             -- aún sin respuesta del SII (o falló antes de subir)
  'incierto',              -- subida sin trackId: no se sabe si llegó
  'en_proceso',            -- REC, SOK, CRT, FOK, PRD
  'aceptado',              -- EPR, todos aceptados, sin reparos
  'aceptado_con_reparos',  -- EPR, sin rechazos, con reparos
  'rechazado',             -- EPR con rechazos, o RSC / RFR / RCT / RCH / otro
  'inconsistente'          -- EPR cuyos conteos no cuadran
);

create type public.tipo_observacion as enum ('rechazo', 'reparo');

create type public.etapa_certificacion as enum (
  'borrador',              -- datos de postulación sin enviar
  'postulada',             -- PostulacionSii.postular OK
  'set_descargado',        -- DeclaracionBoletas.descargarSetPruebas
  'set_enviado',           -- EnvioBOLETA del set subido
  'set_aceptado',          -- set EPR limpio
  'revision_solicitada',   -- DeclaracionBoletas.solicitarRevisionSet
  'por_declarar',          -- estado SII P90
  'autorizada'             -- estado SII P91: autorizada en producción
);

-- Operaciones de la CLI que salen al SII (y lo que el backend haga en su nombre).
create type public.operacion_sii as enum (
  'autenticar',            -- login AUT2000 con certificado
  'obtener_token',         -- semilla + token (REST o SOAP)
  'postular',
  'descargar_set',
  'solicitar_folios',
  'enviar_set',
  'estado_envio',
  'solicitar_revision',
  'verificar_portal',
  'estado_declaracion',
  'declarar',
  'enviar_rcof',
  'emitir',
  'consultar_envio',
  'seguimiento'
);

-- Códigos de salida de la CLI: 0 ok · 1 error · 2 uso · 3 config · 4 transporte
-- (reintentable) · 5 rechazo del SII · 6 incierto (revisar el SII antes de
-- repetir) · 7 verificación fallida.
create type public.resultado_operacion as enum (
  'en_curso', 'ok', 'error', 'uso', 'config', 'transporte',
  'rechazo_sii', 'incierto', 'verificacion_fallida'
);

create type public.estado_entrega_webhook as enum ('pendiente', 'entregado', 'fallido', 'descartado');

-- -----------------------------------------------------------------------------
-- 2. Validaciones reutilizables
-- -----------------------------------------------------------------------------

-- RUT con el formato del esquema del SII (RUTType): hasta 8 dígitos, guion y DV
-- con K mayúscula, y dígito verificador módulo 11 (como Rut / calcularDv).
-- STRICT: un NULL pasa (lo controla el NOT NULL de cada columna).
create function public.rut_valido(p_rut text)
returns boolean
language plpgsql
immutable strict parallel safe
set search_path = ''
as $$
declare
  v_cuerpo text;
  v_suma   integer := 0;
  v_mult   integer := 2;
  v_resto  integer;
  i        integer;
begin
  if p_rut !~ '^[0-9]{1,8}-[0-9K]$' then
    return false;
  end if;
  v_cuerpo := split_part(p_rut, '-', 1);
  for i in reverse length(v_cuerpo)..1 loop
    v_suma := v_suma + substr(v_cuerpo, i, 1)::integer * v_mult;
    v_mult := case when v_mult = 7 then 2 else v_mult + 1 end;
  end loop;
  v_resto := 11 - (v_suma % 11);
  return split_part(p_rut, '-', 2) =
    case v_resto when 11 then '0' when 10 then 'K' else v_resto::text end;
end;
$$;

create domain public.rut as text check (public.rut_valido(value));

-- Regla esValidoMail2 del SII (validarCorreo): máx. 50, ASCII imprimible sin
-- espacios, sin ! " # $ % & / ( ) = ? + * | < > [ ] ;, un solo @, sin '@.',
-- sin empezar ni terminar en '.' o '@' y con un punto después del @.
create function public.correo_sii_valido(p_correo text)
returns boolean
language sql
immutable strict parallel safe
set search_path = ''
as $$
  select length(p_correo) <= 50
     and p_correo ~ '^[!-~]+$'
     and p_correo !~ '[]!"#$%&/()=?+*|<>[;]'
     and p_correo ~ '^[^@]+@[^@]+$'
     and position('@.' in p_correo) = 0
     and left(p_correo, 1) <> '.'
     and right(p_correo, 1) <> '.'
     and position('.' in split_part(p_correo, '@', 2)) > 0;
$$;

create domain public.correo_sii as text check (public.correo_sii_valido(value));

-- Uuid desde texto sin lanzar error (para rutas de Storage).
create function public.uuid_o_nulo(p_texto text)
returns uuid
language plpgsql
immutable parallel safe
set search_path = ''
as $$
begin
  return p_texto::uuid;
exception when invalid_text_representation then
  return null;
end;
$$;

-- Clasificación de un envío, igual que `sii produccion seguimiento` y
-- EstadoEnvioRest.enProceso / procesado / limpio.
create function public.clasificar_envio(
  p_incierto boolean, p_estado text,
  p_informados integer, p_aceptados integer, p_rechazados integer, p_reparos integer
)
returns public.clasificacion_envio
language sql
immutable parallel safe
set search_path = ''
as $$
  select case
    when p_incierto then 'incierto'
    when p_estado is null or p_estado = '' then 'pendiente'
    when p_estado in ('REC', 'SOK', 'CRT', 'FOK', 'PRD') then 'en_proceso'
    when p_estado = 'EPR' then
      case
        when p_rechazados > 0 then 'rechazado'
        when p_informados > 0 and p_aceptados = p_informados and p_reparos = 0 then 'aceptado'
        when p_informados > 0 and p_reparos > 0 then 'aceptado_con_reparos'
        else 'inconsistente'
      end
    else 'rechazado'
  end::public.clasificacion_envio;
$$;

-- -----------------------------------------------------------------------------
-- 3. Catálogos
-- -----------------------------------------------------------------------------

-- Tipos de DTE que emite la librería (GeneradorBoleta: 39 por defecto, 41 exenta).
create table public.tipos_dte (
  codigo      smallint primary key,
  nombre      text not null,
  afecto_iva  boolean not null
);

insert into public.tipos_dte (codigo, nombre, afecto_iva) values
  (39, 'Boleta electrónica', true),
  (41, 'Boleta exenta electrónica', false);

-- Estados de un envío según el SII (QueryEstUp / boleta.electronica.envio).
create table public.estados_sii (
  codigo      text primary key,
  glosa       text not null,
  en_proceso  boolean not null default false,
  es_rechazo  boolean not null default false
);

insert into public.estados_sii (codigo, glosa, en_proceso, es_rechazo) values
  ('REC', 'Recibido', true, false),
  ('SOK', 'Esquema validado', true, false),
  ('CRT', 'Carátula validada', true, false),
  ('FOK', 'Firma validada', true, false),
  ('PRD', 'En proceso', true, false),
  ('EPR', 'Envío procesado', false, false),
  ('RSC', 'Rechazado por error en el esquema', false, true),
  ('RFR', 'Rechazado por error en la firma', false, true),
  ('RCT', 'Rechazado por error en la carátula', false, true),
  ('RCH', 'Rechazado', false, true);

-- Planes del SaaS. NULL en un límite = ilimitado. Valores de ejemplo.
create table public.planes (
  id                   uuid primary key default gen_random_uuid(),
  codigo               text not null unique,
  nombre               text not null,
  precio_mensual_clp   integer not null default 0 check (precio_mensual_clp >= 0),
  max_empresas         integer check (max_empresas > 0),
  max_usuarios         integer check (max_usuarios > 0),
  max_boletas_mes      integer check (max_boletas_mes >= 0),
  permite_produccion   boolean not null default true,
  incluye_api          boolean not null default false,
  incluye_webhooks     boolean not null default false,
  activo               boolean not null default true,
  creado_en            timestamptz not null default now()
);

insert into public.planes
  (codigo, nombre, precio_mensual_clp, max_empresas, max_usuarios, max_boletas_mes,
   permite_produccion, incluye_api, incluye_webhooks) values
  ('certificacion', 'Certificación',      0,  1,  2,    0, false, false, false),
  ('emprendedor',   'Emprendedor',     9990,  1,  2,  500, true,  false, false),
  ('pyme',          'Pyme',           24990,  3,  5, 3000, true,  true,  true),
  ('empresa',       'Empresa',        79990, null, null, null, true, true, true);

-- -----------------------------------------------------------------------------
-- 4. Tenancy: perfiles, organizaciones, miembros, invitaciones, suscripciones
-- -----------------------------------------------------------------------------

create table public.perfiles (
  id             uuid primary key references auth.users (id) on delete cascade,
  nombre         text,
  correo         text,
  rut            public.rut,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

-- Cliente del SaaS (tenant). Puede administrar varias empresas emisoras
-- (p. ej. un estudio contable).
create table public.organizaciones (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null check (length(trim(nombre)) > 0),
  slug           text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  creado_por     uuid references auth.users (id) on delete set null,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table public.miembros_organizacion (
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  usuario_id      uuid not null references auth.users (id) on delete cascade,
  rol             public.rol_miembro not null default 'lector',
  creado_en       timestamptz not null default now(),
  primary key (organizacion_id, usuario_id)
);

create index on public.miembros_organizacion (usuario_id);

create table public.invitaciones (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  correo          text not null check (correo = lower(correo) and position('@' in correo) > 1),
  rol             public.rol_miembro not null default 'lector' check (rol <> 'propietario'),
  -- sha256 (hex) del token que va en el enlace; el token nunca se guarda.
  token_hash      text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invitado_por    uuid references auth.users (id) on delete set null,
  expira_en       timestamptz not null default now() + interval '7 days',
  aceptada_en     timestamptz,
  creado_en       timestamptz not null default now()
);

create unique index invitaciones_pendiente_unica
  on public.invitaciones (organizacion_id, correo) where aceptada_en is null;

create table public.suscripciones (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  plan_id          uuid not null references public.planes (id),
  estado           public.estado_suscripcion not null default 'prueba',
  periodo_inicio   timestamptz not null default now(),
  periodo_fin      timestamptz,
  proveedor_pago   text,           -- 'flow', 'mercadopago', 'stripe'...
  id_externo       text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now()
);

-- Una sola suscripción vigente por organización.
create unique index suscripciones_vigente_unica
  on public.suscripciones (organizacion_id) where estado in ('prueba', 'activa', 'morosa');

-- Contadores de uso por mes calendario (hora de Chile), para cuotas y cobro.
create table public.uso_mensual (
  organizacion_id     uuid not null references public.organizaciones (id) on delete cascade,
  periodo             date not null check (extract(day from periodo) = 1),
  boletas_produccion  integer not null default 0,
  boletas_certificacion integer not null default 0,
  envios              integer not null default 0,
  folios_timbrados    integer not null default 0,
  primary key (organizacion_id, periodo)
);

-- -----------------------------------------------------------------------------
-- 5. Funciones de acceso (RLS)
-- -----------------------------------------------------------------------------

create function public.es_miembro(p_organizacion uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.miembros_organizacion m
    where m.organizacion_id = p_organizacion
      and m.usuario_id = (select auth.uid())
  );
$$;

create function public.tiene_rol(p_organizacion uuid, p_roles public.rol_miembro[])
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.miembros_organizacion m
    where m.organizacion_id = p_organizacion
      and m.usuario_id = (select auth.uid())
      and m.rol = any (p_roles)
  );
$$;

create function public.es_admin(p_organizacion uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select public.tiene_rol(p_organizacion, '{propietario,administrador}');
$$;

create function public.puede_emitir(p_organizacion uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select public.tiene_rol(p_organizacion, '{propietario,administrador,emisor}');
$$;

create function public.comparte_organizacion(p_usuario uuid)
returns boolean
language sql
stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.miembros_organizacion yo
    join public.miembros_organizacion otro using (organizacion_id)
    where yo.usuario_id = (select auth.uid()) and otro.usuario_id = p_usuario
  );
$$;

-- -----------------------------------------------------------------------------
-- 6. Empresas emisoras y credenciales
-- -----------------------------------------------------------------------------

-- Contribuyente que emite (EmisorBoleta + datos de la carátula).
create table public.empresas (
  id                     uuid primary key default gen_random_uuid(),
  organizacion_id        uuid not null references public.organizaciones (id) on delete cascade,
  rut                    public.rut not null,                       -- <RUTEmisor>
  razon_social           text not null check (length(razon_social) between 1 and 100),  -- <RznSocEmisor>
  giro                   text not null check (length(giro) between 1 and 80),           -- <GiroEmisor>, sin abreviaciones
  direccion              text not null check (length(direccion) between 1 and 70),      -- <DirOrigen>
  comuna                 text not null check (length(comuna) between 1 and 20),         -- <CmnaOrigen>
  correo_intercambio     public.correo_sii,
  -- Se marca cuando EstadoDeclaracion.autorizada() (P91). Sin esto no se emite en producción.
  autorizada_produccion  boolean not null default false,
  autorizada_en          timestamptz,
  activa                 boolean not null default true,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),
  unique (organizacion_id, rut)
);

comment on table public.empresas is
  'Empresa emisora (contribuyente). Un mismo RUT puede estar en más de una organización (p. ej. la empresa y su contador).';

-- Resolución del SII que va en la carátula (<NroResol>, <FchResol>).
-- En certificación el número es 0 y la fecha la entrega el SII.
create table public.resoluciones (
  id              uuid primary key default gen_random_uuid(),
  organizacion_id uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id      uuid not null references public.empresas (id) on delete cascade,
  ambiente        public.ambiente_sii not null,
  numero          integer not null check (numero >= 0),
  fecha           date not null,
  vigente         boolean not null default true,
  creado_en       timestamptz not null default now(),
  check (ambiente = 'produccion' or numero = 0)
);

create unique index resoluciones_vigente_unica
  on public.resoluciones (empresa_id, ambiente) where vigente;

-- Certificado digital (.pfx) de una persona. El .pfx (base64) y su clave van
-- en Vault; aquí solo la información pública (InfoCertificado) y la huella.
create table public.certificados (
  id                   uuid primary key default gen_random_uuid(),
  organizacion_id      uuid not null references public.organizaciones (id) on delete cascade,
  rut_titular          public.rut not null,                 -- <RutEnvia> / quien firma
  nombre_titular       text,
  cn                   text,
  emisor_ca            text,
  vigente_desde        timestamptz,
  vigente_hasta        timestamptz,
  -- huellaCertificado(): sha256 hex del DER de la hoja. Clave de los tokens.
  huella_sha256        text not null check (huella_sha256 ~ '^[0-9a-f]{64}$'),
  pfx_secret_id        uuid not null,                       -- vault.secrets: .pfx en base64
  clave_secret_id      uuid not null,                       -- vault.secrets: clave del .pfx
  -- PKCS#12 con cifrado legacy (RC2/3DES): la librería lo lee con node-forge.
  pfx_legacy           boolean not null default false,
  subido_por           uuid references auth.users (id) on delete set null,
  revocado_en          timestamptz,
  creado_en            timestamptz not null default now(),
  actualizado_en       timestamptz not null default now(),
  unique (organizacion_id, huella_sha256),
  unique (organizacion_id, id)
);

-- Qué certificados firman por qué empresa. Para pedir folios el titular tiene
-- que ser representante electrónico de la empresa.
create table public.empresa_certificados (
  organizacion_id               uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id                    uuid not null references public.empresas (id) on delete cascade,
  certificado_id                uuid not null references public.certificados (id) on delete cascade,
  es_representante_electronico  boolean not null default false,
  predeterminado                boolean not null default false,
  creado_en                     timestamptz not null default now(),
  primary key (empresa_id, certificado_id),
  -- El certificado tiene que ser de la misma organización que la empresa.
  foreign key (organizacion_id, certificado_id)
    references public.certificados (organizacion_id, id) on delete cascade
);

create unique index empresa_certificados_predeterminado_unico
  on public.empresa_certificados (empresa_id) where predeterminado;

-- Implementación del TokenStore de la librería (ClaveToken → TokenGuardado).
-- La clave es la misma de ClaveToken: canal, ambiente, empresa y huella del
-- certificado que firmó la semilla. Solo service_role.
create table public.tokens_sii (
  canal              public.canal_sii not null,
  ambiente           public.ambiente_sii not null,
  rut_empresa        public.rut not null,
  huella_certificado text not null check (huella_certificado ~ '^[0-9a-f]{64}$'),
  token_cifrado      bytea not null,       -- AES-256-GCM (iv || ciphertext || tag)
  vence_en           timestamptz not null, -- obtención + SEGUNDOS_VIGENCIA_TOKEN (3000 s)
  actualizado_en     timestamptz not null default now(),
  primary key (canal, ambiente, rut_empresa, huella_certificado)
);

create index on public.tokens_sii (vence_en);

-- Cookies de SesionSii (aArreglo / desdeArreglo), cifradas. El SII frena el
-- re-login seguido (~5 ciclos, error 01.01.215.500.771.52): se reutilizan.
-- Solo service_role.
create table public.sesiones_sii (
  certificado_id   uuid not null references public.certificados (id) on delete cascade,
  ambiente         public.ambiente_sii not null,
  cookies_cifradas bytea not null,
  expira_en        timestamptz,
  ultimo_uso_en    timestamptz not null default now(),
  creado_en        timestamptz not null default now(),
  primary key (certificado_id, ambiente)
);

-- -----------------------------------------------------------------------------
-- 7. Folios (CAF)
-- -----------------------------------------------------------------------------

-- Archivo de Autorización de Folios. El XML completo (con <RSASK>, la llave con
-- que Timbre firma el TED) va en Vault.
create table public.cafs (
  id                  uuid primary key default gen_random_uuid(),
  organizacion_id     uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id          uuid not null references public.empresas (id) on delete cascade,
  ambiente            public.ambiente_sii not null,
  tipo_dte            smallint not null references public.tipos_dte (codigo),
  folio_desde         integer not null check (folio_desde >= 1),      -- <RNG><D>
  folio_hasta         integer not null,                                -- <RNG><H>
  siguiente_folio     integer not null,                                -- por defecto folio_desde (trigger)
  fecha_autorizacion  date not null,                                   -- <FA>
  idk                 smallint not null,                               -- <IDK>
  rut_emisor          public.rut not null,                             -- <RE>
  razon_social        text,                                            -- <RS>
  caf_secret_id       uuid not null,                                   -- vault.secrets: XML del CAF
  estado              public.estado_caf not null default 'activo',
  solicitud_id        uuid,                                            -- FK más abajo
  creado_en           timestamptz not null default now(),
  actualizado_en      timestamptz not null default now(),
  check (folio_hasta >= folio_desde),
  check (siguiente_folio between folio_desde and folio_hasta + 1),
  -- Candado de la librería: un CAF con otro IDK salió del ambiente equivocado.
  check ((ambiente = 'certificacion' and idk = 100) or (ambiente = 'produccion' and idk = 300)),
  unique (empresa_id, id),
  -- Dos CAF del mismo tipo y ambiente no pueden empezar en el mismo folio.
  unique (empresa_id, ambiente, tipo_dte, folio_desde)
);

create index cafs_disponibles on public.cafs (empresa_id, ambiente, tipo_dte, folio_desde)
  where estado = 'activo';

-- Bitácora de SolicitudFolios (asistente cvc_cgi/dte/of_*).
create table public.solicitudes_folios (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  certificado_id   uuid references public.certificados (id) on delete set null,
  ambiente         public.ambiente_sii not null,
  tipo_dte         smallint not null references public.tipos_dte (codigo),
  cantidad         integer not null check (cantidad >= 1),
  -- Solo se informa si el SII lo pide (primer timbraje del tipo en el ambiente).
  folio_inicial    integer check (folio_inicial >= 1),
  confirmada       boolean not null default false,          -- --confirmar
  estado           public.estado_solicitud_folios not null default 'en_curso',
  -- Rango que fija el SII en of_confirma_folio (también en la simulación).
  folio_desde      integer,
  folio_hasta      integer,
  caf_id           uuid references public.cafs (id) on delete set null,
  mensaje          text,
  solicitado_por   uuid references auth.users (id) on delete set null,
  creado_en        timestamptz not null default now(),
  terminado_en     timestamptz,
  check (estado <> 'timbrada' or confirmada),
  check (folio_hasta is null or folio_hasta >= folio_desde)
);

alter table public.cafs
  add constraint cafs_solicitud_fk foreign key (solicitud_id)
  references public.solicitudes_folios (id) on delete set null;

-- Folios anulados (no usados). Van en <RangoAnulados> del RCOF.
create table public.folios_anulados (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  caf_id           uuid not null references public.cafs (id) on delete cascade,
  folio            integer not null,
  motivo           text,
  anulado_por      uuid references auth.users (id) on delete set null,
  creado_en        timestamptz not null default now(),
  unique (caf_id, folio)
);

-- -----------------------------------------------------------------------------
-- 8. Catálogo comercial
-- -----------------------------------------------------------------------------

create table public.receptores (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  rut              public.rut not null,                         -- <RUTRecep>
  razon_social     text not null check (length(razon_social) between 1 and 100),  -- <RznSocRecep>
  correo           text,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  unique (empresa_id, rut)
);

create table public.productos (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  codigo           text,
  nombre           text not null check (length(nombre) between 1 and 80),   -- <NmbItem>
  precio_bruto     numeric(18, 6) not null check (precio_bruto >= 0),        -- IVA incluido
  exento           boolean not null default false,
  unidad           text check (length(unidad) between 1 and 4),              -- <UnmdItem>
  activo           boolean not null default true,
  creado_en        timestamptz not null default now(),
  actualizado_en   timestamptz not null default now(),
  unique (empresa_id, codigo)
);

-- -----------------------------------------------------------------------------
-- 9. Envíos al SII
-- -----------------------------------------------------------------------------

-- Un sobre subido al SII: EnvioBOLETA (REST o DTEWS) o ConsumoFolios (RCOF).
create table public.envios (
  id                 uuid primary key default gen_random_uuid(),
  organizacion_id    uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id         uuid not null references public.empresas (id) on delete cascade,
  ambiente           public.ambiente_sii not null,
  canal              public.canal_sii not null default 'rest',
  proposito          public.proposito_envio not null default 'emision',
  -- Carátula (DatosEnvioBoleta / CaratulaRcof)
  rut_envia          public.rut not null,
  certificado_id     uuid references public.certificados (id) on delete set null,
  nro_resol          integer not null check (nro_resol >= 0),
  fch_resol          date not null,
  tmst_firma         timestamptz,                 -- <TmstFirmaEnv>
  nombre_archivo     text,                        -- filename del multipart (envio.xml / rcof.xml)
  xml_path           text,                        -- Storage: documentos-xml/<org>/<empresa>/...
  -- Respuesta de la subida (RespuestaEnvioRest / ClienteDtews.enviarDte)
  track_id           text check (track_id ~ '^[0-9]+$'),
  enviado_en         timestamptz,
  fecha_recepcion    timestamptz,
  -- Sin trackId tras subir: no se sabe si llegó. No repetir sin revisar el SII.
  incierto           boolean not null default false,
  error              text,
  -- Estado (EstadoEnvioRest / EstadoEnvio)
  estado_sii         text,
  glosa_sii          text,
  informados         integer not null default 0 check (informados >= 0),
  aceptados          integer not null default 0 check (aceptados >= 0),
  rechazados         integer not null default 0 check (rechazados >= 0),
  reparos            integer not null default 0 check (reparos >= 0),
  clasificacion      public.clasificacion_envio generated always as (
                       public.clasificar_envio(incierto, estado_sii, informados, aceptados, rechazados, reparos)
                     ) stored,
  respuesta_subida   jsonb,                       -- JSON completo de la subida
  respuesta_estado   jsonb,                       -- JSON completo de la última consulta
  ultima_consulta_en timestamptz,
  consultas          integer not null default 0,
  creado_en          timestamptz not null default now(),
  actualizado_en     timestamptz not null default now(),
  check (not (incierto and track_id is not null)),
  unique (empresa_id, id)
);

create unique index envios_track_id_unico
  on public.envios (empresa_id, ambiente, track_id) where track_id is not null;
create index envios_por_consultar
  on public.envios (ultima_consulta_en nulls first) where estado_sii in ('REC', 'SOK', 'CRT', 'FOK', 'PRD');

-- estadistica[] por tipo de documento.
create table public.envio_estadisticas (
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  envio_id         uuid not null references public.envios (id) on delete cascade,
  tipo_dte         smallint not null,
  informados       integer not null default 0,
  aceptados        integer not null default 0,
  rechazados       integer not null default 0,
  reparos          integer not null default 0,
  primary key (envio_id, tipo_dte)
);

-- Historial de consultas de estado (la --bitacora de `seguimiento`).
create table public.consultas_envio (
  id               bigint generated always as identity primary key,
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  envio_id         uuid not null references public.envios (id) on delete cascade,
  consultado_en    timestamptz not null default now(),
  estado_sii       text,
  glosa_sii        text,
  informados       integer,
  aceptados        integer,
  rechazados       integer,
  reparos          integer,
  error            text,           -- falla de red/HTTP (reintentable)
  respuesta        jsonb
);

create index on public.consultas_envio (envio_id, consultado_en desc);

-- -----------------------------------------------------------------------------
-- 10. Documentos (boletas)
-- -----------------------------------------------------------------------------

create table public.documentos (
  id                     uuid primary key default gen_random_uuid(),
  organizacion_id        uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id             uuid not null references public.empresas (id) on delete cascade,
  ambiente               public.ambiente_sii not null,
  tipo_dte               smallint not null default 39 references public.tipos_dte (codigo),
  folio                  integer check (folio >= 1),         -- NULL mientras es borrador
  caf_id                 uuid,
  fecha_emision          date not null default (now() at time zone 'America/Santiago')::date,  -- <FchEmis>
  ind_servicio           smallint not null default 3,         -- <IndServicio> boleta de ventas y servicios
  -- Receptor (por defecto el genérico de las boletas)
  receptor_id            uuid references public.receptores (id) on delete set null,
  receptor_rut           public.rut not null default '66666666-6',
  receptor_razon_social  text default 'Cliente General',
  -- Totales (en el orden del esquema: MntNeto, MntExe, IVA, MntTotal)
  mnt_neto               bigint not null default 0 check (mnt_neto >= 0),
  mnt_exe                bigint not null default 0 check (mnt_exe >= 0),
  iva                    bigint not null default 0 check (iva >= 0),
  mnt_total              bigint not null default 0 check (mnt_total < 1000000000000000),
  tasa_iva               numeric(5, 2) not null default 19.00,
  -- Descuento global (se reparte entre líneas afectas como <DescuentoMonto>)
  descuento_tipo         public.tipo_descuento,
  descuento_valor        numeric(18, 6) check (descuento_valor >= 0),
  descuento_glosa        text,
  descuento_aplicado     bigint not null default 0 check (descuento_aplicado >= 0),
  -- Referencia (el set de pruebas exige CodRef 'SET' y RazonRef 'CASO-N')
  referencia_codigo      text,
  referencia_razon       text,
  -- Timbre y firma
  ted_xml                text,          -- <TED> (para el PDF417 de la representación impresa)
  timbrado_en            timestamptz,   -- <TSTED>
  firmado_en             timestamptz,
  xml_path               text,          -- Storage: DTE firmado (ISO-8859-1)
  -- Ciclo de vida
  estado                 public.estado_documento not null default 'borrador',
  envio_id               uuid,
  origen                 public.origen_documento not null default 'panel',
  caso_set               integer,       -- N de CASO-N (solo set de pruebas)
  -- Idempotencia de la API pública (header Idempotency-Key)
  clave_idempotencia     text,
  metadata               jsonb not null default '{}'::jsonb,
  creado_por             uuid references auth.users (id) on delete set null,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),
  check (mnt_total = mnt_neto + iva + mnt_exe),
  check (estado in ('borrador') or folio is not null),
  check ((descuento_tipo is null) = (descuento_valor is null)),
  check (origen <> 'set_pruebas' or (ambiente = 'certificacion' and caso_set is not null)),
  foreign key (empresa_id, caf_id) references public.cafs (empresa_id, id),
  foreign key (empresa_id, envio_id) references public.envios (empresa_id, id) on delete set null (envio_id),
  unique (empresa_id, ambiente, tipo_dte, folio),
  unique (organizacion_id, clave_idempotencia)
);

create index documentos_listado on public.documentos (empresa_id, ambiente, fecha_emision desc);
create index on public.documentos (envio_id) where envio_id is not null;
create index on public.documentos (caf_id) where caf_id is not null;

comment on column public.documentos.mnt_neto is
  'Boleta 39: el precio va bruto pero el XML desglosa neto = round(bruto/1,19) e IVA = bruto - neto.';

create table public.documento_detalles (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  documento_id     uuid not null references public.documentos (id) on delete cascade,
  nro_linea        smallint not null check (nro_linea between 1 and 1000),  -- <NroLinDet>
  producto_id      uuid references public.productos (id) on delete set null,
  nombre           text not null check (length(nombre) between 1 and 80),   -- <NmbItem>
  cantidad         numeric(18, 6) not null check (cantidad > 0),             -- <QtyItem>
  unidad           text check (length(unidad) between 1 and 4),              -- <UnmdItem>
  precio           numeric(18, 6) not null check (precio >= 0),              -- <PrcItem> bruto
  exento           boolean not null default false,                           -- <IndExe>1
  descuento_monto  bigint not null default 0 check (descuento_monto >= 0),   -- <DescuentoMonto>
  monto_item       bigint not null check (monto_item >= 0),                  -- <MontoItem>
  check (not exento or descuento_monto = 0),   -- los exentos no reciben descuento
  unique (documento_id, nro_linea)
);

-- Documentos rechazados o con reparos (detalle_rep_rech[]).
create table public.envio_rechazos (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references public.organizaciones (id) on delete cascade,
  envio_id          uuid not null references public.envios (id) on delete cascade,
  documento_id      uuid references public.documentos (id) on delete set null,
  tipo_dte          smallint not null,
  folio             integer not null,
  estado            text not null,                     -- tal como lo entrega el SII
  tipo_observacion  public.tipo_observacion not null,
  descripcion       text,
  -- error[]: { seccion, linea, nivel, codigo, descripcion, detalle }
  errores           jsonb not null default '[]'::jsonb check (jsonb_typeof(errores) = 'array'),
  creado_en         timestamptz not null default now(),
  unique (envio_id, tipo_dte, folio)
);

-- -----------------------------------------------------------------------------
-- 11. RCOF (Reporte de Consumo de Folios)
-- -----------------------------------------------------------------------------

-- Solo para períodos hasta julio de 2022: el SII eliminó la obligación desde el
-- 2022-08-01. Se conserva por paridad con la librería.
create table public.rcof (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id       uuid not null references public.empresas (id) on delete cascade,
  ambiente         public.ambiente_sii not null,
  fch_inicio       date not null,
  fch_final        date not null,
  sec_envio        integer not null default 1 check (sec_envio >= 1),
  -- ResumenRcof[]: { tipo, neto, iva, tasaIva, exento, total, foliosEmitidos,
  --   foliosAnulados, foliosUtilizados, rangosUtilizados[], rangosAnulados[] }
  resumenes        jsonb not null check (jsonb_typeof(resumenes) = 'array'),
  envio_id         uuid,
  creado_en        timestamptz not null default now(),
  check (fch_final >= fch_inicio),
  check (fch_final <= date '2022-07-31'),
  foreign key (empresa_id, envio_id) references public.envios (empresa_id, id) on delete set null (envio_id),
  unique (empresa_id, ambiente, fch_inicio, fch_final, sec_envio)
);

-- -----------------------------------------------------------------------------
-- 12. Proceso de certificación (postulación → set → declaración)
-- -----------------------------------------------------------------------------

create table public.procesos_certificacion (
  id                     uuid primary key default gen_random_uuid(),
  organizacion_id        uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id             uuid not null unique references public.empresas (id) on delete cascade,
  etapa                  public.etapa_certificacion not null default 'borrador',
  -- Postulación (DatosPostulacion, pe_datos_empresa en maullin)
  rut_administrador      public.rut,          -- tiene que ser quien se autentica después
  correo_administrador   public.correo_sii,
  correo_contacto_sii    public.correo_sii,
  correo_intercambio     public.correo_sii,
  nombre_software        text check (length(trim(nombre_software)) between 1 and 30),
  boleta_exenta          boolean not null default true,
  url                    text check (url is null or (url like 'www.%' and length(url) <= 100)),
  postulada_en           timestamptz,
  -- Avisos que el SII mostró al postular (ResultadoPostulacion): hay que mostrárselos al usuario.
  avisos_postulacion     jsonb not null default '[]'::jsonb,
  -- Set de pruebas (descargarSetPruebas + parsearSetPruebas)
  correo_proveedor_set   public.correo_sii,   -- se informa al descargar el set
  set_pruebas_texto      text,
  set_descargado_en      timestamptz,
  envio_set_id           uuid,
  revision_solicitada_en timestamptz,
  -- Declaración de cumplimiento (DatosDeclaracion, www4)
  link_consulta          text check (length(trim(link_consulta)) between 1 and 100),
  rut_proveedor          public.rut,
  nombre_proveedor       text check (length(trim(nombre_proveedor)) between 1 and 30),
  correo_proveedor       public.correo_sii,
  declarada_en           timestamptz,
  -- EstadoDeclaracion: P90 = por declarar, P91 = autorizada
  codigo_estado_sii      text,
  glosa_estado_sii       text,
  paso_sii               integer,
  estado_consultado_en   timestamptz,
  creado_en              timestamptz not null default now(),
  actualizado_en         timestamptz not null default now(),
  foreign key (empresa_id, envio_set_id) references public.envios (empresa_id, id) on delete set null (envio_set_id)
);

-- Casos CASO-N del set (CasoSetPruebas), cada uno con su boleta.
create table public.set_pruebas_casos (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references public.organizaciones (id) on delete cascade,
  proceso_id        uuid not null references public.procesos_certificacion (id) on delete cascade,
  numero_caso       integer not null check (numero_caso >= 1),
  tipo_dte          smallint not null references public.tipos_dte (codigo),
  -- DetalleSetPruebas[]: { nombre, cantidad, precio, exento?, unidad? }
  detalles          jsonb not null check (jsonb_typeof(detalles) = 'array'),
  referencia_codigo text not null default 'SET',
  referencia_razon  text not null,             -- 'CASO-N'
  documento_id      uuid references public.documentos (id) on delete set null,
  creado_en         timestamptz not null default now(),
  unique (proceso_id, numero_caso)
);

-- -----------------------------------------------------------------------------
-- 13. Auditoría de operaciones con el SII
-- -----------------------------------------------------------------------------

-- Una fila por operación que sale (o habría salido) al SII. `confirmada = false`
-- es el ensayo (sin --confirmar): valida y muestra lo que haría.
create table public.operaciones_sii (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id       uuid references public.empresas (id) on delete set null,
  usuario_id       uuid references auth.users (id) on delete set null,
  api_key_id       uuid,
  operacion        public.operacion_sii not null,
  ambiente         public.ambiente_sii not null,
  canal            public.canal_sii,
  confirmada       boolean not null default false,
  resultado        public.resultado_operacion not null default 'en_curso',
  mensaje          text,             -- nunca tokens, claves ni cookies
  detalle          jsonb not null default '{}'::jsonb,
  envio_id         uuid references public.envios (id) on delete set null,
  solicitud_id     uuid references public.solicitudes_folios (id) on delete set null,
  documento_id     uuid references public.documentos (id) on delete set null,
  iniciada_en      timestamptz not null default now(),
  terminada_en     timestamptz,
  check (resultado = 'en_curso' or terminada_en is not null)
);

create index on public.operaciones_sii (organizacion_id, iniciada_en desc);
create index on public.operaciones_sii (empresa_id, operacion, iniciada_en desc);

comment on column public.operaciones_sii.resultado is
  'Equivale al código de salida de la CLI: ok 0, error 1, uso 2, config 3, transporte 4 (reintentable), rechazo_sii 5, incierto 6 (revisar el SII antes de repetir), verificacion_fallida 7.';

-- -----------------------------------------------------------------------------
-- 14. Integraciones: API keys y webhooks
-- -----------------------------------------------------------------------------

create table public.api_keys (
  id               uuid primary key default gen_random_uuid(),
  organizacion_id  uuid not null references public.organizaciones (id) on delete cascade,
  empresa_id       uuid references public.empresas (id) on delete cascade,  -- NULL = todas
  nombre           text not null,
  prefijo          text not null check (length(prefijo) between 6 and 16),  -- visible: 'sk_live_ab12'
  clave_hash       text not null unique check (clave_hash ~ '^[0-9a-f]{64}$'),  -- sha256 hex
  alcances         text[] not null default '{documentos:leer}'
                   check (alcances <@ array[
                     'documentos:leer', 'documentos:emitir', 'folios:leer', 'folios:solicitar',
                     'envios:leer', 'certificacion:gestionar'
                   ]::text[]),
  ambiente         public.ambiente_sii not null default 'certificacion',
  ultimo_uso_en    timestamptz,
  expira_en        timestamptz,
  revocada_en      timestamptz,
  creado_por       uuid references auth.users (id) on delete set null,
  creado_en        timestamptz not null default now()
);

alter table public.operaciones_sii
  add constraint operaciones_api_key_fk foreign key (api_key_id)
  references public.api_keys (id) on delete set null;

create table public.webhooks (
  id                uuid primary key default gen_random_uuid(),
  organizacion_id   uuid not null references public.organizaciones (id) on delete cascade,
  url               text not null check (url ~ '^https://'),
  eventos           text[] not null
                    check (cardinality(eventos) > 0 and eventos <@ array[
                      'documento.aceptado', 'documento.aceptado_con_reparos', 'documento.rechazado',
                      'documento.incierto', 'envio.actualizado', 'folios.por_agotarse',
                      'certificado.por_vencer', 'certificacion.actualizada'
                    ]::text[]),
  secreto_secret_id uuid not null,    -- vault.secrets: secreto HMAC para firmar las entregas
  activo            boolean not null default true,
  creado_en         timestamptz not null default now(),
  actualizado_en    timestamptz not null default now()
);

-- Outbox de webhooks: los triggers encolan, un worker entrega.
create table public.webhook_entregas (
  id                  bigint generated always as identity primary key,
  organizacion_id     uuid not null references public.organizaciones (id) on delete cascade,
  webhook_id          uuid not null references public.webhooks (id) on delete cascade,
  evento              text not null,
  payload             jsonb not null,
  estado              public.estado_entrega_webhook not null default 'pendiente',
  intentos            integer not null default 0,
  ultimo_status_http  integer,
  ultima_respuesta    text,
  siguiente_intento_en timestamptz not null default now(),
  entregado_en        timestamptz,
  creado_en           timestamptz not null default now()
);

create index webhook_entregas_pendientes
  on public.webhook_entregas (siguiente_intento_en) where estado = 'pendiente';

-- -----------------------------------------------------------------------------
-- 15. Triggers y lógica
-- -----------------------------------------------------------------------------

create function public.tg_actualizado_en()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.actualizado_en := now();
  return new;
end;
$$;

-- organizacion_id se hereda siempre del padre (TG_ARGV[0] = tabla padre,
-- TG_ARGV[1] = columna FK). Así un usuario no puede colgar filas de otra
-- organización: el WITH CHECK de RLS se evalúa después de este trigger.
create function public.tg_heredar_organizacion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_padre uuid := (to_jsonb(new) ->> tg_argv[1])::uuid;
begin
  if v_padre is null then
    raise exception '%.% es obligatorio', tg_table_name, tg_argv[1];
  end if;
  execute format('select organizacion_id from public.%I where id = $1', tg_argv[0])
    into new.organizacion_id using v_padre;
  if new.organizacion_id is null then
    raise exception 'No existe % %', tg_argv[0], v_padre using errcode = 'foreign_key_violation';
  end if;
  return new;
end;
$$;

-- Borra de Vault los secretos de la fila (TG_ARGV = columnas *_secret_id).
create function public.tg_borrar_secretos()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_columna text;
begin
  foreach v_columna in array tg_argv loop
    delete from vault.secrets where id = (to_jsonb(old) ->> v_columna)::uuid;
  end loop;
  return old;
end;
$$;

-- Perfil al registrarse.
create function public.tg_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.perfiles (id, correo, nombre)
  values (new.id, new.email, new.raw_user_meta_data ->> 'nombre')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger trg_nuevo_usuario
  after insert on auth.users
  for each row execute function public.tg_nuevo_usuario();

-- No dejar una organización sin propietario.
create function public.tg_proteger_ultimo_propietario()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.rol = 'propietario'
     and (tg_op = 'DELETE' or new.rol <> 'propietario')
     and not exists (
       select 1 from public.miembros_organizacion
       where organizacion_id = old.organizacion_id
         and rol = 'propietario'
         and usuario_id <> old.usuario_id
     )
     -- Se permite cuando se borra la organización completa (cascada).
     and exists (select 1 from public.organizaciones where id = old.organizacion_id)
  then
    raise exception 'La organización debe tener al menos un propietario';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger trg_proteger_ultimo_propietario
  before update or delete on public.miembros_organizacion
  for each row execute function public.tg_proteger_ultimo_propietario();

-- Límites del plan vigente.
create function public.plan_vigente(p_organizacion uuid)
returns public.planes
language sql
stable security definer
set search_path = ''
as $$
  select p.*
  from public.suscripciones s
  join public.planes p on p.id = s.plan_id
  where s.organizacion_id = p_organizacion
    and s.estado in ('prueba', 'activa')
  order by s.creado_en desc
  limit 1;
$$;

-- Los límites solo se revisan para quien puede escribir: a un no-miembro lo
-- rechaza RLS (el WITH CHECK corre después de los triggers BEFORE) sin enterarse
-- del plan de otra organización.
create function public.tg_limite_empresas()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.planes := public.plan_vigente(new.organizacion_id);
begin
  if (select auth.role()) is distinct from 'service_role'
     and not public.es_admin(new.organizacion_id) then
    return new;
  end if;
  if v_plan.id is null then
    raise exception 'La organización no tiene una suscripción vigente';
  end if;
  if v_plan.max_empresas is not null and (
       select count(*) from public.empresas where organizacion_id = new.organizacion_id
     ) >= v_plan.max_empresas then
    raise exception 'El plan % permite como máximo % empresa(s)', v_plan.nombre, v_plan.max_empresas;
  end if;
  return new;
end;
$$;

create function public.exigir_cupo_usuarios(p_organizacion uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.planes := public.plan_vigente(p_organizacion);
begin
  if v_plan.max_usuarios is not null and (
       select count(*) from public.miembros_organizacion where organizacion_id = p_organizacion
     ) >= v_plan.max_usuarios then
    raise exception 'El plan % permite como máximo % usuario(s)', v_plan.nombre, v_plan.max_usuarios;
  end if;
end;
$$;

-- Altas directas (administradores o backend). aceptar_invitacion() revisa el
-- cupo por su cuenta; crear_organizacion() agrega al primer miembro.
create function public.tg_limite_usuarios()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is not distinct from 'service_role'
     or public.es_admin(new.organizacion_id) then
    perform public.exigir_cupo_usuarios(new.organizacion_id);
  end if;
  return new;
end;
$$;

-- Al asignar folio: el CAF tiene que ser de la misma empresa, ambiente y tipo,
-- y el folio estar en su rango. En producción, además, la empresa tiene que
-- estar autorizada (P91) y el plan permitirlo.
create function public.tg_validar_documento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caf public.cafs;
begin
  if new.folio is not null then
    if new.caf_id is null then
      raise exception 'Un documento con folio necesita su CAF';
    end if;
    select * into v_caf from public.cafs where id = new.caf_id;
    if v_caf.ambiente <> new.ambiente or v_caf.tipo_dte <> new.tipo_dte then
      raise exception 'El CAF % no es de tipo % en %', new.caf_id, new.tipo_dte, new.ambiente;
    end if;
    if new.folio not between v_caf.folio_desde and v_caf.folio_hasta then
      raise exception 'El folio % no está en el CAF (% a %)', new.folio, v_caf.folio_desde, v_caf.folio_hasta;
    end if;
  end if;

  if tg_op = 'INSERT' and new.ambiente = 'produccion' then
    if not (select autorizada_produccion from public.empresas where id = new.empresa_id) then
      raise exception 'La empresa no está autorizada a emitir en producción (estado P91)';
    end if;
    if not coalesce((public.plan_vigente(new.organizacion_id)).permite_produccion, false) then
      raise exception 'El plan vigente no permite emitir en producción';
    end if;
  end if;
  return new;
end;
$$;

-- Cuota mensual de boletas: cuenta cuando el documento recibe folio (emisión),
-- no los borradores. Las de producción se controlan contra el plan.
create function public.tg_contar_uso_documento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_periodo date := date_trunc('month', now() at time zone 'America/Santiago')::date;
  v_limite  integer;
  v_usadas  integer;
begin
  if new.folio is null or (tg_op = 'UPDATE' and old.folio is not null) then
    return new;
  end if;
  if new.ambiente = 'produccion' then
    v_limite := (public.plan_vigente(new.organizacion_id)).max_boletas_mes;
    insert into public.uso_mensual (organizacion_id, periodo, boletas_produccion)
    values (new.organizacion_id, v_periodo, 1)
    on conflict (organizacion_id, periodo)
      do update set boletas_produccion = public.uso_mensual.boletas_produccion + 1
    returning boletas_produccion into v_usadas;
    if v_limite is not null and v_usadas > v_limite then
      raise exception 'Se alcanzó el límite de % boletas del mes en el plan vigente', v_limite;
    end if;
  else
    insert into public.uso_mensual (organizacion_id, periodo, boletas_certificacion)
    values (new.organizacion_id, v_periodo, 1)
    on conflict (organizacion_id, periodo)
      do update set boletas_certificacion = public.uso_mensual.boletas_certificacion + 1;
  end if;
  return new;
end;
$$;

-- Envíos y folios timbrados del mes.
create function public.tg_contar_uso_otros()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_periodo date := date_trunc('month', now() at time zone 'America/Santiago')::date;
begin
  if tg_table_name = 'envios' then
    insert into public.uso_mensual (organizacion_id, periodo, envios)
    values (new.organizacion_id, v_periodo, 1)
    on conflict (organizacion_id, periodo)
      do update set envios = public.uso_mensual.envios + 1;
  elsif tg_table_name = 'cafs' and new.ambiente = 'produccion' then
    insert into public.uso_mensual (organizacion_id, periodo, folios_timbrados)
    values (new.organizacion_id, v_periodo, new.folio_hasta - new.folio_desde + 1)
    on conflict (organizacion_id, periodo)
      do update set folios_timbrados = public.uso_mensual.folios_timbrados
                                       + (new.folio_hasta - new.folio_desde + 1);
  end if;
  return null;
end;
$$;

create function public.tg_caf_inicial()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.siguiente_folio := coalesce(new.siguiente_folio, new.folio_desde);
  return new;
end;
$$;

-- Asigna el siguiente folio libre de forma atómica (bloquea el CAF). Usa el CAF
-- activo de menor rango; al agotarlo lo marca 'agotado'. Un folio asignado y no
-- usado se registra en folios_anulados.
create function public.asignar_folio(
  p_empresa uuid, p_ambiente public.ambiente_sii, p_tipo_dte smallint
)
returns table (caf_id uuid, folio integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_caf public.cafs;
begin
  select * into v_caf
  from public.cafs c
  where c.empresa_id = p_empresa
    and c.ambiente = p_ambiente
    and c.tipo_dte = p_tipo_dte
    and c.estado = 'activo'
    and c.siguiente_folio <= c.folio_hasta
  order by c.folio_desde
  limit 1
  for update;

  if not found then
    raise exception 'No quedan folios de tipo % en % para la empresa', p_tipo_dte, p_ambiente
      using errcode = 'P0002', hint = 'Solicite un nuevo CAF.';
  end if;

  if (select auth.role()) is distinct from 'service_role'
     and not public.puede_emitir(v_caf.organizacion_id) then
    raise exception 'Sin permiso para emitir en esta empresa' using errcode = '42501';
  end if;

  update public.cafs c
  set siguiente_folio = c.siguiente_folio + 1,
      estado = case when c.siguiente_folio + 1 > c.folio_hasta then 'agotado'::public.estado_caf else c.estado end
  where c.id = v_caf.id;

  caf_id := v_caf.id;
  folio := v_caf.siguiente_folio;
  return next;
end;
$$;

-- Encola un evento para los webhooks suscritos de la organización.
create function public.encolar_evento(p_organizacion uuid, p_evento text, p_payload jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.webhook_entregas (organizacion_id, webhook_id, evento, payload)
  select w.organizacion_id, w.id, p_evento,
         jsonb_build_object('evento', p_evento, 'creado_en', now(), 'datos', p_payload)
  from public.webhooks w
  where w.organizacion_id = p_organizacion
    and w.activo
    and p_evento = any (w.eventos);
$$;

create function public.tg_evento_documento()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.estado in ('aceptado', 'aceptado_con_reparos', 'rechazado', 'incierto') then
    perform public.encolar_evento(
      new.organizacion_id,
      'documento.' || new.estado::text,
      jsonb_build_object(
        'documento_id', new.id, 'empresa_id', new.empresa_id, 'ambiente', new.ambiente,
        'tipo_dte', new.tipo_dte, 'folio', new.folio, 'mnt_total', new.mnt_total,
        'envio_id', new.envio_id
      )
    );
  end if;
  return new;
end;
$$;

-- Lleva el estado de un envío a sus documentos. Llamarla después de guardar
-- estado y detalle_rep_rech (los triggers de abajo la llaman solos).
create function public.sincronizar_documentos_envio(p_envio uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.envios;
begin
  select * into e from public.envios where id = p_envio;
  if not found or e.proposito = 'rcof' then
    return;
  end if;

  update public.documentos d
  set estado = case
    when e.clasificacion = 'incierto' then 'incierto'::public.estado_documento
    when e.clasificacion in ('en_proceso', 'inconsistente') then 'enviado'::public.estado_documento
    when e.clasificacion = 'pendiente' then d.estado
    when e.estado_sii = 'EPR' then
      case
        when exists (select 1 from public.envio_rechazos r
                     where r.envio_id = e.id and r.tipo_dte = d.tipo_dte and r.folio = d.folio
                       and r.tipo_observacion = 'rechazo')
          then 'rechazado'::public.estado_documento
        when exists (select 1 from public.envio_rechazos r
                     where r.envio_id = e.id and r.tipo_dte = d.tipo_dte and r.folio = d.folio
                       and r.tipo_observacion = 'reparo')
          then 'aceptado_con_reparos'::public.estado_documento
        else 'aceptado'::public.estado_documento
      end
    else 'rechazado'::public.estado_documento   -- RSC, RFR, RCT, RCH...: rechazo del sobre
  end
  where d.envio_id = e.id
    and d.estado <> 'anulado';
end;
$$;

create function public.tg_envio_actualizado()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sincronizar_documentos_envio(new.id);
  perform public.encolar_evento(
    new.organizacion_id, 'envio.actualizado',
    jsonb_build_object(
      'envio_id', new.id, 'empresa_id', new.empresa_id, 'ambiente', new.ambiente,
      'track_id', new.track_id, 'estado_sii', new.estado_sii, 'clasificacion', new.clasificacion,
      'informados', new.informados, 'aceptados', new.aceptados,
      'rechazados', new.rechazados, 'reparos', new.reparos
    )
  );
  return new;
end;
$$;

create function public.tg_envio_rechazo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  e public.envios;
begin
  select * into e from public.envios where id = new.envio_id;
  if new.documento_id is null then
    select d.id into new.documento_id
    from public.documentos d
    where d.empresa_id = e.empresa_id and d.ambiente = e.ambiente
      and d.tipo_dte = new.tipo_dte and d.folio = new.folio;
  end if;
  return new;
end;
$$;

create function public.tg_envio_rechazo_sincronizar()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.sincronizar_documentos_envio(new.envio_id);
  return null;
end;
$$;

-- Al quedar autorizada (P91) se marca la empresa.
create function public.tg_certificacion_autorizada()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.codigo_estado_sii = 'P91' then
    new.etapa := 'autorizada';
  elsif new.codigo_estado_sii = 'P90' and new.etapa < 'por_declarar' then
    new.etapa := 'por_declarar';
  end if;

  if new.etapa = 'autorizada' and (tg_op = 'INSERT' or old.etapa is distinct from 'autorizada') then
    update public.empresas
    set autorizada_produccion = true, autorizada_en = coalesce(autorizada_en, now())
    where id = new.empresa_id;
  end if;

  if tg_op = 'UPDATE' and new.etapa is distinct from old.etapa then
    perform public.encolar_evento(
      new.organizacion_id, 'certificacion.actualizada',
      jsonb_build_object('empresa_id', new.empresa_id, 'etapa', new.etapa,
                         'codigo_estado_sii', new.codigo_estado_sii)
    );
  end if;
  return new;
end;
$$;

-- Crear organización: la crea, deja al usuario como propietario y lo suscribe
-- al plan de certificación (prueba).
create function public.crear_organizacion(p_nombre text, p_slug text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := (select auth.uid());
  v_org     uuid;
begin
  if v_usuario is null then
    raise exception 'Requiere sesión' using errcode = '42501';
  end if;
  insert into public.organizaciones (nombre, slug, creado_por)
  values (p_nombre, lower(p_slug), v_usuario)
  returning id into v_org;

  insert into public.suscripciones (organizacion_id, plan_id, estado, periodo_fin)
  select v_org, p.id, 'prueba', now() + interval '30 days'
  from public.planes p where p.codigo = 'certificacion';

  insert into public.miembros_organizacion (organizacion_id, usuario_id, rol)
  values (v_org, v_usuario, 'propietario');
  return v_org;
end;
$$;

-- Aceptar una invitación con el token del enlace (el correo tiene que calzar).
create function public.aceptar_invitacion(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_usuario uuid := (select auth.uid());
  v_correo  text;
  v_inv     public.invitaciones;
begin
  select lower(email) into v_correo from auth.users where id = v_usuario;
  select * into v_inv
  from public.invitaciones
  where token_hash = encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
    and aceptada_en is null
    and expira_en > now()
  for update;

  if not found or v_correo is null or v_inv.correo is distinct from v_correo then
    raise exception 'Invitación inválida o vencida' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.miembros_organizacion
    where organizacion_id = v_inv.organizacion_id and usuario_id = v_usuario
  ) then
    perform public.exigir_cupo_usuarios(v_inv.organizacion_id);
  end if;

  insert into public.miembros_organizacion (organizacion_id, usuario_id, rol)
  values (v_inv.organizacion_id, v_usuario, v_inv.rol)
  on conflict (organizacion_id, usuario_id) do update set rol = excluded.rol;

  update public.invitaciones set aceptada_en = now() where id = v_inv.id;
  return v_inv.organizacion_id;
end;
$$;

-- Vault para el backend (solo service_role): guarda el .pfx en base64, su
-- clave, el XML del CAF, etc., y devuelve el id que va en *_secret_id.
create function public.guardar_secreto(p_secreto text, p_descripcion text default '')
returns uuid
language sql
security definer
set search_path = ''
as $$
  select vault.create_secret(p_secreto, null, p_descripcion);
$$;

create function public.leer_secreto(p_id uuid)
returns text
language sql
stable security definer
set search_path = ''
as $$
  select decrypted_secret from vault.decrypted_secrets where id = p_id;
$$;

-- Token aleatorio (2 uuid v4 = 244 bits de un generador criptográfico).
create function public.token_aleatorio()
returns text
language sql
volatile
set search_path = ''
as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

-- Invitar: devuelve el token UNA vez (va en el enlace del correo); se guarda su hash.
create function public.crear_invitacion(
  p_organizacion uuid, p_correo text, p_rol public.rol_miembro default 'lector'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := public.token_aleatorio();
begin
  if not public.es_admin(p_organizacion) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  delete from public.invitaciones
  where organizacion_id = p_organizacion and correo = lower(p_correo) and aceptada_en is null;
  insert into public.invitaciones (organizacion_id, correo, rol, token_hash, invitado_por)
  values (p_organizacion, lower(p_correo), p_rol,
          encode(sha256(convert_to(v_token, 'UTF8')), 'hex'), (select auth.uid()));
  return v_token;
end;
$$;

-- API key: devuelve la clave UNA vez; se guarda solo su sha256.
create function public.crear_api_key(
  p_organizacion uuid,
  p_nombre text,
  p_alcances text[] default '{documentos:leer}',
  p_ambiente public.ambiente_sii default 'certificacion',
  p_empresa uuid default null,
  p_expira_en timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_clave text;
begin
  if not public.es_admin(p_organizacion) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not coalesce((public.plan_vigente(p_organizacion)).incluye_api, false) then
    raise exception 'El plan vigente no incluye acceso por API';
  end if;
  if p_empresa is not null and not exists (
    select 1 from public.empresas where id = p_empresa and organizacion_id = p_organizacion
  ) then
    raise exception 'La empresa no pertenece a la organización';
  end if;
  v_clave := (case p_ambiente when 'produccion' then 'sk_live_' else 'sk_test_' end)
             || public.token_aleatorio();
  insert into public.api_keys
    (organizacion_id, empresa_id, nombre, prefijo, clave_hash, alcances, ambiente, expira_en, creado_por)
  values
    (p_organizacion, p_empresa, p_nombre, left(v_clave, 12),
     encode(sha256(convert_to(v_clave, 'UTF8')), 'hex'), p_alcances, p_ambiente, p_expira_en,
     (select auth.uid()));
  return v_clave;
end;
$$;

-- Webhook: el secreto HMAC se crea en Vault y se devuelve UNA vez.
create function public.crear_webhook(p_organizacion uuid, p_url text, p_eventos text[])
returns table (webhook_id uuid, secreto text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secreto   text := 'whsec_' || public.token_aleatorio();
  v_secret_id uuid;
begin
  if not public.es_admin(p_organizacion) then
    raise exception 'Sin permiso' using errcode = '42501';
  end if;
  if not coalesce((public.plan_vigente(p_organizacion)).incluye_webhooks, false) then
    raise exception 'El plan vigente no incluye webhooks';
  end if;
  v_secret_id := vault.create_secret(v_secreto, null, 'webhook ' || p_url);
  insert into public.webhooks (organizacion_id, url, eventos, secreto_secret_id)
  values (p_organizacion, p_url, p_eventos, v_secret_id)
  returning id into webhook_id;
  secreto := v_secreto;
  return next;
end;
$$;

-- Implementación SQL del TokenStore (obtener / guardar / borrar). La vigencia
-- la valida el cliente con su reloj, como en la librería.
create function public.token_obtener(
  p_canal public.canal_sii, p_ambiente public.ambiente_sii, p_rut text, p_huella text
)
returns table (token_cifrado bytea, vence_en timestamptz)
language sql
stable security definer
set search_path = ''
as $$
  select t.token_cifrado, t.vence_en
  from public.tokens_sii t
  where t.canal = p_canal and t.ambiente = p_ambiente
    and t.rut_empresa = p_rut and t.huella_certificado = p_huella;
$$;

create function public.token_guardar(
  p_canal public.canal_sii, p_ambiente public.ambiente_sii, p_rut text, p_huella text,
  p_token_cifrado bytea, p_vence_en timestamptz
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.tokens_sii
    (canal, ambiente, rut_empresa, huella_certificado, token_cifrado, vence_en)
  values (p_canal, p_ambiente, p_rut, p_huella, p_token_cifrado, p_vence_en)
  on conflict (canal, ambiente, rut_empresa, huella_certificado)
    do update set token_cifrado = excluded.token_cifrado,
                  vence_en = excluded.vence_en,
                  actualizado_en = now();
$$;

create function public.token_borrar(
  p_canal public.canal_sii, p_ambiente public.ambiente_sii, p_rut text, p_huella text
)
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.tokens_sii
  where canal = p_canal and ambiente = p_ambiente
    and rut_empresa = p_rut and huella_certificado = p_huella;
$$;

-- Triggers --------------------------------------------------------------------

-- actualizado_en
do $$
declare
  t text;
begin
  foreach t in array array[
    'perfiles', 'organizaciones', 'suscripciones', 'empresas', 'certificados', 'cafs',
    'receptores', 'productos', 'envios', 'documentos', 'procesos_certificacion', 'webhooks'
  ] loop
    execute format(
      'create trigger trg_90_actualizado_en before update on public.%I
         for each row execute function public.tg_actualizado_en()', t);
  end loop;
end;
$$;

-- organizacion_id heredado (los nombres "trg_00_" corren primero: Postgres
-- ejecuta los triggers de un mismo evento en orden alfabético).
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('resoluciones',          'empresas',               'empresa_id'),
      ('empresa_certificados',  'empresas',               'empresa_id'),
      ('cafs',                  'empresas',               'empresa_id'),
      ('solicitudes_folios',    'empresas',               'empresa_id'),
      ('folios_anulados',       'cafs',                   'caf_id'),
      ('receptores',            'empresas',               'empresa_id'),
      ('productos',             'empresas',               'empresa_id'),
      ('envios',                'empresas',               'empresa_id'),
      ('envio_estadisticas',    'envios',                 'envio_id'),
      ('consultas_envio',       'envios',                 'envio_id'),
      ('envio_rechazos',        'envios',                 'envio_id'),
      ('documentos',            'empresas',               'empresa_id'),
      ('documento_detalles',    'documentos',             'documento_id'),
      ('rcof',                  'empresas',               'empresa_id'),
      ('procesos_certificacion','empresas',               'empresa_id'),
      ('set_pruebas_casos',     'procesos_certificacion', 'proceso_id')
    ) as v (tabla, padre, columna)
  loop
    execute format(
      'create trigger trg_00_organizacion before insert or update on public.%I
         for each row execute function public.tg_heredar_organizacion(%L, %L)',
      r.tabla, r.padre, r.columna);
  end loop;
end;
$$;

create trigger trg_10_limite_empresas
  before insert on public.empresas
  for each row execute function public.tg_limite_empresas();

create trigger trg_10_limite_usuarios
  before insert on public.miembros_organizacion
  for each row execute function public.tg_limite_usuarios();

create trigger trg_10_validar_documento
  before insert or update of folio, caf_id, ambiente, tipo_dte on public.documentos
  for each row execute function public.tg_validar_documento();

create trigger trg_20_contar_uso
  before insert or update of folio on public.documentos
  for each row execute function public.tg_contar_uso_documento();

create trigger trg_10_caf_inicial
  before insert on public.cafs
  for each row execute function public.tg_caf_inicial();

create trigger trg_60_contar_uso
  after insert on public.cafs
  for each row execute function public.tg_contar_uso_otros();

create trigger trg_60_contar_uso
  after insert on public.envios
  for each row execute function public.tg_contar_uso_otros();

create trigger trg_50_evento_documento
  after update of estado on public.documentos
  for each row when (old.estado is distinct from new.estado)
  execute function public.tg_evento_documento();

create trigger trg_50_envio_actualizado
  after update of estado_sii, incierto, informados, aceptados, rechazados, reparos on public.envios
  for each row when (
    old.estado_sii is distinct from new.estado_sii
    or old.incierto is distinct from new.incierto
    or (old.informados, old.aceptados, old.rechazados, old.reparos)
       is distinct from (new.informados, new.aceptados, new.rechazados, new.reparos)
  )
  execute function public.tg_envio_actualizado();

create trigger trg_10_envio_rechazo
  before insert on public.envio_rechazos
  for each row execute function public.tg_envio_rechazo();

create trigger trg_50_envio_rechazo_sincronizar
  after insert or update on public.envio_rechazos
  for each row execute function public.tg_envio_rechazo_sincronizar();

create trigger trg_10_certificacion_autorizada
  before insert or update of codigo_estado_sii, etapa on public.procesos_certificacion
  for each row execute function public.tg_certificacion_autorizada();

create trigger trg_borrar_secretos
  after delete on public.certificados
  for each row execute function public.tg_borrar_secretos('pfx_secret_id', 'clave_secret_id');

create trigger trg_borrar_secretos
  after delete on public.cafs
  for each row execute function public.tg_borrar_secretos('caf_secret_id');

create trigger trg_borrar_secretos
  after delete on public.webhooks
  for each row execute function public.tg_borrar_secretos('secreto_secret_id');

-- -----------------------------------------------------------------------------
-- 16. Vistas (security_invoker: respetan el RLS de quien consulta)
-- -----------------------------------------------------------------------------

create view public.v_folios_disponibles
with (security_invoker = true) as
select
  c.organizacion_id,
  c.empresa_id,
  c.ambiente,
  c.tipo_dte,
  count(*)                                              as cafs_activos,
  sum(c.folio_hasta - c.siguiente_folio + 1)::integer   as folios_disponibles,
  min(c.siguiente_folio)                                as proximo_folio
from public.cafs c
where c.estado = 'activo'
group by c.organizacion_id, c.empresa_id, c.ambiente, c.tipo_dte;

create view public.v_certificados_estado
with (security_invoker = true) as
select
  c.id, c.organizacion_id, c.rut_titular, c.nombre_titular, c.cn, c.vigente_desde, c.vigente_hasta,
  case
    when c.revocado_en is not null then 'revocado'
    when c.vigente_hasta < now() then 'vencido'
    when c.vigente_hasta < now() + interval '30 days' then 'por_vencer'
    else 'vigente'
  end as estado,
  greatest(0, extract(day from c.vigente_hasta - now()))::integer as dias_restantes
from public.certificados c;

-- Envíos que el poller (seguimiento) tiene que consultar.
create view public.v_envios_por_consultar
with (security_invoker = true) as
select e.*
from public.envios e
where e.clasificacion = 'en_proceso'
   or (e.clasificacion = 'pendiente' and e.track_id is not null);

-- Ventas diarias por tipo (base para reportes y, en períodos antiguos, para
-- resumirParaRcof). Solo documentos aceptados.
create view public.v_ventas_diarias
with (security_invoker = true) as
select
  d.organizacion_id,
  d.empresa_id,
  d.ambiente,
  d.fecha_emision,
  d.tipo_dte,
  count(*)::integer      as documentos,
  sum(d.mnt_neto)        as mnt_neto,
  sum(d.iva)             as iva,
  sum(d.mnt_exe)         as mnt_exe,
  sum(d.mnt_total)       as mnt_total,
  min(d.folio)           as folio_min,
  max(d.folio)           as folio_max
from public.documentos d
where d.estado in ('aceptado', 'aceptado_con_reparos')
group by d.organizacion_id, d.empresa_id, d.ambiente, d.fecha_emision, d.tipo_dte;

-- -----------------------------------------------------------------------------
-- 17. Row Level Security
-- -----------------------------------------------------------------------------

do $$
declare
  t text;
begin
  foreach t in array array[
    'tipos_dte', 'estados_sii', 'planes', 'perfiles', 'organizaciones',
    'miembros_organizacion', 'invitaciones', 'suscripciones', 'uso_mensual', 'empresas',
    'resoluciones', 'certificados', 'empresa_certificados', 'tokens_sii', 'sesiones_sii',
    'cafs', 'solicitudes_folios', 'folios_anulados', 'receptores', 'productos', 'envios',
    'envio_estadisticas', 'consultas_envio', 'documentos', 'documento_detalles',
    'envio_rechazos', 'rcof', 'procesos_certificacion', 'set_pruebas_casos',
    'operaciones_sii', 'api_keys', 'webhooks', 'webhook_entregas'
  ] loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end;
$$;

-- Catálogos: lectura pública.
create policy lectura on public.tipos_dte   for select to anon, authenticated using (true);
create policy lectura on public.estados_sii for select to anon, authenticated using (true);
create policy lectura on public.planes      for select to anon, authenticated using (activo);

-- Perfiles: el propio y los de quienes comparten organización.
create policy lectura on public.perfiles for select to authenticated
  using (id = (select auth.uid()) or public.comparte_organizacion(id));
create policy edicion_propia on public.perfiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Organizaciones (se crean con crear_organizacion()).
create policy lectura on public.organizaciones for select to authenticated
  using (public.es_miembro(id));
create policy edicion on public.organizaciones for update to authenticated
  using (public.es_admin(id)) with check (public.es_admin(id));
create policy borrado on public.organizaciones for delete to authenticated
  using (public.tiene_rol(id, '{propietario}'));

-- Miembros. Solo un propietario nombra o quita propietarios.
create policy lectura on public.miembros_organizacion for select to authenticated
  using (public.es_miembro(organizacion_id));
create policy alta on public.miembros_organizacion for insert to authenticated
  with check (public.es_admin(organizacion_id)
              and (rol <> 'propietario' or public.tiene_rol(organizacion_id, '{propietario}')));
create policy edicion on public.miembros_organizacion for update to authenticated
  using (public.es_admin(organizacion_id)
         and (rol <> 'propietario' or public.tiene_rol(organizacion_id, '{propietario}')))
  with check (public.es_admin(organizacion_id)
              and (rol <> 'propietario' or public.tiene_rol(organizacion_id, '{propietario}')));
create policy baja on public.miembros_organizacion for delete to authenticated
  using (usuario_id = (select auth.uid())
         or (public.es_admin(organizacion_id)
             and (rol <> 'propietario' or public.tiene_rol(organizacion_id, '{propietario}'))));

-- Lectura para todos los miembros de la organización.
do $$
declare
  t text;
begin
  foreach t in array array[
    'suscripciones', 'uso_mensual', 'empresas', 'resoluciones', 'certificados',
    'empresa_certificados', 'cafs', 'solicitudes_folios', 'folios_anulados', 'receptores',
    'productos', 'envios', 'envio_estadisticas', 'consultas_envio', 'documentos',
    'documento_detalles', 'envio_rechazos', 'rcof', 'procesos_certificacion',
    'set_pruebas_casos', 'operaciones_sii'
  ] loop
    execute format(
      'create policy lectura on public.%I for select to authenticated
         using (public.es_miembro(organizacion_id))', t);
  end loop;
end;
$$;

-- Escritura de administradores (configuración de la empresa).
do $$
declare
  t text;
begin
  foreach t in array array[
    'empresas', 'resoluciones', 'empresa_certificados', 'procesos_certificacion'
  ] loop
    execute format(
      'create policy alta on public.%I for insert to authenticated
         with check (public.es_admin(organizacion_id))', t);
    execute format(
      'create policy edicion on public.%I for update to authenticated
         using (public.es_admin(organizacion_id)) with check (public.es_admin(organizacion_id))', t);
    execute format(
      'create policy borrado on public.%I for delete to authenticated
         using (public.es_admin(organizacion_id))', t);
  end loop;
end;
$$;

-- La autorización a producción la fija el sistema (P91), no el usuario.
-- (current_user = postgres cuando la cambia tg_certificacion_autorizada, que es
-- security definer.)
create function public.tg_proteger_autorizacion()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' and current_user <> 'postgres' then
    if tg_op = 'INSERT' then
      new.autorizada_produccion := false;
      new.autorizada_en := null;
    elsif new.autorizada_produccion is distinct from old.autorizada_produccion
       or new.autorizada_en is distinct from old.autorizada_en then
      raise exception 'autorizada_produccion solo la cambia el sistema (estado P91 del SII)';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_05_proteger_autorizacion
  before insert or update on public.empresas
  for each row execute function public.tg_proteger_autorizacion();

-- Los usuarios no avanzan la etapa ni el estado SII a mano: eso lo hace el backend.
create function public.tg_proteger_proceso()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' and current_user <> 'postgres' then
    if tg_op = 'INSERT' then
      new.etapa := 'borrador';
      new.codigo_estado_sii := null;
      new.glosa_estado_sii := null;
      new.paso_sii := null;
    elsif new.etapa is distinct from old.etapa
       or new.codigo_estado_sii is distinct from old.codigo_estado_sii
       or new.paso_sii is distinct from old.paso_sii then
      raise exception 'La etapa y el estado SII solo los cambia el sistema';
    end if;
  end if;
  return new;
end;
$$;

create trigger trg_05_proteger_proceso
  before insert or update on public.procesos_certificacion
  for each row execute function public.tg_proteger_proceso();

-- Emisores: catálogo y borradores. Un documento con folio solo lo toca el backend.
do $$
declare
  t text;
begin
  foreach t in array array['receptores', 'productos'] loop
    execute format(
      'create policy alta on public.%I for insert to authenticated
         with check (public.puede_emitir(organizacion_id))', t);
    execute format(
      'create policy edicion on public.%I for update to authenticated
         using (public.puede_emitir(organizacion_id)) with check (public.puede_emitir(organizacion_id))', t);
    execute format(
      'create policy borrado on public.%I for delete to authenticated
         using (public.es_admin(organizacion_id))', t);
  end loop;
end;
$$;

create policy alta_borrador on public.documentos for insert to authenticated
  with check (public.puede_emitir(organizacion_id) and estado = 'borrador' and folio is null);
create policy edicion_borrador on public.documentos for update to authenticated
  using (public.puede_emitir(organizacion_id) and estado = 'borrador')
  with check (public.puede_emitir(organizacion_id) and estado = 'borrador' and folio is null);
create policy borrado_borrador on public.documentos for delete to authenticated
  using (public.puede_emitir(organizacion_id) and estado = 'borrador');

create policy alta_borrador on public.documento_detalles for insert to authenticated
  with check (public.puede_emitir(organizacion_id) and exists (
    select 1 from public.documentos d where d.id = documento_id and d.estado = 'borrador'));
create policy edicion_borrador on public.documento_detalles for update to authenticated
  using (public.puede_emitir(organizacion_id) and exists (
    select 1 from public.documentos d where d.id = documento_id and d.estado = 'borrador'))
  with check (public.puede_emitir(organizacion_id) and exists (
    select 1 from public.documentos d where d.id = documento_id and d.estado = 'borrador'));
create policy borrado_borrador on public.documento_detalles for delete to authenticated
  using (public.puede_emitir(organizacion_id) and exists (
    select 1 from public.documentos d where d.id = documento_id and d.estado = 'borrador'));

-- Anular folios: administradores.
create policy alta on public.folios_anulados for insert to authenticated
  with check (public.es_admin(organizacion_id));

-- Invitaciones, API keys y webhooks: administradores. Se CREAN con
-- crear_invitacion(), crear_api_key() y crear_webhook(); aquí solo se leen,
-- se editan (columnas permitidas, ver privilegios) y se borran.
do $$
declare
  t text;
begin
  foreach t in array array['invitaciones', 'api_keys', 'webhooks'] loop
    execute format(
      'create policy lectura on public.%I for select to authenticated
         using (public.es_admin(organizacion_id))', t);
    execute format(
      'create policy borrado on public.%I for delete to authenticated
         using (public.es_admin(organizacion_id))', t);
  end loop;
end;
$$;
create policy edicion on public.api_keys for update to authenticated
  using (public.es_admin(organizacion_id)) with check (public.es_admin(organizacion_id));
create policy edicion on public.webhooks for update to authenticated
  using (public.es_admin(organizacion_id)) with check (public.es_admin(organizacion_id));
create policy lectura on public.webhook_entregas for select to authenticated
  using (public.es_admin(organizacion_id));

-- tokens_sii y sesiones_sii: RLS activo y SIN políticas → solo service_role.
-- certificados, cafs, envíos, solicitudes, RCOF, set, operaciones, uso y
-- suscripciones: los escribe solo el backend (service_role).

-- Privilegios: nada de anon fuera de los catálogos; secretos fuera del alcance de la API.
revoke all on public.tokens_sii, public.sesiones_sii from anon, authenticated;
revoke all on all tables in schema public from anon;
grant select on public.tipos_dte, public.estados_sii, public.planes to anon;

-- Columnas editables por los usuarios (el resto, p. ej. clave_hash o
-- secreto_secret_id, no se puede cambiar desde la API).
revoke insert, update on public.api_keys, public.webhooks, public.invitaciones from authenticated;
grant update (nombre, revocada_en, expira_en) on public.api_keys to authenticated;
grant update (url, eventos, activo) on public.webhooks to authenticated;

-- Funciones: solo las necesarias quedan expuestas por la API. Las que usan los
-- CHECK, los dominios, las columnas generadas y las políticas también necesitan
-- EXECUTE para quien escribe o consulta.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function
  public.rut_valido(text),
  public.correo_sii_valido(text),
  public.uuid_o_nulo(text),
  public.clasificar_envio(boolean, text, integer, integer, integer, integer),
  public.es_miembro(uuid),
  public.tiene_rol(uuid, public.rol_miembro[]),
  public.es_admin(uuid),
  public.puede_emitir(uuid),
  public.comparte_organizacion(uuid),
  public.crear_organizacion(text, text),
  public.aceptar_invitacion(text),
  public.crear_invitacion(uuid, text, public.rol_miembro),
  public.crear_api_key(uuid, text, text[], public.ambiente_sii, uuid, timestamptz),
  public.crear_webhook(uuid, text, text[])
to authenticated;
grant execute on function public.rut_valido(text), public.correo_sii_valido(text) to anon;
-- asignar_folio, token_*, guardar_secreto, leer_secreto,
-- sincronizar_documentos_envio y encolar_evento: solo
-- el backend (la emisión firma con la llave del CAF, que vive en Vault).
grant execute on all functions in schema public to service_role;

-- -----------------------------------------------------------------------------
-- 18. Storage
-- -----------------------------------------------------------------------------

-- XML firmados (DTE, EnvioBOLETA, RCOF) y representaciones impresas.
-- Ruta: <organizacion_id>/<empresa_id>/<ambiente>/<archivo>. Los sube el backend.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('documentos-xml', 'documentos-xml', false, 10485760,
        array['application/xml', 'text/xml', 'application/pdf'])
on conflict (id) do nothing;

create policy "documentos-xml: lectura de miembros"
  on storage.objects for select to authenticated
  using (bucket_id = 'documentos-xml'
         and public.es_miembro(public.uuid_o_nulo((storage.foldername(name))[1])));

-- -----------------------------------------------------------------------------
-- 19. Realtime (panel en vivo de envíos y documentos)
-- -----------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime
      add table public.documentos, public.envios, public.procesos_certificacion;
  end if;
end;
$$;

commit;

-- -----------------------------------------------------------------------------
-- Opcional: seguimiento automático con pg_cron + pg_net (habilitar las
-- extensiones en el panel). Llama cada 5 minutos a una Edge Function que lee
-- v_envios_por_consultar y consulta el SII con un solo token por empresa.
-- -----------------------------------------------------------------------------
-- select cron.schedule(
--   'seguimiento-envios', '*/5 * * * *',
--   $$ select net.http_post(
--        url     := 'https://<proyecto>.supabase.co/functions/v1/seguimiento',
--        headers := jsonb_build_object('Authorization', 'Bearer ' ||
--                     (select decrypted_secret from vault.decrypted_secrets where name = 'cron_token'))
--      ); $$
-- );
-- select cron.schedule('limpiar-tokens', '0 * * * *',
--   $$ delete from public.tokens_sii where vence_en < now() - interval '1 day' $$);
