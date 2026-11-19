---
title: "Nota para la revisión legal de términos y privacidad"
description: "Qué revisar en /legal/terminos y /legal/privacidad antes del lanzamiento: compromisos agregados sin decisión del titular, plazos de la Ley 21.719, transferencias internacionales, boleta por cada cobro, eliminación de cuenta, tribunales y aceptación tácita."
keywords: [revisión legal, términos, privacidad, Ley 19.628, Ley 21.719, Ley 19.496, abogado, lanzamiento, Fase 12, Fase 13]
source: ["apps/web/src/app/(publico)/legal/terminos/page.tsx", "apps/web/src/app/(publico)/legal/privacidad/page.tsx", "apps/web/src/lib/legal.ts"]
---

# Nota para la revisión legal de términos y privacidad

Preparada el 2026-11-19 para el abogado que revise los textos antes del lanzamiento. No es
una opinión legal: lista lo que conviene revisar y por qué, para que la revisión sea corta.
Las páginas publicadas están en <https://boleteame.dev/legal/terminos> y
<https://boleteame.dev/legal/privacidad> (vigencia 19-11-2026); cada punto indica la
sección (el ancla de la URL).

## Contexto en una línea

Boletéame es un SaaS que firma con el certificado digital del cliente y envía al SII sus
boletas electrónicas (tipos 39 y 41). Lo opera una **persona natural** (identificada en las
páginas con nombre, RUT y domicilio, según `apps/web/src/lib/legal.ts`). Los clientes son
mayoritariamente empresas y contadores, pero puede haber personas que califiquen como
consumidores. El cobro mensual lo hace Flow.

## 1. Compromisos que se escribieron sin una decisión del titular

Quedaron en el texto como propuesta. Confirmar o cambiar cada uno:

| Compromiso | Dónde | Pregunta |
|---|---|---|
| Aviso de al menos **15 días** antes de un cambio importante de los términos | Términos `#cambios` | ¿Plazo adecuado? |
| Aviso de al menos **30 días** antes de terminar el servicio (salvo incumplimiento grave) | Términos `#termino` | ¿Plazo adecuado? |
| Aviso por correo con al menos **30 días** antes de un cambio de precio, con derecho a cancelar antes de que rija | Términos, «Planes, precios y pagos» | ¿Plazo adecuado? |
| Tope de responsabilidad: lo pagado en los **tres meses** anteriores al hecho, salvo dolo o culpa grave y sin limitar derechos irrenunciables de la Ley 19.496 | Términos «Limitación de responsabilidad» | ¿Es exigible frente a consumidores (art. 16 de la Ley 19.496, cláusulas abusivas)? ¿Conviene un monto distinto? |

## 2. Aceptación tácita de cambios

Términos `#cambios`: «si sigues usando el servicio después, se entiende que aceptas la nueva
versión». Revisar si el silencio o el uso pueden valer como aceptación frente a consumidores
y si hace falta una aceptación expresa en el panel.

## 3. Ley 21.719 (protección de datos personales)

- **Vigencia:** el texto ya cita la Ley 21.719 como modificación de la Ley 19.628. Confirmar
  la fecha en que entra a regir y si la política debe distinguir el régimen actual del nuevo.
- **Plazo de respuesta a los derechos** (Privacidad `#derechos`): dice «dentro del plazo
  que fija la ley», sin cifra. Indicar el plazo exacto (y su prórroga) para escribirlo.
- **Agencia de Protección de Datos Personales:** se menciona como instancia de reclamo.
  Confirmar el nombre y si ya está operativa a la fecha de lanzamiento.
- **Bases de licitud** (Privacidad «Para qué los usamos»): revisar que cada finalidad tenga
  su base (contrato, obligación legal, interés legítimo) y que el interés legítimo esté bien
  usado.
- **Responsable y encargado** (Privacidad «Cuándo somos responsables y cuándo encargados»):
  Boletéame es encargado de los datos de los receptores de las boletas que trata por cuenta
  del cliente. Revisar si hace falta un contrato o anexo de tratamiento de datos (DPA) con
  los clientes, aparte de los términos.
- **Canal para ejercer derechos:** no hay casilla de correo en el dominio. El canal es el
  formulario de contacto con el motivo «Privacidad y datos personales» ya elegido
  (`/contacto?motivo=privacidad`). Confirmar que basta o si debe publicarse un correo.

## 4. Transferencias internacionales

Privacidad «Transferencias internacionales»: base de datos y aplicación en São Paulo
(Brasil); proveedores con sede en EE. UU. (Supabase, Vercel, Resend, Cloudflare, Sentry). El
texto dice «Al usar Boletéame, tus datos se transfieren a esos países con esas garantías».
Revisar si eso cumple los requisitos de transferencia internacional de la Ley 21.719 (países
adecuados, cláusulas contractuales, consentimiento) y si la frase debe redactarse distinto.

## 5. Eliminación de la cuenta y conservación

- No existe un botón para eliminar la cuenta ni la organización desde el panel: se pide
  escribiendo (Términos `#termino`, Privacidad «Cuánto tiempo conservamos los datos»).
  Confirmar que un canal escrito basta.
- Conservación de documentos tributarios: el texto atribuye la obligación al contribuyente
  emisor (arts. 17 y 200 del Código Tributario, hasta seis años) y recomienda descargar los
  XML y PDF antes de pedir la eliminación. Confirmar la redacción y si Boletéame debe
  conservar algo por su cuenta.
- Respaldos: el texto es genérico («se renuevan periódicamente»), porque no está
  documentada la retención exacta de los respaldos del proveedor de base de datos.

## 6. Documento tributario por cada cobro

Términos, sección de planes: «Por cada cobro emitiremos el documento tributario que
corresponda». **Hoy el sistema no lo hace** (pendiente para la Fase 13). Siendo el titular
una persona natural, confirmar qué documento corresponde (boleta de ventas y servicios u
otro, según su inicio de actividades) y si la frase puede quedar así hasta implementarlo.

## 7. Ley aplicable y tribunales

Términos `#ley-aplicable`: «tribunales ordinarios de justicia competentes de Chile», sin
ciudad, porque al redactarlo no se conocía el domicilio. Con el domicilio ya publicado (Las
Condes), decidir si se fija la competencia en los tribunales de Santiago, sin perjuicio de
las reglas de la Ley 19.496 para consumidores.

## 8. Otros puntos a mirar

- **Identificación del titular:** las páginas muestran nombre, RUT y domicilio de una
  persona natural. Confirmar que es la forma correcta de identificar al proveedor y al
  responsable, o si conviene operar con una sociedad antes del lanzamiento.
- **Menores de edad** (Privacidad `#menores`) y **cookies** (solo de sesión y
  preferencias, sin analítica): revisar la redacción.
- **Descargo del SII:** el pie y los términos dicen que Boletéame no está afiliado al
  Servicio de Impuestos Internos. Confirmar que basta.

## Después de la revisión

Los cambios de texto se hacen en `apps/web/src/app/(publico)/legal/terminos/page.tsx` y
`privacidad/page.tsx`, y los datos del titular en `apps/web/src/lib/legal.ts`. Al cambiar los
términos o la política, actualizar `VIGENCIA_TERMINOS` o `VIGENCIA_PRIVACIDAD` en ese mismo
archivo y, si el cambio es importante, avisar a los clientes con la anticipación que fije la
sección `#cambios`.
