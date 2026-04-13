import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@solidjs/testing-library";
import { FilesPage } from "../src/pages/FilesPage";
import type { ProjectTree } from "../src/api/client";

const tree: ProjectTree = {
  projectDir: "/tmp/demo",
  sections: [
    {
      label: "journeys",
      dir: "/tmp/demo/journeys",
      children: [{ name: "auth.journey.ts", type: "file" }],
    },
    {
      label: "environments",
      dir: "/tmp/demo/environments",
      children: [
        { name: "dev.json", type: "file" },
        { name: "staging.json", type: "file" },
      ],
    },
    {
      label: "generated",
      dir: "/tmp/demo/generated",
      children: [
        { name: "endpoints.ts", type: "file" },
        { name: "models.ts", type: "file" },
      ],
    },
  ],
};

describe("FilesPage", () => {
  it("renders each section with its entries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify(tree), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    render(() => <FilesPage />);
    await waitFor(() => {
      expect(screen.getByTestId("section-journeys")).toBeTruthy();
    });
    expect(screen.getByTestId("section-environments")).toBeTruthy();
    expect(screen.getByTestId("section-generated")).toBeTruthy();
    expect(screen.getByText("auth.journey.ts")).toBeTruthy();
    expect(screen.getByText("dev.json")).toBeTruthy();
    expect(screen.getByText("models.ts")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
