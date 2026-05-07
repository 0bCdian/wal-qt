#!/usr/bin/env bash
set -euo pipefail
DIST="$1"; OUT="$2"
{
  echo '<RCC><qresource prefix="/renderer">'
  (cd "$DIST" && find . -type f | sed 's|^\./||' | sort | while read -r f; do
      printf '  <file alias="%s">%s/%s</file>\n' "$f" "$DIST" "$f"
  done)
  echo '</qresource></RCC>'
} > "$OUT"
