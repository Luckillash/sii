import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

// Catálogo interno del design system (PLAN-SAAS Fase 1). Solo existe en desarrollo:
// la carpeta `%5Fds` publica la ruta `/_ds` (una carpeta `_ds` sería privada en App Router).

export const metadata: Metadata = {
  title: 'Design system · Timbre',
  robots: { index: false, follow: false },
};

export default function LayoutDs({ children }: { children: ReactNode }) {
  if (process.env.NODE_ENV === 'production') notFound();
  return children;
}
