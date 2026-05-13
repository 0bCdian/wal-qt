/**
 * Wire-contract types for the wal-qt renderer.
 *
 * Types that appear in the OpenAPI spec (docs/openapi-control-plane.yaml)
 * are re-exported from the generated file so there is a single source of
 * truth.  Run `pnpm run gen:api` to regenerate src/generated/control-plane.ts.
 *
 * Types that originate from x-schemas (Tauri IPC events) or are
 * renderer-local are kept here by hand with a comment noting their source.
 */

import type { components } from "../generated/control-plane.js";

type Schemas = components["schemas"];

// ── OpenAPI components/schemas ────────────────────────────────────────────────

/** @see docs/openapi-control-plane.yaml components/schemas/TransitionMode */
export type TransitionMode = Schemas["TransitionMode"];

/** @see docs/openapi-control-plane.yaml components/schemas/MediaKind */
export type MediaKind = Schemas["MediaKind"];

/** @see docs/openapi-control-plane.yaml components/schemas/ImageFitMode */
export type ImageFitMode = Schemas["ImageFitMode"];

/** @see docs/openapi-control-plane.yaml components/schemas/ImageRenderingMode */
export type ImageRenderingMode = Schemas["ImageRenderingMode"];

/**
 * Transition parameters.
 * Mirrors components/schemas/TransitionParams in the OpenAPI spec, but
 * narrows `bezier` from `number[]` to a fixed-length tuple since the
 * OpenAPI spec cannot express tuples and the renderer requires exactly 4
 * control points.
 * @see docs/openapi-control-plane.yaml components/schemas/TransitionParams
 */
export type TransitionParams = Omit<Schemas["TransitionParams"], "bezier"> & {
  bezier?: [number, number, number, number];
};

/**
 * Parallax baseline configuration sent on wallpaper:load.
 * Mirrors components/schemas/ParallaxConfig in the OpenAPI spec, but
 * narrows `easing` from `number[]` to a fixed-length tuple since the
 * OpenAPI spec cannot express tuples and the renderer requires exactly 4
 * cubic-bezier control points.
 * Named LoadParallaxConfig here to distinguish it from the mutable
 * runtime ParallaxPayload.
 * @see docs/openapi-control-plane.yaml components/schemas/ParallaxConfig
 */
export type LoadParallaxConfig = Omit<Schemas["ParallaxConfig"], "easing"> & {
  easing: [number, number, number, number];
};

// ── Renderer-local (no OpenAPI equivalent) ────────────────────────────────────

/** Engine used to execute a transition — renderer-local, not on the wire. */
export type TransitionEngine =
  | "none"
  | "vta"
  | "css_fallback"
  | "webgl"
  | "gsap"
  /** Web Animations opacity crossfade (preferred on Chromium/Qt WebEngine). */
  | "waapi"
  /** CSS transition + transitionend path from {@link runFadeLayerCrossfade} fallback. */
  | "css";

/** Metadata recorded after a transition completes — renderer-local. */
export type TransitionExecutionMeta = {
  engine: TransitionEngine;
  effect: "none" | "fade" | "wipe" | "grow" | "outer" | "wave" | "blur_through";
  duration_actual_ms: number;
  fallback_reason?: string;
};

// ── x-schemas / Tauri IPC events (hand-maintained) ───────────────────────────

/**
 * Payload of the `wallpaper:load` Tauri event.
 * Mirrors x-schemas/LoadEventPayload in docs/openapi-control-plane.yaml.
 */
export type LoadRequest = {
  request_id: number;
  monitor_id: number;
  kind: MediaKind;
  target: string;
  audio_enabled: boolean;
  transition: TransitionMode;
  transition_params?: TransitionParams;
  duration_ms: number;
  image_fit_mode?: ImageFitMode;
  image_rendering?: ImageRenderingMode;
  /** When set and enabled, renderer applies zoom baseline before the wallpaper transition. */
  parallax?: LoadParallaxConfig;
};

/**
 * Payload of the `wallpaper:parallax` Tauri event.
 * Mirrors x-schemas/ParallaxEventPayload in docs/openapi-control-plane.yaml.
 */
export type ParallaxPayload = {
  monitor_id: number;
  enabled: boolean;
  zoom: number;
  offset_x: number;
  offset_y: number;
  animation_ms: number;
  easing: [number, number, number, number];
  reset_ms: number;
  wrapped_x: boolean;
  wrapped_y: boolean;
};
