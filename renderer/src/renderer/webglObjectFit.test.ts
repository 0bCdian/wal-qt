import { describe, expect, it } from "vitest";
import {
  naturalSizeInBackingPixels,
  objectFitKindForLayer,
  WEBGL_OBJECT_FIT_CONTAIN,
  WEBGL_OBJECT_FIT_COVER,
  WEBGL_OBJECT_FIT_FILL,
  WEBGL_OBJECT_FIT_NONE,
} from "./webglObjectFit";

describe("objectFitKindForLayer", () => {
  it("maps fixed modes", () => {
    expect(objectFitKindForLayer("cover", 4000, 2000, 800, 600)).toBe(WEBGL_OBJECT_FIT_COVER);
    expect(objectFitKindForLayer("contain", 4000, 2000, 800, 600)).toBe(WEBGL_OBJECT_FIT_CONTAIN);
    expect(objectFitKindForLayer("fill", 4000, 2000, 800, 600)).toBe(WEBGL_OBJECT_FIT_FILL);
    expect(objectFitKindForLayer("none", 4000, 2000, 800, 600)).toBe(WEBGL_OBJECT_FIT_NONE);
  });

  it("scale-down uses none when image fits in layout without upscaling", () => {
    expect(objectFitKindForLayer("scale-down", 400, 300, 800, 600)).toBe(WEBGL_OBJECT_FIT_NONE);
  });

  it("scale-down uses contain when image exceeds layout on an axis", () => {
    expect(objectFitKindForLayer("scale-down", 400, 300, 200, 200)).toBe(WEBGL_OBJECT_FIT_CONTAIN);
    expect(objectFitKindForLayer("scale-down", 400, 300, 400, 250)).toBe(WEBGL_OBJECT_FIT_CONTAIN);
  });
});

describe("naturalSizeInBackingPixels", () => {
  it("scales by backing/layout ratio", () => {
    expect(naturalSizeInBackingPixels(800, 600, 1600, 1200, 800, 600)).toEqual({
      x: 1600,
      y: 1200,
    });
    expect(naturalSizeInBackingPixels(800, 600, 800, 600, 800, 600)).toEqual({ x: 800, y: 600 });
  });
});
