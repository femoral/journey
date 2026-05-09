import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { JourneysPage } from "../src/pages/JourneysPage";
import { ConsoleContext } from "../src/shell/consoleContext";
import { createConsoleStore } from "../src/shell/consoleStore";
import { EnvContext, type EnvSelection } from "../src/shell/envContext";

const list = { journeysDir: "/tmp/demo/journeys", files: ["auth.journey.ts"] };

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

type Captured = { runBody?: unknown };

function stubFetch(captured?: Captured) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/runs/r1/events")) {
        return streamResponse(runEventsFrames);
      }
      let body: unknown;
      if (url.endsWith("/run")) {
        if (captured && typeof init?.body === "string") {
          try {
            captured.runBody = JSON.parse(init.body);
          } catch {
            captured.runBody = init.body;
          }
        }
        body = { runId: "r1" };
      } else if (url.endsWith("/api/journeys")) body = list;
      else if (url.endsWith("/api/runs")) body = [];
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
  beforeEach(() => stubFetch());
  afterEach(() => vi.unstubAllGlobals());

  it("forwards the EnvContext selection when starting a run", async () => {
    const captured: Captured = {};
    vi.unstubAllGlobals();
    stubFetch(captured);
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
    // The shared console store received every frame from the SSE stream.
    await waitFor(() => {
      expect(store.entries().length).toBe(1);
      expect(store.entries()[0]?.state).toBe("pass");
      expect(store.entries()[0]?.status).toBe(200);
    });
  });
});
