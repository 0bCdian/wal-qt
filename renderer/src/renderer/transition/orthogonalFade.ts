import type { LoadRequest } from "../types";
import { resolveTransitionIntent, type TransitionIntent } from "./intent";

const MIN_ORTH_MS = 1;

export type OrthogonalFadeIntent = {
  intent: TransitionIntent;
  /** True when wipe/grow/etc. was mapped to fade for cross-kind paths. */
  coerced: boolean;
};

/**
 * Resolves a fade-only intent for cross-kind wallpaper transitions (image↔video).
 * Web wallpapers reload the renderer shell in wal-qt — no in-page crossfade (see main.ts).
 */
export function resolveOrthogonalFadeIntent(req: LoadRequest): OrthogonalFadeIntent | null {
  if (req.transition === "none") return null;
  const full = resolveTransitionIntent(req, MIN_ORTH_MS);
  if (full.effect === "fade") {
    return { intent: full, coerced: false };
  }
  return { intent: { ...full, effect: "fade" }, coerced: true };
}
