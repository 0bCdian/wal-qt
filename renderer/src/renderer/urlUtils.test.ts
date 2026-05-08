import { describe, expect, it, vi } from "vitest";

import { resolveAssetUrl } from "./urlUtils";

describe("resolveAssetUrl", () => {
  it("passes through http(s) urls unchanged", () => {
    expect(resolveAssetUrl("https://example.com/a.jpg")).toBe("https://example.com/a.jpg");
    expect(resolveAssetUrl("http://example.com/a.jpg")).toBe("http://example.com/a.jpg");
  });

  it("passes through file:// urls unchanged", () => {
    expect(resolveAssetUrl("file:///tmp/pic%20one.jpg")).toBe("file:///tmp/pic%20one.jpg");
  });

  it("maps file and absolute paths to walfile:// when embedded wal-qt flag is on", () => {
    vi.stubGlobal("window", { __walqtUseWalfileScheme: true });
    expect(resolveAssetUrl("file:///tmp/pic%20one.jpg")).toBe("walfile:///tmp/pic%20one.jpg");
    expect(resolveAssetUrl("/tmp/a.jpg")).toBe("walfile:///tmp/a.jpg");
    vi.unstubAllGlobals();
  });

  it("passes through walfile:// when flag is on", () => {
    vi.stubGlobal("window", { __walqtUseWalfileScheme: true });
    expect(resolveAssetUrl("walfile:///tmp/x.jpg")).toBe("walfile:///tmp/x.jpg");
    vi.unstubAllGlobals();
  });

  it("passes through data: urls unchanged", () => {
    const data = "data:image/png;base64,abc==";
    expect(resolveAssetUrl(data)).toBe(data);
  });

  it("passes through blob: urls unchanged", () => {
    expect(resolveAssetUrl("blob:http://localhost/uuid")).toBe("blob:http://localhost/uuid");
  });

  it("passes through waypaperhtml:// urls unchanged", () => {
    expect(resolveAssetUrl("waypaperhtml://page")).toBe("waypaperhtml://page");
  });

  it("converts absolute paths to file:// urls", () => {
    expect(resolveAssetUrl("/tmp/a.jpg")).toBe("file:///tmp/a.jpg");
  });

  it("returns bare relative strings unchanged", () => {
    expect(resolveAssetUrl("relative/path.jpg")).toBe("relative/path.jpg");
  });
});
