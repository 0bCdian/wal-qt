import { clampUniformMaxEdge } from "./webglTextureSizing";
import type { TextureUpscaleMode } from "./imageQualityFlags";

/**
 * CPU-side high-quality (Lanczos) bitmap upscale for the WebGL transition path
 * (Mode B in `docs/IMAGE_QUALITY_FLAGS.md`).
 *
 * Pipeline:
 *   decode → if Mode B: ask `createImageBitmap` to produce a Lanczos-resized
 *   bitmap at the cap dimensions BEFORE upload to GPU. The transition then runs
 *   identity sampling, so the mid-blend is pixel-identical to the post-blend
 *   `<img>` on Chromium / Qt WebEngine (which uses the same Lanczos under the
 *   hood for `image-rendering: auto`).
 *
 * This module owns only the size-decision logic (pure functions, easy to test).
 * The actual `createImageBitmap` call lives next to `prepareWebGlTextureSource`
 * in `image.ts`.
 */

/**
 * Below this proportional shortfall, the CPU upscale is not worth the cost.
 *
 * Example: source covers ≥ 95% of cap on every axis → no upscale; the GPU
 * sampler will do a tiny stretch that's visually indistinguishable from a
 * Lanczos-resized bitmap, and we save a (potentially several MB) decode.
 */
export const CPU_LANCZOS_UPSCALE_MIN_SHORTFALL = 0.05;

export function shouldRunCpuLanczosUpscale(
  mode: TextureUpscaleMode,
  srcW: number,
  srcH: number,
  capW: number,
  capH: number,
): boolean {
  if (mode !== "cpu-lanczos") return false;
  if (srcW <= 0 || srcH <= 0 || capW <= 0 || capH <= 0) return false;
  if (srcW >= capW && srcH >= capH) return false;
  const shortfallX = capW > srcW ? (capW - srcW) / capW : 0;
  const shortfallY = capH > srcH ? (capH - srcH) / capH : 0;
  return Math.max(shortfallX, shortfallY) >= CPU_LANCZOS_UPSCALE_MIN_SHORTFALL;
}

/**
 * Target bitmap dimensions for the CPU pre-upscale.
 *
 * Uses the cover-style scale (max ratio) so the resulting bitmap fully covers
 * the cap on every axis. Aspect ratio is preserved — the off-axis overflows
 * the cap and the shader's existing cover/contain logic crops the extra,
 * exactly as in the GPU-only path.
 *
 * Returns `null` when no upscale is needed (see `shouldRunCpuLanczosUpscale`).
 */
export function cpuLanczosUpscaleTargetSize(
  mode: TextureUpscaleMode,
  srcW: number,
  srcH: number,
  capW: number,
  capH: number,
  maxTextureSize?: number,
): { w: number; h: number } | null {
  if (!shouldRunCpuLanczosUpscale(mode, srcW, srcH, capW, capH)) return null;
  const scale = Math.max(capW / srcW, capH / srcH);
  let w = Math.max(1, Math.round(srcW * scale));
  let h = Math.max(1, Math.round(srcH * scale));
  if (maxTextureSize !== undefined && maxTextureSize > 0) {
    const clamped = clampUniformMaxEdge(w, h, maxTextureSize);
    w = clamped.w;
    h = clamped.h;
  }
  return { w, h };
}
