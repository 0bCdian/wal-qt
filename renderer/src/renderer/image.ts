import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";

import { logger } from "./logger";
import { resolveAssetUrl } from "./urlUtils";
import { logWebglWorkerCapabilityOnce } from "./webglWorkerProbe";
import { dom, state } from "./state";
import type { EffectCropUv } from "./transition/effectCrop";
import {
  identityEffectCropUv,
  resolveLiveTransitionEffectCropUv,
  wipeDomVectorScaleForCropDeg,
} from "./transition/effectCrop";
import { resolveTransitionIntent, type TransitionIntent } from "./transition/intent";
import { runFadeLayerCrossfade } from "./transition/fadeLayer";
import { resolveOrthogonalFadeIntent } from "./transition/orthogonalFade";
import type {
  ImageFitMode,
  ImageRenderingMode,
  LoadRequest,
  TransitionExecutionMeta,
  TransitionEngine,
} from "./types";

import {
  naturalSizeInBackingPixels,
  objectFitKindForLayer,
  WEBGL_OBJECT_FIT_FILL,
} from "./webglObjectFit";
import {
  clampUniformMaxEdge,
  isPow2Positive,
  textureBitmapSizeForPresentation,
} from "./webglTextureSizing";
import { type ImageQualityFlags, readImageQualityFlags } from "./imageQualityFlags";
import {
  buildSamplerHelperGlsl,
  kernelNeedsHighPrecisionShader,
  SAMPLER_FUNCTION_NAME,
  type SamplerKernel,
} from "./webglSamplerShaders";
import { cpuLanczosUpscaleTargetSize } from "./webglTextureUpscale";
import { FXAA_FRAGMENT_SOURCE, FXAA_VERTEX_SOURCE } from "./webglFxaaShader";
import { stripOesStandardDerivativesExtensionLineForWebGL2 } from "./webglStandardDerivatives";

/** Per-texture GPU upload path (`texImage2D` internal format / unpack). */
type WebGlTextureUploadHints = {
  /**
   * true: DOM/display-encoded RGB (decoded images, base-color canvas).
   * false: framebuffer-linear snapshot (`createImageBitmap(webgl_canvas)` handoff).
   */
  displayEncoded: boolean;
  /** Set `UNPACK_PREMULTIPLY_ALPHA_WEBGL` for formats that commonly use straight-alpha. */
  premultiplyUnpack: boolean;
};

/** DOM-layer transition drivers (anything that is not WebGL/`none`/reserved `vta`). */
type DomCompositorTransitionEngine = Exclude<TransitionEngine, "none" | "vta" | "webgl">;

gsap.registerPlugin(CustomEase);
// Avoid GSAP bunching tween ticks after delayed frames; reduces visible stutter on transitions.
gsap.ticker.lagSmoothing(0);
// GSAP’s ticker uses requestAnimationFrame by default (no fixed 60fps cap in our code). blur_through
// still animates filter on <img> layers — heavier than the WebGL canvas path.

const MIN_IMAGE_TRANSITION_MS = 1;
const MIN_END_TIMEOUT_MS = 1200;
const END_TIMEOUT_BUFFER_MS = 900;

/** `data-*` URL from `URL.createObjectURL` for handoff paint; revoked when the layer is reassigned. */
const WALLPAPER_IMG_BLOB_URL_ATTR = "data-waypaper-blob-url";

const PERF_DEBUG = import.meta.env.DEV;

let perfNonce = 0;

/** Returns a unique mark id for `perfMeasure`, or `""` when profiling is off. */
function perfMark(name: string): string {
  if (!PERF_DEBUG) return "";
  const id = `${name}_${++perfNonce}`;
  performance.mark(`wp:${id}`);
  return id;
}

function perfMeasure(label: string, startId: string, endId: string): void {
  if (!PERF_DEBUG || !startId || !endId) return;
  try {
    performance.measure(`wp:${label}`, `wp:${startId}`, `wp:${endId}`);
  } catch {
    /* missing marks */
  }
}

type WebGlTextureSource = ImageBitmap;

type WebGlEffectSetup = (
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  params: {
    canvasWidth: number;
    canvasHeight: number;
    fromSize: { width: number; height: number };
    toSize: { width: number; height: number };
  },
) => void;

function killWallpaperAnimationTargets(): void {
  if (dom.activeLayer) gsap.killTweensOf(dom.activeLayer);
  if (dom.incomingLayer) gsap.killTweensOf(dom.incomingLayer);
  if (dom.webglCanvas) gsap.killTweensOf(dom.webglCanvas);
}

function computeRendererGuardTimeoutMs(durationMs: number): number {
  return Math.max(durationMs + END_TIMEOUT_BUFFER_MS, MIN_END_TIMEOUT_MS);
}

function createIntentEase(intent: TransitionIntent, idSuffix: string): string {
  const [x1, y1, x2, y2] = intent.bezier;
  const name = `wp_ease_${idSuffix}`;
  CustomEase.create(name, `M0,0 C${x1} ${y1} ${x2} ${y2} 1,1`);
  return name;
}

function wipeVectorPercent(
  angleDeg: number,
  outgoing: boolean,
  magnitude: number,
): { x: number; y: number } {
  const radians = (angleDeg * Math.PI) / 180;
  const directionX = Math.cos(radians);
  const directionY = Math.sin(radians);
  const sign = outgoing ? -1 : 1;
  return {
    x: directionX * magnitude * 100 * sign,
    y: directionY * magnitude * 100 * sign,
  };
}

function clearLayerAnimationProps(layer: HTMLImageElement): void {
  gsap.killTweensOf(layer);
  layer.style.removeProperty("transform");
  layer.style.removeProperty("filter");
  layer.style.removeProperty("opacity");
  layer.style.removeProperty("transition");
  layer.style.removeProperty("z-index");
  layer.style.removeProperty("will-change");
}

/** Clear inline animation props from any layer used in cross-kind fades (&lt;video&gt;, etc.). */
function clearHTMLElementAnimationProps(el: HTMLElement): void {
  gsap.killTweensOf(el);
  el.style.removeProperty("transform");
  el.style.removeProperty("filter");
  el.style.removeProperty("opacity");
  el.style.removeProperty("transition");
  el.style.removeProperty("z-index");
  el.style.removeProperty("will-change");
}

function normalizeTarget(target: string): string {
  return resolveAssetUrl(target);
}

function resolveImageFitMode(req: LoadRequest): ImageFitMode {
  return req.image_fit_mode ?? "cover";
}

function resolveImageRendering(req: LoadRequest): ImageRenderingMode {
  return req.image_rendering ?? "auto";
}

function applyImagePresentationStyles(
  fitMode: ImageFitMode,
  imageRendering: ImageRenderingMode,
): void {
  if (dom.activeLayer) {
    dom.activeLayer.style.objectFit = fitMode;
    dom.activeLayer.style.imageRendering = imageRendering;
  }
  if (dom.incomingLayer) {
    dom.incomingLayer.style.objectFit = fitMode;
    dom.incomingLayer.style.imageRendering = imageRendering;
  }
}

/** Apply CSS presentation from host (settings sync) without a full load; keeps noop state aligned. */
export function applyHostImagePresentation(
  fitMode: ImageFitMode,
  imageRendering: ImageRenderingMode,
): void {
  applyImagePresentationStyles(fitMode, imageRendering);
  if (state.activeKind === "image") {
    state.activeImageFitMode = fitMode;
    state.activeImageRendering = imageRendering;
  }
}

/** Best-effort 2D smoothing for any `drawImage` / scale path (JPEG/WebP handoff, color reads). */
function applyHighQualityCanvas2DImageSampling(ctx: CanvasRenderingContext2D): void {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
}

/** Normalize sRGB / display-referenced primary value in [0,1] into linear RGB for shaders. */
function srgbPrimaryToLinear(primary: number): number {
  if (primary <= 0.04045) return primary / 12.92;
  return ((primary + 0.055) / 1.055) ** 2.4;
}

/** Sample `--wallpaper-base-color` via 2D canvas (normalized sRGB primary, not linear-light). */
function wallpaperBaseColorSrgbSampleRgb(): [number, number, number] {
  const color =
    getComputedStyle(document.documentElement).getPropertyValue("--wallpaper-base-color").trim() ||
    "#000000";
  const c = document.createElement("canvas");
  c.width = 1;
  c.height = 1;
  const ctx = c.getContext("2d");
  if (!ctx) {
    return [0, 0, 0];
  }
  applyHighQualityCanvas2DImageSampling(ctx);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}

/** Letterbox uniform: WebGL2 + sRGB textures need linear-light RGB to match decoded samples. */
function letterboxRgbForWebGlShader(gl: WebGLRenderingContext): [number, number, number] {
  const [r, g, b] = wallpaperBaseColorSrgbSampleRgb();
  if (!(gl instanceof WebGL2RenderingContext)) {
    return [r, g, b];
  }
  return [srgbPrimaryToLinear(r), srgbPrimaryToLinear(g), srgbPrimaryToLinear(b)];
}

async function createBaseColorTextureSource(): Promise<WebGlTextureSource> {
  const color =
    getComputedStyle(document.documentElement).getPropertyValue("--wallpaper-base-color").trim() ||
    "#000000";
  const offscreen = document.createElement("canvas");
  offscreen.width = 1;
  offscreen.height = 1;
  const ctx = offscreen.getContext("2d");
  if (!ctx) throw new Error("failed to create 2d context for base color texture");
  applyHighQualityCanvas2DImageSampling(ctx);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  return createImageBitmap(offscreen);
}

/** Throws `DOMException` with name `AbortError` when a newer load superseded this one. */
export type LoadStaleCheck = () => void;

type WebglTextureCacheEntry = {
  bitmap: ImageBitmap;
  target: string;
  capW: number;
  capH: number;
  imageFitMode: ImageFitMode;
  layoutW: number;
  layoutH: number;
  /** Mode B (`cpu-lanczos`) produces a different bitmap than Mode A (`gpu`) for the same source. */
  upscaleMode: ImageQualityFlags["upscale"];
};

let webglTextureCache: WebglTextureCacheEntry | null = null;

/**
 * Cached `gl.MAX_TEXTURE_SIZE` from the first WebGL context. Updated in `runWebGlTransition`
 * after `ensureWebglShared`. 16384 is a safe conservative default for all modern WebGL 1 devices.
 * Texture prep runs before GL init so the first transition uses this default; subsequent
 * transitions use the real hardware limit.
 */
let cachedMaxTextureSize = 16384;

/** Frozen frame when a WebGL transition is superseded mid-flight; next transition uses this as `from`. */
let transitionHandoffBitmap: ImageBitmap | null = null;

function releaseTransitionHandoffBitmap(): void {
  transitionHandoffBitmap?.close();
  transitionHandoffBitmap = null;
}

async function stashWebglFrameAsHandoff(canvas: HTMLCanvasElement): Promise<void> {
  try {
    transitionHandoffBitmap?.close();
    transitionHandoffBitmap = await createImageBitmap(canvas);
  } catch {
    transitionHandoffBitmap = null;
  }
}

function revokeWallpaperImgBlobUrl(img: HTMLImageElement | null | undefined): void {
  if (!img) return;
  const u = img.getAttribute(WALLPAPER_IMG_BLOB_URL_ATTR);
  if (u) {
    URL.revokeObjectURL(u);
    img.removeAttribute(WALLPAPER_IMG_BLOB_URL_ATTR);
  }
}

/** Async WebP (falling back to JPEG) blob + object URL — avoids sync PNG on the main thread. */
async function paintBitmapToImgElement(img: HTMLImageElement, bitmap: ImageBitmap): Promise<void> {
  revokeWallpaperImgBlobUrl(img);
  const c = document.createElement("canvas");
  c.width = bitmap.width;
  c.height = bitmap.height;
  const ctx = c.getContext("2d");
  if (!ctx) {
    return;
  }
  applyHighQualityCanvas2DImageSampling(ctx);
  ctx.drawImage(bitmap, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => {
    c.toBlob(
      (b) => {
        if (b) {
          resolve(b);
          return;
        }
        c.toBlob((b2) => resolve(b2), "image/jpeg", 0.95);
      },
      "image/webp",
      0.95,
    );
  });
  if (!blob) {
    img.src = c.toDataURL("image/png");
    return;
  }
  const url = URL.createObjectURL(blob);
  img.setAttribute(WALLPAPER_IMG_BLOB_URL_ATTR, url);
  img.src = url;
}

