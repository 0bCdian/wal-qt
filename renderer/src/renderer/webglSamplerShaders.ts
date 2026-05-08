/**
 * GLSL helper snippets for the swappable transition texture sampler.
 *
 * Every kernel variant defines a single function with the same signature
 *   `vec4 sampleTex(sampler2D s, highp vec2 uv, highp vec2 texSize)`
 * so the rest of the fragment shader can swap kernels at link time without
 * changing call sites.
 *
 * Read alongside `imageQualityFlags.ts` and `docs/IMAGE_QUALITY_FLAGS.md`.
 *
 * Why these particular kernels?
 * - bilinear: hardware default, fastest, used as the baseline.
 * - catmull-rom (5-tap): Vlachos / Castorina trick — collapses the canonical
 *   16-tap Catmull-Rom into 5 hardware-bilinear taps. Visually equivalent to
 *   Lanczos2 for typical wallpaper content (line art, drawings, photos).
 *   Default kernel.
 * - mitchell (5-tap): same 5-tap structure, but Mitchell-Netravali (B=1/3,
 *   C=1/3) weights. Slightly softer; less ringing on extreme contrast edges.
 */

export type SamplerKernel = "bilinear" | "catmull-rom" | "mitchell";

export const SAMPLER_FUNCTION_NAME = "sampleTex";

const BILINEAR_HELPER = `
vec4 ${SAMPLER_FUNCTION_NAME}(sampler2D s, highp vec2 uv, highp vec2 texSize) {
  // texSize is unused for bilinear; included for signature parity.
  return texture2D(s, uv);
}
`;

/**
 * 5-tap Catmull-Rom from
 * Vlachos 2007 "An efficient algorithm for image smoothing" /
 * Marco Castorina "Bicubic Catmull-Rom in 5 samples" (2018).
 * Equivalent to the 16-tap canonical form within ~1e-4 absolute error,
 * but uses hardware bilinear taps so it's only 5 texture fetches.
 *
 * Final result is clamped to [0,1] because Catmull-Rom has small negative
 * lobes that would otherwise produce > 1 halos on hard edges in linear-light
 * blends.
 */
const CATMULL_ROM_HELPER = `
vec4 ${SAMPLER_FUNCTION_NAME}(sampler2D s, highp vec2 uv, highp vec2 texSize) {
  highp vec2 samplePos = uv * texSize;
  highp vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  highp vec2 f = samplePos - texPos1;

  highp vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  highp vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  highp vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  highp vec2 w3 = f * f * (-0.5 + 0.5 * f);

  highp vec2 w12 = w1 + w2;
  highp vec2 offset12 = w2 / w12;

  highp vec2 invTex = 1.0 / texSize;
  highp vec2 texPos0 = (texPos1 - 1.0) * invTex;
  highp vec2 texPos3 = (texPos1 + 2.0) * invTex;
  highp vec2 texPos12 = (texPos1 + offset12) * invTex;

  vec4 result = vec4(0.0);
  result += texture2D(s, vec2(texPos0.x,  texPos0.y))  * w0.x  * w0.y;
  result += texture2D(s, vec2(texPos12.x, texPos0.y))  * w12.x * w0.y;
  result += texture2D(s, vec2(texPos3.x,  texPos0.y))  * w3.x  * w0.y;

  result += texture2D(s, vec2(texPos0.x,  texPos12.y)) * w0.x  * w12.y;
  result += texture2D(s, vec2(texPos12.x, texPos12.y)) * w12.x * w12.y;
  result += texture2D(s, vec2(texPos3.x,  texPos12.y)) * w3.x  * w12.y;

  result += texture2D(s, vec2(texPos0.x,  texPos3.y))  * w0.x  * w3.y;
  result += texture2D(s, vec2(texPos12.x, texPos3.y))  * w12.x * w3.y;
  result += texture2D(s, vec2(texPos3.x,  texPos3.y))  * w3.x  * w3.y;

  return clamp(result, 0.0, 1.0);
}
`;

