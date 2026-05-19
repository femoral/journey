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

  it("emits step:planned with the resolved step list before any step:start", async () => {
    const events: string[] = [];
    const planned: Array<{ journeyName: string; steps: string[]; stepIdxOffset: number }> = [];
    const logger: JourneyLogger = {
      onPlanned(e) {
        planned.push({
          journeyName: e.journeyName,
          steps: e.steps.map((s) => s.name),
          stepIdxOffset: e.stepIdxOffset,
        });
        events.push(`planned:${e.journeyName}:${e.steps.map((s) => s.name).join(",")}`);
      },
      onStepStart(e) {
        events.push(`stepStart#${e.stepIdx}:${e.name}`);
      },
    };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    // Helper-injected step: simulates the registerAuthStep pattern that a
    // static parse of the source can't see, so the GUI relies on the
    // step:planned event to render the full list before each step:start.
    function registerAuthStep(): void {
      step("auth", { endpoint: { method: "GET", path: "/auth", operationId: "auth" } });
    }

    journey("first", () => {
      registerAuthStep();
      step("a", { endpoint: { method: "GET", path: "/a", operationId: "a" } });
    });
    journey("second", () => {
      step("b", { endpoint: { method: "GET", path: "/b", operationId: "b" } });
    });

    await runAllRegistered({ baseUrl: "https://x", fetchImpl, logger });

    // step:planned fires for each journey before that journey's first step:start.
    expect(events).toEqual([
      "planned:first:auth,a",
      "stepStart#0:auth",
      "stepStart#1:a",
      "planned:second:b",
      "stepStart#2:b",
    ]);
    expect(planned).toEqual([
      { journeyName: "first", steps: ["auth", "a"], stepIdxOffset: 0 },
      { journeyName: "second", steps: ["b"], stepIdxOffset: 2 },
    ]);
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

  it("captures the full err.cause chain in StepResult.error on network failure", async () => {
    const inner = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), {
      code: "ECONNREFUSED",
    });
    const outer = new Error("fetch failed", { cause: inner });
    const fetchImpl = vi.fn(async () => {
      throw outer;
    });

    journey("net-fail", () => {
      step("hit", { endpoint: { method: "GET", path: "/x", operationId: "x" } });
    });

    const [result] = await runAllRegistered({ baseUrl: "https://x", fetchImpl });
    const stepErr = result!.steps[0]!.error!;
    expect(stepErr).toContain("fetch failed");
    expect(stepErr).toContain("connect ECONNREFUSED 127.0.0.1:443");
    expect(stepErr).toContain("(ECONNREFUSED)");
    expect(stepErr).toContain(" ← ");
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

  it("aborts in-flight fetch when ctx.signal fires and marks the run not-ok", async () => {
    const controller = new AbortController();
    // fetchImpl that honours init.signal — when aborted, reject like global
    // fetch would so the runtime takes its error path.
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      return await new Promise<Response>((_resolve, reject) => {
        const sig = init?.signal;
        if (sig?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        sig?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });

    journey("hang", () => {
      step("slow", { endpoint: { method: "GET", path: "/x", operationId: "x" } });
      step("never", { endpoint: { method: "GET", path: "/y", operationId: "y" } });
    });

    const runPromise = runAllRegistered({
      baseUrl: "https://x",
      fetchImpl,
      signal: controller.signal,
    });
    // Yield once so the runtime dispatches the first fetch, then abort.
    await new Promise((r) => setTimeout(r, 0));
    controller.abort();

    const [result] = await runPromise;
    expect(result!.ok).toBe(false);
    // The first (aborted) step records an error and halts the loop — the
    // second step never runs.
    expect(result!.steps).toHaveLength(1);
    expect(result!.steps[0]!.error).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
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
