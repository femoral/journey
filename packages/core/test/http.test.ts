import { describe, expect, it, vi } from "vitest";
import type { Endpoint } from "../src/endpoint.js";
import { buildRequest, execute, resolveUrl } from "../src/http.js";

describe("resolveUrl", () => {
  it("uses ctx baseUrl for refs and interpolates params", () => {
    const ep: Endpoint = { method: "GET", path: "/pets/{id}", operationId: "getPet" };
    expect(resolveUrl(ep, { baseUrl: "https://api.example.com" }, { id: 42 }, undefined)).toBe(
      "https://api.example.com/pets/42",
    );
  });

  it("descriptor baseUrl overrides ctx", () => {
    const ep: Endpoint = { method: "GET", path: "/x", baseUrl: "https://other.example.com" };
    expect(resolveUrl(ep, { baseUrl: "https://api.example.com" }, undefined, undefined)).toBe(
      "https://other.example.com/x",
    );
  });

  it("throws on missing param", () => {
    const ep: Endpoint = { method: "GET", path: "/pets/{id}", operationId: "g" };
    expect(() => resolveUrl(ep, { baseUrl: "https://x" }, undefined, undefined)).toThrow(
      /Missing path param "id"/,
    );
  });

  it("appends query", () => {
    const ep: Endpoint = { method: "GET", path: "/pets", operationId: "l" };
    expect(
      resolveUrl(ep, { baseUrl: "https://x" }, undefined, { limit: 10, skip: undefined }),
    ).toBe("https://x/pets?limit=10");
  });

  it("preserves a base path even when endpoint.path starts with /", () => {
    const ep: Endpoint = { method: "GET", path: "/pet/findByStatus", operationId: "f" };
    expect(
      resolveUrl(ep, { baseUrl: "https://petstore3.swagger.io/api/v3" }, undefined, undefined),
    ).toBe("https://petstore3.swagger.io/api/v3/pet/findByStatus");
  });

  it("empty path resolves to base without trailing slash", () => {
    const ep: Endpoint = {
      method: "POST",
      path: "",
      baseUrl: "https://api.example.com/auth/token",
    };
    expect(resolveUrl(ep, {}, undefined, undefined)).toBe("https://api.example.com/auth/token");
  });

  it("empty path preserves an existing trailing slash on base", () => {
    const ep: Endpoint = {
      method: "POST",
      path: "",
      baseUrl: "https://api.example.com/auth/token/",
    };
    expect(resolveUrl(ep, {}, undefined, undefined)).toBe("https://api.example.com/auth/token/");
  });

  it("empty path with query appends without forcing a slash", () => {
    const ep: Endpoint = {
      method: "POST",
      path: "",
      baseUrl: "https://api.example.com/auth/token",
    };
    expect(resolveUrl(ep, {}, undefined, { grant_type: "client_credentials" })).toBe(
      "https://api.example.com/auth/token?grant_type=client_credentials",
    );
  });
});

describe("HttpContext.dispatcher", () => {
  it("forwards ctx.dispatcher to fetch as init.dispatcher", async () => {
    const dispatcher = { tag: "fake-agent" };
    const seen: Array<{ init?: unknown }> = [];
    const fetchImpl = vi.fn(async (_url: Parameters<typeof fetch>[0], init?: RequestInit) => {
      seen.push({ init });
      return new Response("{}", { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch;
    await execute({ method: "GET", url: "https://x/ping", headers: {} }, { fetchImpl, dispatcher });
    expect((seen[0]!.init as { dispatcher?: unknown }).dispatcher).toBe(dispatcher);
  });
});

describe("buildRequest + execute", () => {
  it("sets JSON content-type and calls fetchImpl", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
    );
    const ctx = { baseUrl: "https://api.example.com", fetchImpl };
    const req = buildRequest(
      {
        endpoint: { method: "POST", path: "/x", operationId: "c" },
        body: { a: 1 },
      },
      ctx,
    );
    expect(req.headers["Content-Type"]).toBe("application/json");
    const res = await execute(req, ctx);
    expect(res.status).toBe(201);
    expect(res.body).toEqual({ ok: true });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
});
