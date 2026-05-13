#!/usr/bin/env bash
# Install the wal-qt binary onto PATH so waypaper-engine's daemon can spawn it.
set -euo pipefail

SRC="${WAL_QT_BINARY:-${1:-build/wal-qt}}"
DEST_DIR="${WAL_QT_INSTALL_BIN_DIR:-$HOME/.local/bin}"
LINK_PATH="${DEST_DIR}/wal-qt"

if [[ ! -x "$SRC" ]]; then
  echo "wal-qt binary not found or not executable: $SRC" >&2
  echo "Build it with: make build" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
ln -sfn "$(realpath "$SRC")" "$LINK_PATH"
echo "Installed: $LINK_PATH -> $(realpath "$SRC")"
echo "Ensure $DEST_DIR is on \$PATH."
echo "Stop any existing wal-qt host before starting the engine; remove stale"
echo "  \$XDG_RUNTIME_DIR/wal-qt.sock and \$XDG_RUNTIME_DIR/wal-qt.lock if needed."
