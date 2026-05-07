# wal-qt

`wal-qt` is a Wayland wallpaper host process written in C++/Qt6 that places one full-screen `QWebEngineView` per physical output on the Wayland compositor's background layer via `zwlr_layer_shell_v1` (using LayerShellQt), and serves the `wayland-utauri` HTTP control API over a Unix domain socket so the waypaper-engine Go daemon can use it as a drop-in backend replacement without any Go-side changes.

The authoritative spec lives in the `wal-qt.md` document maintained alongside this repo in the waypaper workspace. The bootstrap implementation plan is at `docs/superpowers/plans/2026-05-07-wal-qt-bootstrap.md`.
