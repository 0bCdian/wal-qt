import { installInteractionGuards } from "./renderer/guards";
import { emitTransitionAck, resolveNoopAck, type LoadAck } from "./renderer/loadPipeline";
import {
  applyHostImagePresentation,
  normalizeMediaTarget,
  releaseWallpaperWebGlForIdle,
  runTransition,
  type LoadStaleCheck,
} from "./renderer/image";
import { logger } from "./renderer/logger";
import { applyParallax, applyParallaxBaselineForLoad } from "./renderer/parallax";
import { activateImageMode, commitActiveMediaState, refreshDomRefs, state } from "./renderer/state";
import type {
  ImageFitMode,
  ImageRenderingMode,
  LoadRequest,
  ParallaxPayload,
  TransitionExecutionMeta,
} from "./renderer/types";
import { resetVideoRuntime, runVideoLoad } from "./renderer/video";

let activeLoadRequest: LoadRequest | null = null;
let queuedLoadRequest: LoadRequest | null = null;
let processingLoad = false;
/** Bumped on each accepted loadWallpaper signal so in-flight work can abort when superseded. */
let loadGeneration = 0;
let deferredParallaxPayload: ParallaxPayload | null = null;
let deferredParallaxDropCount = 0;
/** Coalesce rapid loadWallpaper signals before starting work while idle (macrotask batches IPC). */
let loadQueueFlushScheduled = false;

function resolveMonitorId(): number {
  const fromQuery = Number.parseInt(
    new URLSearchParams(window.location.search).get("monitor") ?? "",
    10,
  );
  if (Number.isFinite(fromQuery) && fromQuery >= 0) {
    return fromQuery;
  }
  return 0;
}

function resolveBaseColor(): string {
  const fromQuery = new URLSearchParams(window.location.search).get("baseColor");
  const fromStorage = window.localStorage.getItem("waypaper.baseColor");
  const candidate = fromQuery ?? fromStorage ?? "#000000";
  if (typeof CSS !== "undefined" && CSS.supports("color", candidate)) {
    return candidate;
  }
  return "#000000";
}

function applyBaseColor(): void {
  const color = resolveBaseColor();
  document.documentElement.style.setProperty("--wallpaper-base-color", color);
}

async function runImageTransition(
  req: LoadRequest,
  checkNotStale?: LoadStaleCheck,
): Promise<TransitionExecutionMeta> {
  const result = await runTransition(req, checkNotStale);
  commitActiveMediaState("image", result.target, false, {
    fitMode: req.image_fit_mode ?? "cover",
    rendering: req.image_rendering ?? "auto",
  });
  return result.meta;
}

async function applyLoadRequest(
  req: LoadRequest,
  checkNotStale?: LoadStaleCheck,
): Promise<TransitionExecutionMeta> {
  const nonImageFallbackReason =
    req.transition === "none" ? undefined : "non_image_transition_bypassed";
  if (req.kind === "web") {
    resetVideoRuntime();
    releaseWallpaperWebGlForIdle();
    activateImageMode();
    commitActiveMediaState("web", normalizeMediaTarget(req.target), false);
    return {
      engine: "none",
      effect: "none",
      duration_actual_ms: 0,
      ...(nonImageFallbackReason ? { fallback_reason: nonImageFallbackReason } : {}),
    };
  }
  if (req.kind === "video") {
    return runVideoLoad(req, checkNotStale);
  }
  resetVideoRuntime();
  activateImageMode();
  const fromWebOrVideo = state.activeKind === "video" || state.activeKind === "web";
  const imageReq: LoadRequest =
    fromWebOrVideo && req.kind === "image"
      ? {
          ...req,
          transition: "none",
          duration_ms: 0,
          transition_params: undefined,
        }
      : req;
  return runImageTransition(imageReq, checkNotStale);
}

async function executeLoadRequest(req: LoadRequest) {
  if (!req) return;
  if (req.monitor_id !== state.monitorId) {
    return;
  }

  const myGeneration = loadGeneration;
  const checkNotStale: LoadStaleCheck | undefined = () => {
    if (loadGeneration !== myGeneration) {
      throw new DOMException("Superseded by newer load", "AbortError");
    }
  };

  activeLoadRequest = req;
  state.busy = true;
  state.transitionInFlight = true;
  const startedAt = performance.now();

  let ack: LoadAck = { ok: true };
  try {
    const noopMeta = resolveNoopAck(req);
    if (noopMeta) {
      ack.meta = noopMeta;
      return;
    }

    if (req.kind !== "web" && req.parallax?.enabled) {
      applyParallaxBaselineForLoad(req.parallax);
    }

    ack.meta = await applyLoadRequest(req, checkNotStale);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      ack = { ok: false, error: "cancelled by newer request (latest-wins)" };
    } else {
      const message = error instanceof Error ? error.message : "unknown transition error";
      ack = { ok: false, error: message };
    }
  } finally {
    const handlerElapsedMs = Math.round(performance.now() - startedAt);
    emitTransitionAck(req, ack, handlerElapsedMs);
    if (activeLoadRequest?.request_id === req.request_id) {
      activeLoadRequest = null;
    }
    state.transitionInFlight = false;
    state.busy = false;
    if (deferredParallaxPayload) {
      if (deferredParallaxDropCount > 0) {
        logger.debug("deferred parallax payloads while transition in-flight", {
          dropped: deferredParallaxDropCount,
        });
      }
      const payload = deferredParallaxPayload;
      deferredParallaxPayload = null;
      deferredParallaxDropCount = 0;
      applyParallax(payload);
    }
  }
}

