import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { JourneysPage } from "../src/pages/JourneysPage";

const list = { journeysDir: "/tmp/demo/journeys", files: ["auth.journey.ts"] };
const runResp = {
  results: [
    {
      name: "auth flow",
      ok: true,
      durationMs: 22,
      steps: [
        {
          name: "login",
          ok: true,
          durationMs: 10,
          request: { method: "POST", url: "https://x/login" },
          response: { status: 200, headers: {}, body: { token: "t" } },
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
      let body: unknown;
      if (url.endsWith("/run")) body = runResp;
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

describe("JourneysPage", () => {
  beforeEach(() => stubFetch());
  afterEach(() => vi.unstubAllGlobals());

  it("lists journeys and renders step results after running", async () => {
    render(() => <JourneysPage />);
    await waitFor(() => {
      expect(screen.getByText("auth.journey.ts")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("auth.journey.ts"));
    const runBtn = await waitFor(() => screen.getByTestId("run-button"));
    fireEvent.click(runBtn);
    await waitFor(() => {
      expect(screen.getByTestId("run-results")).toBeTruthy();
    });
    expect(screen.getByText("login")).toBeTruthy();
    // Response tab is default; response status shows 200 via StatusPill
    expect(screen.getByText("200")).toBeTruthy();
  });
});
