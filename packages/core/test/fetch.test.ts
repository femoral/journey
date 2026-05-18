import { afterEach, describe, expect, it, vi } from "vitest";
import { fetch as instrumentedFetch } from "../src/fetch.js";
import { clearRegistry, journey, runAllRegistered, step } from "../src/runtime.js";
import type { JourneyLogger, RequestLog, ResponseLog } from "../src/logger.js";

const realFetch = globalThis.fetch;

afterEach(() => {
  clearRegistry();
  globalThis.fetch = realFetch;
});

describe("instrumented fetch", () => {
  it("passes through when called outside a run context", async () => {
    const fakeRes = new Response("ok", { status: 201 });
    const stub = vi.fn().mockResolvedValue(fakeRes);
    globalThis.fetch = stub as unknown as typeof fetch;

    const res = await instrumentedFetch("https://x/y");
    expect(res).toBe(fakeRes);
    expect(stub).toHaveBeenCalledTimes(1);
    expect(stub.mock.calls[0]![0]).toBe("https://x/y");
  });

  it("routes onRequest + onResponse through the active ctx logger", async () => {
    const requests: RequestLog[] = [];
    const responses: Array<{ req: RequestLog; res: ResponseLog }> = [];
    const logger: JourneyLogger = {
      onRequest(req) {
        requests.push(req);
      },
      onResponse(req, res) {
        responses.push({ req, res });
      },
    };

    // Inside the step's `after` hook, the wrapper should see the active ctx
    // and forward through the logger. The step's primary request is served by
    // a separate fetchImpl on the ctx — we want the global fetch (used by the
    // wrapper) routed independently.
    const wrappedCalls: string[] = [];
    globalThis.fetch = (async (url: string) => {
      wrappedCalls.push(url);
      return new Response(JSON.stringify({ token: "abc" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const ctxFetch = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    journey("with helper fetch", () => {
      step("primary", {
        endpoint: { method: "GET", path: "/a", operationId: "a" },
        async after() {
          await instrumentedFetch("https://auth.example.com/token", {
            method: "POST",
            headers: { "x-tenant": "acme" },
            body: JSON.stringify({ grant_type: "client_credentials" }),
          });
        },
      });
    });

    await runAllRegistered({ baseUrl: "https://x", fetchImpl: ctxFetch, logger });

    expect(wrappedCalls).toEqual(["https://auth.example.com/token"]);
    // First request is the step's own (logged by http.execute), second is the
    // wrapper's. Filter by URL to isolate.
    const helperReq = requests.find((r) => r.url === "https://auth.example.com/token");
    expect(helperReq).toBeDefined();
    expect(helperReq!.method).toBe("POST");
    expect(helperReq!.headers).toEqual({ "x-tenant": "acme" });
    expect(helperReq!.body).toEqual({ grant_type: "client_credentials" });

    const helperRes = responses.find((r) => r.req.url === "https://auth.example.com/token");
    expect(helperRes).toBeDefined();
    expect(helperRes!.res.status).toBe(200);
    expect(helperRes!.res.body).toEqual({ token: "abc" });
  });

  it("fires onError and re-throws when the underlying fetch rejects", async () => {
    const boom = new Error("ECONNREFUSED");
    globalThis.fetch = (async () => {
      throw boom;
    }) as unknown as typeof fetch;

    const errors: Array<{ req: RequestLog; err: unknown }> = [];
    const logger: JourneyLogger = {
      onError(req, err) {
        errors.push({ req, err });
      },
    };

    const ctxFetch = vi
      .fn()
      .mockResolvedValue(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      );

    let caught: unknown;
    journey("helper throws", () => {
      step("primary", {
        endpoint: { method: "GET", path: "/a", operationId: "a" },
        async after() {
          try {
            await instrumentedFetch("https://auth.example.com/token");
          } catch (e) {
            caught = e;
          }
        },
      });
    });

    await runAllRegistered({ baseUrl: "https://x", fetchImpl: ctxFetch, logger });

    expect(caught).toBe(boom);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.err).toBe(boom);
    expect(errors[0]!.req.url).toBe("https://auth.example.com/token");
  });

  it("does not consume the original response body", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ token: "xyz" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;

    const logger: JourneyLogger = { onRequest() {}, onResponse() {} };
    const ctxFetch = vi
      .fn()
      .mockResolvedValue(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      );

    let consumed: unknown;
    journey("body-readback", () => {
      step("primary", {
        endpoint: { method: "GET", path: "/a", operationId: "a" },
        async after() {
          const res = await instrumentedFetch("https://x/y");
          consumed = await res.json();
        },
      });
    });

    await runAllRegistered({ baseUrl: "https://x", fetchImpl: ctxFetch, logger });

    expect(consumed).toEqual({ token: "xyz" });
  });
});
