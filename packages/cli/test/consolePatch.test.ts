import { afterEach, describe, expect, it, vi } from "vitest";
import { patchConsole } from "../src/server/consolePatch.js";
import type { JourneyLogger, LogEvent } from "@usejourney/core";

describe("patchConsole", () => {
  let originalLog: typeof console.log;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;
  let originalInfo: typeof console.info;

  afterEach(() => {
    console.log = originalLog;
    console.warn = originalWarn;
    console.error = originalError;
    console.info = originalInfo;
  });

  it("forwards console.* calls to logger.onLog while preserving the original stream", () => {
    const captured: LogEvent[] = [];
    const origSpy = vi.fn();
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    originalInfo = console.info;
    console.log = origSpy;
    console.warn = origSpy;
    console.error = origSpy;
    console.info = origSpy;

    const logger: JourneyLogger = { onLog: (e) => captured.push(e) };
    const unpatch = patchConsole(logger);

    console.log("hello", 42);
    console.warn("careful");
    console.error(new Error("boom"));
    console.info({ a: 1 });

    unpatch();

    expect(captured).toEqual([
      { level: "info", text: "hello 42" },
      { level: "warn", text: "careful" },
      expect.objectContaining({ level: "error" }),
      expect.objectContaining({ level: "info", text: expect.stringContaining("a:") }),
    ]);
    // Originals still got all four calls.
    expect(origSpy).toHaveBeenCalledTimes(4);
  });

  it("is a no-op when logger has no onLog handler", () => {
    const logger: JourneyLogger = {};
    const unpatch = patchConsole(logger);
    // Returned function is still callable.
    expect(() => unpatch()).not.toThrow();
  });

  it("unpatch restores all four console methods", () => {
    originalLog = console.log;
    originalWarn = console.warn;
    originalError = console.error;
    originalInfo = console.info;
    const logger: JourneyLogger = { onLog: () => {} };
    const unpatch = patchConsole(logger);
    expect(console.log).not.toBe(originalLog);
    unpatch();
    expect(console.log).toBe(originalLog);
    expect(console.warn).toBe(originalWarn);
    expect(console.error).toBe(originalError);
    expect(console.info).toBe(originalInfo);
  });
});
