import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { JourneysPage } from "../src/pages/JourneysPage";
import { ConsoleContext } from "../src/shell/consoleContext";
import { createConsoleStore } from "../src/shell/consoleStore";

const list = { journeysDir: "/tmp/demo/journeys", files: ["auth.journey.ts"] };

function sseFrames(events: unknown[]): string {
  return (
    events.map((e) => `data: ${JSON.stringify(e)}`).join("\n\n") + "\n\n"
  );
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

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/runs/r1/events")) {
        return streamResponse(runEventsFrames);
      }
      let body: unknown;
      if (url.endsWith("/run")) body = { runId: "r1" };
      else if (url.endsWith("/api/journeys")) body = list;
      else if (url.endsWith("/api/runs")) body = [];
      else body = {};
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

function renderWithConsole() {
  const store = createConsoleStore();
  return {
    store,
    result: render(() => (
      <ConsoleContext.Provider value={store}>
        <JourneysPage />
      </ConsoleContext.Provider>
    )),
  };
}

describe("JourneysPage", () => {
  beforeEach(() => stubFetch());
  afterEach(() => vi.unstubAllGlobals());

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
