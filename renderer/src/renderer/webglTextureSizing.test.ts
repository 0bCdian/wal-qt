import { describe, expect, it } from "vitest";
import {
  clampUniformMaxEdge,
  containTextureBitmapSize,
  coverTextureBitmapSize,
  isPow2Positive,
  textureBitmapSizeForObjectFitKind,
  textureBitmapSizeForPresentation,
} from "./webglTextureSizing";
import {
  WEBGL_OBJECT_FIT_CONTAIN,
  WEBGL_OBJECT_FIT_COVER,
  WEBGL_OBJECT_FIT_FILL,
  WEBGL_OBJECT_FIT_NONE,
} from "./webglObjectFit";

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

  it("cover-axis result fully covers the cap (no IEEE-precision undershoot)", () => {
    // Property: the cover axis (the one where iw*scale or ih*scale was meant
    // to equal capW/capH) MUST end up >= capW/capH, never one pixel short.
    // Math.round protects us if a future scale computation drifts to e.g.
    // 3839.9999999 instead of 3840.0; Math.floor would silently undershoot.
    const cases: Array<[number, number, number, number]> = [
      [4001, 8000, 3840, 2160],
      [9999, 5555, 3840, 2160],
      [3001, 2001, 1500, 1000],
      [4099, 2161, 3840, 2160],
      [1234, 5678, 1000, 1000],
    ];
    for (const [iw, ih, cw, ch] of cases) {
      const { w, h } = coverTextureBitmapSize(iw, ih, cw, ch);
      // Either cover axis must cover (the picked axis must equal cap; the
      // other axis overflows naturally). We require both to cover for safety.
      expect(w).toBeGreaterThanOrEqual(cw);
      expect(h).toBeGreaterThanOrEqual(ch);
    }
  });
});

describe("containTextureBitmapSize", () => {
  it("ultrawide image on 16:9 cap: scale by height (min axis ratio)", () => {
    // 5120×1440, cap 3840×2160 → min(3840/5120, 2160/1440) = min(0.75, 1.5) → 0.75
    const { w, h } = containTextureBitmapSize(5120, 1440, 3840, 2160);
    expect(w).toBe(3840);
    expect(h).toBe(1080);
  });

  it("tall image on landscape cap: scale by width", () => {
    // 1080×2400, cap 1920×1080 → min(1920/1080, 1080/2400) = min(1.77, 0.45) = 0.45
    const { w, h } = containTextureBitmapSize(1080, 2400, 1920, 1080);
    expect(w).toBe(486);
    expect(h).toBe(1080);
  });

  it("does not upscale when image is smaller than cap on both axes", () => {
    const { w, h } = containTextureBitmapSize(800, 600, 3840, 2160);
    expect(w).toBe(800);
    expect(h).toBe(600);
  });
});

describe("textureBitmapSizeForObjectFitKind", () => {
  const lw = 800;
  const lh = 600;
  const capW = 1600;
  const capH = 1200;

  it("cover matches coverTextureBitmapSize", () => {
    const a = textureBitmapSizeForObjectFitKind(
      WEBGL_OBJECT_FIT_COVER,
      4000,
      3000,
      capW,
      capH,
      lw,
      lh,
    );
    const b = coverTextureBitmapSize(4000, 3000, capW, capH);
    expect(a).toEqual(b);
  });

  it("contain matches containTextureBitmapSize", () => {
    const a = textureBitmapSizeForObjectFitKind(
      WEBGL_OBJECT_FIT_CONTAIN,
      4000,
      3000,
      capW,
      capH,
      lw,
      lh,
    );
    const b = containTextureBitmapSize(4000, 3000, capW, capH);
    expect(a).toEqual(b);
  });

  it("fill uses cap dimensions", () => {
    const { w, h } = textureBitmapSizeForObjectFitKind(
      WEBGL_OBJECT_FIT_FILL,
      9999,
      9999,
      capW,
      capH,
      lw,
      lh,
    );
    expect(w).toBe(capW);
    expect(h).toBe(capH);
  });

  it("none maps natural CSS pixels into backing cap using layout", () => {
    // nat 1920×1080, layout 800×600, backing 1600×1200 → natural backing 1920*(1600/800) × 1080*(1200/600)
    const { w, h } = textureBitmapSizeForObjectFitKind(
      WEBGL_OBJECT_FIT_NONE,
      1920,
      1080,
      1600,
      1200,
      800,
      600,
    );
    expect(w).toBe(3840);
    expect(h).toBe(2160);
  });
});

describe("textureBitmapSizeForPresentation", () => {
  it("scale-down resolves to none when image fits layout", () => {
    const { w, h } = textureBitmapSizeForPresentation("scale-down", 400, 300, 800, 600, 800, 600);
    // natural backing = nat * (cap/layout) with capW=800 layout 800 → 400×300
    expect(w).toBe(400);
    expect(h).toBe(300);
  });

  it("scale-down resolves to contain when image exceeds layout", () => {
    const { w, h } = textureBitmapSizeForPresentation(
      "scale-down",
      2000,
      2000,
      1000,
      1000,
      500,
      500,
    );
    const expectContain = containTextureBitmapSize(2000, 2000, 1000, 1000);
    expect(w).toBe(expectContain.w);
    expect(h).toBe(expectContain.h);
  });
});

describe("isPow2Positive", () => {
  it("accepts powers of two", () => {
    expect(isPow2Positive(1)).toBe(true);
    expect(isPow2Positive(256)).toBe(true);
    expect(isPow2Positive(1024)).toBe(true);
  });

  it("rejects non-POT", () => {
    expect(isPow2Positive(0)).toBe(false);
    expect(isPow2Positive(1000)).toBe(false);
    expect(isPow2Positive(3)).toBe(false);
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
