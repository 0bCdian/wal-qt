# Design: crop-aware wallpaper transitions (parallax zoom)

## Problem

Parallax baseline **zoom** (and optional pan from layout parallax) means the wallpaper is rendered on an **oversized surface** (`applyLayoutParallax` in [`renderer/src/renderer/parallax.ts`](../../renderer/src/renderer/parallax.ts)); the user visually sees only a **crop** of that surface—the monitor rectangle.

Wallpaper **transitions** today are authored for the **full transition layout**: WebGL shaders sample textures with **`object-fit`–style semantics** mapped to the full canvas layout ([`bindWebGlPresentationUniforms`](../../renderer/src/renderer/image.ts)); GSAP transitions move layers with **`xPercent` / `yPercent`** wipes and blurred fades ([`runGsapLayerTransition`](../../renderer/src/renderer/image.ts), [`fadeLayer.ts`](../../renderer/src/renderer/transition/fadeLayer.ts)).

When zoom > 1, much of that motion—the parts of the curve that traverse **outside** the visible crop—is **never seen**. The **same easing curve** feels **shortened** or **muted** versus parallax off: an “incomplete” transition from the observer’s viewpoint.

This document does **not** change parallax **move** animation (cursor / `wallpaper:parallax` payloads). It targets **wallpaper load transitions** (`runTransition`) only.

## Goal

Keep parallax baseline zoom unchanged during transitions. Adjust transition **geometry** so that **easings and perceptible motion expressed in viewport / screen space** approximate the parallax-off case: the portion of each effect that unfolds **inside the visible window** should occupy the timeline similarly to zoom 1.

## Success criteria

- With parallax baseline zoom substantially > 1, a **fade / wipe / grow / outer / wave** transition is **judged visually** to use the easing “fully” relative to **what appears on screen** (no obvious truncation of the curved phase compared to zoom 1 for the same `TransitionParams`).
- Pixel stability and sharpness regressions unrelated to cropping are avoided (reuse existing backing-size and compositor safeguards).
- Fallback paths (DOM GSAP after WebGL failure; WAAPI fade) behave consistently when crop is non-trivial—not necessarily identical internals, but no obvious “crop off” divergence between engines when both run.

## Non-goals

- Temporarily easing zoom back to `1` for the duration of the transition (explicitly rejected unless added later as an optional UX mode).
- Full-scene **`ImageBitmap` snapshot compositor** replacing shader math (possible future work; heavier than viewport remapping).

## Concepts

### Visible crop rectangle

Define a **layout-space crop** \(R_\text{crop}\) used for transitions:

1. **`rootEl`** (wallpaper monitor root)—same bounding box transition code already resolves against for layout / canvas sizing.
2. **`parallaxSurfaceEl`**—when present, its border box plus **applied `translate`** determines where content sits vs the root.

The **visible** region is effectively the wallpaper content that overlaps the monitor root viewport. Implementations should derive this **at transition start** from `getBoundingClientRect()` (and any known transform chaining) rather than recomputing from engine-only numbers, so layout rounding and DPR snapping stay truthful.

Special case: **`zoom <= 1` and no residual pan**, crop matches full root → existing behavior unchanged (baseline fast path).

### Normalized viewport coordinates

Map **physical output** of the fragment / layer compositor through a normalized 2D range that represents **visible crop**:

- Prefer **explicit uniforms** passed to shaders, e.g. `u_viewport_origin`, `u_viewport_scale` transforming raw UV **before** object-fit projection, or equivalently remap **after** projection with inverse mapping—pick one convention and apply consistently across effects.

Goal: shaders’ **spatial progress** (`wipe` line, `grow` radial distance, etc.) evaluates in **coordinates where the crop spans the full usable range**.

## Approach (crop-aware viewport remapping)

### WebGL transitions (primary)

**Ingress:** Extend [`WebGlPresentationParams`](../../renderer/src/renderer/image.ts) (or a sibling struct consumed alongside it) with **crop / viewport remap** derived from \(R_\text{crop}\) relative to the WebGL canvas layout rect.

**Effect fragments:** Update each shader’s geometric phase (fade may be untouched; wipes / grow / outer / wave need consistent remapping):

- Spatial thresholds and directions should be evaluated so that **`progress = 0` and `progress = 1`** correspond to **edges of visible content**, not the uncropped textured extent.
- **Handoff textures** (`fromWasHandoff: true`): must use the **same** crop semantics as dynamically decoded sources so wipes do not desync edge frames.

