#!/usr/bin/env bash
# Exercise every HTTP path the waypaper-engine daemon uses on wal-qt
# (see daemon/internal/backend/waylandutauri/client.go), against a live wal-qt.
set -euo pipefail

WALQT_BIN="${WALQT_BIN:-$(cd "$(dirname "$0")/.." && pwd)/build/wal-qt}"
RUNDIR="${XDG_RUNTIME_DIR:-/tmp}/walqt-api-verify-$$"
mkdir -p "$RUNDIR"
export XDG_RUNTIME_DIR="$RUNDIR"
export QT_QPA_PLATFORM="${QT_QPA_PLATFORM:-offscreen}"

if [[ ! -x "$WALQT_BIN" ]]; then
  echo "wal-qt binary missing: $WALQT_BIN" >&2
  exit 1
fi

"$WALQT_BIN" &
PID=$!
cleanup() { kill "$PID" 2>/dev/null || true; rm -rf "$RUNDIR"; }
trap cleanup EXIT

for _ in $(seq 1 80); do
  [[ -S "$RUNDIR/wal-qt.sock" ]] && break
  sleep 0.05
done
[[ -S "$RUNDIR/wal-qt.sock" ]] || { echo "socket did not appear" >&2; exit 1; }

SOCK="$RUNDIR/wal-qt.sock"
U="http://localhost"

curl_api() {
  curl -sS --unix-socket "$SOCK" -H 'Content-Type: application/json' "$@"
}

echo "== GET /health"
curl_api "$U/health" | jq -e '.ok == true and .service == "wal-qt" and .api_version == "0"'

echo "== GET /wallpaper/status"
STATUS_JSON=$(curl_api "$U/wallpaper/status")
echo "$STATUS_JSON" | jq -e '.ok == true and .status.topology != null and .status.monitors != null'

OUT_NAME=$(echo "$STATUS_JSON" | jq -r '.status.topology[0].name // empty')

echo "== POST /settings/network"
curl_api -X POST "$U/settings/network" -d '{"allow_network_wallpapers":true}' | jq -e '.ok == true'

echo "== POST /settings/image-presentation"
curl_api -X POST "$U/settings/image-presentation" \
  -d '{"image_fit_mode":"cover","image_rendering":"auto"}' | jq -e '.ok == true'

echo "== POST /wallpaper/parallax"
curl_api -X POST "$U/wallpaper/parallax" \
  -d '{"enabled":false,"zoom":1.2,"step_percent":5,"animation_ms":600,"easing":[0.215,0.610,0.355,1.000],"reset_ms":400}' \
  | jq -e '.ok == true'

if [[ -n "$OUT_NAME" ]]; then
  echo "== POST /wallpaper/parallax-move (output=$OUT_NAME)"
  curl_api -X POST "$U/wallpaper/parallax-move" \
    -d "{\"name\":\"$OUT_NAME\",\"direction\":\"right\"}" | jq -e '.ok == true'
else
  echo "== POST /wallpaper/parallax-move (skipped — no outputs in offscreen)"
fi

echo "== POST /wallpaper/wallpaper-config"
curl_api -X POST "$U/wallpaper/wallpaper-config" \
  -d '{"source_target":"/noop","values":{}}' | jq -e '.ok == true'

echo "== POST /wallpaper/web-capabilities"
curl_api -X POST "$U/wallpaper/web-capabilities" \
  -d '{"source_target":"/noop","capabilities":{}}' | jq -e '.ok == true'

if [[ -n "$OUT_NAME" ]]; then
  echo "== POST /wallpaper/load (async)"
  curl_api -X POST "$U/wallpaper/load" \
    -d "{\"kind\":\"image\",\"target\":\"/nonexistent-test.png\",\"wait_for_completion\":false,\"targets\":[{\"name\":\"$OUT_NAME\",\"target\":\"/nonexistent-test.png\",\"kind\":\"image\"}]}" \
    | jq -e '.ok == true and .accepted == true'
else
  echo "== POST /wallpaper/load (skipped — no outputs)"
fi

echo "All waypaper-engine control-plane probes passed."