function clearWebglTextureCache(): void {
  if (webglTextureCache) {
    webglTextureCache.bitmap.close();
    webglTextureCache = null;
  }
}

function promoteToWebglTextureCache(
  target: string,
  bitmap: ImageBitmap,
  capW: number,
  capH: number,
  imageFitMode: ImageFitMode,
  layoutW: number,
  layoutH: number,
  upscaleMode: ImageQualityFlags["upscale"],
): void {
  clearWebglTextureCache();
  webglTextureCache = {
    bitmap,
    target,
    capW,
    capH,
    imageFitMode,
    layoutW,
    layoutH,
    upscaleMode,
  };
}

/** Prefer alpha-unpack premultiply for codecs that commonly carry straight-alpha PNG/WebP/APNG/GIF paths. */
function inferPremultiplyUnpackFromTargetUrl(target: string): boolean {
  const base = target.split(/[?#]/)[0] ?? target;
  return /\.(?:png|apng|webp|gif)$/i.test(base);
}

/**
 * Full layout × devicePixelRatio backing for WebGL transition canvas and texture prep.
 * Skips `WAYPAPER_WEBGL_SCALE` downsampling intended for constrained WebKit-class engines;
 * Chromium / Qt WebEngine uses native-res transition buffers.
 */
function cssRectToSharpTransitionBackingDimensions(rectW: number, rectH: number): [number, number] {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rectW * dpr));
  const height = Math.max(1, Math.round(rectH * dpr));
  return [width, height];
}

/**
 * CSS layout size for the WebGL canvas in px. When the canvas is `opacity:0` or not yet painted,
 * `getBoundingClientRect()` can be 0×0 — fall back to `.wallpaper-root` so backing-store math matches
 * the real viewport.
 */
function webGlTransitionLayoutRect(canvas: HTMLCanvasElement): { width: number; height: number } {
  const r = canvas.getBoundingClientRect();
  if (r.width >= 1 && r.height >= 1) {
    return { width: r.width, height: r.height };
  }
  const root = canvas.closest(".wallpaper-root");
  if (root) {
    const rr = root.getBoundingClientRect();
    if (rr.width >= 1 && rr.height >= 1) {
      return { width: rr.width, height: rr.height };
    }
  }
  return { width: Math.max(1, r.width), height: Math.max(1, r.height) };
}

/**
 * Resize canvas backing store + GL viewport to match current layout × DPR.
 * Updates `u_canvas_size` and effect uniforms. Returns true if dimensions changed.
 */
function resizeWebGlTransitionCanvasIfNeeded(
  canvas: HTMLCanvasElement,
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  setupEffect: WebGlEffectSetup,
  fromSize: { width: number; height: number },
  toSize: { width: number; height: number },
  bindPresentation?: () => void,
): boolean {
  const layout = webGlTransitionLayoutRect(canvas);
  const [w, h] = cssRectToSharpTransitionBackingDimensions(layout.width, layout.height);
  if (canvas.width === w && canvas.height === h) {
    return false;
  }
  canvas.width = w;
  canvas.height = h;
  gl.viewport(0, 0, w, h);
  gl.useProgram(program);
  const uCanvas = gl.getUniformLocation(program, "u_canvas_size");
  if (uCanvas) {
    gl.uniform2f(uCanvas, w, h);
  }
  setupEffect(gl, program, {
    canvasWidth: w,
    canvasHeight: h,
    fromSize,
    toSize,
  });
  bindPresentation?.();
  return true;
}

type WebGlPresentationParams = {
  imageFitMode: ImageFitMode;
  fromWasHandoff: boolean;
  fromNaturalCss: { w: number; h: number };
  toNaturalCss: { w: number; h: number };
  /** Visible root∩canvas as normalized canvas UV bounds; remap effect geometry when parallax zooms. */
  effectCropUv: EffectCropUv;
};

function bindWebGlPresentationUniforms(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  canvas: HTMLCanvasElement,
  fromSize: { width: number; height: number },
  params: WebGlPresentationParams,
): void {
  const layout = webGlTransitionLayoutRect(canvas);
  const lw = layout.width;
  const lh = layout.height;
  const bw = canvas.width;
  const bh = canvas.height;
  const [r, g, b] = letterboxRgbForWebGlShader(gl);

  let fromFit: number;
  let fromNatBacking = naturalSizeInBackingPixels(
    params.fromNaturalCss.w,
    params.fromNaturalCss.h,
    bw,
    bh,
    lw,
    lh,
  );
  const toNatBacking = naturalSizeInBackingPixels(
    params.toNaturalCss.w,
    params.toNaturalCss.h,
    bw,
    bh,
    lw,
    lh,
  );

  if (params.fromWasHandoff) {
    fromFit = WEBGL_OBJECT_FIT_FILL;
    fromNatBacking = { x: fromSize.width, y: fromSize.height };
  } else {
    fromFit = objectFitKindForLayer(
      params.imageFitMode,
      params.fromNaturalCss.w,
      params.fromNaturalCss.h,
      lw,
      lh,
    );
  }

  const toFit = objectFitKindForLayer(
    params.imageFitMode,
    params.toNaturalCss.w,
    params.toNaturalCss.h,
    lw,
    lh,
  );

  const uFromFit = gl.getUniformLocation(program, "u_from_object_fit");
  const uToFit = gl.getUniformLocation(program, "u_to_object_fit");
  const uLb = gl.getUniformLocation(program, "u_letterbox_color");
  const uFromNat = gl.getUniformLocation(program, "u_from_natural_size");
  const uToNat = gl.getUniformLocation(program, "u_to_natural_size");
  if (uFromFit) gl.uniform1f(uFromFit, fromFit);
  if (uToFit) gl.uniform1f(uToFit, toFit);
  if (uLb) gl.uniform3f(uLb, r, g, b);
  if (uFromNat) gl.uniform2f(uFromNat, fromNatBacking.x, fromNatBacking.y);
  if (uToNat) gl.uniform2f(uToNat, toNatBacking.x, toNatBacking.y);
  const uCropRect = gl.getUniformLocation(program, "u_crop_uv_rect");
  if (uCropRect) {
    const e = params.effectCropUv;
    gl.uniform4f(uCropRect, e.minU, e.minV, e.maxU, e.maxV);
  }
}

function snapshotTransitionEffectCropUv(): EffectCropUv {
  if (!dom.webglCanvas) {
    return identityEffectCropUv();
  }
  return resolveLiveTransitionEffectCropUv(dom.webglCanvas, dom.rootEl);
}

/** Layout (CSS px) and backing pixel size for WebGL texture prep and cache keys. */
function computeWebGlTexturePrepLayoutCap(): {
  layoutW: number;
  layoutH: number;
  capW: number;
  capH: number;
} {
  const canvas = dom.webglCanvas;
  if (!canvas) {
    const [capW, capH] = cssRectToSharpTransitionBackingDimensions(1920, 1080);
    return { layoutW: 1920, layoutH: 1080, capW, capH };
  }
  const layout = webGlTransitionLayoutRect(canvas);
  const [capW, capH] = cssRectToSharpTransitionBackingDimensions(layout.width, layout.height);
  return { layoutW: layout.width, layoutH: layout.height, capW, capH };
}

/** WebKit rejects texImage2D from `<img>` for some schemes (e.g. asset://). */
function canUseDecodedImageForWebGl(src: string): boolean {
  if (/^asset:\/\//i.test(src)) {
    return false;
  }
  try {
    const u = new URL(src, location.href);
    return u.origin === location.origin;
  } catch {
    return true;
  }
}

/**
 * Decide the bitmap target size for the WebGL texture given source dims, cap,
 * fit, and the active upscale mode (Mode B).
 *
 * - Mode B (`cpu-lanczos`) on `cover` / `fill`: target = ratio-preserved cap
 *   coverage, even if that means upscaling the source. The browser's
 *   `createImageBitmap({resizeQuality:"high"})` does Lanczos in Chromium /
 *   Qt WebEngine, matching `<img>` perceptual quality on hard edges.
 * - Otherwise (or on `contain` / `none` / `scale-down` where upscaling is
 *   wasteful or harmful): fall through to the existing
 *   `textureBitmapSizeForPresentation` (never upscales beyond source).
 */
function decideWebGlTextureBitmapSize(
  flags: ImageQualityFlags | null,
  srcW: number,
  srcH: number,
  capW: number,
  capH: number,
  layoutWCss: number,
  layoutHCss: number,
  imageFitMode: ImageFitMode,
): { w: number; h: number } {
  if (flags?.upscale === "cpu-lanczos" && (imageFitMode === "cover" || imageFitMode === "fill")) {
    const upscale = cpuLanczosUpscaleTargetSize(
      "cpu-lanczos",
      srcW,
      srcH,
      capW,
      capH,
      cachedMaxTextureSize,
    );
    if (upscale) return upscale;
  }
  const unclamped = textureBitmapSizeForPresentation(
    imageFitMode,
    srcW,
    srcH,
    capW,
    capH,
    layoutWCss,
    layoutHCss,
  );
  return clampUniformMaxEdge(unclamped.w, unclamped.h, cachedMaxTextureSize);
}

async function bitmapFromImageElement(
  img: HTMLImageElement,
  capW: number,
  capH: number,
  layoutWCss: number,
  layoutHCss: number,
  imageFitMode: ImageFitMode,
  qualityFlags: ImageQualityFlags | null,
  checkNotStale?: LoadStaleCheck,
): Promise<WebGlTextureSource> {
  checkNotStale?.();
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  if (iw <= 0 || ih <= 0) {
    throw new Error("webgl texture: image element has no pixels");
  }
  const { w: tw, h: th } = decideWebGlTextureBitmapSize(
    qualityFlags,
    iw,
    ih,
    capW,
    capH,
    layoutWCss,
    layoutHCss,
    imageFitMode,
  );
  if (iw === tw && ih === th) {
    return createImageBitmap(img);
  }
  checkNotStale?.();
  const scaled = await createImageBitmap(img, {
    resizeWidth: tw,
    resizeHeight: th,
    resizeQuality: "high",
  });
  if (scaled.width <= 0 || scaled.height <= 0) {
    scaled.close();
    throw new Error("webgl texture resize produced no pixels");
  }
  return scaled;
}

/**
 * Prefer a single decode via the already-loaded `<img>` when same-origin; otherwise fetch+blob
 * (required for asset:// and cross-origin URLs in WebKit).
 */
