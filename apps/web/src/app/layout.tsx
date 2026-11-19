import type { Metadata, Viewport } from 'next';
import { IBM_Plex_Mono, IBM_Plex_Sans } from 'next/font/google';
import type { ReactNode } from 'react';
import {
  DESCRIPCION_SITIO,
  NOMBRE_SITIO,
  PLANTILLA_TITULO,
  TITULO_SITIO,
  urlSitio,
} from '@/lib/sitio';
import { COLORES_CLARO, COLORES_OSCURO } from './_seo/marca';
import './globals.css';

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--fuente-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--fuente-plex-mono',
  display: 'swap',
});

// Metadatos base (PLAN-SAAS Fase 12). Las páginas ponen solo su nombre en `title`
// («Ingresar») y la plantilla agrega « · Boletéame»; la landing usa `title.absolute`.
//
// `canonical: './'` se resuelve contra la ruta de cada página (no contra la raíz): cada
// página hereda una canónica a sí misma, sin la query. Con `'/'` todas las páginas que no
// definieran la suya apuntarían a la landing.
//
// Las imágenes OG y Twitter salen de `opengraph-image.tsx` / `twitter-image.tsx` y los
// íconos de `icon.svg` / `apple-icon.tsx` (convenciones de archivo de Next).
//
// Las páginas de la app (`[org]`, `bienvenida`, `invitacion`, recuperar y restablecer
// contraseña) llevan `robots: noindex` en su propio segmento.
export const metadata: Metadata = {
  metadataBase: new URL(urlSitio()),
  title: { default: TITULO_SITIO, template: PLANTILLA_TITULO },
  description: DESCRIPCION_SITIO,
  applicationName: NOMBRE_SITIO,
  alternates: { canonical: './' },
  openGraph: {
    type: 'website',
    locale: 'es_CL',
    siteName: NOMBRE_SITIO,
    url: './',
  },
  twitter: { card: 'summary_large_image' },
  formatDetection: { telephone: false },
};

// Color de la barra del navegador: `surface` de cada tema (tokens.json, vía marca.ts).
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: COLORES_CLARO.surface },
    { media: '(prefers-color-scheme: dark)', color: COLORES_OSCURO.surface },
  ],
  // Sin `colorScheme`: lo pone tokens.css por tema, respetando `data-theme`.
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es-CL" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
