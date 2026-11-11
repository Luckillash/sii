# certificacion-node

Port a Node.js/TypeScript de [`winex/certificacion`](https://github.com/Winexnix/certificacion-core)
v1.9.1: integración con el SII de Chile (firma electrónica, TED/CAF, boleta electrónica,
canales SOAP/REST, folios y postulación).

**Estado:** fases 0 a 6 de [`PLAN-MIGRACION.md`](PLAN-MIGRACION.md) listas: firma y
certificado, TED/CAF, boleta, `EnvioBOLETA`, canales SOAP y REST, solicitud de folios,
postulación y declaración, todo en paridad byte a byte con el PHP y validado contra el SII
de certificación (certificación aprobada, set aceptado por SOAP y REST, CAF obtenido con
Node). La CLI `sii` (fase 7) está lista, con sus consultas validadas en certificación. Falta el
piloto en producción (fase 8).

El RCOF (Resumen de Ventas Diarias, ex Reporte de Consumo de Folios) está portado por
paridad, pero el SII eliminó la obligación de enviarlo desde el **1 de agosto de 2022**;
solo aplica a períodos hasta julio de 2022.

## Documentación

Índice completo en [`docs/README.md`](docs/README.md). Para empezar:
[guía de uso](docs/guia-de-uso.md), [CLI](docs/cli.md),
[configuración](docs/configuracion.md) y [solución de problemas](docs/solucion-de-problemas.md).

## Requisitos

- Node.js ≥ 22.19 (lo exige undici 8; se desarrolla con 24 LTS)
- pnpm (`corepack enable pnpm`)
- Solo para regenerar los esperados de paridad: PHP 8.3 + Composer, con
  `../certificacion-core` instalado (`composer install`)

## Comandos

```
pnpm install
pnpm test               # unitarios + paridad (no necesita PHP)
pnpm typecheck
pnpm lint
pnpm build
pnpm paridad:generar    # regenera paridad/esperados/ con el core PHP
pnpm humo:tls           # prueba de humo TLS contra los hosts de certificación del SII
node scripts/validar-certificacion.ts   # set de pruebas en certificación (ver docs/certificacion.md)
node scripts/solicitar-folios.ts        # CAF de certificación (maullin) con el certificado
```

## CLI

```
pnpm sii --ayuda                              # desde el código fuente (sin compilar)
node apps/cli/dist/main.js --ayuda            # compilada (binario `sii`)
pnpm sii certificacion enviar-set --ayuda     # ayuda de cada comando
```

Comandos: `sii certificacion` (`postular`, `descargar-set`, `solicitar-folios`,
`enviar-set`, `estado-envio`, `solicitar-revision`, `verificar-portal`,
`estado-declaracion`, `declarar`, `enviar-rcof`), `sii produccion` (`emitir`,
`consultar`, `seguimiento`) y `sii util` (`firmar-semilla`, `verificar-ted`).
`solicitar-folios --ambiente produccion` pide folios reales en palena. Detalle en
[docs/cli.md](docs/cli.md); piloto en producción en
[docs/piloto-produccion.md](docs/piloto-produccion.md).

- La configuración se toma del `.env` (ver `.env.example`) y las opciones de la línea de
  comandos la reemplazan.
- Todo lo que graba algo en el SII o emite en producción exige `--confirmar`. Sin esa
  opción, el comando solo valida y muestra lo que haría.
- Códigos de salida: 0 OK · 1 error · 2 uso · 3 config · 4 red (reintentable) · 5 rechazo
  del SII · 6 incierto (revisar el SII antes de repetir) · 7 verificación fallida.

## Estructura

```
packages/core/   @winex/certificacion (la librería)
apps/cli/        CLI `sii` (fase 7)
paridad/         golden tests contra el PHP (ver paridad/README.md)
data/            XSD y set de pruebas del SII
scripts/         humo TLS y validación en certificación (validar-certificacion, solicitar-folios, revisar-env, estado-crudo)
docs/            documentación (índice en docs/README.md)
```

## Licencia

Apache-2.0. Obra derivada de `winex/certificacion` © 2026 Meniaz (William Menares);
ver [`LICENSE`](LICENSE) y [`NOTICE`](NOTICE).
