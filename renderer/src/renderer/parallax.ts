import { dom, state } from "./state";
import type { LoadParallaxConfig, ParallaxPayload } from "./types";
import { logger } from "./logger";

let visualOffsetX = 0;
let visualOffsetY = 0;
let hasVisualOffset = false;
/** When set, a matching `wallpaper:parallax` from the engine is a no-op (already applied on load). */
let loadBaselineEcho: ParallaxPayload | null = null;
let queuedPayload: ParallaxPayload | null = null;
let coalesceTimer: number | null = null;
let coalesceRaf: number | null = null;
let clearParallaxClassTimer: number | null = null;
let coalescedDropCount = 0;
/** Last zoom applied while parallax is enabled (for resize recomputation). */
let lastAppliedZoom = 1;

const PARALLAX_OFFSET_LIMIT = 0.5;
const DEFAULT_EASING: [number, number, number, number] = [0.215, 0.61, 0.355, 1.0];
const PARALLAX_COALESCE_MS = 24;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function easingToCss(easing: [number, number, number, number]): string {
  return `cubic-bezier(${easing[0]}, ${easing[1]}, ${easing[2]}, ${easing[3]})`;
}

function computeTranslatePercent(offsetNorm: number, zoom: number): number {
  const safeZoom = Number.isFinite(zoom) ? Math.max(1, zoom) : 1;
  const clampedOffset = clamp(offsetNorm, -PARALLAX_OFFSET_LIMIT, PARALLAX_OFFSET_LIMIT);
  // Tuned for the previous scale(z)+translate(%) pipeline; reuse as viewport-relative pan.
  return (clampedOffset * (safeZoom - 1) * 100) / safeZoom;
}

function setSurfaceTransformTransition(
  surfaceEl: HTMLElement,
  durationMs: number,
  easing: [number, number, number, number],
): void {
  const safeDuration = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0;
  if (safeDuration <= 0) {
    surfaceEl.style.transition = "none";
    return;
  }
  surfaceEl.style.transition = `transform ${safeDuration}ms ${easingToCss(easing)}`;
}

function setLegacyRootTransformTransition(
  rootEl: HTMLElement,
  durationMs: number,
  easing: [number, number, number, number],
): void {
  const safeDuration = Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0;
  if (safeDuration <= 0) {
    rootEl.style.transition = "none";
    return;
  }
  rootEl.style.transition = `transform ${safeDuration}ms ${easingToCss(easing)}`;
}

/** Snap to device pixels so layout boxes align with the screen grid (avoids chronic blur from subpixel % + transforms). */
function snapCssPx(cssPx: number, dpr: number): number {
  if (!Number.isFinite(cssPx) || dpr <= 0) return cssPx;
  return Math.round(cssPx * dpr) / dpr;
}

/**
 * Oversized surface in integer layout px; center with left/top (no translate(-50%)).
 * Pan uses translate(px) only — at pan 0, transform is removed so the stack is not on a composited layer for no reason.
 */
function applyLayoutParallax(
  rootEl: HTMLElement,
  surfaceEl: HTMLElement,
  payload: Pick<ParallaxPayload, "zoom" | "offset_x" | "offset_y">,
): void {
  const safeZoom = Number.isFinite(payload.zoom) ? Math.max(1, payload.zoom) : 1;
  lastAppliedZoom = safeZoom;
  rootEl.style.removeProperty("transform");

  const dpr =
    typeof window !== "undefined" && window.devicePixelRatio > 0 ? window.devicePixelRatio : 1;
  const rect = rootEl.getBoundingClientRect();
  const rw = rect.width;
  const rh = rect.height;

  const w = Math.max(snapCssPx(1 / dpr, dpr), snapCssPx(rw * safeZoom, dpr));
  const h = Math.max(snapCssPx(1 / dpr, dpr), snapCssPx(rh * safeZoom, dpr));

  const xPercent = computeTranslatePercent(payload.offset_x, safeZoom);
  const yPercent = computeTranslatePercent(payload.offset_y, safeZoom);
  const panXPx = (rw * xPercent) / 100;
  const panYPx = (rh * yPercent) / 100;

  const baseLeft = snapCssPx((rw - w) / 2, dpr);
  const baseTop = snapCssPx((rh - h) / 2, dpr);

  surfaceEl.style.width = `${w}px`;
  surfaceEl.style.height = `${h}px`;
  surfaceEl.style.left = `${baseLeft}px`;
  surfaceEl.style.top = `${baseTop}px`;

  if (Math.abs(panXPx) < 1e-6 && Math.abs(panYPx) < 1e-6) {
    surfaceEl.style.removeProperty("transform");
  } else {
    surfaceEl.style.transform = `translate(${panXPx}px, ${panYPx}px)`;
  }
}

