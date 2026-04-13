import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { ProjectPage } from "../src/pages/ProjectPage";
import type { ProjectSummary } from "../src/api/client";

const summary: ProjectSummary = {
  projectDir: "/tmp/demo",
  config: { name: "demo", spec: "openapi.yaml", baseUrl: "https://api.example.com" },
  counts: { journeys: 1, environments: 2, endpoints: 3 },
};

describe("ProjectPage", () => {
  it("renders counts and config from the API", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(summary), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(() => <ProjectPage />);
    await waitFor(() => {
      expect(screen.getByTestId("project-name").textContent).toBe("demo");
    });
    expect(screen.getByTestId("endpoint-count").textContent).toBe("3");
    vi.unstubAllGlobals();
  });

});
