# LLM guide: Waypaper web wallpaper packages (wal-qt)

**Audience:** coding agents authoring HTML/JS/CSS wallpapers for **wal-qt** (Qt WebEngine host) and **waypaper-engine** (loads packages via the wal-qt HTTP API).

**Authority:** behavior described here is derived from wal-qt source (`src/wallpaper/target_resolver.cpp`, `src/wallpaper/wallpaper_window.cpp`, `src/audio/audio_capture.*`, `openapi/wal-qt.yaml`). Older **wal-utauri / Tauri** docs may mention `listen("wallpaper:parallax")` — **wal-qt uses DOM `CustomEvent`s on `window`**, not `@tauri-apps/api`.

---

## 1. Package layout

A **web package** is a directory served under the custom scheme `waypaperhtml://pkg/…`.

```text
my-wallpaper/
  waypaper.json          # manifest (recommended)
  index.html             # entry (default if no manifest)
  assets/
    app.js
    style.css
```

**Resolve rules (host):**

| Input | Result |
|--------|--------|
| Path to `waypaper.json` or `project.json` | Package root = parent dir; `entry` from manifest |
| Directory with `waypaper.json` / `project.json` | Same |
| Directory with only `index.html` | Entry = `index.html`, capabilities default off |
| Single `.html` file | That file is entry; walks up ≤3 parents for `waypaper.json` |

Assets must live **inside the package root**. Paths with `..` that escape the package are rejected at serve time.

---

## 2. Manifest: `waypaper.json`

wal-qt reads this JSON in `parseManifest()` (`target_resolver.cpp`). Fields **not** listed below are ignored by the host (but may be used by waypaper-engine for gallery metadata).

### Top-level

| Field | Type | Default | Host use |
|--------|------|---------|----------|
| `entry` | string | `index.html` | Relative HTML entry under package root. Legacy alias: `file`. |
| `capabilities` | object | all false | See §3 |
| `wallpaper_config` | object | `{}` | Schema of user-tunable properties (§5). Not applied automatically — engine merges values and sends them on load. |

**Recommended metadata** (for waypaper-engine import; **not** validated by wal-qt C++ today):

- `waypaper`: `"1"` — version tag used in ecosystem docs
- `title`, `description`, `version`, `author`, `tags`, `preview`
- `parallax_direction`: `"horizontal"` \| `"vertical"` — workspace parallax driver hint in engine (not read by wal-qt manifest parser)

### Example (minimal, audio + parallax-aware)

```json
{
  "entry": "index.html",
  "capabilities": {
    "network": false,
    "pointer_interactive": false,
    "keyboard": false,
    "audio_reactive": true,
    "autoplay": true
  },
  "wallpaper_config": {
    "gain": {
      "type": "number",
      "default": 1.0,
      "min": 0.1,
      "max": 3.0,
      "step": 0.1,
      "label": "Visual gain"
    }
  }
}
```

### `capabilities` object (parsed keys)

All booleans; **default `false`** except `autoplay` defaults **`true`** in C++.

| JSON key | Meaning |
|----------|---------|
| `network` | Package *requests* remote `fetch`/XHR/WebSocket. **Effective** access also requires global `POST /settings/network` (`allow_network_wallpapers`). |
| `pointer_interactive` | Wallpaper receives pointer hits (not fully click-through). |
| `keyboard` | Layer-shell keyboard interactivity for the webview. |
| `audio_reactive` | Host captures desktop audio (PipeWire monitor) and dispatches frames to the page (§4). |
| `autoplay` | Stored in manifest; reserved for playback policy wiring. |

**Not read from `waypaper.json` by wal-qt today:** `parallax_aware` (appears on OpenAPI `WebCapabilities` for runtime `POST /wallpaper/web-capabilities` only). You may still set `"parallax_aware": true` as **documentation** for humans/tools.

Runtime overrides: engine may call `POST /wallpaper/web-capabilities` with `{ "source_target": "<abs path>", "capabilities": { "audio_reactive": true, … } }` — host applies `pointer_interactive`, `keyboard`, `audio_reactive` without reloading the page.

---

## 3. How the page is loaded