async function prepareWebGlTextureSourcePreferDecoded(
  src: string,
  capW: number,
  capH: number,
  layoutWCss: number,
  layoutHCss: number,
  imageFitMode: ImageFitMode,
  decodedImg: HTMLImageElement | null | undefined,
  qualityFlags: ImageQualityFlags | null,
  checkNotStale?: LoadStaleCheck,
): Promise<WebGlTextureSource> {
  const normalized = normalizeTarget(src);
  if (decodedImg?.complete && decodedImg.naturalWidth > 0) {
    const imgSrc = decodedImg.currentSrc || decodedImg.src;
    if (normalizeTarget(imgSrc) === normalized && canUseDecodedImageForWebGl(imgSrc)) {
      try {
        return await bitmapFromImageElement(
          decodedImg,
          capW,
          capH,
          layoutWCss,
          layoutHCss,
          imageFitMode,
          qualityFlags,
          checkNotStale,
        );
      } catch (err) {
        logger.debug("webgl texture fast path from img failed; using fetch", {
          src: normalized,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }
  return prepareWebGlTextureSource(
    src,
    capW,
    capH,
    layoutWCss,
    layoutHCss,
    imageFitMode,
    qualityFlags,
    checkNotStale,
  );
}

async function prepareWebGlTextureSource(
  src: string,
  capW: number,
  capH: number,
  layoutWCss: number,
  layoutHCss: number,
  imageFitMode: ImageFitMode,
  qualityFlags: ImageQualityFlags | null,
  checkNotStale?: LoadStaleCheck,
): Promise<WebGlTextureSource> {
  // asset:// is a different scheme from tauri:// (the document origin).
  // WebKit blocks texImage2D with HTMLImageElement loaded from asset:// as cross-origin
  // ("The operation is insecure"). Fetch as Blob, then decode via createImageBitmap so
  // decode can run off the main thread and texImage2D uploads stay cheap.
  checkNotStale?.();
  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`webgl texture fetch failed: ${response.status} ${src}`);
  }
  const blob = await response.blob();
  checkNotStale?.();
  const decoded = await createImageBitmap(blob);
  if (decoded.width <= 0 || decoded.height <= 0) {
    decoded.close();
    throw new Error(`webgl texture has no pixels: ${src}`);
  }
  checkNotStale?.();
  const { w: tw, h: th } = decideWebGlTextureBitmapSize(
    qualityFlags,
    decoded.width,
    decoded.height,
    capW,
    capH,
    layoutWCss,
    layoutHCss,
    imageFitMode,
  );
  if (decoded.width === tw && decoded.height === th) {
    return decoded;
  }
  let scaled: ImageBitmap;
  try {
    scaled = await createImageBitmap(decoded, {
      resizeWidth: tw,
      resizeHeight: th,
      resizeQuality: "high",
    });
  } finally {
    decoded.close();
  }
  if (scaled.width <= 0 || scaled.height <= 0) {
    scaled.close();
    throw new Error(`webgl texture resize produced no pixels: ${src}`);
  }
  return scaled;
}

function releaseWebGlTextureSource(source: WebGlTextureSource | null): void {
  source?.close();
}

function sourceDimensions(source: WebGlTextureSource): { width: number; height: number } {
  return { width: source.width, height: source.height };
}

function runGsapLayerTransition(
  intent: TransitionIntent,
  incoming: HTMLImageElement,
  outgoing: HTMLImageElement,
  easeSuffix: string,
  effectCropUv: EffectCropUv,
): Promise<DomCompositorTransitionEngine> {
  const { effect } = intent;
  const guardMs = computeRendererGuardTimeoutMs(intent.durationMs);

  if (effect === "fade") {
    return runFadeLayerCrossfade(intent, incoming, outgoing).then((b) =>
      b === "waapi" ? "waapi" : "css_fallback",
    );
  }

  return new Promise((resolve, reject) => {
    const ease = createIntentEase(intent, easeSuffix);
    const d = intent.durationMs / 1000;

    const guard = window.setTimeout(() => {
      gsap.killTweensOf([incoming, outgoing]);
      reject(new Error(`gsap transition timeout after ${guardMs}ms`));
    }, guardMs);

    const done = () => {
      window.clearTimeout(guard);
      resolve("gsap");
    };

    gsap.set([incoming, outgoing], { zIndex: 2 });

    switch (effect) {
      case "wipe": {
        const wipeMag = 1.05 * wipeDomVectorScaleForCropDeg(intent.wipeAngleDeg, effectCropUv);
        const inStart = wipeVectorPercent(intent.wipeAngleDeg, false, wipeMag);
        const outEnd = wipeVectorPercent(intent.wipeAngleDeg, true, wipeMag);
        const tl = gsap.timeline({ onComplete: done });
        tl.fromTo(
          incoming,
          { xPercent: inStart.x, yPercent: inStart.y, opacity: 1 },
          { xPercent: 0, yPercent: 0, duration: d, ease, overwrite: "auto" },
          0,
        );
        tl.fromTo(
          outgoing,
          { xPercent: 0, yPercent: 0, opacity: 1 },
          { xPercent: outEnd.x, yPercent: outEnd.y, duration: d, ease, overwrite: "auto" },
          0,
        );
        break;
      }
      case "blur_through": {
        const blurPx = intent.blurRadiusPx;
        const tl = gsap.timeline({ onComplete: done });
        tl.fromTo(
          outgoing,
          { filter: "blur(0px)", opacity: 1 },
          { filter: `blur(${blurPx}px)`, opacity: 0, duration: d, ease, overwrite: "auto" },
          0,
        );
        tl.fromTo(
          incoming,
          { filter: `blur(${blurPx}px)`, opacity: 0 },
          { filter: "blur(0px)", opacity: 1, duration: d, ease, overwrite: "auto" },
          0,
        );
        break;
      }
      default:
        window.clearTimeout(guard);
        reject(new Error(`unexpected effect for gsap layer transition: ${String(effect)}`));
    }
  });
}

function createShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("failed to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "unknown shader compile error";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

const WEBGL_TRANSITION_VERTEX_SOURCE = `
attribute vec2 a_position;
varying highp vec2 v_uv;
void main() {
  vec2 uv = (a_position + 1.0) * 0.5;
  v_uv = vec2(uv.x, 1.0 - uv.y);
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

type WebglLinkedProgram = {
  program: WebGLProgram;
  vertexShader: WebGLShader;
  fragmentShader: WebGLShader;
};

type WebglAnisotropicExt = {
  TEXTURE_MAX_ANISOTROPY_EXT: GLenum;
  MAX_TEXTURE_MAX_ANISOTROPY_EXT: GLenum;
};

type WebglFxaaResources = {
  program: WebglLinkedProgram;
  fbo: WebGLFramebuffer;
  tex: WebGLTexture;
  texW: number;
  texH: number;
  uTex: WebGLUniformLocation | null;
  uInvTexSize: WebGLUniformLocation | null;
  aPosition: number;
};

type WebglSharedState = {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  quadBuffer: WebGLBuffer;
  programCache: Map<string, WebglLinkedProgram>;
  /**
   * True only after a one-time link probe with an `fwidth` fragment that matches how we compile
   * FWIDTH transition shaders on this context: WebGL1 uses `#extension GL_OES_standard_derivatives`,
   * WebGL2 omits it (derivatives are core for GLSL ES 1.00 fragments on WebGL2).
   */
  transitionFwidthSupported: boolean;
  /** `EXT_texture_filter_anisotropic` when supported; mipmapped transitions use clamped tex anisotropy. */
  anisotropicExt: WebglAnisotropicExt | null;
  texMaxAnisotropy: number;
  /** Lazily allocated when Mode E (FXAA post pass) is enabled for a transition. */
  fxaa: WebglFxaaResources | null;
};

let webglShared: WebglSharedState | null = null;

/**
 * When a superseded WebGL transition keeps the canvas visible until the handoff is painted
 * onto `<img>`, `finally` must not delete the transition textures first — the canvas would
 * briefly composite with deleted bindings. Dispose after restore hides the canvas.
 */
let deferredWebglTransitionTextureDisposal: {
  gl: WebGLRenderingContext;
  from: WebGLTexture | null;
  to: WebGLTexture | null;
} | null = null;

function flushDeferredWebglTransitionTextureDisposal(): void {
  const d = deferredWebglTransitionTextureDisposal;
  if (!d) return;
  if (d.from) d.gl.deleteTexture(d.from);
  if (d.to) d.gl.deleteTexture(d.to);
  deferredWebglTransitionTextureDisposal = null;
}

function disposeFxaaResources(gl: WebGLRenderingContext): void {
  if (!webglShared || !webglShared.fxaa) return;
  const r = webglShared.fxaa;
  gl.deleteFramebuffer(r.fbo);
  gl.deleteTexture(r.tex);
  gl.deleteProgram(r.program.program);
  gl.deleteShader(r.program.vertexShader);
  gl.deleteShader(r.program.fragmentShader);
  webglShared.fxaa = null;
}

/**
 * Mirrors how we compile FWIDTH transition shaders: WebGL2 must **not** use the OES extension
 * directive (ANGLE/Qt WebEngine warns "not supported" and `fwidth` can fail to resolve).
 */
function probeTransitionFwidthShaderLink(gl: WebGLRenderingContext): boolean {
  const vsSource = `attribute vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }`;
  const fsHead =
    gl instanceof WebGL2RenderingContext ? "" : "#extension GL_OES_standard_derivatives : enable\n";
  const fsSource = `${fsHead}precision mediump float;
void main() {
  gl_FragColor = vec4(fwidth(gl_FragCoord.x), 0.0, 0.0, 1.0);
}`;
  const vs = gl.createShader(gl.VERTEX_SHADER);
  const fs = gl.createShader(gl.FRAGMENT_SHADER);
  if (!vs || !fs) return false;
  gl.shaderSource(vs, vsSource);
  gl.shaderSource(fs, fsSource);
  gl.compileShader(vs);
  gl.compileShader(fs);
  if (
    !gl.getShaderParameter(vs, gl.COMPILE_STATUS) ||
    !gl.getShaderParameter(fs, gl.COMPILE_STATUS)
  ) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return false;
  }
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    return false;
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  const ok = !!gl.getProgramParameter(program, gl.LINK_STATUS);
  gl.deleteProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return ok;
}

function disposeWebglShared(): void {
  if (!webglShared) return;
  flushDeferredWebglTransitionTextureDisposal();
  const { gl, programCache, quadBuffer } = webglShared;
  disposeFxaaResources(gl);
  for (const { program, vertexShader: vs, fragmentShader: fs } of programCache.values()) {
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
  }
  programCache.clear();
  gl.deleteBuffer(quadBuffer);
  webglShared = null;
}

/**
 * Lazily create or resize the FXAA color-attached FBO + program (Mode E in
 * `docs/IMAGE_QUALITY_FLAGS.md`). The transition shader renders into this FBO
 * and the FXAA pass samples it back to the default framebuffer.
 *
 * The color attachment uses plain `RGBA / UNSIGNED_BYTE` for portability with
 * WebGL1 — Mode E is correct enough for visible aliasing cleanup but does not
 * try to be color-managed (sRGB-aware FXAA is out of scope; see Mode A for
 * the high-quality kernel that runs in linear-light when WebGL2-sRGB is on).
 */
function ensureFxaaResources(
  gl: WebGLRenderingContext,
  width: number,
  height: number,
): WebglFxaaResources {
  if (!webglShared) throw new Error("webgl shared state missing");
  const existing = webglShared.fxaa;
  if (existing && existing.texW === width && existing.texH === height) {
    return existing;
  }
  if (existing) {
    disposeFxaaResources(gl);
  }
  const tex = gl.createTexture();
  if (!tex) throw new Error("FXAA: failed to create color attachment texture");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer();
  if (!fbo) {
    gl.deleteTexture(tex);
    throw new Error("FXAA: failed to create framebuffer");
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const fboStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (fboStatus !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error(`FXAA: framebuffer incomplete (status=0x${fboStatus.toString(16)})`);
  }

  // Compile the FXAA program (separate from the transition program cache —
  // there is exactly one FXAA program per shared state).
  const vs = createShader(gl, gl.VERTEX_SHADER, FXAA_VERTEX_SOURCE);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, FXAA_FRAGMENT_SOURCE);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error("FXAA: failed to create program");
  }
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "FXAA: unknown program link error";
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.deleteFramebuffer(fbo);
    gl.deleteTexture(tex);
    throw new Error(log);
  }
  const linked: WebglLinkedProgram = { program, vertexShader: vs, fragmentShader: fs };
  const uTex = gl.getUniformLocation(program, "u_tex");
  const uInvTexSize = gl.getUniformLocation(program, "u_inv_tex_size");
  const aPosition = gl.getAttribLocation(program, "a_position");

  const resources: WebglFxaaResources = {
    program: linked,
    fbo,
    tex,
    texW: width,
    texH: height,
    uTex,
    uInvTexSize,
    aPosition,
  };
  webglShared.fxaa = resources;
  return resources;
}

/**
 * Drops the shared WebGL transition context and shrinks the backing canvas so the
 * compositor/driver can reclaim GPU memory until the next WebGL-backed transition.
 */
export function releaseWallpaperWebGlForIdle(): void {
  disposeWebglShared();
  const c = dom.webglCanvas;
  if (c) {
    c.width = 1;
    c.height = 1;
  }
}

function getOrCreateLinkedProgram(
  gl: WebGLRenderingContext,
  fragmentGlsl: string,
): WebglLinkedProgram {
  if (!webglShared) {
    throw new Error("webgl shared state missing");
  }
  const cache = webglShared.programCache;
  const hit = cache.get(fragmentGlsl);
  if (hit) {
    return hit;
  }

  const vertexShader = createShader(gl, gl.VERTEX_SHADER, WEBGL_TRANSITION_VERTEX_SOURCE);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentGlsl);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("failed to create WebGL program");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "unknown program link error";
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error(log);
  }
  const entry: WebglLinkedProgram = { program, vertexShader, fragmentShader };
  cache.set(fragmentGlsl, entry);
  return entry;
}