/** Fallback when `.wallpaper-parallax-surface` is missing (tests / old HTML). */
function applyLegacyScaleParallax(
  rootEl: HTMLElement,
  payload: Pick<ParallaxPayload, "zoom" | "offset_x" | "offset_y">,
): void {
  const safeZoom = Number.isFinite(payload.zoom) ? Math.max(1, payload.zoom) : 1;
  lastAppliedZoom = safeZoom;
  const xPercent = computeTranslatePercent(payload.offset_x, safeZoom);
  const yPercent = computeTranslatePercent(payload.offset_y, safeZoom);
  rootEl.style.transformOrigin = "center center";
  rootEl.style.transform = `scale(${safeZoom}) translate(${xPercent}%, ${yPercent}%)`;
}

function applyParallaxTransform(
  rootEl: HTMLElement,
  payload: Pick<ParallaxPayload, "zoom" | "offset_x" | "offset_y">,
): void {
  const surfaceEl = dom.parallaxSurfaceEl;
  if (surfaceEl) {
    applyLayoutParallax(rootEl, surfaceEl, payload);
  } else {
    applyLegacyScaleParallax(rootEl, payload);
  }
}

function setTransformTransition(
  rootEl: HTMLElement,
  surfaceEl: HTMLElement | null,
  durationMs: number,
  easing: [number, number, number, number],
): void {
  if (surfaceEl) {
    setSurfaceTransformTransition(surfaceEl, durationMs, easing);
    rootEl.style.transition = "none";
  } else {
    setLegacyRootTransformTransition(rootEl, durationMs, easing);
  }
}

function clampOffset(value: number): number {
  return clamp(value, -PARALLAX_OFFSET_LIMIT, PARALLAX_OFFSET_LIMIT);
}

function parallaxEchoMatches(a: ParallaxPayload, b: ParallaxPayload): boolean {
  const eps = 1e-3;
  return (
    a.enabled === b.enabled &&
    Math.abs(a.zoom - b.zoom) < eps &&
    Math.abs(a.offset_x - b.offset_x) < eps &&
    Math.abs(a.offset_y - b.offset_y) < eps &&
    !a.wrapped_x &&
    !a.wrapped_y &&
    !b.wrapped_x &&
    !b.wrapped_y
  );
}

function clearScheduledApply(): void {
  if (coalesceTimer !== null) {
    window.clearTimeout(coalesceTimer);
    coalesceTimer = null;
  }
  if (coalesceRaf !== null) {
    window.cancelAnimationFrame(coalesceRaf);
    coalesceRaf = null;
  }
}

function markParallaxActive(rootEl: HTMLElement, durationMs: number): void {
  rootEl.classList.add("parallax-active");
  if (clearParallaxClassTimer !== null) {
    window.clearTimeout(clearParallaxClassTimer);
    clearParallaxClassTimer = null;
  }
  const holdMs = Math.max(80, Math.round(durationMs) + 64);
  clearParallaxClassTimer = window.setTimeout(() => {
    rootEl.classList.remove("parallax-active");
    clearParallaxClassTimer = null;
  }, holdMs);
}

function applyParallaxTransition(rootEl: HTMLElement, payload: ParallaxPayload): void {
  const surfaceEl = dom.parallaxSurfaceEl;
  const nextX = clampOffset(payload.offset_x);
  const nextY = clampOffset(payload.offset_y);
  const durationMs = Number.isFinite(payload.animation_ms)
    ? Math.max(0, Math.round(payload.animation_ms))
    : 0;
  setTransformTransition(rootEl, surfaceEl, durationMs, payload.easing ?? DEFAULT_EASING);
  applyParallaxTransform(rootEl, { zoom: payload.zoom, offset_x: nextX, offset_y: nextY });
  markParallaxActive(rootEl, durationMs);
  visualOffsetX = nextX;
  visualOffsetY = nextY;
}

function resetParallaxDisabled(
  rootEl: HTMLElement,
  resetMs: number,
  easing: [number, number, number, number],
): void {
  const surfaceEl = dom.parallaxSurfaceEl;
  lastAppliedZoom = 1;
  if (surfaceEl) {
    rootEl.style.removeProperty("transform");
    surfaceEl.style.transition = "none";
    surfaceEl.style.removeProperty("width");
    surfaceEl.style.removeProperty("height");
    surfaceEl.style.removeProperty("left");
    surfaceEl.style.removeProperty("top");
    surfaceEl.style.removeProperty("transform");
    surfaceEl.style.removeProperty("transform-origin");
  } else {
    setTransformTransition(rootEl, null, resetMs, easing);
    rootEl.style.transformOrigin = "center center";
    rootEl.style.transform = "scale(1) translate(0%, 0%)";
  }
}

