import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  clearRegistry,
  getRegisteredJourneys,
  invokeJourney,
  journey,
  output,
  runAllRegistered,
  step,
} from "../src/runtime.js";
import { expect as jExpect } from "../src/expect.js";
import type { GroupEndEvent, GroupStartEvent, JourneyLogger } from "../src/logger.js";

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

  describe("sub-journeys", () => {
    function jsonResponse(body: unknown, status = 200): Response {
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }

    it("invokeJourney runs the child pipeline inline and surfaces output via after()", async () => {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce(jsonResponse({ access_token: "t-42" }))
        .mockResolvedValueOnce(jsonResponse([{ id: 1, name: "rex" }]));

      const acquireToken = journey(
        "auth.acquire-token",
        {
          reusable: true,
          inputs: z.object({ user: z.string() }),
          outputs: z.object({ token: z.string() }),
        },
        (input) => {
          step("exchange", {
            endpoint: { method: "POST", path: "/token", operationId: "token" },
            body: () => ({ user: input.user }),
            after: (res) => output({ token: (res.body as { access_token: string }).access_token }),
          });
        },
      );

      let captured = "";
      journey("checkout", () => {
        invokeJourney(acquireToken, {
          inputs: { user: "alice" },
          after: (out) => {
            captured = out.token;
          },
        });
        step("list", {
          endpoint: { method: "GET", path: "/pets", operationId: "pets" },
          headers: () => ({ Authorization: `Bearer ${captured}` }),
        });
      });

      const [result] = await runAllRegistered({ baseUrl: "https://x", fetchImpl });
      expect(result!.ok).toBe(true);
      expect(captured).toBe("t-42");

      // The /pets request should have carried the bearer token captured by the sub-journey.
      const secondInit = fetchImpl.mock.calls[1]![1] as RequestInit;
      expect((secondInit.headers as Record<string, string>).Authorization).toBe("Bearer t-42");

      // Result shape: sub-journey node carries kind:"sub" + children.
      expect(result!.steps).toHaveLength(2);
      const sub = result!.steps[0]!;
      expect(sub.kind).toBe("sub");
      expect(sub.name).toBe("auth.acquire-token");
      expect(sub.children).toHaveLength(1);
      expect(sub.children![0]!.name).toBe("exchange");
    });

    it("emits group:start/group:end bracketing the child step events", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ access_token: "t" }));
      const events: string[] = [];
      const logger: JourneyLogger = {
        onStepStart(e) {
          events.push(`stepStart#${e.stepIdx}:${e.name}`);
        },
        onStepEnd(e) {
          events.push(`stepEnd#${e.stepIdx}`);
        },
        onGroupStart(e: GroupStartEvent) {
          events.push(`groupStart#${e.stepIdx}->${e.firstChildStepIdx}:${e.name}`);
        },
        onGroupEnd(e: GroupEndEvent) {
          events.push(`groupEnd#${e.stepIdx}..${e.lastChildStepIdx}:${e.ok ? "pass" : "fail"}`);
        },
      };

      const child = journey("child", { reusable: true }, () => {
        step("inner", { endpoint: { method: "GET", path: "/a", operationId: "a" } });
      });
      journey("parent", () => {
        invokeJourney(child, {});
      });

      await runAllRegistered({ baseUrl: "https://x", fetchImpl, logger });

      // Parent run has one pipeline node (a sub) at stepIdx 0; its single child at stepIdx 1.
      expect(events).toEqual([
        "groupStart#0->1:child",
        "stepStart#1:inner",
        "stepEnd#1",
        "groupEnd#0..1:pass",
      ]);
    });

    it("input schema mismatch fails the sub-journey node without running any child step", async () => {
      const fetchImpl = vi.fn();
      const child = journey(
        "needs-user",
        { reusable: true, inputs: z.object({ user: z.string() }) },
        () => {
          step("ping", { endpoint: { method: "GET", path: "/ping", operationId: "p" } });
        },
      );
      journey("parent", () => {
        // @ts-expect-error — deliberate runtime escape to hit the validator.
        invokeJourney(child, { inputs: { user: 42 } });
      });

      const [result] = await runAllRegistered({ baseUrl: "https://x", fetchImpl });
      expect(result!.ok).toBe(false);
      expect(result!.steps).toHaveLength(1);
      expect(result!.steps[0]!.error).toMatch(/input validation failed/);
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("child journey that never calls output() with a non-nullable outputs schema fails the node", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
      const child = journey(
        "needs-output",
        { reusable: true, outputs: z.object({ token: z.string() }) },
        () => {
          step("noop", { endpoint: { method: "GET", path: "/x", operationId: "x" } });
        },
      );
      journey("parent", () => {
        invokeJourney(child, {});
      });

      const [result] = await runAllRegistered({ baseUrl: "https://x", fetchImpl });
      expect(result!.ok).toBe(false);
      expect(result!.steps[0]!.error).toMatch(/did not call output\(\)/);
    });

    it("failure inside a child step halts the parent pipeline and the sibling step never runs", async () => {
      const fetchImpl = vi.fn().mockResolvedValueOnce(jsonResponse({}, 500));
      const child = journey("fails", { reusable: true }, () => {
        step("boom", {
          endpoint: { method: "GET", path: "/x", operationId: "x" },
          assert(res) {
            jExpect(res.status).toBe(200);
          },
        });
      });
      journey("parent", () => {
        invokeJourney(child, {});
        step("never", { endpoint: { method: "GET", path: "/y", operationId: "y" } });
      });

      const [result] = await runAllRegistered({ baseUrl: "https://x", fetchImpl });
      expect(result!.ok).toBe(false);
      expect(result!.steps).toHaveLength(1);
      expect(result!.steps[0]!.error).toMatch(
        /sub-journey "fails" failed at step "boom": expected 500 to be 200/,
      );
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    });

    it("nested sub-journeys: a child can invoke another child, output flows up two levels", async () => {
      const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ v: "inner-v" }));
      const inner = journey(
        "inner",
        { reusable: true, outputs: z.object({ v: z.string() }) },
        () => {
          step("hit", {
            endpoint: { method: "GET", path: "/i", operationId: "i" },
            after: (res) => output({ v: (res.body as { v: string }).v }),
          });
        },
      );
      const outer = journey(
        "outer",
        { reusable: true, outputs: z.object({ wrapped: z.string() }) },
        () => {
          invokeJourney(inner, {
            after: (out) => output({ wrapped: `[${out.v}]` }),
          });
        },
      );

      let received = "";
      journey("top", () => {
        invokeJourney(outer, {
          after: (out) => {
            received = out.wrapped;
          },
        });
      });

      const [result] = await runAllRegistered({ baseUrl: "https://x", fetchImpl });
      expect(result!.ok).toBe(true);
      expect(received).toBe("[inner-v]");
    });

    it("footgun guard: a reusable journey accidentally registered as entry fails fast", async () => {
      const fetchImpl = vi.fn();
      // Bypass the type system the way an `as any` user would: hand-roll an
      // entry def with an inputs schema and stuff it into the registry.
      journey(
        "fake-entry",
        { tags: ["bogus"] } as never, // satisfy the overload signature
        () => {},
      );
      // Mutate after registration to simulate the JS-only escape.
      const [def] = getRegisteredJourneys();
      (def as { options: { inputs?: unknown } }).options.inputs = z.object({ x: z.string() });

      await expect(runAllRegistered({ baseUrl: "https://x", fetchImpl })).rejects.toThrow(
        /declares an inputs\/outputs schema but is registered as an entry/,
      );
    });

    it("invokeJourney called outside a journey body throws", () => {
      const handle = journey("standalone", { reusable: true }, () => {});
      expect(() => invokeJourney(handle, {})).toThrow(/called outside a journey/);
    });
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
