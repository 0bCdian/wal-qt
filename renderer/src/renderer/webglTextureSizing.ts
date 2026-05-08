import type { ImageFitMode } from "./types";
import {
  naturalSizeInBackingPixels,
  objectFitKindForLayer,
  WEBGL_OBJECT_FIT_CONTAIN,
  WEBGL_OBJECT_FIT_COVER,
  WEBGL_OBJECT_FIT_FILL,
  WEBGL_OBJECT_FIT_NONE,
} from "./webglObjectFit";

/**
 * Cover-aligned WebGL texture bitmap dimensions.
 *
 * Uses `scale = min(max(capW/iw, capH/ih), 1)` — the same axis coverage that
 * the `coverUv()` GLSL helper applies — so every texel in the bitmap maps to
 * real screen pixels rather than being stretched by the shader.
 *
 * Never upscales: if both cap ratios are > 1 the scale is clamped to 1 and
 * the returned dimensions equal the intrinsic image size.
 *
 * Uses `Math.round` (not `floor`) so the cover-picked axis cannot drift
 * 1 pixel short of the cap from IEEE rounding (`iw * (capW/iw)` may evaluate
 * to `capW - 1ulp` on some inputs). The off-axis overshoots and is cropped
 * by the shader, so rounding up there is harmless.
 */
export function coverTextureBitmapSize(
  iw: number,
  ih: number,
  capW: number,
  capH: number,
): { w: number; h: number } {
  if (iw <= 0 || ih <= 0 || capW <= 0 || capH <= 0) {
    return { w: 1, h: 1 };
  }
  const scale = Math.min(Math.max(capW / iw, capH / ih), 1);
  return {
    w: Math.max(1, Math.round(iw * scale)),
    h: Math.max(1, Math.round(ih * scale)),
  };
}

/**
 * Contain-aligned bitmap size: image fits inside the cap without upscaling.
 * Matches `containUv()` / CSS `object-fit: contain` (and `scale-down` when it
 * resolves to contain).
 */
export function containTextureBitmapSize(
  iw: number,
  ih: number,
  capW: number,
  capH: number,
): { w: number; h: number } {
  if (iw <= 0 || ih <= 0 || capW <= 0 || capH <= 0) {
    return { w: 1, h: 1 };
  }
  const scale = Math.min(capW / iw, capH / ih, 1);
  return {
    w: Math.max(1, Math.floor(iw * scale)),
    h: Math.max(1, Math.floor(ih * scale)),
  };
}

/**
 * Ideal texture pixel dimensions for a decoded wallpaper before `texImage2D`,
 * matching the WebGL layer's object-fit kind and layout/backing geometry.
 */
export function textureBitmapSizeForPresentation(
  fitMode: ImageFitMode,
  natW: number,
  natH: number,
  capW: number,
  capH: number,
  layoutWCss: number,
  layoutHCss: number,
): { w: number; h: number } {
  const kind = objectFitKindForLayer(fitMode, natW, natH, layoutWCss, layoutHCss);
  return textureBitmapSizeForObjectFitKind(kind, natW, natH, capW, capH, layoutWCss, layoutHCss);
}

export function textureBitmapSizeForObjectFitKind(
  objectFitKind: number,
  natW: number,
  natH: number,
  capW: number,
  capH: number,
  layoutWCss: number,
  layoutHCss: number,
): { w: number; h: number } {
  if (natW <= 0 || natH <= 0 || capW <= 0 || capH <= 0) {
    return { w: 1, h: 1 };
  }

  switch (objectFitKind) {
    case WEBGL_OBJECT_FIT_COVER:
      return coverTextureBitmapSize(natW, natH, capW, capH);
    case WEBGL_OBJECT_FIT_CONTAIN:
      return containTextureBitmapSize(natW, natH, capW, capH);
    case WEBGL_OBJECT_FIT_FILL: {
      return {
        w: Math.max(1, Math.floor(capW)),
        h: Math.max(1, Math.floor(capH)),
      };
    }
    case WEBGL_OBJECT_FIT_NONE: {
      const nb = naturalSizeInBackingPixels(natW, natH, capW, capH, layoutWCss, layoutHCss);
      return {
        w: Math.max(1, Math.floor(nb.x)),
        h: Math.max(1, Math.floor(nb.y)),
      };
    }
    default:
      return coverTextureBitmapSize(natW, natH, capW, capH);
  }
}

/** True when `n` is a positive power of two (WebGL1 mipmap completeness). */
export function isPow2Positive(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}

/**
 * Clamp (w, h) so the longest edge ≤ maxTex using a uniform scale.
 * Returns the original dimensions when already within limit.
 */
export function clampUniformMaxEdge(
  w: number,
  h: number,
  maxTex: number,
): { w: number; h: number } {
  const long = Math.max(w, h);
  if (long <= maxTex) return { w, h };
  const scale = maxTex / long;
  return {
    w: Math.max(1, Math.floor(w * scale)),
    h: Math.max(1, Math.floor(h * scale)),
  };
}
