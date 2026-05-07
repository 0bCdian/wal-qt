import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "./logger";

const mockLog = vi.fn();

beforeEach(() => {
    mockLog.mockClear();
    vi.stubGlobal("_walBridge", { log: mockLog });
});

describe("logger", () => {
    it("forwards info level and message to _walBridge.log", () => {
        vi.spyOn(console, "info").mockImplementation(() => {});
        logger.info("hello");
        expect(mockLog).toHaveBeenCalledWith("info", "hello");
    });

    it("serializes context into the message string", () => {
        vi.spyOn(console, "info").mockImplementation(() => {});
        logger.info("hello", { x: 1 });
        expect(mockLog).toHaveBeenCalledWith("info", 'hello {"x":1}');
    });

    it("forwards debug level", () => {
        vi.spyOn(console, "debug").mockImplementation(() => {});
        logger.debug("no ctx");
        expect(mockLog).toHaveBeenCalledWith("debug", "no ctx");
    });

    it("forwards warn level", () => {
        vi.spyOn(console, "warn").mockImplementation(() => {});
        logger.warn("watch out");
        expect(mockLog).toHaveBeenCalledWith("warn", "watch out");
    });

    it("errorFrom includes normalized error in message", () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        logger.errorFrom("boom", new Error("inner"), { k: 2 });
        expect(mockLog).toHaveBeenCalledWith(
            "error",
            'boom {"k":2,"error":"inner"}',
        );
    });

    it("does not throw when _walBridge is undefined", () => {
        vi.stubGlobal("_walBridge", undefined);
        expect(() => logger.info("no bridge")).not.toThrow();
    });
});
