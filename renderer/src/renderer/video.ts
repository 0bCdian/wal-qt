import { gsap } from "gsap";

import { resolveAssetUrl } from "./urlUtils";
import { releaseWallpaperWebGlForIdle, type LoadStaleCheck } from "./image";
import { activateVideoMode, clearVideoLayer, commitActiveMediaState, dom, state } from "./state";
import type { LoadRequest, TransitionExecutionMeta } from "./types";
import { runFadeLayerCrossfade } from "./transition/fadeLayer";
import { resolveOrthogonalFadeIntent } from "./transition/orthogonalFade";
import { installVideoLoopHandler } from "./videoLoop";

function showVideoCover() {
  dom.videoCoverEl?.classList.add("is-visible");
}

function hideVideoCover() {
  dom.videoCoverEl?.classList.remove("is-visible");
}

const CANPLAY_TIMEOUT_MS = 300_000;

function detachVideo(layer: HTMLVideoElement) {
  layer.pause();
  layer.loop = false;
  layer.removeAttribute("src");
  layer.load();
}

function prepareInactiveLayer(layer: HTMLVideoElement) {
  layer.pause();
  layer.removeAttribute("src");
  layer.load();
}

function waitForCanPlay(layer: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (layer.readyState >= 3) {
      resolve();
      return;
    }
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      ac.abort();
      reject(new Error(`canplay timeout (${timeoutMs}ms)`));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      ac.abort();
      resolve();
    };
    const fail = () => {
      clearTimeout(timer);
      ac.abort();
      reject(new Error("video load error"));
    };
    layer.addEventListener("canplay", done, { once: true, signal: ac.signal });
    layer.addEventListener("canplaythrough", done, { once: true, signal: ac.signal });
    layer.addEventListener("error", fail, { once: true, signal: ac.signal });
  });
}

function waitForPlaying(layer: HTMLVideoElement, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const ac = new AbortController();
    const timer = window.setTimeout(() => {
      ac.abort();
      reject(new Error(`playing timeout (${timeoutMs}ms)`));
    }, timeoutMs);
    const done = () => {
      clearTimeout(timer);
      ac.abort();
      resolve();
    };
    const fail = () => {
      clearTimeout(timer);
      ac.abort();
      reject(new Error("video playback error"));
    };
    layer.addEventListener("playing", done, { once: true, signal: ac.signal });
    layer.addEventListener("error", fail, { once: true, signal: ac.signal });
  });
}

let loopController: ReturnType<typeof installVideoLoopHandler> | null = null;

export function getLoopController() {
  if (!loopController) loopController = installVideoLoopHandler();
  return loopController;
}

function clearVideoInlineAnimation(layer: HTMLVideoElement): void {
  gsap.killTweensOf(layer);
  layer.style.removeProperty("transform");
  layer.style.removeProperty("filter");
  layer.style.removeProperty("opacity");
  layer.style.removeProperty("transition");
  layer.style.removeProperty("z-index");
  layer.style.removeProperty("will-change");
}

async function runVideoLoadInstantSwap(
  req: LoadRequest,
  checkNotStale: LoadStaleCheck | undefined,
  activeLayer: HTMLVideoElement,
  incomingLayer: HTMLVideoElement,
  startedAt: number,
): Promise<TransitionExecutionMeta> {
  const src = resolveAssetUrl(req.target);

  if (dom.webglCanvas) {
    gsap.killTweensOf(dom.webglCanvas);
    dom.webglCanvas.classList.remove("is-active");
  }

  if (dom.activeLayer) {
    gsap.killTweensOf(dom.activeLayer);
    dom.activeLayer.classList.remove("is-active");
  }
  if (dom.incomingLayer) {
    gsap.killTweensOf(dom.incomingLayer);
    dom.incomingLayer.classList.remove("is-active");
  }

  showVideoCover();
  prepareInactiveLayer(incomingLayer);
  incomingLayer.loop = true;
  incomingLayer.autoplay = true;
  incomingLayer.muted = !req.audio_enabled;
  incomingLayer.preload = "auto";
  incomingLayer.src = src;
  incomingLayer.load();

  activateVideoMode();
  checkNotStale?.();
  await waitForCanPlay(incomingLayer, CANPLAY_TIMEOUT_MS);
  checkNotStale?.();
  const playingPromise = waitForPlaying(incomingLayer, CANPLAY_TIMEOUT_MS);
  await incomingLayer.play();
  await playingPromise;
  hideVideoCover();
  getLoopController().start(src, incomingLayer);
  incomingLayer.classList.add("video-active-layer");
  activeLayer.classList.remove("video-active-layer");
  dom.videoActiveLayer = incomingLayer;
  dom.videoIncomingLayer = activeLayer;
  detachVideo(activeLayer);
  checkNotStale?.();
  commitActiveMediaState("video", src, Boolean(req.audio_enabled));

  return {
    engine: "none",
    effect: "none",
    duration_actual_ms: Math.round(performance.now() - startedAt),
    ...(req.transition !== "none"
      ? { fallback_reason: "orthogonal_fade_unavailable_or_instant_swap" }
      : {}),
  };
}

