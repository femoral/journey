import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { HistoryPage } from "../src/pages/HistoryPage";
import type { RunSummary } from "../src/api/client";

const now = new Date("2026-04-23T08:00:00Z").getTime();

const runs: RunSummary[] = [
  {
    id: "run-a",
    timestamp: new Date(now - 60_000).toISOString(),
    journeyNames: ["checkout"],
    ok: true,
    durationMs: 820,
    stepCount: 4,
  },
  {
    id: "run-b",
    timestamp: new Date(now - 2 * 60 * 60_000).toISOString(),
    journeyNames: ["checkout"],
    ok: false,
    durationMs: 1100,
    stepCount: 4,
  },
  {
    id: "run-c",
    timestamp: new Date(now - 3 * 60 * 60_000).toISOString(),
    journeyNames: ["signup"],
    ok: true,
    durationMs: 420,
    stepCount: 2,
  },
];

const detailA = {
  id: "run-a",
  timestamp: runs[0]!.timestamp,
  results: [
    {
      name: "checkout",
      ok: true,
      durationMs: 820,
      steps: [
        {
          name: "login",
          ok: true,
          durationMs: 50,
          request: { method: "POST", url: "https://x/login" },
          response: { status: 200, headers: {}, body: { v: 1 } },
        },
      ],
    },
  ],
};

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/runs")) {
        return new Response(JSON.stringify(runs), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.endsWith("/api/runs/run-a")) {
        return new Response(JSON.stringify(detailA), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected ${url}`);
    }),
  );
}

describe("HistoryPage", () => {
  beforeEach(() => {
    vi.setSystemTime(now);
    stubFetch();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders run stats, the list, and loads the selected run's detail", async () => {
    render(() => <HistoryPage />);
    await waitFor(() => expect(screen.getByTestId("history-count").textContent).toBe("3 runs"));
    expect(screen.getByText("67%")).toBeTruthy(); // 2 pass / 3
    expect(screen.getByText("780ms")).toBeTruthy(); // avg of 820, 1100, 420
    expect(screen.getByTestId("history-row-run-a")).toBeTruthy();

    fireEvent.click(screen.getByTestId("history-row-run-a"));
    await waitFor(() => expect(screen.getByText("login")).toBeTruthy());
    expect(screen.getByText("POST https://x/login")).toBeTruthy();
  });
});
