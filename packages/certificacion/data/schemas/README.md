# Esquemas XSD del SII

Pertenecen al Servicio de Impuestos Internos y se redistribuyen solo como
referencia, igual que en `winex/certificacion` (ver `NOTICE` y `PLAN-MIGRACION.md` §11).
Los usa `paridad/php/validar-xsd.php` (ver `paridad/README.md`). Se versionan tal
cual (`data/** -text` en `.gitattributes`): no convertir codificación ni saltos de línea.

Página oficial de formatos: <https://www.sii.cl/servicios_online/3532-formato_xml-3811.html>
("Formato XML de Documentos Electrónicos").

| Archivo | Procedencia | SHA-256 |
|---|---|---|
| `EnvioBOLETA_v11.xsd` | Copiado de `certificacion-core/data/schemas/` (v1.9.1) | `0601ec800e899f5060954078a7b62e6f54f127fa416a70bd60265f45fd485db0` |
| `xmldsignature_v10.xsd` | Copiado de `certificacion-core/data/schemas/` (v1.9.1) | `839622a27323e41d529a4dcd5b8bd84887e77660ee7510e139ce7831b20fe599` |
| `ConsumoFolio_v10.xsd` | <https://www.sii.cl/factura_electronica/factura_mercado/ConsumoFolio_v10.xsd>, descargado el 2026-11-06 (enlace "Bajar schema XML de Resumen de Ventas Diarias (Ex Reporte de Consumo de Folios)"; `Last-Modified: Tue, 04 Mar 2025`). Bytes sin modificar (ISO-8859-1, CRLF) | `ab56a92683a32f8621203b5416ebd0787bb50935bd34e3eef98c54ba25387cfc` |
| `SiiTypes_v10.xsd` | Lo incluye `ConsumoFolio_v10.xsd`. Extraído de <https://www.sii.cl/factura_electronica/factura_mercado/schema_dte.zip> (descargado el 2026-11-06; `Last-Modified: Fri, 20 Feb 2026`; dentro del zip, fecha 2026-02-19). Bytes sin modificar | `ce9a84bde70aa9d0f9269d99acd3b0ea81d868022517ac31064b6cdfa0c45bdf` |

`ConsumoFolio_v10.xsd` importa `xmldsignature_v10.xsd` e incluye `SiiTypes_v10.xsd`;
`EnvioBOLETA_v11.xsd` solo importa `xmldsignature_v10.xsd` (trae sus tipos en línea).

## Diferencias de las copias del core con las oficiales

Comparadas el 2026-11-06 con las de
<https://www.sii.cl/factura_electronica/factura_mercado/schema_envio_bol.zip>
(`EnvioBOLETA_v11.xsd` con fecha 2024-12-05 dentro del zip; su `xmldsignature_v10.xsd`
es idéntico al de `schema_dte.zip`): las copias del core son las oficiales con las
tildes y la Ñ de los comentarios y de `xs:documentation` pasadas a ASCII ("N°" quedó
"N"), saltos de línea LF en vez de CRLF y sin blancos al final de línea. No hay
diferencias en la definición de elementos, tipos ni restricciones, así que validan lo
mismo; se dejaron como estaban.

## Notas

- `ConsumoFolio_v10.xsd` exige `ds:Signature` al final de `ConsumoFolios`: solo valida
  un RCOF firmado.
- El SII eliminó la obligación de enviar el RCOF a partir del 1 de agosto de 2022 (sigue
  solo para períodos hasta julio de 2022). El esquema se conserva para la paridad con el
  PHP y para esos períodos.
- El SII hoy lo llama "Resumen de Ventas Diarias (Ex Reporte de Consumo de Folios)";
  el esquema sigue siendo `ConsumoFolio_v10.xsd`. Descripción del formato:
  <https://www.sii.cl/factura_electronica/factura_mercado/resumen_ventas_diarias_0720.pdf>.
