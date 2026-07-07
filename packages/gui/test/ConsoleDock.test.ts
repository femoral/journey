import { describe, expect, it } from "vitest";
import { formatConsoleBody } from "../src/shell/ConsoleDock";

describe("formatConsoleBody", () => {
  it("prints file[N bytes] for a binary content-type instead of the raw body", () => {
    expect(
      formatConsoleBody("\x89PNG\r\n", {
        "content-type": "image/png",
        "content-length": "204800",
      }),
    ).toBe("file[204800 bytes]");
  });

  it("prints file[] when a binary response has no content-length header", () => {
    expect(formatConsoleBody("binary-ish", { "content-type": "application/octet-stream" })).toBe(
      "file[]",
    );
  });

  it("still pretty-prints JSON bodies", () => {
    expect(formatConsoleBody({ ok: true }, { "content-type": "application/json" })).toBe(
      JSON.stringify({ ok: true }, null, 2),
    );
  });

  it("returns the raw string for textual bodies", () => {
    expect(formatConsoleBody("hello", { "content-type": "text/plain" })).toBe("hello");
  });

  it("returns empty string when body is undefined", () => {
    expect(formatConsoleBody(undefined, { "content-type": "image/png" })).toBe("");
  });
});
