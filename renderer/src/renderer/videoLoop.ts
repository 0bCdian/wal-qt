const VIDEO_STARTUP_FADE_MS = 220;
const VIDEO_LOOP_FADE_MS = 90;
const LOOP_WRAP_EPSILON_S = 0.2;

export type LoopTrackedLayer = Pick<
  HTMLVideoElement,
  | "addEventListener"
  | "removeEventListener"
  | "classList"
  | "style"
  | "currentTime"
  | "duration"
  | "paused"
  | "loop"
> &
  Partial<Pick<HTMLVideoElement, "offsetWidth">>;

function triggerVideoFade(layer: LoopTrackedLayer, durationMs: number) {
  layer.style.setProperty("--video-loop-fade-ms", `${durationMs}ms`);
  layer.classList.remove("video-loop-fade");
  void layer.offsetWidth;
  layer.classList.add("video-loop-fade");
}

export function installVideoLoopHandler() {
  let trackedLayer: LoopTrackedLayer | null = null;
  let lastTimeS = 0;
  let suppressWrapDetection = false;

  const onPlaying = () => {
    if (!trackedLayer) return;
    triggerVideoFade(trackedLayer, VIDEO_STARTUP_FADE_MS);
  };

  const onTimeUpdate = () => {
    if (!trackedLayer || suppressWrapDetection) return;
    if (trackedLayer.paused) return;
    const duration = Number.isFinite(trackedLayer.duration) ? trackedLayer.duration : 0;
    const current = Number.isFinite(trackedLayer.currentTime) ? trackedLayer.currentTime : 0;
    if (
      trackedLayer.loop &&
      duration > 0 &&
      lastTimeS > duration * 0.5 &&
      current + LOOP_WRAP_EPSILON_S < lastTimeS
    ) {
      triggerVideoFade(trackedLayer, VIDEO_LOOP_FADE_MS);
    }
    lastTimeS = current;
  };

  const onSeeking = () => {
    suppressWrapDetection = true;
  };

  const onSeeked = () => {
    if (!trackedLayer) return;
    suppressWrapDetection = false;
    lastTimeS = Number.isFinite(trackedLayer.currentTime) ? trackedLayer.currentTime : 0;
  };

  const detach = () => {
    if (!trackedLayer) return;
    trackedLayer.removeEventListener("playing", onPlaying);
    trackedLayer.removeEventListener("timeupdate", onTimeUpdate);
    trackedLayer.removeEventListener("seeking", onSeeking);
    trackedLayer.removeEventListener("seeked", onSeeked);
    trackedLayer.classList.remove("video-loop-fade");
    trackedLayer.style.removeProperty("--video-loop-fade-ms");
    trackedLayer = null;
    lastTimeS = 0;
    suppressWrapDetection = false;
  };

  return {
    start(_src: string, layer: LoopTrackedLayer) {
      detach();
      trackedLayer = layer;
      lastTimeS = Number.isFinite(layer.currentTime) ? layer.currentTime : 0;
      suppressWrapDetection = false;
      layer.addEventListener("playing", onPlaying);
      layer.addEventListener("timeupdate", onTimeUpdate);
      layer.addEventListener("seeking", onSeeking);
      layer.addEventListener("seeked", onSeeked);
    },
    stop() {
      detach();
    },
  };
}
