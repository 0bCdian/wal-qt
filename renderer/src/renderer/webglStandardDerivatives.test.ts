import { describe, expect, it } from "vitest";
import { stripOesStandardDerivativesExtensionLineForWebGL2 } from "./webglStandardDerivatives";

describe("stripOesStandardDerivativesExtensionLineForWebGL2", () => {
  it("is a no-op when the context is WebGL1", () => {
    const src = `#extension GL_OES_standard_derivatives : enable
precision mediump float;
void main() {}
`;
    expect(stripOesStandardDerivativesExtensionLineForWebGL2(false, src)).toBe(src);
  });

  it("removes the OES_standard_derivatives line for WebGL2", () => {
    const src = `#extension GL_OES_standard_derivatives : enable
precision mediump float;
void main() {}
`;
    expect(stripOesStandardDerivativesExtensionLineForWebGL2(true, src))
      .toBe(`precision mediump float;
void main() {}
`);
  });

  it("does not strip when the extension line is absent", () => {
    const src = `precision mediump float;
void main() {}
`;
    expect(stripOesStandardDerivativesExtensionLineForWebGL2(true, src)).toBe(src);
  });
});
