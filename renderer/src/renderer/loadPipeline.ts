import { logger } from "./logger";
import { hasWallpaperTransitionHandoff, normalizeMediaTarget } from "./image";
import { state } from "./state";
import type { LoadRequest, TransitionExecutionMeta } from "./types";

export type LoadAck = { ok: boolean; error?: string; meta?: TransitionExecutionMeta };

function buildNoopAckMeta(): TransitionExecutionMeta {
  return {
    engine: "none",
    effect: "none",
    duration_actual_ms: 0,
  };
}

function canonicalActiveTarget(url: string | null): string | null {
  if (url == null || url === "") {
    return null;
  }
  return normalizeMediaTarget(url);
}

export function resolveNoopAck(req: LoadRequest): TransitionExecutionMeta | null {
  if (hasWallpaperTransitionHandoff()) {
    return null;
  }
  const normalizedTarget = normalizeMediaTarget(req.target);
  const activeCanon = canonicalActiveTarget(state.activeTarget);
  const sameAudioState =
    req.kind !== "video" || state.activeAudioEnabled === Boolean(req.audio_enabled);
  const sameImageDisplay =
    req.kind !== "image" ||
    (state.activeImageFitMode === (req.image_fit_mode ?? "cover") &&
      state.activeImageRendering === (req.image_rendering ?? "auto"));
  if (
    state.activeKind === req.kind &&
    activeCanon === normalizedTarget &&
    sameAudioState &&
    sameImageDisplay
  ) {
    return buildNoopAckMeta();
  }
  return null;
}

export function emitTransitionAck(req: LoadRequest, ack: LoadAck, handlerElapsedMs: number): void {
  try {
    const payload = {
      request_id: req.request_id,
      monitor_id: req.monitor_id,
      ok: ack.ok,
      handler_elapsed_ms: handlerElapsedMs,
      ...(ack.meta
        ? {
            engine: ack.meta.engine,
            effect: ack.meta.effect,
            duration_actual_ms: ack.meta.duration_actual_ms,
            ...(ack.meta.fallback_reason ? { fallback_reason: ack.meta.fallback_reason } : {}),
          }
        : {}),
      ...(ack.ok ? {} : { error: ack.error }),
    };
    (globalThis as typeof window)._walBridge?.transitionResult(JSON.stringify(payload));
  } catch (emitError) {
    logger.errorFrom("failed to emit transition-result", emitError, {
      requestId: req.request_id,
      monitorId: req.monitor_id,
    });
  }
}
