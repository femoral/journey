import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { JourneysPage } from "../src/pages/JourneysPage";
import { ConsoleContext } from "../src/shell/consoleContext";
import { createConsoleStore } from "../src/shell/consoleStore";
import { EnvContext, type EnvSelection } from "../src/shell/envContext";

const list = {
  journeysDir: "/tmp/demo/journeys",
  files: ["auth.journey.ts", "checkout.journey.ts"],
};

const project = {
  projectDir: "/tmp/demo",
  config: { spec: "openapi.yaml", tlsRejectUnauthorized: true },
  counts: { journeys: 2, environments: 0, endpoints: 0 },
};

const authSource = `journey("auth", (j) => {
  j.step("login", { endpoint: e.login });
});`;

const checkoutSource = `journey("checkout", (j) => {
  j.step("addItem", { endpoint: endpoints.addItem });
  j.step("pay", { endpoint: endpoints.pay });
});`;

function sourceFor(file: string): string {
  if (file === "auth.journey.ts") return authSource;
  if (file === "checkout.journey.ts") return checkoutSource;
  return "";
}

function sseFrames(events: unknown[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}`).join("\n\n") + "\n\n";
}

function streamResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(encoder.encode(text));
      c.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

interface ControllableStream {
  response: Response;
  push(chunk: string): void;
  close(): void;
}

function controllableStreamResponse(initial: string): ControllableStream {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      c.enqueue(encoder.encode(initial));
    },
  });
  return {
    response: new Response(stream, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    }),
    push(chunk) {
      controller.enqueue(encoder.encode(chunk));
    },
    close() {
      controller.close();
    },
  };
}

const runEventsFrames = sseFrames([
  { kind: "run:start", runId: "r1", journeyNames: ["auth flow"] },
  {
    kind: "step:start",
    runId: "r1",
    journeyIdx: 0,
    journeyName: "auth flow",
    stepIdx: 0,
    name: "login",
  },
  {
    kind: "request",
    runId: "r1",
    stepIdx: 0,
    method: "POST",
    url: "https://x/login",
    headers: {},
  },
  {
    kind: "response",
    runId: "r1",
    stepIdx: 0,
    status: 200,
    headers: {},
    body: { token: "t" },
    durationMs: 10,
  },
  {
    kind: "step:end",
    runId: "r1",
    journeyIdx: 0,
    stepIdx: 0,
    ok: true,
    durationMs: 10,
  },
  {
    kind: "run:end",
    runId: "r1",
    ok: true,
    durationMs: 22,
    results: [{ name: "auth flow", ok: true }],
  },
]);

type Captured = { runBody?: unknown; abortedRunIds?: string[] };

interface StubOpts {
  captured?: Captured;
  runEvents?: string | Response;
  runIdByFile?: Record<string, string>;
}

function stubFetch(opts: StubOpts = {}) {
  const captured = opts.captured;
  const eventsBody = opts.runEvents ?? runEventsFrames;
  const runIdByFile = opts.runIdByFile ?? {};
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      const eventMatch = url.match(/\/api\/runs\/([^/]+)\/events$/);
      if (eventMatch) {
        if (typeof eventsBody === "string") return streamResponse(eventsBody);
        return eventsBody;
      }
      const abortMatch = url.match(/\/api\/runs\/([^/]+)\/abort$/);
      if (abortMatch && (init?.method ?? "GET") === "POST") {
        const runId = decodeURIComponent(abortMatch[1]!);
        if (captured) (captured.abortedRunIds ??= []).push(runId);
        return new Response(JSON.stringify({ runId, aborted: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      }
      let body: unknown;
      const runMatch = url.match(/\/api\/journeys\/([^/]+)\/run$/);
      const sourceMatch = url.match(/\/api\/journeys\/([^/]+)$/);
      if (runMatch) {
        const file = decodeURIComponent(runMatch[1]!);
        if (captured && typeof init?.body === "string") {
          try {
            captured.runBody = JSON.parse(init.body);
          } catch {
            captured.runBody = init.body;
          }
        }
        body = { runId: runIdByFile[file] ?? "r1" };
      } else if (sourceMatch && (init?.method ?? "GET") === "GET") {
        const file = decodeURIComponent(sourceMatch[1]!);
        body = { file, source: sourceFor(file) };
      } else if (url.endsWith("/api/journeys")) body = list;
      else if (url.endsWith("/api/runs")) body = [];
      else if (url.endsWith("/api/project")) body = project;
      else if (url.endsWith("/api/endpoints"))
        body = {
          baseUrl: "https://api.test",
          endpoints: [
            { name: "addItem", method: "POST", path: "/cart/items", parameters: [] },
            { name: "pay", method: "POST", path: "/cart/pay", parameters: [] },
          ],
        };
      else body = {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function renderWithConsole(opts: { env?: EnvSelection } = {}) {
  const store = createConsoleStore();
  const inner = () => (
    <ConsoleContext.Provider value={store}>
      <Router>
        <Route path="*" component={JourneysPage} />
      </Router>
    </ConsoleContext.Provider>
  );
  return {
    store,
    result: render(() =>
      opts.env ? <EnvContext.Provider value={opts.env}>{inner()}</EnvContext.Provider> : inner(),
    ),
  };
}

describe("JourneysPage", () => {
  beforeEach(() => {
    localStorage.clear();
    stubFetch();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the EnvContext selection when starting a run", async () => {
    const captured: Captured = {};
    vi.unstubAllGlobals();
    stubFetch({ captured });
    const env: EnvSelection = {
      selectedEnv: () => "ci",
      setSelectedEnv: () => {},
      environments: () => [],
      envValues: () => ({}),
    };
    renderWithConsole({ env });
    await waitFor(() => {
      expect(screen.getByText("auth.journey.ts")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("auth.journey.ts"));
    const runBtn = await waitFor(() => screen.getByTestId("run-button"));
    fireEvent.click(runBtn);
    await waitFor(() => {
      expect(captured.runBody).toMatchObject({ stream: true, env: "ci" });
    });
  });

  it("streams step results over SSE after kickoff and feeds the console", async () => {
    const { store } = renderWithConsole();
    await waitFor(() => {
      expect(screen.getByText("auth.journey.ts")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("auth.journey.ts"));
    const runBtn = await waitFor(() => screen.getByTestId("run-button"));
    fireEvent.click(runBtn);
    await waitFor(() => {
      expect(screen.getByTestId("run-results")).toBeTruthy();
      expect(screen.getByText("login")).toBeTruthy();
      expect(screen.getByText("200")).toBeTruthy();
    });
    // Step icon must transition from idle to pass — the idle badge renders the
    // index "1" as text; after pass, IconCheck renders an SVG instead.
    const stepCard = screen.getByTestId("step-card-0");
    expect(stepCard.querySelector("svg")).toBeTruthy();
    expect(stepCard.textContent?.includes("login")).toBe(true);
    // The shared console store received every frame from the SSE stream.
    await waitFor(() => {
      expect(store.entries().length).toBe(1);
      expect(store.entries()[0]?.state).toBe("pass");
      expect(store.entries()[0]?.status).toBe(200);
    });
  });

  it("renders a sub-journey as a collapsible group row with correct child + sibling status", async () => {
    vi.unstubAllGlobals();
    // A run with one sub-journey node (stepIdx 0) wrapping one child step
    // (stepIdx 1), then a sibling HTTP step (stepIdx 2). This is the shape
    // that broke the flat positional model — the sibling's events must still
    // land on the right row.
    const frames = sseFrames([
      { kind: "run:start", runId: "r1", journeyNames: ["demo"] },
      {
        kind: "step:planned",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "demo",
        stepIdxOffset: 0,
        steps: [
          { kind: "sub", name: "authenticate" },
          { kind: "step", name: "fetch data", method: "GET", path: "/data" },
        ],
      },
      {
        kind: "group:start",
        runId: "r1",
        journeyIdx: 0,
        name: "authenticate",
        childJourneyName: "auth.sub",
        stepIdx: 0,
        firstChildStepIdx: 1,
        cacheStatus: "miss",
      },
      {
        kind: "step:start",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "demo",
        stepIdx: 1,
        name: "login via IDP",
      },
      {
        kind: "request",
        runId: "r1",
        stepIdx: 1,
        requestIdx: 0,
        method: "POST",
        url: "https://idp/token",
        headers: {},
      },
      {
        kind: "response",
        runId: "r1",
        stepIdx: 1,
        requestIdx: 0,
        status: 200,
        headers: {},
        body: { token: "t" },
        durationMs: 5,
      },
      { kind: "step:end", runId: "r1", journeyIdx: 0, stepIdx: 1, ok: true, durationMs: 5 },
      {
        kind: "group:end",
        runId: "r1",
        journeyIdx: 0,
        name: "authenticate",
        childJourneyName: "auth.sub",
        stepIdx: 0,
        lastChildStepIdx: 1,
        ok: true,
        durationMs: 8,
      },
      {
        kind: "step:start",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "demo",
        stepIdx: 2,
        name: "fetch data",
      },
      {
        kind: "request",
        runId: "r1",
        stepIdx: 2,
        requestIdx: 1,
        method: "GET",
        url: "https://x/data",
        headers: {},
      },
      {
        kind: "response",
        runId: "r1",
        stepIdx: 2,
        requestIdx: 1,
        status: 200,
        headers: {},
        body: {},
        durationMs: 6,
      },
      { kind: "step:end", runId: "r1", journeyIdx: 0, stepIdx: 2, ok: true, durationMs: 6 },
      {
        kind: "run:end",
        runId: "r1",
        ok: true,
        durationMs: 20,
        results: [{ name: "demo", ok: true }],
      },
    ]);
    stubFetch({ runEvents: frames });
    renderWithConsole();
    await waitFor(() => {
      expect(screen.getByText("auth.journey.ts")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("auth.journey.ts"));
    fireEvent.click(await waitFor(() => screen.getByTestId("run-button")));

    // Top-level timeline: 2 rows — the sub-journey group, then the sibling step.
    await waitFor(() => {
      expect(screen.getByTestId("step-card-0")).toBeTruthy();
      expect(screen.getByTestId("step-card-1")).toBeTruthy();
    });
    const groupRow = screen.getByTestId("step-card-0");
    expect(groupRow.querySelector('[data-testid="sub-journey-badge"]')).toBeTruthy();
    expect(groupRow.textContent).toContain("authenticate");
    // Badge reflects the child step count.
    expect(groupRow.textContent).toContain("1 step");
    // Group passed → check icon (svg), not stuck running.
    expect(groupRow.querySelector("svg")).toBeTruthy();

    // The sibling HTTP step row carries its own request + 200 — not offset.
    const siblingRow = screen.getByTestId("step-card-1");
    expect(siblingRow.textContent).toContain("fetch data");
    expect(siblingRow.textContent).toContain("https://x/data");
    expect(siblingRow.textContent).toContain("200");

    // Child step is nested — revealed by expanding the group row.
    expect(screen.queryByTestId("substep-card-0")).toBeNull();
    const groupToggle = groupRow.querySelector("button[aria-expanded]") as HTMLButtonElement;
    fireEvent.click(groupToggle);
    await waitFor(() => {
      const child = screen.getByTestId("substep-card-0");
      expect(child.textContent).toContain("login via IDP");
    });
  });

  it("renders parsed steps in an idle state before any run", async () => {
    renderWithConsole();
    await waitFor(() => {
      expect(screen.getByText("checkout.journey.ts")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("checkout.journey.ts"));
    await waitFor(() => {
      expect(screen.getByText("addItem")).toBeTruthy();
      expect(screen.getByText("pay")).toBeTruthy();
    });
    expect(screen.queryByTestId("empty-run")).toBeNull();
    // Idle rows show "—" duration rather than 0ms.
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
    // Pre-resolved method + URL arrive after /api/endpoints resolves.
    await waitFor(() => {
      expect(screen.getAllByText("POST").length).toBeGreaterThanOrEqual(2);
      expect(screen.getByText("https://api.test/cart/items")).toBeTruthy();
      expect(screen.getByText("https://api.test/cart/pay")).toBeTruthy();
    });
  });

  it("shows the awaiting-response copy while a step is in flight", async () => {
    vi.unstubAllGlobals();
    const partialFrames = sseFrames([
      { kind: "run:start", runId: "r1", journeyNames: ["auth"] },
      {
        kind: "step:start",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "auth",
        stepIdx: 0,
        name: "login",
      },
      {
        kind: "request",
        runId: "r1",
        stepIdx: 0,
        method: "POST",
        url: "https://x/login",
        headers: {},
      },
    ]);
    // Use a controllable stream so the run never reaches step:end while we
    // assert. close() at the end of the test is implicit via afterEach.
    const stream = controllableStreamResponse(partialFrames);
    stubFetch({ runEvents: stream.response });
    renderWithConsole();
    await waitFor(() => {
      expect(screen.getByText("auth.journey.ts")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("auth.journey.ts"));
    const runBtn = await waitFor(() => screen.getByTestId("run-button"));
    fireEvent.click(runBtn);
    // login should appear from the live step:start frame
    await waitFor(() => {
      expect(screen.getByText("login")).toBeTruthy();
    });
    // Expand the step card to inspect the detail panel — defaultExpanded is
    // false for in-flight steps (only failures auto-expand).
    const stepCard = screen.getByTestId("step-card-0");
    const toggle = stepCard.querySelector("button[aria-expanded]") as HTMLButtonElement;
    fireEvent.click(toggle);
    await waitFor(() => {
      expect(screen.getByText("Awaiting response…")).toBeTruthy();
    });
    stream.close();
  });

  it("preserves last-run results when switching journeys and back", async () => {
    renderWithConsole();
    await waitFor(() => {
      expect(screen.getByText("auth.journey.ts")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("auth.journey.ts"));
    fireEvent.click(await waitFor(() => screen.getByTestId("run-button")));
    await waitFor(() => {
      expect(screen.getByText("200")).toBeTruthy();
    });
    // Switch to checkout — its idle steps should show.
    fireEvent.click(screen.getByText("checkout.journey.ts"));
    await waitFor(() => {
      expect(screen.getByText("addItem")).toBeTruthy();
    });
    expect(screen.queryByText("200")).toBeNull();
    // Switch back to auth — completed-run results should still be visible
    // without re-running.
    fireEvent.click(screen.getByText("auth.journey.ts"));
    await waitFor(() => {
      expect(screen.getByText("200")).toBeTruthy();
      expect(screen.getByText("login")).toBeTruthy();
    });
  });

  it("Run button swaps to Stop mid-run and clicking it posts to /api/runs/:id/abort", async () => {
    vi.unstubAllGlobals();
    // Live stream that we don't close until after the Stop click, so the
    // button stays in its running state for assertions.
    const partialFrames = sseFrames([
      { kind: "run:start", runId: "r1", journeyNames: ["auth"] },
      {
        kind: "step:start",
        runId: "r1",
        journeyIdx: 0,
        journeyName: "auth",
        stepIdx: 0,
        name: "login",
      },
    ]);
    const stream = controllableStreamResponse(partialFrames);
    const captured: Captured = {};
    stubFetch({ captured, runEvents: stream.response });
    renderWithConsole();
    await waitFor(() => {
      expect(screen.getByText("auth.journey.ts")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("auth.journey.ts"));
    fireEvent.click(await waitFor(() => screen.getByTestId("run-button")));
    // Once the run kicks off the same button switches to Stop (no longer
    // disabled, no more "Run journey" label).
    await waitFor(() => {
      const btn = screen.getByTestId("run-button") as HTMLButtonElement;
      expect(btn.textContent?.includes("Stop")).toBe(true);
      expect(btn.disabled).toBe(false);
    });
    fireEvent.click(screen.getByTestId("run-button"));
    // POST /api/runs/r1/abort fires, label flips to Stopping… and the button
    // disables to block double-clicks until run:end lands.
    await waitFor(() => {
      const btn = screen.getByTestId("run-button") as HTMLButtonElement;
      expect(captured.abortedRunIds).toEqual(["r1"]);
      expect(btn.textContent?.includes("Stopping")).toBe(true);
      expect(btn.disabled).toBe(true);
    });
    // Send the terminal run:end the server would emit once the runtime
    // unwinds — UI returns to its idle "Run journey" state.
    stream.push(
      `data: ${JSON.stringify({
        kind: "run:end",
        runId: "r1",
        ok: false,
        durationMs: 5,
        results: [{ name: "auth", ok: false }],
      })}\n\n`,
    );
    stream.close();
    await waitFor(() => {
      const btn = screen.getByTestId("run-button") as HTMLButtonElement;
      expect(btn.textContent?.includes("Run journey")).toBe(true);
      expect(btn.disabled).toBe(false);
    });
    expect(screen.getByTestId("run-error").textContent).toMatch(/stopped by user/i);
  });

  it("flags cached results as stale when source checksum drifts", async () => {
    // Seed localStorage as if a prior run happened against different source.
    const key = "journey:runState:v1:/tmp/demo:auth.journey.ts";
    const cached = {
      results: [
        {
          name: "auth",
          ok: true,
          durationMs: 10,
          steps: [
            {
              name: "login",
              ok: true,
              durationMs: 10,
              request: { method: "POST", url: "https://x/login" },
              response: { status: 200, headers: {}, body: {} },
            },
          ],
        },
      ],
      runState: "done",
      sourceChecksum: "deadbeef",
      finishedAt: new Date().toISOString(),
    };
    localStorage.setItem(key, JSON.stringify(cached));
    renderWithConsole();
    await waitFor(() => {
      expect(screen.getByText("auth.journey.ts")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("auth.journey.ts"));
    await waitFor(() => {
      expect(screen.getByTestId("stale-badge")).toBeTruthy();
      expect(screen.getByText("login")).toBeTruthy();
    });
  });
});
