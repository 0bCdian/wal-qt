import type { TransitionIntent } from "./intent";

/** How the opacity crossfade was driven (Web Animations avoids transitionend quirks on Chromium). */
export type FadeCrossfadeBackend = "waapi" | "css";

const MIN_END_TIMEOUT_MS = 1200;
const END_TIMEOUT_BUFFER_MS = 900;

function computeRendererGuardTimeoutMs(durationMs: number): number {
  return Math.max(durationMs + END_TIMEOUT_BUFFER_MS, MIN_END_TIMEOUT_MS);
}

function browse(): Window & typeof globalThis {
  return globalThis as Window & typeof globalThis;
}

async function settleTwoFrames(callback: () => void): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      callback();
      resolve();
    });
  });
}

function canAnimateWithWaapi(layer: HTMLElement): boolean {
  return typeof layer.animate === "function";
}

function waapiEasingFromBezier(cssCubicBezier: string): string {
  return cssCubicBezier.trim().startsWith("cubic-bezier(") ? cssCubicBezier.trim() : "linear";
}

/**
 * Dual-layer opacity crossfade (same contract as &lt;img&gt; image↔image fade).
 * Prefers Web Animations API when available — reliable `finished` timing and avoids
 * `transitionend` quirks on Chromium. Falls back to CSS-transition + `transitionend` elsewhere.
 *
 * `checkNotStale`, when supplied, is polled every animation frame: if it throws
 * (e.g. AbortError because a newer load superseded this one) the in-flight
 * animation is killed immediately and the promise rejects with that error,
 * instead of waiting for the natural duration to elapse.
 */
export async function runFadeLayerCrossfade(
  intent: TransitionIntent,
  incoming: HTMLElement,
  outgoing: HTMLElement,
  checkNotStale?: () => void,
): Promise<FadeCrossfadeBackend> {
  const [x1, y1, x2, y2] = intent.bezier;
  const durationMs = intent.durationMs;
  const guardMs = computeRendererGuardTimeoutMs(durationMs);
  const easeCss = `cubic-bezier(${x1},${y1},${x2},${y2})`;
  const easing = waapiEasingFromBezier(easeCss);

  if (durationMs <= 0) {
    incoming.style.opacity = "1";
    outgoing.style.opacity = "0";
    return canAnimateWithWaapi(incoming) ? "waapi" : "css";
  }

  incoming.style.zIndex = "2";
  outgoing.style.zIndex = "2";
  incoming.style.transition = "none";
  outgoing.style.transition = "none";
  incoming.style.opacity = "0";
  outgoing.style.opacity = "1";

  const cleanupRestStyles = (): void => {
    incoming.style.transition = "";
    outgoing.style.transition = "";
    incoming.style.opacity = "1";
    outgoing.style.opacity = "0";
  };

  if (canAnimateWithWaapi(incoming) && canAnimateWithWaapi(outgoing)) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let waapiIn: Animation | null = null;
      let waapiOut: Animation | null = null;
      let abortRaf = 0;

      const stopAbortPoll = () => {
        if (abortRaf) {
          cancelAnimationFrame(abortRaf);
          abortRaf = 0;
        }
      };

      const finishOk = (backend: FadeCrossfadeBackend) => {
        if (settled) return;
        settled = true;
        browse().clearTimeout(guardTimer);
        stopAbortPoll();
        waapiIn?.cancel();
        waapiOut?.cancel();
        cleanupRestStyles();
        resolve(backend);
      };

      const finishErr = (err?: unknown) => {
        if (settled) return;
        settled = true;
        browse().clearTimeout(guardTimer);
        stopAbortPoll();
        waapiIn?.cancel();
        waapiOut?.cancel();
        cleanupRestStyles();
        reject(
          err instanceof Error ? err : new Error(`fade transition timeout after ${guardMs}ms`),
        );
      };

      const pollAbort = () => {
        if (settled || !checkNotStale) return;
        try {
          checkNotStale();
        } catch (err) {
          finishErr(err);
          return;
        }
        abortRaf = requestAnimationFrame(pollAbort);
      };

      const guardTimer = browse().setTimeout(() => finishErr(), guardMs);

      void settleTwoFrames(() => {
        if (settled) return;
        try {
          waapiIn = incoming.animate([{ opacity: 0 }, { opacity: 1 }], {
            duration: durationMs,
            easing,
            fill: "forwards",
          });
          waapiOut = outgoing.animate([{ opacity: 1 }, { opacity: 0 }], {
            duration: durationMs,
            easing,
            fill: "forwards",
          });
          if (checkNotStale) {
            abortRaf = requestAnimationFrame(pollAbort);
          }
          void Promise.all([waapiIn.finished, waapiOut.finished])
            .then(() => finishOk("waapi"))
            .catch(() => finishErr());
        } catch {
          finishErr();
        }
      });
    });
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let abortRaf = 0;
    const stopAbortPoll = () => {
      if (abortRaf) {
        cancelAnimationFrame(abortRaf);
        abortRaf = 0;
      }
    };
    const settle = (backend: FadeCrossfadeBackend, ok: boolean, err?: unknown) => {
      if (settled) return;
      settled = true;
      browse().clearTimeout(guard);
      stopAbortPoll();
      incoming.removeEventListener("transitionend", onEnd);
      cleanupRestStyles();
      if (ok) resolve(backend);
      else
        reject(
          err instanceof Error ? err : new Error(`fade transition timeout after ${guardMs}ms`),
        );
    };

    const onEnd = (e: TransitionEvent): void => {
      if (e.target !== incoming || e.propertyName !== "opacity") return;
      settle("css", true);
    };

    const pollAbort = () => {
      if (settled || !checkNotStale) return;
      try {
        checkNotStale();
      } catch (err) {
        settle("css", false, err);
        return;
      }
      abortRaf = requestAnimationFrame(pollAbort);
    };

    const guard = browse().setTimeout(() => settle("css", false), guardMs);
    incoming.addEventListener("transitionend", onEnd);

    void settleTwoFrames(() => {
      incoming.style.transition = `opacity ${durationMs}ms ${easeCss}`;
      outgoing.style.transition = `opacity ${durationMs}ms ${easeCss}`;
      incoming.style.opacity = "1";
      outgoing.style.opacity = "0";
      if (checkNotStale) {
        abortRaf = requestAnimationFrame(pollAbort);
      }
    });
  });
}