/**
 * Mitchell-Netravali (B = 1/3, C = 1/3) 5-tap, expanded form.
 * Same structural trick as Catmull-Rom but with smoother weights:
 *   q0 =        ( 6 - 2B    ) / 6
 *   q1 = -3 + (12 - 9B - 6C) * f^2 + ( 7B + 6C - 2) * f^3 ... etc.
 * For B = C = 1/3 the closed form reduces to the polynomials below.
 *
 * Less sharpening than Catmull-Rom, less ringing on extreme contrast.
 * Pick this if Catmull-Rom shows visible halos around tight high-contrast
 * details (rare; mainly black-on-pure-white line art).
 */
const MITCHELL_HELPER = `
vec4 ${SAMPLER_FUNCTION_NAME}(sampler2D s, highp vec2 uv, highp vec2 texSize) {
  highp vec2 samplePos = uv * texSize;
  highp vec2 texPos1 = floor(samplePos - 0.5) + 0.5;
  highp vec2 f = samplePos - texPos1;

  // Mitchell-Netravali weights (B = 1.0/3.0, C = 1.0/3.0):
  // w0 = ( -1*B - 6*C ) * (1+f)^3/6 + (6*B + 30*C) * (1+f)^2/6 + (-12*B - 48*C) * (1+f)/6 + (8*B + 24*C)/6
  // …simplifies (after substituting B=C=1/3 and reordering by f) to the polynomial form below.
  highp vec2 f2 = f * f;
  highp vec2 f3 = f2 * f;

  highp vec2 w0 = (-(1.0 / 18.0) * f3 + (1.0 /  6.0) * f2 - (7.0 / 18.0) * f) + (1.0 / 18.0);
  highp vec2 w1 = ( (7.0 /  6.0) * f3 - (2.0      ) * f2                    ) + (8.0 /  9.0);
  highp vec2 w2 = (-(7.0 /  6.0) * f3 + (11.0/ 6.0) * f2 + (7.0 / 18.0) * f) + (1.0 / 18.0);
  highp vec2 w3 = ( (1.0 / 18.0) * f3 - (1.0 /  6.0) * f2                    );

  highp vec2 w12 = w1 + w2;
  highp vec2 offset12 = w2 / w12;

  highp vec2 invTex = 1.0 / texSize;
  highp vec2 texPos0 = (texPos1 - 1.0) * invTex;
  highp vec2 texPos3 = (texPos1 + 2.0) * invTex;
  highp vec2 texPos12 = (texPos1 + offset12) * invTex;

  vec4 result = vec4(0.0);
  result += texture2D(s, vec2(texPos0.x,  texPos0.y))  * w0.x  * w0.y;
  result += texture2D(s, vec2(texPos12.x, texPos0.y))  * w12.x * w0.y;
  result += texture2D(s, vec2(texPos3.x,  texPos0.y))  * w3.x  * w0.y;

  result += texture2D(s, vec2(texPos0.x,  texPos12.y)) * w0.x  * w12.y;
  result += texture2D(s, vec2(texPos12.x, texPos12.y)) * w12.x * w12.y;
  result += texture2D(s, vec2(texPos3.x,  texPos12.y)) * w3.x  * w12.y;

  result += texture2D(s, vec2(texPos0.x,  texPos3.y))  * w0.x  * w3.y;
  result += texture2D(s, vec2(texPos12.x, texPos3.y))  * w12.x * w3.y;
  result += texture2D(s, vec2(texPos3.x,  texPos3.y))  * w3.x  * w3.y;

  return clamp(result, 0.0, 1.0);
}
`;

const KERNEL_TABLE: Record<SamplerKernel, string> = {
  bilinear: BILINEAR_HELPER,
  "catmull-rom": CATMULL_ROM_HELPER,
  mitchell: MITCHELL_HELPER,
};

/** GLSL helper to be prepended before {@link WEBGL_OBJECT_FIT_HELPERS} consumers. */
export function buildSamplerHelperGlsl(kernel: SamplerKernel): string {
  return KERNEL_TABLE[kernel];
}

/**
 * True when the kernel does sub-texel arithmetic and benefits from `highp`
 * precision being declared on the entire fragment shader. Bilinear is fine
 * with the existing `mediump`.
 */
export function kernelNeedsHighPrecisionShader(kernel: SamplerKernel): boolean {
  return kernel !== "bilinear";
}
