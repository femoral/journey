import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { Router, Route } from "@solidjs/router";
import { ProjectPage } from "../src/pages/ProjectPage";
import type { ProjectSummary, RunSummary } from "../src/api/client";

const summary: ProjectSummary = {
  projectDir: "/tmp/demo",
  config: {
    name: "demo",
    spec: "openapi.yaml",
    baseUrl: "https://api.example.com",
    defaultEnvironment: "local",
    tlsRejectUnauthorized: true,
  },
  counts: { journeys: 1, environments: 2, endpoints: 3 },
};

const now = new Date("2026-04-21T08:00:00Z").getTime();
const runs: RunSummary[] = [
  {
    id: "r1",
    timestamp: new Date(now - 2 * 60_000).toISOString(),
    journeyNames: ["checkout.journey.ts"],
    ok: true,
    durationMs: 820,
    stepCount: 4,
  },
  {
    id: "r2",
    timestamp: new Date(now - 2 * 60 * 60_000).toISOString(),
    journeyNames: ["signup.journey.ts", "extra.journey.ts"],
    ok: false,
    durationMs: 1100,
    stepCount: 6,
  },
];

function stubFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/api/project")) {
        return Promise.resolve(
          new Response(JSON.stringify(summary), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.includes("/api/runs")) {
        return Promise.resolve(
          new Response(JSON.stringify(runs), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      }
      if (url.includes("/api/spec/drift")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              added: [],
              removed: [],
              count: 0,
              hasGenerated: true,
              hasSpec: true,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        );
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    }) as typeof fetch,
  );
}

function renderInRouter() {
  return render(() => (
    <Router>
      <Route path="*" component={ProjectPage} />
    </Router>
  ));
}

describe("ProjectPage", () => {
  beforeEach(() => {
    vi.setSystemTime(now);
    stubFetch();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders project name, counts, and recent runs", async () => {
    renderInRouter();
    await waitFor(() => {
      expect(screen.getByTestId("project-name").textContent).toBe("demo");
    });
    expect(screen.getByTestId("endpoint-count").textContent).toBe("3");

    await waitFor(() => {
      expect(screen.getAllByTestId("recent-run-row").length).toBe(2);
    });
    expect(screen.getByText("checkout.journey.ts")).toBeDefined();
    expect(screen.getByText("+1")).toBeDefined();
  });

  it("PATCHes /api/project/config when the TLS toggle is flipped and refetches", async () => {
    let tlsRejectUnauthorized = true;
    const calls: Array<{ url: string; method: string; body: string | undefined }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input.toString();
        const method = init?.method ?? "GET";
        calls.push({ url, method, body: init?.body as string | undefined });
        if (url.endsWith("/api/project/config") && method === "PATCH") {
          const body = JSON.parse(init!.body as string) as { tlsRejectUnauthorized?: boolean };
          if (typeof body.tlsRejectUnauthorized === "boolean") {
            tlsRejectUnauthorized = body.tlsRejectUnauthorized;
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({ ...summary, config: { ...summary.config, tlsRejectUnauthorized } }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        if (url.includes("/api/project")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({ ...summary, config: { ...summary.config, tlsRejectUnauthorized } }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        if (url.includes("/api/runs")) {
          return Promise.resolve(
            new Response(JSON.stringify(runs), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
          );
        }
        if (url.includes("/api/spec/drift")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                added: [],
                removed: [],
                count: 0,
                hasGenerated: true,
                hasSpec: true,
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(new Response("{}", { status: 404 }));
      }) as typeof fetch,
    );

    renderInRouter();
    await waitFor(() => {
      expect(screen.getByTestId("project-settings")).toBeDefined();
    });

    const toggleLabel = screen.getByTestId("tls-toggle");
    const checkboxInput = toggleLabel.querySelector("input") as HTMLInputElement;
    expect(checkboxInput.checked).toBe(false);
    fireEvent.click(toggleLabel);

    await waitFor(() => {
      const patch = calls.find(
        (c) => c.url.endsWith("/api/project/config") && c.method === "PATCH",
      );
      expect(patch).toBeDefined();
      expect(JSON.parse(patch!.body!)).toEqual({ tlsRejectUnauthorized: false });
    });

    // After refetch the checkbox reflects the new state.
    await waitFor(() => {
      const cb = screen.getByTestId("tls-toggle").querySelector("input") as HTMLInputElement;
      expect(cb.checked).toBe(true);
    });
  });

  it("shows empty-state when there are no runs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: RequestInfo | URL) => {
        const url = typeof input === "string" ? input : input.toString();
        if (url.includes("/api/project")) {
          return Promise.resolve(new Response(JSON.stringify(summary), { status: 200 }));
        }
        if (url.includes("/api/spec/drift")) {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                added: [],
                removed: [],
                count: 0,
                hasGenerated: true,
                hasSpec: true,
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
          );
        }
        return Promise.resolve(
          new Response("[]", { status: 200, headers: { "content-type": "application/json" } }),
        );
      }) as typeof fetch,
    );
    renderInRouter();
    await waitFor(() => {
      expect(screen.getByText("No runs yet.")).toBeDefined();
    });
  });
});
