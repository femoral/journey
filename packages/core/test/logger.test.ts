import { describe, expect, it, vi } from "vitest";
import {
  createConsoleLogger,
  describeError,
  loggerFromEnv,
  maskHeaders,
  SECRET_HEADERS,
} from "../src/logger.js";
import { execute } from "../src/http.js";

describe("maskHeaders", () => {
  it("redacts secret headers case-insensitively", () => {
    expect(maskHeaders({ Authorization: "Bearer x", Accept: "json", Cookie: "a=b" })).toEqual({
      Authorization: "***",
      Accept: "json",
      Cookie: "***",
    });
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
    const fetchImpl = vi.fn(
      async () =>
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

  it("onError formats the full cause chain", async () => {
    const lines: string[] = [];
    const logger = createConsoleLogger({ write: (l) => lines.push(l) });
    const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
      code: "ECONNREFUSED",
    });
    const middle = new Error("Other side closed", { cause: inner });
    const outer = new Error("fetch failed", { cause: middle });
    const fetchImpl = vi.fn(async () => {
      throw outer;
    });
    await expect(
      execute({ method: "GET", url: "https://x", headers: {} }, { fetchImpl, logger }),
    ).rejects.toBe(outer);
    const errLine = lines.find((l) => l.startsWith("✗"));
    expect(errLine).toContain("fetch failed");
    expect(errLine).toContain("Other side closed");
    expect(errLine).toContain("connect ECONNREFUSED 127.0.0.1:443");
    expect(errLine).toContain("(ECONNREFUSED)");
    expect(errLine).toContain(" ← ");
  });
});

describe("describeError", () => {
  it("returns the bare message when no cause is set", () => {
    expect(describeError(new Error("boom"))).toBe("boom");
  });

  it("walks err.cause up to depth links, joined with ` ← `", () => {
    const a = Object.assign(new Error("unable to verify the first certificate"), {
      code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
    });
    const b = new Error("fetch failed", { cause: a });
    expect(describeError(b)).toBe(
      "fetch failed ← unable to verify the first certificate (UNABLE_TO_VERIFY_LEAF_SIGNATURE)",
    );
  });

  it("caps depth so a self-referential chain cannot run away", () => {
    const a: { message: string; cause?: unknown } = { message: "a" };
    a.cause = a;
    const result = describeError(a, 3);
    expect(result.split(" ← ")).toHaveLength(3);
  });

  it("falls back to String(err) for non-Error values", () => {
    expect(describeError("plain string")).toBe("plain string");
    expect(describeError(undefined)).toBe("undefined");
  });
});
