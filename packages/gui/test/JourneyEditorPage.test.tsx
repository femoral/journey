import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { JourneyEditorPage, parseSteps, reorderSource } from "../src/pages/JourneyEditorPage";

const listResp = { journeysDir: "/tmp", files: ["auth.journey.ts"] };
const sourceResp = {
  file: "auth.journey.ts",
  source: `import { journey, step } from "@usejourney/core";

journey("auth flow", () => {
  step("login", {
    endpoint: endpoints.login,
  });
  step("me", {
    endpoint: endpoints.me,
  });
});
`,
};

describe("JourneyEditorPage", () => {
  it("loads source and surfaces parsed steps", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Request | string) => {
        const url = typeof input === "string" ? input : input.url;
        const body = url.endsWith("/api/journeys") ? listResp : sourceResp;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    render(() => <JourneyEditorPage />);
    await waitFor(() => expect(screen.getByTestId("journey-file-list")).toBeTruthy());
    fireEvent.click(screen.getByText("auth.journey.ts"));
    await waitFor(() =>
      expect((screen.getByTestId("source-editor") as HTMLTextAreaElement).value).toContain(
        "journey",
      ),
    );
    const parsed = screen.getByTestId("parsed-steps");
    expect(parsed.textContent).toContain("login");
    expect(parsed.textContent).toContain("me");
    vi.unstubAllGlobals();
  });

  it("reorderSource swaps two steps correctly", () => {
    const src = `journey("x", () => {
  step("a", {
    endpoint: endpoints.a,
  });

  step("b", {
    endpoint: endpoints.b,
  });
});
`;
    const steps = parseSteps(src);
    expect(steps).toHaveLength(2);
    expect(steps[0]!.name).toBe("a");
    expect(steps[1]!.name).toBe("b");

    const swapped = reorderSource(src, steps, 0, 1);
    const newSteps = parseSteps(swapped);
    expect(newSteps).toHaveLength(2);
    expect(newSteps[0]!.name).toBe("b");
    expect(newSteps[1]!.name).toBe("a");
  });
});
