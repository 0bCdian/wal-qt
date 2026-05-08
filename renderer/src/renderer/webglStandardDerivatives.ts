/**
 * WebGL 2.0 makes `dFdx` / `dFdy` / `fwidth` available for GLSL ES 1.00 fragment
 * shaders **without** `GL_OES_standard_derivatives` (Khronos WebGL 2.0 spec).
 *
 * Qt WebEngine / ANGLE often warns that the extension is "not supported" on a
 * WebGL2 context and then `fwidth` fails to resolve — so transition shaders
 * must omit the `#extension` line when `gl` is a `WebGL2RenderingContext`.
 */

export function stripOesStandardDerivativesExtensionLineForWebGL2(
  isWebGL2: boolean,
  fragmentSource: string,
): string {
  if (!isWebGL2) return fragmentSource;
  return fragmentSource.replace(/^#extension GL_OES_standard_derivatives : enable\s*\n/m, "");
}