function scheduleProcessLoadQueue(): void {
  if (loadQueueFlushScheduled) {
    return;
  }
  loadQueueFlushScheduled = true;
  window.setTimeout(() => {
    loadQueueFlushScheduled = false;
    void processLoadQueue();
  }, 0);
}

async function processLoadQueue(): Promise<void> {
  if (processingLoad) {
    return;
  }
  processingLoad = true;
  try {
    while (queuedLoadRequest) {
      const next = queuedLoadRequest;
      queuedLoadRequest = null;
      await executeLoadRequest(next);
    }
  } finally {
    processingLoad = false;
  }
}

async function enqueueLoadRequest(req: LoadRequest): Promise<void> {
  if (!req || req.monitor_id !== state.monitorId) {
    return;
  }
  loadGeneration += 1;
  const superseded = queuedLoadRequest;
  queuedLoadRequest = req;
  if (superseded && superseded.request_id !== req.request_id) {
    emitTransitionAck(
      superseded,
      { ok: false, error: "cancelled by newer request (latest-wins)" },
      0,
    );
  }
  if (!processingLoad) {
    scheduleProcessLoadQueue();
  }
}

function handleLoad(req: LoadRequest): void {
  void enqueueLoadRequest(req);
}

function handleParallax(payload: ParallaxPayload): void {
  if (payload.monitor_id !== state.monitorId) {
    return;
  }
  if (state.transitionInFlight) {
    if (deferredParallaxPayload) {
      deferredParallaxDropCount += 1;
    }
    deferredParallaxPayload = payload;
    return;
  }
  applyParallax(payload);
}

function handleImagePresentation(payload: {
  monitor_id: number;
  image_fit_mode: ImageFitMode;
  image_rendering: ImageRenderingMode;
}): void {
  if (payload.monitor_id !== state.monitorId) {
    return;
  }
  applyHostImagePresentation(payload.image_fit_mode, payload.image_rendering);
}

// no-op until renderer pipeline lands the move feature
function handleParallaxMove(_payload: unknown): void {}

// no-op until playback policy is wired through the load pipeline
function handlePlaybackPolicy(_payload: unknown): void {}

function handleConfigPush(payload: unknown): void {
  const typed = payload as {
    monitor_id?: number;
    image_fit_mode?: ImageFitMode;
    image_rendering?: ImageRenderingMode;
    properties?: Record<string, unknown>;
  };
  if (typed.monitor_id !== undefined && typed.image_fit_mode && typed.image_rendering) {
    handleImagePresentation({
      monitor_id: typed.monitor_id,
      image_fit_mode: typed.image_fit_mode,
      image_rendering: typed.image_rendering,
    });
  }
  // Dispatch WE property listener for wallpapers that use wallpaperPropertyListener.applyUserProperties.
  const props = (typed as Record<string, unknown>).values ?? typed.properties;
  if (props) {
    const listener = (
      window as unknown as {
        wallpaperPropertyListener?: { applyUserProperties?: (p: unknown) => void };
      }
    ).wallpaperPropertyListener;
    if (typeof listener?.applyUserProperties === "function") {
      listener.applyUserProperties(props);
    }
  }
}

// no-op until capability negotiation lands
function handleCapsPush(_payload: unknown): void {}

function connectBridge(): void {
  const b = window._walBridge!;
  b.loadWallpaper.connect((j: string) => handleLoad(JSON.parse(j) as LoadRequest));
  b.setParallax.connect((j: string) => handleParallax(JSON.parse(j) as ParallaxPayload));
  b.setParallaxMove.connect((j: string) => handleParallaxMove(JSON.parse(j)));
  b.setPlaybackPolicy.connect((j: string) => handlePlaybackPolicy(JSON.parse(j)));
  b.pushWallpaperConfig.connect((j: string) => handleConfigPush(JSON.parse(j)));
  b.pushCapabilities.connect((j: string) => handleCapsPush(JSON.parse(j)));
  b.imagePresentation.connect((j: string) =>
    handleImagePresentation(JSON.parse(j) as Parameters<typeof handleImagePresentation>[0]),
  );
  // Tell the host all signal handlers are wired. The host queues image/video load
  // signals across renderer-shell navigations (web → image) and flushes them here.
  b.rendererReady?.();
}

document.addEventListener("walBridgeReady", () => {
  connectBridge();
});

// Fallback if bridge already ready before listener attaches
if (window._walBridgeReady) {
  document.dispatchEvent(new Event("walBridgeReady"));
}

// Deferred module: document is usually parsed when this runs; bind nodes before early bridge IPC.
if (document.readyState !== "loading") {
  refreshDomRefs();
}

document.addEventListener("DOMContentLoaded", () => {
  refreshDomRefs();
  applyBaseColor();
  state.monitorId = resolveMonitorId();
  installInteractionGuards();
  logger.info("renderer ready", { monitorId: state.monitorId });
});
