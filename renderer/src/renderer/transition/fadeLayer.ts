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
 */
export async function runFadeLayerCrossfade(
  intent: TransitionIntent,
  incoming: HTMLElement,
  outgoing: HTMLElement,
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

      const finishOk = (backend: FadeCrossfadeBackend) => {
        if (settled) return;
        settled = true;
        browse().clearTimeout(guardTimer);
        waapiIn?.cancel();
        waapiOut?.cancel();
        cleanupRestStyles();
        resolve(backend);
      };

      const finishErr = () => {
        if (settled) return;
        settled = true;
        browse().clearTimeout(guardTimer);
        waapiIn?.cancel();
        waapiOut?.cancel();
        cleanupRestStyles();
        reject(new Error(`fade transition timeout after ${guardMs}ms`));
      };

      const guardTimer = browse().setTimeout(finishErr, guardMs);

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
          void Promise.all([waapiIn.finished, waapiOut.finished])
            .then(() => finishOk("waapi"))
            .catch(finishErr);
        } catch {
          finishErr();
        }
      });
    });
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (backend: FadeCrossfadeBackend, ok: boolean) => {
      if (settled) return;
      settled = true;
      browse().clearTimeout(guard);
      incoming.removeEventListener("transitionend", onEnd);
      cleanupRestStyles();
      if (ok) resolve(backend);
      else reject(new Error(`fade transition timeout after ${guardMs}ms`));
    };

    const onEnd = (e: TransitionEvent): void => {
      if (e.target !== incoming || e.propertyName !== "opacity") return;
      settle("css", true);
    };

    const guard = browse().setTimeout(() => settle("css", false), guardMs);
    incoming.addEventListener("transitionend", onEnd);

    void settleTwoFrames(() => {
      incoming.style.transition = `opacity ${durationMs}ms ${easeCss}`;
      outgoing.style.transition = `opacity ${durationMs}ms ${easeCss}`;
      incoming.style.opacity = "1";
      outgoing.style.opacity = "0";
    });
  });
}
