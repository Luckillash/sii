import { ImageResponse } from 'next/og';
import { COLORES_CLARO, dataUriSvg, svgEstampilla } from './_seo/marca';

// Ícono de inicio de iOS (180 × 180, PLAN-SAAS Fase 12): la estampilla de `icon.svg`
// sobre `surface`. Opaco a propósito: iOS rellena de negro lo transparente.
export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        background: COLORES_CLARO.surface,
      }}
    >
      {/* biome-ignore lint/performance/noImgElement: ImageResponse (Satori) solo acepta <img>. */}
      <img src={dataUriSvg(svgEstampilla())} width={136} height={136} alt="" />
    </div>,
    { ...size },
  );
}
