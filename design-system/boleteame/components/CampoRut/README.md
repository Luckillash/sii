# CampoRut

Campo de texto para un RUT chileno que acepta cualquier formato al escribir, lo normaliza a `12.345.678-5` al salir del campo y valida el dígito verificador con módulo 11.

**Le pasas:** `etiqueta` (por defecto «RUT»; usa «RUT del receptor», «RUT de la empresa»), `value` + `onChange(valor, valido)` si lo controlas o `defaultValue` si no, `ayuda` bajo el campo y `error` para errores que vienen del servidor (p. ej. «Este RUT no está autorizado como emisor electrónico»).

- Valida al salir del campo, no mientras se escribe: nadie quiere un error rojo a mitad de un número.
- El error de dígito verificador lo escribe el componente; los errores de negocio (contribuyente inexistente, sin inicio de actividades) se los pasas en `error` tras consultar al servidor.
- Acepta `K` mayúscula o minúscula y la guarda en mayúscula.
- Las utilidades `CampoRut.formatear(rut)` y `CampoRut.validar(rut)` (también en `Boleteame.utils`) sirven para tablas y validación en el servidor.
