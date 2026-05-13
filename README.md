# wal-qt

`wal-qt` is a Wayland wallpaper host process written in C++/Qt6 that places one full-screen `QWebEngineView` per physical output on the Wayland compositor's background layer via `zwlr_layer_shell_v1` (using LayerShellQt), and serves an HTTP control API over a Unix domain socket so the waypaper-engine Go daemon can drive it.

The authoritative spec lives in the `wal-qt.md` document maintained alongside this repo in the waypaper workspace. The bootstrap implementation plan is at `docs/superpowers/plans/2026-05-07-wal-qt-bootstrap.md`.

## Build

Convenience (runs dependency checks, `pnpm install --frozen-lockfile` in `renderer/` + renderer build, then CMake):

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

System packages (Arch): `qt6-webengine`, `qt6-webchannel`, `layer-shell-qt`, `pipewire`, `cmake`, `pkgconf`, `nodejs`. Install **`pnpm` 11** (or enable Corepack so `renderer/package.json`’s `"packageManager": "pnpm@11.1.1"` is honored). The renderer SPA must be built before the binary so its `dist/` is embedded as a Qt resource (`make renderer` or `cd renderer && pnpm install --frozen-lockfile && pnpm run build`).

## Using with waypaper-engine

`waypaper-engine`'s daemon spawns `wal-qt` directly by name from `PATH` (see `daemon/internal/backend/walqt/walqt.go`).

After `cmake --build build`, run:

```sh
./scripts/install-wal-qt.sh
```

That installs `~/.local/bin/wal-qt` as a symlink to `build/wal-qt`. Override the install directory with `WAL_QT_INSTALL_BIN_DIR`, or the source binary with the first argument or `WAL_QT_BINARY`.

Manual equivalent:

```sh
ln -sfn /absolute/path/to/wal-qt/build/wal-qt ~/.local/bin/wal-qt
```

The daemon will then spawn `wal-qt` automatically, poll `/health` over `$XDG_RUNTIME_DIR/wal-qt.sock`, and send wallpaper commands. Stop any other `wal-qt` host first; delete stale `$XDG_RUNTIME_DIR/wal-qt.sock` and `wal-qt.lock` if the engine cannot bind.

## Verified

- Hyprland 0.x on Arch Linux (HDMI-A-1 + DP-1, layer-shell namespace `wal-qt-monitor-N`, image load via `POST /wallpaper/load wait_for_completion=true`, status, malicious-target rejection). Tagged `v0.1.0-alpha`.
- End-to-end with `waypaper-engine`: use the symlink above, ensure `~/.local/bin` is on `PATH`, select the wal-qt backend in settings, then run the engine UI as usual.
