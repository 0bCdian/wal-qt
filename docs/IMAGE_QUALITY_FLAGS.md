# Renderer image-quality flags

The wal-qt renderer's WebGL transition pipeline supports several runtime
**image-quality modes** that control how the mid-transition canvas frames look
relative to the pre-/post-transition `<img>` element.

The motivating problem: the browser's `<img>` element draws with a high-order
filter (Lanczos / bicubic on Chromium and Qt WebEngine). Plain WebGL `texture2D`
sampling uses a 2-tap **bilinear** kernel. On hard edges (drawings, line art),
bilinear shows visible stair-stepping while `<img>` looks "antialiased". These
flags let us close that gap (Mode A is enough for almost all content; the
others are escape hatches and dev-only experiments).

> All modes are switchable at runtime; nothing here breaks the wire format. The
> implementation lives in `renderer/src/renderer/imageQualityFlags.ts`,
> `webglSamplerShaders.ts`, `webglTextureUpscale.ts`, `webglFxaaShader.ts`,
> and the consumer wiring is in `image.ts`.

---

## TL;DR — defaults

The default config is the recommended setup:

```js
window.__waypaperImageQuality = {
  sampler:    "catmull-rom", // Mode A — high-order bicubic GLSL sampler
  colorSpace: "srgb",        // Mode D — display-space filter; closest to <img> brightness
  upscale:    "gpu",         // Mode B off — let the GPU sampler handle upscale
  fxaa:       "off",         // Mode E off — no post pass needed once Mode A is on
};
```

You should not need to touch this for normal use. Read on if you're chasing a
specific visual artefact, or if you want to compare against the pre-Catmull-Rom
baseline.

---

## How to set the flags

### From the Qt host (production)

The Qt host bootstrap script already injects `window.__WAYPAPER_CONFIG`. Add
the same kind of pre-document-creation script that sets `window.__waypaperImageQuality`
(see `wallpaper_window.cpp` for the bootstrap-script pattern). Example for a
host that wants to experiment with the softer Mitchell kernel:

```cpp
static const char IMAGE_QUALITY_BOOTSTRAP_JS[] = R"js(
window.__waypaperImageQuality = { sampler: "mitchell" };
)js";
```

### From devtools (developer iteration)

Open the QtWebEngine devtools (or any browser tab pointed at the renderer
SPA) and set:

```js
window.__waypaperImageQuality = { sampler: "bilinear" };
```

The new flags take effect on the **next** transition — they're re-read at the
start of every WebGL transition. You can flip them mid-session to A/B compare
without reloading.

### Partial overrides

Any subset works; missing keys fall back to the defaults. Unknown keys and
unknown values are silently ignored (with the unknown value falling back to
its default). The parser is intentionally tolerant so a typo in a hand-edited
config can't crash the renderer.

---

## The five modes

Every mode below is independently toggleable. They don't interact except where
noted.

### Mode A — `sampler` (texture sampling kernel)

Where: `webglSamplerShaders.ts`. Wires through `pickWebGlFragmentForDevice`
and the rewritten `WEBGL_OBJECT_FIT_HELPERS` in `image.ts`.

| Value         | Taps | Visual                                | Use when                               |
|---------------|------|---------------------------------------|----------------------------------------|
| `bilinear`    | 1    | Stair-steps hard edges                | You want the pre-Mode-A baseline.      |
| `catmull-rom` | 5    | Lanczos2-equivalent. **Default.**     | Default; matches `<img>` for line art. |
| `mitchell`    | 5    | Slightly softer; less ringing         | Catmull-Rom shows halo artefacts.      |

The 5-tap Catmull-Rom and Mitchell variants both use the
Vlachos / Castorina trick that collapses 16-tap bicubic into 5 hardware-bilinear
fetches. Higher-order kernels promote the fragment shader's default precision
to `highp` and declare local sub-texel arithmetic as `highp` so 4K backings
don't lose precision.

**When to flip:**

- See visible jaggies on a drawing / line-art wallpaper mid-transition →
  default `catmull-rom` should already fix it.
- See visible **bright halos** around tight high-contrast details with
  `catmull-rom` → try `mitchell`.
- Profiling shows shader cost dominates on a low-end GPU → fall back to
  `bilinear` (and accept the aliasing).

**Cost:** ~5× more texture taps than bilinear. Negligible on the fullscreen
quad we render at transition rate; not measured to matter on integrated
graphics in practice. Worth profiling on your weakest target hardware if
you care.

---

### Mode B — `upscale` (CPU Lanczos pre-upscale)

Where: `webglTextureUpscale.ts` + `decideWebGlTextureBitmapSize` in `image.ts`.

| Value         | Where the upscale runs       | Cost              | Visual              |
|---------------|------------------------------|-------------------|---------------------|
| `gpu`         | Per-frame in shader sampler  | Free RAM          | Default. Excellent. |
| `cpu-lanczos` | Once at decode (Lanczos)     | Heavy: full-res RGBA bitmap | Pixel-identical to `<img>`. |

