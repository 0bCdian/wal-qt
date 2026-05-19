import { installInteractionGuards } from "./renderer/guards";
import {
  applyHostImagePresentation,
  normalizeMediaTarget,
  releaseWallpaperWebGlForIdle,
  runImageTransitionFromVideo,
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
} from "./renderer/types";
import { resetVideoRuntime, runVideoLoad } from "./renderer/video";

/**
 * Latest-wins generation counter. Bumped on every accepted loadWallpaper signal; the
 * in-flight transition checks it at every async boundary and bails when stale.
 * No queue, no completion-ack — the daemon already responded 202 Accepted to the
 * caller before we even see the request.
 */
let generation = 0;

/**
 * Tail of the promise chain. Each handleLoad awaits this before mutating shared DOM /
 * WebGL state, so a superseded run finishes its async teardown (handoff bitmap stash,
 * GSAP kill, canvas hide) before the new run touches the same nodes. Latest-wins is
 * preserved: requests arriving while we're waiting on this chain bump `generation`,
 * and any intermediate runs see a stale gen after the await and return immediately.
 *
 * This is not the old queue — it's a serialization barrier. Abort happens inside one
 * rAF (~16ms) so the user-visible delay is invisible; the new request's image decode
 * already overlaps with that teardown.
 */
let inflight: Promise<void> = Promise.resolve();

let deferredParallaxPayload: ParallaxPayload | null = null;
let deferredParallaxDropCount = 0;

type DeferredPresentation = {
  image_fit_mode: ImageFitMode;
  image_rendering: ImageRenderingMode;
};
let deferredImagePresentation: DeferredPresentation | null = null;
let deferredImagePresentationDropCount = 0;

/** Wallhaven / web-package user properties (`wallpaperPropertyListener.applyUserProperties`). */
let deferredWallpaperUserPropsQueue: unknown | null = null;
let deferredWallpaperUserPropsDropCount = 0;

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

/** wallpaperengine.io-style custom property payloads for active web wallpapers. */
function applyWallpaperListenerUserProps(props: unknown): void {
  const listener = (
    window as unknown as {
      wallpaperPropertyListener?: { applyUserProperties?: (p: unknown) => void };
    }
  ).wallpaperPropertyListener;
  if (typeof listener?.applyUserProperties === "function") {
    listener.applyUserProperties(props);
  }
}

async function runImageTransition(req: LoadRequest, checkNotStale: LoadStaleCheck): Promise<void> {
  const presentation = {
    fitMode: req.image_fit_mode ?? "cover",
    rendering: req.image_rendering ?? "auto",
  };

  if (state.activeKind === "video") {
    if (req.transition === "none") {
      resetVideoRuntime();
      activateImageMode();
      const result = await runTransition(req, checkNotStale);
      commitActiveMediaState("image", result.target, false, presentation);
      return;
    }
    const result = await runImageTransitionFromVideo(req, checkNotStale);
    resetVideoRuntime();
    activateImageMode();
    commitActiveMediaState("image", result.target, false, presentation);
    return;
  }

  resetVideoRuntime();
  activateImageMode();
  const result = await runTransition(req, checkNotStale);
  commitActiveMediaState("image", result.target, false, presentation);
}

async function applyLoadRequest(req: LoadRequest, checkNotStale: LoadStaleCheck): Promise<void> {
  if (req.kind === "web") {
    resetVideoRuntime();
    releaseWallpaperWebGlForIdle();
    activateImageMode();
    commitActiveMediaState("web", normalizeMediaTarget(req.target), false);
    return;
  }
  if (req.kind === "video") {
    await runVideoLoad(req, checkNotStale);
    return;
  }
  await runImageTransition(req, checkNotStale);
}

