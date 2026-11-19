import { ImageResponse } from 'next/og';
import { COLORES_CLARO as C, dataUriSvg, svgEstampilla } from './marca';

// Imagen para compartir (Open Graph y Twitter, 1200 × 630), con la composición del hero
// de la plantilla «Landing» (`Main.dc.html`): fondo `surface`, bloque `sello` con el
// borde perforado de estampilla, cuadro `ocre` y una tarjeta de boleta encima.
//
// Colores: `marca.ts` (de tokens.json); Satori no lee custom properties.
//
// Fuente: la que trae `next/og` (Geist, solo 400). IBM Plex Sans exigiría versionar sus
// .ttf (OFL) y leerlos con `readFile` al cargar el módulo: suman unos 200 KB por peso
// contra el límite de 500 KB del paquete de `ImageResponse`, y descargarlos de Google en
// cada generación queda descartado. La marca se reconoce por la composición y el color.

export const ALT_IMAGEN_SOCIAL =
  'Boletéame: emite, firma y envía boletas electrónicas ante el SII, con certificación guiada y API.';
export const TAMANO_IMAGEN_SOCIAL = { width: 1200, height: 630 };

const MARGEN = 72;
const BLOQUE = { ancho: 380, izquierda: 1200 - MARGEN - 380, abajo: 630 - MARGEN };
const PERFORACION = 14;
const PASO = 28;

/** Centros de las perforaciones: borde izquierdo y borde inferior del bloque `sello`. */
function perforacionesBloque(): { x: number; y: number }[] {
  const puntos: { x: number; y: number }[] = [];
  for (let y = MARGEN + PASO / 2; y < BLOQUE.abajo; y += PASO) {
    puntos.push({ x: BLOQUE.izquierda, y });
  }
  for (let x = BLOQUE.izquierda + PASO / 2; x < 1200 - MARGEN; x += PASO) {
    puntos.push({ x, y: BLOQUE.abajo });
  }
  return puntos;
}

export function imagenSocial(): ImageResponse {
  return new ImageResponse(
    <div
      style={{
        position: 'relative',
        display: 'flex',
        width: '100%',
        height: '100%',
        background: C.surface,
        color: C.ink,
      }}
    >
      {/* Bloque sello con el borde perforado y el cuadro ocre. */}
      <div
        style={{
          position: 'absolute',
          top: MARGEN,
          right: MARGEN,
          width: BLOQUE.ancho,
          height: BLOQUE.abajo - MARGEN,
          background: C.sello,
          borderRadius: 4,
        }}
      />
      {perforacionesBloque().map(({ x, y }) => (
        <div
          key={`${x}-${y}`}
          style={{
            position: 'absolute',
            left: x - PERFORACION / 2,
            top: y - PERFORACION / 2,
            width: PERFORACION,
            height: PERFORACION,
            borderRadius: PERFORACION,
            background: C.surface,
          }}
        />
      ))}
      <div
        style={{
          position: 'absolute',
          top: MARGEN + 24,
          right: MARGEN + 32,
          width: 64,
          height: 64,
          background: C.ocre,
          borderRadius: 4,
        }}
      />

      {/* Tarjeta de boleta. */}
      <div
        style={{
          position: 'absolute',
          left: BLOQUE.izquierda - 60,
          top: 220,
          width: 400,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          padding: 28,
          background: C['surface-raised'],
          border: `1px solid ${C.line}`,
          borderRadius: 8,
          // `shadow-lg` del tema claro (tokens.json): `ink` al 7 % y al 14 %.
          boxShadow: '0 4px 8px rgba(22, 32, 31, 0.07), 0 16px 32px -4px rgba(22, 32, 31, 0.14)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 26, fontWeight: 600 }}>Boleta electrónica</span>
          <span style={{ fontSize: 22, color: C['ink-muted'] }}>Folio 1.024</span>
        </div>
        <span style={{ fontSize: 48, fontWeight: 600 }}>$ 12.990</span>
        <div style={{ display: 'flex' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '6px 16px',
              borderRadius: 9999,
              background: C['exito-soft'],
              color: C.exito,
              fontSize: 22,
            }}
          >
            <div style={{ width: 10, height: 10, borderRadius: 10, background: C.exito }} />
            Aceptado por el SII
          </div>
        </div>
      </div>

      {/* Texto. */}
      <div
        style={{
          position: 'absolute',
          left: MARGEN,
          top: MARGEN,
          bottom: MARGEN,
          width: 580,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* biome-ignore lint/performance/noImgElement: ImageResponse (Satori) solo acepta <img>. */}
          <img src={dataUriSvg(svgEstampilla())} width={56} height={56} alt="" />
          <span style={{ fontSize: 40, fontWeight: 600 }}>Boletéame</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <span style={{ fontSize: 26, color: C.sello }}>Boleta electrónica ante el SII</span>
          <span style={{ fontSize: 56, lineHeight: 1.15, fontWeight: 600, letterSpacing: -1 }}>
            Emite, firma y envía tus boletas electrónicas sin vueltas.
          </span>
        </div>
        <span style={{ fontSize: 26, lineHeight: 1.4, color: C['ink-muted'] }}>
          Certificación guiada, folios (CAF), seguimiento de cada envío y API.
        </span>
      </div>
    </div>,
    { ...TAMANO_IMAGEN_SOCIAL },
  );
}
