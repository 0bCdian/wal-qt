/**
 * Cover-aligned WebGL texture bitmap dimensions.
 *
 * Uses `scale = min(max(capW/iw, capH/ih), 1)` — the same axis coverage that
 * the `coverUv()` GLSL helper applies — so every texel in the bitmap maps to
 * real screen pixels rather than being stretched by the shader.
 *
 * Never upscales: if both cap ratios are > 1 the scale is clamped to 1 and
 * the returned dimensions equal the intrinsic image size.
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
    w: Math.max(1, Math.floor(iw * scale)),
    h: Math.max(1, Math.floor(ih * scale)),
  };
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
