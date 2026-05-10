import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearRegistry,
  getRegisteredJourneys,
  journey,
  runAllRegistered,
  step,
} from "../src/runtime.js";
import { expect as jExpect } from "../src/expect.js";
import type { JourneyLogger } from "../src/logger.js";

afterEach(() => clearRegistry());

describe("runtime", () => {
  it("runs steps sequentially with closure state", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "t1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 1 }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );

    journey("auth then fetch", () => {
      let token = "";
      step("auth", {
        endpoint: { method: "POST", path: "/auth", operationId: "auth" },
        body: { u: "x" },
        after(res) {
          token = (res.body as { token: string }).token;
        },
      });
      step("me", {
        endpoint: { method: "GET", path: "/me", operationId: "me" },
        headers: () => ({ Authorization: `Bearer ${token}` }),
        assert(res) {
          jExpect(res.status).toBe(200);
        },
      });
    });

    expect(getRegisteredJourneys()).toHaveLength(1);
    const results = await runAllRegistered({ baseUrl: "https://api.example.com", fetchImpl });
    expect(results).toHaveLength(1);
    expect(results[0]!.ok).toBe(true);
    expect(results[0]!.steps.map((s) => s.ok)).toEqual([true, true]);

    const secondCall = fetchImpl.mock.calls[1]!;
    const init = secondCall[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t1");
  });

  it("emits run and step lifecycle events with a shared runId", async () => {
    const events: string[] = [];
    let seenRunId: string | undefined;
    const logger: JourneyLogger = {
      onRunStart(e) {
        seenRunId = e.runId;
        events.push(`runStart:${e.journeyNames.join(",")}`);
      },
      onStepStart(e) {
        expect(e.runId).toBe(seenRunId);
        events.push(`stepStart#${e.stepIdx}:${e.name}`);
      },
      onStepEnd(e) {
        expect(e.runId).toBe(seenRunId);
        events.push(`stepEnd#${e.stepIdx}:${e.ok ? "pass" : "fail"}`);
      },
      onRunEnd(e) {
        expect(e.runId).toBe(seenRunId);
        events.push(`runEnd:${e.ok ? "pass" : "fail"}:${e.results.length}`);
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    journey("two-step", () => {
      step("a", { endpoint: { method: "GET", path: "/a", operationId: "a" } });
      step("b", { endpoint: { method: "GET", path: "/b", operationId: "b" } });
    });

    await runAllRegistered({ baseUrl: "https://x", fetchImpl, logger }, { runId: "fixed-run-id" });

    expect(seenRunId).toBe("fixed-run-id");
    expect(events).toEqual([
      "runStart:two-step",
      "stepStart#0:a",
      "stepEnd#0:pass",
      "stepStart#1:b",
      "stepEnd#1:pass",
      "runEnd:pass:1",
    ]);
  });

  it("emits stepEnd with error and runEnd ok=false when a step fails", async () => {
    const events: string[] = [];
    const logger: JourneyLogger = {
      onStepEnd(e) {
        events.push(`stepEnd#${e.stepIdx}:${e.ok}:${e.error ?? ""}`);
      },
      onRunEnd(e) {
        events.push(`runEnd:${e.ok}`);
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("{}", { status: 500, headers: { "content-type": "application/json" } }),
      );

    journey("will fail", () => {
      step("boom", {
        endpoint: { method: "GET", path: "/x", operationId: "x" },
        assert(res) {
          jExpect(res.status).toBe(200);
        },
      });
    });

    await runAllRegistered({ baseUrl: "https://x", fetchImpl, logger });

    expect(events[0]).toMatch(/stepEnd#0:false:expected 500 to be 200/);
    expect(events[1]).toBe("runEnd:false");
  });

  it("increments stepIdx across journey boundaries within one run", async () => {
    const starts: number[] = [];
    const logger: JourneyLogger = {
      onStepStart(e) {
        starts.push(e.stepIdx);
      },
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response("{}", { status: 200, headers: { "content-type": "application/json" } }),
      );

    journey("first", () => {
      step("a", { endpoint: { method: "GET", path: "/a", operationId: "a" } });
      step("b", { endpoint: { method: "GET", path: "/b", operationId: "b" } });
    });
    journey("second", () => {
      step("c", { endpoint: { method: "GET", path: "/c", operationId: "c" } });
    });

    await runAllRegistered({ baseUrl: "https://x", fetchImpl, logger });

    expect(starts).toEqual([0, 1, 2]);
  });

  it("stops after upToStepIdx even when more steps are registered", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    journey("three-step", () => {
      step("a", { endpoint: { method: "GET", path: "/a", operationId: "a" } });
      step("b", { endpoint: { method: "GET", path: "/b", operationId: "b" } });
      step("c", { endpoint: { method: "GET", path: "/c", operationId: "c" } });
    });

    const [result] = await runAllRegistered(
      { baseUrl: "https://x", fetchImpl },
      { upToStepIdx: 1 },
    );
    expect(result!.steps.map((s) => s.name)).toEqual(["a", "b"]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("halts on first failing step", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    journey("fails", () => {
      step("a", {
        endpoint: { method: "GET", path: "/a", operationId: "a" },
        assert(res) {
          jExpect(res.status).toBe(200);
        },
      });
      step("b", { endpoint: { method: "GET", path: "/b", operationId: "b" } });
    });

    const [result] = await runAllRegistered({ baseUrl: "https://x", fetchImpl });
    expect(result!.ok).toBe(false);
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0]!.error).toMatch(/expected 500 to be 200/);
  });

  describe("journey() options overload", () => {
    it("records options on the registered def with the 3-arg form", () => {
      journey("tagged", { tags: ["load", "checkout"], k6: { vus: 10, duration: "30s" } }, () => {});
      const [def] = getRegisteredJourneys();
      expect(def!.name).toBe("tagged");
      expect(def!.options).toEqual({
        tags: ["load", "checkout"],
        k6: { vus: 10, duration: "30s" },
      });
    });

    it("leaves options undefined for the 2-arg form", () => {
      journey("plain", () => {});
      const [def] = getRegisteredJourneys();
      expect(def!.options).toBeUndefined();
    });

    it("step() outside a body still throws (registry inspection is side-effect free)", () => {
      journey("with-options", { tags: ["x"] }, () => {});
      expect(() =>
        step("orphan", { endpoint: { method: "GET", path: "/x", operationId: "x" } }),
      ).toThrow(/called outside a journey/);
    });
  });
});
