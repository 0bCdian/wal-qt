import type { LoadRequest } from "../types";

type TransitionEffect = "none" | "fade" | "wipe" | "grow" | "outer" | "wave" | "blur_through";

export type TransitionIntent = {
  effect: TransitionEffect;
  durationMs: number;
  wipeAngleDeg: number;
  originXPercent: number;
  originYPercent: number;
  waveAmplitudePercent: number;
  waveFrequency: number;
  blurRadiusPx: number;
  bezier: [number, number, number, number];
};

function hashToUnit(seed: number): number {
  let value = seed | 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 0xffffffff;
}

export function resolveTransitionIntent(req: LoadRequest, minDurationMs: number): TransitionIntent {
  const durationMs = Math.max(req.duration_ms, minDurationMs);
  const params = req.transition_params ?? {};
  const requestSeedBase = Number(req.request_id) + req.monitor_id * 7919 + (params.seed ?? 0);
  const randomA = hashToUnit(requestSeedBase + 17);
  const randomB = hashToUnit(requestSeedBase + 43);
  const randomC = hashToUnit(requestSeedBase + 71);

  const intent: TransitionIntent = {
    effect: "fade",
    durationMs,
    wipeAngleDeg: params.angle_deg ?? 0,
    originXPercent: params.origin_x_percent ?? 50,
    originYPercent: params.origin_y_percent ?? 50,
    waveAmplitudePercent: params.wave_amplitude_percent ?? 5,
    waveFrequency: params.wave_frequency ?? 3,
    blurRadiusPx: 20,
    bezier: params.bezier ?? [0.54, 0, 0.34, 0.99],
  };

  switch (req.transition) {
    case "none":
      intent.effect = "none";
      return intent;
    case "fade":
      intent.effect = "fade";
      return intent;
    case "left":
      intent.effect = "wipe";
      intent.wipeAngleDeg = 180;
      return intent;
    case "right":
      intent.effect = "wipe";
      intent.wipeAngleDeg = 0;
      return intent;
    case "top":
      intent.effect = "wipe";
      intent.wipeAngleDeg = 90;
      return intent;
    case "bottom":
      intent.effect = "wipe";
      intent.wipeAngleDeg = 270;
      return intent;
    case "wipe":
      intent.effect = "wipe";
      return intent;
    case "grow":
      intent.effect = "grow";
      return intent;
    case "outer":
      intent.effect = "outer";
      return intent;
    case "wave":
      intent.effect = "wave";
      return intent;
    case "center":
      intent.effect = "grow";
      intent.originXPercent = 50;
      intent.originYPercent = 50;
      return intent;
    case "blur_through":
      intent.effect = "blur_through";
      intent.blurRadiusPx = 20;
      return intent;
    case "any": {
      const pool: TransitionEffect[] = ["fade", "wipe", "grow", "outer", "wave", "blur_through"];
      intent.effect = pool[Math.floor(randomA * pool.length) % pool.length];
      intent.originXPercent = Math.round(randomB * 100);
      intent.originYPercent = Math.round(randomC * 100);
      return intent;
    }
    case "random": {
      const effects: TransitionEffect[] = ["fade", "wipe", "grow", "outer", "wave", "blur_through"];
      const effectIndex = Math.floor(randomA * effects.length) % effects.length;
      intent.effect = effects[effectIndex];
      intent.originXPercent = Math.round(randomB * 100);
      intent.originYPercent = Math.round(randomC * 100);
      return intent;
    }
    default:
      return intent;
  }
}
