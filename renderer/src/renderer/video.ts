import { gsap } from "gsap";

import { resolveAssetUrl } from "./urlUtils";
import { releaseWallpaperWebGlForIdle, type LoadStaleCheck } from "./image";
import { activateVideoMode, clearVideoLayer, commitActiveMediaState, dom } from "./state";
import type { LoadRequest, TransitionExecutionMeta } from "./types";
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

export async function runVideoLoad(
  req: LoadRequest,
  checkNotStale?: LoadStaleCheck,
): Promise<TransitionExecutionMeta> {
  const activeLayer = dom.videoActiveLayer;
  const incomingLayer = dom.videoIncomingLayer;
  if (!activeLayer || !incomingLayer || !dom.rootEl)
    throw new Error("video layer missing from DOM");

  getLoopController().stop();
  releaseWallpaperWebGlForIdle();

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

  const src = resolveAssetUrl(req.target);

  showVideoCover();
  prepareInactiveLayer(incomingLayer);
  incomingLayer.loop = true;
  incomingLayer.autoplay = true;
  incomingLayer.muted = !req.audio_enabled;
  incomingLayer.preload = "auto";
  incomingLayer.src = src;
  incomingLayer.load();

  // Before canplay: must add `video-active` so `.wallpaper-layer` is forced to opacity 0.
  // Otherwise a leftover `is-active` <img> (z-index 1) stays above the <video> (no z-index).
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
    duration_actual_ms: 0,
    ...(req.transition !== "none" ? { fallback_reason: "non_image_transition_bypassed" } : {}),
  };
}

export function resetVideoRuntime() {
  getLoopController().stop();
  const a = dom.videoActiveLayer;
  const b = dom.videoIncomingLayer;
  if (a) detachVideo(a);
  if (b) detachVideo(b);
  clearVideoLayer();
}