function ensureWebglShared(
  canvas: HTMLCanvasElement,
  ctxAttrs: WebGLContextAttributes,
): WebGLRenderingContext {
  if (webglShared && webglShared.canvas !== canvas) {
    disposeWebglShared();
  }
  const gl2 = canvas.getContext("webgl2", ctxAttrs) as WebGL2RenderingContext | null;
  const gl =
    gl2 ??
    (canvas.getContext("webgl", ctxAttrs) as WebGLRenderingContext | null) ??
    (canvas.getContext("experimental-webgl", ctxAttrs) as WebGLRenderingContext | null);
  if (!gl) {
    throw new Error("webgl transition unavailable: failed to initialize WebGL context");
  }
  if (!webglShared) {
    const quadBuffer = gl.createBuffer();
    if (!quadBuffer) {
      throw new Error("failed to create WebGL position buffer");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    let anisoExt: WebglAnisotropicExt | null = null;
    let texMaxAnisotropy = 0;
    const anisoProbe = gl.getExtension(
      "EXT_texture_filter_anisotropic",
    ) as WebglAnisotropicExt | null;
    if (anisoProbe) {
      anisoExt = anisoProbe;
      const hwMax = gl.getParameter(anisoProbe.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number;
      if (hwMax > 0 && Number.isFinite(hwMax)) {
        texMaxAnisotropy = Math.min(16, hwMax);
      }
    }
    webglShared = {
      canvas,
      gl,
      quadBuffer,
      programCache: new Map(),
      transitionFwidthSupported: probeTransitionFwidthShaderLink(gl),
      anisotropicExt: anisoExt,
      texMaxAnisotropy,
      fxaa: null,
    };
    canvas.addEventListener(
      "webglcontextlost",
      (e) => {
        e.preventDefault();
        disposeWebglShared();
      },
      false,
    );
  }
  return gl;
}

/**
 * GPU-composited transitions (fade / wipe / grow / outer / wave). Notes for Qt WebEngine QA:
 * – Ultrawide + `contain` + line-art PNG: letterbox seams and canvas-vs-`<img>` parity.
 * – Wipes at high DPR: transition mask AA (legacy vs fwidth shaders).
 * – Superseded loads: framebuffer handoff snapshots use linear RGBA textures vs sRGB uploads.
 *
 * Rendering uses layout×DPR backing, mips + optional anisotropic filtering, and feathered letterbox seams.
 */
async function runWebGlTransition(
  intent: TransitionIntent,
  easeSuffix: string,
  fromSource: WebGlTextureSource,
  toSource: WebGlTextureSource,
  fragmentSource: string,
  setupEffect: WebGlEffectSetup,
  presentation: WebGlPresentationParams,
  textureUpload: { from: WebGlTextureUploadHints; to: WebGlTextureUploadHints },
  qualityFlags: ImageQualityFlags,
  checkNotStale?: LoadStaleCheck,
  onCanvasShown?: () => void,
): Promise<void> {
  const durationMs = intent.durationMs;
  const easeName = createIntentEase(intent, easeSuffix);
  const canvas = dom.webglCanvas;
  if (!canvas) {
    throw new Error("webgl transition unavailable: missing canvas");
  }

  logWebglWorkerCapabilityOnce();

  checkNotStale?.();

  const layout0 = webGlTransitionLayoutRect(canvas);
  const [width, height] = cssRectToSharpTransitionBackingDimensions(layout0.width, layout0.height);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctxAttrs: WebGLContextAttributes = {
    alpha: false,
    depth: false,
    stencil: false,
    // Fullscreen quad: MSAA only wastes fill rate; edge AA is shader-side (fwidth / smoothstep).
    antialias: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
    // Low-latency canvas hint; WebKitGTK may ignore — safe no-op when unsupported.
    desynchronized: true,
    // Required so createImageBitmap(canvas) can read the last drawn frame when a transition aborts.
    // An FBO-based path could avoid PDB, but adds a present blit every frame; revisit only if profiling
    // shows PDB as a top cost after other optimizations.
    preserveDrawingBuffer: true,
  };
  const gl = ensureWebglShared(canvas, ctxAttrs);
  const transitionShared = webglShared;
  if (!transitionShared) {
    throw new Error("webgl shared state missing");
  }
  flushDeferredWebglTransitionTextureDisposal();
  // Update the module-level MAX_TEXTURE_SIZE cache from the real GL context. Texture bitmaps
  // were already sized using the previous cached value (conservative default on first run).
  const glMaxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  if (glMaxTex > 0) {
    cachedMaxTextureSize = glMaxTex;
  }
  let fromTexture: WebGLTexture | null = null;
  let toTexture: WebGLTexture | null = null;

  const makeTexture = (
    unit: number,
    source: WebGlTextureSource,
    hints: WebGlTextureUploadHints,
  ): WebGLTexture => {
    const { width: sourceWidth, height: sourceHeight } = sourceDimensions(source);
    if (sourceWidth <= 0 || sourceHeight <= 0) {
      throw new Error("webgl wipe upload invalid source dimensions");
    }
    const texture = gl.createTexture();
    if (!texture) throw new Error("failed to create WebGL texture");
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    // ImageBitmap is top-row-first like DOM images; sample with flipped V in the vertex
    // shader so the canvas matches <img> orientation. Keep UNPACK_FLIP_Y_WEBGL off here.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, hints.premultiplyUnpack ? 1 : 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const gl2 = gl instanceof WebGL2RenderingContext ? gl : null;
    // Mode D: when colorSpace='srgb' force RGBA so bilinear/Catmull-Rom
    // filtering happens in display (sRGB-encoded) space — matches the browser's
    // `<img>` perceptual look on hard B/W edges. Default 'auto' / 'linear'
    // keeps SRGB8_ALPHA8 + linear-light filtering when WebGL2 is available.
    const filterInSrgbSpace = qualityFlags.colorSpace === "srgb";
    const useSrgbInternal = gl2 !== null && hints.displayEncoded && !filterInSrgbSpace;
    const internalFormat: GLenum = useSrgbInternal ? gl2.SRGB8_ALPHA8 : gl.RGBA;

    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, gl.RGBA, gl.UNSIGNED_BYTE, source);

    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);

    const canMipmap = gl2 !== null || (isPow2Positive(sourceWidth) && isPow2Positive(sourceHeight));
    if (canMipmap) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      const shared = webglShared;
      const ext = shared?.anisotropicExt;
      if (shared && ext && shared.texMaxAnisotropy > 0) {
        gl.texParameterf(gl.TEXTURE_2D, ext.TEXTURE_MAX_ANISOTROPY_EXT, shared.texMaxAnisotropy);
      }
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    }

    return texture;
  };

  // Track whether canvas is visible so the finally block can clean up on exception.
  // On normal completion we leave the canvas visible — the caller commits the
  // incoming image layer and hides the canvas after a compositing frame.
  let canvasShown = false;
  try {
    const progStart = perfMark("webgl-program-start");
    let fragmentToCompile = pickWebGlFragmentForDevice(
      gl,
      fragmentSource,
      qualityFlags.sampler,
      transitionShared.transitionFwidthSupported,
    );
    let linked: WebglLinkedProgram;
    try {
      linked = getOrCreateLinkedProgram(gl, fragmentToCompile);
    } catch (linkErr) {
      // Probe can pass on some stacks while a full transition program still fails
      // (driver quirks). If the log implicates derivatives, fall back once and cache.
      const msg = linkErr instanceof Error ? linkErr.message : String(linkErr);
      if (
        transitionShared.transitionFwidthSupported &&
        fragmentToCompile.includes("fwidth(") &&
        /fwidth|standard_derivatives|derivative/i.test(msg)
      ) {
        transitionShared.transitionFwidthSupported = false;
        fragmentToCompile = pickWebGlFragmentForDevice(
          gl,
          fragmentSource,
          qualityFlags.sampler,
          false,
        );
        linked = getOrCreateLinkedProgram(gl, fragmentToCompile);
      } else {
        throw linkErr;
      }
    }
    const program = linked.program;
    const progEnd = perfMark("webgl-program-end");
    perfMeasure("webgl-program", progStart, progEnd);

    if (!webglShared) {
      throw new Error("webgl shared state missing");
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, webglShared.quadBuffer);

    const aPosition = gl.getAttribLocation(program, "a_position");
    if (aPosition < 0) throw new Error("failed to resolve WebGL attribute");
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    const texStart = perfMark("webgl-textures-start");
    const fromSize = sourceDimensions(fromSource);
    const toSize = sourceDimensions(toSource);
    fromTexture = makeTexture(0, fromSource, textureUpload.from);
    toTexture = makeTexture(1, toSource, textureUpload.to);
    const texEnd = perfMark("webgl-textures-end");
    perfMeasure("webgl-textures", texStart, texEnd);

    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "u_from"), 0);
    gl.uniform1i(gl.getUniformLocation(program, "u_to"), 1);
    gl.viewport(0, 0, canvas.width, canvas.height);

    gl.uniform2f(gl.getUniformLocation(program, "u_from_size"), fromSize.width, fromSize.height);
    gl.uniform2f(gl.getUniformLocation(program, "u_to_size"), toSize.width, toSize.height);
    gl.uniform2f(gl.getUniformLocation(program, "u_canvas_size"), canvas.width, canvas.height);
    setupEffect(gl, program, {
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      fromSize,
      toSize,
    });
    const bindPresentation = (): void => {
      bindWebGlPresentationUniforms(gl, program, canvas, fromSize, presentation);
    };
    bindPresentation();
    const progressLocation = gl.getUniformLocation(program, "u_progress");
    if (!progressLocation) {
      throw new Error("webgl transition missing u_progress uniform");
    }

    // Mode E (FXAA): draw transition into an FBO, then blit through FXAA to canvas.
    // The holder lets us swap the resources mid-transition (canvas resize, error
    // recovery) without the render loop holding a stale closure reference.
    const fxaaState: { current: WebglFxaaResources | null } = { current: null };
    if (qualityFlags.fxaa === "on") {
      try {
        fxaaState.current = ensureFxaaResources(gl, canvas.width, canvas.height);
      } catch (e) {
        logger.warn("FXAA setup failed; falling back to direct render", {
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    const drawFrame = (): void => {
      const fxaa = fxaaState.current;
      if (!fxaa) {
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        return;
      }
      // Pass 1: transition shader → FBO color attachment.
      gl.bindFramebuffer(gl.FRAMEBUFFER, fxaa.fbo);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // Pass 2: FXAA → default framebuffer (canvas).
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(fxaa.program.program);
      // Use texture unit 2 so units 0/1 (u_from / u_to) stay bound for the next frame.
      gl.activeTexture(gl.TEXTURE0 + 2);
      gl.bindTexture(gl.TEXTURE_2D, fxaa.tex);
      if (fxaa.uTex) gl.uniform1i(fxaa.uTex, 2);
      if (fxaa.uInvTexSize) {
        gl.uniform2f(fxaa.uInvTexSize, 1.0 / canvas.width, 1.0 / canvas.height);
      }
      if (fxaa.aPosition >= 0) {
        gl.enableVertexAttribArray(fxaa.aPosition);
        gl.vertexAttribPointer(fxaa.aPosition, 2, gl.FLOAT, false, 0, 0);
      }
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      // Restore for the next iteration. u_from / u_to are still on units 0 and 1.
      gl.useProgram(program);
      gl.activeTexture(gl.TEXTURE0);
    };

    // Render the first frame (progress=0, fully "from" image) synchronously into
    // the draw buffer, then flush before revealing the canvas. This ensures the
    // very first visible frame already has image content rather than a blank clear.
    gl.uniform1f(progressLocation, 0);
    drawFrame();
    gl.flush();
    // Show the canvas (z-index 3, above image layers at z-index 0-1) and give
    // the compositor one frame to present the back buffer. On the very first
    // canvas composite WebKit hasn't allocated a layer for it yet — without
    // this wait the active <img> is hidden before the canvas content is
    // on-screen, producing a single-frame black flash.
    canvas.classList.add("is-active");
    canvasShown = true;
    await nextAnimationFrame();
    try {
      checkNotStale?.();
      // After the canvas is visible and laid out, re-sync backing store — early getBoundingClientRect
      // can be stale or zero (opacity:0), producing a low-res buffer upscaled by the compositor.
      if (
        resizeWebGlTransitionCanvasIfNeeded(
          canvas,
          gl,
          program,
          setupEffect,
          fromSize,
          toSize,
          bindPresentation,
        )
      ) {
        // Canvas size changed → FXAA FBO must track it (or stay disabled).
        if (fxaaState.current) {
          try {
            fxaaState.current = ensureFxaaResources(gl, canvas.width, canvas.height);
          } catch (e) {
            logger.warn("FXAA resize failed; disabling for the rest of the transition", {
              error: e instanceof Error ? e.message : String(e),
            });
            fxaaState.current = null;
          }
        }
        gl.useProgram(program);
        gl.uniform1f(progressLocation, 0);
        drawFrame();
        gl.flush();
      }
      onCanvasShown?.();

      const easeFn = gsap.parseEase(easeName) as (raw: number) => number;
      const startTime = performance.now();
      await new Promise<void>((resolve, reject) => {
        let rafHandle = 0;
        let cancelled = false;

        const guard = window.setTimeout(() => {
          cancelled = true;
          cancelAnimationFrame(rafHandle);
          reject(
            new Error(
              `webgl transition timeout after ${computeRendererGuardTimeoutMs(durationMs)}ms`,
            ),
          );
        }, computeRendererGuardTimeoutMs(durationMs));

        // Single rAF loop + wall-clock progress + gsap.parseEase(easeName): no GSAP
        // ticker, so no second rAF registration racing this loop (stale eased reads at 240Hz).
        const render = () => {
          if (cancelled) return;
          try {
            checkNotStale?.();
          } catch (err) {
            cancelled = true;
            cancelAnimationFrame(rafHandle);
            window.clearTimeout(guard);
            reject(err instanceof Error ? err : new Error(String(err)));
            return;
          }
          const now = performance.now();
          const rawProgress = Math.min((now - startTime) / durationMs, 1);
          const easedProgress = easeFn(rawProgress);
          gl.uniform1f(progressLocation, easedProgress);
          drawFrame();
          if (rawProgress >= 1) {
            gl.uniform1f(progressLocation, 1);
            drawFrame();
            gl.flush();
            window.clearTimeout(guard);
            resolve();
            return;
          }
          if (cancelled) return;
          rafHandle = requestAnimationFrame(render);
        };
        rafHandle = requestAnimationFrame(render);
      });
      // Normal completion: canvas remains visible. The caller is responsible for
      // committing the incoming image and then calling canvas.classList.remove("is-active").
      canvasShown = false;
    } catch (animErr) {
      if (
        animErr instanceof DOMException &&
        animErr.name === "AbortError" &&
        canvas.classList.contains("is-active")
      ) {
        const hoStart = perfMark("webgl-handoff-start");
        await stashWebglFrameAsHandoff(canvas);
        const hoEnd = perfMark("webgl-handoff-end");
        perfMeasure("webgl-handoff", hoStart, hoEnd);
        // Keep the WebGL canvas visible until `restoreWallpaperDomAfterWebglAbort` paints the
        // handoff onto the active <img> — otherwise `finally` hides the canvas while the
        // active layer is still opacity:0, producing a visible gap / 1↔N flash on supersede.
        if (transitionHandoffBitmap !== null) {
          canvasShown = false;
          deferredWebglTransitionTextureDisposal = { gl, from: fromTexture, to: toTexture };
          fromTexture = null;
          toTexture = null;
        }
      }
      throw animErr;
    }
  } finally {
    if (canvasShown) {
      // Exception path: hide canvas immediately so nothing is left dangling.
      canvas.classList.remove("is-active");
    }
    if (fromTexture) gl.deleteTexture(fromTexture);
    if (toTexture) gl.deleteTexture(toTexture);
  }
}

// Fragment shaders: mediump for ALU; `v_uv` stays highp so object-fit UV math stays sharp at
// large backing sizes (distinct from jagged wipe boundaries, which use fwidth AA).

/**
 * Visible root∩canvas mapped to normalized effect coordinates [0,1]² (parallax crop).
 * Sampling still uses raw `v_uv`; wipe/grow/wave spatial logic uses cropEffectUv(v_uv).
 */
const WEBGL_CROP_EFFECT_UV_HELPERS = `
uniform vec4 u_crop_uv_rect;
highp vec2 cropEffectUv(highp vec2 uv) {
  highp vec2 mn = u_crop_uv_rect.xy;
  highp vec2 mx = u_crop_uv_rect.zw;
  highp vec2 span = mx - mn;
  if (span.x <= 1e-6 || span.y <= 1e-6) return uv;
  return (uv - mn) / span;
}
`;

/**
 * Shared GLSL: CSS-aligned sampling + ~1px feather at object-fit letterbox seams.
 *
 * All texture reads go through `sampleTex(sampler, uv, texSize)` (defined by
 * `webglSamplerShaders.ts` and prepended at link time). That single indirection
 * lets us swap the kernel (bilinear / Catmull-Rom / Mitchell) between transitions
 * without touching this template — see `imageQualityFlags.ts` and Mode A in
 * `docs/IMAGE_QUALITY_FLAGS.md`.
 *
 * `u_from_size` / `u_to_size` are typed `highp` so sub-texel arithmetic inside
 * the higher-order kernels stays accurate at 4K backing.
 */
const WEBGL_OBJECT_FIT_HELPERS = `
uniform float u_from_object_fit;
uniform float u_to_object_fit;
uniform vec3 u_letterbox_color;
uniform vec2 u_from_natural_size;
uniform vec2 u_to_natural_size;
// u_from_size / u_to_size are declared by the enclosing fragment shader.
// Keep them at highp precision there so the higher-order kernels' sub-texel
// arithmetic stays accurate at 4K backing.

float letterboxFeatherUv() {
  return 2.0 / min(u_canvas_size.x, u_canvas_size.y);
}

float containYWeight(float y, float lo, float hi, float f) {
  if (y <= lo - f || y >= hi + f) return 0.0;
  if (y < lo) return smoothstep(lo - f, lo, y);
  if (y > hi) return 1.0 - smoothstep(hi, hi + f, y);
  return smoothstep(0.0, f, min(y - lo, hi - y));
}

float containXWeight(float x, float lo, float hi, float f) {
  if (x <= lo - f || x >= hi + f) return 0.0;
  if (x < lo) return smoothstep(lo - f, lo, x);
  if (x > hi) return 1.0 - smoothstep(hi, hi + f, x);
  return smoothstep(0.0, f, min(x - lo, hi - x));
}

vec2 coverUv(vec2 uv, vec2 imageSize) {
  float imageAspect = imageSize.x / max(imageSize.y, 1e-5);
  float canvasAspect = u_canvas_size.x / max(u_canvas_size.y, 1e-5);
  if (imageAspect > canvasAspect) {
    float scale = canvasAspect / imageAspect;
    return vec2(uv.x * scale + 0.5 * (1.0 - scale), uv.y);
  } else {
    float scale = imageAspect / canvasAspect;
    return vec2(uv.x, uv.y * scale + 0.5 * (1.0 - scale));
  }
}

vec4 containSampleFrom(vec2 uv, vec2 imageSize) {
  vec3 lb = u_letterbox_color;
  float f = letterboxFeatherUv();
  float imageAspect = imageSize.x / max(imageSize.y, 1e-5);
  float canvasAspect = u_canvas_size.x / max(u_canvas_size.y, 1e-5);
  if (imageAspect > canvasAspect) {
    float s = canvasAspect / imageAspect;
    float lo = 0.5 - 0.5 * s;
    float hi = lo + s;
    float w = containYWeight(uv.y, lo, hi, f);
    vec2 st = vec2(uv.x, (clamp(uv.y, lo, hi) - lo) / s);
    return mix(vec4(lb, 1.0), ${SAMPLER_FUNCTION_NAME}(u_from, st, u_from_size), w);
  }
  float s = imageAspect / canvasAspect;
  float lo = 0.5 - 0.5 * s;
  float hi = lo + s;
  float w = containXWeight(uv.x, lo, hi, f);
  vec2 st = vec2((clamp(uv.x, lo, hi) - lo) / s, uv.y);
  return mix(vec4(lb, 1.0), ${SAMPLER_FUNCTION_NAME}(u_from, st, u_from_size), w);
}

vec4 containSampleTo(vec2 uv, vec2 imageSize) {
  vec3 lb = u_letterbox_color;
  float f = letterboxFeatherUv();
  float imageAspect = imageSize.x / max(imageSize.y, 1e-5);
  float canvasAspect = u_canvas_size.x / max(u_canvas_size.y, 1e-5);
  if (imageAspect > canvasAspect) {
    float s = canvasAspect / imageAspect;
    float lo = 0.5 - 0.5 * s;
    float hi = lo + s;
    float w = containYWeight(uv.y, lo, hi, f);
    vec2 st = vec2(uv.x, (clamp(uv.y, lo, hi) - lo) / s);
    return mix(vec4(lb, 1.0), ${SAMPLER_FUNCTION_NAME}(u_to, st, u_to_size), w);
  }
  float s = imageAspect / canvasAspect;
  float lo = 0.5 - 0.5 * s;
  float hi = lo + s;
  float w = containXWeight(uv.x, lo, hi, f);
  vec2 st = vec2((clamp(uv.x, lo, hi) - lo) / s, uv.y);
  return mix(vec4(lb, 1.0), ${SAMPLER_FUNCTION_NAME}(u_to, st, u_to_size), w);
}

float noneInteriorWeight(vec2 st) {
  float fe = letterboxFeatherUv();
  float d = min(min(st.x, 1.0 - st.x), min(st.y, 1.0 - st.y));
  return smoothstep(0.0, fe, d);
}

vec4 noneSampleFrom(vec2 uv, vec2 naturalBacking) {
  vec3 lb = u_letterbox_color;
  float f = letterboxFeatherUv();
  vec2 denom = max(naturalBacking, vec2(1e-5));
  vec2 stRaw = (uv - 0.5) * u_canvas_size / denom + 0.5;
  vec2 st = clamp(stRaw, vec2(0.0), vec2(1.0));
  float w = 1.0;
  if (stRaw.x <= -f || stRaw.x >= 1.0 + f || stRaw.y <= -f || stRaw.y >= 1.0 + f) {
    w = 0.0;
  } else {
    if (stRaw.x < 0.0) w *= smoothstep(-f, 0.0, stRaw.x);
    else if (stRaw.x > 1.0) w *= 1.0 - smoothstep(1.0, 1.0 + f, stRaw.x);
    if (stRaw.y < 0.0) w *= smoothstep(-f, 0.0, stRaw.y);
    else if (stRaw.y > 1.0) w *= 1.0 - smoothstep(1.0, 1.0 + f, stRaw.y);
  }
  w = min(w, noneInteriorWeight(st));
  return mix(vec4(lb, 1.0), ${SAMPLER_FUNCTION_NAME}(u_from, st, u_from_size), w);
}

vec4 noneSampleTo(vec2 uv, vec2 naturalBacking) {
  vec3 lb = u_letterbox_color;
  float f = letterboxFeatherUv();
  vec2 denom = max(naturalBacking, vec2(1e-5));
  vec2 stRaw = (uv - 0.5) * u_canvas_size / denom + 0.5;
  vec2 st = clamp(stRaw, vec2(0.0), vec2(1.0));
  float w = 1.0;
  if (stRaw.x <= -f || stRaw.x >= 1.0 + f || stRaw.y <= -f || stRaw.y >= 1.0 + f) {
    w = 0.0;
  } else {
    if (stRaw.x < 0.0) w *= smoothstep(-f, 0.0, stRaw.x);
    else if (stRaw.x > 1.0) w *= 1.0 - smoothstep(1.0, 1.0 + f, stRaw.x);
    if (stRaw.y < 0.0) w *= smoothstep(-f, 0.0, stRaw.y);
    else if (stRaw.y > 1.0) w *= 1.0 - smoothstep(1.0, 1.0 + f, stRaw.y);
  }
  w = min(w, noneInteriorWeight(st));
  return mix(vec4(lb, 1.0), ${SAMPLER_FUNCTION_NAME}(u_to, st, u_to_size), w);
}

vec4 sampleFrom(vec2 uv) {
  if (u_from_object_fit < 0.5) return ${SAMPLER_FUNCTION_NAME}(u_from, coverUv(uv, u_from_size), u_from_size);
  if (u_from_object_fit < 1.5) return containSampleFrom(uv, u_from_size);
  if (u_from_object_fit < 2.5) return ${SAMPLER_FUNCTION_NAME}(u_from, uv, u_from_size);
  return noneSampleFrom(uv, u_from_natural_size);
}

vec4 sampleTo(vec2 uv) {
  if (u_to_object_fit < 0.5) return ${SAMPLER_FUNCTION_NAME}(u_to, coverUv(uv, u_to_size), u_to_size);
  if (u_to_object_fit < 1.5) return containSampleTo(uv, u_to_size);
  if (u_to_object_fit < 2.5) return ${SAMPLER_FUNCTION_NAME}(u_to, uv, u_to_size);
  return noneSampleTo(uv, u_to_natural_size);
}
`;

/** Linear crossfade — same GPU path as wipe/grow (DMA-BUF friendly); replaces CSS opacity fade. */
const FADE_FRAGMENT_SOURCE = `
precision mediump float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform highp vec2 u_from_size;
uniform highp vec2 u_to_size;
uniform vec2 u_canvas_size;
varying highp vec2 v_uv;
${WEBGL_OBJECT_FIT_HELPERS}
void main() {
  vec4 fromColor = sampleFrom(v_uv);
  vec4 toColor = sampleTo(v_uv);
  gl_FragColor = mix(fromColor, toColor, u_progress);
}`;

const WIPE_FRAGMENT_SOURCE = `
precision mediump float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform vec2 u_direction;
uniform float u_min_proj;
uniform float u_max_proj;
uniform float u_progress;
uniform float u_wipe_aa;
uniform highp vec2 u_from_size;
uniform highp vec2 u_to_size;
uniform vec2 u_canvas_size;
varying highp vec2 v_uv;
${WEBGL_CROP_EFFECT_UV_HELPERS}
${WEBGL_OBJECT_FIT_HELPERS}
void main() {
  highp vec2 ef = cropEffectUv(v_uv);
  float proj = dot(ef, u_direction);
  float threshold = mix(u_min_proj, u_max_proj, u_progress);
  vec4 fromColor = sampleFrom(v_uv);
  vec4 toColor = sampleTo(v_uv);
  float minAa = 4.0 / min(u_canvas_size.x, u_canvas_size.y);
  float aa = max(max(u_wipe_aa, minAa), 1e-5);
  float m = smoothstep(threshold - aa, threshold + aa, proj);
  gl_FragColor = mix(fromColor, toColor, 1.0 - m);
}`;

const GROW_FRAGMENT_SOURCE = `
precision mediump float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform vec2 u_origin;
uniform float u_min_dist;
uniform float u_max_dist;
uniform highp vec2 u_from_size;
uniform highp vec2 u_to_size;
uniform vec2 u_canvas_size;
varying highp vec2 v_uv;
${WEBGL_CROP_EFFECT_UV_HELPERS}
${WEBGL_OBJECT_FIT_HELPERS}
void main() {
  vec4 fromColor = sampleFrom(v_uv);
  vec4 toColor = sampleTo(v_uv);
  if (u_progress <= 0.0) {
    gl_FragColor = fromColor;
    return;
  }
  if (u_progress >= 1.0) {
    gl_FragColor = toColor;
    return;
  }
  highp vec2 ef = cropEffectUv(v_uv);
  vec2 delta = ef - u_origin;
  delta.x *= u_canvas_size.x / u_canvas_size.y;
  float dist = length(delta);
  float threshold = mix(u_min_dist, u_max_dist, u_progress);
  float feather = 10.0 / min(u_canvas_size.x, u_canvas_size.y);
  float outsideMask = smoothstep(threshold - feather, threshold + feather, dist);
  gl_FragColor = mix(toColor, fromColor, outsideMask);
}`;

const OUTER_FRAGMENT_SOURCE = `
precision mediump float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform vec2 u_origin;
uniform float u_min_dist;
uniform float u_max_dist;
uniform highp vec2 u_from_size;
uniform highp vec2 u_to_size;
uniform vec2 u_canvas_size;
varying highp vec2 v_uv;
${WEBGL_CROP_EFFECT_UV_HELPERS}
${WEBGL_OBJECT_FIT_HELPERS}
void main() {
  vec4 fromColor = sampleFrom(v_uv);
  vec4 toColor = sampleTo(v_uv);
  if (u_progress <= 0.0) {
    gl_FragColor = fromColor;
    return;
  }
  if (u_progress >= 1.0) {
    gl_FragColor = toColor;
    return;
  }
  highp vec2 ef = cropEffectUv(v_uv);
  vec2 delta = ef - u_origin;
  delta.x *= u_canvas_size.x / u_canvas_size.y;
  float dist = length(delta);
  float threshold = mix(u_max_dist, u_min_dist, u_progress);
  float feather = 10.0 / min(u_canvas_size.x, u_canvas_size.y);
  float m = smoothstep(threshold - feather, threshold + feather, dist);
  gl_FragColor = mix(toColor, fromColor, 1.0 - m);
}`;

const WAVE_FRAGMENT_SOURCE = `
precision mediump float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform vec2 u_direction;
uniform vec2 u_perp;
uniform float u_min_proj;
uniform float u_max_proj;
uniform float u_progress;
uniform float u_wave_amplitude;
uniform float u_wave_frequency;
uniform highp vec2 u_from_size;
uniform highp vec2 u_to_size;
uniform vec2 u_canvas_size;
varying highp vec2 v_uv;
${WEBGL_CROP_EFFECT_UV_HELPERS}
${WEBGL_OBJECT_FIT_HELPERS}
void main() {
  highp vec2 ef = cropEffectUv(v_uv);
  float proj = dot(ef, u_direction);
  float perp = dot(ef, u_perp);
  float threshold = mix(u_min_proj, u_max_proj, u_progress);
  float waveOffset = sin(perp * u_wave_frequency * 6.28318530718) * u_wave_amplitude;
  float feather = 10.0 / min(u_canvas_size.x, u_canvas_size.y);
  float edge = proj - threshold - waveOffset;
  float toMask = 1.0 - smoothstep(-feather, feather, edge);
  vec4 fromColor = sampleFrom(v_uv);
  vec4 toColor = sampleTo(v_uv);
  gl_FragColor = mix(fromColor, toColor, toMask);
}`;

/** Same as legacy shaders but transition edge width follows pixel size via fwidth (WebGL1: needs OES_standard_derivatives; WebGL2: omit extension — see `webglStandardDerivatives.ts`). */
const WIPE_FRAGMENT_FWIDTH = `
#extension GL_OES_standard_derivatives : enable
precision mediump float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform vec2 u_direction;
uniform float u_min_proj;
uniform float u_max_proj;
uniform float u_progress;
uniform highp vec2 u_from_size;
uniform highp vec2 u_to_size;
uniform vec2 u_canvas_size;
varying highp vec2 v_uv;
${WEBGL_CROP_EFFECT_UV_HELPERS}
${WEBGL_OBJECT_FIT_HELPERS}
void main() {
  highp vec2 ef = cropEffectUv(v_uv);
  float proj = dot(ef, u_direction);
  float threshold = mix(u_min_proj, u_max_proj, u_progress);
  vec4 fromColor = sampleFrom(v_uv);
  vec4 toColor = sampleTo(v_uv);
  float edge = proj - threshold;
  float minBand = 4.0 / min(u_canvas_size.x, u_canvas_size.y);
  float w = max(max(fwidth(edge) * 3.25, minBand), 1e-5);
  float m = smoothstep(-w, w, edge);
  gl_FragColor = mix(fromColor, toColor, 1.0 - m);
}`;

const GROW_FRAGMENT_FWIDTH = `
#extension GL_OES_standard_derivatives : enable
precision mediump float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform vec2 u_origin;
uniform float u_min_dist;
uniform float u_max_dist;
uniform highp vec2 u_from_size;
uniform highp vec2 u_to_size;
uniform vec2 u_canvas_size;
varying highp vec2 v_uv;
${WEBGL_CROP_EFFECT_UV_HELPERS}
${WEBGL_OBJECT_FIT_HELPERS}
void main() {
  vec4 fromColor = sampleFrom(v_uv);
  vec4 toColor = sampleTo(v_uv);
  if (u_progress <= 0.0) {
    gl_FragColor = fromColor;
    return;
  }
  if (u_progress >= 1.0) {
    gl_FragColor = toColor;
    return;
  }
  highp vec2 ef = cropEffectUv(v_uv);
  vec2 delta = ef - u_origin;
  delta.x *= u_canvas_size.x / u_canvas_size.y;
  float dist = length(delta);
  float threshold = mix(u_min_dist, u_max_dist, u_progress);
  float e = dist - threshold;
  float minBand = 4.0 / min(u_canvas_size.x, u_canvas_size.y);
  float w = max(max(fwidth(e) * 3.25, minBand), 1e-5);
  float outsideMask = smoothstep(-w, w, e);
  gl_FragColor = mix(toColor, fromColor, outsideMask);
}`;

const OUTER_FRAGMENT_FWIDTH = `
#extension GL_OES_standard_derivatives : enable
precision mediump float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform float u_progress;
uniform vec2 u_origin;
uniform float u_min_dist;
uniform float u_max_dist;
uniform highp vec2 u_from_size;
uniform highp vec2 u_to_size;
uniform vec2 u_canvas_size;
varying highp vec2 v_uv;
${WEBGL_CROP_EFFECT_UV_HELPERS}
${WEBGL_OBJECT_FIT_HELPERS}
void main() {
  vec4 fromColor = sampleFrom(v_uv);
  vec4 toColor = sampleTo(v_uv);
  if (u_progress <= 0.0) {
    gl_FragColor = fromColor;
    return;
  }
  if (u_progress >= 1.0) {
    gl_FragColor = toColor;
    return;
  }
  highp vec2 ef = cropEffectUv(v_uv);
  vec2 delta = ef - u_origin;
  delta.x *= u_canvas_size.x / u_canvas_size.y;
  float dist = length(delta);
  float threshold = mix(u_max_dist, u_min_dist, u_progress);
  float e = dist - threshold;
  float minBand = 4.0 / min(u_canvas_size.x, u_canvas_size.y);
  float w = max(max(fwidth(e) * 3.25, minBand), 1e-5);
  float m = smoothstep(-w, w, e);
  gl_FragColor = mix(toColor, fromColor, 1.0 - m);
}`;

const WAVE_FRAGMENT_FWIDTH = `
#extension GL_OES_standard_derivatives : enable
precision mediump float;
uniform sampler2D u_from;
uniform sampler2D u_to;
uniform vec2 u_direction;
uniform vec2 u_perp;
uniform float u_min_proj;
uniform float u_max_proj;
uniform float u_progress;
uniform float u_wave_amplitude;
uniform float u_wave_frequency;
uniform highp vec2 u_from_size;
uniform highp vec2 u_to_size;
uniform vec2 u_canvas_size;
varying highp vec2 v_uv;
${WEBGL_CROP_EFFECT_UV_HELPERS}
${WEBGL_OBJECT_FIT_HELPERS}
void main() {
  highp vec2 ef = cropEffectUv(v_uv);
  float proj = dot(ef, u_direction);
  float perp = dot(ef, u_perp);
  float threshold = mix(u_min_proj, u_max_proj, u_progress);
  float waveOffset = sin(perp * u_wave_frequency * 6.28318530718) * u_wave_amplitude;
  float edge = proj - threshold - waveOffset;
  float minBand = 4.0 / min(u_canvas_size.x, u_canvas_size.y);
  float w = max(max(fwidth(edge) * 3.25, minBand), 1e-5);
  float toMask = 1.0 - smoothstep(-w, w, edge);
  vec4 fromColor = sampleFrom(v_uv);
  vec4 toColor = sampleTo(v_uv);
  gl_FragColor = mix(fromColor, toColor, toMask);
}`;

/**
 * Pick the legacy-vs-fwidth variant for the device, then compose with the
 * runtime sampler kernel + precision qualifier. Higher-order kernels need
 * `precision highp float;` for sub-texel safety on 4K backings; the bilinear
 * (default GPU) kernel can stay at `mediump` for compatibility with low-end GPUs.
 *
 * The sampler helper is injected right after the `precision` declaration so
 * its `texture2D` / `highp` references resolve against a defined default float
 * precision (GLSL ES 1.0 requirement).
 *
 * The `programCache` is keyed on the final composed string, so each
 * (effect × derivatives × kernel) combination is compiled once and reused.
 */
function pickWebGlFragmentForDevice(
  gl: WebGLRenderingContext,
  base: string,
  kernel: SamplerKernel,
  transitionFwidthSupported: boolean,
): string {
  let body = base;
  if (transitionFwidthSupported) {
    if (base === WIPE_FRAGMENT_SOURCE) body = WIPE_FRAGMENT_FWIDTH;
    else if (base === GROW_FRAGMENT_SOURCE) body = GROW_FRAGMENT_FWIDTH;
    else if (base === OUTER_FRAGMENT_SOURCE) body = OUTER_FRAGMENT_FWIDTH;
    else if (base === WAVE_FRAGMENT_SOURCE) body = WAVE_FRAGMENT_FWIDTH;
  }
  body = stripOesStandardDerivativesExtensionLineForWebGL2(
    gl instanceof WebGL2RenderingContext,
    body,
  );
  const precisionLine = kernelNeedsHighPrecisionShader(kernel)
    ? "precision highp float;"
    : "precision mediump float;";
  return body.replace(
    /precision\s+\w+\s+float\s*;/,
    `${precisionLine}\n${buildSamplerHelperGlsl(kernel)}`,
  );
}

function setupWipeEffect(angleDeg: number): WebGlEffectSetup {
  return (gl, program, params) => {
    const radians = (angleDeg * Math.PI) / 180;
    const direction = [Math.cos(radians), Math.sin(radians)] as const;
    gl.uniform2f(gl.getUniformLocation(program, "u_direction"), direction[0], direction[1]);
    const projections = [0, direction[0], direction[1], direction[0] + direction[1]];
    const minProj = Math.min(...projections);
    const maxProj = Math.max(...projections);
    gl.uniform1f(gl.getUniformLocation(program, "u_min_proj"), minProj);
    gl.uniform1f(gl.getUniformLocation(program, "u_max_proj"), maxProj);
    // Legacy path only (no OES_standard_derivatives): wider proj-space band (~3.5px).
    const loc = gl.getUniformLocation(program, "u_wipe_aa");
    if (loc !== null) {
      const wipeAa =
        3.5 * Math.hypot(direction[0] / params.canvasWidth, direction[1] / params.canvasHeight);
      gl.uniform1f(loc, wipeAa);
    }
  };
}

function growOuterDistUV(
  originX: number,
  originY: number,
  aspect: number,
  vx: number,
  vy: number,
): number {
  const dx = (vx - originX) * aspect;
  const dy = vy - originY;
  return Math.hypot(dx, dy);
}

/** Closest point on the viewport [0,1]² in UV (v_uv: top=0, bottom=1); same metric as the fragment shader. */
function setupGrowEffect(originXPercent: number, originYPercent: number): WebGlEffectSetup {
  return (gl, program, params) => {
    const originX = originXPercent / 100;
    const originY = originYPercent / 100;
    gl.uniform2f(gl.getUniformLocation(program, "u_origin"), originX, originY);

    const aspect = params.canvasWidth / params.canvasHeight;
    const corners: Array<[number, number]> = [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ];
    const cx = Math.min(1, Math.max(0, originX));
    const cy = Math.min(1, Math.max(0, originY));
    const dMin = growOuterDistUV(originX, originY, aspect, cx, cy);

    let maxDist = 0;
    for (const [x, y] of corners) {
      const dist = growOuterDistUV(originX, originY, aspect, x, y);
      if (dist > maxDist) maxDist = dist;
    }

    const maxSafe = maxDist <= dMin ? dMin + 1e-6 : maxDist;
    gl.uniform1f(gl.getUniformLocation(program, "u_min_dist"), dMin);
    gl.uniform1f(gl.getUniformLocation(program, "u_max_dist"), maxSafe);
  };
}

function setupWaveEffect(
  angleDeg: number,
  waveAmplitudePercent: number,
  waveFrequency: number,
): WebGlEffectSetup {
  return (gl, program) => {
    const radians = (angleDeg * Math.PI) / 180;
    const direction = [Math.cos(radians), Math.sin(radians)] as const;
    const perpendicular = [-direction[1], direction[0]] as const;
    gl.uniform2f(gl.getUniformLocation(program, "u_direction"), direction[0], direction[1]);
    gl.uniform2f(gl.getUniformLocation(program, "u_perp"), perpendicular[0], perpendicular[1]);
    const projections = [0, direction[0], direction[1], direction[0] + direction[1]];
    const ampNorm = waveAmplitudePercent / 100;
    const pad = ampNorm + 0.02;
    const minProj = Math.min(...projections) - pad;
    const maxProj = Math.max(...projections) + pad;
    gl.uniform1f(gl.getUniformLocation(program, "u_min_proj"), minProj);
    gl.uniform1f(gl.getUniformLocation(program, "u_max_proj"), maxProj);
    gl.uniform1f(gl.getUniformLocation(program, "u_wave_amplitude"), ampNorm);
    gl.uniform1f(gl.getUniformLocation(program, "u_wave_frequency"), waveFrequency);
  };
}

function setupFadeEffect(): WebGlEffectSetup {
  return () => {};
}

function resetIncomingLayerState(): void {
  if (!dom.incomingLayer) {
    return;
  }
  clearLayerAnimationProps(dom.incomingLayer);
}

function resetLayerTransitionStyles(layer: HTMLImageElement): void {
  clearLayerAnimationProps(layer);
}

async function nextAnimationFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function isLikelyChromiumFamily(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  if (/QtWebEngine/i.test(ua)) return true;
  return /\b(Chrome|Chromium|EdgA?|Edg)\//i.test(ua);
}

/** After committing the post-WebGL `<img>`, wait for paints (1 frame on Chromium; 2 elsewhere). */
async function waitForWebglCompositorPresent(): Promise<void> {
  const frames = isLikelyChromiumFamily() ? 1 : 2;
  for (let i = 0; i < frames; i++) {
    await nextAnimationFrame();
  }
}

function commitFinalImage(target: string): void {
  if (!dom.activeLayer || !dom.incomingLayer) {
    return;
  }
  const previousActive = dom.activeLayer;
  const previousIncoming = dom.incomingLayer;

  previousIncoming.classList.add("is-active");
  resetLayerTransitionStyles(previousIncoming);
  previousActive.classList.remove("is-active");

  // Swap layer references atomically.
  dom.activeLayer = previousIncoming;
  dom.incomingLayer = previousActive;

  // Prepare new incoming layer for the next transition.
  resetIncomingLayerState();
  revokeWallpaperImgBlobUrl(dom.incomingLayer);
  dom.incomingLayer.src = "";
  state.activeTarget = target;
}

async function restoreWallpaperDomAfterWebglAbort(): Promise<void> {
  killWallpaperAnimationTargets();
  if (transitionHandoffBitmap && dom.activeLayer) {
    const apStart = perfMark("webgl-abort-paint-start");
    try {
      await paintBitmapToImgElement(dom.activeLayer, transitionHandoffBitmap);
      // Match successful WebGL completion: do not drop the covering canvas until the
      // handoff blob is decoded and the compositor has had frames to present it — otherwise
      // the <img> can briefly show the previous raster (Image 1) or an empty layer.
      try {
        await dom.activeLayer.decode();
      } catch (err) {
        logger.debug("active layer decode failed during abort handoff", {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      await nextAnimationFrame();
      await nextAnimationFrame();
    } finally {
      dom.webglCanvas?.classList.remove("is-active");
      flushDeferredWebglTransitionTextureDisposal();
    }
    const apEnd = perfMark("webgl-abort-paint-end");
    perfMeasure("webgl-abort-paint", apStart, apEnd);
    dom.activeLayer.classList.add("is-active");
    try {
      gsap.set(dom.activeLayer, { opacity: 1 });
    } catch {
      /* ignore */
    }
    if (dom.incomingLayer) {
      dom.incomingLayer.classList.remove("is-active");
      clearLayerAnimationProps(dom.incomingLayer);
      try {
        gsap.set(dom.incomingLayer, { opacity: 0 });
      } catch {
        /* ignore */
      }
    }
    releaseWallpaperWebGlForIdle();
    return;
  }
  dom.webglCanvas?.classList.remove("is-active");
  if (dom.activeLayer) {
    try {
      gsap.set(dom.activeLayer, { opacity: 1 });
    } catch {
      /* ignore */
    }
  }
  releaseWallpaperWebGlForIdle();
}

export async function runTransition(
  req: LoadRequest,
  checkNotStale?: LoadStaleCheck,
): Promise<{ target: string; meta: TransitionExecutionMeta }> {
  if (!dom.activeLayer || !dom.incomingLayer) {
    throw new Error("transition layers are missing in the DOM");
  }

  const normalizedTarget = normalizeTarget(req.target);
  const startedAt = performance.now();
  const imageFitMode = resolveImageFitMode(req);
  const imageRendering = resolveImageRendering(req);
  applyImagePresentationStyles(imageFitMode, imageRendering);

  // Belt-and-suspenders: noop should run in main.ts first, but URL forms can diverge
  // (e.g. file:// vs asset path). Never re-run a transition onto the same image.
  // If we still hold a superseded WebGL frame, the DOM may show a 1→2 blend while
  // `state.activeTarget` is still 1 — do not treat that as "already showing" the request.
  if (
    transitionHandoffBitmap === null &&
    req.kind === "image" &&
    state.activeKind === "image" &&
    state.activeTarget != null &&
    normalizeTarget(state.activeTarget) === normalizedTarget
  ) {
    return {
      target: normalizedTarget,
      meta: {
        engine: "none",
        effect: "none",
        duration_actual_ms: Math.round(performance.now() - startedAt),
      },
    };
  }

  const intent = resolveTransitionIntent(req, MIN_IMAGE_TRANSITION_MS);
  const easeTag = `${req.request_id}_${req.monitor_id}`;

  if (intent.effect === "none") {
    clearWebglTextureCache();
    releaseWallpaperWebGlForIdle();
    releaseTransitionHandoffBitmap();
    killWallpaperAnimationTargets();
    checkNotStale?.();
    resetIncomingLayerState();
    revokeWallpaperImgBlobUrl(dom.incomingLayer);
    dom.incomingLayer.src = normalizedTarget;
    try {
      await dom.incomingLayer.decode();
    } catch {
      // decode() can reject for some image types/browser states; commit anyway.
    }
    commitFinalImage(normalizedTarget);
    return {
      target: normalizedTarget,
      meta: {
        engine: "none",
        effect: "none",
        duration_actual_ms: Math.round(performance.now() - startedAt),
      },
    };
  }

  killWallpaperAnimationTargets();
  clearLayerAnimationProps(dom.activeLayer);
  clearLayerAnimationProps(dom.incomingLayer);

  checkNotStale?.();
  resetIncomingLayerState();
  revokeWallpaperImgBlobUrl(dom.incomingLayer);
  dom.incomingLayer.src = normalizedTarget;
  const decStart = perfMark("incoming-img-decode-start");
  try {
    await dom.incomingLayer.decode();
  } catch {
    // decode() can reject; proceed so we do not wedge the pipeline.
  }
  const decEnd = perfMark("incoming-img-decode-end");
  perfMeasure("incoming-img-decode", decStart, decEnd);
  checkNotStale?.();

  /** Frozen at transition start: visible root∩canvas in normalized canvas UV space. */
  const transitionEffectCropUv = snapshotTransitionEffectCropUv();

  // WebGL sampling follows the active object-fit; `image-rendering` applies to <img> after commit.
  const wantsWebglTransition =
    intent.effect === "fade" ||
    intent.effect === "wipe" ||
    intent.effect === "grow" ||
    intent.effect === "outer" ||
    intent.effect === "wave";

  if (wantsWebglTransition) {
    const webglEffect = intent.effect;
    const isWipe = webglEffect === "wipe";

    // Snapshot image-quality flags for this transition (sampler kernel,
    // color space, CPU upscale, FXAA). See `imageQualityFlags.ts`. Re-reading
    // each transition lets devtools tweak the next load without a renderer reload.
    const qualityFlags = readImageQualityFlags();

    let fallbackReason: string | undefined;
    let recoverDomEngine: DomCompositorTransitionEngine = "gsap";
    let fromSource: WebGlTextureSource | null = null;
    let toSource: WebGlTextureSource | null = null;
    try {
      const { layoutW, layoutH, capW, capH } = computeWebGlTexturePrepLayoutCap();
      // state.activeTarget is the canonical committed URL set by commitFinalImage.
      // On the very first load it is null — use the base-color texture so the wipe
      // reveals the incoming wallpaper over the page background instead of a 1x1
      // black data-URI pixel that may not match --wallpaper-base-color.
      const prepStart = perfMark("webgl-prep-decodes-start");
      const webglFromMeta = { handoff: false };
      const [fromReady, toReady] = await Promise.all([
        (async (): Promise<WebGlTextureSource> => {
          if (transitionHandoffBitmap) {
            webglFromMeta.handoff = true;
            const b = transitionHandoffBitmap;
            transitionHandoffBitmap = null;
            return b;
          }
          if (
            state.activeTarget &&
            webglTextureCache &&
            webglTextureCache.target === state.activeTarget &&
            webglTextureCache.capW === capW &&
            webglTextureCache.capH === capH &&
            webglTextureCache.imageFitMode === imageFitMode &&
            webglTextureCache.layoutW === layoutW &&
            webglTextureCache.layoutH === layoutH &&
            webglTextureCache.upscaleMode === qualityFlags.upscale
          ) {
            const b = webglTextureCache.bitmap;
            webglTextureCache = null;
            return b;
          }
          clearWebglTextureCache();
          if (state.activeTarget) {
            return prepareWebGlTextureSource(
              state.activeTarget,
              capW,
              capH,
              layoutW,
              layoutH,
              imageFitMode,
              qualityFlags,
              checkNotStale,
            );
          }
          return createBaseColorTextureSource();
        })(),
        prepareWebGlTextureSourcePreferDecoded(
          normalizedTarget,
          capW,
          capH,
          layoutW,
          layoutH,
          imageFitMode,
          dom.incomingLayer,
          qualityFlags,
          checkNotStale,
        ),
      ]);
      const prepEnd = perfMark("webgl-prep-decodes-end");
      perfMeasure("webgl-prep-decodes", prepStart, prepEnd);
      fromSource = fromReady;
      toSource = toReady;
      // Snapshot active layer ref now — the swap inside commitFinalImage changes dom.activeLayer.
      const activeLayerSnapshot = dom.activeLayer;
      const fromDims = sourceDimensions(fromReady);
      const toDims = sourceDimensions(toReady);
      const presentation: WebGlPresentationParams = {
        imageFitMode,
        fromWasHandoff: webglFromMeta.handoff,
        fromNaturalCss: webglFromMeta.handoff
          ? { w: fromDims.width, h: fromDims.height }
          : state.activeTarget
            ? {
                w: Math.max(1, activeLayerSnapshot.naturalWidth || fromDims.width),
                h: Math.max(1, activeLayerSnapshot.naturalHeight || fromDims.height),
              }
            : { w: 1, h: 1 },
        toNaturalCss: {
          w: Math.max(1, dom.incomingLayer?.naturalWidth ?? toDims.width),
          h: Math.max(1, dom.incomingLayer?.naturalHeight ?? toDims.height),
        },
        effectCropUv: transitionEffectCropUv,
      };
      const fromTexHints: WebGlTextureUploadHints = webglFromMeta.handoff
        ? { displayEncoded: false, premultiplyUnpack: false }
        : state.activeTarget
          ? {
              displayEncoded: true,
              premultiplyUnpack: inferPremultiplyUnpackFromTargetUrl(
                normalizeTarget(state.activeTarget),
              ),
            }
          : { displayEncoded: true, premultiplyUnpack: false };
      const toTexHints: WebGlTextureUploadHints = {
        displayEncoded: true,
        premultiplyUnpack: inferPremultiplyUnpackFromTargetUrl(normalizedTarget),
      };
      await runWebGlTransition(
        intent,
        `wgl_${easeTag}`,
        fromSource,
        toSource,
        webglEffect === "fade"
          ? FADE_FRAGMENT_SOURCE
          : webglEffect === "wipe"
            ? WIPE_FRAGMENT_SOURCE
            : webglEffect === "grow"
              ? GROW_FRAGMENT_SOURCE
              : webglEffect === "outer"
                ? OUTER_FRAGMENT_SOURCE
                : WAVE_FRAGMENT_SOURCE,
        webglEffect === "fade"
          ? setupFadeEffect()
          : webglEffect === "wipe"
            ? setupWipeEffect(intent.wipeAngleDeg)
            : webglEffect === "grow" || webglEffect === "outer"
              ? setupGrowEffect(intent.originXPercent, intent.originYPercent)
              : setupWaveEffect(
                  intent.wipeAngleDeg,
                  intent.waveAmplitudePercent,
                  intent.waveFrequency,
                ),
        presentation,
        { from: fromTexHints, to: toTexHints },
        qualityFlags,
        checkNotStale,
        // Called the moment the first WebGL frame is in the draw buffer and the
        // canvas is about to become visible. Hide the active image layer in the
        // same synchronous batch so the compositor never sees both simultaneously —
        // eliminates the rasterization seam / pixelation on the outgoing image.
        () => {
          gsap.set(activeLayerSnapshot, { opacity: 0 });
        },
      );
      // Canvas is still is-active here (showing the final "to" frame). Commit the
      // incoming image layer WHILE the canvas is covering the screen so there is no
      // visible gap between the WebGL output and the committed image.
      commitFinalImage(normalizedTarget);
      checkNotStale?.();
      // Ensure the committed <img> is fully decoded at display resolution before
      // hiding the canvas. decode() resolves once the browser has a raster-ready
      // frame, preventing the brief pixelation / layout shift that occurs when
      // the compositor reveals an incompletely-rastered image layer.
      if (dom.activeLayer) {
        try {
          await dom.activeLayer.decode();
        } catch (decodeError) {
          logger.debug("active layer decode failed after WebGL transition", {
            error: decodeError instanceof Error ? decodeError.message : String(decodeError),
          });
        }
      }
      checkNotStale?.();
      // Prefer one rAF on Chromium/Qt WebEngine; Safari/Firefox still get two waits.
      await waitForWebglCompositorPresent();
      checkNotStale?.();
      dom.webglCanvas?.classList.remove("is-active");
      if (toSource) {
        promoteToWebglTextureCache(
          normalizedTarget,
          toSource,
          capW,
          capH,
          imageFitMode,
          layoutW,
          layoutH,
          qualityFlags.upscale,
        );
        toSource = null;
      }
      releaseWallpaperWebGlForIdle();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        clearWebglTextureCache();
        await restoreWallpaperDomAfterWebglAbort();
        throw error;
      }
      const message = error instanceof Error ? error.message : "unknown";
      fallbackReason = `webgl_${webglEffect}_unavailable:${message}`;
      logger.warn("webgl transition unavailable; falling back to gsap", {
        effect: webglEffect,
        reason: fallbackReason,
      });
      clearWebglTextureCache();
      gsap.set(dom.activeLayer, { opacity: 1 });
      await nextAnimationFrame();
      const fallbackIntent: TransitionIntent = {
        ...intent,
        effect: isWipe ? "wipe" : "fade",
      };
      try {
        recoverDomEngine = await runGsapLayerTransition(
          fallbackIntent,
          dom.incomingLayer,
          dom.activeLayer,
          `fb_${easeTag}`,
          transitionEffectCropUv,
        );
      } catch (fallbackErr) {
        const fb = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        fallbackReason = `${fallbackReason}:gsap_fallback:${fb}`;
        logger.warn("gsap fallback after webgl failure also failed", { error: fb });
      }
      commitFinalImage(normalizedTarget);
      releaseWallpaperWebGlForIdle();
    } finally {
      releaseWebGlTextureSource(fromSource);
      releaseWebGlTextureSource(toSource);
    }
    return {
      target: normalizedTarget,
      meta: {
        engine: fallbackReason ? recoverDomEngine : "webgl",
        effect: webglEffect,
        duration_actual_ms: Math.round(performance.now() - startedAt),
        ...(fallbackReason ? { fallback_reason: fallbackReason } : {}),
      },
    };
  }

  clearWebglTextureCache();
  releaseTransitionHandoffBitmap();
  let domFallbackReason: string | undefined;
  const supportsGsapEffect =
    intent.effect === "fade" || intent.effect === "wipe" || intent.effect === "blur_through";
  const fallbackIntent: TransitionIntent = supportsGsapEffect
    ? intent
    : { ...intent, effect: "fade" };
  if (!supportsGsapEffect) {
    domFallbackReason = `transition_${intent.effect}_gsap_unsupported`;
  }
  let domEngine: DomCompositorTransitionEngine = "gsap";
  try {
    checkNotStale?.();
    domEngine = await runGsapLayerTransition(
      fallbackIntent,
      dom.incomingLayer,
      dom.activeLayer,
      `img_${easeTag}`,
      transitionEffectCropUv,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    domFallbackReason = domFallbackReason ? `${domFallbackReason}:${errorMessage}` : errorMessage;
    logger.warn("gsap image transition failed", { error: domFallbackReason });
  }
  commitFinalImage(normalizedTarget);
  releaseWallpaperWebGlForIdle();

  return {
    target: normalizedTarget,
    meta: {
      engine: domEngine,
      effect: intent.effect,
      duration_actual_ms: Math.round(performance.now() - startedAt),
      ...(domFallbackReason ? { fallback_reason: domFallbackReason } : {}),
    },
  };
}

/**
 * Opacity fade from the active &lt;video&gt; to the incoming &lt;img&gt;.
 * Caller resets video runtime, activates image mode, and commits media state after success.
 */
export async function runImageTransitionFromVideo(
  req: LoadRequest,
  checkNotStale?: LoadStaleCheck,
): Promise<{ target: string; meta: TransitionExecutionMeta }> {
  const resolved = resolveOrthogonalFadeIntent(req);
  if (!resolved) {
    throw new Error("runImageTransitionFromVideo: expected a non-none transition");
  }
  if (!dom.activeLayer || !dom.incomingLayer || !dom.videoActiveLayer) {
    throw new Error("transition layers are missing in the DOM");
  }

  const startedAt = performance.now();
  const normalizedTarget = normalizeTarget(req.target);
  const imageFitMode = resolveImageFitMode(req);
  const imageRendering = resolveImageRendering(req);
  applyImagePresentationStyles(imageFitMode, imageRendering);

  const { intent, coerced } = resolved;

  killWallpaperAnimationTargets();
  clearHTMLElementAnimationProps(dom.videoActiveLayer);
  clearLayerAnimationProps(dom.activeLayer);
  clearLayerAnimationProps(dom.incomingLayer);

  checkNotStale?.();
  resetIncomingLayerState();
  revokeWallpaperImgBlobUrl(dom.incomingLayer);
  dom.incomingLayer.src = normalizedTarget;
  try {
    await dom.incomingLayer.decode();
  } catch {
    /* same as runTransition */
  }
  checkNotStale?.();

  const backend = await runFadeLayerCrossfade(intent, dom.incomingLayer, dom.videoActiveLayer);
  clearHTMLElementAnimationProps(dom.videoActiveLayer);
  commitFinalImage(normalizedTarget);
  releaseWallpaperWebGlForIdle();

  return {
    target: normalizedTarget,
    meta: {
      engine: backend,
      effect: "fade",
      duration_actual_ms: Math.round(performance.now() - startedAt),
      ...(coerced ? { fallback_reason: "orthogonal_fade_coerced" } : {}),
    },
  };
}

export function normalizeMediaTarget(target: string): string {
  return normalizeTarget(target);
}

/** True while a superseded WebGL frame is held for the next transition (see `transitionHandoffBitmap`). */
export function hasWallpaperTransitionHandoff(): boolean {
  return transitionHandoffBitmap !== null;
}
