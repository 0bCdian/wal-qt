import { describe, expect, it } from "vitest";
import { FXAA_FRAGMENT_SOURCE, FXAA_VERTEX_SOURCE } from "./webglFxaaShader";

describe("FXAA shader sources", () => {
  it("vertex shader exposes a_position attribute and v_uv varying", () => {
    expect(FXAA_VERTEX_SOURCE).toMatch(/attribute\s+vec2\s+a_position/);
    expect(FXAA_VERTEX_SOURCE).toMatch(/varying\s+highp\s+vec2\s+v_uv/);
  });

  it("fragment shader uses highp precision (sub-pixel offsets need it on 4K)", () => {
    expect(FXAA_FRAGMENT_SOURCE).toMatch(/precision\s+highp\s+float\s*;/);
  });

  it("fragment shader exposes the canonical FXAA uniforms", () => {
    expect(FXAA_FRAGMENT_SOURCE).toMatch(/uniform\s+sampler2D\s+u_tex/);
    expect(FXAA_FRAGMENT_SOURCE).toMatch(/uniform\s+vec2\s+u_inv_tex_size/);
  });

  it("fragment shader does the FXAA luma weighting (rgb.g / rgb.r mix)", () => {
    // Lottes' FXAA 3.11 uses luma = rgb.g * (0.587/0.299) + rgb.r as a fast
    // perceptual approximation. The literal mix tells us we're using the right
    // algorithm rather than e.g. rec.709 luma.
    expect(FXAA_FRAGMENT_SOURCE).toMatch(/0\.587\s*\/\s*0\.299|1\.96|FXAA_LUMA_R_FACTOR/);
  });

  it("fragment shader writes its result to gl_FragColor", () => {
    expect(FXAA_FRAGMENT_SOURCE).toMatch(/gl_FragColor\s*=/);
  });
});