- **URL:** `waypaperhtml://pkg/<entry>` (e.g. `waypaperhtml://pkg/index.html`)
- **User config at first paint:** if the engine passes `wallpaper_config_values` on load, the host appends query `__waypaper_cfg=<base64(JSON)>`; bootstrap sets `window.__WAYPAPER_CONFIG` and fires `waypaper:config` (see §5).
- **CSP (default, network off):** injected meta policy — `default-src 'self' waypaperhtml: walfile: file: data: blob:`; no remote `https:` unless network is effectively allowed (manifest + global setting). Prefer bundling JS/CSS into the package.
- **Wallpaper Engine stubs:** at document creation the host defines no-op or bridge stubs so WE scripts do not crash: `wallpaperRegisterAudioListener`, `wallpaperRegisterMedia*Listener`, `wallpaperPropertyListener`, etc. (`wallpaper_window.cpp`).

---

## 4. Audio-reactive API

### Requirements

1. `"audio_reactive": true` in `waypaper.json` **or** runtime capability push.
2. PipeWire/Pulse monitor capture available on the system (see wal-qt README).
3. Host starts `AudioCapture` only while **at least one** web wallpaper has `audioReactive` active.

### Signal shape

- **128** log-spaced bands (~20 Hz–20 kHz), each **`0.0`–`1.0`** float in `postMessage` payload.
- **`rms`**, **`peak`**: floats for the current FFT window (`AUDIO_FFT_SIZE = 1024`, ~44.1 kHz).

Dispatch rate follows audio buffer fill (roughly tens of Hz, not vsync-locked).

### Consumption (choose one or both)

**A. Wallpaper Engine–compatible (recommended for portable wallpapers)**

```js
window.wallpaperRegisterAudioListener((audioArray) => {
  // audioArray: Uint8Array(128), each byte 0–255
  const level = audioArray[10] / 255;
});
```

**B. `postMessage` bus**

```js
window.addEventListener("message", (ev) => {
  const d = ev.data;
  if (!d || d.type !== "waypaper:audio-reactive") return;
  const { bands, peak, rms } = d;
  // bands: number[128], 0..1
});
```

Host implementation: `__wpAudioDispatchWE` converts float bands → `Uint8Array`, calls registered callback, then `postMessage` (`wallpaper_window.cpp`).

### Agent checklist

- [ ] Guard animation when `bands` are all ~0 for long periods (silent output / wrong monitor source).
- [ ] Do **not** set `audio_reactive: true` if the wallpaper does not use audio (wastes capture).
- [ ] Avoid allocating large objects per frame; reuse typed arrays or uniforms.

---

## 5. User configuration: `wallpaper_config` + events

### Manifest schema (`wallpaper_config`)

Map **property id** → descriptor. waypaper-engine uses this for the settings UI; wal-qt receives **merged values** only at runtime.

| Field | Purpose |
|--------|---------|
| `type` | `number` \| `bool` \| `boolean` \| `string` \| `color` |
| `default` | Default value |
| `label` | UI label (optional) |
| `min`, `max`, `step` | For numbers |

### Runtime delivery

| Mechanism | When |
|-----------|------|
| `window.__WAYPAPER_CONFIG` | After bootstrap / config push |
| `waypaper:config` | `CustomEvent` on `window`; **`event.detail`** is the values object |
| Load query `__waypaper_cfg` | Base64 JSON on first navigation |

```js
function applyConfig(detail) {
  const cfg = detail ?? window.__WAYPAPER_CONFIG ?? {};
  // use cfg.gain, cfg.accent, etc.
}

window.addEventListener("waypaper:config", (ev) => {
  applyConfig(ev.detail);
});

applyConfig(window.__WAYPAPER_CONFIG);
```

Live updates: engine `POST /wallpaper/config` with `{ "source_target": "<abs package path>", "values": { … } }` → host re-dispatches `waypaper:config`.

---

## 6. Parallax API

Parallax is **off** until the engine enables it (settings + workspace driver). Applies to **web packages** via JS events; **image/video** use the built-in renderer (`renderer/src/renderer/parallax.ts`) instead.

### Event: `wallpaper:parallax`

Subscribe on **`window`** (DOM, not Tauri):

```js
window.addEventListener("wallpaper:parallax", (ev) => {
  const p = ev.detail;
  // p.enabled, p.zoom, p.offset_x, p.offset_y,
  // p.animation_ms, p.easing, p.reset_ms,
  // p.wrapped_x, p.wrapped_y
});
```

