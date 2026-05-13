# wal-qt Domain Language

This file pins the names of the concepts wal-qt's modules are built around. When code or docs refer to one of these things, use **exactly** these names. New concepts get added here before they show up in code.

---

## Process and ownership

### Wallpaper Host
The wal-qt process as a whole, and the `WallpaperHost` class at its centre. Owns the per-monitor views, drives audio capture, and exposes the verbs the API layer calls. Long-lived; one per process. Terminology lifted from the README ("wal-qt is a Wayland wallpaper host process").

### Monitor View
The per-screen triplet — `WindowFrame` + `SourcePresenter` + `WallpaperBridge` — that the Wallpaper Host owns one of for each connected output. Created on monitor hot-plug, destroyed on disconnect.

### Window Frame
The Qt/Wayland surface part of a Monitor View: a `QWebEngineView` anchored to a monitor's background layer via `zwlr_layer_shell_v1` (LayerShellQt). Knows about geometry, focus, and the layer-shell namespace. **Knows nothing about what's being displayed.**

### Source Presenter
The component that knows how to put a Source onto a Window Frame: dispatching by content type (image / web package / video), navigating the view, and driving the Bridge transition handshake. Lives one per Monitor View.

### Bridge / Transition
The Bridge is the `QWebChannel`-based RPC handle between C++ and the renderer's JS. A Transition is the handshake on load: C++ asks the renderer to swap content, renderer acknowledges (or fails) via the Bridge. The Source Presenter is responsible for driving Transitions; `PendingLoad` aggregates them across monitors.

---

## API-layer concepts

### Source
**What** to display: a filesystem path to an image, a web-package directory, or a video. Was previously called `target` (singular) in request bodies and stored as `currentTarget_` on windows. **Do not call this a "target" any more.**

### Web Package
A directory containing a manifest plus assets (HTML/JS/CSS), served to the Window Frame's web view via the `waypaperhtml://` custom scheme. One subtype of Source. Resolved by `target_resolver`.

### Monitor Selector
**Which** monitor(s) a verb applies to. A small tagged value with three cases: `All`, `ByNames(QStringList)`, or `ByCurrentSource(QString)`. Was previously expressed as a mixture of `req["targets"]` (array) and `req["source_target"]` (string filter) — both fold into one Monitor Selector now.

`resolve(MonitorSelector, const QList<MonitorView*>&) → QList<MonitorView*>` is a pure function and lives next to the type.

### Verb / Load Args / Load Result
A **Verb** is one method on the Wallpaper Host (`load`, `setParallax`, `getStatus`, `setNetwork`, etc.) — the unit the API layer calls. Each Verb takes a typed args struct (`LoadArgs`, `ParallaxArgs`, …) and a domain-typed callback. Verbs do not see HTTP types.

`LoadResult` (and friends) is a tagged result with a status code (`Ok`, `Timeout`, `RejectedSource`, `RejectedSelector`, …) plus optional per-monitor detail. The API layer maps statuses to HTTP codes in one place (`responses.cpp`).

### Pending Load
The multi-monitor ack aggregator: collects N transition acks (or a timeout), then fires the Verb's `done` callback once. Used by any Verb that fans out across monitors. Generic enough to be reused beyond `load` — name retained for now.

---

## Cross-cutting

### wal-qt Installation
`scripts/install-wal-qt.sh` installs `~/.local/bin/wal-qt → build/wal-qt` so the waypaper-engine Go daemon spawns it directly. wal-qt's HTTP control surface is the authoritative API — wire compatibility with prior `wayland-utauri` builds is no longer maintained.

---

## Deprecated terms — do not reintroduce

| Old name | Why it's bad | Use instead |
|---|---|---|
| `target` (singular, in API requests) | Conflated with monitor selection | **Source** |
| `targets` (array, in API requests) | Vague — selecting what? | **Monitor Selector** (`ByNames` case) |
| `source_target` | Compound noun built on the same overloaded "target" | **Monitor Selector** (`ByCurrentSource` case) |
| `currentTarget_` (on Window Frame / window) | Same overload | **`currentSource_`** (and lives on `SourcePresenter`, not the frame) |
| `WallpaperController` | Doesn't "control" anything once HTTP is gone | **`WallpaperHost`** |