async function runVideoCrossfadeFromImage(
  req: LoadRequest,
  checkNotStale: LoadStaleCheck | undefined,
  startedAt: number,
  activeVideoSlot: HTMLVideoElement,
  incomingVideoSlot: HTMLVideoElement,
): Promise<TransitionExecutionMeta> {
  const src = resolveAssetUrl(req.target);
  const resolved = resolveOrthogonalFadeIntent(req);
  if (!resolved) {
    throw new Error("orthogonal fade intent missing");
  }
  const { intent, coerced } = resolved;
  const imgOut = dom.activeLayer;
  if (!imgOut) throw new Error("crossfade image→video: missing active <img>");

  showVideoCover();
  prepareInactiveLayer(incomingVideoSlot);
  incomingVideoSlot.loop = true;
  incomingVideoSlot.autoplay = true;
  incomingVideoSlot.muted = !req.audio_enabled;
  incomingVideoSlot.preload = "auto";
  incomingVideoSlot.src = src;
  incomingVideoSlot.load();

  checkNotStale?.();
  await waitForCanPlay(incomingVideoSlot, CANPLAY_TIMEOUT_MS);
  checkNotStale?.();
  const playingPromise = waitForPlaying(incomingVideoSlot, CANPLAY_TIMEOUT_MS);
  await incomingVideoSlot.play();
  await playingPromise;
  hideVideoCover();

  clearVideoInlineAnimation(incomingVideoSlot);
  clearVideoInlineAnimation(activeVideoSlot);
  gsap.killTweensOf(imgOut);

  const backend = await runFadeLayerCrossfade(intent, incomingVideoSlot, imgOut);

  activateVideoMode();
  dom.activeLayer?.classList.remove("is-active");
  dom.incomingLayer?.classList.remove("is-active");
  incomingVideoSlot.classList.add("video-active-layer");
  activeVideoSlot.classList.remove("video-active-layer");
  dom.videoActiveLayer = incomingVideoSlot;
  dom.videoIncomingLayer = activeVideoSlot;
  detachVideo(activeVideoSlot);

  getLoopController().start(src, incomingVideoSlot);
  checkNotStale?.();
  commitActiveMediaState("video", src, Boolean(req.audio_enabled));

  return {
    engine: backend,
    effect: "fade",
    duration_actual_ms: Math.round(performance.now() - startedAt),
    ...(coerced ? { fallback_reason: "orthogonal_fade_coerced" } : {}),
  };
}

async function runVideoCrossfadeToVideo(
  req: LoadRequest,
  checkNotStale: LoadStaleCheck | undefined,
  startedAt: number,
  outgoingVideo: HTMLVideoElement,
  incomingVideo: HTMLVideoElement,
): Promise<TransitionExecutionMeta> {
  const src = resolveAssetUrl(req.target);
  const resolved = resolveOrthogonalFadeIntent(req);
  if (!resolved) {
    throw new Error("orthogonal fade intent missing");
  }
  const { intent, coerced } = resolved;

  showVideoCover();
  prepareInactiveLayer(incomingVideo);
  incomingVideo.loop = true;
  incomingVideo.autoplay = true;
  incomingVideo.muted = !req.audio_enabled;
  incomingVideo.preload = "auto";
  incomingVideo.src = src;
  incomingVideo.load();

  checkNotStale?.();
  await waitForCanPlay(incomingVideo, CANPLAY_TIMEOUT_MS);
  checkNotStale?.();
  const playingPromise = waitForPlaying(incomingVideo, CANPLAY_TIMEOUT_MS);
  await incomingVideo.play();
  await playingPromise;
  hideVideoCover();

  clearVideoInlineAnimation(incomingVideo);
  clearVideoInlineAnimation(outgoingVideo);

  const backend = await runFadeLayerCrossfade(intent, incomingVideo, outgoingVideo);

  incomingVideo.classList.add("video-active-layer");
  outgoingVideo.classList.remove("video-active-layer");
  dom.videoActiveLayer = incomingVideo;
  dom.videoIncomingLayer = outgoingVideo;
  detachVideo(outgoingVideo);

  getLoopController().start(src, incomingVideo);
  checkNotStale?.();
  commitActiveMediaState("video", src, Boolean(req.audio_enabled));

  return {
    engine: backend,
    effect: "fade",
    duration_actual_ms: Math.round(performance.now() - startedAt),
    ...(coerced ? { fallback_reason: "orthogonal_fade_coerced" } : {}),
  };
}

export async function runVideoLoad(
  req: LoadRequest,
  checkNotStale?: LoadStaleCheck,
): Promise<TransitionExecutionMeta> {
  const activeLayer = dom.videoActiveLayer;
  const incomingLayer = dom.videoIncomingLayer;
  if (!activeLayer || !incomingLayer || !dom.rootEl)
    throw new Error("video layer missing from DOM");

  const startedAt = performance.now();
  getLoopController().stop();
  releaseWallpaperWebGlForIdle();

  const orth = resolveOrthogonalFadeIntent(req);

  if (orth && state.activeKind === "image" && dom.activeLayer) {
    if (dom.webglCanvas) {
      gsap.killTweensOf(dom.webglCanvas);
      dom.webglCanvas.classList.remove("is-active");
    }
    return runVideoCrossfadeFromImage(req, checkNotStale, startedAt, activeLayer, incomingLayer);
  }

  if (orth && state.activeKind === "video") {
    if (dom.webglCanvas) {
      gsap.killTweensOf(dom.webglCanvas);
      dom.webglCanvas.classList.remove("is-active");
    }
    return runVideoCrossfadeToVideo(req, checkNotStale, startedAt, activeLayer, incomingLayer);
  }

  return runVideoLoadInstantSwap(req, checkNotStale, activeLayer, incomingLayer, startedAt);
}

export function resetVideoRuntime() {
  getLoopController().stop();
  const a = dom.videoActiveLayer;
  const b = dom.videoIncomingLayer;
  if (a) detachVideo(a);
  if (b) detachVideo(b);
  clearVideoLayer();
}