| Field | Type | Notes |
|--------|------|--------|
| `enabled` | boolean | When false, animate back using `reset_ms` + `easing` |
| `zoom` | number | ≥ 1; scale headroom for pan |
| `offset_x`, `offset_y` | number | Normalized offsets in **≈ −0.5 … 0.5**; host wraps at edges |
| `animation_ms` | number | Transition duration for this update |
| `easing` | `[n,n,n,n]` | CSS cubic-bezier control points |
| `reset_ms` | number | Used when disabling |
| `wrapped_x`, `wrapped_y` | boolean | Host jumped offset (elastic wrap) |

**HTTP (engine → wal-qt):** `POST /wallpaper/parallax` sets baseline; `POST /wallpaper/parallax-move` with `{ "direction": "left"|"right"|"up"|"down" }` nudges by `step_percent` (default 5% of range per step).

### Applying motion in CSS (simple)

Offsets are **normalized**; a practical mapping (see built-in renderer for DPR-safe layout):

```js
function applyParallax(p) {
  const root = document.documentElement;
  if (!p.enabled) {
    root.style.transition = `transform ${p.reset_ms}ms cubic-bezier(${p.easing.join(",")})`;
    root.style.transform = "";
    return;
  }
  const z = Math.max(1, p.zoom);
  const tx = p.offset_x * (z - 1) * 100 / z;
  const ty = p.offset_y * (z - 1) * 100 / z;
  root.style.transition = `transform ${p.animation_ms}ms cubic-bezier(${p.easing.join(",")})`;
  root.style.transformOrigin = "center center";
  root.style.transform = `scale(${z}) translate(${tx}%, ${ty}%)`;
}
```

For large canvases/WebGL, transform **content** inside a full-viewport stage instead of the root if you need crisp pixels.

### Initial parallax on load

OpenAPI `LoadBody.parallax` / load manifest field applies baseline zoom when the wallpaper is shown (engine responsibility). Web pages should handle the first `wallpaper:parallax` with `enabled: true` the same as updates.

### Agent checklist

- [ ] Implement `wallpaper:parallax` if the wallpaper should move with workspace changes.
- [ ] Set `"parallax_aware": true` in manifest metadata (for gallery hints) even though wal-qt does not gate events on it.
- [ ] Do not assume `wallpaper:parallax-move` exists in the page — host handles moves; page only receives resulting `wallpaper:parallax` payloads.

---

## 7. End-to-end skeleton (agent template)

```html
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>My Wallpaper</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111; }
      #stage { width: 100%; height: 100%; will-change: transform; }
    </style>
  </head>
  <body>
    <motion id="stage"></motion>
    <script type="module">
      const stage = document.getElementById("stage");

      function onConfig(detail) {
        const cfg = detail ?? window.__WAYPAPER_CONFIG ?? {};
        stage.style.filter = `brightness(${cfg.brightness ?? 1})`;
      }
      window.addEventListener("waypaper:config", (e) => onConfig(e.detail));
      onConfig(window.__WAYPAPER_CONFIG);

      window.addEventListener("wallpaper:parallax", (e) => {
        const p = e.detail;
        if (!p?.enabled) {
          stage.style.transition = `transform ${p.reset_ms}ms cubic-bezier(${p.easing.join(",")})`;
          stage.style.transform = "";
          return;
        }
        const z = Math.max(1, p.zoom);
        const tx = p.offset_x * (z - 1) * 100 / z;
        const ty = p.offset_y * (z - 1) * 100 / z;
        stage.style.transition = `transform ${p.animation_ms}ms cubic-bezier(${p.easing.join(",")})`;
        stage.style.transform = `scale(${z}) translate(${tx}%, ${ty}%)`;
      });

      window.wallpaperRegisterAudioListener((u8) => {
        const bass = u8[4] / 255;
        stage.style.transform = `scale(${1 + bass * 0.05})`;
      });
    </script>
  </body>
</html>
```

Fix the typo `motion` → `motion` should be `motion` - I made a typo "motion" instead of "main" or "motion" - should be `<main id="stage">`. Let me fix that in the file.

Fixing a typo in the template.


StrReplace