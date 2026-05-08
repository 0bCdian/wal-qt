/**
 * Image-quality runtime flags for the WebGL transition pipeline.
 *
 * Set `globalThis.__waypaperImageQuality = { sampler, colorSpace, upscale, fxaa }`
 * (typically from the Qt host bootstrap script, but also reachable from devtools)
 * to flip transition rendering between the available image-quality modes.
 *
 * See `docs/IMAGE_QUALITY_FLAGS.md` for the full mode catalogue and tradeoffs.
 *
 * Re-read on every transition so devtools tweaks apply to the next load
 * without a renderer reload.
 */

/**
 * Texture sampling kernel used inside the transition fragment shader.
 *
 * | Kernel        | Cost (taps) | Looks like         | Notes                                      |
 * |---------------|-------------|--------------------|--------------------------------------------|
 * | `bilinear`    | 1           | hardware default   | Pre-Mode-A behavior. Stair-steps line art. |
 * | `catmull-rom` | 5           | Lanczos2-ish       | Default. Matches `<img>` on hard edges.    |
 * | `mitchell`    | 5           | softer / less ring | Use if Catmull-Rom shows ringing halos.    |
 */
export type SamplerKernel = "bilinear" | "catmull-rom" | "mitchell";

/**
 * Texture internal-format / filter color space.
 *
 * | Mode      | WebGL2 internalFormat | Filter happens in… | Notes                                  |
 * |-----------|-----------------------|--------------------|----------------------------------------|
 * | `auto`    | `SRGB8_ALPHA8`         | linear-light        | Physically correct linear filtering.   |
 * | `linear`  | `SRGB8_ALPHA8`         | linear-light        | Same as `auto`; explicit form.         |
 * | `srgb`    | `RGBA`                  | display (sRGB)      | **Default** — closest `<img>` brightness. |
 *
 * Only meaningful on WebGL2; WebGL1 always filters in display space because
 * the SRGB8_ALPHA8 internal format isn't available.
 */
export type ColorSpaceMode = "auto" | "linear" | "srgb";

/**
 * Where upscaling happens when the source bitmap is smaller than the cap.
 *
 * | Mode          | Upscale runs… | Cost                                   | Notes                          |
 * |---------------|----------------|----------------------------------------|--------------------------------|
 * | `gpu`         | per-frame      | shader sampler (1 or 5 taps)           | Default. Free RAM, fast load.  |
 * | `cpu-lanczos` | once at decode | `createImageBitmap` resize (Lanczos)   | Pixel-identical to `<img>`.    |
 */
export type TextureUpscaleMode = "gpu" | "cpu-lanczos";

/** Optional FXAA edge-cleanup post pass. Off by default — only useful if the kernel still leaves residual aliasing. */
export type FxaaMode = "off" | "on";

export type ImageQualityFlags = {
  sampler: SamplerKernel;
  colorSpace: ColorSpaceMode;
  upscale: TextureUpscaleMode;
  fxaa: FxaaMode;
};

export type ImageQualityFlagsInput = Partial<ImageQualityFlags>;

export const DEFAULT_IMAGE_QUALITY_FLAGS: ImageQualityFlags = {
  sampler: "catmull-rom",
  colorSpace: "srgb",
  upscale: "gpu",
  fxaa: "off",
};

const SAMPLER_KERNELS: ReadonlySet<SamplerKernel> = new Set([
  "bilinear",
  "catmull-rom",
  "mitchell",
]);
const COLOR_SPACE_MODES: ReadonlySet<ColorSpaceMode> = new Set(["auto", "linear", "srgb"]);
const TEXTURE_UPSCALE_MODES: ReadonlySet<TextureUpscaleMode> = new Set(["gpu", "cpu-lanczos"]);
const FXAA_MODES: ReadonlySet<FxaaMode> = new Set(["off", "on"]);

function pickEnum<T extends string>(value: unknown, allowed: ReadonlySet<T>, fallback: T): T {
  return typeof value === "string" && (allowed as ReadonlySet<string>).has(value)
    ? (value as T)
    : fallback;
}

/** Pure parser. Tolerates partial / malformed inputs; unknown keys are ignored. */
export function parseImageQualityFlags(raw: unknown): ImageQualityFlags {
  if (raw === null || typeof raw !== "object") {
    return { ...DEFAULT_IMAGE_QUALITY_FLAGS };
  }
  const r = raw as Record<string, unknown>;
  return {
    sampler: pickEnum(r.sampler, SAMPLER_KERNELS, DEFAULT_IMAGE_QUALITY_FLAGS.sampler),
    colorSpace: pickEnum(r.colorSpace, COLOR_SPACE_MODES, DEFAULT_IMAGE_QUALITY_FLAGS.colorSpace),
    upscale: pickEnum(r.upscale, TEXTURE_UPSCALE_MODES, DEFAULT_IMAGE_QUALITY_FLAGS.upscale),
    fxaa: pickEnum(r.fxaa, FXAA_MODES, DEFAULT_IMAGE_QUALITY_FLAGS.fxaa),
  };
}

/** Snapshot of the current global flag config; safe to call on every transition. */
export function readImageQualityFlags(): ImageQualityFlags {
  const raw = (globalThis as { __waypaperImageQuality?: unknown }).__waypaperImageQuality;
  return parseImageQualityFlags(raw);
}
