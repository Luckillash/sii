// Redirecciones después de ingresar o de abrir un enlace de correo (`?siguiente=`).
// Puro: lo usan el proxy, el callback de Auth y las pantallas (cliente o servidor).

// Origen ficticio para resolver rutas relativas: si al resolver cambia, la ruta
// apuntaba fuera de la app.
const ORIGEN_INTERNO = 'http://timbre.invalid';
const LARGO_MAXIMO = 2048;

/**
 * Devuelve `siguiente` solo si es una ruta interna de la app; si no, `porDefecto`.
 * Evita el *open redirect* (`/ingresar?siguiente=https://otro.sitio`).
 *
 * Se acepta: empieza con `/` y, al resolverla, queda en el mismo origen. Se rechaza:
 * vacía, `//host`, `/\host`, cualquier `\`, esquemas (`https:`, `javascript:`),
 * caracteres de control o espacios (el navegador borra tabulaciones y saltos de línea,
 * y `/\t/host` terminaría en `//host`) y rutas de más de 2048 caracteres.
 *
 * La ruta se devuelve normalizada (`pathname + search + hash`), sin `..` ni `.`.
 */
export function destinoSeguro(
  siguiente: string | null | undefined,
  porDefecto = '/bienvenida',
): string {
  if (typeof siguiente !== 'string' || siguiente.length === 0) return porDefecto;
  if (siguiente.length > LARGO_MAXIMO) return porDefecto;
  if (!siguiente.startsWith('/') || siguiente.startsWith('//')) return porDefecto;
  if (siguiente.includes('\\')) return porDefecto;
  // biome-ignore lint/suspicious/noControlCharactersInRegex: se buscan justamente los de control.
  if (/[\u0000- \u007f]/.test(siguiente)) return porDefecto;

  let url: URL;
  try {
    url = new URL(siguiente, ORIGEN_INTERNO);
  } catch {
    return porDefecto;
  }
  if (url.origin !== ORIGEN_INTERNO) return porDefecto;

  const ruta = `${url.pathname}${url.search}${url.hash}`;
  // Tras normalizar (p. ej. `/.//host` → `//host`) vuelve a revisar.
  return ruta.startsWith('//') ? porDefecto : ruta;
}
