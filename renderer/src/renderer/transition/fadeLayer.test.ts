/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { runFadeLayerCrossfade } from "./fadeLayer";
import type { TransitionIntent } from "./intent";

function makeFadeIntent(durationMs: number): TransitionIntent {
  return {
    effect: "fade",
    durationMs,
    wipeAngleDeg: 0,
    originXPercent: 50,
    originYPercent: 50,
    waveAmplitudePercent: 0,
    waveFrequency: 1,
    blurRadiusPx: 0,
    bezier: [0.215, 0.61, 0.355, 1],
  };
}

describe("runFadeLayerCrossfade", () => {
  let origAnimate: typeof HTMLElement.prototype.animate | undefined;

  beforeEach(() => {
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback): number => {
      queueMicrotask(() => fn(0));
      return 1;
    });

    origAnimate = HTMLElement.prototype.animate;
    HTMLElement.prototype.animate = vi.fn(function mockAnimate(): Animation {
      return {
        cancel: vi.fn(),
        finished: Promise.resolve(),
      } as unknown as Animation;
    }) as typeof HTMLElement.prototype.animate;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (origAnimate) {
      HTMLElement.prototype.animate = origAnimate;
      origAnimate = undefined;
    }
  });

  it("prefers Web Animations when HTMLElement.prototype.animate is available", async () => {
    const incoming = document.createElement("img");
    const outgoing = document.createElement("img");
    const animateFn = HTMLElement.prototype.animate as unknown as ReturnType<typeof vi.fn>;
    const backend = await runFadeLayerCrossfade(makeFadeIntent(40), incoming, outgoing);
    expect(backend).toBe("waapi");
    expect(animateFn).toHaveBeenCalled();
    expect(animateFn.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("applies instantaneous opacity flip for zero-duration fade", async () => {
    const incoming = document.createElement("img");
    const outgoing = document.createElement("img");
    incoming.style.opacity = "0";
    outgoing.style.opacity = "1";
    await runFadeLayerCrossfade(makeFadeIntent(0), incoming, outgoing);
    expect(incoming.style.opacity).toBe("1");
    expect(outgoing.style.opacity).toBe("0");
  });
});
