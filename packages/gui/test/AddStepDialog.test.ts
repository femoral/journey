import { describe, expect, it } from "vitest";
import { renameStep } from "../src/pages/AddStepDialog";
import { parseSteps } from "../src/pages/JourneyEditorPage";

describe("renameStep", () => {
  const src = `journey("x", () => {
  step("login", { endpoint: { method: "POST", path: "/auth" } });
  step("me", { endpoint: { method: "GET", path: "/me" } });
});
`;

  it("renames the step at the matching start offset", () => {
    const [first] = parseSteps(src);
    const next = renameStep(src, first!.name, "authenticate", first!.start, first!.end);
    expect(next).toBeDefined();
    const reparsed = parseSteps(next!);
    expect(reparsed[0]!.name).toBe("authenticate");
    expect(reparsed[1]!.name).toBe("me");
  });

  it("returns undefined when the start offset doesn't match oldName", () => {
    const [, second] = parseSteps(src);
    expect(renameStep(src, "wrong", "x", second!.start, second!.end)).toBeUndefined();
  });
});
