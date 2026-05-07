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
};

export const dom: RuntimeDom = {
  activeLayer: document.querySelector<HTMLImageElement>("#wallpaper-active"),
  incomingLayer: document.querySelector<HTMLImageElement>("#wallpaper-incoming"),
  webglCanvas: document.querySelector<HTMLCanvasElement>("#wallpaper-webgl"),
  videoActiveLayer: document.querySelector<HTMLVideoElement>("#wallpaper-video-active"),
  videoIncomingLayer: document.querySelector<HTMLVideoElement>("#wallpaper-video-incoming"),
  rootEl: document.querySelector<HTMLElement>(".wallpaper-root"),
  parallaxSurfaceEl: document.querySelector<HTMLElement>(".wallpaper-parallax-surface"),
};

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
