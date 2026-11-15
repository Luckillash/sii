-- =============================================================================
-- 0010 · Operación `verificar_autorizacion` (PLAN-SAAS Fase 5, «Verificar
-- autorización en el SII»)
--
-- Por qué: la Server Action `verificarAutorizacion` (server/certificacion/
-- autorizacion.ts) consulta en el SII, con el certificado de la empresa, si la empresa
-- ya está autorizada a emitir y con qué resolución (`ConsultaAutorizacion` de la
-- librería: página «Actualización de datos del contribuyente», ad_empresa, en palena) y,
-- en la misma operación, su historial de timbraje en la consulta pública STC
-- (`SituacionTributaria`). Cada operación que sale al SII deja una fila en
-- `operaciones_sii`, y su `operacion` es el enum `operacion_sii`, que no tiene un valor
-- para esta consulta.
--
-- 1. `operacion_sii` gana el valor `verificar_autorizacion`, al final (después de
--    `seguimiento`). Es de LECTURA (🔁): no entra en `OPERACIONES_QUE_GRABAN` ni en
--    `OPERACIONES_EFECTO_GLOBAL` (apps/web/src/server/sii/operacion.ts), así que el
--    índice único parcial `operaciones_sii_efecto_global_en_curso` (0007) NO cambia: su
--    predicado nombra los valores uno por uno (`solicitar_folios`, `postular`,
--    `declarar`) y dos verificaciones simultáneas de la misma empresa no chocan.
--    La fila va con `ambiente = 'produccion'` (la consulta es en palena; el resto del
--    asistente de certificación usa `certificacion`). Lo que la consulta registra
--    después (la resolución con `registrar_resolucion`, 0005; la marca de autorización
--    con el trigger de la 0009) ya existe: no hacen falta funciones nuevas.
--
-- `alter type ... add value` dentro de una transacción está permitido desde PostgreSQL 12;
-- el valor nuevo no se usa en esta misma transacción (no se puede hasta el commit).
-- `if not exists` la deja idempotente.
--
-- Aditiva: un valor de enum. Sin tablas, columnas, funciones, políticas ni grants. No se
-- puede deshacer con un `drop` (Postgres no quita valores de un enum); si hiciera falta,
-- el valor simplemente queda sin uso.
-- =============================================================================

begin;

alter type public.operacion_sii add value if not exists 'verificar_autorizacion' after 'seguimiento';

comment on type public.operacion_sii is
  'Operaciones que salen al SII, una por comando de la CLI (y lo que el backend haga en su nombre). verificar_autorizacion (0010): consulta de solo lectura en palena (ad_empresa) + STC; no es de efecto global.';

commit;
