# wal-qt

Qt6 / WebEngine Wayland wallpaper host driven by an HTTP control socket. Ships
two binaries: `wal-qt-host` (places a `QWebEngineView` per output on the
layer-shell background) and `wal-qt` (CLI that controls it). Part of the
[waypaper-engine](https://github.com/0bCdian/waypaper-engine) workspace.

## Dependencies

### Runtime
- Wayland compositor implementing `zwlr_layer_shell_v1` (Hyprland, Sway, river,
  Niri, Wayfire, …). **Does not run on GNOME.**
- Qt 6 (Core, Gui, Widgets, WebEngineWidgets, WebChannel, Network)
- LayerShellQt
- PipeWire (`libpipewire-0.3`)
- hicolor-icon-theme

### Build
- CMake ≥ 3.16, C++17 compiler, pkg-config
- Node.js 20+ and pnpm 11 (Corepack works)
- Go ≥ 1.26 (for the CLI)

Arch one-liner:
```sh
sudo pacman -S --needed qt6-webengine qt6-webchannel layer-shell-qt pipewire \
  hicolor-icon-theme cmake pkgconf nodejs pnpm go
```

## Install

### AUR (recommended)
```sh
paru -S wal-qt        # stable
paru -S wal-qt-git    # rolling
```

### From source
```sh
git clone https://github.com/0bCdian/wal-qt
cd wal-qt
make build
sudo make install-system   # installs to /usr/local
# — or —
make install               # installs to ~/.local (ensure ~/.local/bin is on PATH)
```

Both binaries land in the same directory:
- `wal-qt-host` — the Qt host process (renders wallpapers on every output).
- `wal-qt` — the CLI that talks to it over the Unix socket.

## Usage

`wal-qt-host` is spawned automatically by `waypaper-engine`'s daemon — most
users won't run it by hand. The `wal-qt` CLI is for inspection and manual
control:

```sh
wal-qt health                 # is the host alive?
wal-qt status                 # current wallpaper state (JSON)
wal-qt query                  # monitors and their wallpapers, table view
wal-qt load manifest.json     # set wallpapers from a manifest
wal-qt load manifest.json --wait   # block until the wallpaper is applied
wal-qt kill                   # SIGTERM the host
wal-qt --help                 # all subcommands and flags
```

Default socket: `$XDG_RUNTIME_DIR/wal-qt.sock`. Override with `--socket`.

## HTTP control API

Documented in [`openapi/wal-qt.yaml`](openapi/wal-qt.yaml). The CLI and the
`waypaper-engine` daemon are both generated from this spec — edit the spec
first, then regenerate with `make openapi`.

## Build matrix
- Built and tested on Arch Linux + Hyprland (multi-monitor, `v0.1.0-alpha`).

## License
GPL-3.0-or-later. See [LICENSE](LICENSE).