function applyParallaxNow(payload: ParallaxPayload): void {
  const rootEl = dom.rootEl;
  if (!rootEl) {
    return;
  }

  const easing: [number, number, number, number] = payload.easing ?? DEFAULT_EASING;
  if (!payload.enabled) {
    loadBaselineEcho = null;
    clearScheduledApply();
    queuedPayload = null;
    hasVisualOffset = false;
    visualOffsetX = 0;
    visualOffsetY = 0;
    resetParallaxDisabled(rootEl, payload.reset_ms, easing);
    rootEl.classList.remove("parallax-active");
    if (clearParallaxClassTimer !== null) {
      window.clearTimeout(clearParallaxClassTimer);
      clearParallaxClassTimer = null;
    }
    return;
  }

  if (!hasVisualOffset) {
    visualOffsetX = clampOffset(payload.offset_x);
    visualOffsetY = clampOffset(payload.offset_y);
    hasVisualOffset = true;
    setTransformTransition(rootEl, dom.parallaxSurfaceEl, payload.animation_ms, easing);
    applyParallaxTransform(rootEl, {
      zoom: payload.zoom,
      offset_x: visualOffsetX,
      offset_y: visualOffsetY,
    });
    return;
  }

  // Wrapped and non-wrapped updates follow the same transition path.
  // Backend now emits center-reset targets when edge crossing happens.
  applyParallaxTransition(rootEl, payload);
}

function flushQueuedParallax(): void {
  const payload = queuedPayload;
  queuedPayload = null;
  clearScheduledApply();
  if (!payload) return;
  if (coalescedDropCount > 0) {
    logger.debug("coalesced parallax payloads", { dropped: coalescedDropCount });
    coalescedDropCount = 0;
  }
  applyParallaxNow(payload);
}

/** Apply parallax zoom at transition start (no animation). Call before `runTransition`. */
export function applyParallaxBaselineForLoad(cfg: LoadParallaxConfig): void {
  const rootEl = dom.rootEl;
  if (!rootEl) {
    return;
  }
  clearScheduledApply();
  queuedPayload = null;
  coalescedDropCount = 0;
  const easing: [number, number, number, number] = cfg.easing ?? DEFAULT_EASING;
  setTransformTransition(rootEl, dom.parallaxSurfaceEl, 0, easing);
  applyParallaxTransform(rootEl, { zoom: cfg.zoom, offset_x: 0, offset_y: 0 });
  hasVisualOffset = true;
  visualOffsetX = 0;
  visualOffsetY = 0;
  loadBaselineEcho = {
    monitor_id: state.monitorId,
    enabled: true,
    zoom: cfg.zoom,
    offset_x: 0,
    offset_y: 0,
    animation_ms: cfg.animation_ms,
    easing: [...easing] as [number, number, number, number],
    reset_ms: cfg.reset_ms,
    wrapped_x: false,
    wrapped_y: false,
  };
}

export function applyParallax(payload: ParallaxPayload): void {
  if (state.activeKind === "web") {
    return;
  }
  if (!payload.enabled) {
    // Disables/resets should apply immediately.
    applyParallaxNow(payload);
    return;
  }

  if (loadBaselineEcho && parallaxEchoMatches(payload, loadBaselineEcho)) {
    loadBaselineEcho = null;
    return;
  }
  loadBaselineEcho = null;

  if (queuedPayload) {
    coalescedDropCount += 1;
  }
  queuedPayload = payload;
  if (coalesceTimer !== null || coalesceRaf !== null) {
    return;
  }

  coalesceTimer = window.setTimeout(() => {
    coalesceTimer = null;
    coalesceRaf = window.requestAnimationFrame(() => {
      coalesceRaf = null;
      flushQueuedParallax();
    });
  }, PARALLAX_COALESCE_MS);
}

function refreshParallaxAfterResize(): void {
  const rootEl = dom.rootEl;
  if (!rootEl || !hasVisualOffset) {
    return;
  }
  const surfaceEl = dom.parallaxSurfaceEl;
  if (surfaceEl) {
    applyLayoutParallax(rootEl, surfaceEl, {
      zoom: lastAppliedZoom,
      offset_x: visualOffsetX,
      offset_y: visualOffsetY,
    });
  } else {
    applyLegacyScaleParallax(rootEl, {
      zoom: lastAppliedZoom,
      offset_x: visualOffsetX,
      offset_y: visualOffsetY,
    });
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("resize", () => {
    refreshParallaxAfterResize();
  });
}