When the source bitmap is at least 5% smaller than the cap on either axis
(`CPU_LANCZOS_UPSCALE_MIN_SHORTFALL`), Mode B asks
`createImageBitmap(blob, { resizeWidth, resizeHeight, resizeQuality: "high" })`
to upscale on decode. Chromium / Qt WebEngine's `resizeQuality: "high"` is
Lanczos — the same kernel the `<img>` element uses. The transition then runs
identity GPU sampling, so the mid-blend is bit-for-bit indistinguishable from
the post-transition `<img>` (modulo blend ordering).

**Trade-offs:**

- A 4K RGBA bitmap is ~33 MB; with `from` + `to` simultaneously held that's
  ~66 MB extra resident. Per monitor.
- The decode-time Lanczos resize stalls the transition prep step; we measured
  it adds tens to low hundreds of milliseconds for typical 1080p sources.
- Only meaningful when the source is **smaller** than the cap. For
  source ≥ cap, the GPU sampler downscales with mipmaps which is already
  excellent; Mode B is a no-op there.
- Skipped automatically for `image_fit_mode in ("contain", "none", "scale-down")`
  — upscaling there is wasteful or harmful.

**When to flip:** you have a tiny source on a 4K monitor and even Mode A
doesn't quite match `<img>`, *and* the memory cost is fine for your setup.
For everything else, leave at `gpu`.

The transition texture cache (`webglTextureCache`) keys on the upscale mode,
so flipping the flag mid-session correctly invalidates the cached bitmap.

---

### Mode C — texture sizing rounding

Where: `coverTextureBitmapSize` in `webglTextureSizing.ts`.

Not user-visible as a flag — this is a baked-in behavioral fix. The cover
texture sizing now uses `Math.round(iw * scale)` instead of `Math.floor(iw * scale)`
so IEEE rounding (`iw * (capW/iw)` evaluating to `capW - 1ulp` on adversarial
inputs) cannot leave the cover-axis 1 pixel short of the cap. The off-axis
naturally overshoots and is cropped by the shader, so rounding up there is
harmless.

`containTextureBitmapSize` keeps `Math.floor` because contain MUST fit inside
the cap — overshoot would silently exceed the layout box.

---

### Mode D — `colorSpace` (sampler color space on WebGL2)

Where: `makeTexture` in `image.ts`.

| Value     | WebGL2 internalFormat | Filter happens in… | Visual notes                             |
|-----------|------------------------|---------------------|------------------------------------------|
| `auto`    | `SRGB8_ALPHA8`         | linear-light       | Default. Physically correct.             |
| `linear`  | `SRGB8_ALPHA8`         | linear-light       | Same as `auto`; explicit form.           |
| `srgb`    | `RGBA`                 | display (sRGB)     | Matches `<img>` perceptual midpoint.     |

The interesting one is `srgb`. With `SRGB8_ALPHA8`, bilinear / Catmull-Rom
filtering averages texels in linear-light — physically correct, but a black-
to-white midpoint blends to ~0.73 sRGB instead of the ~0.5 sRGB midpoint that
the browser's `<img>` produces. This makes high-contrast edges look harder /
more contrasty in the WebGL canvas than in `<img>`.

Forcing `colorSpace: "srgb"` skips the SRGB8_ALPHA8 promotion and filters in
display-encoded space, perceptually matching `<img>`. The cost is gamma-
incorrect blends in long photographic gradients — but for a short-lived
transition, the mismatch is invisible to most observers.

**When to flip:** A/B comparing the WebGL canvas mid-transition against
`<img>` shows a brightness shift on hard B/W edges → try `srgb`. For
photographic wallpapers, leave at `auto`.

WebGL1 has no `SRGB8_ALPHA8`, so `colorSpace` is a no-op there
(filtering always happens in display space).

---

### Mode E — `fxaa` (FXAA 3.11 Console post pass)

Where: `webglFxaaShader.ts` + `ensureFxaaResources` / `drawFrame` in `image.ts`.

| Value | Cost                                  | Visual             |
|-------|---------------------------------------|--------------------|
| `off` | Single forward pass to canvas         | Default.           |
| `on`  | One color-attached FBO + 7 extra taps | Edge cleanup pass. |

Adapted from Timothy Lottes' public-domain FXAA 3.11 reference, "Console"
preset. The transition shader renders into a color-attached FBO at canvas
backing size, then a fullscreen quad samples the FBO with edge-aware tent
filtering and writes to the canvas.

The FBO is sized to canvas backing dimensions and resized when the canvas
resizes mid-transition (rare; happens during the post-show backing re-sync).
Resources are lazily allocated on the first transition that opts in, and
torn down with the rest of the WebGL shared state in `releaseWallpaperWebGlForIdle`.

**Caveats:**

- The FBO color attachment is plain `RGBA` (not `SRGB8_ALPHA8`), so when
  Mode A samples a sRGB texture, the linear-light values flow through FXAA
  uncorrected. FXAA's luma weighting is sRGB-biased; feeding it linear
  values slightly under-weights bright edges. In practice the perceptual
  difference is negligible on transition content — this is a deliberate
  simplicity / portability trade-off.
