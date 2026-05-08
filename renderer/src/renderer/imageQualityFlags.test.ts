import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_IMAGE_QUALITY_FLAGS,
  parseImageQualityFlags,
  readImageQualityFlags,
  type ImageQualityFlagsInput,
} from "./imageQualityFlags";

type GlobalsBag = { __waypaperImageQuality?: unknown };

const G = globalThis as GlobalsBag;

describe("parseImageQualityFlags", () => {
  it("returns defaults when input is undefined", () => {
    expect(parseImageQualityFlags(undefined)).toEqual(DEFAULT_IMAGE_QUALITY_FLAGS);
  });

  it("returns defaults when input is null", () => {
    expect(parseImageQualityFlags(null)).toEqual(DEFAULT_IMAGE_QUALITY_FLAGS);
  });

  it("returns defaults when input is not an object", () => {
    expect(parseImageQualityFlags("nope")).toEqual(DEFAULT_IMAGE_QUALITY_FLAGS);
    expect(parseImageQualityFlags(42)).toEqual(DEFAULT_IMAGE_QUALITY_FLAGS);
    expect(parseImageQualityFlags(true)).toEqual(DEFAULT_IMAGE_QUALITY_FLAGS);
  });

  it("merges partial overrides over defaults", () => {
    const got = parseImageQualityFlags({ sampler: "bilinear" });
    expect(got).toEqual({ ...DEFAULT_IMAGE_QUALITY_FLAGS, sampler: "bilinear" });
  });

  it("accepts every documented sampler kernel", () => {
    const kernels = ["bilinear", "catmull-rom", "mitchell"] as const;
    for (const k of kernels) {
      expect(parseImageQualityFlags({ sampler: k }).sampler).toBe(k);
    }
  });

  it("falls back to default sampler on unknown kernel name", () => {
    expect(parseImageQualityFlags({ sampler: "lanczos" as unknown as "bilinear" }).sampler).toBe(
      DEFAULT_IMAGE_QUALITY_FLAGS.sampler,
    );
  });

  it("accepts every documented colorSpace mode", () => {
    for (const c of ["auto", "linear", "srgb"] as const) {
      expect(parseImageQualityFlags({ colorSpace: c }).colorSpace).toBe(c);
    }
  });

  it("falls back to default colorSpace on unknown name", () => {
    expect(parseImageQualityFlags({ colorSpace: "p3" as never }).colorSpace).toBe(
      DEFAULT_IMAGE_QUALITY_FLAGS.colorSpace,
    );
  });

  it("accepts every documented upscale mode", () => {
    for (const u of ["gpu", "cpu-lanczos"] as const) {
      expect(parseImageQualityFlags({ upscale: u }).upscale).toBe(u);
    }
  });

  it("falls back to default upscale on unknown name", () => {
    expect(parseImageQualityFlags({ upscale: "gpu-bicubic" as never }).upscale).toBe(
      DEFAULT_IMAGE_QUALITY_FLAGS.upscale,
    );
  });

  it("accepts every documented fxaa mode", () => {
    for (const f of ["off", "on"] as const) {
      expect(parseImageQualityFlags({ fxaa: f }).fxaa).toBe(f);
    }
  });

  it("falls back to default fxaa on unknown name", () => {
    expect(parseImageQualityFlags({ fxaa: "smaa" as never }).fxaa).toBe(
      DEFAULT_IMAGE_QUALITY_FLAGS.fxaa,
    );
  });

  it("ignores unknown keys", () => {
    const input = { sampler: "mitchell", bogus: "value" } as ImageQualityFlagsInput & {
      bogus: string;
    };
    expect(parseImageQualityFlags(input)).toEqual({
      ...DEFAULT_IMAGE_QUALITY_FLAGS,
      sampler: "mitchell",
    });
  });
});

describe("readImageQualityFlags", () => {
  beforeEach(() => {
    delete G.__waypaperImageQuality;
  });

  afterEach(() => {
    delete G.__waypaperImageQuality;
  });

  it("returns defaults when global is unset", () => {
    expect(readImageQualityFlags()).toEqual(DEFAULT_IMAGE_QUALITY_FLAGS);
  });

  it("reads partial overrides from globalThis.__waypaperImageQuality", () => {
    G.__waypaperImageQuality = { sampler: "mitchell", fxaa: "on" };
    expect(readImageQualityFlags()).toEqual({
      ...DEFAULT_IMAGE_QUALITY_FLAGS,
      sampler: "mitchell",
      fxaa: "on",
    });
  });

  it("re-reads on every call so devtools can flip flags between transitions", () => {
    G.__waypaperImageQuality = { sampler: "bilinear" };
    expect(readImageQualityFlags().sampler).toBe("bilinear");
    G.__waypaperImageQuality = { sampler: "mitchell" };
    expect(readImageQualityFlags().sampler).toBe("mitchell");
  });
});

describe("DEFAULT_IMAGE_QUALITY_FLAGS", () => {
  it("uses Catmull-Rom by default for the recommended <img>-parity kernel", () => {
    // Mid-transition <img>-parity for line art needs a higher-order kernel.
    // If you change this default, update docs/IMAGE_QUALITY_FLAGS.md too.
    expect(DEFAULT_IMAGE_QUALITY_FLAGS.sampler).toBe("catmull-rom");
  });

  it("keeps GPU-side upscale by default (CPU-Lanczos has memory cost)", () => {
    expect(DEFAULT_IMAGE_QUALITY_FLAGS.upscale).toBe("gpu");
  });

  it("defaults colorSpace to srgb for perceptual brightness parity with <img>", () => {
    expect(DEFAULT_IMAGE_QUALITY_FLAGS.colorSpace).toBe("srgb");
  });

  it("keeps FXAA off by default (post pass; only needed for residual aliasing)", () => {
    expect(DEFAULT_IMAGE_QUALITY_FLAGS.fxaa).toBe("off");
  });
});
