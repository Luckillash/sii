import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

// Catálogo interno del design system (PLAN-SAAS Fase 1): solo existe en desarrollo.
// La carpeta `%5Fds` publica la ruta `/_ds` (una carpeta `_ds` sería privada en App Router).
//
// Sin layout.tsx a propósito: `next dev` tipa el layout de una carpeta `%5F…` como
// "/%5Fds" y `next build` como "/_ds", y esos tipos chocan en el typecheck. Por eso cada
// página llama a `soloDesarrollo()`.

export const metadataDs: Metadata = {
  title: 'Design system · Boletéame',
  robots: { index: false, follow: false },
};

export function soloDesarrollo(): void {
  if (process.env.NODE_ENV === 'production') notFound();
}
