import type { ImageFitMode } from "./types";

/** GLSL `u_*_object_fit` values — must match fragment shader thresholds. */
export const WEBGL_OBJECT_FIT_COVER = 0;
export const WEBGL_OBJECT_FIT_CONTAIN = 1;
export const WEBGL_OBJECT_FIT_FILL = 2;
export const WEBGL_OBJECT_FIT_NONE = 3;

/**
 * Per-layer object-fit kind for WebGL sampling. `scale-down` is resolved per image like CSS
 * (none when the bitmap fits inside the layout box without upscaling, otherwise contain).
 */
export function objectFitKindForLayer(
  mode: ImageFitMode,
  natW: number,
  natH: number,
  layoutW: number,
  layoutH: number,
): number {
  const lw = Math.max(layoutW, 1e-6);
  const lh = Math.max(layoutH, 1e-6);
  if (mode === "scale-down") {
    if (natW <= lw && natH <= lh) {
      return WEBGL_OBJECT_FIT_NONE;
    }
    return WEBGL_OBJECT_FIT_CONTAIN;
  }
  switch (mode) {
    case "cover":
      return WEBGL_OBJECT_FIT_COVER;
    case "contain":
      return WEBGL_OBJECT_FIT_CONTAIN;
    case "fill":
      return WEBGL_OBJECT_FIT_FILL;
    case "none":
      return WEBGL_OBJECT_FIT_NONE;
    default:
      return WEBGL_OBJECT_FIT_COVER;
  }
}

/** Map CSS natural dimensions into canvas backing pixels (same convention as `canvas.width`). */
export function naturalSizeInBackingPixels(
  natW: number,
  natH: number,
  backingW: number,
  backingH: number,
  layoutW: number,
  layoutH: number,
): { x: number; y: number } {
  const lw = Math.max(layoutW, 1e-6);
  const lh = Math.max(layoutH, 1e-6);
  return {
    x: natW * (backingW / lw),
    y: natH * (backingH / lh),
  };
}