function flushDeferred(): void {
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
  if (deferredImagePresentation) {
    if (deferredImagePresentationDropCount > 0) {
      logger.debug("deferred image presentation while transition in-flight", {
        dropped: deferredImagePresentationDropCount,
      });
    }
    const pres = deferredImagePresentation;
    deferredImagePresentation = null;
    deferredImagePresentationDropCount = 0;
    applyHostImagePresentation(pres.image_fit_mode, pres.image_rendering);
  }
  if (deferredWallpaperUserPropsQueue !== null) {
    if (deferredWallpaperUserPropsDropCount > 0) {
      logger.debug("deferred wallpaper user properties while transition in-flight", {
        dropped: deferredWallpaperUserPropsDropCount,
      });
    }
    const props = deferredWallpaperUserPropsQueue;
    deferredWallpaperUserPropsQueue = null;
    deferredWallpaperUserPropsDropCount = 0;
    applyWallpaperListenerUserProps(props);
  }
}

function handleLoad(req: LoadRequest): Promise<void> {
  if (!req || req.monitor_id !== state.monitorId) {
    return Promise.resolve();
  }

  const myGeneration = ++generation;
  const previous = inflight;

  const run = (async (): Promise<void> => {
    // Wait for any prior run to finish its abort/teardown before we touch shared DOM /
    // WebGL state. A superseded run bails on its next rAF tick (~16ms) but still has to
    // unwind handoff-bitmap stash + canvas hide; overlapping that with the new run was
    // the source of the stuck-mask / black-bar / z-snap artifacts.
    await previous.catch(() => {});

    // Intermediate request: an even newer load arrived while we were waiting. Drop ours.
    if (generation !== myGeneration) {
      return;
    }

    const checkNotStale: LoadStaleCheck = () => {
      if (generation !== myGeneration) {
        throw new DOMException("Superseded by newer load", "AbortError");
      }
    };

    state.busy = true;
    state.transitionInFlight = true;
    try {
      if (req.kind !== "web" && req.parallax?.enabled) {
        applyParallaxBaselineForLoad(req.parallax);
      }
      await applyLoadRequest(req, checkNotStale);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.warn("transition failed", { requestId: req.request_id, error: message });
    } finally {
      if (generation === myGeneration) {
        state.transitionInFlight = false;
        state.busy = false;
        flushDeferred();
      }
    }
  })();

  inflight = run;
  return run;
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

function applyFillColor(raw: string | undefined): void {
  if (!raw) return;
  const hex = raw.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
    return;
  }
  const color = `#${hex}`;
  document.documentElement.style.setProperty("--wallpaper-base-color", color);
  try {
    window.localStorage.setItem("waypaper.baseColor", color);
  } catch {
    /* localStorage may be unavailable */
  }
}

function handleImagePresentation(payload: {
  monitor_id: number;
  image_fit_mode: ImageFitMode;
  image_rendering: ImageRenderingMode;
  fill_color?: string;
}): void {
  if (payload.monitor_id !== state.monitorId) {
    return;
  }
  applyFillColor(payload.fill_color);
  if (state.transitionInFlight) {
    if (deferredImagePresentation !== null) {
      deferredImagePresentationDropCount += 1;
    }
    deferredImagePresentation = {
      image_fit_mode: payload.image_fit_mode,
      image_rendering: payload.image_rendering,
    };
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
    fill_color?: string;
    properties?: Record<string, unknown>;
  };

  if (typed.monitor_id !== undefined && typed.image_fit_mode && typed.image_rendering) {
    handleImagePresentation({
      monitor_id: typed.monitor_id,
      image_fit_mode: typed.image_fit_mode,
      image_rendering: typed.image_rendering,
      fill_color: typed.fill_color,
    });
  }

  const props = (typed as Record<string, unknown>).values ?? typed.properties;
  if (!props) {
    return;
  }

  if (state.transitionInFlight) {
    if (deferredWallpaperUserPropsQueue !== null) {
      deferredWallpaperUserPropsDropCount += 1;
    }
    deferredWallpaperUserPropsQueue = props;
    return;
  }
  applyWallpaperListenerUserProps(props);
}

// no-op until capability negotiation lands
function handleCapsPush(_payload: unknown): void {}

function connectBridge(): void {
  const b = window._walBridge!;
  b.loadWallpaper.connect((j: string) => {
    void handleLoad(JSON.parse(j) as LoadRequest);
  });
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
