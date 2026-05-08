# wal-qt renderer

Vite + TypeScript SPA embedded into the Qt host as a `qrc:` resource. Drives
the wallpaper layers (`<img>`, `<video>`, `<canvas>` for WebGL transitions)
that Qt places onto each monitor's background-layer `QWebEngineView`.

## Run

```sh
npm install
npm run dev          # local browser dev (no Qt host)
npm run build        # produces dist/, embedded by the wal-qt CMake target
npm run check:all:strict   # lint + format + typecheck + tests (CI gate)
```

## Tests

```sh
npm run test         # vitest run, all unit tests (Node env, no DOM)
```

Unit tests are pure-TS (string-shape, math, parsing). There is no headless
WebGL coverage in CI — visually regress changes to GLSL helpers on a real
Wayland desktop.

## Image-quality flags

The WebGL transition pipeline supports five switchable image-quality modes
(sampler kernel, color space, CPU pre-upscale, FXAA, plus a baked-in cover-
sizing fix). Defaults match the recommended setup; flip from the Qt host
bootstrap script or from devtools to A/B compare.

See **[docs/IMAGE_QUALITY_FLAGS.md](../docs/IMAGE_QUALITY_FLAGS.md)** in
this repo for the full mode catalogue, decision guide, and implementation map.

Quick reference:

```js
window.__waypaperImageQuality = {
  sampler: "catmull-rom", // bilinear | catmull-rom (default) | mitchell
  colorSpace: "srgb", // auto | linear | srgb (default srgb for <img> parity)
  upscale: "gpu", // gpu (default) | cpu-lanczos
  fxaa: "off", // off (default) | on
};
```

## Module map

| Path                                     | Role                                                        |
| ---------------------------------------- | ----------------------------------------------------------- |
| `src/main.ts`                            | Bridge connect, DOM bootstrap, load dispatch.               |
| `src/renderer/image.ts`                  | Image transitions (WebGL + DOM compositor + handoff state). |
| `src/renderer/video.ts` + `videoLoop.ts` | Video playback + loop fade.                                 |
| `src/renderer/transition/`               | Effect crop, wipe geometry, fade layer (WAAPI / CSS).       |
| `src/renderer/imageQualityFlags.ts`      | Image-quality flag types, parser, defaults.                 |
| `src/renderer/webglSamplerShaders.ts`    | GLSL helpers per sampler kernel (Mode A).                   |
| `src/renderer/webglTextureUpscale.ts`    | CPU Lanczos pre-upscale decision logic (Mode B).            |
| `src/renderer/webglFxaaShader.ts`        | FXAA 3.11 Console shader source (Mode E).                   |
| `src/renderer/webglTextureSizing.ts`     | Cover/contain/fill/none texture sizing (incl. Mode C fix).  |
| `src/renderer/webglObjectFit.ts`         | Object-fit kind resolution + natural→backing pixel mapping. |
| `src/renderer/parallax.ts`               | Parallax surface offset + zoom layout.                      |
| `src/generated/control-plane.ts`         | OpenAPI-generated types — do not edit by hand.              |
