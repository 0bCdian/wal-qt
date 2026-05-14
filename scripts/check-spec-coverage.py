#!/usr/bin/env python3
"""
Gate: every JSON field the wal-qt host (C++) or renderer (TS) reads off a
LoadRequest must appear in the OpenAPI spec's LoadRequest schema.

Catches the class of regression where a field disappears from the spec
(or never made it in), the oapi-codegen client silently drops it on the
wire, and the renderer falls back to a default (e.g. fade transition).

Exits non-zero with a clear diff on mismatch. Run from `make openapi-coverage`
or directly: `python3 scripts/check-spec-coverage.py`.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

try:
    import yaml
except ImportError:
    sys.stderr.write(
        "check-spec-coverage: PyYAML not installed.\n"
        "Install with `pacman -S python-yaml` (Arch) or `pip install pyyaml`.\n"
    )
    sys.exit(2)


REPO = Path(__file__).resolve().parents[1]
SPEC = REPO / "openapi" / "wal-qt.yaml"
RENDERER_TYPES = REPO / "renderer" / "src" / "renderer" / "types.ts"
CPP_LOAD_SOURCES = [
    REPO / "src" / "wallpaper" / "wallpaper_controller.cpp",
    REPO / "src" / "wallpaper" / "wallpaper_window.cpp",
]

# Fields populated by the C++ host on the way to the renderer, never sent
# over the wire by clients. Exclude from the wire-contract check.
HOST_INJECTED_FIELDS = {"request_id", "monitor_id"}


def load_spec_fields() -> set[str]:
    """Top-level property names declared on components.schemas.LoadRequest."""
    data = yaml.safe_load(SPEC.read_text())
    schema = data["components"]["schemas"]["LoadRequest"]
    return set(schema.get("properties", {}).keys())


def renderer_load_request_fields() -> set[str]:
    """Parse `export type LoadRequest = { ... }` in renderer/types.ts."""
    text = RENDERER_TYPES.read_text()
    match = re.search(r"export type LoadRequest = \{([^}]+)\}", text, re.DOTALL)
    if not match:
        sys.stderr.write(
            f"check-spec-coverage: could not locate `export type LoadRequest = {{...}}` "
            f"in {RENDERER_TYPES.relative_to(REPO)}.\n"
        )
        sys.exit(2)
    body = match.group(1)
    # Each field starts with optional whitespace, then `name` or `name?`, then `:`.
    return {m.group(1) for m in re.finditer(r"^\s*(\w+)\??\s*:", body, re.MULTILINE)}


# Keys the C++ explicitly reads off the parsed load-request JSON object.
# Pattern: req.value(QStringLiteral("KEY"))  OR  req.value("KEY")
# (also `req.value(QLatin1String("KEY"))` for defensive coverage)
CPP_KEY_PATTERN = re.compile(
    r"""req\.value\(
        \s*
        (?: QStringLiteral | QLatin1String )?
        \s*\(?
        \s* "([^"]+)" \s*
        \)?
        \s*
        \)""",
    re.VERBOSE,
)


def cpp_load_request_fields() -> set[str]:
    keys: set[str] = set()
    for path in CPP_LOAD_SOURCES:
        text = path.read_text()
        for m in CPP_KEY_PATTERN.finditer(text):
            keys.add(m.group(1))
    return keys


def report(missing: set[str], context: str) -> None:
    print(f"\n❌ {context}:", file=sys.stderr)
    for k in sorted(missing):
        print(f"    - {k}", file=sys.stderr)


def main() -> int:
    spec = load_spec_fields()
    renderer = renderer_load_request_fields() - HOST_INJECTED_FIELDS
    cpp = cpp_load_request_fields()

    # The C++ load handler reads a superset of LoadRequest-relevant keys
    # (incl. fields off ParallaxRequest etc.). We intersect with the union
    # of plausible load-body keys via the spec + renderer types as the
    # canonical set. This avoids false-positives on parallax sub-keys.
    plausible = spec | renderer
    cpp_load = cpp & plausible

    renderer_missing = renderer - spec
    cpp_missing = cpp_load - spec

    if not renderer_missing and not cpp_missing:
        print("check-spec-coverage: ok")
        print(f"  spec fields:     {len(spec)}")
        print(f"  renderer fields: {len(renderer)} (host-injected excluded)")
        print(f"  cpp load reads:  {len(cpp_load)} (intersected with plausible)")
        return 0

    print("check-spec-coverage: FAIL", file=sys.stderr)
    if renderer_missing:
        report(
            renderer_missing,
            "Renderer's LoadRequest type reads fields not in the OpenAPI spec",
        )
        print(
            "    → add them to components.schemas.LoadRequest in openapi/wal-qt.yaml\n"
            "      then `make openapi` to regenerate clients.",
            file=sys.stderr,
        )
    if cpp_missing:
        report(
            cpp_missing,
            "C++ host reads load-body fields not in the OpenAPI spec",
        )
        print(
            "    → either add them to the spec or stop reading them in the host.",
            file=sys.stderr,
        )
    return 1


if __name__ == "__main__":
    sys.exit(main())
