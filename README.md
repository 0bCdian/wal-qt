# wal-qt

`wal-qt` is a Wayland wallpaper host process written in C++/Qt6 that places one full-screen `QWebEngineView` per physical output on the Wayland compositor's background layer via `zwlr_layer_shell_v1` (using LayerShellQt), and serves the `wayland-utauri` HTTP control API over a Unix domain socket so the waypaper-engine Go daemon can use it as a drop-in backend replacement without any Go-side changes.

The authoritative spec lives in the `wal-qt.md` document maintained alongside this repo in the waypaper workspace. The bootstrap implementation plan is at `docs/superpowers/plans/2026-05-07-wal-qt-bootstrap.md`.

## Build

Convenience (runs dependency checks, `npm ci` + renderer build, then CMake):

```sh
make build
make test
```

Or manually:

```sh
cmake -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
ctest --test-dir build --output-on-failure
```

Install to `~/.local` (binary + `.desktop`): `make install`. System-wide: `sudo make install-system` (uses `PREFIX=/usr/local`). See `make help`.

System packages (Arch): `qt6-webengine`, `qt6-webchannel`, `layer-shell-qt`, `pipewire`, `cmake`, `pkgconf`, `nodejs`. The renderer SPA must be built before the binary so its `dist/` is embedded as a Qt resource (`make renderer` or `cd renderer && npm ci && npm run build`).

## Using as a waypaper-engine backend

`waypaper-engine`'s daemon spawns its wayland-utauri backend by exec'ing the literal binary name `wayland-utauri` from `PATH` (see `daemon/internal/backend/waylandutauri/waylandutauri.go`). To point the daemon at `wal-qt` without touching engine code, put a symlink on `PATH` that resolves to the built `wal-qt` binary.

After `cmake --build build`, run:

```sh
./scripts/install-waypaper-hijack.sh
```

That creates `~/.local/bin/wayland-utauri` as a symlink to `build/wal-qt`. Override the install directory with `WAL_QT_HIJACK_BIN_DIR`, or the source binary with the first argument or `WAL_QT_BINARY`.

Manual equivalent:

```sh
ln -sfn /absolute/path/to/wal-qt/build/wal-qt ~/.local/bin/wayland-utauri
```

The daemon will then spawn `wal-qt` automatically, poll `/health` over `$XDG_RUNTIME_DIR/wayland-utauri.sock`, and send wallpaper commands. Stop any other `wayland-utauri` host first; delete stale `$XDG_RUNTIME_DIR/wayland-utauri.sock` and `wayland-utauri.lock` if the engine cannot bind.

## Verified

- Hyprland 0.x on Arch Linux (HDMI-A-1 + DP-1, layer-shell namespace `wayland-utauri-monitor-N`, image load via `POST /wallpaper/load wait_for_completion=true`, status, malicious-target rejection). Tagged `v0.1.0-alpha`.
- End-to-end with `waypaper-engine`: use the hijack symlink above, ensure `~/.local/bin` is on `PATH`, select the wayland-utauri backend in settings, then run the engine UI as usual.
