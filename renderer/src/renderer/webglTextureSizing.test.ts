import { describe, expect, it } from "vitest";
import { clampUniformMaxEdge, coverTextureBitmapSize } from "./webglTextureSizing";

describe("coverTextureBitmapSize", () => {
  it("portrait image on landscape cap: scale by wider cover axis (x)", () => {
    // 4000×8000 image, 3840×2160 cap
    // cover scale = max(3840/4000, 2160/8000) = max(0.96, 0.27) = 0.96
    // → 3840×7680
    const { w, h } = coverTextureBitmapSize(4000, 8000, 3840, 2160);
    expect(w).toBe(3840);
    expect(h).toBe(7680);
  });

  it("landscape image on landscape cap: scale by taller cover axis (y)", () => {
    // 7680×2160 image, 3840×2160 cap
    // cover scale = max(3840/7680, 2160/2160) = max(0.5, 1.0) = 1.0 → no change
    const { w, h } = coverTextureBitmapSize(7680, 2160, 3840, 2160);
    expect(w).toBe(7680);
    expect(h).toBe(2160);
  });

  it("square image on landscape cap: cover scale uses the smaller image/cap ratio that still covers", () => {
    // 4000×4000 image, 3840×2160 cap
    // cover scale = max(3840/4000, 2160/4000) = max(0.96, 0.54) = 0.96
    // → 3840×3840
    const { w, h } = coverTextureBitmapSize(4000, 4000, 3840, 2160);
    expect(w).toBe(3840);
    expect(h).toBe(3840);
  });

  it("image smaller than cap on both axes: no upscale, returns native size", () => {
    // 1920×1080 image, 3840×2160 cap
    // cover scale = max(3840/1920, 2160/1080) = max(2, 2) = 2 → clamped to 1
    const { w, h } = coverTextureBitmapSize(1920, 1080, 3840, 2160);
    expect(w).toBe(1920);
    expect(h).toBe(1080);
  });

  it("image already exactly cap size: returns same dimensions", () => {
    const { w, h } = coverTextureBitmapSize(3840, 2160, 3840, 2160);
    expect(w).toBe(3840);
    expect(h).toBe(2160);
  });

  it("landscape image on portrait cap: scale by taller cover axis", () => {
    // 1920×1080 image, 1080×1920 cap
    // cover scale = max(1080/1920, 1920/1080) = max(0.5625, 1.777) = 1.777 → clamped to 1
    const { w, h } = coverTextureBitmapSize(1920, 1080, 1080, 1920);
    expect(w).toBe(1920);
    expect(h).toBe(1080);
  });

  it("returns {1,1} for zero-width image", () => {
    const { w, h } = coverTextureBitmapSize(0, 1080, 3840, 2160);
    expect(w).toBe(1);
    expect(h).toBe(1);
  });

  it("returns {1,1} for zero-height image", () => {
    const { w, h } = coverTextureBitmapSize(1920, 0, 3840, 2160);
    expect(w).toBe(1);
    expect(h).toBe(1);
  });
});

describe("clampUniformMaxEdge", () => {
  it("within limit: returns dimensions unchanged", () => {
    const { w, h } = clampUniformMaxEdge(3840, 2160, 8192);
    expect(w).toBe(3840);
    expect(h).toBe(2160);
  });

  it("at exactly the limit: returns dimensions unchanged", () => {
    const { w, h } = clampUniformMaxEdge(8192, 8192, 8192);
    expect(w).toBe(8192);
    expect(h).toBe(8192);
  });

  it("wide image exceeds limit: scales down uniformly", () => {
    // 16384×4096 with maxTex=8192 → scale = 8192/16384 = 0.5 → 8192×2048
    const { w, h } = clampUniformMaxEdge(16384, 4096, 8192);
    expect(w).toBe(8192);
    expect(h).toBe(2048);
  });

  it("tall image exceeds limit: scales down uniformly", () => {
    // 3840×16384 with maxTex=8192 → scale = 8192/16384 = 0.5 → 1920×8192
    const { w, h } = clampUniformMaxEdge(3840, 16384, 8192);
    expect(w).toBe(1920);
    expect(h).toBe(8192);
  });

  it("both dimensions exceed limit: governed by longest edge", () => {
    // 10000×9000 with maxTex=8192 → long=10000 → scale = 0.8192 → 8192×7372
    const { w, h } = clampUniformMaxEdge(10000, 9000, 8192);
    expect(w).toBe(8192);
    expect(h).toBe(Math.floor(9000 * (8192 / 10000)));
  });
});
