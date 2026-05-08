import { describe, expect, it } from "vitest";

import type { EffectCropUv } from "./effectCrop";
import {
  effectCropUvFromCanvasAndClipRects,
  identityEffectCropUv,
  wipeDomVectorScaleForCropDeg,
} from "./effectCrop";

describe("effectCropUvFromCanvasAndClipRects", () => {
  it("returns full canvas when clip matches canvas bounds", () => {
    const c = effectCropUvFromCanvasAndClipRects(
      { left: 100, top: 200, width: 800, height: 600 },
      { left: 100, top: 200, right: 900, bottom: 800 },
    );
    expect(c).toEqual({ minU: 0, minV: 0, maxU: 1, maxV: 1 });
  });

  it("returns centered band when crop is smaller than zoomed canvas", () => {
    const c = effectCropUvFromCanvasAndClipRects(
      { left: 0, top: 0, width: 2000, height: 1500 },
      { left: 500, top: 375, right: 1500, bottom: 1125 },
    );
    expect(c?.minU).toBeCloseTo(0.25);
    expect(c?.maxU).toBeCloseTo(0.75);
    expect(c?.minV).toBeCloseTo(0.25);
    expect(c?.maxV).toBeCloseTo(0.75);
  });

  it("returns null on empty intersection", () => {
    expect(
      effectCropUvFromCanvasAndClipRects(
        { left: 0, top: 0, width: 100, height: 100 },
        { left: 500, top: 500, right: 600, bottom: 600 },
      ),
    ).toBeNull();
  });

  it("handles partial horizontal crop", () => {
    const c = effectCropUvFromCanvasAndClipRects(
      { left: 0, top: 0, width: 100, height: 100 },
      { left: 25, top: 0, right: 75, bottom: 100 },
    );
    expect(c).toEqual({ minU: 0.25, minV: 0, maxU: 0.75, maxV: 1 });
  });
});

describe("identityEffectCropUv", () => {
  it("covers unit square", () => {
    expect(identityEffectCropUv()).toEqual({ minU: 0, minV: 0, maxU: 1, maxV: 1 });
  });
});

describe("wipeDomVectorScaleForCropDeg", () => {
  it("returns 1 when crop is full", () => {
    const id = identityEffectCropUv();
    expect(wipeDomVectorScaleForCropDeg(30, id)).toBeCloseTo(1);
  });

  it("amplifies horizontal wipe when visible band is narrower in X", () => {
    const halfX: EffectCropUv = { minU: 0.25, minV: 0, maxU: 0.75, maxV: 1 };
    const s = wipeDomVectorScaleForCropDeg(0, halfX);
    expect(s).toBeCloseTo(2, 5);
  });
});
