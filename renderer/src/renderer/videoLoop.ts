export function installVideoLoopHandler() {
  let trackedSrc: string | null = null;

  return {
    start(src: string, _layer: HTMLVideoElement) {
      trackedSrc = src;
    },
    stop() {
      trackedSrc = null;
    },
    get currentSrc() {
      return trackedSrc;
    },
  };
}