- An FXAA failure (FBO incomplete, program link error) downgrades silently
  to direct render; a `logger.warn` records the reason.
- Adds ~7 extra texture fetches per pixel × 2 passes per frame. On the
  fullscreen-quad transition geometry this is still well within budget on
  any modern desktop GPU.

**When to flip:** you've already enabled Mode A and still see residual sub-
pixel aliasing on extreme content. For 99% of wallpapers, leave at `off`.

---

## Quick decision guide

Flowchart for "the WebGL canvas mid-transition doesn't look like `<img>`":

1. **Are you on the default config?** If yes (Catmull-Rom), you've already
   addressed the dominant cause. If you're still seeing artefacts, continue.
2. **Stair-steps on hard edges?** This is the bilinear-vs-Lanczos gap.
   Confirm `sampler: "catmull-rom"` (or `"mitchell"`).
3. **Halos / ringing around tight contrast?** Catmull-Rom can ring slightly.
   Try `sampler: "mitchell"`.
4. **Brightness mismatch on B/W edges?** Try `colorSpace: "srgb"`.
5. **Soft / blurred upscale on a tiny source on a 4K monitor?** Try
   `upscale: "cpu-lanczos"` and accept the memory + decode cost.
6. **Residual sub-pixel aliasing on hostile content?** Try `fxaa: "on"`.
7. **Slow shader compile / GPU pegged on integrated graphics?** Try
   `sampler: "bilinear"` and accept the aliasing.

---

## Implementation map

| Module                                     | Owns                                                                 |
|--------------------------------------------|----------------------------------------------------------------------|
| `imageQualityFlags.ts`                     | Public flag types, defaults, parser, `readImageQualityFlags`.        |
| `webglSamplerShaders.ts`                   | `sampleTex` GLSL helper for each kernel; `kernelNeedsHighPrecisionShader`. |
| `webglTextureUpscale.ts`                   | `shouldRunCpuLanczosUpscale` + `cpuLanczosUpscaleTargetSize` decision logic. |
| `webglFxaaShader.ts`                       | `FXAA_VERTEX_SOURCE`, `FXAA_FRAGMENT_SOURCE`.                        |
| `webglTextureSizing.ts`                    | Cover/contain texture sizing (with the Mode C `Math.round` fix).     |
| `image.ts` — `WEBGL_OBJECT_FIT_HELPERS`    | All texture reads now go through `sampleTex(sampler, uv, texSize)`.  |
| `image.ts` — `pickWebGlFragmentForDevice`  | Composes per-device fragment + sampler kernel + precision qualifier; strips `GL_OES_standard_derivatives` on WebGL2 (see below). |
| `image.ts` — `decideWebGlTextureBitmapSize` | Mode-B-aware texture target size at decode.                         |
| `image.ts` — `ensureFxaaResources` + `drawFrame` | Mode E FBO/program management + render-loop wrapper.            |
| `webglStandardDerivatives.ts`              | Strips the OES extension line for WebGL2 contexts (Qt WebEngine / ANGLE). |

### Qt WebEngine / WebGL2 and `fwidth`

On a **WebGL2** context, GLSL ES 1.00 fragment shaders get `fwidth` without
enabling `GL_OES_standard_derivatives`. Keeping the `#extension` line makes
ANGLE warn that the extension is unsupported and can leave `fwidth` unresolved
(`no matching overloaded function found`). The renderer omits that line when
`gl instanceof WebGL2RenderingContext` and mirrors the same rule in
`probeTransitionFwidthShaderLink`. If a full program still fails to link, we
fall back once to the legacy non-`fwidth` shader and cache that for later
transitions.

Tests:

- `imageQualityFlags.test.ts` — flag parsing + defaults.
- `webglSamplerShaders.test.ts` — sampler GLSL signatures + kernel hallmarks.
- `webglTextureUpscale.test.ts` — Mode B size-decision logic.
- `webglFxaaShader.test.ts` — FXAA shader source contract.
- `webglTextureSizing.test.ts` — Mode C cover-axis robustness.
- `webglStandardDerivatives.test.ts` — WebGL2 extension-line stripping.

Unit tests pass in CI. There is no automated visual regression for these modes
yet — verify visually on a target Wayland setup with a hard-edged drawing
wallpaper and a softer photographic wallpaper before shipping a default change.

---

## Future work

- Visual regression: capture a fixed mid-transition frame from each mode and
  diff against goldens. Requires headless WebGL in CI; not wired yet.
- sRGB-aware FXAA FBO: switch the color attachment to `SRGB8_ALPHA8` on
  WebGL2 and let auto-encode handle the perceptual side. Skipped for now
  because the existing pipeline writes linear-light values to a non-sRGB
  default canvas drawing buffer and the browser handles the final encode —
  matching that exactly inside an FBO is more involved than Mode E justifies.
- Per-effect kernel override (e.g. force `bilinear` for the `wave` shader to
  save fillrate during the wave's spatial scan). Not implemented; the same
  kernel currently applies to every effect.
