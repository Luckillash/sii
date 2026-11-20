---
title: "E2E del flujo crítico con el SII falso"
description: "Cómo correr la prueba Playwright que recorre registro, organización, empresa, certificado, certificación, folios, emisión y seguimiento contra un SII simulado, qué escribe en la base y cómo se limpia."
keywords: [e2e, Playwright, flujo crítico, Fase 13, SII falso, simulador, E2E_FLUJO, E2E_SII_FALSO_URL, E2E_PUERTO, E2E_SII_PUERTO, sii-falso.ts, flujo-critico.spec.ts, crearTransporte, TransporteFalso, next dev, Turnstile claves de prueba, resend.dev, delivered+, e2e-flujo-, limpieza, Vault, Storage, documentos-xml, cron seguimiento-envios, P90, P91, CAF de mentira, pfx de mentira]
related: ["05-pruebas/ambiente-certificacion.md", "05-pruebas/set-de-pruebas.md", "05-pruebas/probar-el-esquema.md", "02-guias/certificacion-empresa.md", "02-guias/folios-caf.md"]
source: ["apps/web/e2e/flujo-critico.spec.ts", "apps/web/e2e/soporte/sii-falso.ts", "apps/web/e2e/soporte/supabase.ts", "apps/web/playwright.config.ts", "apps/web/src/server/sii/sii-falso.ts", "apps/web/src/server/sii/transporte.ts"]
---

# E2E del flujo crítico con el SII falso

> **Úsalo cuando:** quieres comprobar de punta a punta que la app sigue funcionando
> (PLAN-SAAS Fase 13, punto 2) sin tocar el SII.

`apps/web/e2e/flujo-critico.spec.ts` recorre, en un navegador y contra un `next dev`
propio, todo lo que hace un cliente nuevo:

| Paso | Qué hace la prueba | Qué responde el SII falso |
|---|---|---|
| Registro | `/crear-cuenta` con `delivered+e2e-flujo-…@resend.dev`; si la confirmación de correo está activa, la confirma con la API de administración e ingresa por `/ingresar` | — |
| Organización | `/bienvenida`, slug `e2e-flujo-…` | — |
| Empresa | `/configuracion/empresas/nueva`, RUT 76.123.456-0 | — |
| Certificado | `.pfx` de MENTIRA generado con node-forge (titular 11.111.111-1 en el subjectAltName), asociado a la empresa como representante y predeterminado | — |
| Certificación 1 | datos de la postulación y «Postular en el SII» | portal vigente, login AUT2000, `pe_*` (repite los datos y acepta) |
| Certificación 2 | «Descargar el set de pruebas» | estado sin trámite y un set de 2 casos |
| Certificación 3 | folios del set, «Enviar el set al SII» y consulta del estado | CAF de MENTIRA (IDK 100), semilla, token, Track ID y EPR |
| Certificación 4 | «Solicitar revisión» y consulta del estado | `ingresarTrackId` y, al tiro, P90 |
| Certificación 5 | datos de la declaración y «Declarar cumplimiento» | `autorizarEmpresaBolProd` y P91 |
| Folios | `/folios`, 5 folios de boleta en certificación | otro CAF de MENTIRA |
| Emisión | `/emitir`, una boleta en certificación | Track ID |
| Seguimiento | `/documentos`, «Consultar estado en el SII» de esa boleta | EPR: queda «Aceptado» |

Al final exige que el simulador haya visto los cinco hosts de certificación y que no haya
quedado ninguna petición sin respuesta ni hacia producción.

## Cómo correrla

Desde la raíz del monorepo, con `apps/web/.env.local` completo y la librería compilada
(`pnpm build:libreria`):

```bash
E2E_FLUJO=1 pnpm --filter web test:e2e
```

En PowerShell: `$env:E2E_FLUJO='1'; pnpm --filter web test:e2e`. Tarda unos 4 minutos
(más si tiene que esperar la ventana del cron, ver abajo).

Con `E2E_FLUJO=1`, `playwright.config.ts`:

- corre **solo** `flujo-critico.spec.ts`, en un proyecto (`claro`) y sin reintentos;
- levanta su **propio** `next dev` en el puerto 3117 (`E2E_PUERTO`) y nunca reutiliza uno
  abierto. Next 16 admite un solo `next dev` por proyecto (`.next/dev/lock`): si hay otro
  corriendo en `apps/web`, ciérralo antes;
