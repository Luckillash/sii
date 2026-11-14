---
title: "Firma XML, timbre (TED) y codificación"
description: "XML-DSig, C14N, ISO-8859-1, el TED firmado con la llave del CAF y los reparos que evita la librería."
keywords: [FirmaElectronica, firmarDte, firmarSemilla, Timbre, generarTed, ArmadorBoleta, EnvioBoleta, XML-DSig, RSA-SHA1, C14N, ISO-8859-1, TED, DD, FRMT, RSASK, TSTED, TmstFirma, SetDoc, "#F{folio}T39", reparo 510, RFR, ErrorFirma, ErrorTimbre, aIso88591, desdeIso88591, 66666666-6]
related: ["04-objetos/objetos-xml-y-json.md", "02-guias/emision-boletas.md"]
source: ["certificacion-node/docs/core.md"]
---

# Firma XML, timbre (TED) y codificación

> **Úsalo cuando:** necesitas entender qué se firma, con qué llave, o de dónde viene un reparo de firma.

Todo esto lo hace `@winex/certificacion` (detalle en `packages/certificacion/docs/core.md`).
La app **no reimplementa** firma ni timbre (principio de paridad): carga el certificado y el
CAF desde Vault y llama a la librería en el servidor.

## Dos llaves, dos firmas

| Firma | Llave | Algoritmo | Qué firma |
|---|---|---|---|
| **TED** (timbre) | `<RSASK>` del **CAF** (Vault, `caf_secret_id`) | SHA1withRSA sobre el `<DD>` aplanado en ISO-8859-1 | Datos clave del documento: emisor, tipo, folio, fecha, receptor, monto, primer ítem |
| **XML-DSig** del DTE, del sobre y del RCOF | Llave del **certificado** (.pfx en Vault) | RSA-SHA1 (PKCS#1 v1.5), digest SHA1, C14N 1.0 inclusivo | `Documento`, `SetDTE` o `DocumentoConsumoFolios` |
| Semilla REST | Certificado | La misma XML-DSig | `<getToken>` para el token (SOAP usa `firmarSemillaDtews`, propia del PHP) |

## Flujo de una boleta

```
ArmadorBoleta.armar(datos, caf)
  → GeneradorBoleta: <DTE> sin TED ni firma (ISO-8859-1)
  → Timbre.generarTed: <TED> firmado con la llave del CAF
  → inserta TED + <TmstFirma> antes de </Documento> (sobre los bytes)
  → firmarDte('#F{folio}T{tipo}')                      → DTE firmado (Buffer)
EnvioBoleta.empaquetar([dtes]) → <EnvioBOLETA> firmado con '#SetDoc' → ClienteBoletaRest / ClienteDtews
```

- **Un solo reloj por boleta**: `FchEmis`, `<FE>`, `<TSTED>` y `<TmstFirma>` coinciden, en
  hora de Chile.
- La referencia por defecto de `firmarDte` es `#F1T33` (factura, herencia del PHP): para
  boletas pasa siempre `#F{folio}T39` o `#F{folio}T41`.

## El TED

| Campo | Elemento | Regla |
|---|---|---|
| RUT emisor | `<RE>` | tal cual |
| Tipo, folio | `<TD>`, `<F>` | |
| Fecha | `<FE>` | `YYYY-MM-DD` |
| RUT receptor | `<RR>` | `66666666-6` si no hay receptor identificado |
| Razón social receptor | `<RSR>` | escapada, sin truncar |
| Monto total | `<MNT>` | debe calzar con `<MntTotal>` del DTE |
| Primer ítem | `<IT1>` | primeros 40 caracteres; debe calzar con el primer `<NmbItem>` |

El `<CAF>` se copia **tal cual** (sin reserializar, para no alterar el `<DA>` firmado por el
SII). Resultado: `<TED version="1.0">{DD}<FRMT algoritmo="SHA1withRSA">…</FRMT></TED>`.
El TED también va impreso como PDF417 en la representación impresa (`server/pdf/`, Fase 7).

## Codificación ISO-8859-1

- Lo que se firma o envía sale como **`Buffer` en ISO-8859-1**: guárdalo en Storage y
  envíalo **tal cual** (`AlmacenDocumentos`, `content-type: application/xml` sin `charset`).
  Convertirlo a string y de vuelta rompe la firma.
- Los caracteres fuera de ISO-8859-1 salen como `&#N;` en el DTE y como `?` en el TED. Por
  eso los textos de la empresa se limitan a ISO-8859-1 desde la Fase 3.
- Si necesitas el TED como texto: `desdeIso88591(ted)` y de vuelta con `aIso88591`.
- `firmarDte` devuelve los bytes sin formatear y **sin salto de línea final**: no los
  reformatees.

## Reparos y errores que evita o lanza

| Síntoma | Causa | Lo que hace la librería |
|---|---|---|
| Reparo 510 (firma del TED incorrecta) | `<DD>` con espacios entre etiquetas | Aplana `>\s+<` → `><` antes de firmar |
| RFR (rechazo por firma) con tildes | Firma calculada sobre UTF-8 | Firma sobre los bytes ISO-8859-1 |
| `ErrorFirma` | XML inválido, nodo inexistente («No se encontró el nodo … para aplicar la firma.»), URI vacía o el sistema bloquea SHA1 | Lanza; su traducción a `resultado_operacion` está en [errores](errores-y-resultados.md) |
| `ErrorTimbre` | CAF sin `<CAF>`, `<RSASK>`, `<DA>`, `<RE>`, `<TD>` o `<RNG>`, o llave ilegible | Lanza |
| `ErrorValidacion` | Campo numérico que no es entero seguro, o texto fuera de ISO-8859-1 en el sobre | Lanza |

Defecto conservado por paridad: el `SignedInfo` firmado declara `xmlns:xsi` y el transmitido
no; el SII lo acepta.
