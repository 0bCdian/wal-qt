import { describe, expect, it } from "vitest";
import {
  buildSamplerHelperGlsl,
  SAMPLER_FUNCTION_NAME,
  type SamplerKernel,
} from "./webglSamplerShaders";

const KERNELS: ReadonlyArray<SamplerKernel> = ["bilinear", "catmull-rom", "mitchell"];

describe("buildSamplerHelperGlsl", () => {
  it("defines a sampleTex function with the same signature for every kernel", () => {
    for (const kernel of KERNELS) {
      const glsl = buildSamplerHelperGlsl(kernel);
      // Stable signature so the calling shaders can swap kernels at runtime.
      expect(glsl).toMatch(
        new RegExp(`vec4\\s+${SAMPLER_FUNCTION_NAME}\\s*\\(\\s*sampler2D[^)]*\\)`),
      );
    }
  });

  it("bilinear kernel forwards to texture2D directly", () => {
    const glsl = buildSamplerHelperGlsl("bilinear");
    expect(glsl).toMatch(/texture2D\s*\(/);
  });

  it("catmull-rom uses sub-texel arithmetic (floor + 0.5 + texSize math)", () => {
    const glsl = buildSamplerHelperGlsl("catmull-rom");
    // Hallmarks of the 5-tap Catmull-Rom: floor() to find the texel grid, 0.5 offsets,
    // and a polynomial weight pattern with the f*(1-f)... shape.
    expect(glsl).toMatch(/floor\s*\(/);
    expect(glsl).toMatch(/0\.5/);
    // texSize parameter must be referenced for the sub-pixel offset math.
    expect(glsl).toMatch(/texSize/);
  });

  it("mitchell uses sub-texel arithmetic with different (B=1/3, C=1/3) weights", () => {
    const glsl = buildSamplerHelperGlsl("mitchell");
    expect(glsl).toMatch(/floor\s*\(/);
    expect(glsl).toMatch(/texSize/);
    // Mitchell-Netravali uses 1/3 (or 0.333...) constants in its canonical form.
    expect(glsl).toMatch(/1\.0\s*\/\s*3\.0|0\.333/);
  });

  it("higher-order kernels promote precision to highp for sub-texel safety on 4K", () => {
    for (const kernel of ["catmull-rom", "mitchell"] as const) {
      const glsl = buildSamplerHelperGlsl(kernel);
      // Either the helper itself is prefixed with `precision highp float`
      // or it declares its locals as highp; both are acceptable.
      expect(glsl).toMatch(/highp/);
    }
  });

  it("clamps the result to [0,1] so Catmull-Rom ringing cannot overshoot", () => {
    // Catmull-Rom can ring slightly negative or above 1.0 across hard edges.
    // Clamping prevents the framebuffer from showing super-bright halos.
    const glsl = buildSamplerHelperGlsl("catmull-rom");
    expect(glsl).toMatch(/clamp\s*\(/);
  });
});