- le pasa `E2E_SII_FALSO_URL=http://127.0.0.1:3197` (`E2E_SII_PUERTO`), las claves de
  PRUEBA de Turnstile de Cloudflare (siempre pasan; el widget igual se carga desde
  `challenges.cloudflare.com`, así que el navegador necesita red) y
  `NEXT_PUBLIC_SENTRY_DSN` vacío.

Sin `E2E_FLUJO=1` la prueba se omite: `pnpm --filter web test:e2e` normal no escribe en la
base.

## El SII falso

- **En la app** (`src/server/sii/sii-falso.ts`): con `E2E_SII_FALSO_URL`,
  `crearTransporte()` reenvía cada petición al simulador en vez de salir a la red. Es el
  único punto por donde la capa SII sale al SII, así que cubre certificación, folios,
  emisión y seguimiento. Candados, probados en `sii-falso.test.ts`: se ignora en Vercel
  (`VERCEL` / `VERCEL_ENV`, cualquier ambiente); con `NODE_ENV=production` (build local)
  lanza en vez de usar el SII real; solo acepta `http://` hacia loopback; el certificado
  de cliente (`tls`) nunca viaja al simulador.
- **En la prueba** (`e2e/soporte/sii-falso.ts`): servidor HTTP en 127.0.0.1 con las
  páginas sintéticas de la paridad de la librería (`packages/certificacion/paridad`) y las
  respuestas GWT de los tests de la CLI. Guarda el estado de la declaración (sin trámite →
  P90 al pedir la revisión → P91 al declarar), los folios timbrados por RUT y tipo, y los
  envíos por Track ID (el estado devuelve EPR con los documentos que traía el sobre).
  Cualquier host fuera de certificación (palena, `api.sii.cl`, rahue…) responde error y
  queda en `desconocidas`.

## Qué escribe y cómo se limpia

La base es producción. La prueba crea una cuenta, una organización con su empresa, el
certificado y dos CAF (en Vault), documentos y envíos de certificación, y archivos en el
bucket `documentos-xml`. Todo lleva el prefijo `e2e-flujo-` (slug y nombre de la
organización; la cuenta es `delivered+e2e-flujo-…@resend.dev`, la bandeja de prueba de
Resend, así que los correos de Auth y de las notificaciones no rebotan).

`e2e/soporte/supabase.ts` (`limpiar()`, con la clave secreta de `.env.local`) corre
**antes** (lo que haya dejado una corrida cortada) y **después**, pase o falle: borra los
archivos de Storage bajo cada organización `e2e-flujo-*`, la organización (la cascada se
lleva empresas, certificados, CAF, documentos, envíos y operaciones; `trg_borrar_secretos`
borra sus secretos de Vault) y las cuentas `delivered+e2e-flujo-*@resend.dev`. La salida
imprime cuánto borró y el resumen de lo que atendió el simulador (método, host, ruta y
método GWT; nunca cuerpos).

Para comprobar a mano que no quedó nada (solo lectura):

```sql
select
  (select count(*) from public.organizaciones where slug like 'e2e-flujo-%') as organizaciones,
  (select count(*) from auth.users where email like 'delivered+e2e-flujo-%@resend.dev') as cuentas,
  (select count(*) from storage.objects o
     where o.bucket_id = 'documentos-xml'
       and not exists (select 1 from public.organizaciones g
                       where g.id::text = split_part(o.name, '/', 1))) as archivos_huerfanos;
```

## El cron de seguimiento de Production

`seguimiento-envios` (pg_cron, cada 5 minutos en :00, :05…) consulta los envíos nuevos de
**toda** la base desde el deploy de Production, que usa el SII real. Para que nunca alcance
a ver un envío de la prueba, el envío del set y la emisión se hacen entre los segundos 20 y
150 del ciclo de 5 minutos (`lejosDelCron`), y la prueba los consulta enseguida, con lo que
quedan en un estado final (EPR) antes del siguiente minuto múltiplo de 5. Si la prueba se
corta justo entre el envío y la consulta, la limpieza del `afterAll` borra el envío en
segundos.

## Lo que no cubre

- El enlace de confirmación del correo: se confirma con la API de administración.
- El SII real: las páginas y respuestas son sintéticas (las de la paridad). La integración
  real sigue siendo manual ([ambiente de certificación](ambiente-certificacion.md)).
- Producción: folios y emisión van en certificación (el plan `certificacion` tampoco deja
  emitir en producción).
- Rechazos, reparos, `incierto` y reintentos: se prueban con Vitest y dobles.
