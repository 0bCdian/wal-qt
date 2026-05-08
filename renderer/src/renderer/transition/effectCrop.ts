import { logger } from "../logger";

/** Normalized canvas UV bounds (same space as shader `v_uv`) for visible root ∩ canvas. */
export type EffectCropUv = {
  minU: number;
  minV: number;
  maxU: number;
  maxV: number;
};

export function identityEffectCropUv(): EffectCropUv {
  return { minU: 0, minV: 0, maxU: 1, maxV: 1 };
}

/** Intersection of `clipRect` with the canvas rectangle, expressed as fractions of canvas width/height. */
export function effectCropUvFromCanvasAndClipRects(
  canvasRect: DOMRectReadOnly | Pick<DOMRectReadOnly, "left" | "top" | "width" | "height">,
  clipRect: Pick<DOMRectReadOnly, "left" | "top" | "right" | "bottom">,
): EffectCropUv | null {
  const crLeft = canvasRect.left;
  const crTop = canvasRect.top;
  const crW = canvasRect.width;
  const crH = canvasRect.height;
  if (!(crW > 1e-6 && crH > 1e-6)) {
    return null;
  }
  const crRight = crLeft + crW;
  const crBottom = crTop + crH;
  const il = Math.max(clipRect.left, crLeft);
  const it = Math.max(clipRect.top, crTop);
  const ir = Math.min(clipRect.right, crRight);
  const ib = Math.min(clipRect.bottom, crBottom);
  if (ir <= il || ib <= it) {
    return null;
  }
  return {
    minU: (il - crLeft) / crW,
    minV: (it - crTop) / crH,
    maxU: (ir - crLeft) / crW,
    maxV: (ib - crTop) / crH,
  };
}

export function resolveLiveTransitionEffectCropUv(
  canvas: HTMLCanvasElement,
  root: HTMLElement | null,
): EffectCropUv {
  if (!root) {
    return identityEffectCropUv();
  }
  const canvasRect = canvas.getBoundingClientRect();
  const clipRect = root.getBoundingClientRect();
  const raw = effectCropUvFromCanvasAndClipRects(canvasRect, clipRect);
  if (!raw) {
    logger.debug("transition effect crop degenerate; using full canvas", {
      canvas: { w: canvasRect.width, h: canvasRect.height },
    });
    return identityEffectCropUv();
  }
  const spanU = raw.maxU - raw.minU;
  const spanV = raw.maxV - raw.minV;
  if (spanU < 0.02 || spanV < 0.02) {
    logger.debug("transition effect crop span very small; using full canvas", {
      spanU,
      spanV,
    });
    return identityEffectCropUv();
  }
  return raw;
}

function projExtremaOnUvRect(
  dirX: number,
  dirY: number,
  minU: number,
  maxU: number,
  minV: number,
  maxV: number,
): [number, number] {
  const corners: Array<readonly [number, number]> = [
    [minU, minV],
    [maxU, minV],
    [minU, maxV],
    [maxU, maxV],
  ];
  let mn = Infinity;
  let mx = -Infinity;
  for (const [x, y] of corners) {
    const p = dirX * x + dirY * y;
    mn = Math.min(mn, p);
    mx = Math.max(mx, p);
  }
  return [mn, mx];
}

/**
 * Scale factor for GSAP wipe motion so the projection sweep across the *visible* crop
 * matches the WebGL effect-UV mapping (unit square in crop space).
 */
export function wipeDomVectorScaleForCropDeg(angleDeg: number, crop: EffectCropUv): number {
  const rad = (angleDeg * Math.PI) / 180;
  const dx = Math.cos(rad);
  const dy = Math.sin(rad);
  const [cmin, cmax] = projExtremaOnUvRect(dx, dy, crop.minU, crop.maxU, crop.minV, crop.maxV);
  const [fmin, fmax] = projExtremaOnUvRect(dx, dy, 0, 1, 0, 1);
  const spanC = Math.max(cmax - cmin, 1e-6);
  const spanF = Math.max(fmax - fmin, 1e-6);
  return Math.min(spanF / spanC, 16);
}
