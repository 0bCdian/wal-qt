/**
 * FXAA 3.11 "Console" variant — Mode E in `docs/IMAGE_QUALITY_FLAGS.md`.
 *
 * Adapted from Timothy Lottes' public-domain FXAA reference implementation
 * (NVIDIA Developer, 2011). The Console variant uses 7 texture taps (vs the
 * 12-tap Quality variant) and is more than enough as a residual-aliasing
 * cleanup pass on top of the Catmull-Rom sampler — for a fullscreen quad on
 * a single transition canvas we don't need the full PC quality preset.
 *
 * Pipeline: transition shader renders into a color-attached FBO at canvas
 * backing size, then this shader samples that FBO with edge-aware tent
 * filtering and writes to the default framebuffer.
 *
 * Vertex layout matches `WEBGL_TRANSITION_VERTEX_SOURCE` so we can reuse
 * the same fullscreen-quad VBO and `a_position` attribute binding.
 */

export const FXAA_VERTEX_SOURCE = `
attribute vec2 a_position;
varying highp vec2 v_uv;
void main() {
  vec2 uv = (a_position + 1.0) * 0.5;
  v_uv = vec2(uv.x, 1.0 - uv.y);
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

export const FXAA_FRAGMENT_SOURCE = `
precision highp float;

uniform sampler2D u_tex;
uniform vec2 u_inv_tex_size;
varying highp vec2 v_uv;

float fxaaLuma(vec3 rgb) {
  // Lottes' fast luma: G * (0.587/0.299) + R, equivalent to a green-weighted
  // perceptual luma but skipping the blue contribution because B contributes
  // little to apparent edge contrast for typical content.
  return rgb.g * (0.587 / 0.299) + rgb.r;
}

void main() {
  vec2 inv = u_inv_tex_size;
  vec3 nw = texture2D(u_tex, v_uv + vec2(-inv.x, -inv.y)).rgb;
  vec3 ne = texture2D(u_tex, v_uv + vec2( inv.x, -inv.y)).rgb;
  vec3 sw = texture2D(u_tex, v_uv + vec2(-inv.x,  inv.y)).rgb;
  vec3 se = texture2D(u_tex, v_uv + vec2( inv.x,  inv.y)).rgb;
  vec3 m  = texture2D(u_tex, v_uv).rgb;

  float lumaNw = fxaaLuma(nw);
  float lumaNe = fxaaLuma(ne);
  float lumaSw = fxaaLuma(sw);
  float lumaSe = fxaaLuma(se);
  float lumaM  = fxaaLuma(m);

  float lumaMin = min(lumaM, min(min(lumaNw, lumaNe), min(lumaSw, lumaSe)));
  float lumaMax = max(lumaM, max(max(lumaNw, lumaNe), max(lumaSw, lumaSe)));

  vec2 dir;
  dir.x = -((lumaNw + lumaNe) - (lumaSw + lumaSe));
  dir.y =  ((lumaNw + lumaSw) - (lumaNe + lumaSe));

  float reduce = max((lumaNw + lumaNe + lumaSw + lumaSe) * 0.25 * (1.0 / 8.0), 1.0 / 128.0);
  float rcpDirMin = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcpDirMin, vec2(-8.0), vec2(8.0)) * inv;

  vec3 rgbA = 0.5 * (
    texture2D(u_tex, v_uv + dir * (1.0 / 3.0 - 0.5)).rgb +
    texture2D(u_tex, v_uv + dir * (2.0 / 3.0 - 0.5)).rgb
  );
  vec3 rgbB = rgbA * 0.5 + 0.25 * (
    texture2D(u_tex, v_uv + dir * -0.5).rgb +
    texture2D(u_tex, v_uv + dir *  0.5).rgb
  );

  float lumaB = fxaaLuma(rgbB);
  if (lumaB < lumaMin || lumaB > lumaMax) {
    gl_FragColor = vec4(rgbA, 1.0);
  } else {
    gl_FragColor = vec4(rgbB, 1.0);
  }
}
`;
