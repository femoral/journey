import { describe, expect, it, vi } from "vitest";
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

describe("JourneysPage", () => {
  it("lists journeys and renders step results after running", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string) => {
        const url = typeof input === "string" ? input : input.url;
        const body = url.endsWith("/run") ? runResp : list;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    render(() => <JourneysPage />);
    await waitFor(() => {
      expect(screen.getByText("auth.journey.ts")).toBeTruthy();
    });
    fireEvent.click(screen.getByText("auth.journey.ts"));
    fireEvent.click(screen.getByTestId("run-button"));
    await waitFor(() => {
      expect(screen.getByTestId("run-results")).toBeTruthy();
    });
    expect(screen.getByText("auth flow")).toBeTruthy();
    expect(screen.getByText("login")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
