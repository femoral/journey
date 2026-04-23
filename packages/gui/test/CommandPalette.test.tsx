import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { createSignal } from "solid-js";
import { CommandPalette } from "../src/shell/CommandPalette";

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Request | string) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/endpoints")) {
        return new Response(
          JSON.stringify({
            baseUrl: "https://api.x",
            endpoints: [
              {
                name: "getPet",
                method: "GET",
                path: "/pet/{id}",
                parameters: [],
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.endsWith("/api/journeys")) {
        return new Response(
          JSON.stringify({ journeysDir: "/j", files: ["x.journey.ts"] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response("{}", { status: 200 });
    }),
  );
}

describe("CommandPalette", () => {
  beforeEach(() => stubFetch());
  afterEach(() => vi.unstubAllGlobals());

  it("filters to matching commands and closes on Escape", async () => {
    const [open, setOpen] = createSignal(true);
    render(() => (
      <Router>
        <Route
          path="*"
          component={() => (
            <CommandPalette open={open()} onClose={() => setOpen(false)} />
          )}
        />
      </Router>
    ));

    await waitFor(() => expect(screen.getByTestId("command-palette")).toBeTruthy());
    const input = screen.getByTestId("command-palette-input");

    fireEvent.input(input, { target: { value: "endpoints" } });
    await waitFor(() => {
      // Route command "Endpoints" matches.
      expect(screen.getByTestId("command-r:/endpoints")).toBeTruthy();
    });

    fireEvent.keyDown(screen.getByTestId("command-palette"), { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("command-palette")).toBeNull();
    });
  });

  it("shows endpoints and journeys once loaded", async () => {
    const [open] = createSignal(true);
    render(() => (
      <Router>
        <Route
          path="*"
          component={() => (
            <CommandPalette open={open()} onClose={() => {}} />
          )}
        />
      </Router>
    ));
    await waitFor(() =>
      expect(screen.getByTestId("command-ep:getPet")).toBeTruthy(),
    );
    expect(screen.getByTestId("command-jr:x.journey.ts")).toBeTruthy();
  });
});
