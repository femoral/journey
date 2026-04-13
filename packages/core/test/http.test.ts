import { describe, expect, it, vi } from "vitest";
import type { Endpoint } from "../src/endpoint.js";
import { buildRequest, execute, resolveUrl } from "../src/http.js";

describe("resolveUrl", () => {
  it("uses ctx baseUrl for refs and interpolates params", () => {
    const ep: Endpoint = { method: "GET", path: "/pets/{id}", operationId: "getPet" };
    expect(
      resolveUrl(ep, { baseUrl: "https://api.example.com" }, { id: 42 }, undefined),
    ).toBe("https://api.example.com/pets/42");
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
    expect(resolveUrl(ep, { baseUrl: "https://x" }, undefined, { limit: 10, skip: undefined }))
      .toBe("https://x/pets?limit=10");
  });
});

describe("buildRequest + execute", () => {
  it("sets JSON content-type and calls fetchImpl", async () => {
    const fetchImpl = vi.fn(async () =>
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
