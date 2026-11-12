// Preferencias del usuario guardadas en `perfiles` (migración 0003_preferencias).
// Puro: lo usan el selector de tema (cliente) y `obtenerPerfil()` (servidor).

/** Valores de `perfiles.tema` (check de la columna). `sistema` sigue al sistema operativo. */
export const TEMAS = ['sistema', 'claro', 'oscuro'] as const;

export type Tema = (typeof TEMAS)[number];

export const ETIQUETA_TEMA: Record<Tema, string> = {
  sistema: 'Según el sistema',
  claro: 'Claro',
  oscuro: 'Oscuro',
};

export function esTema(valor: unknown): valor is Tema {
  return typeof valor === 'string' && (TEMAS as readonly string[]).includes(valor);
}
