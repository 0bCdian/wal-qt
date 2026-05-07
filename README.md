# wal-qt

`wal-qt` is a Wayland wallpaper host process written in C++/Qt6 that places one full-screen `QWebEngineView` per physical output on the Wayland compositor's background layer via `zwlr_layer_shell_v1` (using LayerShellQt), and serves the `wayland-utauri` HTTP control API over a Unix domain socket so the waypaper-engine Go daemon can use it as a drop-in backend replacement without any Go-side changes.

The authoritative spec lives in the `wal-qt.md` document maintained alongside this repo in the waypaper workspace. The bootstrap implementation plan is at `docs/superpowers/plans/2026-05-07-wal-qt-bootstrap.md`.

## Build

```sh
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
ctest --test-dir build --output-on-failure
```

System packages (Arch): `qt6-webengine`, `qt6-webchannel`, `layer-shell-qt`, `cmake`. The renderer SPA must be built before the binary so its `dist/` is embedded as a Qt resource: `cd renderer && npm install && npm run build`.

## Using as a waypaper-engine backend

`waypaper-engine`'s daemon spawns its wayland-utauri backend by exec'ing the literal binary name `wayland-utauri` from `PATH` (see `daemon/internal/backend/waylandutauri/waylandutauri.go`). To point the daemon at `wal-qt` without touching engine code, drop a symlink on `PATH`:

```sh
ln -s /home/you/dev/waypaper/wal-qt/build/wal-qt ~/.local/bin/wayland-utauri
```

The daemon will then spawn `wal-qt` automatically, poll `/health` over `$XDG_RUNTIME_DIR/wayland-utauri.sock`, and start sending wallpaper commands.

## Verified

- Hyprland 0.x on Arch Linux (HDMI-A-1 + DP-1, layer-shell namespace `wayland-utauri-monitor-N`, image load via `POST /wallpaper/load wait_for_completion=true`, status, malicious-target rejection). Tagged `v0.1.0-alpha`.
- End-to-end with the `waypaper-engine` daemon: pending — requires the symlink above and an Electron UI session.
