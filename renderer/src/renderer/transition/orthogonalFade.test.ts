import { describe, expect, it } from "vitest";

import { resolveOrthogonalFadeIntent } from "./orthogonalFade";
import type { LoadRequest } from "../types";

function baseReq(over: Partial<LoadRequest> = {}): LoadRequest {
  return {
    request_id: 1,
    monitor_id: 0,
    kind: "video",
    target: "asset://a.mp4",
    audio_enabled: false,
    transition: "fade",
    duration_ms: 400,
    ...over,
  };
}

describe("resolveOrthogonalFadeIntent", () => {
  it("returns null for transition none", () => {
    expect(resolveOrthogonalFadeIntent(baseReq({ transition: "none" }))).toBeNull();
  });

  it("keeps fade without coercion", () => {
    const r = resolveOrthogonalFadeIntent(baseReq({ transition: "fade" }));
    expect(r).not.toBeNull();
    expect(r!.coerced).toBe(false);
    expect(r!.intent.effect).toBe("fade");
  });

  it("coerces wipe to fade", () => {
    const r = resolveOrthogonalFadeIntent(baseReq({ transition: "left" }));
    expect(r!.coerced).toBe(true);
    expect(r!.intent.effect).toBe("fade");
  });
});
