import { describe, expect, it } from "vitest";
import { createRoot } from "solid-js";
import { createConsoleStore, toCurl } from "../src/shell/consoleStore";
import type { RunEvent } from "../src/api/runEvents";

function runEvents(events: RunEvent[]): ReturnType<typeof createConsoleStore> {
  return createRoot(() => {
    const store = createConsoleStore();
    for (const e of events) store.ingest(e);
    return store;
  });
}

describe("consoleStore.ingest", () => {
  it("builds one entry per request with method/url/status from the surrounding step", () => {
    const store = runEvents([
      { kind: "run:start", runId: "r1", journeyNames: ["j"] },
      {
        kind: "step:start",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "j",
        stepIdx: 0,
        name: "login",
      },
      {
        kind: "request",
        runId: "r1",
        stepIdx: 0,
        requestIdx: 0,
        method: "POST",
        url: "https://x/login",
        headers: { Authorization: "Bearer secret" },
        body: { u: "x" },
      },
      {
        kind: "response",
        runId: "r1",
        stepIdx: 0,
        requestIdx: 0,
        status: 200,
        headers: { "content-type": "application/json" },
        body: { token: "t" },
        durationMs: 12,
      },
      {
        kind: "step:end",
        runId: "r1",
        journeyIdx: 0,
        stepIdx: 0,
        ok: true,
        durationMs: 12,
      },
      {
        kind: "run:end",
        runId: "r1",
        ok: true,
        durationMs: 20,
        results: [{ name: "j", ok: true }],
      },
    ]);
    const [entry] = store.entries();
    expect(store.entries()).toHaveLength(1);
    expect(entry).toMatchObject({
      runId: "r1",
      stepIdx: 0,
      stepName: "login",
      journeyName: "j",
      method: "POST",
      url: "https://x/login",
      status: 200,
      durationMs: 12,
      state: "pass",
    });
    expect(entry?.size).toBeGreaterThan(0);
  });

  it("appends a separate entry per request when a step makes multiple HTTP calls", () => {
    // Mirrors the auth-helper flow: the step's primary request, then two
    // helper-issued fetches inside the after hook (different requestIdx values).
    const store = runEvents([
      {
        kind: "step:start",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "j",
        stepIdx: 0,
        name: "auth",
      },
      {
        kind: "request",
        runId: "r1",
        stepIdx: 0,
        requestIdx: 0,
        method: "GET",
        url: "https://api/health",
        headers: {},
      },
      {
        kind: "response",
        runId: "r1",
        stepIdx: 0,
        requestIdx: 0,
        status: 200,
        headers: {},
        body: { ok: true },
        durationMs: 5,
      },
      {
        kind: "request",
        runId: "r1",
        stepIdx: 0,
        requestIdx: 1,
        method: "POST",
        url: "https://idp/token",
        headers: {},
      },
      {
        kind: "response",
        runId: "r1",
        stepIdx: 0,
        requestIdx: 1,
        status: 200,
        headers: {},
        body: { jwt: "x" },
        durationMs: 7,
      },
      {
        kind: "request",
        runId: "r1",
        stepIdx: 0,
        requestIdx: 2,
        method: "POST",
        url: "https://idp/customer-key",
        headers: {},
      },
      {
        kind: "response",
        runId: "r1",
        stepIdx: 0,
        requestIdx: 2,
        status: 200,
        headers: {},
        body: { key: "y" },
        durationMs: 9,
      },
    ]);
    expect(store.entries()).toHaveLength(3);
    expect(store.entries().map((e) => e.url)).toEqual([
      "https://api/health",
      "https://idp/token",
      "https://idp/customer-key",
    ]);
    // All three rows are labeled with the surrounding step.
    expect(store.entries().every((e) => e.stepName === "auth")).toBe(true);
  });

  it("creates a fail entry on error frame and records the message in logs", () => {
    const store = runEvents([
      {
        kind: "step:start",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "j",
        stepIdx: 0,
        name: "boom",
      },
      {
        kind: "error",
        runId: "r1",
        stepIdx: 0,
        requestIdx: 0,
        message: "ECONNREFUSED",
        durationMs: 5,
      },
      {
        kind: "step:end",
        runId: "r1",
        journeyIdx: 0,
        stepIdx: 0,
        ok: false,
        durationMs: 5,
        error: "ECONNREFUSED",
      },
    ]);
    const [entry] = store.entries();
    expect(entry?.state).toBe("fail");
    expect(entry?.error).toBe("ECONNREFUSED");
    expect(store.logs()).toHaveLength(1);
    expect(store.logs()[0]?.level).toBe("error");
  });

  it("appends entries in request firing order across multiple steps", () => {
    const store = runEvents([
      {
        kind: "step:start",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "j",
        stepIdx: 0,
        name: "a",
      },
      {
        kind: "request",
        runId: "r1",
        stepIdx: 0,
        requestIdx: 0,
        method: "GET",
        url: "https://x/a",
        headers: {},
      },
      {
        kind: "step:start",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "j",
        stepIdx: 1,
        name: "b",
      },
      {
        kind: "request",
        runId: "r1",
        stepIdx: 1,
        requestIdx: 1,
        method: "GET",
        url: "https://x/b",
        headers: {},
      },
    ]);
    expect(store.entries().map((e) => e.stepName)).toEqual(["a", "b"]);
  });
});

