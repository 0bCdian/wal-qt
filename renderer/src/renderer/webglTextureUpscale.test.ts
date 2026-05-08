import { describe, expect, it } from "vitest";
import {
  cpuLanczosUpscaleTargetSize,
  shouldRunCpuLanczosUpscale,
  CPU_LANCZOS_UPSCALE_MIN_SHORTFALL,
} from "./webglTextureUpscale";

describe("shouldRunCpuLanczosUpscale", () => {
  it("returns false when upscale flag is 'gpu'", () => {
    expect(shouldRunCpuLanczosUpscale("gpu", 1920, 1080, 3840, 2160)).toBe(false);
  });

  it("returns false when source already >= cap on both axes", () => {
    expect(shouldRunCpuLanczosUpscale("cpu-lanczos", 3840, 2160, 3840, 2160)).toBe(false);
    expect(shouldRunCpuLanczosUpscale("cpu-lanczos", 4000, 3000, 1920, 1080)).toBe(false);
  });

  it("returns true when source is much smaller than cap on at least one axis", () => {
    // 1920×1080 source, 3840×2160 cap → 2× shortfall on both axes
    expect(shouldRunCpuLanczosUpscale("cpu-lanczos", 1920, 1080, 3840, 2160)).toBe(true);
  });

  it("respects the minimum-shortfall threshold to avoid pointless tiny resamples", () => {
    // Just barely smaller (within minimum-shortfall threshold) should not trigger
    const w = Math.floor(3840 * (CPU_LANCZOS_UPSCALE_MIN_SHORTFALL + 0.99));
    const h = Math.floor(2160 * (CPU_LANCZOS_UPSCALE_MIN_SHORTFALL + 0.99));
    expect(shouldRunCpuLanczosUpscale("cpu-lanczos", w, h, 3840, 2160)).toBe(false);
  });
});

describe("cpuLanczosUpscaleTargetSize", () => {
  it("returns null if upscale flag is 'gpu'", () => {
    expect(cpuLanczosUpscaleTargetSize("gpu", 1920, 1080, 3840, 2160)).toBeNull();
  });

  it("returns null if source already covers the cap", () => {
    expect(cpuLanczosUpscaleTargetSize("cpu-lanczos", 3840, 2160, 3840, 2160)).toBeNull();
  });

  it("returns cap dimensions when source is smaller and we should upscale", () => {
    expect(cpuLanczosUpscaleTargetSize("cpu-lanczos", 1920, 1080, 3840, 2160)).toEqual({
      w: 3840,
      h: 2160,
    });
  });

  it("preserves aspect ratio (no skewing): scales source uniformly to cover cap", () => {
    // 1920×800 (2.4:1) source, 3840×2160 cap (~16:9). To cover the cap on both axes,
    // we scale by max(3840/1920, 2160/800) = max(2, 2.7) = 2.7 → 5184×2160. The wide
    // axis overshoots; the canvas crop / shader cover drops the extra. Whatever the
    // result is, the ratio width/height MUST match the source ratio.
    const r = cpuLanczosUpscaleTargetSize("cpu-lanczos", 1920, 800, 3840, 2160);
    expect(r).not.toBeNull();
    if (r) {
      expect(r.w / r.h).toBeCloseTo(1920 / 800, 5);
      expect(r.w).toBeGreaterThanOrEqual(3840);
      expect(r.h).toBeGreaterThanOrEqual(2160);
    }
  });

  it("clamps to the WebGL MAX_TEXTURE_SIZE if extreme upscale would overflow", () => {
    const r = cpuLanczosUpscaleTargetSize("cpu-lanczos", 100, 100, 32768, 32768, 8192);
    expect(r).not.toBeNull();
    if (r) {
      expect(r.w).toBeLessThanOrEqual(8192);
      expect(r.h).toBeLessThanOrEqual(8192);
    }
  });
});
