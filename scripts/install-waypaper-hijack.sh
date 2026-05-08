#!/usr/bin/env bash
# Install wal-qt on PATH as `wayland-utauri` so waypaper-engine's daemon spawns it unchanged.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
BIN_TARGET="${1:-${WAL_QT_BINARY:-${REPO_ROOT}/build/wal-qt}}"
# ~/.local/bin matches waypaper-engine docs and common shells; override with WAL_QT_HIJACK_BIN_DIR.
DEST_DIR="${WAL_QT_HIJACK_BIN_DIR:-${HOME}/.local/bin}"
LINK_PATH="${DEST_DIR}/wayland-utauri"

if [[ ! -x "${BIN_TARGET}" ]]; then
  echo "wal-qt binary not found or not executable: ${BIN_TARGET}" >&2
  echo "Build first: cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j" >&2
  exit 1
fi

mkdir -p "${DEST_DIR}"
ln -sfn "$(realpath "${BIN_TARGET}")" "${LINK_PATH}"

echo "Symlink: ${LINK_PATH} -> $(readlink -f "${LINK_PATH}")"
echo ""
echo "Ensure ${DEST_DIR} is on PATH (e.g. export PATH=\"${DEST_DIR}:\$PATH\" in your shell profile)."
echo "Stop any existing wayland-utauri/wal-qt host before starting the engine; remove stale"
echo "  \$XDG_RUNTIME_DIR/wayland-utauri.sock and \$XDG_RUNTIME_DIR/wayland-utauri.lock if needed."