describe("consoleStore log events", () => {
  it("appends log events to the logs array with the step name when available", () => {
    const store = runEvents([
      {
        kind: "step:start",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "j",
        stepIdx: 0,
        name: "login",
      },
      { kind: "log", runId: "r1", stepIdx: 0, level: "info", text: "got token t" },
      { kind: "log", runId: "r1", stepIdx: 0, level: "warn", text: "slow" },
    ]);
    expect(store.logs()).toHaveLength(2);
    expect(store.logs()[0]).toMatchObject({
      level: "info",
      text: "got token t",
      stepName: "login",
    });
    expect(store.logs()[1]?.level).toBe("warn");
  });

  it("labels run-scope logs (stepIdx=-1) as (run)", () => {
    const store = runEvents([
      { kind: "log", runId: "r1", stepIdx: -1, level: "info", text: "booting" },
    ]);
    expect(store.logs()[0]?.stepName).toBe("(run)");
  });
});

describe("consoleStore.ingestSynthetic", () => {
  it("adds and updates a one-off entry without SSE events", () => {
    createRoot(() => {
      const store = createConsoleStore();
      store.ingestSynthetic({
        runId: "oneoff-1",
        stepIdx: 0,
        stepName: "GET pets",
        method: "GET",
        url: "https://api/pets",
        state: "running",
      });
      store.ingestSynthetic({
        runId: "oneoff-1",
        stepIdx: 0,
        stepName: "GET pets",
        method: "GET",
        url: "https://api/pets",
        status: 200,
        durationMs: 15,
        state: "pass",
      });
      expect(store.entries()).toHaveLength(1);
      expect(store.entries()[0]?.status).toBe(200);
      expect(store.entries()[0]?.state).toBe("pass");
    });
  });
});

describe("toCurl", () => {
  it("renders a valid curl command from an entry", () => {
    const curl = toCurl({
      id: "r1:0",
      runId: "r1",
      stepIdx: 0,
      stepName: "login",
      method: "POST",
      url: "https://api/login",
      requestHeaders: { "content-type": "application/json" },
      requestBody: { u: "x" },
      state: "pass",
      timestamp: 0,
    });
    expect(curl).toContain("curl -X POST");
    expect(curl).toContain("-H 'content-type: application/json'");
    expect(curl).toContain('--data \'{"u":"x"}\'');
    expect(curl).toContain("'https://api/login'");
  });

  it("returns empty string when the entry has no method/url", () => {
    expect(
      toCurl({
        id: "x",
        runId: "x",
        stepIdx: 0,
        stepName: "noop",
        state: "running",
        timestamp: 0,
      }),
    ).toBe("");
  });
});
