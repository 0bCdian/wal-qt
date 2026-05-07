import { describe, expect, it } from "vitest";

import { installVideoLoopHandler } from "./videoLoop";

class FakeClassList {
  private readonly names = new Set<string>();

  add(...tokens: string[]) {
    for (const token of tokens) this.names.add(token);
  }

  remove(...tokens: string[]) {
    for (const token of tokens) this.names.delete(token);
  }

  contains(token: string) {
    return this.names.has(token);
  }
}

class FakeStyle {
  private readonly values = new Map<string, string>();

  setProperty(name: string, value: string) {
    this.values.set(name, value);
  }

  removeProperty(name: string) {
    this.values.delete(name);
  }

  getPropertyValue(name: string) {
    return this.values.get(name) ?? "";
  }
}

class FakeVideoLayer extends EventTarget {
  readonly classList = new FakeClassList();
  readonly style = new FakeStyle();
  currentTime = 0;
  duration = 0;
  paused = false;
  loop = true;
  offsetWidth = 1920;
}

describe("installVideoLoopHandler", () => {
  it("applies startup fade when playback starts", () => {
    const layer = new FakeVideoLayer();
    const controller = installVideoLoopHandler();

    controller.start("asset://video.mp4", layer as never);
    layer.dispatchEvent(new Event("playing"));

    expect(layer.classList.contains("video-loop-fade")).toBe(true);
    expect(layer.style.getPropertyValue("--video-loop-fade-ms")).toBe("220ms");
  });

  it("applies short fade when loop wraps around", () => {
    const layer = new FakeVideoLayer();
    layer.duration = 10;
    const controller = installVideoLoopHandler();

    controller.start("asset://video.mp4", layer as never);
    layer.currentTime = 9.6;
    layer.dispatchEvent(new Event("timeupdate"));
    layer.currentTime = 0.1;
    layer.dispatchEvent(new Event("timeupdate"));

    expect(layer.classList.contains("video-loop-fade")).toBe(true);
    expect(layer.style.getPropertyValue("--video-loop-fade-ms")).toBe("90ms");
  });

  it("detaches listeners and cleanup classes on stop", () => {
    const layer = new FakeVideoLayer();
    const controller = installVideoLoopHandler();

    controller.start("asset://video.mp4", layer as never);
    controller.stop();
    layer.dispatchEvent(new Event("playing"));

    expect(layer.classList.contains("video-loop-fade")).toBe(false);
    expect(layer.style.getPropertyValue("--video-loop-fade-ms")).toBe("");
  });
});
