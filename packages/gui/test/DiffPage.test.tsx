import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { DiffPage } from "../src/pages/DiffPage";

const drifting = {
  added: [{ method: "GET", path: "/pets", operationId: "listPets" }],
  removed: [{ method: "DELETE", path: "/pets/{id}", operationId: "deletePet" }],
  hasGenerated: true,
  hasSpec: true,
  count: 2,
};

const inSync = {
  added: [],
  removed: [],
  hasGenerated: true,
  hasSpec: true,
  count: 0,
};

function stub(state: unknown) {
  let calls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.includes("/api/generate") && init?.method === "POST") {
        calls++;
        return new Response(
          JSON.stringify({
            operationCount: 2,
            modelsPath: "m",
            endpointsPath: "e",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      // First call returns drift; subsequent calls (after regenerate) return inSync.
      const body = calls === 0 ? state : inSync;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

describe("DiffPage", () => {
  beforeEach(() => stub(drifting));
  afterEach(() => vi.unstubAllGlobals());

  it("lists drifted endpoints and clears them after Regenerate", async () => {
    render(() => <DiffPage />);
    await waitFor(() => expect(screen.getByTestId("drift-row-GET-/pets")).toBeTruthy());
    expect(screen.getByTestId("drift-row-DELETE-/pets/{id}")).toBeTruthy();
    expect(screen.getByText(/2 endpoints drifted/)).toBeTruthy();

    fireEvent.click(screen.getByTestId("regenerate"));
    await waitFor(() => expect(screen.getByText("In sync. No drift detected.")).toBeTruthy());
  });
});
