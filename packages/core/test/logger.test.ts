import { describe, expect, it, vi } from "vitest";
import {
  createConsoleLogger,
  loggerFromEnv,
  maskHeaders,
  SECRET_HEADERS,
} from "../src/logger.js";
import { execute } from "../src/http.js";

describe("maskHeaders", () => {
  it("redacts secret headers case-insensitively", () => {
    expect(
      maskHeaders({ Authorization: "Bearer x", Accept: "json", Cookie: "a=b" }),
    ).toEqual({ Authorization: "***", Accept: "json", Cookie: "***" });
  });

  it("ships the expected default mask list", () => {
    expect(SECRET_HEADERS).toContain("authorization");
    expect(SECRET_HEADERS).toContain("cookie");
    expect(SECRET_HEADERS).toContain("x-api-key");
  });
});

describe("loggerFromEnv", () => {
  it("returns undefined when DEBUG is unset", () => {
    expect(loggerFromEnv({})).toBeUndefined();
    expect(loggerFromEnv({ DEBUG: "other" })).toBeUndefined();
  });

  it("returns a logger when DEBUG includes journey or *", () => {
    expect(loggerFromEnv({ DEBUG: "journey" })).toBeDefined();
    expect(loggerFromEnv({ DEBUG: "*" })).toBeDefined();
    expect(loggerFromEnv({ DEBUG: "other,journey,thing" })).toBeDefined();
  });
});

describe("execute() + console logger", () => {
  it("invokes onRequest, onResponse with masked headers and durationMs", async () => {
    const lines: string[] = [];
    const logger = createConsoleLogger({ write: (l) => lines.push(l) });
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await execute(
      {
        method: "POST",
        url: "https://example.com/x",
        headers: { Authorization: "Bearer secret", "X-Trace": "abc" },
        body: { hello: "world" },
      },
      { fetchImpl, logger },
    );
    const requestLine = lines.find((l) => l.startsWith("→"));
    const headerLine = lines.find((l) => l.startsWith("  headers"));
    const responseLine = lines.find((l) => l.startsWith("←"));
    expect(requestLine).toBe("→ POST https://example.com/x");
    expect(headerLine).toContain('"Authorization":"***"');
    expect(headerLine).toContain('"X-Trace":"abc"');
    expect(responseLine).toMatch(/← 200 POST .* \(\d+ms\)/);
  });

  it("invokes onError when fetch throws", async () => {
    const errors: unknown[] = [];
    const logger = createConsoleLogger({ write: () => {} });
    logger.onError = (_req, err) => errors.push(err);
    const fetchImpl = vi.fn(async () => {
      throw new Error("boom");
    });
    await expect(
      execute({ method: "GET", url: "https://x", headers: {} }, { fetchImpl, logger }),
    ).rejects.toThrow("boom");
    expect((errors[0] as Error).message).toBe("boom");
  });
});
