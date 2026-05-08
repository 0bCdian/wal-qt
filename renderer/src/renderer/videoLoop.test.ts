import { describe, expect, it } from "vitest";

import { installVideoLoopHandler } from "./videoLoop";

describe("installVideoLoopHandler", () => {
  it("tracks current src until stop", () => {
    const h = installVideoLoopHandler();
    expect(h.currentSrc).toBe(null);
    h.start("asset://video.mp4", {} as HTMLVideoElement);
    expect(h.currentSrc).toBe("asset://video.mp4");
    h.stop();
    expect(h.currentSrc).toBe(null);
  });

  it("ignored layer is callers responsibility (stub does not attach listeners)", () => {
    const h = installVideoLoopHandler();
    h.start("a", {} as HTMLVideoElement);
    h.stop();
    expect(h.currentSrc).toBe(null);
  });
});