**Validation:** Capture two screens (zoom 1 vs zoom ~1.5–2), same wallpaper pair and transition—visible region should exhibit comparable **spatial** pacing of wipe/grow fronts.

### DOM transitions (secondary, same milestone if feasible)

**GSAP wipes / blur_through:** Layers live **inside** the parallax surface; motion is expressed in **`%`** of layer boxes. Crop-aware fixes may involve:

- **`clip-path`** (or **`overflow: hidden`** on an intermediate wrapper scoped to projected visible rect—not always simple if markup is constrained), combined with adjusting **effective** `$xPercent/$yPercent` ranges so traversal matches visible width/height rather than oversized surface; or  
- Equivalent **scaled transform origins** documented per effect—must not break `contain`/`cover`-letterboxed layers.

**WAAPI fade** ([`fadeLayer.ts`](../../renderer/src/renderer/transition/fadeLayer.ts)): opacity-only fades are largely crop-agnostic unless paired with stray transforms; prioritize **parity for wipe-like** GSAP branches first.

## Data flow

1. Before `await runWebGlTransition(...)` ([`runTransition`](../../renderer/src/renderer/image.ts)), compute crop from DOM (root + parallax surface + current transform snapshot).
2. Pass crop into `bindWebGlPresentationUniforms` path (and any resize / cap logic if crop affects apparent aspect—document whether cap uses full layout or viewport).
3. Shaders consume uniforms; eased `progress` from existing ` gsap.parseEase` path unchanged—only spatial mapping changes.
4. On WebGL fallback to GSAP, pass computed crop hints into `runGsapLayerTransition` or a thin adapter so wipes get adjusted ranges where possible without duplicating effect math.

## Error handling / edge cases

- **Missing `.wallpaper-parallax-surface`** (legacy path): behave as zoom 1 / full root (today’s semantics).
- **Resize mid-transition**: transitions already guarded by staleness callbacks; crop must be sampled **once** at start unless we explicitly subscribe to resize (default: freeze at transition start—matches perceptual simplicity).
- **Extreme crops** (surface mostly off-screen due to bugs or future pan APIs): clamp crop to sane intersection / minimum dimension; degrade to legacy full-rect behavior with a **debug-level log**.
- **`outer`/`grow`: origin percentages** supplied by intent are currently relative to layout; define whether origins are reinterpreted **in crop space** (recommended: origins in **visible** crop normalized \([0,1]^2\) so “center spotlight” stays center of **screen**).

## Testing strategy

1. **Unit tests** where possible: pure functions that map `(layoutRect, surfaceRect)` → uniforms or `{ origin, wipeRange }`, with fixed fixture rectangles (existing Vitest harness under `renderer/`).
2. **Visual / manual QA**: scripted checklist comparing zoom 1 vs zoom > 1 same transition; optionally record Chromium DevTools FPS / filmstrip snapshots in CI-less workflow.
3. **Regression**: handoff-from-bitmap transitions and `aspectRatio`/`object-fit` combinations still letterbox correctly **inside** the crop.

## Open questions for implementation phase

1. Exact **uniform layout** naming and whether remap happens pre- vs post-object-fit (pick one shader convention and document inline in Vertex/Fragment prelude).
2. Whether **blur_through** perceptual softness should scale by crop size (minimal first pass: geometry only).
3. Whether **daemon / OpenAPI** must expose a user-facing knob for “crop semantics” toggle (assume **no**—always on when parallax baseline zoom ≠ 1 until product requests otherwise).

## References

- Parallax sizing / pan: [`renderer/src/renderer/parallax.ts`](../../renderer/src/renderer/parallax.ts) (`applyLayoutParallax`, `computeTranslatePercent`).
- Transition dispatch: [`renderer/src/renderer/image.ts`](../../renderer/src/renderer/image.ts) (`runTransition`, `runWebGlTransition`, `bindWebGlPresentationUniforms`).
- Daemon API shape for transitions: [`renderer/src/generated/control-plane.ts`](../../renderer/src/generated/control-plane.ts) (`TransitionParams`).

---

**Status:** approved direction — **crop-aware viewport remapping** (no zoom-out hacks). Proceed to implementation plan (`writing-plans`) after maintainer reviews this file.
