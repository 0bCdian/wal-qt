import type { ImageFitMode, ImageRenderingMode, MediaKind } from "./types";

type RuntimeState = {
  activeTarget: string | null;
  activeKind: MediaKind | null;
  activeAudioEnabled: boolean;
  transitionInFlight: boolean;
  busy: boolean;
  monitorId: number;
  activeImageFitMode: ImageFitMode;
  activeImageRendering: ImageRenderingMode;
};

type RuntimeDom = {
  activeLayer: HTMLImageElement | null;
  incomingLayer: HTMLImageElement | null;
  webglCanvas: HTMLCanvasElement | null;
  videoActiveLayer: HTMLVideoElement | null;
  videoIncomingLayer: HTMLVideoElement | null;
  rootEl: HTMLElement | null;
  /** Oversized layout box for parallax zoom (avoids CSS scale blur). */
  parallaxSurfaceEl: HTMLElement | null;
  /** Black cover shown during video buffer/load to hide the blank frame. */
  videoCoverEl: HTMLElement | null;
};

export const dom: RuntimeDom = {
  activeLayer: null,
  incomingLayer: null,
  webglCanvas: null,
  videoActiveLayer: null,
  videoIncomingLayer: null,
  rootEl: null,
  parallaxSurfaceEl: null,
  videoCoverEl: null,
};

/** Re-bind DOM refs (call from DOMContentLoaded; module init can run before <body> exists under WebEngine). */
export function refreshDomRefs(): void {
  dom.activeLayer = document.querySelector<HTMLImageElement>("#wallpaper-active");
  dom.incomingLayer = document.querySelector<HTMLImageElement>("#wallpaper-incoming");
  dom.webglCanvas = document.querySelector<HTMLCanvasElement>("#wallpaper-webgl");
  dom.videoActiveLayer = document.querySelector<HTMLVideoElement>("#wallpaper-video-active");
  dom.videoIncomingLayer = document.querySelector<HTMLVideoElement>("#wallpaper-video-incoming");
  dom.rootEl = document.querySelector<HTMLElement>(".wallpaper-root");
  dom.parallaxSurfaceEl = document.querySelector<HTMLElement>(".wallpaper-parallax-surface");
  dom.videoCoverEl = document.querySelector<HTMLElement>("#wallpaper-video-cover");
}

export const state: RuntimeState = {
  activeTarget: null,
  activeKind: null,
  activeAudioEnabled: false,
  transitionInFlight: false,
  busy: false,
  monitorId: 0,
  activeImageFitMode: "cover",
  activeImageRendering: "auto",
};

export function activateImageMode() {
  if (!dom.rootEl) {
    return;
  }
  dom.rootEl.classList.remove("video-active");
}

export function activateVideoMode() {
  if (!dom.rootEl || !dom.videoActiveLayer || !dom.videoIncomingLayer) {
    return;
  }
  dom.rootEl.classList.add("video-active");
  dom.videoActiveLayer.classList.add("video-active-layer");
  dom.videoIncomingLayer.classList.remove("video-active-layer");
}

export function commitActiveMediaState(
  kind: MediaKind,
  target: string,
  audioEnabled: boolean,
  imageOptions?: { fitMode?: ImageFitMode; rendering?: ImageRenderingMode },
) {
  state.activeKind = kind;
  state.activeTarget = target;
  state.activeAudioEnabled = audioEnabled;
  if (kind === "image") {
    state.activeImageFitMode = imageOptions?.fitMode ?? "cover";
    state.activeImageRendering = imageOptions?.rendering ?? "auto";
  }
}

export function clearVideoLayer() {
  if (!dom.videoActiveLayer || !dom.videoIncomingLayer || !dom.rootEl) {
    return;
  }
  dom.rootEl.classList.remove("video-active");
  resetVideoLayerState(dom.videoActiveLayer);
  resetVideoLayerState(dom.videoIncomingLayer);
  const active = document.querySelector<HTMLVideoElement>("#wallpaper-video-active");
  const incoming = document.querySelector<HTMLVideoElement>("#wallpaper-video-incoming");
  if (active && incoming) {
    dom.videoActiveLayer = active;
    dom.videoIncomingLayer = incoming;
    dom.videoActiveLayer.classList.add("video-active-layer");
    dom.videoIncomingLayer.classList.remove("video-active-layer");
  }
}

function resetVideoLayerState(layer: HTMLVideoElement) {
  layer.pause();
  layer.classList.remove("video-active-layer", "video-loop-fade");
  layer.playbackRate = 1;
  layer.style.removeProperty("--video-loop-fade-ms");
  layer.removeAttribute("src");
  layer.load();
}
